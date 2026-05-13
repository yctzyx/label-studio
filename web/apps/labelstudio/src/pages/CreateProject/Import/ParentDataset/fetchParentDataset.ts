import { getMainPlatformAuthHeaders } from "apps/labelstudio/src/utils/getMainPlatformToken";
import { getLabelStudioApiGateway } from "./getParentPlatformApiBase";
import type { ParentDatasetRow, ParentDatasourceRow } from "./types";

function pickList<T>(raw: unknown): T[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const data = o.data ?? o.result ?? o;
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const list = d.list ?? d.records ?? d.rows ?? d.data;
  if (Array.isArray(list)) return list as T[];
  return [];
}

function pickTotal(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const o = raw as Record<string, unknown>;
  const data = o.data ?? o.result ?? o;
  if (!data || typeof data !== "object") return 0;
  const d = data as Record<string, unknown>;
  const t = d.totalCount ?? d.total ?? d.count;
  return typeof t === "number" ? t : Number(t) || 0;
}

async function parentFetchJson<T>(pathWithQuery: string): Promise<T> {
  const base = getLabelStudioApiGateway();
  if (!base) {
    throw new Error("LABEL_STUDIO_API_BASE_MISSING");
  }
  const url = `${base}${pathWithQuery.startsWith("/") ? "" : "/"}${pathWithQuery}`;
  const headers: HeadersInit = {
    Accept: "application/json",
    ...getMainPlatformAuthHeaders(),
  };
  const res = await fetch(url, { method: "GET", credentials: "same-origin", headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** 数据源分页列表，projectId 可省略 */
export async function fetchParentDatasources(projectId?: number | null): Promise<{
  list: ParentDatasourceRow[];
  total: number;
}> {
  const qs = new URLSearchParams({
    order: "",
    asc: "false",
    page: "1",
    limit: "500",
    parentId: "",
    name: "",
    databaseType: "",
    databaseVersion: "",
    dataBaseGroup: "",
  });
  if (projectId != null && Number.isFinite(Number(projectId))) {
    qs.set("projectId", String(projectId));
  }
  const raw = await parentFetchJson<unknown>(`/parent-integration/databases?${qs.toString()}`);
  const list = pickList<ParentDatasourceRow>(raw).map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ""),
    databaseType: r.databaseType != null ? Number(r.databaseType) : undefined,
  }));
  const total = pickTotal(raw);
  return { list, total: total || list.length };
}

/** 数据集分页列表（若父平台支持 `sourceId` 查询参数则会服务端筛选） */
export async function fetchParentDatasets(
  pageNum: number,
  pageSize: number,
  sourceId?: number,
): Promise<{
  list: ParentDatasetRow[];
  total: number;
}> {
  const qs = new URLSearchParams({
    pageNum: String(pageNum),
    pageSize: String(pageSize),
  });
  if (sourceId != null && Number.isFinite(sourceId)) {
    qs.set("sourceId", String(sourceId));
  }
  const raw = await parentFetchJson<unknown>(`/parent-integration/datasets?${qs.toString()}`);
  const list = pickList<Record<string, unknown>>(raw).map((r) => ({
    id: Number(r.id),
    dataSetName: String(r.dataSetName ?? r.name ?? ""),
    sourceId: Number(r.sourceId ?? 0),
    sourceName: r.sourceName != null && String(r.sourceName).trim() !== "" ? String(r.sourceName) : undefined,
    path: String(r.path ?? ""),
    dataSetType: r.dataSetType != null ? String(r.dataSetType) : undefined,
    dataSetTypeLabel:
      r.dataSetTypeLabel != null && String(r.dataSetTypeLabel).trim() !== ""
        ? String(r.dataSetTypeLabel)
        : undefined,
  }));
  const total = pickTotal(raw);
  return { list, total: total || list.length };
}
