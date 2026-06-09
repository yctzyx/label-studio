# 预标注 Backend 示例梳理（全量）

本文基于 `label-studio-ml-backend` 的官方示例目录与 README 总表整理，目标是快速回答：

- 全部 backend 示例有哪些（含 `llm_interactive`）
- 各示例主要支持哪些标注类型（Labeling Config 方向）

## 说明

- “支持标注类型”是按示例主要用途归纳（实际可随你的 Label Config 扩展）
- “预标注/交互/训练”优先参考官方总表；总表未覆盖的示例按各自 README 说明标注

---

## 1) 文本分类 / 文本生成 / 对话类

- `bert_classifier`
  - 任务方向：文本分类（BERT）
  - 常见标注类型：`<Choices toName="text">`
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ✅
- `sklearn_text_classifier`
  - 任务方向：文本分类（scikit-learn）
  - 常见标注类型：`<Choices toName="text">`
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ✅
- `huggingface_llm`
  - 任务方向：LLM 文本生成
  - 常见标注类型：`<TextArea>` 输出文本，或配 `<Choices>` 做分类映射
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ❌
- `llm_interactive`
  - 任务方向：交互式 LLM 标注（Prompt 驱动）
  - 常见标注类型：`<TextArea>`（prompt）+ `<Choices>`（分类）或 `<TextArea>`（生成响应）
  - 模式：预标注 ✅ / 交互 ✅ / 训练 ✅
  - 备注：原生更偏分类/文本输出，不是开箱即用的 NER span（`<Labels toName="text">`）后端
- `langchain_search_agent`
  - 任务方向：RAG + 搜索增强问答
  - 常见标注类型：`<TextArea>`（prompt/response），可搭配 `<Choices>`
  - 模式：预标注 ✅ / 交互 ✅ / 训练 ✅
- `watsonx_llm`
  - 任务方向：WatsonX LLM 推理/生成
  - 常见标注类型：`<TextArea>`（prompt/response），可搭配 `<Choices>`
  - 模式：预标注 ✅ / 交互 ✅ / 训练 ❌

---

## 2) NER / 关键词匹配类

- `flair`
  - 任务方向：NER（Flair）
  - 常见标注类型：`<Labels toName="text">`（实体跨度）
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ❌
- `huggingface_ner`
  - 任务方向：NER（Hugging Face）
  - 常见标注类型：`<Labels toName="text">`（实体跨度）
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ✅
- `spacy`
  - 任务方向：NER（spaCy）
  - 常见标注类型：`<Labels toName="text">`（实体跨度）
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ❌
- `gliner`
  - 任务方向：NER（GLiNER）
  - 常见标注类型：`<Labels toName="text">`（实体跨度）
  - 模式：预标注 ❌ / 交互 ✅ / 训练 ✅
- `interactive_substring_matching`
  - 任务方向：交互式关键词匹配（NER 辅助）
  - 常见标注类型：`<Labels toName="text">`（实体跨度）
  - 模式：预标注 ❌ / 交互 ✅ / 训练 ❌

---

## 3) OCR / 语音 / 音频相关

- `easyocr`
  - 任务方向：OCR（图像文本识别）
  - 常见标注类型：`<TextArea>`（转写文本）或字符集约束标签
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ❌
- `tesseract`
  - 任务方向：交互式 OCR
  - 常见标注类型：`<TextArea>`（文本）+ 图像相关对象标签
  - 模式：预标注 ❌ / 交互 ✅ / 训练 ❌
- `nemo_asr`
  - 任务方向：语音转写（ASR）
  - 常见标注类型：`<Audio>` + `<TextArea>`
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ❌
- `deepgram`
  - 任务方向：文本转语音（TTS，交互式）
  - 常见标注类型：`<TextArea>` 输入文本 + `<Audio>` 输出音频
  - 模式：预标注（批量）不主推 / 交互 ✅ / 训练 ❌

---

## 4) 目标检测 / 分割 / 视频追踪

- `mmdetection-3`
  - 任务方向：目标检测
  - 常见标注类型：`<RectangleLabels toName="image">`
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ❌
- `yolo`
  - 任务方向：YOLO 全系列视觉任务（检测/分割等）
  - 常见标注类型：`<RectangleLabels>`、`<PolygonLabels>`、`<BrushLabels>`（随任务）
  - 模式：预标注 ✅ / 交互 ❌ / 训练 ❌
- `grounding_dino`
  - 任务方向：提示词驱动检测
  - 常见标注类型：`<RectangleLabels toName="image">`
  - 模式：预标注 ❌ / 交互 ✅ / 训练 ❌
- `grounding_sam`
  - 任务方向：提示词检测 + 分割
  - 常见标注类型：`<RectangleLabels>` + 分割类标签（如 `<BrushLabels>`/`<PolygonLabels>`）
  - 模式：预标注 ❌ / 交互 ✅ / 训练 ❌
- `segment_anything_model`
  - 任务方向：SAM 图像分割（交互）
  - 常见标注类型：`<BrushLabels>`/`<PolygonLabels>`（配图像对象）
  - 模式：预标注 ❌ / 交互 ✅ / 训练 ❌
- `segment_anything_2_image`
  - 任务方向：SAM2 图像交互分割
  - 常见标注类型：`<KeyPointLabels>` / `<RectangleLabels>` 输入，输出 `<BrushLabels>`
  - 模式：预标注 ❌ / 交互 ✅ / 训练 ❌
- `segment_anything_2_video`
  - 任务方向：SAM2 视频目标跟踪
  - 常见标注类型：`<Video>` + `<VideoRectangle>` + `<Labels>`
  - 模式：预标注（自动批量）不主推 / 交互 ✅ / 训练 ❌

---

## 5) 时序数据

- `timeseries_segmenter`
  - 任务方向：时间序列分段
  - 常见标注类型：Time Series 相关对象 + 标签（分段/类别）
  - 模式：预标注 ✅ / 交互 ✅ / 训练 ✅

---

## 快速选型建议（按你要做的预标注）

- 文本分类：`bert_classifier` / `sklearn_text_classifier`
- NER（实体抽取）：`huggingface_ner` / `spacy` / `flair`（交互式可选 `gliner`）
- 图像检测：`mmdetection-3` / `yolo`
- 图像分割：`segment_anything_model` / `segment_anything_2_image`
- 视频追踪：`segment_anything_2_video`
- 语音转写：`nemo_asr`
- LLM 生成/交互类：`llm_interactive` / `huggingface_llm` / `langchain_search_agent` / `watsonx_llm`

> 如果你的目标是“实体抽取 + 直接落 `<Labels toName="text">`”，优先使用 NER 专用示例；`llm_interactive` 需二次开发输出格式后再用于该场景。

