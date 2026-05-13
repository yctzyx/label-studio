import type { Ability } from "../providers/AuthProvider";

export type APIUser = {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  /** Django staff：后端用于「查看全部组织/成员」等目录能力 */
  is_staff?: boolean;
  last_activity: string;
  avatar: string | null;
  initials: string;
  phone: string;
  active_organization: number;
  active_organization_meta: {
    title: string;
    email: string;
  };
  allow_newsletters: boolean;
  date_joined: string;
  permissions?: Ability[];
};
