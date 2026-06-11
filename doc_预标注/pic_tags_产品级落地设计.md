# pic_tags_ 图片候选标签预标注产品级落地设计

## 1. 目标

把 `pic_tags_` 从“单独脚本 / 独立 Flask 接口”落地为 Label Studio 二开平台中的产品能力：

1. 用户在项目中配置标注模板。
2. 用户在“大模型预标注”页配置视觉模型、候选标签策略和 Prompt。
3. 数据管理中点击“获取预测”。
4. Label Studio 后端调用常驻 `label-studio-llm-backend`。
5. ML 后端根据项目模板提取候选标签，调用 VLM。
6. ML 后端返回标准 Label Studio Prediction。
7. Label Studio 后端落库为 `Prediction`。
8. 标注员打开任务后看到预勾选标签，可人工修正。

本方案不是再维护一套 `pic_tags_` 批处理脚本，而是把 `pic_tags_` 的核心能力产品化到现有 ML Backend + Prediction 链路中。

## 2. 场景定义

`pic_tags_` 的业务场景是“图片候选标签识别”，不是通用图片描述，也不是目标检测框。

核心约束：

- 输入对象：图片。
- 输出对象：候选标签多选。
- 模型只能从项目模板里的候选标签中选择。
- 没有清晰证据时返回空标签。
- 预标结果必须能被 Label Studio 原生标注页展示和人工修改。

因此 MVP 不支持：

- 多个输出控件同时填充。
- 检测框、分割、多边形。
- 自由文本描述作为主要结果。
- 模型自由发明标签。

## 3. 推荐标注模板

模板文件：

[pic_tags_候选标签预标注模板.xml](./pic_tags_候选标签预标注模板.xml)

核心结构：

```xml
<Image name="image" value="$image"/>

<Choices name="pic_tags"
         toName="image"
         choice="multiple">
  <Choice value="烟雾" hint="..."/>
  <Choice value="火焰" hint="..."/>
</Choices>

<TextArea name="pic_tags_prompt" toName="image"/>
<TextArea name="pic_tags_note" toName="image"/>
```

### 3.1 用户可自定义范围

允许用户自定义：

- `Choice value` 候选标签。
- `Choice hint` 标签判定说明。
- 页面布局、标题、帮助文案。
- 是否保留交互式 Prompt。
- 是否保留人工备注。
- `Image value` 对应的任务字段名，例如 `$image`、`$url`、`$data.image`。

### 3.2 强制规则

为了保证预标注可落库，模板必须满足以下规则：

| 规则 | 说明 |
| --- | --- |
| 必须有且仅有一个主图片对象 | 支持 `<Image>`，MVP 不支持一个模板多张主图 |
| 必须有一个主输出 `Choices` | `choice="multiple"`，用于承载模型标签 |
| 主输出 `Choices.toName` 必须指向主图片对象 | 例如 `toName="image"` |
| `Choice value` 是最终入库标签名 | 不要把长说明写入 value |
| 标签说明放在 `hint` 或项目配置 | 用于 Prompt，不用于模型返回匹配 |
| Prompt 控件可选 | 如存在，建议命名为 `pic_tags_prompt` |
| 备注控件不参与模型输出 | 如存在，建议命名为 `pic_tags_note` |

### 3.3 禁止或暂不支持

MVP 阶段不支持以下模板结构：

- 一个模板中有多个同级图片对象。
- 多个 `Choices` 都指向同一图片并都期望模型填充。
- 候选标签写在 `TextArea` 或外部文本里，而不是 `Choice value`。
- 依赖模型输出自由文本再 fuzzy match 到标签。
- 检测框控件，例如 `RectangleLabels`。

如果用户自定义模板违反规则，“大模型预标注”页应显示阻断性错误，不允许保存为 pic_tags 预标注配置。

## 4. 产品入口

### 4.1 项目创建 / 标注模板配置

在项目模板库新增模板：

