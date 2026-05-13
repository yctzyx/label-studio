/**
 * Label Studio 同源 API 根（与 `web/apps/labelstudio/src/config/ApiConfig.js` 中 gateway 规则一致）；
 * 父平台表直连接口使用此路径：`/api/parent-integration/...`。
 */
export function getLabelStudioApiGateway(): string {
  if (typeof window === "undefined") return "";
  const hostname = window.APP_SETTINGS?.hostname;
  if (!hostname) return "";
  const h = String(hostname).replace(/(\/)+$/, "");
  return h.includes("/api") ? h : `${h}/api`;
}

/**
 * 父平台 OpenAPI 根路径（与 LS 的 `hostname` 同源，一般为 `.../api`，不含 `/label-studio` 后缀）。
 * @deprecated 若已改为后端直连数据库，请使用 {@link getLabelStudioApiGateway} 调用 `/api/parent-integration/*`。
 */
export function getParentPlatformApiBase(): string {
  if (typeof window === "undefined") return "";
  const raw = (window as Window & { APP_SETTINGS?: { parentPlatformApiBase?: string; hostname?: string } })
    .APP_SETTINGS?.parentPlatformApiBase;
  if (raw) return String(raw).replace(/(\/)+$/, "");

  const hostname = window.APP_SETTINGS?.hostname;
  if (!hostname) return "";
  const h = String(hostname).replace(/(\/)+$/, "");
  const gateway = h.includes("/api") ? h : `${h}/api`;
  return gateway.replace(/\/label-studio\/?$/i, "");
}

export function isParentDatasetImportEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const flags = (window as Window & { APP_SETTINGS?: { flags?: { parent_dataset_import?: boolean } } }).APP_SETTINGS
    ?.flags;
  if (flags && flags.parent_dataset_import === false) return false;
  return true;
}
