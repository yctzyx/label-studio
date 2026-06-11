# pic_tags_ 项目完整分析

## 1. 项目定位

`pic_tags_` 是一个独立的图片语义打标服务，定位为“基于视觉语言模型（VLM）的候选标签识别器”。它接收图片和候选标签，调用兼容 OpenAI Chat Completions 格式的多模态模型，让模型判断图片中是否出现候选标签，并将命中的标签以字符串形式返回。

项目同时提供两种使用方式：

| 使用方式 | 入口 | 适用场景 |
| --- | --- | --- |
| 在线 API | `python main.py api` 或 `python app.py` | 上游系统逐张提交 base64 图片，实时获取标签 |
| S3 批处理 | `python main.py batch ...` | 从 S3/TDSC/Ceph 前缀批量扫描图片，生成 JSONL 结果 |

该项目不是 Label Studio 官方 ML Backend 结构，也没有直接实现 `/predict`、`/setup` 等 Label Studio ML Backend 协议；它更像是一个可被预标注平台、任务流转平台或脚本调用的轻量图像打标后端。

## 2. 目录结构

```text
pic_tags_/
  app.py                       # Flask API 服务，提供 /tag 接口
  main.py                      # 统一 CLI 入口：api / batch run / batch status / batch scan
  config.py                    # 读取 config.toml 并转换为强类型 Settings
  config.example.toml          # 配置模板
  tagger.py                    # 核心打标逻辑：图片校验、Prompt、VLM 调用、模型输出解析
  batch_runner.py              # S3 批处理主流程
  batch_state.py               # 批处理元信息、进度、SQLite checkpoint
  s3_utils.py                  # S3/TDSC/Ceph 工具封装与命令行工具
  logging_setup.py             # 控制台 + 滚动文件日志
  requirements.txt             # pip 依赖锁定
  pyproject.toml               # uv/现代 Python 项目元信息
  uv.lock                      # uv 锁文件
  scripts/
    run_shards_serial.sh       # 串行运行多分片批处理脚本
```

项目当前没有 README，运行方式和行为需要从源码及 `config.example.toml` 推断。

## 3. 技术栈与运行环境

| 项 | 内容 |
| --- | --- |
| Python | `>=3.12` |
| Web 框架 | Flask 3.1 |
| 对象存储 | boto3，兼容 S3/Ceph/TDSC |
| 模型接口 | HTTP POST，OpenAI Chat Completions 风格，多模态 `image_url` 输入 |
| 状态存储 | 本地 JSON + SQLite |
| 日志 | Python logging + `RotatingFileHandler` |

`requirements.txt` 固定了 Flask、boto3 及其基础依赖；`pyproject.toml` 只声明了较宽松版本。实际生产部署建议优先使用 `requirements.txt` 或 `uv.lock` 保持一致性。

## 4. 配置模型

配置文件默认路径为：

```text
pic_tags_/config.toml
```

仓库仅提供 `config.example.toml`。启动前需要复制：

```bash
cp config.example.toml config.toml
```

主要配置项如下：

| 配置段 | 关键字段 | 说明 |
| --- | --- | --- |
| `[server]` | `host`, `port` | Flask API 监听地址，默认示例为 `0.0.0.0:6662` |
| `[vlm]` | `url`, `api_key`, `model`, `timeout_sec`, `max_retries`, `max_concurrent` | VLM 调用地址、鉴权、模型名、超时、重试和并发上限 |
| `[image]` | `max_mb` | 单图最大大小，代码转换为字节限制 |
| `[paths]` | `log_dir`, `log_file` | 日志输出目录和文件名 |
| `[logging]` | `level`, `max_bytes`, `backup_count` | 日志级别和滚动策略 |
| `[s3]` | `endpoint`, `access_key`, `secret_key`, `bucket`, `region` 等 | S3 连接与重试配置 |
| `[batch]` | `state_dir`, `jsonl_max_lines`, `image_extensions`, `queue_multiplier`, `jsonl_hash_buckets`, `progress_save_interval` | 批处理状态目录、输出分片、图片后缀、队列和进度保存策略 |

`config.py` 会做基础校验：

- `vlm.url`、`vlm.api_key`、`vlm.model` 不能为空。
- `vlm.max_concurrent >= 1`。
- `image.max_mb >= 1`。
- 日志目录和批处理状态目录如果是相对路径，会解析到 `pic_tags_` 项目目录下。

