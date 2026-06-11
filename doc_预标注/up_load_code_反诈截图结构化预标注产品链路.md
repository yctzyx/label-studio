# up_load_code 反诈截图结构化预标注产品链路

## 1. 目标

`up_load_code` 当前是一套独立脚本/服务：

1. 扫描本地新增截图。
2. 调用视觉大模型做初筛。
3. 对可疑截图做结构化打标。
4. 将可疑图片和 JSONL 结果归档上传到 S3/Ceph。

本次整理的目标不是继续维护独立批处理脚本，而是把它改造成和 `pic_tags_` 类似的产品化预标注案例：

1. 用户在 Label Studio 创建“反诈截图结构化审核”项目。
2. 用户配置标注模板。
3. 用户在“大模型预标注”页选择视觉模型、Prompt 模板和输出模式。
4. 用户在数据管理中点击“获取预测结果”。
5. Label Studio 调用常驻 `label-studio-llm-backend`。
6. ML 后端调用多模态模型，解析结构化 JSON。
7. ML 后端返回标准 Label Studio Prediction。
8. 标注员打开任务后看到预填充的分类和文本字段，人工复核修正。

## 2. 当前脚本能力梳理

### 2.1 核心文件

| 文件 | 作用 |
| --- | --- |
| `vl_tag.py` | 核心大模型调用，包含初筛 Prompt 和详细打标 Prompt |
| `tag_api.py` | 批量并发打标函数，输入 base64 图片列表，输出结构化结果 |
| `service.py` | FastAPI 服务，暴露 `/api/v1/tag` |
| `main.py` | 离线批处理：扫描新增图片、打标、归档、生成 JSONL、上传 |
| `uploader.py` | S3/Ceph 上传 |
| `config.py` | 本地路径、S3、模型 API 配置 |

### 2.2 输入

脚本接口输入：

```json
{
  "images": [
    {
      "data_type": "image",
      "id": "test_img_001",
      "data": "base64..."
    }
  ],
  "max_concurrent": 5
}
```

产品化后建议 Label Studio 任务数据：

```json
{
  "image": "https://example.com/screenshot.png",
  "source_image": "2026-06-03/images/a.png"
}
```

如果图片地址外部模型不可访问，ML 后端应将图片转为 `data:image/...;base64,...` 后发送给模型。

### 2.3 输出

脚本当前输出：

```json
{
  "status": 0,
  "result": [
    {
      "id": "test_img_001",
      "is_suspicious": 1,
      "tag_result": "{\"core_illegal_info\": ...}",
      "error": null
    }
  ],
  "message": "success"
}
```

其中 `tag_result` 是 JSON 字符串，主要包含：

- `core_illegal_info.main_illegal_types`
- `core_illegal_info.fraud_types`
- `core_illegal_info.key_fraud_phrases`
- `core_illegal_info.enticement_phrases`
- `financial_info.payment_accounts`
- `financial_info.recharge_buttons`
- `contact_tracking_info.customer_contacts`
- `contact_tracking_info.app_download`
- `contact_tracking_info.website_domain`
- `critical_notes.anti_detection_hints`
- `critical_notes.salient_anomalies`

## 3. 场景定义

这是“反诈网页截图结构化审核”场景，不是简单图片多标签分类。

核心特点：

- 输入对象：网页截图、APP 截图、落地页截图、引流页截图。
- 输出对象：分类标签 + 多个结构化文本字段。
- 模型需要先判断是否可疑。
- 只有可疑截图才需要填充结构化字段。
- 文本字段必须尽量引用截图原文，不能编造。
- 预标注结果必须能被 Label Studio 原生标注页展示并人工修正。

因此它和 `pic_tags_` 的差异是：

