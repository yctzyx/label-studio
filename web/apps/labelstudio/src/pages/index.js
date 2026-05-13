import { ProjectsPage } from "./Projects/Projects";
import { MyTasksPage } from "./MyTasks/MyTasksPage";
import { HomePage } from "./Home/HomePage";
import { OrganizationPage } from "./Organization";
import { ModelsPage } from "./Organization/Models/ModelsPage";
import { SettingsPage } from "./Settings/SettingsPage";
import { FF_HOMEPAGE, isFF } from "../utils/feature-flags";
import { pages } from "@humansignal/app-common";

export const Pages = [
  isFF(FF_HOMEPAGE) && HomePage,
  ProjectsPage,
  MyTasksPage,
  OrganizationPage,
  ModelsPage,
  SettingsPage,
  pages.AccountSettingsPage,
].filter(Boolean);