- 名称：图片候选标签预标注
- 分组：预标注 / 图片理解
- 默认任务字段：`image`
- 默认输出控件：`pic_tags`

项目创建时用户可直接选择该模板，也可以从空白 XML 自定义。只要最终满足第 3 节规则，就能启用 pic_tags 预标注。

### 4.2 项目设置：大模型预标注

在现有“大模型预标注”页中新增任务类型：

```text
预标注类型：图片候选标签（pic_tags）
```

配置项：

| 配置项 | 说明 |
| --- | --- |
| 后端地址 | 固定为常驻 `label-studio-llm-backend`，默认来自 `LLM_ML_BACKEND_URL` |
| 厂商 | 通义千问 / OpenAI / 智谱 / MiniMax / 自定义 |
| 模型 | 必须是 vision/multimodal 模型 |
| API Key | MVP 可存 `MLBackend.extra_params`，产品化后应迁移到组织级加密存储 |
| 模板识别结果 | 展示主图片字段、主输出控件、候选标签数量 |
| 标签规则来源 | `Choice hint` + 项目 Prompt 补充 |
| Prompt 策略 | 默认使用内置 pic_tags Prompt，可追加项目级补充规则 |
| 严格模式 | 默认开启，只允许返回候选标签 |
| 未命中策略 | 返回空 choices，不写备注 |
| 交互式预标 | 可选，打开后标注页可 Shift+Enter 重新生成 |

保存后自动创建或更新一条 `MLBackend`：

```json
{
  "title": "LLM pic_tags 图片预标注",
  "url": "http://localhost:9090",
  "is_interactive": true,
  "auto_update": true,
  "extra_params": {
    "_llm_preannotation": true,
    "task_type": "pic_tags",
    "output_mode": "pic_tags_choices",
    "provider": "dashscope",
    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "model": "qwen-vl-max",
    "model_type": "vision",
    "temperature": 0.0,
    "strict_labels": true,
    "image_object_name": "image",
    "choices_from_name": "pic_tags",
    "prompt_from_name": "pic_tags_prompt",
    "use_choice_hints": true,
    "prompt_extra": "没有清晰证据时不要选择标签。"
  }
}
```

同时更新项目：

```json
{
  "show_collab_predictions": true,
  "model_version": "LLM pic_tags 图片预标注"
}
```

否则即使 Prediction 落库，标注页也可能不展示为当前预标。

## 5. 模板解析设计

Label Studio 后端或 ML 后端都可以解析模板。为了减少 ML 后端对前端配置的信任，建议两边都做：

1. 平台后端保存配置时做强校验。
2. ML 后端 `/setup` 时再校验一次，并缓存解析结果。

### 5.1 解析结果

从 Label Config 中提取：

```json
{
  "task_type": "pic_tags",
  "image": {
    "name": "image",
    "value": "$image"
  },
  "choices": {
    "from_name": "pic_tags",
    "to_name": "image",
    "choice": "multiple",
    "labels": [
      {
        "name": "烟雾",
        "description": "可见烟气、烟尘或烟雾，呈飘散、升腾或团状；一般云雾、水雾排除"
      },
      {
        "name": "火焰",
        "description": "可见明火、跳火或明显橙红燃烧光亮；一般路灯、车灯、灯牌、点状反光排除"
      }
    ]
  },
  "prompt": {
    "from_name": "pic_tags_prompt",
    "required": false
  }
}
```

### 5.2 标签来源

标签名：

```text
Choice.value
```

标签说明优先级：

1. `Choice.hint`
2. 未来扩展的 `Choice.description`
3. 项目大模型预标注配置中的标签说明表
4. 无说明，仅使用标签名

这解决 `pic_tags_` 原项目中“烟雾[说明...] 被当成完整标签名”的问题。

## 6. ML Backend 适配设计

现有 `label-studio-llm-backend` 增加一个专用分支：

```python
if self.extra_params.get("task_type") == "pic_tags":
    return self._predict_pic_tags(tasks, context)
```

### 6.1 输入

Label Studio 调 `/predict` 时请求结构保持原生协议：

