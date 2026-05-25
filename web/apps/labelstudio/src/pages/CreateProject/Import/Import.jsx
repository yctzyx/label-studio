import { ff, formatFileSize } from "@humansignal/core";
import { IconCode, IconErrorAlt, IconTrash, IconUpload } from "@humansignal/icons";
import { Badge } from "@humansignal/shad/components/ui/badge";
import { cn as scn } from "@humansignal/shad/utils";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAPI } from "../../../providers/ApiProvider";
import { cn } from "../../../utils/bem";
import { unique } from "../../../utils/helpers";
import { sampleDatasetAtom } from "../utils/atoms";
import "./Import.scss";
import { Button, CodeBlock, Select, SimpleCard, Spinner, Tooltip, Typography } from "@humansignal/ui";
import truncate from "truncate-middle";
import samples from "./samples.json";
import { importFiles } from "./utils";
import { isParentDatasetImportEnabled } from "./ParentDataset/getParentPlatformApiBase";
import { ParentDatasetPickerInline } from "./ParentDataset/ParentDatasetPickerInline";

const importClass = cn("upload_page");
const dropzoneClass = cn("dropzone");

// Constants for file display and animation
const FLASH_ANIMATION_DURATION = 2000; // 2 seconds
const FILENAME_TRUNCATE_START = 24;
const FILENAME_TRUNCATE_END = 24;

function flatten(nested) {
  return [].concat(...nested);
}

// Keep in sync with core.settings.SUPPORTED_EXTENSIONS on the BE.
const supportedExtensions = {
  text: ["txt"],
  audio: ["wav", "mp3", "flac", "m4a", "ogg"],
  video: ["mp4", "webm"],
  image: ["bmp", "gif", "jpg", "jpeg", "png", "svg", "webp"],
  html: ["html", "htm", "xml"],
  pdf: ["pdf"],
  structuredData: ["csv", "tsv", "json"],
};
const allSupportedExtensions = flatten(Object.values(supportedExtensions));

function getFileExtension(fileName) {
  if (!fileName) {
    return fileName;
  }
  return fileName.split(".").pop().toLowerCase();
}

function traverseFileTree(item, path) {
  return new Promise((resolve) => {
    path = path || "";
    if (item.isFile) {
      // Avoid hidden files
      if (item.name[0] === ".") return resolve([]);

      resolve([item]);
    } else if (item.isDirectory) {
      // Get folder contents
      const dirReader = item.createReader();
      const dirPath = `${path + item.name}/`;

      dirReader.readEntries((entries) => {
        Promise.all(entries.map((entry) => traverseFileTree(entry, dirPath)))
          .then(flatten)
          .then(resolve);
      });
    }
  });
}

function getFiles(files) {
  // @todo this can be not a files, but text or any other draggable stuff
  return new Promise((resolve) => {
    if (!files.length) return resolve([]);
    if (!files[0].webkitGetAsEntry) return resolve(files);

    // Use DataTransferItemList interface to access the file(s)
    const entries = Array.from(files).map((file) => file.webkitGetAsEntry());

    Promise.all(entries.map(traverseFileTree))
      .then(flatten)
      .then((fileEntries) => fileEntries.map((fileEntry) => new Promise((res) => fileEntry.file(res))))
      .then((filePromises) => Promise.all(filePromises))
      .then(resolve);
  });
}

const Upload = ({ children, sendFiles }) => {
  const [hovered, setHovered] = useState(false);
  const onHover = (e) => {
    e.preventDefault();
    setHovered(true);
  };
  const onLeave = setHovered.bind(null, false);
  const dropzoneRef = useRef();

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      onLeave();
      getFiles(e.dataTransfer.items).then((files) => sendFiles(files));
    },
    [onLeave, sendFiles],
  );

  return (
    <div
      id="holder"
      className={dropzoneClass.mod({ hovered })}
      ref={dropzoneRef}
      onDragStart={onHover}
      onDragOver={onHover}
      onDragLeave={onLeave}
      onDrop={onDrop}
    >
      <div className={importClass.elem("drop-surface").mod({ drag: hovered })}>{children}</div>
    </div>
  );
};

