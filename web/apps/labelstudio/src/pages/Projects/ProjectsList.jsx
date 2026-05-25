import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useHistory } from "react-router-dom";
import {
  IconCheck,
  IconFolderOpen,
  IconMinus,
  IconSparks,
} from "@humansignal/icons";
import { Button, Tooltip, buttonVariant } from "@humansignal/ui";
import { PidataStylePagination, EmptyData } from "../../components";
import { cn } from "../../utils/bem";
import { ProjectStateChip } from "@humansignal/app-common";
import { useAPI } from "../../providers/ApiProvider";

const TYPE_FILTERS = [
  { key: "all", labelKey: "All types" },
  { key: "image", labelKey: "Image" },
  { key: "video", labelKey: "Video" },
  { key: "text", labelKey: "Text" },
  { key: "audio", labelKey: "Audio" },
  { key: "general", labelKey: "General" },
];

/** 超过 6 个项目时即使当前只有一页也显示底栏，方便把每页从 30 改为 6 */
const PROJECTS_PAGINATION_FORCE_MIN = 7;

/** 与 annotation_templates/groups.txt 一致；侧栏不展示「社区贡献」 */
const DEFAULT_TEMPLATE_GROUPS = [
  "Computer Vision",
  "Natural Language Processing",
  "Audio/Speech Processing",
  "Conversational AI",
  "Chat",
  "Ranking & Scoring",
  "Structured Data Parsing",
  "Time Series Analysis",
  "Videos",
  "Generative AI",
];

/** 标注项目标签侧栏排除的分组（与 groups.txt 中 Community Contributions 对应） */
function filterSidebarTemplateGroups(groups) {
  return groups.filter(
    (g) => String(g).trim().toLowerCase() !== "community contributions",
  );
}

function pseudoTypeKey(project) {
  const keys = ["image", "video", "text", "audio", "general"];
  return keys[Math.abs(Number(project.id)) % keys.length];
}

function typeLabelForProject(t, project) {
  const key = pseudoTypeKey(project);
  const f = TYPE_FILTERS.find((x) => x.key === key);
  return f ? t(f.labelKey) : t("General");
}

/** 项目卡片角标：优先展示已保存的模板分组 */
function studioBadgeLabel(t, project) {
  const g = project.template_group?.trim();
  if (g) return t(g, { defaultValue: g });
  return typeLabelForProject(t, project);
}

/** 项目列表卡片：优先展示姓名，避免仅用 username/email（如同步用户的伪邮箱） */
function creatorDisplayLabel(createdBy, unknownUserText) {
  if (!createdBy) return unknownUserText;
  const first = String(createdBy.first_name ?? "").trim();
  const last = String(createdBy.last_name ?? "").trim();
  const name = `${first} ${last}`.trim();
  if (name) return name;
  const u = String(createdBy.username ?? "").trim();
  if (u) return u;
  const mail = String(createdBy.email ?? "").trim();
  if (mail) return mail;
  return unknownUserText;
}

