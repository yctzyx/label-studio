import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import styles from "./MembershipInfo.module.scss";
import { useQuery } from "@tanstack/react-query";
import { getApiInstance } from "@humansignal/core";
import { useMemo } from "react";
import type { WrappedResponse } from "@humansignal/core/lib/api-proxy/types";
import { useAuth } from "@humansignal/core/providers/AuthProvider";

function formatDate(date?: string) {
  return format(new Date(date ?? ""), "dd MMM yyyy, KK:mm a");
}

function membershipRoleLabel(t: (key: string) => string, code?: string) {
  if (!code) return "";
  const map: Record<string, string> = {
    OW: t("membership.role.OW"),
    DI: t("membership.role.DI"),
    AD: t("membership.role.AD"),
    MA: t("membership.role.MA"),
    AN: t("membership.role.AN"),
    RE: t("membership.role.RE"),
    NO: t("membership.role.NO"),
  };
  return map[code] ?? code;
}

export const MembershipInfo = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const dateJoined = useMemo(() => {
    if (!user?.date_joined) return null;
    return formatDate(user?.date_joined);
  }, [user?.date_joined]);

  const membership = useQuery({
    queryKey: [user?.active_organization, user?.id, "user-membership"],
    async queryFn() {
      if (!user) return {};
      const api = getApiInstance();
      const response = (await api.invoke("userMemberships", {
        pk: user.active_organization,
        userPk: user.id,
      })) as WrappedResponse<{
        user: number;
        organization: number;
        contributed_projects_count: number;
        annotations_count: number;
        created_at: string;
        role: string;
      }>;

      const annotationCount = response?.annotations_count;
      const contributions = response?.contributed_projects_count;
      const roleCode = response.role;

      return {
        annotationCount,
        contributions,
        roleCode,
      };
    },
  });

  const organization = useQuery({
    queryKey: ["organization", user?.active_organization],
    async queryFn() {
      if (!user) return null;
      if (!window?.APP_SETTINGS?.billing) return null;
      const api = getApiInstance();
      const organization = (await api.invoke("organization", {
        pk: user.active_organization,
      })) as WrappedResponse<{
        id: number;
        external_id: string;
        title: string;
        token: string;
        default_role: string;
        created_at: string;
      }>;

      if (!organization.$meta.ok) {
        return null;
      }

      return {
        ...organization,
        createdAt: formatDate(organization.created_at),
      } as const;
    },
  });

  return (
    <div className={styles.membershipInfo} id="membership-info">
      <div className="flex gap-2 w-full justify-between">
        <div>{t("User ID")}</div>
        <div>{user?.id}</div>
      </div>

      <div className="flex gap-2 w-full justify-between">
        <div>{t("Registration date")}</div>
        <div>{dateJoined}</div>
      </div>

      <div className="flex gap-2 w-full justify-between">
        <div>{t("Annotations Submitted")}</div>
        <div>{membership.data?.annotationCount}</div>
      </div>

      <div className="flex gap-2 w-full justify-between">
        <div>{t("Projects contributed to")}</div>
        <div>{membership.data?.contributions}</div>
      </div>

      <div className={styles.divider} />

      {user?.active_organization_meta && (
        <div className="flex gap-2 w-full justify-between">
          <div>{t("Organization")}</div>
          <div>{user.active_organization_meta.title}</div>
        </div>
      )}

      {membership.data?.roleCode && (
        <div className="flex gap-2 w-full justify-between">
          <div>{t("My role")}</div>
          <div>{membershipRoleLabel(t, membership.data.roleCode)}</div>
        </div>
      )}

      <div className="flex gap-2 w-full justify-between">
        <div>{t("Organization ID")}</div>
        <div>{user?.active_organization}</div>
      </div>

      {user?.active_organization_meta && (
        <div className="flex gap-2 w-full justify-between">
          <div>{t("Organization owner")}</div>
          <div>{user.active_organization_meta.email}</div>
        </div>
      )}

      {organization.data?.createdAt && (
        <div className="flex gap-2 w-full justify-between">
          <div>{t("Created")}</div>
          <div>{organization.data?.createdAt}</div>
        </div>
      )}
    </div>
  );
};
