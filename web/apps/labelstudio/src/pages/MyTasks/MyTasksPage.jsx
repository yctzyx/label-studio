import { Spinner } from "@humansignal/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useUpdatePageTitle } from "@humansignal/core";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import "./MyTasksPage.scss";

const STAGES = [
  { key: "annotate", tab: "labeler" },
  { key: "review", tab: "reviewer" },
  { key: "accept", tab: "acceptor" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200];

function taskDisplayName(task) {
  const data = task?.data;
  if (data && typeof data === "object") {
    const first = Object.values(data).find((v) => typeof v === "string" && v.trim());
    if (first) return first.slice(0, 64);
  }
  return task?.id != null ? `Task #${task.id}` : "—";
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

/** 团队工作流下「整单完成」应以 workflow.stage==='done' 为准；is_labeled 只表示 overlap 已满，驳回后仍可能为 true */
function isTaskPipelineDone(task, taskWorkflowEnabled) {
  if (!taskWorkflowEnabled) return !!task.is_labeled;
  const st = task.workflow?.stage;
  if (st) return st === "done";
  return !!task.is_labeled;
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

  const [nameQuery, setNameQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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
          include: ["id", "title", "task_workflow_enabled", "color"].join(","),
        },
      });
      const list = projRes?.results ?? [];
      const wfProjects = list.filter(
        (p) => p.task_workflow_enabled === true || p.taskWorkflowEnabled === true,
      );
      setProjects(wfProjects.length ? wfProjects : list);
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
      const res = await api.callApi("projectWorkflowMyTasks", {
        params: { pk, stage },
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
  }, [api, stage, selectedProjectId, selectedProject]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const filtered = useMemo(() => {
    return rows.filter(({ task, taskWorkflowEnabled }) => {
      const done = isTaskPipelineDone(task, taskWorkflowEnabled);
      if (statusFilter === "progress" && done) return false;
      if (statusFilter === "done" && !done) return false;
      const created = task.created_at ? new Date(task.created_at) : null;
      if (dateFrom && created) {
        const from = new Date(`${dateFrom}T00:00:00`);
        if (created < from) return false;
      }
      if (dateTo && created) {
        const to = new Date(`${dateTo}T23:59:59`);
        if (created > to) return false;
      }
      if (nameQuery.trim()) {
        const q = nameQuery.trim().toLowerCase();
        const idMatch = String(task.id).includes(q);
        const name = taskDisplayName(task).toLowerCase();
        if (!idMatch && !name.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, dateFrom, dateTo, nameQuery]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageSlice = useMemo(() => {
    const p = Math.min(page, totalPages);
    const start = (p - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [stage, nameQuery, statusFilter, dateFrom, dateTo, pageSize, selectedProjectId]);

  const resetFilters = () => {
    setNameQuery("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const actionLabel = (() => {
    if (stage === "annotate") return t("myTasks.actionLabel");
    if (stage === "review") return t("myTasks.actionReview");
    return t("myTasks.actionAccept");
  })();

  const dataHref = (projectId, taskId, st) => {
    const base = `/projects/${projectId}/data`;
    if (st === "annotate") return `${base}?labeling=1&task=${taskId}`;
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
                onChange={(e) => setSelectedProjectId(e.target.value)}
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
                onClick={() => setStage(key)}
              >
                {t(`myTasks.tab.${tab}`)}
              </button>
            ))}
          </div>

          {stage === "accept" ? (
            <div className={root.elem("workflow-hint").toClassName()} role="note">
              {t("myTasks.acceptEmptyHint")}
            </div>
          ) : null}

          {selectedProjectId ? (
            <div className={root.elem("table-layout").toClassName()}>
            <div className={root.elem("search-container").toClassName()}>
              <div
                className={root.elem("search-form").toClassName()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setPage(1);
                }}
              >
                <div className={root.elem("field").toClassName()}>
                  <label htmlFor="mt-name">{t("myTasks.taskName")}</label>
                  <input
                    id="mt-name"
                    type="text"
                    placeholder={t("myTasks.taskNamePlaceholder")}
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    maxLength={128}
                    autoComplete="off"
                  />
                </div>
                <div className={root.elem("field").toClassName()}>
                  <label htmlFor="mt-from">{t("myTasks.createdFrom")}</label>
                  <input id="mt-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className={root.elem("field").toClassName()}>
                  <label htmlFor="mt-to">{t("myTasks.createdTo")}</label>
                  <input id="mt-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div className={root.elem("field").toClassName()}>
                  <label htmlFor="mt-status">{t("myTasks.taskStatus")}</label>
                  <select
                    id="mt-status"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    aria-label={t("myTasks.taskStatus")}
                  >
                    <option value="">{t("myTasks.statusAll")}</option>
                    <option value="progress">{t("myTasks.statusProgress")}</option>
                    <option value="done">{t("myTasks.statusDone")}</option>
                  </select>
                </div>
              </div>
              <div className={root.elem("search-container-buttons").toClassName()}>
                <button type="button" className={root.elem("btn-search").toClassName()} onClick={() => setPage(1)}>
                  {t("myTasks.search")}
                </button>
                <button type="button" className={root.elem("btn-reset").toClassName()} onClick={resetFilters}>
                  {t("myTasks.reset")}
                </button>
              </div>
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
                      <th>{t("myTasks.col.progress")}</th>
                      <th>{t("myTasks.col.myAnn")}</th>
                      <th>{t("myTasks.col.desc")}</th>
                      <th>{t("myTasks.col.created")}</th>
                      <th>{t("myTasks.col.status")}</th>
                      <th>{t("myTasks.col.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice.length === 0 ? (
                      <tr>
                        <td colSpan={8} className={root.elem("empty").toClassName()}>
                          {t("myTasks.empty")}
                        </td>
                      </tr>
                    ) : (
                      pageSlice.map(({ task, projectId, projectTitle, taskWorkflowEnabled }) => {
                        const ann = Array.isArray(task.annotations)
                          ? task.annotations.filter((a) => a && !a.was_cancelled).length
                          : Number(task.total_annotations ?? 0);
                        const pipelineDone = isTaskPipelineDone(task, taskWorkflowEnabled);
                        const progress = pipelineDone ? "1/1" : "0/1";
                        return (
                          <tr key={`${projectId}-${task.id}`}>
                            <td>
                              <Link
                                className={root.elem("link-action").toClassName()}
                                to={dataHref(projectId, task.id, stage)}
                                data-external
                              >
                                {taskDisplayName(task)}
                              </Link>
                            </td>
                            <td>{projectTitle || "—"}</td>
                            <td>{progress}</td>
                            <td>{ann}</td>
                            <td>{(task.meta?.description || "").slice(0, 48) || "—"}</td>
                            <td>{formatDate(task.created_at)}</td>
                            <td>
                              <span
                                className={root
                                  .elem("status")
                                  .mod({ progress: !pipelineDone, done: pipelineDone })
                                  .toClassName()}
                              >
                                {pipelineDone ? t("myTasks.statusDone") : t("myTasks.statusProgress")}
                              </span>
                            </td>
                            <td>
                              <Link
                                className={root.elem("link-action").toClassName()}
                                to={dataHref(projectId, task.id, stage)}
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
