import * as ff from "./lib/utils/feature-flags/ff";

export * from "./lib/Tour";
export * from "./lib/preview";
export * from "./lib/utils/analytics";
export * from "./lib/utils/urlJSON";
export * from "./lib/utils/helpers";
export * from "./lib/utils/string";
export * from "./lib/utils/bem";
export * from "./lib/utils/visitedProjects";
export * from "./lib/utils/billing";
export * from "./hooks/useAbortController";
export * from "./lib/hooks/useCopyText";
export * from "./hooks/usePageTitle";

// API Provider
export {
  ApiProvider,
  ApiContext,
  useAPI,
  errorFormatter,
} from "./providers/api-provider";
export {
  createApiInstance,
  getApiInstance,
  resetApiInstance,
  API,
} from "./lib/api-provider/api-instance";
export type {
  ApiCallOptions,
  ApiContextType,
  FormattedError,
  ErrorHandlerOptions,
  ApiProviderConfig,
} from "./lib/api-provider/types";

export { ff };

// Image cache for shared use across editor and datamanager
export { imageCache } from "./lib/utils/ImageCache";
export { needsImageAuthHeaders, waitForAuthHeaders, waitBeforeAuthRetry } from "./lib/utils/imageAuth";
export {
  GATEWAY_SESSION_EXPIRED_CODES,
  isGatewaySessionExpiredPayload,
  blobIndicatesGatewayAuthFailure,
  requestParentTokenRefresh,
} from "./lib/utils/gatewayAuth";
export { getStaticOrigin, resolvePublicStaticUrl, trimStaticOrigin } from "./lib/utils/resolveStaticOrigin";