## 5. 在线 API 分析

### 5.1 启动方式

```bash
cd pic_tags_
python main.py api
```

或：

```bash
python app.py
```

服务使用 Flask 内置开发服务器：

```python
app.run(host=settings.server.host, port=settings.server.port, threaded=True)
```

生产环境建议改为 gunicorn、uwsgi 或容器编排托管，不建议直接暴露 Flask 内置服务器。

### 5.2 接口

接口路径：

```http
POST /tag
Content-Type: application/json
```

请求体：

```json
{
  "data_type": "image",
  "id": "image-001",
  "data": "base64字符串或data:image/jpeg;base64,...",
  "tags_category": "烟雾;火焰;吸烟行为"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `data_type` | string | 是 | 必须等于 `"image"` |
| `id` | string | 是 | 图片 ID，原样返回 |
| `data` | string | 是 | 图片 base64，允许带 data URL 前缀 |
| `tags_category` | string | 是 | 候选标签，英文分号 `;` 分隔 |

成功或业务失败都会返回 HTTP 200。请求格式错误返回 HTTP 400。

成功响应示例：

```json
{
  "status": 0,
  "result": [
    {
      "id": "image-001",
      "tags": "烟雾、火焰",
      "message": "成功"
    }
  ],
  "message": "success"
}
```

未命中候选标签：

```json
{
  "status": 0,
  "result": [
    {
      "id": "image-001",
      "tags": "",
      "message": "未识别到候选标签"
    }
  ],
  "message": "success"
}
```

单图校验失败或模型调用失败：

```json
{
  "status": 0,
  "result": [
    {
      "id": "image-001",
      "tags": "",
      "message": "图片超过大小限制（最大 10 MB）"
    }
  ],
  "message": "success"
}
```

请求级错误：

```json
{
  "status": 1,
  "result": [],
  "message": "data_type 必须为 \"image\""
}
```

### 5.3 API 行为特点

1. `status=0` 表示请求被服务正常处理，不一定表示图片命中标签。
2. 图片级错误也会包装为 `status=0`，错误写在 `result[0].message`。
3. 候选标签去重后传给模型，返回标签也会去重。
4. 返回的 `tags` 是中文顿号 `、` 拼接字符串，不是数组。
5. 模型只能从候选标签中命中，非候选标签会被过滤掉。

## 6. 核心打标逻辑

核心代码在 `tagger.py`。

### 6.1 图片校验

支持格式通过文件头判断：

| 格式 | 判断方式 |
| --- | --- |
| JPEG | `FF D8 FF` |
| PNG | PNG signature |
| GIF | `GIF87a` / `GIF89a` |
| WebP | `RIFF....WEBP` |

校验流程：

1. base64 解码。
2. 判断是否为空。
3. 判断是否超过 `image.max_mb`。
4. 判断文件头是否属于支持格式。

这种方式比只看扩展名可靠，但不会做完整图片解码，因此无法发现某些图片内容损坏问题。

### 6.2 标签解析

`tags_category` 使用英文分号分隔：

```text
标签1;标签2;标签3
```

解析规则：

- 去除首尾空白。
- 空片段忽略。
- 完全相同的标签去重。
- 不支持中文分号 `；`。
- 不解析标签说明结构，标签名中如果带说明文本，会被整体当作标签名。

脚本 `run_shards_serial.sh` 默认的标签串类似：

```text
烟雾[说明...];火焰[说明...];吸烟行为[说明...]
```

在当前实现中，`烟雾[说明...]` 会成为完整标签名，而不是“标签名=烟雾，说明=...”。这会导致模型必须原样返回带说明的完整字符串才会命中白名单。若期望输出短标签名，需要改造标签规格解析。

### 6.3 Prompt

当前 Prompt 模板：

```text
判断图中是否出现下列标签。有清晰证据才标注，模糊或疑似不标。

候选：{tags_block}

