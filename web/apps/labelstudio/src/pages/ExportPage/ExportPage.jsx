import { useEffect, useRef, useState, useCallback } from "react";
import { useHistory } from "react-router";
import { Button } from "@humansignal/ui";
import {
  IconWarningCircleFilled,
  IconTerminal,
  IconCode,
  IconBook,
  IconExternal,
  IconCopyOutline,
} from "@humansignal/icons";
import { Form, Input } from "../../components/Form";
import { Modal } from "../../components/Modal/Modal";
import { Space } from "../../components/Space/Space";
import { useAPI } from "../../providers/ApiProvider";
import { useFixedLocation, useParams } from "../../providers/RoutesProvider";
import { cn } from "../../utils/bem";
import { isDefined, copyText } from "../../utils/helpers";
import "./ExportPage.scss";

// Community Edition exports run synchronously in a single HTTP request.
// Large exports can exceed typical proxy timeouts, so we warn early and link to alternatives.
const LARGE_EXPORT_TASK_THRESHOLD = 1000;
const EXPORT_TIMEOUT_DOCS_URL = "https://labelstud.io/guide/export.html#Export-timeout-in-Community-Edition";
const EXPORT_CONSOLE_DOCS_URL = "https://labelstud.io/guide/export.html#Export-using-console-command";
const EXPORT_SNAPSHOT_SDK_URL = "https://api.labelstud.io/api-reference/api-reference/projects/exports/create";
const ENTERPRISE_URL = "https://docs.humansignal.com/guide/label_studio_compare";

const EXPORT_TAG_ZH = {
  "sequence labeling": "序列标注",
  "text tagging": "文本标注",
  "named entity recognition": "命名实体识别",
  "image segmentation": "图像分割",
  "object detection": "目标检测",
  keypoints: "关键点",
  "speech recognition": "语音识别",
  "brush annotations": "画笔标注",
};

const EXPORT_FORMAT_ZH = {
  JSON: {
    title: "JSON",
    description:
      "以 Label Studio 通用 JSON 格式导出，单个文件包含任务数据与标注结果，适合备份或二次处理。",
  },
  JSON_MIN: {
    title: "JSON-MIN",
    description: "仅导出标注结果（精简 JSON），不包含完整任务数据。",
  },
  CSV: {
    title: "CSV",
    description: "以逗号分隔的表格格式导出，列名由标注配置中的 from_name / to_name 决定。",
  },
  TSV: {
    title: "TSV",
    description: "以制表符分隔的表格格式导出，列名由标注配置中的 from_name / to_name 决定。",
  },
  CONLL2003: {
    title: "CONLL2003",
    description: "CoNLL-2003 命名实体识别挑战赛常用的文本标注格式。",
    tags: ["sequence labeling", "text tagging", "named entity recognition"],
  },
  COCO: {
    title: "COCO",
    description: "COCO 数据集常用的目标检测与图像分割格式，支持多边形与矩形框。",
    tags: ["image segmentation", "object detection", "keypoints"],
  },
  COCO_WITH_IMAGES: {
    title: "COCO（含图片）",
    description: "COCO 格式，并同时下载原始图片文件。",
    tags: ["image segmentation", "object detection", "keypoints"],
  },
  VOC: {
    title: "Pascal VOC XML",
    description: "Pascal VOC 常用的 XML 格式，适用于目标检测与多边形分割任务。",
    tags: ["image segmentation", "object detection"],
  },
  YOLO: {
    title: "YOLO",
    description:
      "为每张图片生成对应的 TXT 标注文件，包含类别、坐标、宽高等信息，适用于 YOLO 训练。",
    tags: ["image segmentation", "object detection", "keypoints"],
  },
  YOLO_WITH_IMAGES: {
    title: "YOLO（含图片）",
    description: "YOLO 标注格式，并同时下载原始图片文件。",
    tags: ["image segmentation", "object detection", "keypoints"],
  },
  YOLO_OBB: {
    title: "YOLOv8 OBB",
    description:
      "YOLO 旋转框（OBB）格式，用四个角点坐标表示框，坐标归一化到 0–1，可导出旋转目标。",
    tags: ["image segmentation", "object detection"],
  },
  YOLO_OBB_WITH_IMAGES: {
    title: "YOLOv8 OBB（含图片）",
    description: "YOLOv8 OBB 格式，并同时下载原始图片文件。",
    tags: ["image segmentation", "object detection"],
  },
  BRUSH_TO_NUMPY: {
    title: "画笔标注转 NumPy",
    description: "将画笔分割标注导出为 NumPy 二维数组，每个标签输出一张图像。",
    tags: ["image segmentation"],
  },
  BRUSH_TO_PNG: {
    title: "画笔标注转 PNG",
    description: "将画笔分割标注导出为 PNG 图像，每个标签输出一张图片。",
    tags: ["image segmentation"],
  },
  BRUSH_TO_COCO: {
    title: "画笔标注转 COCO",
    description: "将画笔分割标注导出为 COCO 格式，RLE 掩码会转换为多边形。",
    tags: ["image segmentation", "brush annotations"],
  },
  ASR_MANIFEST: {
    title: "ASR Manifest",
    description: "将语音转写标注导出为 NVIDIA NeMo 等 ASR 模型使用的 JSON Manifest 格式。",
    tags: ["speech recognition"],
  },
};

