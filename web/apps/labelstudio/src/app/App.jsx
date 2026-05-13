/* global Sentry */

import "../i18n";
import { createBrowserHistory } from "history";
import { useEffect } from "react";
import { render } from "react-dom";
import { Router } from "react-router-dom";
import { LEAVE_BLOCKER_KEY, leaveBlockerCallback } from "../components/LeaveBlocker/LeaveBlocker";
import { initSentry } from "../config/Sentry";
import { ApiProvider, useAPI } from "../providers/ApiProvider";
import { AppStoreProvider } from "../providers/AppStoreProvider";
import { ConfigProvider } from "../providers/ConfigProvider";
import { MultiProvider } from "../providers/MultiProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { RoutesProvider } from "../providers/RoutesProvider";
import { DRAFT_GUARD_KEY, DraftGuard, draftGuardCallback } from "../components/DraftGuard/DraftGuard";
import { AsyncPage } from "./AsyncPage/AsyncPage";
import ErrorBoundary from "./ErrorBoundary";
import { FF_UNSAVED_CHANGES, isFF } from "../utils/feature-flags";
import { TourProvider } from "@humansignal/core";
import { ToastProvider, ToastViewport } from "@humansignal/ui";
import { JotaiProvider, JotaiStore } from "../utils/jotai-store";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@humansignal/core/lib/utils/query-client";
import { RootPage } from "./RootPage";
import { ff } from "@humansignal/core";
import "@humansignal/ui/src/tailwind.css";
import "./App.scss";
import { AuthProvider } from "@humansignal/core/providers/AuthProvider";
import { isEmbeddedLayout } from "../utils/getMainPlatformToken";

const baseURL = new URL(APP_SETTINGS.hostname || location.origin);
export const UNBLOCK_HISTORY_MESSAGE = "UNBLOCK_HISTORY";

// embed 入口 pathname 为 /embed、/embed/ 或 /embed/projects 等，需设 basename 才能让路由匹配到 /
const pathname = typeof location?.pathname === "string" ? location.pathname : "";
const embedMatch = pathname.match(/^(\/embed|\/.*\/embed)(?=\/|$)/);
const isEmbedPath = !!embedMatch;
const basename = isEmbedPath ? embedMatch[1] : baseURL.pathname || "/";

/* iframe / 无界 /embed：收紧布局（含「仅 iframe、URL 无 embed」场景） */
if (typeof document !== "undefined" && isEmbeddedLayout()) {
  document.documentElement.classList.add("ls-embed");
}

const browserHistory = createBrowserHistory({
  basename,
  // callback is an async way to confirm or decline going to another page in the context of routing. It accepts `true` or `false`
  getUserConfirmation: (message, callback) => {
    // `history.block` doesn't block events, so in the case of listeners,
    // we need to have some flag that can be checked for preventing related actions
    // `isBlocking` flag is used for this purpose
    browserHistory.isBlocking = true;
    const callbackWrapper = (result) => {
      browserHistory.isBlocking = false;
      callback(result);
      isFF(FF_UNSAVED_CHANGES) && window.postMessage({ source: "label-studio", payload: UNBLOCK_HISTORY_MESSAGE });
    };
    if (message === DRAFT_GUARD_KEY) {
      draftGuardCallback.current = callbackWrapper;
    } else if (isFF(FF_UNSAVED_CHANGES) && message === LEAVE_BLOCKER_KEY) {
      leaveBlockerCallback.current = callbackWrapper;
    } else {
      callbackWrapper(window.confirm(message));
    }
  },
});

window.LSH = browserHistory;

initSentry(browserHistory);

const App = ({ content }) => {
  useEffect(() => {
    if (isEmbeddedLayout()) document.documentElement.classList.add("ls-embed");
  }, []);

  return (
    <ErrorBoundary>
      <Router history={browserHistory}>
        <MultiProvider
          providers={[
            <QueryClientProvider client={queryClient} key="query" />,
            <JotaiProvider key="jotai" store={JotaiStore} />,
            <AuthProvider key="auth" />,
            <AppStoreProvider key="app-store" />,
            <ToastProvider key="toast" />,
            <ApiProvider key="api" />,
            <ConfigProvider key="config" />,
            <RoutesProvider key="rotes" />,
            <ProjectProvider key="project" />,
            ff.isActive(ff.FF_PRODUCT_TOUR) && <TourProvider useAPI={useAPI} />,
          ].filter(Boolean)}
        >
          <AsyncPage>
            <DraftGuard />
            <RootPage content={content} />
            <ToastViewport />
          </AsyncPage>
        </MultiProvider>
      </Router>
    </ErrorBoundary>
  );
};

const root = document.querySelector(".app-wrapper");
const content = document.querySelector("#main-content");
const contentHTML = content?.innerHTML ?? "";

// [LS-embed] 排查空白页：记录挂载时的关键信息
console.log("[LS-embed] App mount", {
  hasRoot: !!root,
  hasContent: !!content,
  contentLength: contentHTML?.length ?? 0,
  hostname: window.APP_SETTINGS?.hostname,
  pathname: location.pathname,
  basename,
  isEmbedPath,
  origin: location.origin,
});

render(<App content={contentHTML} />, root);

if (module?.hot) {
  module.hot.accept(); // Enable HMR for React components
}
