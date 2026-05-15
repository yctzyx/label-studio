# Plan 1：基础加固 — 数据模型、权限收口、返工闭环

关联文档：[标注任务流转详细修复方案.md](./标注任务流转详细修复方案.md)

## 目标

把 workflow 从"附加状态表"升级为真正的任务处理边界。完成数据模型扩展、annotation 写权限收口、驳回返工闭环和 `is_labeled` 一致性修复。

此 plan 是 **Plan 2 和 Plan 3 的前置依赖**。Plan 2 的幂等改造依赖本 plan 新增的 `current_annotation` 等字段，Plan 3 的分发/审计增强依赖本 plan 的 `TaskWorkflowAction` 审计表。

## 范围

| 模块 | 改动 |
|------|------|
| 数据模型 | `TaskWorkflow` 增加 6 个字段，新增 `TaskWorkflowAction` 审计表 |
| 权限 | `AnnotationAPI` queryset 收口，annotation create/update/delete 增加 workflow stage/assignee 校验 |
| 权限 | `AnnotationDraftAPI` 增加同等强度的 workflow 保护 |
| 权限 | workflow 项目创建 annotation 时强制 `completed_by = request.user` |
| 返工闭环 | 提交时绑定 `current_annotation`，驳回时记录 `last_rejected_*`，再次提交校验 `updated_at > last_rejected_at` |
| 状态一致性 | 驳回时回退 `task.is_labeled = False`，完成时同步 `is_labeled = True` |

## 实施步骤

### Step 1.1：数据模型迁移

**文件**：`label_studio/projects/workflow_models.py`
**Migration**：`label_studio/projects/migrations/0038_task_workflow_revision_and_actions.py`

在 `TaskWorkflow` 增加字段：

| 字段 | 类型 | 用途 |
|------|------|------|
| `current_annotation` | FK(Annotation, SET_NULL) | 当前提交进入审核/验收的 annotation |
| `last_submitted_at` | DateTimeField | 最近一次标注员提交时间 |
| `last_rejected_at` | DateTimeField | 最近一次驳回时间 |
| `last_rejected_by` | FK(User, SET_NULL) | 最近一次驳回人 |
| `last_rejected_annotation` | FK(Annotation, SET_NULL) | 最近被驳回的 annotation |
| `last_reject_reason` | TextField | 驳回原因（首期可选填） |

新增 `TaskWorkflowAction` 审计表：

| 核心字段 | 类型 | 用途 |
|----------|------|------|
| `workflow` | FK(TaskWorkflow) | 关联 workflow |
| `action` | CharField | distribute/submit/review_approve/review_reject/accept_approve/accept_reject/reopen |
| `stage_from` / `stage_to` | CharField | 操作前后阶段 |
| `actor` | FK(User) | 操作人 |
| `annotation` | FK(Annotation) | 本次操作针对的 annotation |
| `comment` | TextField | 审核/验收意见或驳回原因 |
| `metadata` | JSONField | 扩展信息（来源 signal/api） |

索引：`(project, created_at)`、`(task, created_at)`、`(workflow, created_at)`、`(action, created_at)`。

历史数据回填：

1. `stage in ('review','accept','done')` 且 `current_annotation_id is null` → 取该任务下 `completed_by_id = annotate_user_id`、`was_cancelled=False` 的最新 annotation 回填
2. `last_submitted_at` → 回填为 `current_annotation.updated_at`
3. 找不到 annotation 的 workflow 保持空值，由数据检查脚本输出

### Step 1.2：Annotation API 权限收口

**文件**：`label_studio/tasks/api.py`、`label_studio/projects/workflow_services.py`

**① `AnnotationAPI.get_queryset()` 改为用户可见范围**

```python
def get_queryset(self):
    return Annotation.objects.for_user(self.request.user).select_related(
        'task', 'project', 'completed_by', 'task__workflow'
    )
```

**② 增加 workflow annotation 写权限校验 helper**

在 `workflow_services.py` 新增：

