import React from "react";

const DEFAULT_LOCAL_PROJECT = {
  label_config: "<View></View>",
};

/**
 * Local-only project draft for the create wizard.
 * No API call until the user clicks Save in CreateProject.
 */
export const useDraftProject = () => {
  const [project, setProject] = React.useState(() => ({ ...DEFAULT_LOCAL_PROJECT }));

  const resetProject = React.useCallback(() => {
    setProject({ ...DEFAULT_LOCAL_PROJECT });
  }, []);

  return { project, setProject, resetProject };
};
