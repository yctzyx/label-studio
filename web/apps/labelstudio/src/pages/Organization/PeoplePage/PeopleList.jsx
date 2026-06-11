import { formatDistance } from "date-fns";
import { zhCN } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Userpic } from "@humansignal/ui";
import { useAuth } from "@humansignal/core/providers/AuthProvider";
import { Pagination, Spinner } from "../../../components";
import { usePage, usePageSize } from "../../../components/Pagination/Pagination";
import { useAPI } from "../../../providers/ApiProvider";
import { cn } from "../../../utils/bem";
import { isDefined } from "../../../utils/helpers";
import "./PeopleList.scss";

function normalizeOrganizationListResponse(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res.filter(Boolean);
  if (Array.isArray(res.results)) return res.results;
  return [];
}

export const PeopleList = ({ onSelect, selectedUser, defaultSelected, reloadToken = 0 }) => {
  const api = useAPI();
  const { user } = useAuth();
  const [usersList, setUsersList] = useState();
  const [organizations, setOrganizations] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [selectedOrgId, setSelectedOrgId] = useState(null);
  const [currentPage, setPage] = usePage("page", 1);
  const [currentPageSize] = usePageSize("page_size", 30);
  const [totalItems, setTotalItems] = useState(0);
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  const previousOrgIdRef = useRef(null);
  const orgSelectRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setOrgsLoading(true);
      const res = await api.callApi("organizationsList", { params: {} });
      if (cancelled) return;
      const list = normalizeOrganizationListResponse(res);
      setOrganizations(list);
      setOrgsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, reloadToken]);

  useEffect(() => {
    if (!organizations.length) {
      setSelectedOrgId(null);
      return;
    }
    setSelectedOrgId((prev) => {
      if (prev != null && organizations.some((o) => o.id === prev)) return prev;
      const active = user?.active_organization;
      if (active != null && organizations.some((o) => o.id === active)) return active;
      return organizations[0].id;
    });
  }, [organizations, user?.active_organization]);

  const fetchUsers = useCallback(
    async (page, pageSize) => {
      if (selectedOrgId == null) return;
      const response = await api.callApi("memberships", {
        params: {
          pk: selectedOrgId,
          contributed_to_projects: 1,
          page,
          page_size: pageSize,
        },
      });

      if (response?.results) {
        setUsersList(response.results);
        setTotalItems(response.count ?? response.results.length);
      } else {
        setUsersList([]);
        setTotalItems(0);
      }
    },
    [api, selectedOrgId],
  );

  const onOrganizationChange = useCallback(
    (orgId) => {
      const id = typeof orgId === "string" ? Number.parseInt(orgId, 10) : orgId;
      if (Number.isNaN(id)) return;
      setSelectedOrgId(id);
      setOrgDropdownOpen(false);
      setPage(1);
      onSelect?.(null);
    },
    [onSelect, setPage],
  );

  const orgSelectOptions = useMemo(
    () =>
      organizations.map((o) => ({
        value: o.id,
        label: `${o.title || "未命名"} (#${o.id})`,
      })),
    [organizations],
  );

  const selectedOrgLabel = useMemo(() => {
    return orgSelectOptions.find((option) => option.value === selectedOrgId)?.label;
  }, [orgSelectOptions, selectedOrgId]);

  useEffect(() => {
    if (!orgDropdownOpen) return;

    const handlePointerDown = (event) => {
      if (!orgSelectRef.current?.contains(event.target)) {
        setOrgDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [orgDropdownOpen]);

  useEffect(() => {
    if (selectedOrgId == null) {
      setUsersList(undefined);
      previousOrgIdRef.current = null;
      return;
    }
    if (previousOrgIdRef.current !== selectedOrgId) {
      previousOrgIdRef.current = selectedOrgId;
      setUsersList(undefined);
    }
    fetchUsers(currentPage, currentPageSize);
  }, [selectedOrgId, currentPage, currentPageSize, fetchUsers]);

  const selectUser = useCallback(
    (user) => {
      if (selectedUser?.id === user.id) {
        onSelect?.(null);
      } else {
        onSelect?.(user);
      }
    },
    [selectedUser],
  );

  useEffect(() => {
    if (isDefined(defaultSelected) && usersList) {
      const selected = usersList.find(({ user }) => user.id === Number(defaultSelected));

      if (selected) selectUser(selected.user);
    }
  }, [usersList, defaultSelected]);

  const listBody = () => {
    if (orgsLoading) {
      return (
        <div className={cn("people-list").elem("loading").toClassName()}>
          <Spinner size={36} />
        </div>
      );
    }
    if (!organizations.length) {
      return (
        <div className={cn("people-list").elem("empty").toClassName()}>
          暂无可访问的组织。请确认账号已加入组织或由管理员同步目录。
        </div>
      );
    }
    if (selectedOrgId == null || usersList === undefined) {
      return (
        <div className={cn("people-list").elem("loading").toClassName()}>
          <Spinner size={36} />
        </div>
      );
    }
    return (
      <div className={cn("people-list").elem("users").toClassName()}>
        <div className={cn("people-list").elem("header").toClassName()}>
          <div className={cn("people-list").elem("column").mix("avatar").toClassName()} />
          <div className={cn("people-list").elem("column").mix("email").toClassName()}>邮箱</div>
          <div className={cn("people-list").elem("column").mix("name").toClassName()}>姓名</div>
          <div className={cn("people-list").elem("column").mix("last-activity").toClassName()}>最近活动</div>
        </div>
        <div className={cn("people-list").elem("body").toClassName()}>
          {usersList.map(({ user }) => {
            const active = user.id === selectedUser?.id;

            return (
              <div
                key={`user-${user.id}`}
                className={cn("people-list").elem("user").mod({ active }).toClassName()}
                onClick={() => selectUser(user)}
              >
                <div className={cn("people-list").elem("field").mix("avatar").toClassName()}>
                  <span className={cn("people-list").elem("avatar-tooltip").toClassName()} data-tooltip={`用户 ID：${user.id}`}>
                    <Userpic user={user} style={{ width: 28, height: 28 }} />
                  </span>
                </div>
                <div
                  className={cn("people-list").elem("field").mix("email").toClassName()}
                  title={user.email || undefined}
                >
                  {user.email}
                </div>
                <div className={cn("people-list").elem("field").mix("name").toClassName()}>
                  {user.first_name} {user.last_name}
                </div>
                <div className={cn("people-list").elem("field").mix("last-activity").toClassName()}>
                  {formatDistance(new Date(user.last_activity), new Date(), { addSuffix: true, locale: zhCN })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={cn("people-list").toClassName()}>
      <div className={cn("people-list").elem("panel").toClassName()}>
        <div className={cn("people-list").elem("org-toolbar").toClassName()}>
          <span className={cn("people-list").elem("org-label").toClassName()}>组织</span>
          <div ref={orgSelectRef} className={cn("people-list").elem("org-select").toClassName()}>
            <button
              type="button"
              className={cn("people-list")
                .elem("org-select-trigger")
                .mod({ open: orgDropdownOpen, disabled: orgsLoading || !organizations.length })
                .toClassName()}
              disabled={orgsLoading || !organizations.length}
              onClick={() => setOrgDropdownOpen((open) => !open)}
            >
              <span>{orgsLoading ? "加载中…" : selectedOrgLabel || "请选择组织"}</span>
              <span className={cn("people-list").elem("org-select-arrow").toClassName()} />
            </button>
            {orgDropdownOpen ? (
              <div className={cn("people-list").elem("org-select-menu").toClassName()}>
                {orgSelectOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={cn("people-list")
                      .elem("org-select-option")
                      .mod({ selected: option.value === selectedOrgId })
                      .toClassName()}
                    onClick={() => onOrganizationChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className={cn("people-list").elem("wrapper").toClassName()}>{listBody()}</div>
        <div className={cn("people-list").elem("pagination-wrap").toClassName()}>
          <Pagination
            page={currentPage}
            urlParamName="page"
            totalItems={totalItems}
            pageSize={currentPageSize}
            pageSizeOptions={[30, 50, 100]}
            formatPageSizeOption={(n) => `${n} 条/页`}
            formatPageIndicator={(cur, total) => (
              <>
                第 {cur} 页<span> / 共 {total} 页</span>
              </>
            )}
            onPageLoad={fetchUsers}
            style={{ paddingTop: 0 }}
          />
        </div>
      </div>
    </div>
  );
};
