/**
 * Detect parent-platform / gateway session errors (HTTP 200 + JSON body).
 * Common codes: 400001004 / 400001006 — "未登录或登录已过期".
 */

export const GATEWAY_SESSION_EXPIRED_CODES = [400001004, 400001006, 401] as const;

export function isGatewaySessionExpiredPayload(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;

  const obj = data as Record<string, unknown>;

  if (typeof obj.code === "number" && (GATEWAY_SESSION_EXPIRED_CODES as readonly number[]).includes(obj.code)) {
    return true;
  }

  if (obj.success === false && typeof obj.msg === "string") {
    return obj.msg.includes("未登录") || obj.msg.includes("登录已过期");
  }

  if (typeof obj.msg === "string") {
    return obj.msg.includes("未登录") || obj.msg.includes("登录已过期");
  }

  return false;
}

/**
 * Read blob body (small JSON auth errors) and detect gateway session failure.
 */
export async function blobIndicatesGatewayAuthFailure(blob: Blob | null): Promise<boolean> {
  if (!blob || blob.size === 0) return false;

  const slice = blob.size > 512 ? blob.slice(0, 512) : blob;

  try {
    const text = await slice.text();
    if (!text) return false;

    if (
      text.includes("400001004") ||
      text.includes("400001006") ||
      text.includes("未登录") ||
      text.includes("登录已过期")
    ) {
      return true;
    }

    if (text.trim().startsWith("{")) {
      try {
        return isGatewaySessionExpiredPayload(JSON.parse(text));
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }

  return false;
}

declare global {
  interface Window {
    $wujie?: {
      bus?: { $emit?: (event: string, ...args: unknown[]) => void };
      props?: {
        refreshToken?: () => Promise<unknown>;
        onTokenExpired?: () => void;
      };
    };
  }
}

/**
 * Ask parent platform (无界 host) to refresh or renew session token.
 */
export async function requestParentTokenRefresh(): Promise<void> {
  if (typeof window === "undefined") return;

  const props = window.$wujie?.props;

  if (typeof props?.refreshToken === "function") {
    try {
      await props.refreshToken();
    } catch {
      // parent handles errors
    }
    return;
  }

  if (typeof props?.onTokenExpired === "function") {
    try {
      props.onTokenExpired();
    } catch {
      // ignore
    }
    return;
  }

  try {
    window.$wujie?.bus?.$emit?.("token-expired");
  } catch {
    // ignore
  }

  try {
    window.parent?.postMessage?.({ source: "label-studio", type: "TOKEN_EXPIRED", code: 400001004 }, "*");
  } catch {
    // ignore
  }
}