```json
{
  "tasks": [
    {
      "id": 123,
      "data": {
        "image": "data:image/jpeg;base64,..."
      },
      "project": 9
    }
  ],
  "label_config": "<View>...</View>",
  "params": {
    "context": null,
    "inline_media_base64": true
  }
}
```

### 6.2 Prompt

默认 Prompt：

```text
判断图片中是否出现下列候选标签。只有存在清晰可见证据时才选择；模糊、疑似、遮挡严重、无法确认时不要选择。

候选标签：
1. 烟雾：可见烟气、烟尘或烟雾，呈飘散、升腾或团状；一般云雾、水雾排除
2. 火焰：可见明火、跳火或明显橙红燃烧光亮；一般路灯、车灯、灯牌、点状反光排除

输出要求：
- 只能输出 JSON
- tags 只能包含候选标签 name
- 没有命中时输出 {"tags":[]}

JSON 格式：
{"tags":["标签名"]}
```

交互式场景下，如果用户填写 `pic_tags_prompt`，作为补充规则拼接：

```text
用户补充规则：
{interactive_prompt}
```

不允许用户交互 Prompt 覆盖 JSON 输出要求和候选标签白名单。

### 6.3 模型调用

沿用 OpenAI Compatible 多模态调用：

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "pic_tags prompt"},
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
  ]
}
```

模型参数：

| 参数 | 建议 |
| --- | --- |
| `temperature` | `0.0` 或 `0.1` |
| `num_responses` | `1` |
| `model_type` | `vision` |
| `timeout` | 按项目 MLBackend timeout |

### 6.4 模型输出解析

解析规则应复用 `pic_tags_` 的严谨策略：

1. 支持纯 JSON。
2. 支持包裹在 ```json 代码块中的 JSON。
3. 支持从文本中提取第一个 JSON object。
4. 必须存在 `tags` 字段。
5. `tags` 必须是数组。
6. 只保留候选标签白名单中的精确标签。
7. 去重，保持候选标签顺序或模型顺序，建议保持候选标签顺序。
8. 解析失败应返回 failed prediction 或空 result + 错误 meta，不应 fuzzy match。

### 6.5 Prediction 输出

命中标签时：

```json
{
  "results": [
    {
      "result": [
        {
          "from_name": "pic_tags",
          "to_name": "image",
          "type": "choices",
          "value": {
            "choices": ["烟雾", "火焰"]
          }
        }
      ],
      "score": 0.1,
      "model_version": "qwen-vl-max/pic-tags/v1"
    }
  ]
}
```

未命中时：

```json
{
  "results": [
    {
      "result": [],
      "score": 0.1,
      "model_version": "qwen-vl-max/pic-tags/v1"
    }
  ]
}
```

模型调用失败时：

```json
{
  "results": [
    {
      "result": [],
      "score": 0,
      "model_version": "qwen-vl-max/pic-tags/v1",
      "meta": {
        "error": "模型调用失败，已重试 3 次: HTTP 429"
      }
    }
  ]
}
```

注意：当前 Label Studio 原生落库只读取 `result`、`score`、`model_version`。如果要保存 `meta.error` 到 `FailedPrediction` 或 `PredictionMeta`，需要额外改造 Label Studio 后端。

## 7. Label Studio 后端联动改造

### 7.1 保存大模型预标注配置

当前前端已能创建 `MLBackend`，但产品化还需补：

1. 保存前调用后端模板校验 API。
2. 自动设置 `task_type=pic_tags`、`output_mode=pic_tags_choices`。
3. 自动写入解析到的 `image_object_name`、`choices_from_name`。
4. 自动开启 `show_collab_predictions`。
5. 设置 `project.model_version` 指向当前 LLM pic_tags 后端。

### 7.2 Data Manager 获取预测

当前 Label Studio 默认 `evaluate_predictions()` 只取项目第一个 MLBackend。产品化需要改成：

```python
evaluate_predictions(tasks, backend_id=None, task_type=None)
```

