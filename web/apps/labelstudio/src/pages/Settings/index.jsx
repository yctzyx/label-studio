import { IconChevronLeft } from "@humansignal/icons";
import { Button } from "@humansignal/ui";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router";
import { SidebarMenu } from "../../components/SidebarMenu/SidebarMenu";
import { WebhookPage } from "../WebhookPage/WebhookPage";
import { DangerZone } from "./DangerZone";
import { GeneralSettings } from "./GeneralSettings";
import { AnnotationSettings } from "./AnnotationSettings";
import { LabelingSettings } from "./LabelingSettings";
import { MachineLearningSettings } from "./MachineLearningSettings/MachineLearningSettings";
import { LLMPreannotationSettings } from "./LLMPreannotationSettings/LLMPreannotationSettings";
import { PredictionsSettings } from "./PredictionsSettings/PredictionsSettings";
import "./settings.scss";

const SETTINGS_MENU_ITEMS = [
  GeneralSettings,
  LabelingSettings,
  AnnotationSettings,
  MachineLearningSettings,
  LLMPreannotationSettings,
  PredictionsSettings,
  WebhookPage,
  DangerZone,
].filter(Boolean);

export const MenuLayout = ({ children, ...routeProps }) => {
  const { t } = useTranslation();
  const history = useHistory();
  const menuItems = SETTINGS_MENU_ITEMS.map((item) => {
    const label = item.title ?? item.menuItem;
    if (!label) return item;
    const translated = t(label);
    return {
      ...item,
      title: item.title ? translated : item.title,
      menuItem: item.menuItem ? translated : item.menuItem,
    };
  });

  return (
    <SidebarMenu
      menuItems={menuItems}
      path={routeProps.match.url}
      navigationPrefix={
        <Button
          size="small"
          look="outlined"
          variant="neutral"
          leading={<IconChevronLeft />}
          className="sidebar-menu__back"
          aria-label={t("Back")}
          onClick={() => history.push("/projects")}
        >
          {t("Back")}
        </Button>
      }
      children={children}
    />
  );
};

const pages = {
  AnnotationSettings,
  LabelingSettings,
  MachineLearningSettings,
  LLMPreannotationSettings,
  PredictionsSettings,
  WebhookPage,
  DangerZone,
};

export const SettingsPage = {
  title: "Settings",
  path: "/settings",
  exact: true,
  layout: MenuLayout,
  component: GeneralSettings,
  pages,
};
