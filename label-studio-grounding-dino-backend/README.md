# Label Studio Grounding DINO 视觉预标注后端

独立部署的 Grounding DINO ML Backend，供 Label Studio 项目进行开放词表目标检测预标注。

- 默认服务地址：`http://localhost:9092`
- Label Studio 对接地址：`http://localhost:9092`
- 产品设计说明：[`doc_预标注/Grounding-DINO视觉预标注后端-产品设计.md`](../doc_预标注/Grounding-DINO视觉预标注后端-产品设计.md)

## 能力

- 文本 Prompt 驱动的零样本目标检测
- 可从标注模板 `RectangleLabels` 自动生成 Prompt，模板和预标注目标联动
- 输出 Label Studio `RectangleLabels` 预测结果
- 支持交互式 Auto-annotation：在标注页输入 prompt 后即时生成候选框
- 支持项目级阈值：`box_threshold` / `text_threshold`
- 支持 Docker 独立部署、GPU 部署、健康检查和数据缓存挂载
- 兼容 Label Studio `/setup` 传入 dict `extra_params` 的缓存行为

## 快速启动（Docker）

```bash
cd label-studio-grounding-dino-backend
cp .env.example .env
docker compose up -d --build
```

健康检查：

```bash
curl http://localhost:9092/health
```

首次构建会下载 GroundingDINO 仓库和预训练权重，耗时较长。生产环境建议把构建好的镜像推到私有镜像仓库。

## 与 Label Studio 联调

1. 启动 Label Studio。
2. 启动本服务。
3. 使用下面的标注配置创建图片目标检测项目。
4. 打开项目设置 → **视觉预标注**。
5. 填写 Grounding DINO 后端地址：`http://localhost:9092`。
6. 检查标签与检测词映射，保存配置。
7. 数据管理页点击获取预测，或在标注页开启 Auto-annotation。

最小可跑通模板如下。这个模板不需要手动输入 prompt，服务会读取 `RectangleLabels` 下的标签并自动生成 prompt：

```xml
<View>
  <Image name="image" value="$image"/>

  <RectangleLabels name="label" toName="image">
    <Label value="人员" predicted_values="person,people,human" background="#2D9CDB"/>
    <Label value="安全帽" predicted_values="helmet,hard hat" background="#F2994A"/>
    <Label value="车辆" predicted_values="vehicle,car,truck" background="#27AE60"/>
  </RectangleLabels>
</View>
```

自动 prompt 生成规则：

- 优先使用每个 `<Label>` 的第一个 `predicted_values`，例如 `人员 -> person`。
- 没有 `predicted_values` 时使用 `Label value`。
- 最终生成类似 `person, helmet, vehicle` 的 prompt。

`predicted_values` 同时用于把 GroundingDINO 返回的英文 phrase 映射到项目里的业务标签。若不配置，服务会尝试按标签名大小写匹配；仍无法匹配时，会退回第一个 `RectangleLabels` 标签。

如果需要在标注页临时改 prompt，可以加上可选的交互式输入区。手动输入优先级最高：

```xml
<View className="prompt">
  <Header value="临时指定要检测的目标"/>
  <TextArea name="prompt" toName="image" editable="true" rows="2" maxSubmissions="1" showSubmitButton="true"/>
</View>
```

如果需要调参，可以加上可选阈值控件：

```xml
<View>
  <Header value="检测阈值"/>
  <Number name="box_threshold" toName="image" min="0" max="1" step="0.01" defaultValue="0.30"/>
  <Number name="text_threshold" toName="image" min="0" max="1" step="0.01" defaultValue="0.25"/>
</View>
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GROUNDING_DINO_BACKEND_PORT` | `9092` | 宿主机暴露端口 |
| `LABEL_STUDIO_URL` | 空 | Label Studio 地址，用于拉取受保护图片 |
| `LABEL_STUDIO_API_KEY` | 空 | Label Studio API Token |
| `GROUNDINGDINO_REPO_PATH` | `/GroundingDINO` | 容器内 GroundingDINO 仓库路径 |
| `GROUNDING_DINO_CONFIG` | `GroundingDINO_SwinT_OGC.py` | 模型配置文件 |
| `GROUNDING_DINO_WEIGHTS` | `groundingdino_swint_ogc.pth` | 权重文件 |
| `AUTO_PROMPT_FROM_LABELS` | `1` | `DEFAULT_PROMPT` 为空时，是否从标注模板自动生成 prompt |
| `DEFAULT_PROMPT` | 空 | 未在界面输入 prompt 时的默认 prompt |
| `BOX_THRESHOLD` | `0.30` | 默认框置信度阈值 |
| `TEXT_THRESHOLD` | `0.25` | 默认文本匹配阈值 |

## GPU

安装 NVIDIA Container Toolkit 后，取消 `docker-compose.yml` 中 GPU 配置注释：

```yaml
environment:
  - NVIDIA_VISIBLE_DEVICES=all
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

## 本地开发（无 Docker）

```bash
cd label-studio-grounding-dino-backend
python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r requirements.txt
git clone https://github.com/IDEA-Research/GroundingDINO.git
pip install -e GroundingDINO
# 下载权重到 GroundingDINO/weights/
python _wsgi.py --port 9092
```

## 目录结构

```text
label-studio-grounding-dino-backend/
  dino.py              # Grounding DINO 推理与 Label Studio 结果映射
  _wsgi.py            # Flask/Gunicorn 入口 + extra_params 兼容补丁
  Dockerfile
  docker-compose.yml
  requirements.txt
  .env.example
  data/server/        # ML Backend 缓存、模型状态与 SQLite CACHE
```