仅输出 JSON：{"tags": ["标签名"]} 或 {"tags": []}
```

特点：

- 强制模型只输出 JSON。
- 强调“清晰证据才标注”，偏保守。
- 候选标签用 `、` 拼接。
- 没有给模型提供每个标签的结构化定义，除非标签文本本身携带说明。

### 6.4 VLM 调用

请求体为 OpenAI Chat Completions 风格：

```json
{
  "model": "模型名",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "Prompt"},
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,..."
          }
        }
      ]
    }
  ]
}
```

鉴权：

```http
Authorization: Bearer <api_key>
```

重试策略：

- HTTP 429、HTTP 5xx、网络错误、超时会重试。
- HTTP 4xx 非 429、模型返回 `error`、响应格式异常、输出无法解析等会视为致命错误，不重试。
- 重试退避为 `1s, 2s, 4s...`，最大 8 秒。
- 并发由 `threading.Semaphore(settings.vlm.max_concurrent)` 控制。

### 6.5 模型输出解析

解析逻辑：

1. 如果输出被 ```json 代码块包裹，会去除代码块。
2. 优先直接 `json.loads`。
3. 如果不是纯 JSON，会尝试从文本中提取第一个 JSON object。
4. 要求 JSON 中存在 `tags` 字段且类型为列表。
5. 只保留字符串类型且精确属于候选标签白名单的标签。

优点：

- 对模型多说废话有一定容错。
- 不会让模型输出候选集以外的标签污染结果。

限制：

- 只支持精确匹配，不支持同义词、大小写归一、短标签名映射。
- 模型返回 `烟` 而候选是 `烟雾` 会被过滤。
- 如果候选标签包含说明文本，模型返回短标签名也会被过滤。

## 7. S3 批处理分析

批处理代码在 `batch_runner.py`、`batch_state.py`、`s3_utils.py`。

### 7.1 启动命令

执行或续跑：

```bash
python main.py batch run \
  --job-id job_20260610_01 \
  --input-prefix sample_fire_detection_high--样本库 \
  --output-prefix tags/sample_fire_detection_high--样本库 \
  --tags-category "烟雾;火焰;吸烟行为"
```

查看状态：

```bash
python main.py batch status --job-id job_20260610_01
```

扫描输入前缀：

```bash
python main.py batch scan --input-prefix sample_fire_detection_high--样本库
```

分片运行：

```bash
python main.py batch run \
  --job-id job_20260610_01_s0 \
  --input-prefix sample_fire_detection_high--样本库 \
  --output-prefix tags/sample_fire_detection_high--样本库 \
  --tags-category "烟雾;火焰" \
  --shard-index 0 \
  --shard-count 1000
```

### 7.2 批处理流程

整体流程：

1. 解析候选标签。
2. 初始化本地任务状态目录。
3. 流式扫描 S3 输入前缀下的对象。
4. 按扩展名过滤图片。
5. 可选按 key 区间和 shard hash 过滤。
6. 对已在 checkpoint 中处理过的 key 跳过。
7. 下载图片字节。
8. 调用 `tag_one_image`。
9. 将结果追加到 S3 JSONL 文件。
10. 将该 S3 key 写入本地 SQLite checkpoint。
11. 更新本地 `progress.json`。

流程图：

```text
S3 input_prefix
  ↓ list_objects_v2 流式分页
图片后缀过滤 + 分片过滤
  ↓
checkpoint 查重
  ↓
ThreadPoolExecutor 并发处理
  ↓
download_bytes
  ↓
图片校验 + VLM 打标
  ↓
S3 JSONL 输出
  ↓
SQLite done 表 + progress.json
```

### 7.3 分片策略

分片由 `ShardConfig` 控制：

```python
bucket = zlib.crc32(s3_key.encode("utf-8")) & 0xFFFFFFFF
bucket % shard_count == shard_index
```

特点：

- 分片由完整 S3 key 决定，稳定可复现。
- 多个分片互不重叠。
- 适合平铺大目录。
- 支持 `key_after`、`key_before` 做字典序区间过滤。

### 7.4 输出 JSONL 规则

每条记录格式：

```json
{
  "id": "relative/path/image.jpg",
  "tags": "烟雾、火焰",
  "message": "成功",
  "s3_key": "sample/input/relative/path/image.jpg",
  "tags_category": "烟雾;火焰;吸烟行为"
}
```

未命中：

```json
{
  "id": "relative/path/image.jpg",
  "tags": "",
  "message": "未识别到候选标签",
  "s3_key": "sample/input/relative/path/image.jpg",
  "tags_category": "烟雾;火焰;吸烟行为"
}
```

