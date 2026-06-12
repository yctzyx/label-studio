/**
 * Origin for /static/* assets when embedded in the parent platform.
 *
 * Default: current page origin (e.g. platform :5173 with nginx `location /static { proxy_pass LS; }`).
 * Override via APP_SETTINGS.staticHostname or wujie props.getStaticOrigin().
 */

declare global {
  interface Window {
    __POWERED_BY_WUJIE__?: boolean;
    $wujie?: {
      props?: {
        getStaticOrigin?: () => string | null | undefined;
      };
    };
    APP_SETTINGS?: {
      staticHostname?: string;
    };
  }
}

/** Strip trailing slashes from a URL origin or base. */
export function trimStaticOrigin(base: string): string {
  return base.replace(/\/+$/, "");
}

/**
 * Base URL for bundled /static assets (no trailing slash).
 * Empty string means caller should use pathname-only (relative) URLs.
 */
export function getStaticOrigin(): string {
  if (typeof window === "undefined") return "";

  const explicit = window.APP_SETTINGS?.staticHostname?.trim();
  if (explicit) return trimStaticOrigin(explicit);

  if (window.__POWERED_BY_WUJIE__ && window.$wujie?.props?.getStaticOrigin) {
    try {
      const fromParent = window.$wujie.props.getStaticOrigin();
      if (fromParent) return trimStaticOrigin(String(fromParent));
    } catch {
      // ignore
    }
  }

  if (window.location?.origin) return window.location.origin;

  return "";
}

const GATEWAY_STATIC_PREFIX = "/api/label-studio/static/";

function toStaticPathname(src: string): string | null {
  if (src.startsWith("/")) {
    if (src.startsWith(GATEWAY_STATIC_PREFIX)) {
      return `/static/${src.slice(GATEWAY_STATIC_PREFIX.length)}`;
    }
    if (src.startsWith("/static/")) return src;
    return null;
  }
  if (src.match(/^https?:/)) {
    try {
      const path = new URL(src).pathname;
      if (path.startsWith(GATEWAY_STATIC_PREFIX)) {
        return `/static/${path.slice(GATEWAY_STATIC_PREFIX.length)}`;
      }
      if (path.startsWith("/static/")) return path;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolve `/static/...` (or gateway-prefixed static) to same-origin absolute URL when possible.
 */
export function resolvePublicStaticUrl(src: string): string | null {
  if (!src || typeof src !== "string") return null;

  const pathname = toStaticPathname(src);
  if (!pathname) return null;

  const origin = getStaticOrigin();
  return origin ? `${origin}${pathname}` : pathname;
}
