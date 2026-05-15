# Plan 3：运维完善 — 配置校验、分发保护、审计与测试

关联文档：[标注任务流转详细修复方案.md](./标注任务流转详细修复方案.md)
前置条件：[Plan 1 — 基础加固](./plan-01-基础加固-权限与返工闭环.md)、[Plan 2 — 接口稳定](./plan-02-接口稳定-双推进幂等与分页.md)

## 目标

补全配置端的可靠性（分发并发保护、比例校验、跨组织策略）、完善审计语义（review/accept action 区分）、补齐自动化测试和数据一致性检查。

Plan 3 不阻塞 Plan 1 和 Plan 2 上线，但建议在 Plan 2 稳定后尽快推进以避免管理端误操作和数据脏数据积累。

## 范围

| 模块 | 改动 |
|------|------|
| 分发保护 | 分发逻辑加事务和项目级锁，返回详细统计数据 |
| 比例校验 | serializer min/max 校验，项目级总和校验，非 label 角色校验报错 |
| 跨组织策略 | 短期禁止跨组织配置，校验 OrganizationMember |
| 审计完善 | review/accept API 增加 comment 持久化，前端按钮文案补充 |
| 数据修复 | 一致性检查管理命令（dry-run + apply） |
| 测试 | service 单元测试、API 权限测试、workflow API 集成测试 |

## 实施步骤

### Step 3.1：分发逻辑加事务和并发保护

**文件**：`label_studio/projects/workflow_services.py`

`distribute_tasks_for_project()` 改动：

```python
@transaction.atomic
def distribute_tasks_for_project(project) -> dict:
    project = Project.objects.select_for_update().get(pk=project.pk)
    settings, _ = ProjectWorkflowSettings.objects.select_for_update().get_or_create(
        project=project, defaults={'rr_review_index': 0, 'rr_accept_index': 0}
    )
    # ... 原有分发逻辑
```

**并发保护**：锁项目行或 `ProjectWorkflowSettings` 行，确保同一时间只有一个分发过程。

**创建方式**：

| 数据库 | 推荐方式 |
|--------|---------|
| PostgreSQL | `bulk_create(ignore_conflicts=True)` |
| SQLite | `bulk_create(ignore_conflicts=True)`（Django 4.0+） |
| MySQL | 逐条 `get_or_create()`（MySQL 不支持 `ignore_conflicts`） |

> 不依赖 `bulk_create` 返回值计算 created 数量。统一在分发前后对 project 做 `TaskWorkflow.objects.count()` 差值计算。

**返回结构**从 `{"created": 10}` 扩展为：

```json
{
  "created": 10,
  "skipped_existing": 25,
  "total_tasks": 35,
  "workflow_total": 35
}
```

### Step 3.2：分配比例后端校验

**文件**：`label_studio/projects/workflow_api.py`、`workflow_services.py`

**① 单条校验**：

```python
allocation_percent = serializers.DecimalField(
    max_digits=6, decimal_places=2,
    min_value=Decimal('0'), max_value=Decimal('100'),
    default=0,
)
```

**② 非 label 角色比例校验**（不再 silent override）：

```python
def validate(self, attrs):
    if attrs['role'] != ProjectTeamRole.LABEL:
        if attrs.get('allocation_percent', Decimal('0')) != Decimal('0'):
            raise ValidationError({
                'allocation_percent': '非标注(label)角色的分配比例不生效，请设置为 0。'
            })
        attrs['allocation_percent'] = Decimal('0')
    return attrs
```

**③ 项目级总和校验**（分发前再次校验，防止绕过 API 的脏数据）：

1. label 角色比例总和必须等于 100，允许误差 0.01
2. 至少有一个 label 用户比例 > 0
3. 不满足条件时分发接口返回 400，列出当前总和和差异

### Step 3.3：跨组织人员策略

**文件**：`label_studio/projects/workflow_api.py`

**短期策略**：禁止跨组织配置。人员配置时增加校验：

```python
from organizations.models import OrganizationMember

user = get_object_or_404(User, pk=uid)
if not OrganizationMember.objects.filter(
    user=user, organization_id=project.organization_id
).exists():
    raise ValidationError('用户不属于当前项目组织，不能加入项目团队。')
```

> 注意：`OrganizationMember` 可能有软删除字段（`deleted_at`），查询时需要排除已删除的成员关系。

若后续产品要求支持跨组织协作，需单独立项目改造 `Project.objects.for_user()`、`Task.objects.for_user()`、`Annotation.objects.for_user()` 以及 `_visible_org_project()`/`_visible_org_task()` 的过滤逻辑，让显式团队分配成为可见性入口之一。

### Step 3.4：审核/验收语义分离

**文件**：`label_studio/projects/workflow_api.py`、前端 SDK/Store

