/**
 * 大模型预标注 - 厂商预设
 *
 * 这些预设用于在「大模型预标注」配置页中快速填充 Base URL 与常用模型。
 * 千问 / DeepSeek / 智谱 / MiniMax 等国内厂商均兼容 OpenAI Chat Completions 协议，
 * 因此统一通过 base_url + api_key 走 OpenAI 兼容客户端（见 ML 后端 llm_interactive/model.py）。
 *
 * provider 字段会原样写入 MLBackend.extra_params.provider，由 ML 后端据此选择调用方式。
 */

export const MODEL_CAPABILITY = {
  TEXT: "text",
  VISION: "vision",
};

export const LLM_PROVIDERS = [
  {
    value: "dashscope",
    label: "通义千问（DashScope）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    baseUrlEditable: true,
    apiKeyRequired: true,
    docs: "https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope",
    models: [
      { value: "qwen-plus", label: "qwen-plus（文本）", capability: MODEL_CAPABILITY.TEXT },
      { value: "qwen-turbo", label: "qwen-turbo（文本/快速）", capability: MODEL_CAPABILITY.TEXT },
      { value: "qwen-max", label: "qwen-max（文本/高质量）", capability: MODEL_CAPABILITY.TEXT },
      { value: "qwen-vl-plus", label: "qwen-vl-plus（多模态）", capability: MODEL_CAPABILITY.VISION },
      { value: "qwen-vl-max", label: "qwen-vl-max（多模态）", capability: MODEL_CAPABILITY.VISION },
    ],
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    baseUrlEditable: true,
    apiKeyRequired: true,
    docs: "https://api-docs.deepseek.com/",
    models: [
      { value: "deepseek-chat", label: "deepseek-chat（文本）", capability: MODEL_CAPABILITY.TEXT },
      { value: "deepseek-reasoner", label: "deepseek-reasoner（推理）", capability: MODEL_CAPABILITY.TEXT },
    ],
  },
  {
    value: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    baseUrlEditable: true,
    apiKeyRequired: true,
    docs: "https://open.bigmodel.cn/dev/api",
    models: [
      { value: "glm-4", label: "glm-4（文本）", capability: MODEL_CAPABILITY.TEXT },
      { value: "glm-4-flash", label: "glm-4-flash（文本/快速）", capability: MODEL_CAPABILITY.TEXT },
      { value: "glm-4v", label: "glm-4v（多模态）", capability: MODEL_CAPABILITY.VISION },
    ],
  },
  {
    value: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    baseUrlEditable: true,
    apiKeyRequired: true,
    docs: "https://platform.minimaxi.com/docs/api-reference/text-openai-api",
    models: [
      { value: "MiniMax-M3", label: "MiniMax-M3（多模态/长上下文）", capability: MODEL_CAPABILITY.VISION },
      { value: "MiniMax-M2.5", label: "MiniMax-M2.5（文本）", capability: MODEL_CAPABILITY.TEXT },
      {
        value: "MiniMax-M2.5-highspeed",
        label: "MiniMax-M2.5-highspeed（文本/快速）",
        capability: MODEL_CAPABILITY.TEXT,
      },
      { value: "M2-her", label: "M2-her（对话）", capability: MODEL_CAPABILITY.TEXT },
    ],
  },
  {
    value: "openai",
    label: "OpenAI",
    baseUrl: "",
    baseUrlEditable: true,
    apiKeyRequired: true,
    docs: "https://platform.openai.com/docs/api-reference",
    models: [
      { value: "gpt-4o", label: "gpt-4o（多模态）", capability: MODEL_CAPABILITY.VISION },
      { value: "gpt-4o-mini", label: "gpt-4o-mini（多模态/经济）", capability: MODEL_CAPABILITY.VISION },
      { value: "gpt-4-turbo", label: "gpt-4-turbo（文本）", capability: MODEL_CAPABILITY.TEXT },
    ],
  },
  {
    value: "azure",
    label: "Azure OpenAI",
    baseUrl: "",
    baseUrlEditable: false,
    apiKeyRequired: true,
    requiresAzureFields: true,
    docs: "https://learn.microsoft.com/azure/ai-services/openai/",
    models: [],
  },
  {
    value: "ollama",
    label: "Ollama / 本地",
    baseUrl: "http://localhost:11434/v1",
    baseUrlEditable: true,
    apiKeyRequired: false,
    docs: "https://ollama.com/",
    models: [
      { value: "qwen2.5", label: "qwen2.5", capability: MODEL_CAPABILITY.TEXT },
      { value: "llama3.1", label: "llama3.1", capability: MODEL_CAPABILITY.TEXT },
    ],
  },
  {
    value: "custom",
    label: "自定义（OpenAI 兼容）",
    baseUrl: "",
    baseUrlEditable: true,
    apiKeyRequired: false,
    docs: "",
    models: [],
  },
];

export const DEFAULT_PROVIDER = LLM_PROVIDERS[0].value;

export const getProvider = (value) => LLM_PROVIDERS.find((p) => p.value === value) ?? LLM_PROVIDERS[0];