输出位置由 `OutputKeyAllocator` 决定。

非分片模式：

- 尽量保持输入目录结构。
- 同一源目录下图片写到同一 JSONL。
- 超过 `jsonl_max_lines` 后拆分为多个 `tags_0001.jsonl` 等文件。

分片模式：

- 使用 S3 key 的 CRC32 hash 映射到 `jsonl_hash_buckets` 个输出文件。
- 默认示例配置为 1000 个 hash bucket。
- 文件名形如 `tags_0001.jsonl` 到 `tags_1000.jsonl`。

### 7.5 状态与断点续跑

本地状态目录：

```text
pic_tags_/batch_state/<job-id>/
  meta.json
  progress.json
  checkpoint.db
```

`meta.json` 保存：

- job_id
- input_prefix
- output_prefix
- tags_category
- started_at
- status
- shard_index / shard_count
- key_after / key_before

`progress.json` 保存：

- total
- done
- failed
- skipped
- current_key
- status
- message
- started_at / updated_at

`checkpoint.db` 的 `done` 表保存：

| 字段 | 说明 |
| --- | --- |
| `s3_key` | 主键，已处理图片 |
| `output_key` | 输出 JSONL key |
| `status` | `ok` 或 `fail` |
| `message` | 处理消息 |
| `processed_at` | 处理时间 |

续跑机制：

- 使用相同 `job-id` 时会复用 checkpoint。
- 已在 `done` 表中的 `s3_key` 会跳过。
- 注意：失败记录也会写入 `done` 表，因此续跑不会自动重试失败图片。

## 8. S3 工具能力

`s3_utils.py` 可作为独立工具使用：

```bash
python s3_utils.py ping
python s3_utils.py summary <prefix>
python s3_utils.py tree <prefix> --max-depth 3
python s3_utils.py ls <prefix> -r --limit 100
python s3_utils.py upload ./a.png path/in/s3/a.png
python s3_utils.py download path/in/s3/a.png ./a.png
python s3_utils.py mkdir path/in/s3
```

关键实现点：

- 使用 path-style addressing，兼容多数 Ceph/S3 网关。
- `list_objects_v2` 分页大小为 1000。
- list 页面请求有独立重试，适合大目录。
- 默认 tree 限深、限子目录数量，避免大规模对象存储遍历过慢。
- `summary` 适合大目录摸底。

## 9. 日志

日志初始化在 `logging_setup.py`。

输出目标：

- 控制台
- `paths.log_dir / paths.log_file`

默认格式：

```text
2026-06-10 12:00:00 | INFO | batch_runner | 批处理启动 ...
```

日志文件使用滚动策略：

- `max_bytes`
- `backup_count`

`werkzeug` 日志级别被设置为 `WARNING`，减少 Flask 请求日志噪声。

## 10. 与 Label Studio 预标注体系的关系

当前 `pic_tags_` 可作为 Label Studio 预标注能力的底层服务，但还不是标准 ML Backend。

可集成方式有三类：

| 集成方式 | 说明 | 工作量 |
| --- | --- | --- |
| 前端/平台直接调用 `/tag` | 自定义预标注入口将图片转 base64 后提交 | 中 |
| 在 `label-studio-ml-backend` 中封装适配器 | ML Backend 的 `/predict` 内部调用 `pic_tags_/tagger.py` 或 HTTP `/tag` | 中高 |
| 用批处理 JSONL 结果回灌 | 先批量跑 S3，再将 JSONL 转换为 Label Studio predictions | 中 |

如果要与 Label Studio 原生“获取预测”按钮打通，推荐实现一个标准 ML Backend 适配层，而不是让 Label Studio 直接调用当前 `/tag` 协议。

## 11. 主要优点

1. 架构简单，在线接口和批处理共享同一套打标核心。
2. VLM 输出做了严格 JSON 解析和候选白名单过滤，结果可控。
3. 图片格式校验基于文件头，不依赖扩展名。
4. 批处理采用流式 S3 扫描，不需要一次性加载全部 key。
5. 支持本地 SQLite checkpoint，可以断点续跑。
6. 支持 hash 分片，适合超大规模图片集拆分处理。
7. S3 工具封装较完整，具备诊断、统计、树形查看和上传下载能力。

