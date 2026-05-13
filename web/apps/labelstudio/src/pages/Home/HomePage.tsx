import { IconFolderAdd, IconUserAdd, IconFolderOpen } from "@humansignal/icons";
import { Button, SimpleCard, Spinner, Tooltip, Typography } from "@humansignal/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useUpdatePageTitle } from "@humansignal/core";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useAPI } from "../../providers/ApiProvider";
import { CreateProject } from "../CreateProject/CreateProject";
import { InviteLink } from "../Organization/PeoplePage/InviteLink";
import type { Page } from "../types/Page";
import {
  creationDialogOpen,
  invitationOpen,
  locationKeyAtom,
  PROJECTS_TO_SHOW,
  projectsDataAtom,
  sortedProjectsAtom,
  visitedIdsAtom,
} from "./atoms";

const actions = [
  {
    title: "Create Project",
    icon: IconFolderAdd,
    type: "createProject",
  },
  {
    title: "Invite Members",
    icon: IconUserAdd,
    type: "inviteMembers",
  },
] as const;

type Action = (typeof actions)[number]["type"];

export const HomePage: Page = () => {
  const { t } = useTranslation();
  const api = useAPI();
  const location = useLocation();
  const [modalIsOpen, setModalIsOpen] = useAtom(creationDialogOpen);
  const [invitationIsOpen, setInvitationIsOpen] = useAtom(invitationOpen);
  const setLocationKey = useSetAtom(locationKeyAtom);
  const setProjectsData = useSetAtom(projectsDataAtom);
  const sortedProjects = useAtomValue(sortedProjectsAtom);
  const visitedIds = useAtomValue(visitedIdsAtom);

  useUpdatePageTitle("Home");

  // Fetch regular projects
  const { data, isFetching, isSuccess, isError } = useQuery({
    queryKey: ["projects", { page_size: PROJECTS_TO_SHOW }],
    async queryFn() {
      const res = await api.callApi<{ results: APIProject[]; count: number }>("projects", {
        params: { page_size: PROJECTS_TO_SHOW },
      });
      console.log("[LS-embed] HomePage projects", { count: res?.count, resultsLen: res?.results?.length });
      return res;
    },
  });

  useEffect(() => {
    console.log("[LS-embed] HomePage render", { isFetching, isSuccess, isError, hasData: !!data });
  }, [isFetching, isSuccess, isError, data]);

  // Fetch visited projects specifically by their IDs
  const { data: visitedProjectsData } = useQuery({
    queryKey: ["visited-projects", { ids: visitedIds }],
    async queryFn() {
      if (visitedIds.length === 0) return { results: [], count: 0 };

      return api.callApi<{ results: APIProject[]; count: number }>("projects", {
        params: {
          ids: visitedIds.join(","),
          page_size: visitedIds.length,
        },
      });
    },
    enabled: visitedIds.length > 0,
  });

  // Update location key atom when navigating to/returning to this page
  // This triggers visitedIdsAtom to re-read from localStorage
  // We use a timestamp to ensure the atom always updates, forcing a re-read
  useEffect(() => {
    setLocationKey(Date.now().toString());
  }, [location.pathname, setLocationKey]);

  // Merge visited and regular projects, removing duplicates
  useEffect(() => {
    const visitedProjects = visitedProjectsData?.results ?? [];
    const regularProjects = data?.results ?? [];

    // Merge and deduplicate
    const allProjects = [...visitedProjects, ...regularProjects];
    const uniqueProjects = Array.from(new Map(allProjects.map((p) => [p.id, p])).values());

    if (uniqueProjects.length > 0) {
      setProjectsData(uniqueProjects);
    }
  }, [data?.results, visitedProjectsData?.results, setProjectsData]);

  const handleActions = (action: Action) => {
    return () => {
      switch (action) {
        case "createProject":
          setModalIsOpen(true);
          break;
        case "inviteMembers":
          setInvitationIsOpen(true);
          break;
      }
    };
  };

  return (
    <main className="p-6 bg-[#f5f7fb] min-h-full">
      <section className="flex flex-col gap-4 max-w-6xl">
        <div className="flex flex-col gap-1">
          <Typography variant="headline" size="small">
            {t("欢迎，辰龙多模态标注平台！")}
          </Typography>
          <Typography size="small" className="text-neutral-content-subtler">
            {t("Let's get you started.")}
          </Typography>
        </div>
        <div className="flex justify-start gap-3 flex-wrap">
          {actions.map((action) => {
            return (
              <Button
                key={action.title}
                look="outlined"
                align="center"
                className="flex-grow-0 text-16/24 gap-2 text-primary-content text-left min-w-[220px] h-10 rounded-md border-[#d8e2f0] bg-white [&_svg]:w-5 [&_svg]:h-5 pl-3"
                onClick={handleActions(action.type)}
                leading={<action.icon />}
              >
                {t(action.title)}
              </Button>
            );
          })}
        </div>

        <SimpleCard
          className="rounded-xl border border-[#e8edf5] shadow-[0_8px_24px_rgba(20,40,90,0.06)] bg-white"
          title={
            data && data?.count > 0 ? (
              <>
                {t("Recent Projects")}{" "}
                {/* <a href="/projects" className="text-lg font-normal hover:underline">
                    {t("View All")}
                  </a> */}
              </>
            ) : null
          }
        >
          {isFetching ? (
            <div className="h-64 flex justify-center items-center">
              <Spinner />
            </div>
          ) : isError ? (
            <div className="h-64 flex justify-center items-center">{t("can't load projects")}</div>
          ) : isSuccess && data && sortedProjects.length === 0 ? (
            <div className="flex flex-col justify-center items-center border border-[#dbe5f4] bg-[#f7faff] rounded-xl h-64">
              <div
                className="rounded-2xl w-14 h-14 flex justify-center items-center bg-[#e8f2ff] text-[#2f6bff]"
              >
                <IconFolderOpen />
              </div>
              <Typography variant="headline" size="small" className="mt-3">
                {t("Create your first project")}
              </Typography>
              <Typography size="small" className="text-neutral-content-subtler max-w-[420px] text-center">
                {t("Import your data and set up the labeling interface to start annotating")}
              </Typography>
              <Button className="mt-4 rounded-md px-5" onClick={() => setModalIsOpen(true)} aria-label={t("Create Project")}>
                {t("Create Project")}
              </Button>
            </div>
          ) : isSuccess && data && sortedProjects.length > 0 ? (
            <div className="flex flex-col gap-1">
              {sortedProjects.map((project) => {
                return <ProjectSimpleCard key={project.id} project={project} t={t} />;
              })}
            </div>
          ) : null}
        </SimpleCard>
      </section>
      {modalIsOpen && <CreateProject onClose={() => setModalIsOpen(false)} />}
      <InviteLink opened={invitationIsOpen} onClosed={() => setInvitationIsOpen(false)} />
    </main>
  );
};

