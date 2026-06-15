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
import { importFiles } from "./Import/utils";

function mapParentSelectionToPayload(selection) {
  if (!selection) return null;
  return {
    dataset_id: selection.datasetId,
    dataset_name: selection.datasetName,
    source_id: selection.sourceId,
    source_name: selection.sourceName,
    path: selection.path,
    data_set_type: selection.dataSetType,
    data_set_type_label: selection.dataSetTypeLabel,
  };
}

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

  const { project, setProject: updateProject, resetProject } = useDraftProject();
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

  const { columns, uploading, uploadDisabled, hasImportData, finishUpload, pageProps, parentDatasetSelection } =
    useImportPage(project, sample);

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
    if (!project?.id || step1SyncedFromProject.current) return;
    setName(project.title ?? "");
    setDataTypeCategory(project.data_type_category || "general");
    setTemplateGroup(String(project.template_group ?? "").trim());
    step1SyncedFromProject.current = true;
  }, [project]);

  const persistProjectMeta = React.useCallback(
    (patch) => {
      updateProject({ ...project, ...patch });
      return true;
    },
    [project, updateProject],
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
    const trimmedName = name.trim();

    if (!trimmedName) {
      setError(t("validators.field_required", { field: t("Project Name") }));
      setStep("name");
      return;
    }

    if (!templateGroup.trim()) {
      setMetaError(t("validators.field_required", { field: t("Tags") }));
      setStep("name");
      return;
    }

    setWaitingStatus(true);

    const createBody = {
      ...projectBody,
      title: trimmedName,
      is_draft: false,
    };

    const parentPayload = mapParentSelectionToPayload(parentDatasetSelection);
    if (parentPayload) {
      createBody.parent_platform_dataset = parentPayload;
    }

    const response = await api.callApi("createProject", {
      body: createBody,
    });

    if (!response || response.error) {
      setWaitingStatus(false);
      return;
    }

    const imported = await finishUpload(response);

    if (!imported) {
      await api.callApi("deleteProject", {
        params: { pk: response.id },
        errorFilter: () => true,
      });
      setWaitingStatus(false);
      return;
    }

    if (sample) {
      const body = new URLSearchParams({ url: sample.url });
      await importFiles({
        files: [{ name: sample.url }],
        body,
        project: response,
      });
    }

    __lsa("create_project.create", { sample: sample?.url });

    setWaitingStatus(false);
    resetProject();
    history.push(`/projects/${response.id}/data`);
  }, [
    name,
    projectBody,
    finishUpload,
    templateGroup,
    parentDatasetSelection,
    sample,
    t,
    setStep,
    api,
    history,
    resetProject,
  ]);

  const onSaveName = () => {
    if (error) return;

    const trimmed = name.trim();

    if (!trimmed) {
      setError(t("validators.field_required", { field: t("Project Name") }));
      return;
    }

    setError(null);
    updateProject({ ...project, title: trimmed });
    if (trimmed !== name) setName(trimmed);
  };

  const onDataTypeChange = React.useCallback(
    (key) => {
      setDataTypeCategory(key);
      setMetaError(null);
      persistProjectMeta({ data_type_category: key });
    },
    [persistProjectMeta],
  );

  const onTemplateGroupChange = React.useCallback(
    (group) => {
      setTemplateGroup(group);
      setMetaError(null);
      persistProjectMeta({ template_group: group });
    },
    [persistProjectMeta],
  );

  const onDelete = React.useCallback(() => {
    resetProject();
    onClose?.();
  }, [onClose, resetProject]);

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
              disabled={
                uploadDisabled || error || metaError || !hasImportData || !templateGroup.trim() || !name.trim()
              }
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
            const nextGroup = group ?? "";
            setTemplateGroup(nextGroup);
            updateProject({ ...project, template_group: nextGroup });
          }}
          show={step === "config"}
          columns={columns}
          disableSaveButton={true}
        />
      </div>
    </Modal>
  );
};
