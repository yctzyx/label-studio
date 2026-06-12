/**
 * Get main platform token for 无界 (wujie) micro-frontend integration.
 * Priority: token from wujie props.getUser(), then optional fallback (e.g. getToken()).
 * Used to send Authorization: <token> (no Bearer prefix) on all API requests when embedded.
 */

declare global {
  interface Window {
    __POWERED_BY_WUJIE__?: boolean;
    $wujie?: {
      props?: {
        getUser?: () => { token?: string; [key: string]: unknown };
        /** Optional: platform origin for /static proxy (e.g. http://platform:5173). See getStaticOrigin in @humansignal/core. */
        getStaticOrigin?: () => string | null | undefined;
      };
    };
  }
}

/**
 * True when running as 无界 (wujie) sub-app or when page is the embed entry.
 * Use to skip 401→login redirect so embed shell can stay until token is provided.
 */
export function isWujieEmbed(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__POWERED_BY_WUJIE__) return true;
  if (typeof window.location?.pathname === "string" && window.location.pathname.includes("/embed")) return true;
  return false;
}

/**
 * 嵌入 UI 形态：无界、/embed 路由，或挂在任意 iframe 内（与 URL 是否含 /embed 无关）。
 * 用于 ls-embed 布局与隐藏顶栏；401 等行为仍请用 {@link isWujieEmbed}。
 */
export function isEmbeddedLayout(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__POWERED_BY_WUJIE__) return true;
  if (typeof window.location?.pathname === "string" && window.location.pathname.includes("/embed")) return true;
  try {
    return window.self !== window.top;
  } catch {
    /* 跨域 iframe 访问 top 会抛错，视为嵌入 */
    return true;
  }
}

/**
 * Returns the main platform token when running inside 无界 (wujie), or from fallback.
 * @param getTokenFallback - Optional fallback when not in wujie or when getUser has no token (e.g. () => localStorage.getItem('token'))
 * @returns The token to use for Authorization header, or null
 */
export function getMainPlatformToken(getTokenFallback?: () => string | null): string | null {
  let token: string | null = null;

  if (typeof window !== "undefined" && window.__POWERED_BY_WUJIE__ && window.$wujie?.props?.getUser) {
    try {
      const userInfo = window.$wujie.props.getUser();
      if (userInfo?.token) token = userInfo.token;
    } catch {
      // ignore
    }
  }

  if (!token && getTokenFallback) token = getTokenFallback();
  return token || null;
}

/**
 * Returns headers to attach to API requests when main platform token is used.
 * Sends Authorization: <token> only (no "Bearer " prefix), to match gateway expectation.
 */
export function getMainPlatformAuthHeaders(getTokenFallback?: () => string | null): Record<string, string> {
  const token = getMainPlatformToken(getTokenFallback);
  if (!token) return {};
  return { Authorization: token };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll until wujie injects a platform token, or timeout.
 * Avoids racing the parent shell on first embed mount (token arrives shortly after sub-app loads).
 */
export async function waitForMainPlatformToken(
  options: { timeoutMs?: number; intervalMs?: number; getTokenFallback?: () => string | null } = {},
): Promise<string | null> {
  const { timeoutMs = 3000, intervalMs = 100, getTokenFallback } = options;

  if (typeof window === "undefined" || !window.__POWERED_BY_WUJIE__) {
    return getMainPlatformToken(getTokenFallback);
  }

  const deadline = Date.now() + timeoutMs;
  let token = getMainPlatformToken(getTokenFallback);

  while (!token && Date.now() < deadline) {
    await delay(intervalMs);
    token = getMainPlatformToken(getTokenFallback);
  }

  return token;
}