- `assert_can_create_annotation_for_workflow(task, user)` — 校验 workflow stage=annotate 且 current_assignee=user
- `assert_can_update_annotation_for_workflow(annotation, user)` — 校验 stage=annotate 且 completed_by=user
- `assert_can_delete_annotation_for_workflow(annotation, user)` — 同上

**③ `AnnotationAPI.update()` / `delete()` 增加校验**

在 `update()` 和 `delete()` 方法中调用上述 helper。

**④ `AnnotatorListAPI.perform_create()` 强化**

workflow 项目中 **强制** `completed_by = request.user`（当前只在 `completed_by` 不存在时写入）：

```python
if getattr(task.project, 'task_workflow_enabled', False):
    extra_args['completed_by'] = self.request.user
```

**权限规则速查表**：

| 操作 | non-wf 项目 | annotate 阶段 | review 阶段 | accept 阶段 | done 阶段 |
|------|-----------|-------------|------------|------------|----------|
| 创建 annotation | 原规则 | 仅 current_assignee | 禁止 | 禁止 | 禁止 |
| 更新 annotation | 原规则 | current_assignee 且 completed_by=user | 禁止（过渡期：仅允许 reviewer 通过审核决策附带修改，不能直调 PATCH API） | 禁止 | 禁止 |
| 删除 annotation | 原规则 | current_assignee 且 completed_by=user | 禁止 | 禁止 | 禁止 |

> **过渡期注意**：review 阶段当前 reviewer 可通过审核决策流程附带修改 annotation（兼容前端 `persistReviewEditsIfDirty` 行为），但不能通过原生 annotation PATCH API 直接改。修改需在 `TaskWorkflowAction.metadata` 中标记。

**⑤ API 错误码**：

| 场景 | HTTP | 错误信息 |
|------|------|---------|
| 任务未分发 | 403 | 该任务尚未进入工作流，请先进行任务分发 |
| 非当前处理人 | 403 | 该任务未分配给当前用户，不能修改标注 |
| 非标注阶段改内容 | 403 | 该任务当前不在标注阶段，不能修改标注内容 |
| 修改他人 annotation | 403 | 不能修改其他用户提交的标注 |
| done 后修改 | 403 | 该任务流程已完成，不能继续修改标注 |

### Step 1.3：AnnotationDraft API 增加 workflow 保护

**文件**：`label_studio/tasks/api.py`

`AnnotationDraftListAPI` 和 `AnnotationDraftAPI`（`tasks/api.py:685-716`）当前使用 `AnnotationDraft.objects.all()` 无任何 workflow 校验。

1. `AnnotationDraftListAPI.perform_create()` 增加：检查任务已分发、stage=annotate、current_assignee=user
2. `AnnotationDraftAPI.get_queryset()` 改为按当前用户可见项目过滤
3. `AnnotationDraftAPI.update()`/`delete()` 增加与 `AnnotationAPI` 同等强度的 stage/assignee 校验

### Step 1.4：驳回返工闭环

**文件**：`label_studio/projects/workflow_services.py`、`workflow_api.py`

**① 提交时绑定当前 annotation**

`submit_annotation_after_labeling()` 改动：

```python
def _latest_valid_annotation_for_submit(wf, user):
    qs = Annotation.objects.filter(
        task_id=wf.task_id,
        completed_by_id=user.id,
        was_cancelled=False,
    ).order_by('-updated_at', '-id')

    if wf.last_rejected_at:
        qs = qs.filter(updated_at__gt=wf.last_rejected_at)

    return qs.first()
```

- 首次提交：取最新未取消 annotation
- 驳回后再提交：`updated_at` 必须晚于 `last_rejected_at`
- 无满足条件的 annotation → 返回 400：`驳回后请先更新或重新提交标注结果`
- 提交成功后写入 `wf.current_annotation`、`wf.last_submitted_at`、`TaskWorkflowAction(action='submit')`

**② 驳回时记录版本**

新增统一驳回 helper（review 和 accept 共用）：

