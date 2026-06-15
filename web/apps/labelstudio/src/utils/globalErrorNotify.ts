import { ToastType, type ToastShowArgs } from "@humansignal/ui";
import { isEmbeddedLayout } from "./getMainPlatformToken";

export const API_ERROR_TOAST_DURATION = 10000;

type ToastShowFn = (args: ToastShowArgs) => string;

let toastShow: ToastShowFn | null = null;

/** Register toast.show from a component inside ToastProvider (e.g. ApiProvider). */
export function registerGlobalErrorToast(show: ToastShowFn | null): void {
  toastShow = show;
}

export function formatGlobalErrorMessage(title?: string, message?: string): string {
  const t = (title ?? "").trim();
  const m = String(message ?? "").trim();
  if (t && m) return `${t}: ${m}`;
  return m || t || "An unknown error occurred";
}

/** Prefer toast when embedded in parent shell; returns true if a toast was shown. */
export function notifyGlobalError(
  title: string,
  message: string,
  options: { duration?: number; forceToast?: boolean } = {},
): boolean {
  const useToast = options.forceToast || isEmbeddedLayout();
  if (!useToast || !toastShow) return false;

  toastShow({
    message: formatGlobalErrorMessage(title, message),
    type: ToastType.error,
    duration: options.duration ?? API_ERROR_TOAST_DURATION,
  });
  return true;
}
