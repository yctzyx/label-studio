import { Spinner } from "@humansignal/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getVisitedProjectIds, useUpdatePageTitle } from "@humansignal/core";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import "./MyTasksPage.scss";

const STAGES = [
  { key: "annotate", tab: "labeler" },
  { key: "review", tab: "reviewer" },
  { key: "accept", tab: "acceptor" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];

const MEDIA_PATH_RE = /^(https?:\/\/|\/\/|\/|s3:|gs:)/i;
const MEDIA_HINT_RE = /\/data\/upload\/|\/storage-data\/|\.(jpe?g|png|gif|webp|bmp|svg|mp4|webm|wav|mp3|m4a|txt|pdf|json)(\?|$)/i;

function isMediaLikeString(value) {
  return MEDIA_PATH_RE.test(value) || MEDIA_HINT_RE.test(value);
}

/** 从上传路径/URL 提取可读文件名（解码中文、去掉 upload uuid 前缀） */
function humanizeUploadFilename(value) {
  if (!value || typeof value !== "string") return "";

  let segment = value.trim();

  try {
    if (/^https?:\/\//i.test(segment)) {
      segment = new URL(segment).pathname;
    }
    segment = segment.split("?")[0].split("#")[0];
    const parts = segment.split("/").filter(Boolean);
    segment = parts[parts.length - 1] ?? segment;
    segment = decodeURIComponent(segment);
  } catch {
    // keep raw segment
  }

  segment = segment.replace(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-/i, "");
  segment = segment.replace(/^[0-9a-f]{8}-/i, "");

  return segment.trim();
}

function taskDisplayName(task) {
  const metaDesc = task?.meta?.description?.trim();
  if (metaDesc) return metaDesc.slice(0, 64);

  const data = task?.data;
  if (data && typeof data === "object") {
    const fields = Object.values(data).filter((v) => typeof v === "string" && v.trim());

    const plainText = fields.find((v) => !isMediaLikeString(v));
    if (plainText) return plainText.trim().slice(0, 64);

    for (const value of fields) {
      const name = humanizeUploadFilename(value);
      if (name) return name.slice(0, 64);
    }
  }

  return task?.id != null ? `任务 #${task.id}` : "—";
}

/** 悬停提示：保留原始数据摘要 */
function taskDisplayTitle(task) {
  const data = task?.data;
  if (!data || typeof data !== "object") return undefined;

  const parts = Object.entries(data)
    .filter(([, v]) => v != null && String(v).trim())
    .map(([k, v]) => `${k}: ${String(v)}`);

  return parts.length ? parts.join("\n") : undefined;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  } catch {
    return String(iso);
  }
}

/** 列表展示用流水线状态（与后端筛选一致） */
function getMyTaskPipelineStatus(task, taskWorkflowEnabled) {
  if (!taskWorkflowEnabled) {
    return task.is_labeled ? "done" : "annotating";
  }
  const wf = task.workflow;
  const st = wf?.stage;
  if (!st) return "annotating";
  if (st === "done") return "done";
  if (st === "review") return "in_review";
  if (st === "accept") return "in_accept";
  if (st === "annotate") {
    return wf.returned_to_annotation ? "rejected" : "annotating";
  }
  return "annotating";
}

const PIPELINE_STATUS_I18N = {
  annotating: "myTasks.statusAnnotating",
  rejected: "myTasks.statusRejected",
  in_review: "myTasks.statusInReview",
  in_accept: "myTasks.statusInAccept",
  done: "myTasks.statusDone",
};

const STAGE_STATUS_OPTIONS = {
  annotate: ["annotating", "rejected", "in_review", "in_accept", "done"],
  review: ["in_review"],
  accept: ["in_accept"],
};

function pickDefaultProjectId(projectList) {
  if (!projectList?.length) return "";

  const userId = typeof window !== "undefined" ? window.APP_SETTINGS?.user?.id : undefined;
  const visited = getVisitedProjectIds(userId);

  for (const id of visited) {
    if (projectList.some((p) => p.id === id)) return String(id);
  }

  const sorted = [...projectList].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });

  return String(sorted[0]?.id ?? projectList[0].id);
}