## 12. 主要风险与问题

### 12.1 标签说明与标签名没有结构化拆分

当前 `tags_category` 只按英文分号拆分，拆出来的整段文本就是标签名。如果传入：

```text
烟雾[可见烟气、烟尘...];火焰[可见明火...]
```

系统候选标签实际是：

```text
烟雾[可见烟气、烟尘...]
火焰[可见明火...]
```

模型如果返回：

```json
{"tags": ["烟雾"]}
```

会被白名单过滤掉，最终结果为空。

建议改为支持结构化格式：

```json
[
  {"name": "烟雾", "description": "可见烟气、烟尘或烟雾..."},
  {"name": "火焰", "description": "可见明火、跳火..."}
]
```

或兼容解析 `标签名[说明]`，Prompt 中展示说明，但白名单使用短标签名。

### 12.2 S3 JSONL 追加方式不适合大文件高频写入

`S3JsonlAppender.append_line` 的实现是：

1. 检查目标对象是否存在。
2. 如果存在，下载整个 JSONL。
3. 拼接一行。
4. 整个对象重新上传。

这会带来几个问题：

- JSONL 越大，单次追加越慢。
- 写入量呈近似二次增长。
- 大文件会产生大量网络 IO。
- 多进程或多机器并行写同一个 output key 时有覆盖风险。

当前脚本 `run_shards_serial.sh` 选择串行跑分片，就是为了避免多分片并行写同一 JSONL 的覆盖问题。

建议：

- 本地按 output key 缓冲，达到一定行数后批量上传。
- 每个 worker 或分片写独立临时文件，结束后再合并。
- 输出 key 中加入 shard id，避免跨进程写同一对象。
- 如果对象存储支持 multipart compose 或追加语义，可使用原生能力。

### 12.3 失败图片会被视为已处理

`_persist_result(..., ok=False)` 也会调用 `state.mark_done`。因此失败记录会进入 checkpoint，续跑时会跳过。

这适合“失败也要落结果”的审计型批处理，但不适合“续跑自动重试失败”的生产预标注。

建议增加：

- `batch retry-failed`
- 或 `--retry-failed`
- 或 checkpoint 中区分 done 与 failed，续跑默认仅跳过 ok。

### 12.4 API 错误语义容易误解

图片级错误返回：

```json
{"status": 0, "message": "success", "result": [{"message": "错误原因"}]}
```

这对调用方不够直观，容易只看 `status=0` 就认为全部成功。

建议：

- 保持兼容的同时增加 `result[0].success: true/false`。
- 或新增 `code` 字段区分 `no_match`、`image_error`、`model_error`。

### 12.5 Flask 内置服务不适合生产

当前 API 使用 Flask 内置 `app.run(threaded=True)`。生产环境建议：

```bash
gunicorn -w 2 -k gthread --threads 8 -b 0.0.0.0:6662 'app:create_app(load_settings())'
```

实际命令需要补一个可导入的 WSGI 入口，或新增 `wsgi.py`。

### 12.6 缺少测试

项目当前没有测试文件。核心风险点包括：

- base64/data URL 解析。
- 图片文件头识别。
- 模型输出 JSON 提取。
- tags 白名单过滤。
- S3 output key 分配。
- checkpoint 续跑语义。

建议优先补单元测试覆盖 `tagger.py` 和 `batch_runner.py` 的纯函数。

### 12.7 无 README 和部署说明

缺少：

- 快速启动。
- 配置说明。
- API 示例。
- 批处理示例。
- 结果格式。
- 常见问题。

后续可以从本文档抽出一份面向使用者的 `pic_tags_/README.md`。

## 13. 建议改进优先级

| 优先级 | 建议 | 原因 |
| --- | --- | --- |
| P0 | 修正标签名与说明的解析方式 | 当前长说明标签可能导致模型返回短标签时全部被过滤 |
| P0 | 明确 API 成功/失败语义 | 避免调用方误判 |
| P1 | 改造 S3 JSONL 写入策略 | 大规模批处理性能和并发可靠性关键 |
| P1 | 增加失败重试能力 | 批处理生产可恢复性 |
| P1 | 增加 README | 降低部署和交接成本 |
| P2 | 增加单元测试 | 防止模型输出解析和续跑逻辑回归 |
| P2 | 增加标准 Label Studio ML Backend 适配层 | 便于接入原生“获取预测”流程 |
| P2 | 增加健康检查接口 `/health` | 便于监控和服务发现 |

