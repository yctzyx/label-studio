/**
 * Image component that supports auth headers for embedded mode (无界).
 * When auth is required, fetches via XHR with auth headers and displays blob URL.
 * Native <img src> cannot add headers, so this is needed for gateway-protected images.
 */
import { useState, useEffect } from "react";
import { imageCache, needsImageAuthHeaders, waitForAuthHeaders } from "@humansignal/core";

type AuthImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

const isEmbeddedMode = (): boolean => {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).__POWERED_BY_WUJIE__ || window.location?.pathname?.includes("/embed"));
};

export const AuthImage = ({ src, alt = "", ...props }: AuthImageProps) => {
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setBlobSrc(null);

    if (!src) return;

    if (!isEmbeddedMode() && !needsImageAuthHeaders()) {
      setBlobSrc(src);
      return;
    }

    const load = async () => {
      imageCache.evictExpired();
      await waitForAuthHeaders();
      if (cancelled) return;

      try {
        const cached = await imageCache.load(src, "anonymous");
        if (!cancelled) {
          setBlobSrc(cached.blobUrl);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };

    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      load();
    };

    load();
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [src]);

  if (!src) return null;
  if (error) return <span title={alt || "Data"}>{alt || "Data"}</span>;
  if (!blobSrc && (isEmbeddedMode() || needsImageAuthHeaders())) return <span title={alt || "Data"}>...</span>;

  return <img {...props} src={blobSrc ?? src} alt={alt} />;
};