| 对比项 | `pic_tags_` | `up_load_code` |
| --- | --- | --- |
| 主要输出 | `Choices` 多选标签 | `Choices` + 多个 `TextArea` |
| 是否需要结构化 JSON | 简单 `{"tags":[]}` | 复杂嵌套 JSON |
| 是否有初筛 | 无 | 有，可疑/非可疑 |
| 是否要求原文引用 | 不强制 | 强制 |
| 后端解析模式 | `choices_json` | 建议新增 `anti_fraud_json` |

## 4. 推荐标注模板

模板文件：

[up_load_code_反诈截图结构化预标注模板.xml](./up_load_code_反诈截图结构化预标注模板.xml)

核心结构：

```xml
<Image name="image" value="$image"/>

<Choices name="main_illegal_types" toName="image" choice="multiple">
  <Choice value="赌博"/>
  <Choice value="诈骗"/>
  <Choice value="色情"/>
  <Choice value="毒品"/>
  <Choice value="网址分发"/>
  <Choice value="其他违法"/>
</Choices>

<Choices name="fraud_types" toName="image" choice="multiple">
  <Choice value="刷单"/>
  <Choice value="贷款"/>
  <Choice value="杀猪盘"/>
  <Choice value="投资"/>
  <Choice value="冒充"/>
  <Choice value="中奖"/>
  <Choice value="虚假购物"/>
  <Choice value="ETC"/>
  <Choice value="其他"/>
</Choices>

<TextArea name="payment_accounts" toName="image"/>
<TextArea name="customer_contacts" toName="image"/>
<TextArea name="app_download" toName="image"/>
<TextArea name="website_domain" toName="image"/>
<TextArea name="raw_json" toName="image"/>
```

### 4.1 用户可自定义范围

允许用户自定义：

- `Image value` 对应任务字段，如 `$image`、`$url`。
- `main_illegal_types` 的候选项。
- `fraud_types` 的候选项。
- 是否保留 `raw_json` 调试字段。
- 是否增加人工复核字段，例如“处置建议”“风险等级”“备注”。
- 页面布局和帮助文案。

建议限制：

- `Image name` 默认固定为 `image`，避免后端解析复杂化。
- 主分类控件名建议固定：`main_illegal_types`、`fraud_types`。
- 文本控件名建议固定，便于 ML 后端把 JSON 字段稳定映射到 Label Studio result。
- 分类 `Choice value` 只放短标签，不要放长说明。

## 5. 产品链路设计

### 5.1 创建项目

用户选择模板：

```text
模板名称：反诈截图结构化预标注
任务类型：anti_fraud_screenshot
输入字段：image
输出字段：违法类型、诈骗类型、关键话术、资金账户、联系方式、APP 下载、域名、反侦查提示
```

项目创建后，Label Studio 保存 XML 模板，任务数据只需要包含图片字段。

### 5.2 大模型预标注配置

配置页建议展示：

| 字段 | 说明 |
| --- | --- |
| 厂商 | OpenAI 兼容多模态模型厂商 |
| 模型 | 支持 vision 的模型 |
| 模型类型 | 多模态（图文） |
| Prompt 模板 | 反诈截图结构化抽取 |
| 输出模式 | `anti_fraud_json` |
| 严格标签 | 开启，只允许分类字段返回候选项 |
| 初筛策略 | 开启，非可疑截图返回空 result 或仅写入 raw_json |
| 原文引用要求 | 开启 |
| Temperature | 建议 `0` 到 `0.2` |

保存到 `MLBackend.extra_params` 的建议结构：

```json
{
  "_llm_preannotation": true,
  "task_type": "anti_fraud_screenshot",
  "output_mode": "anti_fraud_json",
  "provider": "minimax",
  "model": "MiniMax-M3",
  "model_type": "vision",
  "temperature": 0.1,
  "image_object_name": "image",
  "main_illegal_types_from_name": "main_illegal_types",
  "fraud_types_from_name": "fraud_types",
  "strict_labels": true,
  "enable_suspicious_gate": true,
  "raw_json_to_name": "raw_json",
  "prompt_template_id": "anti_fraud_screenshot"
}
```

