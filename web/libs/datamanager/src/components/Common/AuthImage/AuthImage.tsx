/**
 * Image component that supports auth headers for embedded mode (无界).
 * When auth is required, fetches via XHR with auth headers and displays blob URL.
 * Native <img src> cannot add headers, so this is needed for gateway-protected images.
 */
import { useState, useEffect } from "react";
import { imageCache } from "@humansignal/core";

type AuthImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

const needsAuth = (): boolean => {
  if (typeof window === "undefined") return false;
  const headers = (window as any).__LS_IMAGE_REQUEST_HEADERS__?.();
  return headers && typeof headers === "object" && Object.keys(headers).length > 0;
};

const isEmbeddedMode = (): boolean => {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).__POWERED_BY_WUJIE__ || window.location?.pathname?.includes("/embed"));
};

const wait = (timeout: number) => new Promise((resolve) => setTimeout(resolve, timeout));

const waitForAuthHeaders = async (timeout = 3000, interval = 100): Promise<boolean> => {
  if (needsAuth()) return true;

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await wait(interval);
    if (needsAuth()) return true;
  }

  return false;
};

export const AuthImage = ({ src, alt = "", ...props }: AuthImageProps) => {
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setBlobSrc(null);

    if (!src) return;

    if (!isEmbeddedMode() && !needsAuth()) {
      setBlobSrc(src);
      return;
    }

    const load = async () => {
      await waitForAuthHeaders();
      if (cancelled) return;

      try {
        const cached = await imageCache.load(src, "anonymous");
        if (!cancelled) setBlobSrc(cached.blobUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src) return null;
  if (error) return <span title={alt || "Data"}>{alt || "Data"}</span>;
  if (!blobSrc && (isEmbeddedMode() || needsAuth())) return <span title={alt || "Data"}>...</span>;

  return <img {...props} src={blobSrc ?? src} alt={alt} />;
};
