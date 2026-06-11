# Label Studio LLM 预标注后端

独立部署的大模型 ML Backend，供 Label Studio 二开平台「大模型预标注」功能使用。

- 常驻服务地址：`http://localhost:9090`（与前端 `LLMPreannotationSettings` 默认一致）
- 对接页面：`/embed/projects/<id>/settings/llm-preannotation`
- 产品设计说明：[`doc_预标注/大模型预标注集成-产品设计.md`](../doc_预标注/大模型预标注集成-产品设计.md)

## 能力

- 多厂商 OpenAI 兼容：通义千问、DeepSeek、智谱、MiniMax、OpenAI、Azure、Ollama、自定义
- 项目级配置通过 `extra_params` 下发（provider / model / prompt / api_key / temperature 等）
- 文本预标 + 多模态视觉预标（`model_type=vision`）
- 交互式标注（`is_interactive`）
- 修复 `/setup` 时 `extra_params` 必须为 JSON 字符串的缓存问题

## 快速启动（Docker）

```bash
cd label-studio-llm-backend
cp .env.example .env
docker compose up -d --build
```

健康检查：

```bash
curl http://localhost:9090/health
```

## 与 Label Studio 联调

1. 启动本服务（端口 9090）
2. 打开项目 → 设置 → **大模型预标注**
3. 选择厂商、填写 API Key 与 Prompt，保存
4. 数据管理 → 获取预测，或标注页交互式生成

## 本地开发（无 Docker）

```bash
cd label-studio-llm-backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -e ../label-studio-ml-backend
pip install -r requirements.txt
python _wsgi.py --port 9090
```

## 目录结构

```
label-studio-llm-backend/
  model.py          # LLM 推理与 Label Config 映射
  _wsgi.py          # Gunicorn 入口 + extra_params 兼容补丁
  Dockerfile
  docker-compose.yml
  requirements.txt
  data/server/      # 模型缓存与 SQLite CACHE
```