export const ProjectsList = ({
  projects,
  currentPage,
  totalItems,
  loadNextPage,
  pageSize,
  onCreateProject,
}) => {
  const { t } = useTranslation();
  const api = useAPI();
  const [nameQuery, setNameQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [typeKey, setTypeKey] = useState("all");
  const [tagKey, setTagKey] = useState("all");
  const [templateGroups, setTemplateGroups] = useState(() =>
    filterSidebarTemplateGroups([...DEFAULT_TEMPLATE_GROUPS]),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.callApi("configTemplates", {
        errorFilter: () => true,
      });
      if (cancelled || !res?.groups?.length) return;
      setTemplateGroups(filterSidebarTemplateGroups(res.groups));
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (tagKey === "all") return;
    if (!templateGroups.includes(tagKey)) setTagKey("all");
  }, [templateGroups, tagKey]);

  const tagFilters = useMemo(() => {
    return [
      { key: "all", labelKey: "All tags" },
      ...templateGroups.map((g) => ({ key: g, labelKey: g })),
    ];
  }, [templateGroups]);

  const filteredProjects = useMemo(() => {
    return projects.filter((project) => {
      if (
        appliedQuery &&
        !String(project.title ?? "")
          .toLowerCase()
          .includes(appliedQuery.toLowerCase())
      ) {
        return false;
      }
      if (typeKey !== "all" && pseudoTypeKey(project) !== typeKey) return false;
      if (
        tagKey !== "all" &&
        String(project.template_group ?? "").trim() !== tagKey
      ) {
        return false;
      }
      return true;
    });
  }, [projects, appliedQuery, typeKey, tagKey]);

  const onSearch = useCallback(() => {
    setAppliedQuery(nameQuery);
  }, [nameQuery]);

  const onResetFilters = useCallback(() => {
    setNameQuery("");
    setAppliedQuery("");
    setTypeKey("all");
    setTagKey("all");
  }, []);

  return (
    <div className={cn("projects-page").elem("studio").toClassName()}>
      <div className={cn("projects-page").elem("studio-layout").toClassName()}>
        <aside
          className={cn("projects-page").elem("sidebar").toClassName()}
          aria-label={t("Project filters")}
        >
          <div
            className={cn("projects-page")
              .elem("sidebar-section")
              .toClassName()}
          >
            <div
              className={cn("projects-page")
                .elem("sidebar-heading")
                .toClassName()}
            >
              {t("Data type")}
            </div>
            <div
              className={cn("projects-page").elem("chip-grid").toClassName()}
            >
              {TYPE_FILTERS.map(({ key, labelKey }) => (
                <button
                  key={key}
                  type="button"
                  className={cn("projects-page")
                    .elem("chip")
                    .mod({ active: typeKey === key })
                    .toClassName()}
                  onClick={() => setTypeKey(key)}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>
          <div
            className={cn("projects-page")
              .elem("sidebar-section")
              .toClassName()}
          >
            <div
              className={cn("projects-page")
                .elem("sidebar-heading")
                .toClassName()}
            >
              {t("Tags")}
            </div>
            <div className={cn("projects-page").elem("tag-list").toClassName()}>
              {tagFilters.map(({ key, labelKey }) => (
                <button
                  key={key}
                  type="button"
                  className={cn("projects-page")
                    .elem("tag-pill")
                    .mod({ active: tagKey === key })
                    .toClassName()}
                  onClick={() => setTagKey(key)}
                >
                  {t(labelKey, { defaultValue: labelKey })}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className={cn("projects-page").elem("studio-main").toClassName()}>
          <div className={cn("projects-page").elem("toolbar").toClassName()}>
            <div
              className={cn("projects-page")
                .elem("toolbar-search")
                .toClassName()}
            >
              <div
                className={cn("projects-page")
                  .elem("toolbar-inline")
                  .toClassName()}
              >
                <input
                  id="projects-search-name"
                  className={cn("projects-page")
                    .elem("search-input")
                    .toClassName()}
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  placeholder={t("Search projects placeholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSearch();
                  }}
                />
                <div
                  className={cn("projects-page")
                    .elem("toolbar-actions")
                    .toClassName()}
                >
                  <Button
                    type="button"
                    look="outlined"
                    variant="primary"
                    onClick={onSearch}
                  >
                    {t("Search")}
                  </Button>
                  <Button
                    type="button"
                    look="outlined"
                    variant="neutral"
                    onClick={onResetFilters}
                  >
                    {t("Reset")}
                  </Button>
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="primary"
              size="smaller"
              className={cn("projects-page").elem("create-wide").toClassName()}
              onClick={onCreateProject}
            >
              + {t("Create annotation project")}
            </Button>
          </div>

          <div
            className={cn("projects-page").elem("studio-scroll").toClassName()}
          >
            {filteredProjects.length === 0 ? (
              <div
                className={cn("projects-page")
                  .elem("empty-filter")
                  .toClassName()}
              >
                <EmptyData />
              </div>
            ) : (
              <div className={cn("projects-page").elem("grid").toClassName()}>
                {filteredProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    typeLabel={studioBadgeLabel(t, project)}
                  />
                ))}
              </div>
            )}
          </div>

          {totalItems > 0 &&
          (Math.ceil(totalItems / pageSize) > 1 ||
            totalItems >= PROJECTS_PAGINATION_FORCE_MIN) ? (
            <div className={cn("projects-page").elem("pages").toClassName()}>
              <PidataStylePagination
                totalItems={totalItems}
                page={currentPage}
                pageSize={pageSize}
                pageSizeOptions={[6, 12, 24, 30, 50, 100]}
                pageSizeStorageName="projects-list"
                urlParamName="page"
                onPageChange={(p, nextSize) => loadNextPage(p, nextSize)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const EmptyProjectsList = ({ openModal }) => {
  const { t } = useTranslation();
  return (
    <div className={cn("empty-projects-page").toClassName()}>
      <div className={cn("empty-projects-page").elem("panel").toClassName()}>
        <div
          className={cn("empty-projects-page").elem("icon-wrap").toClassName()}
        >
          <IconFolderOpen
            className={cn("empty-projects-page").elem("icon").toClassName()}
          />
        </div>
        <h1 className={cn("empty-projects-page").elem("header").toClassName()}>
          {t("Heidi doesn't see any projects here!")}
        </h1>
        <p className={cn("empty-projects-page").elem("desc").toClassName()}>
          {t("Create one and start labeling your data.")}
        </p>
        <Button
          onClick={openModal}
          variant="primary"
          className={cn("empty-projects-page").elem("create").toClassName()}
          aria-label={t("Create Project")}
        >
          {t("Create Project")}
        </Button>
      </div>
    </div>
  );
};

const ProjectCard = ({ project, typeLabel }) => {
  const { t } = useTranslation();
  const history = useHistory();
  const pc = cn("project-card");

  const createdByLabel = creatorDisplayLabel(
    project.created_by,
    t("Unknown user"),
  );

  const isWorkflow =
    project.task_workflow_enabled === true ||
    project.taskWorkflowEnabled === true;
  const isManager =
    project.can_manage_team === true || project.canManageTeam === true;

  const stageCounts =
    project.workflow_stage_counts ?? project.workflowStageCounts ?? {};
  const reviewCount = Number(stageCounts.review ?? 0);
  const acceptCount = Number(stageCounts.accept ?? 0);
  const doneCount = Number(stageCounts.done ?? 0);
  const totalTasks = Number(project.task_number ?? 0);

  const labeledCount = isWorkflow
    ? reviewCount + acceptCount + doneCount
    : Number(project.finished_task_number ?? 0);
  const reviewedCount = acceptCount + doneCount;

  const openProjectData = () => {
    if (isManager) {
      history.push(`/projects/${project.id}/data`);
      return;
    }
    if (isWorkflow) {
      history.push("/my-tasks");
      return;
    }
    history.push(`/projects/${project.id}/data`);
  };

  return (
    <div className={cn("projects-page").elem("link").toClassName()}>
      <article
        className={cn("project-card").mod({ studio: true }).toClassName()}
        onClick={(e) => {
          if (e.target.closest("a")) return;
          openProjectData();
        }}
      >
        <div className={cn("project-card").elem("studio-top").toClassName()}>
          <div className={cn("project-card").elem("title-row").toClassName()}>
            <div
              className={cn("project-card").elem("title-wrap").toClassName()}
            >
              <Tooltip title={project.title ?? t("New project")}>
                <h3
                  className={cn("project-card")
                    .elem("studio-title")
                    .toClassName()}
                >
                  {project.title ?? t("New project")}
                </h3>
              </Tooltip>
            </div>
            <div className={cn("project-card").elem("actions").toClassName()}>
              {isManager && (
                <>
                  <Link
                    className={cn(
                      buttonVariant({
                        size: "small",
                        look: "string",
                        variant: "primary",
                      }),
                      pc.elem("action-btn").toClassName(),
                    )}
                    to={`/projects/${project.id}/settings`}
                    data-external
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t("Settings")}
                  </Link>
                  <Link
                    className={cn(
                      buttonVariant({
                        size: "small",
                        look: "string",
                        variant: "primary",
                      }),
                      pc.elem("action-btn").toClassName(),
                    )}
                    to={`/projects/${project.id}/team-workflow`}
                    data-external
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t("Personnel management")}
                  </Link>
                </>
              )}
              <Link
                className={cn(
                  buttonVariant({
                    size: "small",
                    look: "string",
                    variant: "primary",
                  }),
                  pc.elem("action-btn").toClassName(),
                )}
                to={
                  isManager
                    ? `/projects/${project.id}/data`
                    : isWorkflow
                      ? "/my-tasks"
                      : `/projects/${project.id}/data?labeling=1`
                }
                data-external
                onClick={(e) => e.stopPropagation()}
              >
                {isManager ? t("DataManager") : t("Label")}
              </Link>
            </div>
          </div>
          <div className={cn("project-card").elem("subtitle").toClassName()}>
            {t("Annotation center")}
          </div>
          <div className={cn("project-card").elem("badges").toClassName()}>
            <span className={cn("project-card").elem("badge").toClassName()}>
              {typeLabel}
            </span>
            {project.state && (
              <span
                className={cn("project-card")
                  .elem("state-inline")
                  .toClassName()}
              >
                <ProjectStateChip
                  state={project.state}
                  projectId={project.id}
                  interactive={false}
                />
              </span>
            )}
          </div>
        </div>

        <p className={cn("project-card").elem("studio-desc").toClassName()}>
          {project.description?.trim()
            ? project.description
            : t("Optional description of your project")}
        </p>

        <div className={cn("project-card").elem("studio-stats").toClassName()}>
          <div
            className={cn("project-card").elem("progress-list").toClassName()}
          >
            <div
              className={cn("project-card").elem("progress-row").toClassName()}
            >
              <span
                className={cn("project-card")
                  .elem("progress-label")
                  .toClassName()}
              >
                {t("Labeling progress")}
              </span>
              <span
                className={cn("project-card")
                  .elem("progress-value")
                  .toClassName()}
              >
                {labeledCount} / {totalTasks}
              </span>
            </div>
            {isWorkflow && (
              <div
                className={cn("project-card")
                  .elem("progress-row")
                  .toClassName()}
              >
                <span
                  className={cn("project-card")
                    .elem("progress-label")
                    .toClassName()}
                >
                  {t("Review progress")}
                </span>
                <span
                  className={cn("project-card")
                    .elem("progress-value")
                    .toClassName()}
                >
                  {reviewedCount} / {totalTasks}
                </span>
              </div>
            )}
          </div>
          <div className={cn("project-card").elem("detail").toClassName()}>
            <div
              className={cn("project-card")
                .elem("detail-item")
                .mod({ type: "completed" })
                .toClassName()}
            >
              <IconCheck
                className={cn("project-card").elem("icon").toClassName()}
              />
              {project.total_annotations_number}
            </div>
            <div
              className={cn("project-card")
                .elem("detail-item")
                .mod({ type: "rejected" })
                .toClassName()}
            >
              <IconMinus
                className={cn("project-card").elem("icon").toClassName()}
              />
              {project.skipped_annotations_number}
            </div>
            <div
              className={cn("project-card")
                .elem("detail-item")
                .mod({ type: "predictions" })
                .toClassName()}
            >
              <IconSparks
                className={cn("project-card").elem("icon").toClassName()}
              />
              {project.total_predictions_number}
            </div>
          </div>
        </div>

        <div className={cn("project-card").elem("studio-footer").toClassName()}>
          <span className={cn("project-card").elem("meta").toClassName()}>
            {createdByLabel} {t("created at")}{" "}
            {format(new Date(project.created_at), "yyyy-MM-dd HH:mm:ss")}
          </span>
        </div>
      </article>
    </div>
  );
};
