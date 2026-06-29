import React from "react";
import { useAPI } from "../../../providers/ApiProvider";

const DEFAULT_LOCAL_PROJECT = {
  label_config: "<View></View>",
};

async function generateDraftTitle(api) {
  const response = await api.callApi("projects", { errorFilter: () => true });
  const projects = response?.results ?? [];
  let projectNumber = projects.length + 1;
  let projectName = `New Project #${projectNumber}`;

  while (projects.find(({ title }) => title === projectName)) {
    projectNumber++;
    projectName = `New Project #${projectNumber}`;
  }

  return projectName;
}

/**
 * Local draft for the create wizard. Backend draft (is_draft=true) is created lazily
 * when the user triggers an action that needs project.id (e.g. parent-dataset sync).
 */
export const useDraftProject = () => {
  const api = useAPI();
  const [project, setProject] = React.useState(() => ({ ...DEFAULT_LOCAL_PROJECT }));
  const projectRef = React.useRef(project);
  const ensurePromiseRef = React.useRef(null);

  React.useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const ensureBackendDraft = React.useCallback(
    async (partial = {}) => {
      if (projectRef.current?.id) {
        return projectRef.current;
      }

      if (ensurePromiseRef.current) {
        return ensurePromiseRef.current;
      }

      const run = async () => {
        const title = partial.title?.trim() || (await generateDraftTitle(api));
        const body = {
          title,
          is_draft: true,
          label_config: partial.label_config ?? DEFAULT_LOCAL_PROJECT.label_config,
          description: partial.description ?? "",
          data_type_category: partial.data_type_category ?? "general",
          template_group: partial.template_group ?? "",
        };

        const draft = await api.callApi("createProject", {
          body,
          errorFilter: () => true,
        });

        if (!draft || draft.error) {
          throw new Error(draft?.error || draft?.detail || "Failed to create draft project");
        }

        setProject(draft);
        projectRef.current = draft;
        return draft;
      };

      ensurePromiseRef.current = run();

      try {
        return await ensurePromiseRef.current;
      } finally {
        ensurePromiseRef.current = null;
      }
    },
    [api],
  );

  const discardBackendDraft = React.useCallback(async () => {
    const current = projectRef.current;

    if (current?.id && current.is_draft !== false) {
      await api.callApi("deleteProject", {
        params: { pk: current.id },
        errorFilter: () => true,
      });
    }

    setProject({ ...DEFAULT_LOCAL_PROJECT });
    projectRef.current = { ...DEFAULT_LOCAL_PROJECT };
    ensurePromiseRef.current = null;
  }, [api]);

  const resetProject = React.useCallback(() => {
    setProject({ ...DEFAULT_LOCAL_PROJECT });
    projectRef.current = { ...DEFAULT_LOCAL_PROJECT };
    ensurePromiseRef.current = null;
  }, []);

  return { project, setProject, resetProject, ensureBackendDraft, discardBackendDraft };
};