## 14. 推荐的标准化标签输入格式

为了同时支持“标签名”和“判定标准”，建议将 `tags_category` 从纯字符串升级为数组协议：

```json
{
  "tags_category": [
    {
      "name": "烟雾",
      "description": "可见烟气、烟尘或烟雾，呈飘散、升腾或团状；一般云雾、水雾排除"
    },
    {
      "name": "火焰",
      "description": "可见明火、跳火或明显橙红燃烧光亮；一般路灯、车灯、反光排除"
    }
  ]
}
```

Prompt 可改为：

```text
判断图中是否出现下列标签。有清晰证据才标注，模糊或疑似不标。

候选标签：
1. 烟雾：可见烟气、烟尘或烟雾，呈飘散、升腾或团状；一般云雾、水雾排除
2. 火焰：可见明火、跳火或明显橙红燃烧光亮；一般路灯、车灯、反光排除

仅输出 JSON：{"tags": ["烟雾"]} 或 {"tags": []}
```

这样既能让模型看到判定标准，又能保证输出短标签名，方便下游 Label Studio predictions 映射。

## 15. 推荐的 Label Studio 结果映射

如果用于图片分类/多标签预标注，JSONL 中：

```json
{
  "id": "a/b/001.jpg",
  "tags": "烟雾、火焰",
  "message": "成功"
}
```

可转换为 Label Studio prediction：

```json
{
  "model_version": "pic_tags_v0.1.0",
  "result": [
    {
      "from_name": "tag",
      "to_name": "image",
      "type": "choices",
      "value": {
        "choices": ["烟雾", "火焰"]
      }
    }
  ]
}
```

实际 `from_name`、`to_name`、`type` 需要与项目标注模板一致。

## 16. 典型运行手册

### 16.1 安装依赖

```bash
cd pic_tags_
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell：

```powershell
cd pic_tags_
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 16.2 准备配置

```bash
cp config.example.toml config.toml
```

修改：

- `[vlm] url/api_key/model`
- `[s3] endpoint/access_key/secret_key/bucket`
- `[image] max_mb`
- `[batch] image_extensions`

### 16.3 测试 S3

```bash
python s3_utils.py ping
python s3_utils.py summary sample_fire_detection_high--样本库 --max-objects 10000
```

### 16.4 启动 API

```bash
python main.py api
```

### 16.5 执行批处理

```bash
python main.py batch scan --input-prefix sample_fire_detection_high--样本库

python main.py batch run \
  --job-id job_20260610_01 \
  --input-prefix sample_fire_detection_high--样本库 \
  --output-prefix tags/sample_fire_detection_high--样本库 \
  --tags-category "烟雾;火焰;吸烟行为"

python main.py batch status --job-id job_20260610_01
```

### 16.6 大规模分片

使用脚本：

```bash
cd pic_tags_
WORKDIR=/app/wzn/pic_tags \
PY=/app/anaconda3/envs/pic_tags_env/bin/python \
INPUT_PREFIX='sample_fire_detection_high--样本库' \
OUTPUT_PREFIX='tags/sample_fire_detection_high--样本库' \
JOB_PREFIX='job_20260610_01' \
SHARD_COUNT=1000 \
START_SHARD=0 \
END_SHARD=999 \
bash scripts/run_shards_serial.sh
```

脚本默认后台运行，日志在：

```text
logs/batch_serial_nohup.log
logs/batch_serial_master.log
logs/batch_s<N>.log
```

## 17. 总结

`pic_tags_` 已经具备一个可运行的 VLM 图片候选标签识别闭环：在线 API、S3 批处理、断点续跑、日志和对象存储诊断都已实现。代码结构清晰，核心逻辑集中，适合继续演进为预标注平台中的图片语义标签服务。

当前最需要关注的是两个生产级问题：一是标签名和标签说明需要结构化，否则会影响命中率；二是 S3 JSONL 追加方式在大规模批处理中存在明显性能和并发风险。解决这两个问题后，再补齐 README、测试、健康检查和 Label Studio ML Backend 适配层，项目就可以更稳定地接入现有预标注体系。
