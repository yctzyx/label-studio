import { PersonalInfo } from "./PersonalInfo";
import { PersonalAccessToken, PersonalAccessTokenDescription } from "./PersonalAccessToken";
import { MembershipInfo } from "./MembershipInfo";
import { HotkeysManager } from "./Hotkeys";
import type React from "react";
import { PersonalJWTToken } from "./PersonalJWTToken";
import type { AuthTokenSettings } from "../types";
import { ABILITY, type AuthPermissions } from "@humansignal/core/providers/AuthProvider";
import { ff } from "@humansignal/core";
import type { TFunction } from "i18next";

export type SectionType = {
  title: string | React.ReactNode;
  /** Used for document title when `title` is not a plain string */
  pageTitle?: string;
  id: string;
  component: React.FC;
  description?: React.FC;
};

export const accountSettingsSections = (
  settings: AuthTokenSettings,
  permissions: AuthPermissions,
  t: TFunction,
): SectionType[] => {
  const canCreateTokens = permissions.can(ABILITY.can_create_tokens);

  return [
    {
      title: t("Personal Info"),
      pageTitle: t("Personal Info"),
      id: "personal-info",
      component: PersonalInfo,
    },
    {
      title: t("Hotkeys"),
      pageTitle: t("Hotkeys"),
      id: "hotkeys",
      component: HotkeysManager,
      description: () =>
        t(
          "Customize your keyboard shortcuts to speed up your workflow. Click on any hotkey below to assign a new key combination that works best for you.",
        ),
    },
    {
      title: t("Membership Info"),
      pageTitle: t("Membership Info"),
      id: "membership-info",
      component: MembershipInfo,
    },
    settings.api_tokens_enabled &&
      canCreateTokens &&
      ff.isActive(ff.FF_AUTH_TOKENS) && {
        title: t("Personal Access Token"),
        pageTitle: t("Personal Access Token"),
        id: "personal-access-token",
        component: PersonalJWTToken,
        description: PersonalAccessTokenDescription,
      },
    settings.legacy_api_tokens_enabled &&
      canCreateTokens && {
        title: ff.isActive(ff.FF_AUTH_TOKENS) ? t("Legacy Token") : t("Access Token"),
        pageTitle: ff.isActive(ff.FF_AUTH_TOKENS) ? t("Legacy Token") : t("Access Token"),
        id: "legacy-token",
        component: PersonalAccessToken,
        description: PersonalAccessTokenDescription,
      },
  ].filter(Boolean) as SectionType[];
};
