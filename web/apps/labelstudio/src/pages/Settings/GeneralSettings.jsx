import { useCallback, useContext } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@humansignal/ui";
import { Form, Input, TextArea } from "../../components/Form";
import { RadioGroup } from "../../components/Form/Elements/RadioGroup/RadioGroup";
import { ProjectContext } from "../../providers/ProjectProvider";
import { cn } from "../../utils/bem";

export const GeneralSettings = () => {
  const { t } = useTranslation();
  const { project, fetchProject } = useContext(ProjectContext);

  const updateProject = useCallback(() => {
    if (project.id) fetchProject(project.id, true);
  }, [project]);

  const colors = ["#FDFDFC", "#FF4C25", "#FF750F", "#ECB800", "#9AC422", "#34988D", "#617ADA", "#CC6FBE"];

  const samplings = [
    { value: "Sequential", label: "Sequential", description: "Tasks are ordered by Task ID" },
    { value: "Uniform", label: "Random", description: "Tasks are chosen with uniform random" },
  ];

  return (
    <div className={cn("general-settings").toClassName()}>
      <div className={cn("general-settings").elem("wrapper").toClassName()}>
        <h1>{t("General Settings")}</h1>
        <div className={cn("settings-wrapper").toClassName()}>
          <Form action="updateProject" formData={{ ...project }} params={{ pk: project.id }} onSubmit={updateProject}>
            <Form.Row columnCount={1} rowGap="16px">
              <Input name="title" label={t("Project Name")} />

              <TextArea name="description" label={t("Description")} style={{ minHeight: 128 }} />
              <RadioGroup name="color" label={t("Color")} size="large" labelProps={{ size: "large" }}>
                {colors.map((color) => (
                  <RadioGroup.Button key={color} value={color}>
                    <div className={cn("color").toClassName()} style={{ "--background": color }} />
                  </RadioGroup.Button>
                ))}
              </RadioGroup>

              <RadioGroup label={t("Task Sampling")} labelProps={{ size: "large" }} name="sampling" simple>
                {samplings.map(({ value, label, description }) => (
                  <RadioGroup.Button
                    key={value}
                    value={`${value} sampling`}
                    label={t(`${label} sampling`)}
                    description={t(description)}
                  />
                ))}
              </RadioGroup>
            </Form.Row>

            <Form.Actions>
              <Form.Indicator>
                <span case="success">{t("Saved!")}</span>
              </Form.Indicator>
              <Button type="submit" className="w-[150px]" aria-label={t("Save")}>
                {t("Save")}
              </Button>
            </Form.Actions>
          </Form>
        </div>
      </div>
    </div>
  );
};

GeneralSettings.menuItem = "General";
GeneralSettings.path = "/";
GeneralSettings.exact = true;