### 5.3 数据管理获取预测

用户在数据管理中选择任务，点击：

```text
操作 -> 获取预测结果
```

前端应展示“预标注进度”，后端调用：

```text
Project.ml_backend.predict_tasks(tasks)
```

产品化要求：

- 优先选择 `_llm_preannotation=true` 且 `task_type=anti_fraud_screenshot` 的 ML Backend。
- 预标注任务进入后台运行。
- 前端可查看“预标注进度”。
- 完成后刷新任务列表中的 `Predictions` 数量。

## 6. 推荐 Prompt 模板

### 6.1 Prompt

```text
你是一名专业反诈审核员。请分析图片中的网页/APP 截图，判断是否存在黄赌毒、诈骗、网址分发、非法引流等风险，并抽取可用于人工复核和处置的关键线索。

候选违法类型：
{main_illegal_types}

候选诈骗类型：
{fraud_types}

判定规则：
1. 只能从候选违法类型和候选诈骗类型中选择，不能输出候选列表之外的分类。
2. 只有截图中存在清晰、可见、可确认的证据时才选择分类。
3. 模糊、疑似、遮挡严重、画面太小、无法确认时不要选择对应分类。
4. 资金账户、联系方式、诈骗话术、诱导承诺必须尽量引用截图原文。
5. 不允许引用示例内容，不允许编造截图中不存在的信息。
6. 无法确认的信息不要输出；疑似但有一定证据的信息在字符串末尾标注 [疑似]。
7. 如果图片整体不涉诈、不涉黄赌毒、不涉非法引流，输出 {"is_suspicious": 0, "reason": "非涉诈图片"}。

输出要求：
只输出 JSON，不要解释，不要 Markdown，不要代码块。

JSON 格式：
{
  "is_suspicious": 1,
  "core_illegal_info": {
    "main_illegal_types": ["诈骗"],
    "fraud_types": ["投资"],
    "key_fraud_phrases": ["截图中的原文1"],
    "enticement_phrases": ["截图中的原文2"]
  },
  "financial_info": {
    "payment_accounts": ["银行卡/微信/支付宝/虚拟币等收款信息原文；没有则填未提供"],
    "recharge_buttons": "充值/支付入口描述"
  },
  "contact_tracking_info": {
    "customer_contacts": ["QQ/微信/Telegram/邮箱/二维码等联系方式原文；没有则填未提供"],
    "app_download": {
      "app_name": "APP 名称；没有则填未提供",
      "download_link": "下载链接",
      "qrcode_desc": "二维码位置描述"
    },
    "website_domain": {
      "visible_url": "截图中可见 URL",
      "core_domain": "核心域名",
      "promo_name": "站点/产品/推广名称"
    }
  },
  "critical_notes": {
    "anti_detection_hints": ["地址更新、防失联、浏览器限制、备用网址等原文"],
    "salient_anomalies": "其他异常特征"
  }
}
```

### 6.2 为什么不沿用脚本中的两段 Prompt

`vl_tag.py` 当前采用两步：

1. `PROMPT_CHECK`：返回 `Y/N`。
2. `PROMPT_TAG`：返回结构化 JSON。

产品化后可以保留两步，也可以合并为一次。建议 MVP 合并为一次：

- 减少每张图片模型调用次数。
- 非可疑图直接返回 `is_suspicious=0`。
- 可疑图返回结构化字段。

如果后续成本压力大，再恢复两段式：

- 第一步小模型低成本初筛。
- 第二步强视觉模型详细抽取。

## 7. ML 后端解析设计

### 7.1 新增输出模式

现有 `choices_json` 只能处理：

```json
{"tags": ["标签1", "标签2"]}
```

`up_load_code` 需要新增：

```text
output_mode = anti_fraud_json
```

入口逻辑：

```python
if self.extra_params.get("output_mode") == "anti_fraud_json":
    return self._predict_anti_fraud_json(tasks, context)
```

