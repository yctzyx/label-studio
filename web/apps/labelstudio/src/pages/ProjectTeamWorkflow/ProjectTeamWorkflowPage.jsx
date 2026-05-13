import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ToastType, useToast } from "@humansignal/ui";
import { useUpdatePageTitle } from "@humansignal/core";
import { useAPI } from "../../providers/ApiProvider";
import { useParams } from "../../providers/RoutesProvider";
import { cn } from "../../utils/bem";
import "./ProjectTeamWorkflowPage.scss";

const ROLES = [
  { key: "label", label: "标注人员" },
  { key: "review", label: "审核人员" },
  { key: "accept", label: "验收人员" },
  { key: "admin", label: "项目管理员" },
];

const emptyMembers = () => ({
  label: [],
  review: [],
  accept: [],
  admin: [],
});

/** 将后端 GET /workflow/team 列表按 role 分组 */
function teamRowsToMembersByRole(rows) {
  const m = emptyMembers();
  if (!Array.isArray(rows)) return m;
  for (const row of rows) {
    const key = row.role;
    if (!m[key]) continue;
    m[key].push({
      userId: row.user_id,
      allocationId: row.id,
      username: row.username ?? "",
      displayName: row.email || row.username || String(row.user_id),
      teams: ["组织成员"],
      status: "enabled",
      allocationPercent: Number(row.allocation_percent ?? 0),
      extractedPercent: 0,
    });
  }
  return m;
}

/** 与 People 页一致：兼容数组或 { results } */
function normalizeOrganizationListResponse(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res.filter(Boolean);
  if (Array.isArray(res.results)) return res.results;
  return [];
}

/** 分页拉满单个组织的 memberships（网关与 DRF 默认每页 20） */
async function fetchMembershipRowsForOrg(callApi, orgPk) {
  const allRows = [];
  let page = 1;
  const pageSize = 200;
  while (page <= 100) {
    const response = await callApi("memberships", {
      params: { pk: orgPk, page, page_size: pageSize },
    });
    if (response == null) break;
    const part = response.results ?? [];
    allRows.push(...part);
    const total = response.count ?? allRows.length;
    if (allRows.length >= total || part.length < pageSize) break;
    page += 1;
  }
  return allRows;
}

/** 与「我的任务」分页一致：页码条（含省略号） */
function buildPagerItems(totalPages, cur) {
  const n = totalPages;
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
  const pages = new Set([1, n, cur, cur - 1, cur + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

/** 自动均分到 100%，保留 2 位小数，确保总和严格为 100 */
function buildEvenPercents(count) {
  if (!count || count <= 0) return [];
  const totalBp = 10000; // basis points (100.00%)
  const base = Math.floor(totalBp / count);
  const rem = totalBp - base * count;
  return Array.from({ length: count }, (_, i) => Number(((base + (i < rem ? 1 : 0)) / 100).toFixed(2)));
}

/** 组织行三态复选框：全选 / 部分 / 全不选 */
function OrgTriCheckbox({ userIds, selectedLeft, onToggleAll, inputClassName }) {
  const ref = useRef(null);
  const count = useMemo(() => userIds.filter((id) => selectedLeft.has(id)).length, [userIds, selectedLeft]);
  const allSelected = userIds.length > 0 && count === userIds.length;
  const none = count === 0;
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = !allSelected && !none && userIds.length > 0;
    }
  }, [allSelected, none, userIds.length]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={inputClassName}
      checked={allSelected}
      disabled={userIds.length === 0}
      onChange={() => onToggleAll(userIds)}
      onClick={(e) => e.stopPropagation()}
      aria-label="选择本组织成员"
    />
  );
}

/**
 * 人员按组织分组；组织可折叠。组织行含复选框（全选该组织下当前列表内成员）。搜索时仅显示匹配块并展开。
 */
