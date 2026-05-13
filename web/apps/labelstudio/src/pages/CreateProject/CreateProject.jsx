import React from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router";
import { ToggleItems } from "../../components";
import { Button } from "@humansignal/ui";
import { Modal } from "../../components/Modal/Modal";
import { Space } from "../../components/Space/Space";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import { ConfigPage } from "./Config/Config";
import "./CreateProject.scss";
import { ImportPage } from "./Import/Import";
import { useImportPage } from "./Import/useImportPage";
import { useDraftProject } from "./utils/useDraftProject";
import { Input, TextArea } from "../../components/Form";

const ProjectName = ({ name, setName, onSaveName, onSubmit, error, description, setDescription, show = true }) => {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <form
      className={cn("project-name")}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="w-full flex flex-col gap-2">
        <label className="w-full" htmlFor="project_name">
          {t("Project Name")}
        </label>
        <Input
          name="name"
          id="project_name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={onSaveName}
          className="project-title w-full"
        />
        {error && <span className="-mt-1 text-negative-content">{error}</span>}
      </div>
      <div className="project-name__description-field w-full min-w-0 flex flex-col gap-2">
        <label className="w-full" htmlFor="project_description">
          {t("Description")}
        </label>
        <TextArea
          name="description"
          id="project_description"
          placeholder={t("Optional description of your project")}
          rows={16}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="project-description w-full"
        />
      </div>
    </form>
  );
};

export const CreateProject = ({ onClose }) => {
  const { t } = useTranslation();
  const [step, _setStep] = React.useState("name"); // name | import | config
  const [waiting, setWaitingStatus] = React.useState(false);

  const { project, setProject: updateProject } = useDraftProject();
  const history = useHistory();
  const api = useAPI();

  const [name, setName] = React.useState("");
  const [error, setError] = React.useState();
  const [description, setDescription] = React.useState("");
  const [sample, setSample] = React.useState(null);

  const setStep = React.useCallback((step) => {
    _setStep(step);
    const eventNameMap = {
      name: "project_name",
      import: "data_import",
      config: "labeling_setup",
    };
    __lsa(`create_project.tab.${eventNameMap[step]}`);
  }, []);

  React.useEffect(() => {
    setError(null);
  }, [name]);

  const { columns, uploading, uploadDisabled, hasImportData, finishUpload, pageProps, uploadSample } = useImportPage(
    project,
    sample,
  );

  const rootClass = cn("create-project");
  const tabClass = rootClass.elem("tab");
  const steps = React.useMemo(
    () => ({
      name: <span className={tabClass.mod({ disabled: !!error })}>{t("Project Name")}</span>,
      import: <span className={tabClass.mod({ disabled: uploadDisabled })}>{t("Data Import")}</span>,
      config: t("Labeling Setup"),
    }),
    [t, error, uploadDisabled, tabClass],
  );

  // name intentionally skipped from deps:
  // this should trigger only once when we got project loaded
  React.useEffect(() => {
    project && !name && setName(project.title);
  }, [project]);

  const projectBody = React.useMemo(
    () => ({
      title: name,
      description,
      label_config: project?.label_config ?? "<View></View>",
    }),
    [name, description, project?.label_config],
  );

  const onCreate = React.useCallback(async () => {
    // First, persist project with label_config so import/reimport validates against it
    const response = await api.callApi("updateProject", {
      params: {
        pk: project.id,
      },
      body: { ...projectBody, is_draft: false },
    });

    if (response === null) return;

    const imported = await finishUpload();

    if (!imported) return;

    setWaitingStatus(true);

    if (sample) await uploadSample(sample);

    __lsa("create_project.create", { sample: sample?.url });

    setWaitingStatus(false);

    history.push(`/projects/${response.id}/data`);
  }, [project, projectBody, finishUpload]);

  const onSaveName = async () => {
    if (error) return;
    const res = await api.callApi("updateProjectRaw", {
      params: {
        pk: project.id,
      },
      body: {
        title: name,
      },
    });

    if (res.ok) return;
    const err = await res.json();

    setError(err.validation_errors?.title);
  };

  const onDelete = React.useCallback(() => {
    const performClose = async () => {
      setWaitingStatus(true);
      if (project)
        await api.callApi("deleteProject", {
          params: {
            pk: project.id,
          },
        });
      setWaitingStatus(false);
      updateProject(null);
      onClose?.();
    };
    performClose();
  }, [project]);

  return (
    <Modal onHide={onDelete} closeOnClickOutside={false} allowToInterceptEscape fullscreen visible bare>
      <div className={rootClass}>
        <Modal.Header>
          <h1>{t("Create Project")}</h1>
          <ToggleItems className={rootClass.elem("steps").toClassName()} items={steps} active={step} onSelect={setStep} />

          <Space>
            <Button
              variant="negative"
              look="outlined"
              className={rootClass.elem("header-btn").mod({ cancel: true }).toClassName()}
              onClick={onDelete}
              waiting={waiting}
              aria-label={t("Cancel project creation")}
            >
              {t("Cancel")}
            </Button>
            <Button
              look="primary"
              className={rootClass.elem("header-btn").mod({ save: true }).toClassName()}
              onClick={onCreate}
              waiting={waiting || uploading}
              waitingClickable={false}
              disabled={!project || uploadDisabled || error || !hasImportData}
            >
              {t("Save")}
            </Button>
          </Space>
        </Modal.Header>
        <ProjectName
          name={name}
          setName={setName}
          error={error}
          onSaveName={onSaveName}
          onSubmit={onCreate}
          description={description}
          setDescription={setDescription}
          show={step === "name"}
        />
        <ImportPage
          project={project}
          show={step === "import"}
          sample={sample}
          onSampleDatasetSelect={setSample}
          openLabelingConfig={() => setStep("config")}
          {...pageProps}
        />
        <ConfigPage
          project={project}
          onUpdate={(config) => {
            updateProject({ ...project, label_config: config });
          }}
          onTemplateGroupChange={(group) => {
            if (!project) return;
            updateProject({ ...project, template_group: group });
            void api.callApi("updateProject", {
              params: { pk: project.id },
              body: { template_group: group },
              errorFilter: () => true,
            });
          }}
          show={step === "config"}
          columns={columns}
          disableSaveButton={true}
        />
      </div>
    </Modal>
  );
};