**后端**：Review 和 Accept API 的 body 已支持 `comment` 字段（Plan 1 Step 1.6），本 step 确认持久化路径：

- `review_approve` → `TaskWorkflowAction(action='review_approve', comment=...)`
- `review_reject` → `TaskWorkflowAction(action='review_reject', comment=...)`
- `accept_approve` → `TaskWorkflowAction(action='accept_approve', comment=...)`
- `accept_reject` → `TaskWorkflowAction(action='accept_reject', comment=...)`

**前端**（增强，非首期必须）：
- review 按钮文案："审核通过" / "驳回"
- accept 按钮文案："验收通过" / "驳回"
- 驳回时弹窗要求填写原因（`comment` 必填）

### Step 3.5：数据一致性检查命令

**文件**：`label_studio/projects/management/commands/fix_task_workflow_consistency.py`

命令能力：

```bash
python manage.py fix_task_workflow_consistency --dry-run              # 仅输出统计
python manage.py fix_task_workflow_consistency --apply                 # 执行修复
python manage.py fix_task_workflow_consistency --project-id 42 --apply # 按项目修复
```

异常检测和修复规则：

| 异常 | 修复方式 |
|------|---------|
| `workflow.stage != done` 且 `task.is_labeled = True` | 设 `is_labeled = False` |
| `workflow.stage = done` 且 `task.is_labeled = False` | 设 `is_labeled = True` |
| `workflow.stage = done` 且 `current_assignee_id is not null` | 设 `current_assignee_id = null` |
| `workflow.stage != done` 且 `current_assignee_id is null` | 输出异常，人工指定处理人 |
| `workflow.stage = review` 但项目无 review 角色 | 输出异常 |
| `workflow.stage = accept` 但项目无 accept 角色 | 输出异常 |
| label 角色比例总和 != 100 | 输出异常 |
| label 角色比例 < 0 或 > 100 | 输出异常 |
| 团队成员不属于项目 organization | 输出异常 |
| `stage in (review,accept,done)` 且无 `current_annotation` 可回填 | 输出异常 |
| 有 workflow 记录但 `project.task_workflow_enabled = False` | 输出异常 |

### Step 3.6：自动化测试补齐

**新增文件**：

| 文件 | 覆盖内容 |
|------|---------|
| `label_studio/projects/tests/test_workflow_services.py` | 分发比例、分发幂等/并发、标注推进分支（有/无审核池/验收池）、审核驳回/通过、验收驳回/通过、驳回后返工校验、submit 幂等 |
| `label_studio/tasks/tests/test_workflow_annotation_permissions.py` | 非当前处理人创建/PATCH/DELETE 被拒、当前标注员不能改他人 annotation、review/accept/done 阶段不能改内容、completed_by 被强制、跨项目 annotation ID 不可见 |
| `label_studio/projects/tests/test_workflow_api.py` | my-tasks 分页、review/accept API 记录 action、驳回 comment 保存、非当前 reviewer/acceptor 调决策接口被拒、比例校验、跨组织策略 |

**关键测试用例**：

1. 按比例分发：2 个标注员 70/30，10 个任务 → 7/3
2. 任务数不能整除时 largest remainder 结果稳定
3. 同一项目重复分发不重复创建 workflow
4. 并发分发不抛 IntegrityError
5. 无审核池有验收池：标注提交后直接进入 accept
6. 有审核池无验收池：审核通过后直接进入 done
7. 审核驳回：退回 annotate，处理人是原标注员，is_labeled=False
8. 驳回后不改 annotation 直接提交 → 400
9. 驳回后更新 annotation 再提交 → 成功，current_annotation 更新
10. signal 已推进后 API 再调用 → 返回幂等成功
11. 非当前处理人 PATCH annotation → 403
12. reviewer 直调 PATCH annotation → 403
13. 比例负数/超 100 → 400
14. 非 label 角色比例非 0 → 400

## 验收清单

1. 两个管理员同时点击分发 → 不出现 500，不重复创建 workflow
2. label 比例不能 < 0 或 > 100
3. label 比例总和不等于 100 时不能分发
4. 非 label 角色提交非 0 比例 → 返回明确校验错误
5. 跨组织人员配置被拒绝并显示明确错误信息
6. 审核和验收 history 中 action 类型不同（review_approve vs accept_approve）
7. `fix_task_workflow_consistency --dry-run` 不报错就能正常输出统计
8. 所有新增测试用例通过

## 相关风险

- 数据修复命令首次执行必须 dry-run，尤其是 `is_labeled` 回退会影响原生统计报表
- 跨组织策略如果后续改为允许，改动范围远超人员配置接口（Project/Task/Annotation 的 `for_user()` 都需要改）
- `select_for_update` 在分发事务中会锁住项目行，如果分发任务数量极大（10 万+），可能长时间持有锁。建议分批分发 + 超时处理
