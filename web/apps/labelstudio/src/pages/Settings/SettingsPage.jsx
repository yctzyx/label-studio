import React from "react";
import { Redirect } from "react-router-dom";
import { pages } from "@humansignal/app-common";

/**
 * 独立设置入口：/settings 重定向到账户与设置页
 * 供主应用菜单配置使用，如 http://localhost:8080/embed/settings
 */
const SettingsRedirect = () => <Redirect to={pages.AccountSettingsPage.path} />;

SettingsRedirect.displayName = "SettingsRedirect";

export const SettingsPage = {
  title: "Settings",
  path: "/settings",
  exact: true,
  component: SettingsRedirect,
};
