import React, { useState } from "react";
import { useParams as useRouterParams } from "react-router";
import { Redirect } from "react-router-dom";
import { Button } from "@humansignal/ui";
import { Oneof } from "../../components/Oneof/Oneof";
import { Spinner } from "../../components/Spinner/Spinner";
import { ApiContext } from "../../providers/ApiProvider";
import { useContextProps } from "../../providers/RoutesProvider";
import { cn } from "../../utils/bem";
import { CreateProject } from "../CreateProject/CreateProject";
import { DataManagerPage } from "../DataManager/DataManager";
import { ProjectTeamWorkflowPage } from "../ProjectTeamWorkflow/ProjectTeamWorkflowPage";
import { SettingsPage } from "../Settings";
import { EmptyProjectsList, ProjectsList } from "./ProjectsList";
import { useAbortController, useUpdatePageTitle } from "@humansignal/core";
import { isWujieEmbed, waitForMainPlatformToken } from "../../utils/getMainPlatformToken";
import "./Projects.scss";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getCurrentPage = () => {
  const pageNumberFromURL = new URLSearchParams(location.search).get("page");

  return pageNumberFromURL ? Number.parseInt(pageNumberFromURL) : 1;
};

/** 项目卡片列表每页条数：未写入 localStorage 时默认 6（与父平台数据集分页密度一致） */
const getProjectsListPageSize = () => {
  const raw = localStorage.getItem("pages:projects-list");
  if (raw == null || raw === "") return 6;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 6;
};

export const ProjectsPage = () => {
  const api = React.useContext(ApiContext);
  const abortController = useAbortController();
  const [projectsList, setProjectsList] = React.useState([]);
  const [networkState, setNetworkState] = React.useState(null);
  const [currentPage, setCurrentPage] = useState(getCurrentPage());
  const [totalItems, setTotalItems] = useState(1);
  const setContextProps = useContextProps();

  useUpdatePageTitle("Projects");
  const defaultPageSize = getProjectsListPageSize();

  const [modal, setModal] = React.useState(false);

  const openModal = () => setModal(true);

  const closeModal = () => setModal(false);

  const fetchProjects = async (page = currentPage, pageSize = defaultPageSize) => {
    setNetworkState("loading");
    abortController.renew(); // Cancel any in flight requests

    const signal = abortController.controller.current.signal;
    const isAbortedError = (e) => e.error?.includes?.("aborted");
    const embedMode = isWujieEmbed();

    const requestParams = { page, page_size: pageSize };

    requestParams.include = [
      "id",
      "title",
      "created_by",
      "created_at",
      "color",
      "is_published",
      "assignment_settings",
      "state",
      "template_group",
      "data_type_category",
    ].join(",");

    const callProjects = (suppressError = false) =>
      api.callApi("projects", {
        params: requestParams,
        signal,
        suppressError,
        errorFilter: isAbortedError,
      });

    if (embedMode && typeof window !== "undefined" && window.__POWERED_BY_WUJIE__) {
      await waitForMainPlatformToken({ timeoutMs: 3000 });
    }

    // Embed: suppress error modal on first attempt(s) — token/gateway may not be ready yet.
    let data = await callProjects(embedMode);

    if ((!data || data.error) && embedMode && !signal.aborted) {
      await sleep(400);
      await waitForMainPlatformToken({ timeoutMs: 2000 });
      const retryData = await callProjects(true);
      if (retryData && !retryData.error) {
        data = retryData;
        api.resetError?.();
      }
    }

    if (signal.aborted) return;

    if (!data || data.error) {
      if (embedMode) await callProjects(false);
      setProjectsList([]);
      setTotalItems(1);
      setNetworkState("loaded");
      return;
    }

    setTotalItems(data.count ?? 1);
    setProjectsList(data.results ?? []);
    setNetworkState("loaded");

    if (data.results?.length) {
      const additionalData = await api.callApi("projects", {
        params: {
          ids: data.results.map(({ id }) => id).join(","),
          include: [
            "id",
            "description",
            "num_tasks_with_annotations",
            "task_number",
            "skipped_annotations_number",
            "total_annotations_number",
            "total_predictions_number",
            "ground_truth_number",
            "finished_task_number",
            "can_manage_team",
            "task_workflow_enabled",
            "workflow_stage_counts",
            "template_group",
            "data_type_category",
          ].join(","),
          page_size: pageSize,
        },
        signal,
        errorFilter: isAbortedError,
      });

      if (additionalData?.results?.length) {
        setProjectsList((prev) =>
          additionalData.results.map((project) => {
            const prevProject = prev.find(({ id }) => id === project.id);

            return {
              ...prevProject,
              ...project,
            };
          }),
        );
      }
    }
  };

  const loadNextPage = async (page, pageSize) => {
    setCurrentPage(page);
    await fetchProjects(page, pageSize);
  };

  React.useEffect(() => {
    fetchProjects();
  }, []);

  React.useEffect(() => {
    // there is a nice page with Create button when list is empty
    // so don't show the context button in that case
    setContextProps({ openModal, showButton: projectsList.length > 0 });
  }, [projectsList.length]);

  return (
    <div className={cn("projects-page").toClassName()}>
      <Oneof value={networkState}>
        <div className={cn("projects-page").elem("loading").toClassName()} case="loading">
          <Spinner size={32} />
        </div>
        <div className={cn("projects-page").elem("content").toClassName()} case="loaded">
          {projectsList.length ? (
            <ProjectsList
              projects={projectsList}
              currentPage={currentPage}
              totalItems={totalItems}
              loadNextPage={loadNextPage}
              pageSize={defaultPageSize}
              onCreateProject={openModal}
            />
          ) : (
            <EmptyProjectsList openModal={openModal} />
          )}
          {modal && <CreateProject onClose={closeModal} />}
        </div>
      </Oneof>
    </div>
  );
};

ProjectsPage.title = "Projects";
ProjectsPage.path = "/projects";
ProjectsPage.exact = true;
ProjectsPage.routes = ({ store }) => [
  {
    title: () => store.project?.title,
    path: "/:id(\\d+)",
    exact: true,
    component: () => {
      const params = useRouterParams();

      return <Redirect to={`/projects/${params.id}/data`} />;
    },
    pages: {
      DataManagerPage,
      SettingsPage,
      ProjectTeamWorkflowPage,
    },
  },
];
ProjectsPage.context = ({ openModal, showButton }) => {
  if (!showButton) return null;
  return (
    <Button onClick={openModal} size="small" aria-label="Create new project">
      Create
    </Button>
  );
};
