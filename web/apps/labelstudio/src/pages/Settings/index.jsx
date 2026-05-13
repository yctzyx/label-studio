import { useTranslation } from "react-i18next";
import { SidebarMenu } from "../../components/SidebarMenu/SidebarMenu";
import { WebhookPage } from "../WebhookPage/WebhookPage";
import { DangerZone } from "./DangerZone";
import { GeneralSettings } from "./GeneralSettings";
import { AnnotationSettings } from "./AnnotationSettings";
import { LabelingSettings } from "./LabelingSettings";
import { MachineLearningSettings } from "./MachineLearningSettings/MachineLearningSettings";
import { PredictionsSettings } from "./PredictionsSettings/PredictionsSettings";
import "./settings.scss";

const SETTINGS_MENU_ITEMS = [
  GeneralSettings,
  LabelingSettings,
  AnnotationSettings,
  MachineLearningSettings,
  PredictionsSettings,
  WebhookPage,
  DangerZone,
].filter(Boolean);

export const MenuLayout = ({ children, ...routeProps }) => {
  const { t } = useTranslation();
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
      children={children}
    />
  );
};

const pages = {
  AnnotationSettings,
  LabelingSettings,
  MachineLearningSettings,
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
