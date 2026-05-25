# Plan 2：接口稳定 — 双推进幂等、分页、前端适配

关联文档：[标注任务流转详细修复方案.md](./标注任务流转详细修复方案.md)
前置条件：[Plan 1 — 基础加固](./plan-01-基础加固-权限与返工闭环.md)

## 目标

消除标注保存后的双推进冲突、让"我的任务"支持完整翻页、前端行为与后端权限模型对齐。

**前置依赖**：本 plan 的幂等逻辑依赖 Plan 1 中 `TaskWorkflow.current_annotation` 等字段已存在且被正确填充。必须先完成 Plan 1 的 Step 1.4（返工闭环版本绑定）再执行本 plan 的 Step 2.1（双推进幂等），否则幂等判断条件无法评估。

## 范围

| 模块 | 改动 |
|------|------|
| 双推进 | signal 作为唯一自动推进入口，`submit_annotation_after_labeling()` 改为幂等 |
| 我的任务 API | 服务端分页 + 过滤参数（search/status/date_from/date_to） |
| SDK | 移除保存后无条件 workflow submit 调用，错误处理从吞错改为区分 |
| 前端 MyTasksPage | 删除客户端过滤，改为每次切页/切换过滤条件时重新请求后端 |
| 前端编辑器 | 根据 workflow stage 设置 editor mode，Accept/Reject 路由到正确 API |

## 实施步骤

### Step 2.1：双推进改为后端 signal 唯一入口

**文件**：
- `label_studio/tasks/models.py` — signal 保持不变，作为唯一自动入口
- `label_studio/projects/workflow_services.py` — `submit_annotation_after_labeling()` 改为幂等
- `label_studio/projects/workflow_api.py` — submit API 返回更明确状态
- `web/libs/datamanager/src/sdk/lsf-sdk.js` — 移除前端显式调用

**① 最终架构**：

```
创建/更新 annotation
  → 数据库保存成功
  → transaction.on_commit
  → submit_annotation_after_labeling(source='signal')
  → workflow 状态推进
  → 前端收到 annotation 保存响应（无需知道 workflow 已推进）
```

保留 `POST /api/tasks/:id/workflow/submit-annotation/` 供第三方客户端或异常重试。

**② service 幂等规则**：

当 `wf.stage != annotate` 时（说明 signal 已经推进过了）：

| 当前 stage | 条件 | 行为 |
|-----------|------|------|
| review / accept | `wf.current_annotation.completed_by_id == user.id` 且 `wf.last_submitted_at` 非空 | 返回当前 workflow 状态，不报错 |
| done | 同上 | 返回当前 workflow 状态，不报错 |
| 其他 | 不满足上述条件 | 返回 400，提示当前阶段不允许提交 |

响应增加字段用于前端判断：

```json
{
  "task_id": 123,
  "stage": "review",
  "current_assignee_id": 456,
  "current_annotation_id": 789,
  "already_submitted": true
}
```

> **依赖**：幂等判断中的 `wf.current_annotation` 和 `wf.last_submitted_at` 必须在 Plan 1 Step 1.4 完成后才存在。Plan 1 完成前，前端只能直接移除显式 POST 调用，不能依赖后端幂等兜底。

**③ 前端 SDK 调整**：

`lsf-sdk.js` 改动：

1. 删除 `onSubmitAnnotation()` 中 `maybeAdvanceTaskWorkflowAfterLabeling()` 的无条件调用（`lsf-sdk.js:952`）
2. 删除 `onUpdateAnnotation()` 中类似的调用（`lsf-sdk.js:994`）
3. `errorHandlerSwallowWorkflow`（`lsf-sdk.js:50`）拆分为：
   - `errorHandlerSwallowIdempotent`：仅吞掉后端明确的幂等响应（`already_submitted: true`）
   - 其他错误（权限、阶段、分配错误）必须向 UI 抛出，不再吞掉
4. 审核/验收操作前先通过 `GET /api/tasks/:id/workflow/` 读取 stage，再调用对应接口

### Step 2.2：我的任务改为服务端分页

**文件**：
- `label_studio/projects/workflow_api.py` — `ProjectWorkflowMyTasksAPI.get()`
- `label_studio/projects/workflow_services.py` — `queryset_my_tasks()` 增加过滤参数
- `web/apps/labelstudio/src/pages/MyTasks/MyTasksPage.jsx`

**① 后端 API 参数**：