HomePage.title = "Home";
HomePage.path = "/";
HomePage.exact = true;

function ProjectSimpleCard({
  project,
  t,
}: {
  project: APIProject;
  t: (key: string, opts?: Record<string, number>) => string;
}) {
  const finished = project.finished_task_number ?? 0;
  const total = project.task_number ?? 0;
  const progress = (total > 0 ? finished / total : 0) * 100;
  const white = "#FFFFFF";
  const color = project.color && project.color !== white ? project.color : "#E1DED5";

  return (
    <Link
      to={`/projects/${project.id}`}
      className="block even:bg-neutral-surface rounded-sm overflow-hidden"
      data-external
    >
      <div
        className="grid grid-cols-[minmax(0,1fr)_150px] p-2 py-3 items-center border-l-[3px]"
        style={{ borderLeftColor: color }}
      >
        <div className="flex flex-col gap-1">
          <Tooltip title={project.title}>
            <span className="text-neutral-content truncate">{project.title}</span>
          </Tooltip>
          <div className="text-neutral-content-subtler text-sm">
            {t("{{finished}} of {{total}} Tasks", { finished, total })} ({total > 0 ? Math.round((finished / total) * 100) : 0}%)
          </div>
        </div>
        <div className="bg-neutral-surface rounded-full overflow-hidden w-full h-2 shadow-neutral-border-subtle shadow-border-1">
          <div className="bg-positive-surface-hover h-full" style={{ maxWidth: `${progress}%` }} />
        </div>
      </div>
    </Link>
  );
}
