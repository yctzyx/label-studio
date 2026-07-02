import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@humansignal/ui";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import { formatUserNameWithPhone } from "../../utils/helpers";
import "./WorkflowProgressModal.scss";

const STAGE_TITLE_KEYS = {
  label: "Workflow progress detail label",
  review: "Workflow progress detail review",
  accept: "Workflow progress detail accept",
};

export const WorkflowProgressModal = ({ projectId, projectTitle, stage, onClose }) => {
  const { t } = useTranslation();
  const api = useAPI();
  const root = cn("workflow-progress-modal");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    if (!projectId || !stage) return;
    setLoading(true);
    setError("");
    const res = await api.callApi("projectWorkflowProgress", {
      params: { pk: projectId, stage },
      errorFilter: () => true,
    });
    if (!res || res.error) {
      setError(res?.response?.detail ?? res?.error ?? t("Workflow progress load failed"));
      setData(null);
    } else {
      setData(res);
    }
    setLoading(false);
  }, [api, projectId, stage, t]);

  useEffect(() => {
    load();
  }, [load]);

  const members = data?.members ?? [];
  const totalTasks = data?.project_task_count ?? 0;
  const stageCompleted = data?.stage_completed_count ?? 0;
  const isLabel = stage === "label";

  return (
    <div className={root.elem("backdrop").toClassName()} role="presentation" onClick={onClose}>
      <div
        className={root.toClassName()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-progress-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={root.elem("head").toClassName()}>
          <div>
            <h2 id="workflow-progress-modal-title" className={root.elem("title").toClassName()}>
              {t(STAGE_TITLE_KEYS[stage] ?? "Workflow progress detail")}
            </h2>
            {projectTitle ? (
              <p className={root.elem("subtitle").toClassName()}>{projectTitle}</p>
            ) : null}
          </div>
          <button type="button" className={root.elem("close").toClassName()} onClick={onClose} aria-label={t("Close")}>
            ×
          </button>
        </div>

        <div className={root.elem("summary").toClassName()}>
          <span>
            {t("Total tasks")}: {totalTasks}
          </span>
          <span>
            {t("Stage completed")}: {stageCompleted} / {totalTasks}
          </span>
        </div>

        <div className={root.elem("body").toClassName()}>
          {loading ? (
            <div className={root.elem("loading").toClassName()}>
              <Spinner />
            </div>
          ) : error ? (
            <div className={root.elem("error").toClassName()}>{error}</div>
          ) : members.length === 0 ? (
            <div className={root.elem("empty").toClassName()}>{t("No personnel for this stage")}</div>
          ) : (
            <table className={root.elem("table").toClassName()}>
              <thead>
                <tr>
                  <th>{t("Name and phone")}</th>
                  {isLabel ? (
                    <>
                      <th>{t("Assigned tasks")}</th>
                      <th>{t("Completed tasks")}</th>
                      <th>{t("In progress tasks")}</th>
                    </>
                  ) : (
                    <>
                      <th>{stage === "review" ? t("Pending review") : t("Pending accept")}</th>
                      <th>{t("Completed tasks")}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td title={m.email || m.username}>
                      {formatUserNameWithPhone(m)}
                    </td>
                    {isLabel ? (
                      <>
                        <td>{m.assigned_task_count ?? 0}</td>
                        <td>{m.completed_task_count ?? 0}</td>
                        <td>{m.pending_task_count ?? 0}</td>
                      </>
                    ) : (
                      <>
                        <td>{m.pending_task_count ?? 0}</td>
                        <td>{m.completed_task_count ?? 0}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