| 参数 | 默认 | 范围 | 含义 |
|------|------|------|------|
| `stage` | 必填 | annotate/review/accept | 任务阶段 |
| `page` | 1 | >=1 | 页码 |
| `page_size` | 20 | 1-200 | 每页数量 |
| `search` | 空 | 任意字符串 | 按任务 ID 或 data 中文本模糊搜索 |
| `status` | all | all/progress/done | 完成状态筛选（progress=未完成，done=已完成） |
| `date_from` | 空 | ISO 日期 | 任务创建时间起始 |
| `date_to` | 空 | ISO 日期 | 任务创建时间截止 |

> **重要**：当前前端在拿到全量结果后做客户端过滤（`MyTasksPage.jsx:157-179`）。改为服务端分页后这不再可行，因此 `search`/`status`/`date_from`/`date_to` 必须同步迁移到后端 SQL 查询中。

实现方式：

```python
class WorkflowTaskPagination(PageNumberPagination):
    page_size_query_param = 'page_size'
    max_page_size = 200

# 在 queryset_my_tasks() 中增加过滤：
# - search → Q(id__icontains=...) | Q(data__icontains=...)
# - status='done' → workflow__stage='done'
# - status='progress' → ~Q(workflow__stage='done')
# - date_from → created_at__gte=...
# - date_to → created_at__lte=... + 1 day
```

**② 前端改动**：

1. 请求参数增加 `page`、`page_size`、`search`、`status`、`dateFrom`、`dateTo`
2. 删除 `filtered = useMemo(...)` 中的客户端过滤逻辑
3. 总条数使用后端 `count`，列表使用 `results`
4. 切换 stage/筛选条件/pageSize 时重置到第一页
5. 保持 page size 选项：10、20、50、100、200

### Step 2.3：编辑器模式根据 workflow stage 区分

**文件**：`web/libs/datamanager/src/sdk/lsf-sdk.js`

编辑器进入前通过 `GET /api/tasks/:id/workflow/` 获取当前 stage，设置 editor mode：

| workflow stage | editor mode | 主操作 |
|---------------|-------------|--------|
| annotate | annotate | 提交标注 |
| review | review | 审核通过 / 驳回 |
| accept | accept（复用 review 模式） | 验收通过 / 驳回 |
| done | readonly | 无写操作 |

> **注意**：Label Studio 编辑器原生有 labeling 和 review 两种模式。workflow 的 accept（验收）阶段没有对应的原生模式。首期 accept 复用 review 模式的编辑器 UI，SDK 在调用审核/验收接口时触发不同的 API 端点，后端 history 记录不同的 action 类型（`review_approve` vs `accept_approve`）。

后续增强：accept 阶段增加独立编辑器模式，禁止修改标注内容（如产品要求）。

### Step 2.4：打开 Feature Flags 灰度验证

参考 Plan 1 Step 1.6 中定义的 3 个 feature flag，按顺序逐步开启：

1. **先开** `fflag_workflow_strict_annotation_perms` → 观察 annotation update/delete 被拦截的请求中是否有正常业务流量
2. **再开** `fflag_workflow_strict_draft_perms` → 观察 draft 相关操作
3. **最后开** `fflag_workflow_require_revision_after_reject` → 确保驳回返工闭环完整

每个 flag 观察至少一周，期间监控：
- `/api/annotations/*` 的 PATCH/DELETE 403 比率
- `/api/tasks/*/workflow/submit-annotation/` 的幂等响应占比
- `/api/projects/*/workflow/my-tasks/` 的分页请求模式

## 验收清单

1. annotation 保存后 workflow 自动推进（signal），不再需要前端二次调用
2. 旧客户端或第三方重复调用 submit annotation API → 返回幂等成功，不报 "Task is not in annotate stage"
3. 我的任务超过 100 条时可以通过翻页完整浏览（例如 235 条，page_size=20，可以翻到第 12 页）
4. 按名称搜索、状态筛选、日期筛选在分页场景下结果正确
5. 切换 stage / 筛选条件后自动回到第一页
6. SDK 在 review stage 调用 review API，在 accept stage 调用 accept API
7. 审核/验收失败时 UI 显示错误信息（不再只在 console 打 warning）
8. 非 workflow 项目行为不受影响

## 相关风险

- 前端移除显式 submit 后，必须确认所有 annotation 保存路径都会触发后端 signal。已知可能绕过的路径见 Plan 1 风险、详细方案 §10 风险 4
- `search` 参数对 `data` JSONField 做 `icontains` 查询性能可能较差（取决于数据量和数据库），建议限制搜索长度为 100 字符
- 服务端分页上线后，若用户同时打开了多个浏览器 tab 并切换 active organization，可能看到不一致的数据