const ErrorMessage = ({ error }) => {
  if (!error) return null;
  let extra = error.validation_errors ?? error.extra;
  // support all possible responses

  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    extra = extra.non_field_errors ?? Object.values(extra);
  }
  if (Array.isArray(extra)) extra = extra.join("; ");

  return (
    <div className={importClass.elem("error")}>
      <IconErrorAlt width="24" height="24" />
      {error.id && `[${error.id}] `}
      {error.detail || error.message}
      {extra && ` (${extra})`}
    </div>
  );
};

export const ImportPage = ({
  project,
  sample,
  show = true,
  onWaiting,
  onFileListUpdate,
  onSampleDatasetSelect,
  highlightCsvHandling,
  dontCommitToProject = false,
  csvHandling,
  setCsvHandling,
  addColumns,
  openLabelingConfig,
  parentDatasetSelection,
  onParentDatasetSelect,
  onParentDatasetClear,
}) => {
  const [error, setError] = useState();
  const [parentSyncing, setParentSyncing] = useState(false);
  const [parentSyncMsg, setParentSyncMsg] = useState(null);
  const [newlyUploadedFiles, setNewlyUploadedFiles] = useState(new Set());
  const prevUploadedRef = useRef(new Set());
  const api = useAPI();
  const { t, i18n } = useTranslation();
  const isZh = i18n.language?.startsWith("zh");
  const projectConfigured = project?.label_config !== "<View></View>";
  const sampleConfig = useAtomValue(sampleDatasetAtom);

  const processFiles = (state, action) => {
    if (action.sending) {
      return { ...state, uploading: [...action.sending, ...state.uploading] };
    }
    if (action.sent) {
      return {
        ...state,
        uploading: state.uploading.filter((f) => !action.sent.includes(f)),
      };
    }
    if (action.uploaded) {
      return {
        ...state,
        uploaded: unique([...state.uploaded, ...action.uploaded], (a, b) => a.id === b.id),
      };
    }
    if (action.ids) {
      const ids = unique([...state.ids, ...action.ids]);

      onFileListUpdate?.(ids);
      return { ...state, ids };
    }
    return state;
  };

  const [files, dispatch] = useReducer(processFiles, {
    uploaded: [],
    uploading: [],
    ids: [],
  });
  /** 当前「添加数据」方式：本地上传 | 父平台 | 示例 */
  const [dataSourceTab, setDataSourceTab] = useState("local");

  const showParentRow = Boolean(parentDatasetSelection);
  const showSampleRow = Boolean(sample);

  const visibleRowCount =
    (showParentRow ? 1 : 0) + (showSampleRow ? 1 : 0) + files.uploaded.length + files.uploading.length;

  const handleParentDatasetSync = useCallback(async () => {
    if (!project?.id) return;
    setParentSyncing(true);
    setParentSyncMsg(null);
    setError(undefined);
    try {
      const res = await api.callApi("syncParentDataset", { params: { pk: project.id }, body: {} });
      const raw = res?.response ?? res;
      const created = raw?.created ?? res?.created ?? 0;
      setParentSyncMsg(t("import.parentDataset.syncDone", { count: created }));
    } catch (e) {
      setError(e);
    } finally {
      setParentSyncing(false);
    }
  }, [api, project?.id, t]);

  const loadFilesList = useCallback(
    async (file_upload_ids) => {
      const query = {};

      if (file_upload_ids) {
        // should be stringified array "[1,2]"
        query.ids = JSON.stringify(file_upload_ids);
      }
      const files = await api.callApi("fileUploads", {
        params: { pk: project.id, ...query },
      });

      dispatch({ uploaded: files ?? [] });

      if (files?.length) {
        dispatch({ ids: files.map((f) => f.id) });
      }
      return files;
    },
    [project?.id],
  );

  const onError = useCallback(
    (err) => {
      console.error(err);
      // @todo workaround for error about input size in a wrong html format
      if (typeof err === "string" && err.includes("RequestDataTooBig")) {
        const message = t("import.fileTooBig");
        const extra = err.match(/"exception_value">(.*)<\/pre>/)?.[1];

        err = { message, extra };
      }
      setError(err);
      onWaiting?.(false);
    },
    [t, onWaiting],
  );
  const onFinish = useCallback(
    async (res) => {
      const { could_be_tasks_list, data_columns, file_upload_ids } = res;

      dispatch({ ids: file_upload_ids });
      if (could_be_tasks_list && !csvHandling) setCsvHandling("choose");
      onWaiting?.(false);
      addColumns(data_columns);

      await loadFilesList(file_upload_ids);
      return res;
    },
    [addColumns, loadFilesList],
  );

  // Track newly uploaded files for flash animation
  useEffect(() => {
    const currentUploadedIds = new Set(files.uploaded.map((f) => f.id));
    const previousUploadedIds = prevUploadedRef.current;

    // Find files that were just uploaded (in current but not in previous)
    const justUploaded = new Set([...currentUploadedIds].filter((id) => !previousUploadedIds.has(id)));

    // Update the ref immediately after comparison to ensure it's available for next run
    prevUploadedRef.current = new Set(currentUploadedIds);

    // Clean up animation state for files that are no longer in the uploaded list
    setNewlyUploadedFiles((prev) => {
      const filtered = new Set([...prev].filter((id) => currentUploadedIds.has(id)));
      return filtered;
    });

    // Animate newly uploaded files (including first upload)
    if (justUploaded.size > 0) {
      // Apply animation class immediately for better responsiveness
      setNewlyUploadedFiles((prev) => new Set([...prev, ...justUploaded]));

      // Remove animation class after animation completes (CSS handles the animation timing)
      const timeoutId = setTimeout(() => {
        setNewlyUploadedFiles((prev) => {
          const updated = new Set(prev);
          justUploaded.forEach((id) => updated.delete(id));
          return updated;
        });
      }, FLASH_ANIMATION_DURATION);

      // Cleanup timeout on unmount or dependency change
      return () => clearTimeout(timeoutId);
    }
  }, [files.uploaded]);

  const importFilesImmediately = useCallback(
    async (files, body) => {
      importFiles({
        files,
        body,
        project,
        onError,
        onFinish,
        onUploadStart: (files) => dispatch({ sending: files }),
        onUploadFinish: (files) => dispatch({ sent: files }),
        dontCommitToProject,
      });
    },
    [project, onFinish, onError],
  );

  const sendFiles = useCallback(
    (files) => {
      setError(null);
      onWaiting?.(true);
      files = [...files]; // they can be array-like object
      const fd = new FormData();

      for (const f of files) {
        if (!allSupportedExtensions.includes(getFileExtension(f.name))) {
          onError(new Error(t("import.unsupportedFiletype", { name: f.name })));
          return;
        }
        fd.append(f.name, f);
      }
      return importFilesImmediately(files, fd);
    },
    [importFilesImmediately, t, onError],
  );

  const onUpload = useCallback(
    (e) => {
      sendFiles(e.target.files);
      e.target.value = "";
    },
    [sendFiles],
  );

  const openConfig = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      openLabelingConfig?.();
    },
    [openLabelingConfig],
  );

  useEffect(() => {
    if (project?.id !== undefined) {
      loadFilesList().then((files) => {
        if (csvHandling) return;
        // empirical guess on start if we have some possible tasks list/structured data problem
        if (Array.isArray(files) && files.some(({ file }) => /\.[ct]sv$/.test(file))) {
          setCsvHandling("choose");
        }
      });
    }
  }, [project?.id, loadFilesList]);

  useEffect(() => {
    if (dataSourceTab === "parent" && !isParentDatasetImportEnabled()) {
      setDataSourceTab("local");
    }
    if (dataSourceTab === "sample" && !ff.isActive(ff.FF_SAMPLE_DATASETS)) {
      setDataSourceTab("local");
    }
  }, [dataSourceTab]);

  const sampleOptions = useMemo(() => samples.map((s) => ({ value: s.url, label: s.title })), []);

  const sourceTabs = useMemo(() => {
    const tabs = [{ id: "local", label: t("import.tabLocal") }];
    if (isParentDatasetImportEnabled()) {
      tabs.push({ id: "parent", label: t("import.tabParent") });
    }
    if (ff.isActive(ff.FF_SAMPLE_DATASETS)) {
      tabs.push({ id: "sample", label: t("import.tabSample") });
    }
    return tabs;
  }, [t]);

  if (!project) return null;
  if (!show) return null;

  const csvProps = {
    name: "csv",
    type: "radio",
    onChange: (e) => setCsvHandling(e.target.value),
  };

  return (
    <div className={importClass}>
      {highlightCsvHandling && <div className={importClass.elem("csv-splash")} />}
      <input id="file-input" type="file" name="file" multiple onChange={onUpload} style={{ display: "none" }} />

      <ErrorMessage error={error} />

      <main>
        <Upload sendFiles={sendFiles} project={project}>
          <div className={importClass.elem("import-main-inner")}>
            <div className={importClass.elem("hero")}>
              <Typography variant="title" size="small" className="font-semibold text-neutral-content">
                {t("import.heroTitle")}
              </Typography>
              <Typography size="small" className="text-neutral-content-subtler mt-1 max-w-[720px] leading-relaxed">
                {t("import.heroSubtitle")}
              </Typography>
            </div>

            {csvHandling ? (
              <div
                className={importClass
                  .elem("csv-banner")
                  .mod({ highlighted: highlightCsvHandling, choose: csvHandling === "choose" })}
              >
                <div className="text-label-small font-medium text-neutral-content mb-2">
                  {t("import.csvBannerTitle")}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="text-body-small text-neutral-content-subtle">{t("import.treatCsvAs")}</span>
                  <label className="text-body-small flex items-center gap-1.5 cursor-pointer">
                    <input {...csvProps} value="tasks" checked={csvHandling === "tasks"} /> {t("import.listOfTasks")}
                  </label>
                  <label className="text-body-small flex items-center gap-1.5 cursor-pointer">
                    <input {...csvProps} value="ts" checked={csvHandling === "ts"} /> {t("import.timeSeriesOrText")}
                  </label>
                </div>
              </div>
            ) : null}

            <section className={importClass.elem("source-section")} aria-label={t("import.step1Label")}>
              <Typography size="small" className="text-label-small font-medium text-neutral-content-subtle mb-2">
                {t("import.step1Label")}
              </Typography>
              <div className={importClass.elem("segmented")} role="tablist" aria-orientation="horizontal">
                {sourceTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={dataSourceTab === tab.id}
                    className={importClass.elem("segmented-btn").mod({ active: dataSourceTab === tab.id })}
                    onClick={() => setDataSourceTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className={importClass.elem("source-panel")}>
                {dataSourceTab === "local" && (
                  <div>
                    <Typography size="small" className="text-neutral-content-subtle mb-3 leading-relaxed">
                      {t("import.panelLocalDesc")}
                    </Typography>
                    <div className={importClass.elem("drop-strip")}>
                      <Button
                        look="primary"
                        type="button"
                        className={importClass.elem("action-primary").toClassName()}
                        leading={<IconUpload />}
                        onClick={() => document.getElementById("file-input").click()}
                        aria-label={t("import.uploadFileAria")}
                      >
                        {files.uploaded.length ? t("import.uploadMoreFiles") : t("import.panelLocalPrimary")}
                      </Button>
                      <Typography size="small" className="text-neutral-content-subtler">
                        {t("import.panelLocalHint")}
                      </Typography>
                      <a
                        href="https://labelstud.io/guide/tasks.html#Import-data-from-the-Label-Studio-UI"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-body-small text-primary-content hover:underline shrink-0 ml-auto"
                      >
                        {t("import.formatsAndLimitsLink")}
                      </a>
                    </div>
                  </div>
                )}

                {dataSourceTab === "parent" && isParentDatasetImportEnabled() && (
                  <div>
                    <Typography size="small" className="text-neutral-content-subtle mb-3 leading-relaxed">
                      {t("import.panelParentDesc")}
                    </Typography>
                    <div className={importClass.elem("parent-inline-wrap")}>
                      <ParentDatasetPickerInline
                        projectId={project?.id}
                        committedSelection={parentDatasetSelection ?? null}
                        onClearCommitted={() => onParentDatasetClear?.()}
                        onApply={(sel) => onParentDatasetSelect?.(sel)}
                      />
                    </div>
                  </div>
                )}

                {dataSourceTab === "sample" && ff.isActive(ff.FF_SAMPLE_DATASETS) && (
                  <div>
                    <Typography size="small" className="text-neutral-content-subtle mb-3 leading-relaxed">
                      {t("import.panelSampleDesc")}
                    </Typography>
                    <div className="max-w-xl">
                      <Select
                        placeholder={t("import.sampleSelectPlaceholder")}
                        options={sampleOptions}
                        value={sample?.url ?? null}
                        onChange={(v) => {
                          const picked = samples.find((s) => s.url === v);
                          onSampleDatasetSelect?.(picked);
                        }}
                        width="100%"
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className={importClass.elem("summary-section")} aria-label={t("import.summaryTitle")}>
              <Typography className="text-label-small font-medium text-neutral-content mb-3">
                {t("import.summaryTitle")}
              </Typography>

              <div
                className={scn("flex flex-col gap-4 w-full flex-1 min-h-0 mt-1", {
                  "xl:flex-row xl:items-stretch": ff.isFF(ff.FF_JSON_PREVIEW),
                })}
              >
                <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                  <SimpleCard
                    title={t("import.listCardTitle")}
                    className={scn("w-full flex-1 flex flex-col min-h-0", importClass.elem("panel-card").toClassName())}
                    contentClassName={scn(
                      importClass.elem("table-scroll").toClassName(),
                      importClass.elem("list-card-body").toClassName(),
                      "flex-1 min-h-0",
                    )}
                    flushContent
                    headerClassName={importClass.elem("panel-card-heading").toClassName()}
                  >
                    <table className={scn("w-full", importClass.elem("data-table").toClassName())}>
                      <thead className="sticky top-0 z-[1] text-left">
                        <tr>
                          <th className="w-[120px]">{t("import.colSource")}</th>
                          <th>{t("import.colName")}</th>
                          <th className="min-w-[120px]">{t("import.colDetail")}</th>
                          <th className="w-[100px]">{t("import.colSizeOrStatus")}</th>
                          <th className="min-w-[140px] text-right">{t("import.colAction")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRowCount === 0 && (
                          <tr>
                            <td colSpan={5} className="p-6 text-center">
                              <Typography size="small" className="text-neutral-content-subtle">
                                {t("import.emptyTableHint")}
                              </Typography>
                            </td>
                          </tr>
                        )}
                        {showParentRow && parentDatasetSelection && (
                          <tr key={`parent-ds-${parentDatasetSelection.datasetId}`}>
                            <td className="align-middle">
                              <Badge variant="info" className="h-5 text-xs rounded-sm whitespace-nowrap">
                                {t("import.parentDataset.badge")}
                              </Badge>
                            </td>
                            <td className="align-middle max-w-[200px]">
                              <Typography variant="body" size="small" className="truncate">
                                {parentDatasetSelection.datasetName}
                              </Typography>
                            </td>
                            <td className="align-middle max-w-[280px] break-all text-body-small text-neutral-content-subtle">
                              {parentDatasetSelection.path}
                            </td>
                            <td className="align-middle text-neutral-content-subtler text-body-small">
                              {parentDatasetSelection.dataSetTypeLabel ?? parentDatasetSelection.dataSetType ?? "—"}
                            </td>
                            <td className="align-middle text-right">
                              <div className={importClass.elem("parent-row-actions").toClassName()}>
                                <Button
                                  size="small"
                                  look="primary"
                                  className={scn(
                                    importClass.elem("action-primary").toClassName(),
                                    importClass.elem("parent-sync-btn").toClassName(),
                                  )}
                                  waiting={parentSyncing}
                                  disabled={parentSyncing || !project?.id}
                                  onClick={() => void handleParentDatasetSync()}
                                >
                                  {t("import.parentDataset.sync")}
                                </Button>
                                <Button
                                  size="small"
                                  variant="negative"
                                  look="outlined"
                                  className={importClass.elem("parent-delete-btn").toClassName()}
                                  onClick={() => onParentDatasetClear?.()}
                                  aria-label={t("import.clearParentSelection")}
                                >
                                  <IconTrash className="w-4 h-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                        {showSampleRow && sample && (
                          <tr key={sample.url}>
                            <td className="align-middle">
                              <Badge variant="info" className="h-5 text-xs rounded-sm whitespace-nowrap">
                                {t("import.sampleBadge")}
                              </Badge>
                            </td>
                            <td className="align-middle max-w-[200px]">
                              <Typography variant="body" size="small" className="truncate">
                                {sample.title}
                              </Typography>
                            </td>
                            <td className="align-middle text-body-small text-neutral-content-subtle">
                              {sample.description}
                            </td>
                            <td className="align-middle text-neutral-content-subtler text-body-small">—</td>
                            <td className="align-middle text-right">
                              <Button
                                size="smaller"
                                variant="negative"
                                onClick={() => onSampleDatasetSelect(undefined)}
                              >
                                <IconTrash className="w-4 h-4" />
                              </Button>
                            </td>
                          </tr>
                        )}
                        {files.uploaded.map((file) => {
                          const truncatedFilename = truncate(
                            file.file,
                            FILENAME_TRUNCATE_START,
                            FILENAME_TRUNCATE_END,
                            "...",
                          );
                          return (
                            <tr
                              key={file.file}
                              className={newlyUploadedFiles.has(file.id) ? importClass.elem("upload-flash") : ""}
                            >
                              <td className="align-middle">
                                <span className="text-body-small text-neutral-content">{t("import.sourceLocal")}</span>
                              </td>
                              <td className={`${importClass.elem("file-name")} align-middle max-w-[240px]`}>
                                <Tooltip title={file.file}>
                                  <Typography variant="body" size="small" className="truncate">
                                    {truncatedFilename}
                                  </Typography>
                                </Tooltip>
                              </td>
                              <td className="align-middle text-neutral-content-subtler text-body-small">—</td>
                              <td className={`${importClass.elem("file-size")} align-middle`}>
                                <div className="flex flex-col gap-1 items-start">
                                  <span className={importClass.elem("file-status")} />
                                  <Typography
                                    variant="body"
                                    size="smaller"
                                    className="text-nowrap text-neutral-content-subtle"
                                  >
                                    {file.size ? formatFileSize(file.size) : ""}
                                  </Typography>
                                </div>
                              </td>
                              <td className="align-middle text-right text-neutral-content-subtler text-body-small">
                                —
                              </td>
                            </tr>
                          );
                        })}
                        {files.uploading.map((file, idx) => {
                          const truncatedFilename = truncate(
                            file.name,
                            FILENAME_TRUNCATE_START,
                            FILENAME_TRUNCATE_END,
                            "...",
                          );
                          return (
                            <tr key={`${idx}-${file.name}`}>
                              <td className="align-middle">
                                <span className="text-body-small text-neutral-content">{t("import.sourceLocal")}</span>
                              </td>
                              <td className={`${importClass.elem("file-name")} align-middle max-w-[240px]`}>
                                <Tooltip title={file.name}>
                                  <Typography variant="body" size="small" className="truncate">
                                    {truncatedFilename}
                                  </Typography>
                                </Tooltip>
                              </td>
                              <td className="align-middle text-neutral-content-subtler text-body-small">—</td>
                              <td className={`${importClass.elem("file-size")} align-middle`}>
                                <span className={importClass.elem("file-status").mod({ uploading: true })} />
                              </td>
                              <td className="align-middle text-right text-neutral-content-subtler text-body-small">
                                —
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {parentSyncMsg ? (
                      <Typography
                        size="small"
                        className="px-3 py-2 text-primary-content bg-primary-background/30 border-t border-neutral-border"
                      >
                        {parentSyncMsg}
                      </Typography>
                    ) : null}
                  </SimpleCard>
                </div>

                {ff.isFF(ff.FF_JSON_PREVIEW) && (
                  <div className="w-full xl:w-[min(44%,520px)] shrink-0 flex flex-col min-h-[240px] xl:max-h-[min(52vh,480px)]">
                    {projectConfigured ? (
                      <SimpleCard
                        title={t("import.expectedInputPreview")}
                        className={scn(
                          "w-full h-full overflow-hidden flex flex-col",
                          importClass.elem("panel-card").toClassName(),
                        )}
                        contentClassName="h-[calc(100%-48px)]"
                        headerClassName={importClass.elem("panel-card-heading").toClassName()}
                        flushContent
                      >
                        {sampleConfig.data ? (
                          <div className={importClass.elem("code-wrapper")}>
                            <CodeBlock
                              title={t("import.expectedInputPreview")}
                              code={sampleConfig?.data ?? ""}
                              className="w-full h-full"
                            />
                          </div>
                        ) : sampleConfig.isLoading ? (
                          <div className="w-full flex justify-center py-12">
                            <Spinner className="h-6 w-6" />
                          </div>
                        ) : sampleConfig.isError ? (
                          <div className="w-[calc(100%-24px)] text-lg text-negative-content bg-negative-background border m-3 rounded-md border-negative-border-subtle p-4">
                            {t("import.sampleLoadError")}
                          </div>
                        ) : null}
                      </SimpleCard>
                    ) : (
                      <SimpleCard
                        className={scn(
                          "w-full h-full flex flex-col items-center justify-center text-center p-wide",
                          importClass.elem("panel-card").toClassName(),
                        )}
                      >
                        <div className="flex flex-col items-center gap-tight">
                          <div className="bg-primary-background rounded-largest p-tight flex items-center justify-center">
                            <IconCode className="w-6 h-6 text-primary-icon" />
                          </div>
                          <div className="flex flex-col items-center gap-tighter">
                            <div className="text-label-small text-neutral-content font-medium">
                              {t("import.viewJsonFormat")}
                            </div>
                            <div className="text-body-small text-neutral-content-subtler text-center">
                              {isZh ? (
                                <>
                                  请先配置
                                  <Button
                                    type="button"
                                    look="string"
                                    onClick={openConfig}
                                    className="border-none bg-none p-0 m-0 text-primary-content underline"
                                  >
                                    {t("Labeling Interface")}
                                  </Button>
                                  ，再预览预期的 JSON 数据格式
                                </>
                              ) : (
                                <>
                                  Setup your{" "}
                                  <Button
                                    type="button"
                                    look="string"
                                    onClick={openConfig}
                                    className="border-none bg-none p-0 m-0 text-primary-content underline"
                                  >
                                    labeling configuration
                                  </Button>{" "}
                                  first to preview the expected JSON data format
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </SimpleCard>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        </Upload>
      </main>
    </div>
  );
};
