import { Button } from "@humansignal/ui";
import { useCallback, useMemo, useState } from "react";
import { useUpdatePageTitle } from "@humansignal/core";
import { Space } from "../../../components/Space/Space";
import { cn } from "../../../utils/bem";
import "./PeopleInvitation.scss";
import { PeopleList } from "./PeopleList";
import "./PeoplePage.scss";
import { IconRefresh } from "@humansignal/icons";
import { useToast } from "@humansignal/ui";
import { SelectedUser } from "./SelectedUser";
import { useAuth } from "@humansignal/core/providers/AuthProvider";
import { useAPI } from "../../../providers/ApiProvider";

export const PeoplePage = () => {
  const { user } = useAuth();
  const { callApi } = useAPI();
  const toast = useToast();
  const [selectedUser, setSelectedUser] = useState(null);
  const [listReload, setListReload] = useState(0);
  const [syncingDirectory, setSyncingDirectory] = useState(false);

  useUpdatePageTitle("人员管理");

  const selectUser = useCallback(
    (user) => {
      setSelectedUser(user);
      localStorage.setItem("selectedUser", user?.id);
    },
    [setSelectedUser],
  );

  const defaultSelected = useMemo(() => {
    return localStorage.getItem("selectedUser");
  }, []);

  const onSyncPubDirectory = useCallback(async () => {
    setSyncingDirectory(true);
    try {
      const res = await callApi("syncPubDirectory", { params: {}, body: {} });
      if (res?.ok) {
        const parts = [
          `新建组织 ${res.orgs_created ?? 0}`,
          `更新组织 ${res.orgs_updated ?? 0}`,
          `新建用户 ${res.users_created ?? 0}`,
          `新建成员关系 ${res.members_created ?? 0}`,
        ];
        toast.show({ message: `同步完成：${parts.join("，")}` });
        setListReload((n) => n + 1);
      }
    } finally {
      setSyncingDirectory(false);
    }
  }, [callApi, toast]);

  return (
    <div className={cn("people").toClassName()}>
      <div className={cn("people").elem("controls").toClassName()}>
        <Space spread>
          <Space>
            {user?.is_staff ? (
              <span className={cn("people").elem("admin-hint").toClassName()} title="管理员账号（Django staff）">
                管理员视图：全部组织与成员
              </span>
            ) : null}
          </Space>

          <Space>
            {user?.is_staff ? (
              <Button
                look="outlined"
                leading={<IconRefresh className="!h-4" />}
                waiting={syncingDirectory}
                disabled={syncingDirectory}
                onClick={onSyncPubDirectory}
                aria-label="同步组织与用户"
              >
                同步组织与用户
              </Button>
            ) : null}
          </Space>
        </Space>
      </div>
      <div className={cn("people").elem("content").toClassName()}>
        <PeopleList
          selectedUser={selectedUser}
          defaultSelected={defaultSelected}
          reloadToken={listReload}
          onSelect={(user) => selectUser(user)}
        />

        {selectedUser ? <SelectedUser user={selectedUser} onClose={() => selectUser(null)} /> : null}
      </div>
    </div>
  );
};

PeoplePage.title = "人员管理";
PeoplePage.path = "/";
