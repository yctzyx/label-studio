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
import {
  DEFAULT_TEMPLATE_GROUPS,
  PROJECT_TYPE_FILTERS,
  filterSidebarTemplateGroups,
} from "../Projects/projectTaxonomy";

const taxonomyClass = cn("project-taxonomy");

const ProjectName = ({
  name,
  setName,
  onSaveName,
  onSubmit,
  error,
  description,
  setDescription,
  dataTypeCategory,
  onDataTypeChange,
  templateGroup,
  onTemplateGroupChange,
  templateGroups,
  metaError,
  show = true,
}) => {
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

      <div className={taxonomyClass.elem("section").toClassName()}>
        <div className={taxonomyClass.elem("heading").toClassName()}>{t("Data type")}</div>
        <div className={taxonomyClass.elem("chip-grid").toClassName()}>
          {PROJECT_TYPE_FILTERS.map(({ key, labelKey }) => (
            <button
              key={key}
              type="button"
              className={taxonomyClass.elem("chip").mod({ active: dataTypeCategory === key }).toClassName()}
              onClick={() => onDataTypeChange(key)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className={taxonomyClass.elem("section").toClassName()}>
        <div className={taxonomyClass.elem("heading").toClassName()}>{t("Tags")}</div>
        <div className={taxonomyClass.elem("tag-list").toClassName()}>
          {templateGroups.map((group) => (
            <button
              key={group}
              type="button"
              className={taxonomyClass.elem("tag-pill").mod({ active: templateGroup === group }).toClassName()}
              onClick={() => onTemplateGroupChange(group)}
            >
              {t(group, { defaultValue: group })}
            </button>
          ))}
        </div>
        {metaError && <span className="text-negative-content text-body-small">{metaError}</span>}
      </div>

      <div className="project-name__description-field w-full min-w-0 flex flex-col gap-2">
        <label className="w-full" htmlFor="project_description">
          {t("Description")}
        </label>
        <TextArea
          name="description"
          id="project_description"
          placeholder={t("Optional description of your project")}
          rows={8}
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
  const [metaError, setMetaError] = React.useState();
  const [description, setDescription] = React.useState("");
  const [dataTypeCategory, setDataTypeCategory] = React.useState("general");
  const [templateGroup, setTemplateGroup] = React.useState("");
  const [templateGroups, setTemplateGroups] = React.useState(() =>
    filterSidebarTemplateGroups([...DEFAULT_TEMPLATE_GROUPS]),
  );
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

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await api.callApi("configTemplates", { errorFilter: () => true });
      if (cancelled || !res?.groups?.length) return;
      setTemplateGroups(filterSidebarTemplateGroups(res.groups));
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const { columns, uploading, uploadDisabled, hasImportData, finishUpload, pageProps, uploadSample } = useImportPage(
    project,
    sample,
  );

  const rootClass = cn("create-project");
  const tabClass = rootClass.elem("tab");
  const steps = React.useMemo(
    () => ({
      name: <span className={tabClass.mod({ disabled: !!error || !!metaError })}>{t("Project Name")}</span>,
      import: <span className={tabClass.mod({ disabled: uploadDisabled })}>{t("Data Import")}</span>,
      config: t("Labeling Setup"),
    }),
    [t, error, metaError, uploadDisabled, tabClass],
  );

  const step1SyncedFromProject = React.useRef(false);

  React.useEffect(() => {
    if (!project || step1SyncedFromProject.current) return;
    setName(project.title ?? "");
    setDataTypeCategory(project.data_type_category || "general");
    setTemplateGroup(String(project.template_group ?? "").trim());
    step1SyncedFromProject.current = true;
  }, [project]);

  const persistProjectMeta = React.useCallback(
    async (patch) => {
      if (!project) return false;

      const res = await api.callApi("updateProject", {
        params: { pk: project.id },
        body: patch,
        errorFilter: () => true,
      });

      if (res === null || res?.error) return false;

      updateProject({ ...project, ...patch });
      return true;
    },
    [api, project, updateProject],
  );

  const projectBody = React.useMemo(
    () => ({
      title: name,
      description,
      label_config: project?.label_config ?? "<View></View>",
      data_type_category: dataTypeCategory,
      template_group: templateGroup,
    }),
    [name, description, project?.label_config, dataTypeCategory, templateGroup],
  );

  const onCreate = React.useCallback(async () => {
    if (!templateGroup.trim()) {
      setMetaError(t("validators.field_required", { field: t("Tags") }));
      setStep("name");
      return;
    }

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
  }, [project, projectBody, finishUpload, templateGroup, t, setStep]);

  const onSaveName = async () => {
    if (error || !project) return;

    const trimmed = name.trim();

    if (!trimmed) {
      setError(t("validators.field_required", { field: t("Project Name") }));
      return;
    }

    if (trimmed === project.title) return;

    const res = await api.callApi("updateProjectRaw", {
      params: {
        pk: project.id,
      },
      body: {
        title: trimmed,
      },
    });

    if (res.ok) {
      updateProject({ ...project, title: trimmed });
      if (trimmed !== name) setName(trimmed);
      return;
    }

    const err = await res.json();

    setError(err.validation_errors?.title);
  };

  const onDataTypeChange = React.useCallback(
    async (key) => {
      setDataTypeCategory(key);
      setMetaError(null);
      await persistProjectMeta({ data_type_category: key });
    },
    [persistProjectMeta],
  );

  const onTemplateGroupChange = React.useCallback(
    async (group) => {
      setTemplateGroup(group);
      setMetaError(null);
      await persistProjectMeta({ template_group: group });
    },
    [persistProjectMeta],
  );

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
              disabled={!project || uploadDisabled || error || metaError || !hasImportData || !templateGroup.trim()}
            >
              {t("Save")}
            </Button>
          </Space>
        </Modal.Header>
        <ProjectName
          name={name}
          setName={setName}
          error={error}
          metaError={metaError}
          onSaveName={onSaveName}
          onSubmit={onCreate}
          description={description}
          setDescription={setDescription}
          dataTypeCategory={dataTypeCategory}
          onDataTypeChange={onDataTypeChange}
          templateGroup={templateGroup}
          onTemplateGroupChange={onTemplateGroupChange}
          templateGroups={templateGroups}
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
            const nextGroup = group ?? "";
            setTemplateGroup(nextGroup);
            updateProject({ ...project, template_group: nextGroup });
            void api.callApi("updateProject", {
              params: { pk: project.id },
              body: { template_group: nextGroup },
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