function OrgTreeUserList({
  groups,
  search,
  selectedLeft,
  onToggle,
  onToggleOrgUsers,
  collapsedOrgIds,
  onToggleOrg,
  bem,
}) {
  const q = search.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!groups?.length) return [];
    if (!q) return groups.map((g) => ({ ...g, users: [...g.users] }));
    return groups
      .map((g) => ({
        ...g,
        users: g.users.filter((u) => {
          const s = `${u.username} ${u.title} ${u.email ?? ""}`.toLowerCase();
          return s.includes(q);
        }),
      }))
      .filter((g) => g.users.length > 0);
  }, [groups, q]);

  if (filteredGroups.length === 0) {
    return (
      <div className={bem.elem("empty").toClassName()}>{groups?.length ? "无匹配人员" : "暂无组织成员"}</div>
    );
  }

  return (
    <div className={bem.elem("org-tree").toClassName()}>
      {filteredGroups.map((g) => {
        const collapsed = !q && collapsedOrgIds.has(g.orgId);
        const scopeIds = g.users.map((u) => u.id);
        return (
          <div key={g.orgId} className={bem.elem("org-group").toClassName()}>
            <div className={bem.elem("org-head-row").toClassName()}>
              <OrgTriCheckbox
                userIds={scopeIds}
                selectedLeft={selectedLeft}
                onToggleAll={onToggleOrgUsers}
                inputClassName={bem.elem("org-tri-cb").toClassName()}
              />
              <button
                type="button"
                className={bem.elem("org-chevron-btn").toClassName()}
                onClick={() => onToggleOrg(g.orgId)}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "展开" : "折叠"}
              >
                <span className={bem.elem("org-chevron").toClassName()} aria-hidden>
                  {collapsed ? "▸" : "▾"}
                </span>
              </button>
              <span className={bem.elem("org-head-title").toClassName()}>{g.title}</span>
            </div>
            {!collapsed && (
              <div className={bem.elem("org-members").toClassName()}>
                {g.users.map((u) => {
                  const checked = selectedLeft.has(u.id);
                  const rowId = `pick-${g.orgId}-${u.id}`;
                  return (
                    <div key={rowId} className={bem.elem("tree-row").toClassName()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggle(u.id)}
                        id={rowId}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <label htmlFor={rowId}>{u.title}({u.username})</label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const ProjectTeamWorkflowPage = () => {
  const { id: projectId } = useParams();
  const toast = useToast();
  const { callApi } = useAPI();

  const root = cn("project-team-workflow");

  useUpdatePageTitle("项目人员与分配");

  const [role, setRole] = useState("label");
  /** 比例分配弹窗 */
  const [allocModalOpen, setAllocModalOpen] = useState(false);
  const [membersByRole, setMembersByRole] = useState(() => emptyMembers());
  const [teamLoading, setTeamLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [searchTree, setSearchTree] = useState("");
  const [selectedLeft, setSelectedLeft] = useState(() => new Set());
  const [selectedRight, setSelectedRight] = useState(() => new Set());
  const [modalRight, setModalRight] = useState([]);
  /** 按组织分组：{ orgId, title, users[] }，人员仅挂在所属组织下（同一用户可在多个组织各出现一次） */
  const [orgGroups, setOrgGroups] = useState([]);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  /** 折叠的组织 id；搜索时忽略折叠，匹配块一律展开 */
  const [collapsedOrgIds, setCollapsedOrgIds] = useState(() => new Set());

  const orgUserMap = useMemo(() => {
    const m = new Map();
    for (const g of orgGroups) {
      for (const u of g.users) {
        m.set(u.id, u);
      }
    }
    return m;
  }, [orgGroups]);

  const loadTeam = useCallback(async () => {
    if (!projectId) return;
    setTeamLoading(true);
    try {
      const res = await callApi("projectWorkflowTeam", {
        params: { pk: projectId },
      });
      const rows = Array.isArray(res) ? res : res?.results ?? [];
      setMembersByRole(teamRowsToMembersByRole(rows));
    } catch (e) {
      console.error(e);
      toast.show({ message: e?.message || "加载项目人员失败", type: ToastType.alertError });
      setMembersByRole(emptyMembers());
    } finally {
      setTeamLoading(false);
    }
  }, [callApi, projectId, toast]);

  useEffect(() => {
    loadTeam();
  }, [loadTeam]);

  /** 列出当前账号可见的全部组织及成员（项目管理员可将各组织成员加入本项目团队）。 */
  const loadOrgUsers = useCallback(async () => {
    setOrgUsersLoading(true);
    try {
      const orgsRes = await callApi("organizationsList", { params: {} });
      const orgs = normalizeOrganizationListResponse(orgsRes);
      if (!orgs.length) {
        toast.show({
          message: "没有可访问的组织成员列表（需先加入组织，或由具备权限的账号查看全部组织）",
          type: ToastType.alertError,
        });
        setOrgGroups([]);
        return;
      }
      const groups = [];
      for (const org of orgs) {
        const oid = org?.id;
        if (oid == null) continue;
        let rows;
        try {
          rows = await fetchMembershipRowsForOrg(callApi, oid);
        } catch (e) {
          console.warn("加载组织成员失败，已跳过该组织", oid, e);
          continue;
        }
        const orgTitle = org?.title || "未命名";
        const users = [];
        for (const row of rows) {
          const u = row?.user;
          if (!u?.id) continue;
          const displayTitle = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username;
          users.push({
            id: u.id,
            username: u.username,
            email: u.email,
            title: displayTitle,
          });
        }
        users.sort((a, b) => String(a.username || "").localeCompare(String(b.username || ""), "zh-CN"));
        if (users.length === 0) continue;
        groups.push({ orgId: Number(oid), title: orgTitle, users });
      }
      groups.sort((a, b) => a.orgId - b.orgId);
      setOrgGroups(groups);
    } catch (e) {
      console.error(e);
      toast.show({ message: e?.message || "加载组织成员失败", type: ToastType.alertError });
      setOrgGroups([]);
    } finally {
      setOrgUsersLoading(false);
    }
  }, [callApi, toast]);

  const currentMembers = membersByRole[role] ?? [];

  const openModal = useCallback(async () => {
    setModalOpen(true);
    setSelectedLeft(new Set());
    setSelectedRight(new Set());
    setModalRight([]);
    setSearchTree("");
    setCollapsedOrgIds(new Set());
    await loadOrgUsers();
  }, [loadOrgUsers]);

  const toggleOrgCollapse = useCallback((orgId) => {
    setCollapsedOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  }, []);

  /** 左侧可选人员总数（随搜索过滤变化，与设计稿「N 项」一致） */
  const modalLeftTotalCount = useMemo(() => {
    const q = searchTree.trim().toLowerCase();
    if (!orgGroups.length) return 0;
    if (!q) {
      return orgGroups.reduce((sum, g) => sum + g.users.length, 0);
    }
    return orgGroups.reduce((sum, g) => {
      const n = g.users.filter((u) => {
        const s = `${u.username} ${u.title} ${u.email ?? ""}`.toLowerCase();
        return s.includes(q);
      }).length;
      return sum + n;
    }, 0);
  }, [orgGroups, searchTree]);

  /** 勾选组织行：全选或清空当前列表中该组织成员 */
  const toggleOrgUsers = useCallback((userIds) => {
    setSelectedLeft((prev) => {
      const next = new Set(prev);
      const allSelected = userIds.length > 0 && userIds.every((id) => next.has(id));
      if (allSelected) {
        userIds.forEach((id) => next.delete(id));
      } else {
        userIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, []);

  const toggleLeft = useCallback((id) => {
    setSelectedLeft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const moveToRight = useCallback(() => {
    const toAdd = [...selectedLeft].map((id) => orgUserMap.get(id)).filter(Boolean);
    if (!toAdd.length) return;
    setModalRight((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      const merged = [...prev];
      for (const p of toAdd) {
        if (!ids.has(p.id)) merged.push(p);
      }
      return merged;
    });
    setSelectedLeft(new Set());
  }, [orgUserMap, selectedLeft]);

  const toggleRight = useCallback((id) => {
    setSelectedRight((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const moveToLeft = useCallback(() => {
    if (!selectedRight.size) return;
    const removeIds = new Set(selectedRight);
    setModalRight((prev) => prev.filter((p) => !removeIds.has(p.id)));
    setSelectedRight(new Set());
  }, [selectedRight]);

  const confirmModal = useCallback(async () => {
    if (!modalRight.length) {
      toast.show({ message: "请先选择要添加的人员", type: ToastType.alertError });
      return;
    }
    const evenPercents = role === "label" ? buildEvenPercents(modalRight.length) : [];
    try {
      for (let i = 0; i < modalRight.length; i++) {
        const p = modalRight[i];
        const ok = await callApi("createProjectWorkflowTeam", {
          params: { pk: projectId },
          body: {
            user_id: p.id,
            role,
            allocation_percent: role === "label" ? evenPercents[i] : 0,
          },
        });
        if (ok == null) return;
      }
      setModalOpen(false);
      toast.show({ message: "已保存到服务器", type: ToastType.info });
      await loadTeam();
    } catch (e) {
      console.error(e);
      toast.show({ message: e?.message || "保存失败", type: ToastType.alertError });
    }
  }, [callApi, loadTeam, modalRight, projectId, role, toast]);

  const removeMember = useCallback(
    async (member) => {
      const aid = member.allocationId;
      if (aid == null) {
        toast.show({ message: "缺少 allocationId，请刷新页面", type: ToastType.alertError });
        return;
      }
      try {
        const ok = await callApi("deleteProjectWorkflowTeam", {
          params: { pk: projectId, allocation_id: aid },
        });
        if (ok == null) return;
        toast.show({ message: "已移除", type: ToastType.info });
        await loadTeam();
      } catch (e) {
        console.error(e);
        toast.show({ message: e?.message || "移除失败", type: ToastType.alertError });
      }
    },
    [callApi, loadTeam, projectId, toast],
  );

  const setAllocation = useCallback(
    async (member, value) => {
      const n = Number.parseFloat(value);
      if (Number.isNaN(n) || n < 0 || n > 100) return;
      try {
        const ok = await callApi("createProjectWorkflowTeam", {
          params: { pk: projectId },
          body: {
            user_id: member.userId,
            role,
            allocation_percent: n,
          },
        });
        if (ok == null) return;
        setMembersByRole((prev) => ({
          ...prev,
          [role]: (prev[role] ?? []).map((m) =>
            m.userId === member.userId ? { ...m, allocationPercent: n } : m,
          ),
        }));
      } catch (e) {
        console.error(e);
        toast.show({ message: e?.message || "更新比例失败", type: ToastType.alertError });
      }
    },
    [callApi, projectId, role, toast],
  );

  const onDistribute = useCallback(async () => {
    try {
      const res = await callApi("projectWorkflowDistribute", {
        params: { pk: projectId },
        body: {},
      });
      if (res == null) return;
      const created = res?.created ?? 0;
      toast.show({ message: `分发完成，新建 ${created} 条任务工作流`, type: ToastType.info });
    } catch (e) {
      console.error(e);
      toast.show({ message: e?.message || "分发失败（请至少配置一名标注人员及比例）", type: ToastType.alertError });
    }
  }, [callApi, projectId, toast]);

  const onReset = useCallback(() => {
    const current = membersByRole[role] ?? [];
    const evenPercents = role === "label" ? buildEvenPercents(current.length) : [];
    setMembersByRole((prev) => ({
      ...prev,
      [role]: (prev[role] ?? []).map((m, idx) => ({
        ...m,
        allocationPercent: role === "label" ? evenPercents[idx] ?? 0 : 0,
        extractedPercent: 0,
      })),
    }));
    toast.show({ message: "已本地按人数均分比例，请点击保存", type: ToastType.info });
  }, [membersByRole, role, toast]);

  const autoEvenLabelIfLegacyAllHundred = useCallback(async () => {
    if (role !== "label") return;
    const current = membersByRole.label ?? [];
    if (current.length <= 1) return;
    const allHundred = current.every((m) => Number(m.allocationPercent) === 100);
    if (!allHundred) return;

    const evenPercents = buildEvenPercents(current.length);
    try {
      for (let i = 0; i < current.length; i++) {
        const member = current[i];
        const ok = await callApi("createProjectWorkflowTeam", {
          params: { pk: projectId },
          body: {
            user_id: member.userId,
            role: "label",
            allocation_percent: evenPercents[i],
          },
        });
        if (ok == null) return;
      }
      await loadTeam();
      toast.show({ message: "检测到历史默认 100%，已自动均分", type: ToastType.info });
    } catch (e) {
      console.error(e);
      toast.show({ message: e?.message || "自动均分失败，请手动重置", type: ToastType.alertError });
    }
  }, [callApi, loadTeam, membersByRole.label, projectId, role, toast]);

  const ALLOC_PAGE_SIZES = [10, 20, 50, 100];
  const [allocPageSize, setAllocPageSize] = useState(10);
  const [allocPage, setAllocPage] = useState(1);
  const [allocJumperVal, setAllocJumperVal] = useState("1");
  const allocTotal = currentMembers.length;
  const allocTotalPages = Math.max(1, Math.ceil(allocTotal / allocPageSize));
  const allocSafePage = Math.min(allocPage, allocTotalPages);
  const allocSlice = useMemo(() => {
    const start = (allocSafePage - 1) * allocPageSize;
    return currentMembers.slice(start, start + allocPageSize);
  }, [allocSafePage, allocPageSize, currentMembers]);

  const allocPagerItems = useMemo(
    () => buildPagerItems(allocTotalPages, allocSafePage),
    [allocTotalPages, allocSafePage],
  );

  useEffect(() => {
    setAllocJumperVal(String(allocSafePage));
  }, [allocSafePage]);

  useEffect(() => {
    setAllocPage(1);
  }, [allocPageSize]);

  useEffect(() => {
    setAllocPage((p) => Math.min(p, allocTotalPages));
  }, [allocTotalPages]);

  const roleLabel = ROLES.find((r) => r.key === role)?.label ?? "";

  return (
    <div className={root.toClassName()}>
      <header className={root.elem("header").toClassName()}>
        <h1 className={root.elem("title").toClassName()}>项目人员与分配</h1>
        <div className={root.elem("steps").toClassName()}>
          <span>人员管理</span>
          <span style={{ opacity: 0.5, margin: "0 6px" }}>·</span>
          <span>比例分配</span>
          <span style={{ marginLeft: 12, fontSize: 12 }}>项目 ID: {projectId}</span>
        </div>
      </header>

      <div className={root.elem("main-card").toClassName()}>
        <aside className={root.elem("workflow-notice").toClassName()} aria-label="工作流与验收说明">
          <div className={root.elem("workflow-notice-title").toClassName()}>任务流转与配置时机</div>
          <ul className={root.elem("workflow-notice-list").toClassName()}>
            <li>
              默认顺序为：<strong>标注</strong>
              {` → `}
              <strong>审核</strong>（已配置审核人员时）
              {` → `}
              <strong>验收</strong>（已配置验收人员时）
              {` → `}
              <strong>完成</strong>。是否进入某环节，取决于在对应动作发生时（标注提交、审核通过等）项目中<strong>是否已有该角色人员</strong>，系统不会事后追溯补配。
            </li>
            <li>
              <strong>验收人员建议在首次点击「分发任务」之前配好</strong>；至少须在<strong>第一条任务尚未因「无验收配置」而结束前</strong>完成配置。若审核通过时仍无任何验收人员，任务会<strong>直接标记完成</strong>，验收员在「我的任务」中<strong>不会</strong>看到该任务。
            </li>
            <li>
              <strong>未配置验收的后果：</strong>有审核、无验收时，审核通过后流程结束；无审核、无验收时，标注达标后结束；仅有审核、事后才补验收——<strong>已在当时被结束的历史任务不会自动进入验收队列</strong>，仅新产生的流转会按新配置执行。
            </li>
          </ul>
        </aside>

        <div className={root.elem("role-tabs").toClassName()}>
          {ROLES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={root
                .elem("role-tab")
                .mod({ active: role === r.key })
                .toClassName()}
              onClick={() => {
                setRole(r.key);
                setAllocPage(1);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {teamLoading && <div className={root.elem("empty").toClassName()}>加载中…</div>}

        {!teamLoading && (
          <>
            <div className={root.elem("toolbar").toClassName()}>
              <button type="button" className={root.elem("btn").mod({ primary: true }).toClassName()} onClick={openModal}>
                添加人员
              </button>
              <button
                type="button"
                className={root.elem("btn").mod({ outline: true }).toClassName()}
                onClick={async () => {
                  setAllocPage(1);
                  setAllocModalOpen(true);
                  await autoEvenLabelIfLegacyAllHundred();
                }}
              >
                比例分配
              </button>
              <button
                type="button"
                className={root.elem("btn").mod({ batch: true }).toClassName()}
                disabled
                title="暂未支持行内勾选，敬请期待"
              >
                批量启用
              </button>
              <button
                type="button"
                className={root.elem("btn").mod({ batch: true }).toClassName()}
                disabled
                title="暂未支持行内勾选，敬请期待"
              >
                批量禁用
              </button>
              <button type="button" className={root.elem("btn").mod({ batch: true }).toClassName()} disabled title="暂未支持行内勾选，敬请期待">
                批量删除
              </button>
            </div>

            <div className={root.elem("table-wrap").toClassName()}>
              <table className={root.elem("table").mod({ striped: true }).toClassName()}>
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>所属团队</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {currentMembers.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className={root.elem("empty").toClassName()}>暂无人员，请点击「添加人员」</div>
                    </td>
                  </tr>
                ) : (
                  currentMembers.map((m) => (
                    <tr key={`${m.userId}-${m.allocationId}`}>
                      <td>
                        {m.username}
                        <span className={root.elem("muted-inline").toClassName()}>({m.displayName})</span>
                      </td>
                      <td>
                        <div className={root.elem("teams").toClassName()} title={m.teams.join("、")}>
                          {m.teams.join("、")}
                        </div>
                      </td>
                      <td>
                        <span
                          className={root
                            .elem("tag")
                            .mod({ on: m.status === "enabled", off: m.status !== "enabled" })
                            .toClassName()}
                        >
                          {m.status === "enabled" ? "启用" : "禁用"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {allocModalOpen && (
        <div
          className={root.elem("modal-backdrop").toClassName()}
          role="presentation"
          onClick={() => setAllocModalOpen(false)}
        >
          <div
            className={root.elem("modal").mod({ light: true, alloc: true }).toClassName()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ptw-alloc-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={root.elem("modal-head").toClassName()}>
              <span id="ptw-alloc-modal-title">比例分配</span>
              <button
                type="button"
                className={root.elem("modal-close").toClassName()}
                onClick={() => setAllocModalOpen(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className={root.elem("alloc-modal-body").toClassName()}>
              <p className={root.elem("step2-hint").toClassName()}>
                当前角色：<strong>{roleLabel}</strong> · 共 {currentMembers.length} 人
              </p>
              <div className={root.elem("panel-actions").toClassName()}>
                <button
                  type="button"
                  className={root.elem("btn-search").toClassName()}
                  onClick={() => {
                    loadTeam();
                    toast.show({ message: "已刷新", type: ToastType.info });
                  }}
                >
                  查询
                </button>
                <button type="button" className={root.elem("btn-reset").toClassName()} onClick={onReset}>
                  重置
                </button>
              </div>

              <div className={root.elem("table-wrap").toClassName()}>
                <table className={root.elem("table").mod({ striped: true }).toClassName()}>
                  <thead>
                    <tr>
                      <th>用户名</th>
                      <th>分配比例</th>
                      <th>已提取比例</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocSlice.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          <div className={root.elem("empty").toClassName()}>暂无数据，请先在列表中添加人员</div>
                        </td>
                      </tr>
                    ) : (
                      allocSlice.map((m) => (
                        <tr key={`${m.userId}-${m.allocationId}`}>
                          <td>{m.username}</td>
                          <td>
                            <input
                              className={root.elem("ratio-input").toClassName()}
                              type="number"
                              min={0}
                              max={100}
                              step={0.01}
                              value={m.allocationPercent}
                              onChange={(e) => setAllocation(m, e.target.value)}
                              title="分配比例（标注角色用于任务分发权重；审核/验收等由后端轮询分配，比例可记录或忽略）"
                            />
                            %
                          </td>
                          <td>{m.extractedPercent.toFixed(2)}%</td>
                          <td>
                            <button
                              type="button"
                              className={root.elem("link").mod({ danger: true }).toClassName()}
                              onClick={() => removeMember(m)}
                            >
                              移除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className={root.elem("pagination").toClassName()}>
                <div className={root.elem("pagination-total").toClassName()}>
                  共 {allocTotal} 条记录，第 {allocSafePage} / {allocTotalPages} 页
                </div>
                <div className={root.elem("pagination-inner").toClassName()}>
                  <div className={root.elem("pagination-size").toClassName()}>
                    <span>每页</span>
                    <select
                      value={allocPageSize}
                      onChange={(e) => setAllocPageSize(Number(e.target.value))}
                      aria-label="每页条数"
                    >
                      {ALLOC_PAGE_SIZES.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <span>条</span>
                  </div>
                  <button
                    type="button"
                    className={root.elem("pg-btn").mod({ prev: true }).toClassName()}
                    disabled={allocSafePage <= 1}
                    aria-label="prev"
                    onClick={() => setAllocPage((p) => Math.max(1, p - 1))}
                  >
                    ‹
                  </button>
                  <ul className={root.elem("pager").toClassName()}>
                    {allocPagerItems.map((item, idx) =>
                      item === "…" ? (
                        <li key={`ae-${idx}`} className={root.elem("pager-ellipsis").toClassName()}>
                          …
                        </li>
                      ) : (
                        <li key={item}>
                          <button
                            type="button"
                            className={root.elem("pager-num").mod({ active: item === allocSafePage }).toClassName()}
                            onClick={() => setAllocPage(item)}
                          >
                            {item}
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                  <button
                    type="button"
                    className={root.elem("pg-btn").mod({ next: true }).toClassName()}
                    disabled={allocSafePage >= allocTotalPages}
                    aria-label="next"
                    onClick={() => setAllocPage((p) => Math.min(allocTotalPages, p + 1))}
                  >
                    ›
                  </button>
                  <span className={root.elem("jumper").toClassName()}>
                    前往
                    <input
                      type="text"
                      inputMode="numeric"
                      className={root.elem("jumper-input").toClassName()}
                      value={allocJumperVal}
                      onChange={(e) => setAllocJumperVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = Number.parseInt(allocJumperVal, 10);
                          if (!Number.isNaN(v)) setAllocPage(Math.min(allocTotalPages, Math.max(1, v)));
                        }
                      }}
                    />
                    页
                  </span>
                </div>
              </div>

              <div className={root.elem("footer-actions").toClassName()}>
                <button type="button" className={root.elem("btn").mod({ primary: true }).toClassName()} onClick={onDistribute}>
                  分发
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          className={root.elem("modal-backdrop").toClassName()}
          role="presentation"
          onClick={() => setModalOpen(false)}
        >
          <div
            className={root.elem("modal").mod({ light: true }).toClassName()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ptw-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={root.elem("modal-head").toClassName()}>
              <span id="ptw-modal-title">添加人员</span>
              <button
                type="button"
                className={root.elem("modal-close").toClassName()}
                onClick={() => setModalOpen(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className={root.elem("modal-body").toClassName()}>
              <div className={root.elem("modal-col").toClassName()}>
                <div className={root.elem("modal-pane-head").toClassName()}>{modalLeftTotalCount} 项</div>
                <div className={root.elem("modal-search").toClassName()}>
                  <div className={root.elem("modal-search-inner").toClassName()}>
                    <input
                      placeholder="请输入用户名"
                      value={searchTree}
                      onChange={(e) => setSearchTree(e.target.value)}
                      autoComplete="off"
                    />
                    <span className={root.elem("modal-search-icon").toClassName()} aria-hidden>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                          d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM21 21l-4.35-4.35"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </div>
                </div>
                <div className={root.elem("modal-scroll").toClassName()}>
                  {orgUsersLoading ? (
                    <div className={root.elem("empty").toClassName()}>加载组织成员中…</div>
                  ) : (
                    <OrgTreeUserList
                      groups={orgGroups}
                      search={searchTree}
                      selectedLeft={selectedLeft}
                      onToggle={toggleLeft}
                      onToggleOrgUsers={toggleOrgUsers}
                      collapsedOrgIds={collapsedOrgIds}
                      onToggleOrg={toggleOrgCollapse}
                      bem={root}
                    />
                  )}
                </div>
              </div>
              <div className={root.elem("modal-mid").toClassName()}>
                <button
                  type="button"
                  className={root.elem("arrow-btn").toClassName()}
                  onClick={moveToRight}
                  disabled={selectedLeft.size === 0}
                  title="加入已选"
                >
                  &gt;
                </button>
                <button
                  type="button"
                  className={root.elem("arrow-btn").toClassName()}
                  onClick={moveToLeft}
                  disabled={selectedRight.size === 0}
                  title="移回左侧"
                >
                  &lt;
                </button>
              </div>
              <div className={root.elem("modal-col").toClassName()}>
                <div className={root.elem("modal-pane-head").toClassName()}>{modalRight.length} 项</div>
                <div className={root.elem("modal-scroll").toClassName()}>
                  {modalRight.length === 0 ? (
                    <div className={root.elem("empty").toClassName()}>暂无数据</div>
                  ) : (
                    modalRight.map((p) => (
                      <div key={p.id} className={root.elem("tree-row").toClassName()}>
                        <input
                          type="checkbox"
                          checked={selectedRight.has(p.id)}
                          onChange={() => toggleRight(p.id)}
                          id={`right-${p.id}`}
                        />
                        <label htmlFor={`right-${p.id}`}>
                          {p.title}({p.username})
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className={root.elem("modal-foot").toClassName()}>
              <Button
                type="button"
                look="outlined"
                className={root.elem("modal-btn-cancel").toClassName()}
                onClick={() => setModalOpen(false)}
              >
                取消
              </Button>
              <Button type="button" className={root.elem("modal-btn-ok").toClassName()} onClick={confirmModal}>
                确定
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

ProjectTeamWorkflowPage.path = "/team-workflow";
ProjectTeamWorkflowPage.title = "项目人员与分配";