Data Manager 操作弹窗增加：

```text
预测来源：
  - LLM pic_tags 图片预标注
  - 其他 ML Backend
```

默认优先选择：

```python
MLBackend.extra_params._llm_preannotation == true
and MLBackend.extra_params.task_type == "pic_tags"
```

如果项目只有一个 MLBackend，则保持原行为。

### 7.3 标注页展示

确保：

- `project.show_collab_predictions = true`
- `project.model_version` 与生成 Prediction 的 `model_version` 或 MLBackend title 对齐
- 或使用当前系统已有的 `ml_backend_in_model_version` 逻辑，让 `project.model_version` 等于 MLBackend title

否则预测可能已落库，但标注页不作为当前预标展示。

### 7.4 自动预标新导入任务

如果要支持“导入后自动预标”，使用项目字段：

```text
evaluate_predictions_automatically
```

但建议 MVP 先不默认开启，避免导入大批量图片后立即触发昂贵 VLM 调用。

产品上提供开关：

```text
自动为新导入图片生成预标注：关闭 / 开启
```

开启时需要项目级限流和后台任务队列，否则请求容易阻塞。

## 8. 前端产品设计

### 8.1 大模型预标注页新增 pic_tags 模式

页面分区：

1. 模板兼容性
2. 模型连接
3. 候选标签预览
4. 判定规则
5. 运行策略
6. 测试请求

#### 模板兼容性

展示：

```text
主图片字段：image -> $image
输出控件：pic_tags
候选标签：5 个
交互式 Prompt：pic_tags_prompt
人工备注：pic_tags_note
```

不兼容时：

```text
当前模板无法启用图片候选标签预标注：
- 未找到 choice="multiple" 的 Choices 控件
- Choices.toName 未指向 Image
- Choice value 为空
```

#### 候选标签预览

表格：

| 标签名 | 判定说明 | 来源 |
| --- | --- | --- |
| 烟雾 | 可见烟气、烟尘... | Choice.hint |
| 火焰 | 可见明火... | Choice.hint |

#### 判定规则

内置基础规则只读展示：

```text
只有清晰证据才标注；模糊或疑似不标；只能从候选标签中选择。
```

项目可追加规则：

```text
例如：监控画面中远处小面积烟雾也需要标注；玻璃反光不算火焰。
```

#### 测试请求

选择一条样本任务，显示：

- 请求图片预览
- 模型原始 JSON
- 解析后标签
- 将写入的 Prediction result

## 9. 后端接口建议

### 9.1 模板检测 API

```http
POST /api/projects/{id}/llm-preannotation/analyze-template
```

响应：

```json
{
  "compatible": true,
  "task_type": "pic_tags",
  "image_object": {
    "name": "image",
    "value": "$image"
  },
  "choices_control": {
    "from_name": "pic_tags",
    "to_name": "image",
    "choice": "multiple"
  },
  "labels": [
    {"name": "烟雾", "description": "..."},
    {"name": "火焰", "description": "..."}
  ],
  "optional_controls": {
    "prompt": "pic_tags_prompt",
    "note": "pic_tags_note"
  },
  "errors": [],
  "warnings": []
}
```

### 9.2 保存配置 API

可以先继续复用 `/api/ml`，但产品化建议新增薄封装：

```http
PUT /api/projects/{id}/llm-preannotation/pic-tags
```

请求：

```json
{
  "backend_url": "http://localhost:9090",
  "provider": "dashscope",
  "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "model": "qwen-vl-max",
  "api_key": "***",
  "temperature": 0,
  "prompt_extra": "没有清晰证据时不要选择标签。",
  "is_interactive": true,
  "auto_predict_on_import": false
}
```

后端负责：

- 校验模板。
- upsert MLBackend。
- 更新项目预标展示字段。
- 不把 UI 复杂逻辑散落在前端。

### 9.3 批量获取预测 API

MVP 可以继续使用 Data Manager action。

产品化建议支持：