export const PIC_TAGS_PROMPT =
  '请判断图片中是否清晰出现以下候选标签。\n\n候选标签：\n{labels}\n\n判定规则：\n1. 只能从候选标签中选择，不能输出候选列表之外的标签。\n2. 只有图片中存在清晰、可见、可确认的证据时才选择标签。\n3. 模糊、疑似、遮挡严重、画面太小、无法确认时不要选择。\n4. 可以选择多个标签。\n5. 如果没有任何候选标签命中，输出空 JSON：{{"tags": []}}。\n\n输出要求：\n只输出 JSON，不要解释，不要 Markdown，不要代码块。\n\nJSON 格式必须为：\n{{"tags": ["标签1", "标签2"]}}';

export const ANTI_FRAUD_SCREENSHOT_PROMPT =
  '你是一名专业反诈审核员。请分析图片中的网页/APP 截图，判断是否存在黄赌毒、诈骗、网址分发、非法引流等风险，并抽取可用于人工复核和处置的关键线索。\n\n候选违法类型：\n{main_illegal_types}\n\n候选诈骗类型：\n{fraud_types}\n\n判定规则：\n1. 只能从候选违法类型和候选诈骗类型中选择，不能输出候选列表之外的分类。\n2. 只有截图中存在清晰、可见、可确认的证据时才选择分类。\n3. 模糊、疑似、遮挡严重、画面太小、无法确认时不要选择对应分类。\n4. 资金账户、联系方式、诈骗话术、诱导承诺必须尽量引用截图原文。\n5. 不允许引用示例内容，不允许编造截图中不存在的信息。\n6. 无法确认的信息不要输出；疑似但有一定证据的信息在字符串末尾标注 [疑似]。\n7. 如果图片整体不涉诈、不涉黄赌毒、不涉非法引流，输出 {{"is_suspicious": 0, "reason": "非涉诈图片"}}。\n\n输出要求：\n只输出 JSON，不要解释，不要 Markdown，不要代码块。\n\nJSON 格式：\n{{\n  "is_suspicious": 1,\n  "core_illegal_info": {{\n    "main_illegal_types": ["诈骗"],\n    "fraud_types": ["投资"],\n    "key_fraud_phrases": ["截图中的原文1"],\n    "enticement_phrases": ["截图中的原文2"]\n  }},\n  "financial_info": {{\n    "payment_accounts": ["银行卡/微信/支付宝/虚拟币等收款信息原文；没有则填未提供"],\n    "recharge_buttons": "充值/支付入口描述"\n  }},\n  "contact_tracking_info": {{\n    "customer_contacts": ["QQ/微信/Telegram/邮箱/二维码等联系方式原文；没有则填未提供"],\n    "app_download": {{\n      "app_name": "APP 名称；没有则填未提供",\n      "download_link": "下载链接",\n      "qrcode_desc": "二维码位置描述"\n    }},\n    "website_domain": {{\n      "visible_url": "截图中可见 URL",\n      "core_domain": "核心域名",\n      "promo_name": "站点/产品/推广名称"\n    }}\n  }},\n  "critical_notes": {{\n    "anti_detection_hints": ["地址更新、防失联、浏览器限制、备用网址等原文"],\n    "salient_anomalies": "其他异常特征"\n  }}\n}}';

/**
 * 内置 Prompt 模板库（按任务类型），用户可一键填入后自行修改。
 * {text}=主文本对象字段，{labels}=Label Config 中的标签列表，{image_url}=图像地址。
 */
export const PROMPT_TEMPLATES = [
  {
    value: "pic_tags",
    label: "图片候选标签（JSON 多选）",
    capability: MODEL_CAPABILITY.VISION,
    outputMode: "choices_json",
    taskType: "pic_tags",
    prompt: PIC_TAGS_PROMPT,
  },
  {
    value: "anti_fraud_screenshot",
    label: "反诈截图结构化抽取",
    capability: MODEL_CAPABILITY.VISION,
    outputMode: "anti_fraud_json",
    taskType: "anti_fraud_screenshot",
    prompt: ANTI_FRAUD_SCREENSHOT_PROMPT,
  },
  {
    value: "text_classification",
    label: "文本分类",
    capability: MODEL_CAPABILITY.TEXT,
    outputMode: "choices_json",
    prompt:
      "请根据下面的文本判断其类别，只能从以下标签中选择最合适的一个：{labels}\n\n文本：\n{text}\n\n只输出标签名称本身，不要解释、不要添加多余内容。",
  },
  {
    value: "ner_json",
    label: "实体抽取（NER，JSON 输出）",
    capability: MODEL_CAPABILITY.TEXT,
    outputMode: "ner_json",
    prompt:
      '从下列文本中抽取实体，实体类型只能是：{labels}\n请严格以 JSON 数组输出，每个元素形如 {{"start": 0, "end": 5, "label": "PER", "text": "张三"}}，不要输出额外说明。\n\n文本：\n{text}',
  },
  {
    value: "summarization",
    label: "摘要生成",
    capability: MODEL_CAPABILITY.TEXT,
    outputMode: "textarea",
    prompt: "请为下面的文本生成一段简洁、准确的中文摘要（不超过 100 字）：\n\n{text}",
  },
  {
    value: "image_caption",
    label: "图像描述（多模态）",
    capability: MODEL_CAPABILITY.VISION,
    outputMode: "textarea",
    prompt: "请用一句话客观描述这张图片的主要内容。",
  },
  {
    value: "image_classification",
    label: "图像分类（多模态）",
    capability: MODEL_CAPABILITY.VISION,
    outputMode: "choices_json",
    prompt: "请判断这张图片属于以下哪一类，只能选择一个：{labels}\n\n只输出标签名称本身。",
  },
];