export const MyTasksPage = () => {
  const { t } = useTranslation();
  const api = useAPI();
  const root = cn("my-tasks-page");

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [stage, setStage] = useState("annotate");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const [nameDraft, setNameDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  /** 点击「查询」后才用于列表筛选（与输入框草稿分离） */
  const [nameApplied, setNameApplied] = useState("");
  const [statusApplied, setStatusApplied] = useState("");
  /** 每次点「查询」「重置」递增，保证条件未变也会重新请求（等同刷新） */
  const [listRefreshKey, setListRefreshKey] = useState(0);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [jumperVal, setJumperVal] = useState("1");

  useUpdatePageTitle(t("My tasks"));

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const projRes = await api.callApi("projects", {
        params: {
          page_size: 200,
          include: ["id", "title", "task_workflow_enabled", "color", "created_at"].join(","),
        },
      });
      const list = projRes?.results ?? [];
      const wfProjects = list.filter(
        (p) => p.task_workflow_enabled === true || p.taskWorkflowEnabled === true,
      );
      const nextProjects = wfProjects.length ? wfProjects : list;
      setProjects(nextProjects);
      setSelectedProjectId((prev) => prev || pickDefaultProjectId(nextProjects));
    } catch (e) {
      setProjectsError(e?.message || String(e));
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const selectedProject = useMemo(() => {
    const id = Number.parseInt(selectedProjectId, 10);
    if (Number.isNaN(id)) return null;
    return projects.find((p) => p.id === id) ?? null;
  }, [projects, selectedProjectId]);

  const loadTasks = useCallback(async () => {
    if (!selectedProjectId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const pk = Number.parseInt(selectedProjectId, 10);
    if (Number.isNaN(pk)) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = { pk, stage };
      if (nameApplied) params.search = nameApplied;
      if (statusApplied) params.status = statusApplied;

      const res = await api.callApi("projectWorkflowMyTasks", {
        params,
        suppressError: true,
      });
      if (!res || res.error) {
        const detail =
          (typeof res?.response?.detail === "string" && res.response.detail) ||
          res?.error ||
          "加载任务失败";
        setError(String(detail));
        setRows([]);
        return;
      }
      const list = res.results ?? [];
      const pTitle = selectedProject?.title ?? "";
      const wfOn =
        selectedProject?.task_workflow_enabled === true || selectedProject?.taskWorkflowEnabled === true;
      setRows(
        list.map((task) => ({
          task,
          projectId: pk,
          projectTitle: pTitle,
          taskWorkflowEnabled: wfOn,
        })),
      );
    } catch (e) {
      setError(e?.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [api, stage, selectedProjectId, selectedProject, nameApplied, statusApplied, listRefreshKey]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageSlice = useMemo(() => {
    const p = Math.min(page, totalPages);
    const start = (p - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, page, pageSize, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  const resetSearchState = useCallback(() => {
    setNameDraft("");
    setStatusDraft("");
    setNameApplied("");
    setStatusApplied("");
    setPage(1);
  }, []);

  const applySearch = useCallback(() => {
    setNameApplied(nameDraft.trim());
    setStatusApplied(statusDraft);
    setPage(1);
    setListRefreshKey((k) => k + 1);
  }, [nameDraft, statusDraft]);

  const resetFilters = useCallback(() => {
    resetSearchState();
    setListRefreshKey((k) => k + 1);
  }, [resetSearchState]);

  const actionLabel = (() => {
    if (stage === "annotate") return t("myTasks.actionLabel");
    if (stage === "review") return t("myTasks.actionReview");
    return t("myTasks.actionAccept");
  })();

  const workflowHint = (() => {
    if (stage === "review") return t("myTasks.reviewTodoHint");
    if (stage === "accept") return t("myTasks.acceptTodoHint");
    return "";
  })();

  const statusOptions = STAGE_STATUS_OPTIONS[stage] ?? STAGE_STATUS_OPTIONS.annotate;

  const dataHref = (projectId, taskId, pageStage, workflowStage) => {
    const base = `/projects/${projectId}/data`;
    const ws = workflowStage ?? "";
    if (pageStage === "annotate" && ws === "annotate") {
      return `${base}?task=${taskId}`;
    }
    return `${base}?task=${taskId}`;
  };

  useEffect(() => {
    setJumperVal(String(safePage));
  }, [safePage]);

  const pagerItems = useMemo(() => {
    const n = totalPages;
    const cur = safePage;
    if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
    const pages = new Set([1, n, cur, cur - 1, cur + 1]);
    const sorted = [...pages].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    for (const p of sorted) {
      if (prev && p - prev > 1) out.push("…");
      out.push(p);
      prev = p;
    }
    return out;
  }, [totalPages, safePage]);

  /** 标注员列表不展示累计进度 / 我已标注 / 任务描述 */
  const annotatorSimplifiedTable = stage === "annotate";
  const tableColCount = annotatorSimplifiedTable ? 5 : 8;

  return (
    <div className={root.toClassName()}>
      <div className={root.elem("content").toClassName()}>
        <div className={root.elem("card").toClassName()}>
          <div className={root.elem("project-bar").toClassName()}>
            <div className={root.elem("field").mod({ project: true }).toClassName()}>
              <label htmlFor="mt-project">{t("myTasks.projectSelect")}</label>
              <select
                id="mt-project"
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  resetSearchState();
                }}
                disabled={projectsLoading}
                aria-label={t("myTasks.projectSelect")}
              >
                <option value="">{t("myTasks.selectProjectPlaceholder")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.title ?? `#${p.id}`}
                  </option>
                ))}
              </select>
            </div>
            {projectsLoading ? (
              <span className={root.elem("project-bar-loading").toClassName()}>
                <Spinner size={20} />
              </span>
            ) : null}
            {projectsError ? (
              <div className={root.elem("projects-error").toClassName()} role="alert">
                {projectsError}
              </div>
            ) : null}
          </div>

          <div className={root.elem("tabs").toClassName()} role="tablist">
            {STAGES.map(({ key, tab }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={stage === key}
                className={root.elem("tab").mod({ active: stage === key }).toClassName()}
                onClick={() => {
                  if (stage === key) return;
                  setStage(key);
                  resetSearchState();
                }}
              >
                {t(`myTasks.tab.${tab}`)}
              </button>
            ))}
          </div>

          {stage === "review" || stage === "accept" ? (
            <div className={root.elem("workflow-hint").toClassName()} role="note">
              {workflowHint}
            </div>
          ) : null}

          {selectedProjectId ? (
            <div className={root.elem("table-layout").toClassName()}>
            <div className={root.elem("search-container").toClassName()}>
              <div
                className={root.elem("search-form").toClassName()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applySearch();
                  }
                }}
              >
                <div className={root.elem("field").toClassName()}>
                  <label htmlFor="mt-name">{t("myTasks.taskName")}</label>
                  <input
                    id="mt-name"
                    type="text"
                    placeholder={t("myTasks.taskNamePlaceholder")}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    maxLength={128}
                    autoComplete="off"
                  />
                </div>
                <div className={root.elem("field").toClassName()}>
                  <label htmlFor="mt-status">{t("myTasks.taskStatus")}</label>
                  <select
                    id="mt-status"
                    value={statusDraft}
                    onChange={(e) => setStatusDraft(e.target.value)}
                    aria-label={t("myTasks.taskStatus")}
                  >
                    <option value="">{t("myTasks.statusAll")}</option>
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {t(PIPELINE_STATUS_I18N[status])}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={root.elem("search-container-buttons").toClassName()}>
                <button type="button" className={root.elem("btn-search").toClassName()} onClick={applySearch}>
                  {t("myTasks.search")}
                </button>
                <button type="button" className={root.elem("btn-reset").toClassName()} onClick={resetFilters}>
                  {t("myTasks.reset")}
                </button>
              </div>
            </div>
            <div className={root.elem("stream-bar").toClassName()}>
              {stage === "annotate" ? (
                <Link
                  className={root.elem("btn-stream").toClassName()}
                  to={`/projects/${selectedProjectId}/data?labeling=1&stream_stage=annotate`}
                  data-external
                >
                  + {t("myTasks.streamLabel")}
                </Link>
              ) : null}
              {stage === "review" ? (
                <Link
                  className={root.elem("btn-stream").toClassName()}
                  to={`/projects/${selectedProjectId}/data?labeling=1&stream_stage=review`}
                  data-external
                >
                  + {t("myTasks.streamReview")}
                </Link>
              ) : null}
              {stage === "accept" ? (
                <Link
                  className={root.elem("btn-stream").toClassName()}
                  to={`/projects/${selectedProjectId}/data?labeling=1&stream_stage=accept`}
                  data-external
                >
                  + {t("myTasks.streamAccept")}
                </Link>
              ) : null}
            </div>
          </div>
          ) : null}

          {!selectedProjectId ? (
            <div className={root.elem("empty").mod({ pick: true }).toClassName()}>{t("myTasks.selectProjectFirst")}</div>
          ) : loading ? (
            <div className={root.elem("loading").toClassName()}>
              <Spinner size={32} />
            </div>
          ) : error ? (
            <div className={root.elem("empty").toClassName()}>{error}</div>
          ) : (
            <>
              <div className={root.elem("table-wrap").toClassName()}>
                <table className={root.elem("table").mod({ striped: true }).toClassName()}>
                  <thead>
                    <tr>
                      <th>{t("myTasks.col.taskName")}</th>
                      <th>{t("myTasks.col.taskType")}</th>
                      {!annotatorSimplifiedTable ? (
                        <>
                          <th>{t("myTasks.col.progress")}</th>
                          <th>{t("myTasks.col.myAnn")}</th>
                          <th>{t("myTasks.col.desc")}</th>
                        </>
                      ) : null}
                      <th>{t("myTasks.col.created")}</th>
                      <th>{t("myTasks.col.status")}</th>
                      <th>{t("myTasks.col.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice.length === 0 ? (
                      <tr>
                        <td colSpan={tableColCount} className={root.elem("empty").toClassName()}>
                          {t("myTasks.empty")}
                        </td>
                      </tr>
                    ) : (
                      pageSlice.map(({ task, projectId, projectTitle, taskWorkflowEnabled }) => {
                        const pipelineStatus = getMyTaskPipelineStatus(task, taskWorkflowEnabled);
                        const wfStage = task.workflow?.stage;
                        const pipelineComplete = pipelineStatus === "done";
                        return (
                          <tr key={`${projectId}-${task.id}`}>
                            <td>
                              <Link
                                className={root.elem("link-action").toClassName()}
                                to={dataHref(projectId, task.id, stage, wfStage)}
                                data-external
                                title={taskDisplayTitle(task)}
                              >
                                {taskDisplayName(task)}
                              </Link>
                            </td>
                            <td>{projectTitle || "—"}</td>
                            {!annotatorSimplifiedTable ? (
                              <>
                                <td>{pipelineComplete ? "1/1" : "0/1"}</td>
                                <td>
                                  {Array.isArray(task.annotations)
                                    ? task.annotations.filter((a) => a && !a.was_cancelled).length
                                    : Number(task.total_annotations ?? 0)}
                                </td>
                                <td>{(task.meta?.description || "").slice(0, 48) || "—"}</td>
                              </>
                            ) : null}
                            <td>{formatDate(task.created_at)}</td>
                            <td>
                              <span
                                className={root
                                  .elem("status")
                                  .mod({
                                    annotating: pipelineStatus === "annotating",
                                    rejected: pipelineStatus === "rejected",
                                    in_review: pipelineStatus === "in_review",
                                    in_accept: pipelineStatus === "in_accept",
                                    done: pipelineStatus === "done",
                                  })
                                  .toClassName()}
                              >
                                {t(PIPELINE_STATUS_I18N[pipelineStatus] ?? PIPELINE_STATUS_I18N.annotating)}
                              </span>
                            </td>
                            <td>
                              <Link
                                className={root.elem("link-action").toClassName()}
                                to={dataHref(projectId, task.id, stage, wfStage)}
                                data-external
                              >
                                {actionLabel}
                              </Link>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className={root.elem("pagination").toClassName()}>
                <div className={root.elem("pagination-total").toClassName()}>
                  {t("myTasks.paginationLeft", { total, page: safePage, totalPages })}
                </div>
                <div className={root.elem("pagination-inner").toClassName()}>
                  <div className={root.elem("pagination-size").toClassName()}>
                    <span>{t("myTasks.perPagePrefix")}</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      aria-label={t("myTasks.pageSize")}
                    >
                      {PAGE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <span>{t("myTasks.perPageSuffix")}</span>
                  </div>
                  <button
                    type="button"
                    className={root.elem("pg-btn").mod({ prev: true }).toClassName()}
                    disabled={safePage <= 1}
                    aria-label="prev"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    ‹
                  </button>
                  <ul className={root.elem("pager").toClassName()}>
                    {pagerItems.map((item, idx) =>
                      item === "…" ? (
                        <li key={`e-${idx}`} className={root.elem("pager-ellipsis").toClassName()}>
                          …
                        </li>
                      ) : (
                        <li key={item}>
                          <button
                            type="button"
                            className={root.elem("pager-num").mod({ active: item === safePage }).toClassName()}
                            onClick={() => setPage(item)}
                          >
                            {item}
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                  <button
                    type="button"
                    className={root.elem("pg-btn").mod({ next: true }).toClassName()}
                    disabled={safePage >= totalPages}
                    aria-label="next"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    ›
                  </button>
                  <span className={root.elem("jumper").toClassName()}>
                    {t("myTasks.jumperPrefix")}
                    <input
                      type="text"
                      inputMode="numeric"
                      className={root.elem("jumper-input").toClassName()}
                      value={jumperVal}
                      onChange={(e) => setJumperVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = Number.parseInt(jumperVal, 10);
                          if (!Number.isNaN(v)) setPage(Math.min(totalPages, Math.max(1, v)));
                        }
                      }}
                    />
                    {t("myTasks.jumperSuffix")}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

MyTasksPage.path = "/my-tasks";
MyTasksPage.exact = true;
MyTasksPage.title = "My tasks";