```http
POST /api/projects/{id}/predictions/retrieve
```

请求：

```json
{
  "backend_id": 12,
  "selectedItems": {
    "all": false,
    "included": [101, 102]
  }
}
```

## 10. 与 pic_tags_ 原项目能力的对应关系

| pic_tags_ 能力 | 产品化落点 |
| --- | --- |
| `/tag` 单图接口 | MLBackend `/predict` 内部逻辑 |
| `tags_category` 字符串 | 从 Label Config `<Choice value>` 自动提取 |
| 标签说明 | 从 `Choice hint` 或项目配置提取 |
| base64 图片校验 | Label Studio 后端内联图片 + ML 后端校验 data URL |
| VLM JSON 输出解析 | ML 后端 `pic_tags` parser |
| 白名单过滤 | ML 后端只保留模板中的 Choice value |
| 未命中候选标签 | 返回空 `result` |
| S3 批处理 | 后续变成平台 ModelRun / 后台任务，不再由用户跑脚本 |
| checkpoint 续跑 | 后续由平台任务队列和 ModelRun 状态承载 |

## 11. MVP 改造清单

### 11.1 标注模板

- 新增 `pic_tags_候选标签预标注模板.xml` 到模板库。
- 模板库中展示为“图片候选标签预标注”。
- 创建项目时支持用户修改候选标签。

### 11.2 Label Studio 后端

- 新增模板分析函数：识别主 Image + 主 Choices + Choice labels/hints。
- 新增配置保存 API 或增强现有 MLBackend 保存逻辑。
- 保存 LLM pic_tags 配置时自动设置项目预标展示字段。
- Data Manager 获取预测支持指定 backend，至少优先选择 `_llm_preannotation=true` 的 pic_tags 后端。

### 11.3 label-studio-llm-backend

- 新增 `task_type=pic_tags` 分支。
- 新增 Label Config 解析和缓存。
- 新增 pic_tags Prompt 构造。
- 新增 JSON 输出解析。
- 新增 choices prediction result 构造。
- 禁用当前通用 `_match_choices()` fuzzy 行为在 pic_tags 场景中的使用。

### 11.4 前端

- 大模型预标注页增加“图片候选标签”模式。
- 展示模板兼容性和候选标签预览。
- 保存时不让用户手填 `choices_from_name` 等内部字段。
- 测试请求展示“原始模型输出”和“写入 Prediction 的结果”。
- Data Manager 获取预测弹窗可选择 LLM pic_tags 后端。

## 12. Phase 2 改造清单

- 组织级模型 Provider，加密保存 API Key。
- 后台异步 ModelRun，显示总数、成功、失败、费用。
- FailedPrediction / PredictionMeta 记录模型错误、token、耗时。
- 自动预标新导入任务。
- 支持 S3 大批量数据集的后台队列续跑。
- 支持每个标签的启用/停用、标签说明版本化。
- 支持置信度或 evidence 字段，但不直接展示为标注结果。

## 13. 关键产品原则

1. 用户可以自定义模板，但必须满足“一个图片对象 + 一个主 Choices 输出”的合同。
2. 候选标签来自模板，不来自 Prompt 文本。
3. Prompt 只能补充判定规则，不能改变输出格式。
4. 模型输出必须是结构化 JSON，不能依赖 fuzzy match。
5. Prediction 结果必须是 Label Studio 原生 result，而不是 `pic_tags_` 自定义 JSONL。
6. 大批量执行必须逐步迁移到平台任务队列，不能让用户运行脚本。

## 14. 推荐实施顺序

1. 接入 XML 模板并完成模板分析 API。
2. 改造 ML 后端 `task_type=pic_tags`，先跑通单任务测试请求。
3. 保存配置时自动 upsert MLBackend 和项目预标展示字段。
4. Data Manager 获取预测指定 LLM pic_tags 后端。
5. 标注页验证 Prediction 预勾选展示。
6. 加入批量任务进度和失败记录。

做到第 5 步，即可形成产品级 MVP 闭环。
