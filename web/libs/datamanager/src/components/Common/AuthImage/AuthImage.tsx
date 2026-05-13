/**
 * Image component that supports auth headers for embedded mode (无界).
 * When auth is required, fetches via XHR with auth headers and displays blob URL.
 * Native <img src> cannot add headers, so this is needed for gateway-protected images.
 */
import { useState, useEffect, useRef } from "react";
import { imageCache } from "@humansignal/core";

type AuthImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

const needsAuth = (): boolean => {
  if (typeof window === "undefined") return false;
  const headers = (window as any).__LS_IMAGE_REQUEST_HEADERS__?.();
  return headers && typeof headers === "object" && Object.keys(headers).length > 0;
};

export const AuthImage = ({ src, alt = "", ...props }: AuthImageProps) => {
  const [blobSrc, setBlobSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setError(false);
    setBlobSrc(null);

    if (!src) return;

    if (!needsAuth()) {
      setBlobSrc(src);
      return;
    }

    imageCache
      .load(src, "anonymous")
      .then((cached) => {
        if (mountedRef.current) setBlobSrc(cached.blobUrl);
      })
      .catch(() => {
        if (mountedRef.current) setError(true);
      });

    return () => {
      mountedRef.current = false;
    };
  }, [src]);

  if (!src) return null;
  if (error) return <span title={alt || "Data"}>{alt || "Data"}</span>;
  if (!blobSrc && needsAuth()) return <span title={alt || "Data"}>...</span>;

  return <img {...props} src={blobSrc ?? src} alt={alt} />;
};
