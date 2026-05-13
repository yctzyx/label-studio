import { useMemo, useState } from "react";
import { useHistory } from "react-router";
import { useTranslation } from "react-i18next";
import { Button, Typography, useToast } from "@humansignal/ui";
import { useUpdatePageTitle, createTitleFromSegments } from "@humansignal/core";
import { Label } from "../../components/Form";
import { modal } from "../../components/Modal/Modal";
import { useModalControls } from "../../components/Modal/ModalPopup";
import Input from "../../components/Form/Elements/Input/Input";
import { Space } from "../../components/Space/Space";
import { Spinner } from "../../components/Spinner/Spinner";
import { useAPI } from "../../providers/ApiProvider";
import { useProject } from "../../providers/ProjectProvider";
import { cn } from "../../utils/bem";

export const DangerZone = () => {
  const { project } = useProject();
  const api = useAPI();
  const history = useHistory();
  const toast = useToast();
  const { t } = useTranslation();
  const [processing, setProcessing] = useState(null);

  useUpdatePageTitle(createTitleFromSegments([project?.title, t("Danger Zone")]));

  const showDangerConfirmation = ({ title, message, requiredWord, buttonText, onConfirm }) => {
    const isDev = process.env.NODE_ENV === "development";

    return modal({
      title,
      width: 600,
      allowClose: false,
      body: () => {
        const ctrl = useModalControls();
        const inputValue = ctrl?.state?.inputValue || "";

        return (
          <div>
            <Typography variant="body" size="medium" className="mb-tight">
              {message}
            </Typography>
            <Input
              label={t('To proceed, type "{{word}}" in the field below:', { word: requiredWord })}
              value={inputValue}
              onChange={(e) => ctrl?.setState({ inputValue: e.target.value })}
              autoFocus
              data-testid="danger-zone-confirmation-input"
              autoComplete="off"
            />
          </div>
        );
      },
      footer: () => {
        const ctrl = useModalControls();
        const inputValue = (ctrl?.state?.inputValue || "").trim().toLowerCase();
        const isValid = isDev || inputValue === requiredWord.toLowerCase();

        return (
          <Space align="end">
            <Button
              variant="neutral"
              look="outline"
              onClick={() => ctrl?.hide()}
              data-testid="danger-zone-cancel-button"
            >
              {t("Cancel")}
            </Button>
            <Button
              variant="negative"
              disabled={!isValid}
              onClick={async () => {
                await onConfirm();
                ctrl?.hide();
              }}
              data-testid="danger-zone-confirm-button"
            >
              {buttonText}
            </Button>
          </Space>
        );
      },
    });
  };

  const handleOnClick = (type) => () => {
    const actionConfig = {
      reset_cache: {
        title: t("Reset Cache"),
        message: t("danger.reset_cache_message", { name: project.title }),
        requiredWord: "cache",
        buttonText: t("Reset Cache"),
      },
      tabs: {
        title: t("Drop All Tabs"),
        message: t("danger.drop_tabs_message", { name: project.title }),
        requiredWord: "tabs",
        buttonText: t("Drop All Tabs"),
      },
      project: {
        title: t("Delete Project"),
        message: t("danger.delete_project_message", { name: project.title }),
        requiredWord: "delete",
        buttonText: t("Delete Project"),
      },
    };

    const config = actionConfig[type];

    if (!config) {
      return;
    }

    showDangerConfirmation({
      ...config,
      onConfirm: async () => {
        setProcessing(type);
        try {
          if (type === "reset_cache") {
            await api.callApi("projectResetCache", {
              params: {
                pk: project.id,
              },
            });
            toast.show({ message: t("Cache reset successfully") });
          } else if (type === "tabs") {
            await api.callApi("deleteTabs", {
              body: {
                project: project.id,
              },
            });
            toast.show({ message: t("All tabs dropped successfully") });
          } else if (type === "project") {
            await api.callApi("deleteProject", {
              params: {
                pk: project.id,
              },
            });
            toast.show({ message: t("Project deleted successfully") });
            history.replace("/projects");
          }
        } catch (error) {
          toast.show({ message: t("Error: {{message}}", { message: error.message }), type: "error" });
        } finally {
          setProcessing(null);
        }
      },
    });
  };

  const buttons = useMemo(
    () => [
      {
        type: "annotations",
        disabled: true, //&& !project.total_annotations_number,
        label: t("Delete {{count}} Annotations", { count: project.total_annotations_number }),
      },
      {
        type: "tasks",
        disabled: true, //&& !project.task_number,
        label: t("Delete {{count}} Tasks", { count: project.task_number }),
      },
      {
        type: "predictions",
        disabled: true, //&& !project.total_predictions_number,
        label: t("Delete {{count}} Predictions", { count: project.total_predictions_number }),
      },
      {
        type: "reset_cache",
        help: t(
          "Reset Cache may help in cases like if you are unable to modify the labeling configuration due to validation errors concerning existing labels, but you are confident that the labels don't exist. You can use this action to reset the cache and try again.",
        ),
        label: t("Reset Cache"),
      },
      {
        type: "tabs",
        help: t("If the Data Manager is not loading, dropping all Data Manager tabs can help."),
        label: t("Drop All Tabs"),
      },
      {
        type: "project",
        help: t(
          "Deleting a project removes all tasks, annotations, and project data from the database.",
        ),
        label: t("Delete Project"),
      },
    ],
    [project, t],
  );

  return (
    <div className={cn("simple-settings")}>
      <Typography variant="headline" size="medium" className="mb-tighter">
        {t("Danger Zone")}
      </Typography>
      <Typography variant="body" size="medium" className="text-neutral-content-subtler !mb-base">
        {t(
          "Perform these actions at your own risk. Actions you take on this page can't be reverted. Make sure your data is backed up.",
        )}
      </Typography>

      {project.id ? (
        <div style={{ marginTop: 16 }}>
          {buttons.map((btn) => {
            const waiting = processing === btn.type;
            const disabled = btn.disabled || (processing && !waiting);

            return (
              btn.disabled !== true && (
                <div className={cn("settings-wrapper")} key={btn.type}>
                  <Typography variant="title" size="large">
                    {btn.label}
                  </Typography>
                  {btn.help && <Label description={btn.help} style={{ width: 600, display: "block" }} />}
                  <Button
                    key={btn.type}
                    variant="negative"
                    look="outlined"
                    disabled={disabled}
                    waiting={waiting}
                    onClick={handleOnClick(btn.type)}
                    style={{ marginTop: 16 }}
                  >
                    {btn.label}
                  </Button>
                </div>
              )
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 32 }}>
          <Spinner size={32} />
        </div>
      )}
    </div>
  );
};

DangerZone.title = "Danger Zone";
DangerZone.path = "/danger-zone";