const localizeExportTag = (tag) => EXPORT_TAG_ZH[tag] ?? tag;

const localizeExportFormat = (format) => {
  const locale = EXPORT_FORMAT_ZH[format.name];

  if (!locale) return format;

  return {
    ...format,
    title: locale.title ?? format.title,
    description: locale.description ?? format.description,
    tags: locale.tags?.map(localizeExportTag) ?? format.tags?.map(localizeExportTag),
  };
};

const parseContentDispositionFilename = (disposition) => {
  if (!disposition) return null;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);

  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = disposition.match(/filename="([^"]+)"/i);

  if (quotedMatch?.[1]) return quotedMatch[1];

  const plainMatch = disposition.match(/filename=([^;]+)/i);

  if (plainMatch?.[1]) return plainMatch[1].trim().replace(/^"|"$/g, "");

  return null;
};

const getDefaultExportFilename = (projectId, exportType) => {
  const type = (exportType || "JSON").toUpperCase();
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  if (type === "JSON") return `project-${projectId}-export-${timestamp}.json`;
  if (type === "CSV") return `project-${projectId}-export-${timestamp}.csv`;

  return `project-${projectId}-export-${timestamp}.zip`;
};

const resolveExportFilename = (response, projectId, exportType) => {
  return (
    response.headers.get("filename") ||
    parseContentDispositionFilename(response.headers.get("content-disposition")) ||
    getDefaultExportFilename(projectId, exportType)
  );
};

const downloadFile = (blob, filename) => {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);

  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
};

const wait = () => new Promise((resolve) => setTimeout(resolve, 5000));

const isTimeoutLikeStatus = (status) => status === 408 || status === 502 || status === 504;