```python
def _return_task_to_annotate(wf, *, rejected_by, comment, action):
    wf.stage = TaskWorkflowStage.ANNOTATE
    wf.current_assignee_id = wf.annotate_user_id
    wf.last_rejected_at = timezone.now()
    wf.last_rejected_by = rejected_by
    wf.last_rejected_annotation = wf.current_annotation
    wf.last_reject_reason = comment
    wf.save(update_fields=[...])

    task = wf.task
    if task.is_labeled:
        task.is_labeled = False
        task.save(update_fields=['is_labeled', 'updated_at'])

    TaskWorkflowAction.objects.create(
        workflow=wf, action=action, stage_from=..., stage_to='annotate',
        actor=rejected_by, annotation=wf.current_annotation, comment=comment,
    )
```

**③ 通过时记录 action**

- `review_approve`：写入 `TaskWorkflowAction`，无验收池时进入 done
- `accept_approve`：写入 `TaskWorkflowAction`，进入 done，`task.is_labeled = True`

### Step 1.5：is_labeled 一致性和事务保护

**① 完成态口径统一**

- workflow 项目：整单完成态以 `TaskWorkflow.stage == done` 为准
- 非 workflow 项目：沿用 `Task.is_labeled`
- workflow 项目中 `is_labeled` 作为冗余字段由 workflow service 同步维护

**② 状态变更加事务锁**

以下函数增加 `transaction.atomic()` + `select_for_update`：

- `submit_annotation_after_labeling()`
- `review_decision()`
- `accept_decision()`

> **重要**：`select_for_update()` 必须在 `transaction.atomic()` 块内调用。建议新增 `get_task_workflow_for_update(task_id)` 供事务内使用，保留原 `get_task_workflow_or_404()` 供只读查询。

### Step 1.6：Review / Accept API 增加 comment 字段

**文件**：`label_studio/projects/workflow_api.py`

`TaskWorkflowReviewAPI.Body` 和 `TaskWorkflowAcceptAPI.Body` 增加可选 `comment` 字段：

```python
class Body(serializers.Serializer):
    approve = serializers.BooleanField()
    comment = serializers.CharField(required=False, allow_blank=True)
```

## 涉及的 Feature Flags

| Flag | 控制内容 | Plan 1 后默认值 |
|------|---------|----------------|
| `fflag_workflow_strict_annotation_perms` | annotation update/delete 的 stage/assignee 校验 | `false` |
| `fflag_workflow_strict_draft_perms` | draft 的 stage/assignee 校验 | `false` |
| `fflag_workflow_require_revision_after_reject` | 驳回后要求 annotation 晚于驳回时间 | `false` |

灰度顺序：先开 annotation_perms → draft_perms → require_revision_after_reject。每个 flag 观察至少一周稳定后再开下一个。

## 验收清单

1. 非当前处理人无法通过 annotation ID PATCH annotation 内容
2. reviewer/acceptor 无法通过原生 annotation API 修改标注内容（过渡期内允许审核决策附带修改，但有 action 标记）
3. workflow 项目创建 annotation 时 `completed_by` 不受请求体伪造
4. 审核驳回后，标注员不修改 annotation 直接提交 → 返回 400 错误
5. 审核驳回后，标注员更新 annotation 再提交 → 成功推进到 review
6. 验收驳回后 `task.is_labeled = False`
7. 验收通过后 `workflow.stage = done` 且 `task.is_labeled = True`
8. 每次提交/审核/验收/驳回都有 `TaskWorkflowAction` 记录
9. AnnotationDraft 创建/更新/删除受同等 workflow 权限保护
10. 非 workflow 项目行为不受影响

## 相关风险

- `AnnotationAPI.get_queryset()` 收紧后可能暴露历史上依赖全量 annotation ID 访问的内部脚本，发布前需排查
- 驳回后 `updated_at > last_rejected_at` 判据：如果 PATCH 未触发 `updated_at` 更新会导致误判，需要验证
- `select_for_update()` 必须确认所有调用方都在事务内，否则抛 `TransactionManagementError`
- migration 回滚不支持直接 drop column（SQLite 限制），需要单独处理
