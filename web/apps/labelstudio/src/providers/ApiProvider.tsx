import { type PropsWithChildren, useCallback, useEffect, forwardRef } from "react";
import {
  ApiProvider as CoreApiProvider,
  createApiInstance,
  type ApiContextType,
  type FormattedError,
} from "@humansignal/core";
import type { ApiResponse } from "@humansignal/core/lib/api-proxy/types";
import { ErrorWrapper } from "../components/Error/Error";
import { modal } from "../components/Modal/Modal";
import { API_CONFIG } from "../config/ApiConfig";
import { getMainPlatformAuthHeaders, isEmbeddedLayout, isWujieEmbed, retryEmbedAuth } from "../utils/getMainPlatformToken";

// Expose auth headers for image requests (ImageCache, FileLoader) when embedded - gateway requires token
declare global {
  interface Window {
    __LS_IMAGE_REQUEST_HEADERS__?: () => Record<string, string>;
  }
}
import { absoluteURL, isDefined } from "../utils/helpers";
import { FF_IMPROVE_GLOBAL_ERROR_MESSAGES, isFF } from "../utils/feature-flags";
import { ToastType, useToast } from "@humansignal/ui";
import { captureException } from "../config/Sentry";
import {
  API_ERROR_TOAST_DURATION,
  formatGlobalErrorMessage,
  notifyGlobalError,
  registerGlobalErrorToast,
} from "../utils/globalErrorNotify";

export { API_ERROR_TOAST_DURATION };
export const IMPROVE_GLOBAL_ERROR_MESSAGES = isFF(FF_IMPROVE_GLOBAL_ERROR_MESSAGES);

// Initialize API instance with Label Studio configuration.
// When embedded via 无界 (wujie), getCommonHeaders adds Authorization: <token> (no Bearer prefix).
const apiInstance = createApiInstance({
  ...API_CONFIG,
  getCommonHeaders: () => getMainPlatformAuthHeaders(),
  retryOnUnauthorized: retryEmbedAuth,
  onRequestFinished(res) {
    if (res.status === 401 && !isWujieEmbed()) {
      location.href = "/";
    }
  },
});

// Export API instance for backward compatibility
export const API = apiInstance;

// Re-export useAPI and ApiContext from core for convenience
export { useAPI, ApiContext } from "@humansignal/core";

export type ApiEndpoints = keyof typeof API.methods;

let apiLocked = false;

/**
 * Displays an error modal with the error details.
 */
const displayErrorModal = (errorDetails: FormattedError) => {
  const { isShutdown, title, message, stacktrace, ...formattedError } = errorDetails;

  modal({
    unique: "network-error",
    allowClose: !isShutdown,
    body: isShutdown ? (
      <ErrorWrapper
        possum={false}
        title={"Connection refused"}
        message={"Server not responding. Is it still running?"}
      />
    ) : (
      <ErrorWrapper
        {...formattedError}
        title={title}
        message={message}
        stacktrace={IMPROVE_GLOBAL_ERROR_MESSAGES ? undefined : stacktrace}
      />
    ),
    simple: true,
    style: { width: 680 },
  });
};

/**
 * Label Studio application-specific ApiProvider.
 * Wraps the core ApiProvider with Label Studio-specific error handling.
 */
export const ApiProvider = forwardRef<ApiContextType, PropsWithChildren<Record<string, never>>>(({ children }, ref) => {
  const toast = useToast();

  /**
   * Handles errors with Label Studio-specific logic including:
   * - Toast notifications for 4xx errors
   * - Modal errors for validation errors
   * - Sentry logging for server errors
   */
  const handleError = useCallback(
    (errorDetails: FormattedError, result: ApiResponse) => {
      const status = result.$meta?.status;
      const is4xx = status?.toString().startsWith("4");
      const containsValidationErrors =
        isDefined(result.response?.validation_errors) && Object.keys(result.response.validation_errors).length > 0;

      // Log to Sentry for non-4xx or errors with stacktraces
      if ((!is4xx || result.response?.exc_info) && result.error) {
        captureException(new Error(result.error), {
          extra: {
            status,
            server_stacktrace: result.response?.exc_info,
            server_version: result.response?.version,
          },
        });
      }

      const toastMessage = formatGlobalErrorMessage(errorDetails.title, errorDetails.message);

      // Embed: always toast — avoid blocking modal over parent platform chrome.
      if (isEmbeddedLayout()) {
        toast?.show({
          message: toastMessage,
          type: ToastType.error,
          duration: API_ERROR_TOAST_DURATION,
        });
        return;
      }

      // Standalone: toast for 4xx without validation errors; modal otherwise.
      if (IMPROVE_GLOBAL_ERROR_MESSAGES && is4xx && !containsValidationErrors) {
        toast?.show({
          message: toastMessage,
          type: ToastType.error,
          duration: API_ERROR_TOAST_DURATION,
        });
      } else {
        displayErrorModal(errorDetails);
      }
    },
    [toast],
  );

  /**
   * Handles fatal errors like 401 and 404.
   */
  const handleFatalError = useCallback((errorDetails: FormattedError, result: ApiResponse) => {
    if (apiLocked) return;

    const status = result.$meta?.status;

    // Handle 401 redirects (skip in 无界 embed: shell stays until parent provides token)
    if (status === 401) {
      if (!isWujieEmbed()) {
        apiLocked = true;
        location.href = absoluteURL("/");
      }
      return;
    }

    // Handle 404 redirects with improved error messages
    if (IMPROVE_GLOBAL_ERROR_MESSAGES && status === 404) {
      apiLocked = true;
      let redirectUrl = absoluteURL("/");

      if (location.pathname.startsWith("/projects")) {
        redirectUrl = absoluteURL("/projects");
      }

      sessionStorage.setItem("redirectMessage", "The page or resource you were looking for does not exist.");
      location.href = redirectUrl;
    }
  }, []);

  // Check for redirect messages on mount
  useEffect(() => {
    const redirectMessage = sessionStorage.getItem("redirectMessage");
    if (redirectMessage) {
      toast?.show({
        message: redirectMessage,
        type: ToastType.error,
        duration: API_ERROR_TOAST_DURATION,
      });
      sessionStorage.removeItem("redirectMessage");
    }
  }, [toast]);

  // Register toast for imperative global errors (ErrorBoundary, AsyncPage, etc.)
  useEffect(() => {
    registerGlobalErrorToast(toast?.show ?? null);
    return () => registerGlobalErrorToast(null);
  }, [toast]);

  // When embedded (无界 / iframe), provide auth headers for image requests (ImageCache, FileLoader)
  // so /data/upload/* and parent-dataset proxy requests include Authorization for the gateway
  useEffect(() => {
    if (!isEmbeddedLayout()) return;

    window.__LS_IMAGE_REQUEST_HEADERS__ = () => getMainPlatformAuthHeaders();

    const onResume = async () => {
      if (document.visibilityState === "hidden") return;
      const { requestParentTokenRefresh } = await import("@humansignal/core/lib/utils/gatewayAuth");
      await requestParentTokenRefresh();
    };

    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);

    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      delete (window as any).__LS_IMAGE_REQUEST_HEADERS__;
    };
  }, []);

  return (
    <CoreApiProvider ref={ref} onError={handleError} onFatalError={handleFatalError}>
      {children}
    </CoreApiProvider>
  );
});

ApiProvider.displayName = "ApiProvider";