export const ExportPage = () => {
  const history = useHistory();
  const location = useFixedLocation();
  const pageParams = useParams();
  const api = useAPI();

  const [previousExports, setPreviousExports] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadingMessage, setDownloadingMessage] = useState(false);
  const [availableFormats, setAvailableFormats] = useState([]);
  const [currentFormat, setCurrentFormat] = useState("JSON");
  const [projectTaskNumber, setProjectTaskNumber] = useState(null);
  const [exportIssue, setExportIssue] = useState(null);
  const [exportError, setExportError] = useState(null);

  /** @type {import('react').RefObject<Form>} */
  const form = useRef();

  const proceedExport = async () => {
    setExportIssue(null);
    setExportError(null);
    setDownloading(true);

    const messageTimer = window.setTimeout(() => {
      setDownloadingMessage(true);
    }, 1000);

    try {
      const params = form.current.assembleFormData({
        asJSON: true,
        full: true,
        booleansAsNumbers: true,
      });

      const response = await api.callApi("exportRaw", {
        params: {
          pk: pageParams.id,
          ...params,
        },
      });

      // The API proxy can return `null` for certain network errors; treat it as timeout-like
      // and show actionable guidance instead of a generic error.
      if (!response) {
        setExportIssue("timeout");
        return;
      }

      if (response.ok) {
        const blob = await response.blob();

        if (!blob.size) {
          setExportError("导出结果为空，请确认任务已提交标注后再试。");
          return;
        }

        downloadFile(blob, resolveExportFilename(response, pageParams.id, currentFormat));
        return;
      }

      if (isTimeoutLikeStatus(response.status)) {
        setExportIssue("timeout");
        return;
      }

      api.handleError(response);
    } finally {
      window.clearTimeout(messageTimer);
      setDownloading(false);
      setDownloadingMessage(false);
    }
  };

  useEffect(() => {
    if (isDefined(pageParams.id)) {
      let cancelled = false;

      api
        .callApi("previousExports", {
          params: {
            pk: pageParams.id,
          },
        })
        .then(({ export_files }) => {
          if (!cancelled) setPreviousExports(export_files.slice(0, 1));
        });

      api
        .callApi("exportFormats", {
          params: {
            pk: pageParams.id,
          },
        })
        .then((formats) => {
          if (cancelled) return;
          const localizedFormats = formats.map(localizeExportFormat);

          setAvailableFormats(localizedFormats);
          setCurrentFormat(localizedFormats[0]?.name);
        });

      // Fetch project metadata to show a proactive warning for large exports.
      // This is best-effort and should not trigger global error UI if it fails.
      api
        .callApi("project", {
          params: { pk: pageParams.id },
          errorFilter: () => true,
        })
        .then((project) => {
          if (cancelled) return;
          setProjectTaskNumber(project?.task_number ?? null);
        });

      return () => {
        cancelled = true;
      };
    }
  }, [pageParams.id]);

  return (
    <Modal
      onHide={() => {
        const path = location.pathname.replace(ExportPage.path, "");
        const search = location.search;

        history.replace(`${path}${search !== "?" ? search : ""}`);
      }}
      title="导出数据"
      style={{ width: 720 }}
      closeOnClickOutside={false}
      allowClose={!downloading}
      // footer="Read more about supported export formats in the Documentation."
      visible
    >
      <div className={cn("export-page").toClassName()}>
        <FormatInfo
          availableFormats={availableFormats}
          selected={currentFormat}
          onClick={(format) => setCurrentFormat(format.name)}
        />

        <ExportLargeProjectWarning taskCount={projectTaskNumber} />
        {exportError && <div className={cn("export-page").elem("warning").toClassName()}>{exportError}</div>}
        {exportIssue === "timeout" && <ExportTimeoutGuidance projectId={pageParams.id} exportType={currentFormat} />}

        <Form ref={form}>
          <Input type="hidden" name="exportType" value={currentFormat} />
        </Form>

        <div className={cn("export-page").elem("footer").toClassName()}>
          {downloadingMessage && (
            <div className={cn("export-page").elem("status-message").toClassName()}>
              正在准备导出文件，可能需要较长时间，请耐心等待。
            </div>
          )}
          <div className={cn("export-page").elem("actions").toClassName()}>
            <Button className="w-[135px]" onClick={proceedExport} waiting={downloading} aria-label="导出数据">
              导出
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const FormatInfo = ({ availableFormats, selected, onClick }) => {
  return (
    <div className={cn("formats").toClassName()}>
      <div className={cn("formats").elem("info").toClassName()}>
        可选择以下格式导出数据集：
      </div>
      <div className={cn("formats").elem("list").toClassName()}>
        {availableFormats.map((format) => (
          <div
            key={format.name}
            className={cn("formats")
              .elem("item")
              .mod({
                active: !format.disabled,
                selected: format.name === selected,
              })
              .toClassName()}
            onClick={!format.disabled ? () => onClick(format) : null}
          >
            <div className={cn("formats").elem("name").toClassName()}>
              {format.title}

              <Space size="small">
                {format.tags?.map?.((tag, index) => (
                  <div key={index} className={cn("formats").elem("tag").toClassName()}>
                    {tag}
                  </div>
                ))}
              </Space>
            </div>

            {format.description && (
              <div className={cn("formats").elem("description").toClassName()}>{format.description}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

ExportPage.path = "/export";
ExportPage.modal = true;

const ExportLargeProjectWarning = ({ taskCount }) => {
  if (!Number.isFinite(taskCount) || taskCount < LARGE_EXPORT_TASK_THRESHOLD) return null;

  return (
    <div className={cn("export-page").elem("warning").toClassName()}>
      <div className={cn("export-page").elem("warning-title").toClassName()}>
        检测到大型项目（共 {taskCount.toLocaleString()} 条任务）
      </div>
      <div className={cn("export-page").elem("warning-body").toClassName()}>
        社区版在界面中同步导出大型数据集可能超时，建议使用{" "}
        <a className="no-go" href={EXPORT_TIMEOUT_DOCS_URL} target="_blank" rel="noreferrer">
          CLI/SDK 导出
        </a>{" "}
        ，或考虑{" "}
        <a className="no-go" href={ENTERPRISE_URL} target="_blank" rel="noreferrer">
          企业版
        </a>{" "}
        进行后台异步导出。
      </div>
    </div>
  );
};

const ExportTimeoutGuidance = ({ projectId, exportType }) => {
  const cliCommand = `label-studio export ${projectId} ${exportType} --export-path=<output-path>`;
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copyText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [cliCommand]);

  return (
    <div className={cn("export-page").elem("timeout").toClassName()}>
      <div className={cn("export-page").elem("timeout-header").toClassName()}>
        <IconWarningCircleFilled className={cn("export-page").elem("timeout-icon").toClassName()} />
        <div className={cn("export-page").elem("timeout-title").toClassName()}>导出超时</div>
      </div>
      <div className={cn("export-page").elem("timeout-body").toClassName()}>
        社区版在界面中采用同步导出，大型数据集可能超过反向代理的常见超时限制（通常约 90 秒）。
      </div>

      <div className={cn("export-page").elem("timeout-actions").toClassName()}>
        <div className={cn("export-page").elem("timeout-actions-title").toClassName()}>建议方案：</div>
        <ul className={cn("export-page").elem("timeout-actions-list").toClassName()}>
          <li>
            <div className={cn("export-page").elem("timeout-action-item").toClassName()}>
              <IconTerminal className={cn("export-page").elem("timeout-action-icon").toClassName()} />
              <div className={cn("export-page").elem("timeout-action-content").toClassName()}>
                <span>
                  使用{" "}
                  <a className="no-go" href={EXPORT_CONSOLE_DOCS_URL} target="_blank" rel="noreferrer">
                    命令行
                    <IconExternal className={cn("export-page").elem("timeout-link-icon").toClassName()} />
                  </a>{" "}
                  导出：
                </span>
                <div className={cn("export-page").elem("timeout-code-wrapper").toClassName()}>
                  <pre className={cn("export-page").elem("timeout-code").toClassName()}>
                    <code>{cliCommand}</code>
                  </pre>
                  <button
                    type="button"
                    className={cn("export-page").elem("timeout-copy-button").toClassName()}
                    onClick={handleCopy}
                    aria-label="复制命令"
                    title={copied ? "已复制" : "复制命令"}
                  >
                    <IconCopyOutline className={cn("export-page").elem("timeout-copy-icon").toClassName()} />
                    {copied && (
                      <span className={cn("export-page").elem("timeout-copy-text").toClassName()}>已复制</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </li>
          <li>
            <div className={cn("export-page").elem("timeout-action-item").toClassName()}>
              <IconCode className={cn("export-page").elem("timeout-action-icon").toClassName()} />
              <div className={cn("export-page").elem("timeout-action-content").toClassName()}>
                通过{" "}
                <a className="no-go" href={EXPORT_SNAPSHOT_SDK_URL} target="_blank" rel="noreferrer">
                  SDK 创建导出快照
                  <IconExternal className={cn("export-page").elem("timeout-link-icon").toClassName()} />
                </a>
                ，无需依赖单次界面请求即可完成下载。
              </div>
            </div>
          </li>
          <li>
            <div className={cn("export-page").elem("timeout-action-item").toClassName()}>
              <IconWarningCircleFilled className={cn("export-page").elem("timeout-action-icon").toClassName()} />
              <div className={cn("export-page").elem("timeout-action-content").toClassName()}>
                若需在界面中大规模导出，可考虑{" "}
                <a className="no-go" href={ENTERPRISE_URL} target="_blank" rel="noreferrer">
                  Label Studio 企业版
                  <IconExternal className={cn("export-page").elem("timeout-link-icon").toClassName()} />
                </a>
                ，支持大型项目与异步后台导出。
              </div>
            </div>
          </li>
        </ul>
        <div className={cn("export-page").elem("timeout-footer").toClassName()}>
          <IconBook className={cn("export-page").elem("timeout-footer-icon").toClassName()} />
          <span>
            更多说明请参阅文档：{" "}
            <a className="no-go" href={EXPORT_TIMEOUT_DOCS_URL} target="_blank" rel="noreferrer">
              社区版导出超时说明
              <IconExternal className={cn("export-page").elem("timeout-link-icon").toClassName()} />
            </a>
          </span>
        </div>
      </div>
    </div>
  );
};