### 7.2 模板解析

ML 后端需要从 Label Config 中识别：

| Label Studio 控件 | JSON 字段 |
| --- | --- |
| `Choices name="main_illegal_types"` | `core_illegal_info.main_illegal_types` |
| `Choices name="fraud_types"` | `core_illegal_info.fraud_types` |
| `TextArea name="key_fraud_phrases"` | `core_illegal_info.key_fraud_phrases` |
| `TextArea name="enticement_phrases"` | `core_illegal_info.enticement_phrases` |
| `TextArea name="payment_accounts"` | `financial_info.payment_accounts` |
| `TextArea name="recharge_buttons"` | `financial_info.recharge_buttons` |
| `TextArea name="customer_contacts"` | `contact_tracking_info.customer_contacts` |
| `TextArea name="app_download"` | `contact_tracking_info.app_download` |
| `TextArea name="website_domain"` | `contact_tracking_info.website_domain` |
| `TextArea name="anti_detection_hints"` | `critical_notes.anti_detection_hints` |
| `TextArea name="salient_anomalies"` | `critical_notes.salient_anomalies` |
| `TextArea name="raw_json"` | 完整模型 JSON |

### 7.3 解析规则

1. 模型返回必须解析为 JSON object。
2. 支持去除 ```json 代码块。
3. `is_suspicious=0` 时，默认返回空 `result`，也可写入 `raw_json` 便于抽检。
4. `main_illegal_types` 只保留模板候选标签中的值。
5. `fraud_types` 只保留模板候选标签中的值。
6. 文本数组字段转为多行文本。
7. 对象字段如 `app_download`、`website_domain` 转为多行 `key：value` 文本。
8. 解析失败时返回 failed prediction 或写入 `raw_json`，不要 silently drop。

### 7.4 Prediction 结果示例

命中风险时：

```json
{
  "result": [
    {
      "from_name": "main_illegal_types",
      "to_name": "image",
      "type": "choices",
      "value": {
        "choices": ["网址分发", "诈骗"]
      }
    },
    {
      "from_name": "fraud_types",
      "to_name": "image",
      "type": "choices",
      "value": {
        "choices": ["投资"]
      }
    },
    {
      "from_name": "payment_accounts",
      "to_name": "image",
      "type": "textarea",
      "value": {
        "text": ["银行卡 - 户名：李四 账号：621700****5678"]
      }
    }
  ],
  "model_version": "LLM 大模型预标注",
  "score": 0.1
}
```

非可疑时：

```json
{
  "result": [],
  "model_version": "LLM 大模型预标注",
  "score": 0.1
}
```

## 8. 与现有脚本的迁移关系

### 8.1 保留能力

应保留：

- 多模态模型识图能力。
- 可疑/非可疑判断。
- 违法类型和诈骗类型分类。
- 资金账户、联系方式、APP 下载、域名、反侦查提示抽取。
- 并发处理能力。
- JSON 严格输出约束。

### 8.2 下沉到平台的能力

应迁移到 Label Studio / ML Backend：

- Prompt 配置。
- 模型厂商配置。
- 标注模板配置。
- 批量获取预测。
- 预测进度。
- 预测结果落库。
- 人工复核与修正。

### 8.3 不建议继续保留在脚本里的能力

产品链路中不应依赖：

- 本地固定路径扫描。
- 本地移动图片。
- JSONL 文件作为主结果载体。
- S3/Ceph 作为预标注结果唯一入口。
- 硬编码模型 API Key 和 S3 密钥。

S3/Ceph 仍可作为数据源或归档通道，但预标注结果应以 Label Studio `Prediction` 为准。

## 9. 安全与配置问题

`config.py` 当前包含明文 API Key、S3 Access Key、Secret Key 和内网服务地址。产品化必须改造为：

- 环境变量注入。
- 平台密文存储。
- 前端只显示“已保存”，不回显密钥。
- 后端日志不得打印完整 base64 图片、API Key、Secret Key。
- Prompt 和模型返回可按需记录，但要支持脱敏。

建议配置项：

```text
LLM_PROVIDER
LLM_BASE_URL
LLM_API_KEY
LLM_MODEL
S3_ENDPOINT
S3_ACCESS_KEY
S3_SECRET_KEY
S3_BUCKET
```

## 10. 产品页面建议

### 10.1 大模型预标注页

新增内置模板：

```text
反诈截图结构化抽取
```

选择后自动填充：

- `output_mode=anti_fraud_json`
- `model_type=vision`
- 推荐 Prompt
- `temperature=0.1`
- 严格标签开启

页面展示模板解析结果：

```text
主图片字段：image -> $image
违法类型：6 个候选项
诈骗类型：9 个候选项
结构化文本字段：9 个
调试字段：raw_json
```

### 10.2 数据管理页

复用当前产品化链路：

- “获取预测结果”触发批量预标注。
- 弹窗展示“预标注进度”。
- 支持后台运行。
- 工具栏“预标注进度”可查看当前或最近一次任务。

### 10.3 标注页

标注员看到：

- 截图。
- 预勾选违法类型。
- 预勾选诈骗类型。
- 预填充关键话术、账户、联系方式、域名等文本。
- 可人工删除、补充、修正。

## 11. 验收标准

### 11.1 模板验收

- 项目能正常创建。
- 图片能正常展示。
- `main_illegal_types` 和 `fraud_types` 能展示候选项。
- 文本字段能展示并允许人工编辑。
- 预标注结果能落入对应控件。

### 11.2 ML 后端验收

- 能识别 `output_mode=anti_fraud_json`。
- 能读取项目 Label Config 中的候选标签。
- 能调用视觉模型。
- 能解析模型 JSON。
- 分类字段严格过滤候选项。
- 文本字段能按行写入 `TextArea`。
- 非可疑图片返回空 prediction。
- 解析失败有可见错误或写入 `raw_json`。

### 11.3 产品链路验收

- 大模型预标注配置能保存和回填。
- 数据管理点击“获取预测结果”后有进度弹窗。
- 支持后台运行和再次查看进度。
- 完成后任务列表 `Predictions` 数量更新。
- 打开标注页能看到预标结果。
- 人工修改后能提交为正式标注。

## 12. MVP 改造清单

### 12.1 Label Studio 模板库

- 新增 `up_load_code_反诈截图结构化预标注模板.xml`。
- 模板名称：“反诈截图结构化预标注”。
- 默认任务字段：`image`。

### 12.2 大模型预标注配置页

- Prompt 模板新增“反诈截图结构化抽取”。
- 保存 `prompt_template_id=anti_fraud_screenshot`。
- 保存 `output_mode=anti_fraud_json`。
- 模板分析展示分类控件和文本控件映射。

### 12.3 label-studio-llm-backend

- 新增 `_predict_anti_fraud_json()`。
- 新增结构化 JSON 解析器。
- 新增 `Choices` + `TextArea` 混合结果构造。
- 对 base64 日志截断。
- 对分类候选项做严格白名单过滤。

### 12.4 Label Studio 后端

- 获取预测时优先选择 `_llm_preannotation=true` 的后端。
- 支持预标注进度状态。
- 后续可扩展为真正异步任务和百分比进度。

### 12.5 前端 Data Manager

- 已有“获取预测结果”入口可复用。
- 增加“预标注进度”弹窗和后台运行。
- 完成后刷新任务列表。

## 13. 结论

`up_load_code` 适合沉淀为平台内第二个预标注案例：

```text
图片候选标签预标注：Image + Choices
反诈截图结构化预标注：Image + Choices + TextArea
```

它能补齐平台预标注能力的一个关键场景：不是只做标签选择，而是把大模型抽取出的复杂结构化线索落到 Label Studio 原生控件中，让人工在统一标注工作台完成复核和修正。
