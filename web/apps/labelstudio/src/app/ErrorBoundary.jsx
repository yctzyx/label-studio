import React, { Component } from "react";
import { Button } from "@humansignal/ui";
import { ErrorWrapper } from "../components/Error/Error";
import { Modal } from "../components/Modal/ModalPopup";
import { captureException } from "../config/Sentry";
import { isFF } from "../utils/feature-flags";
import { IMPROVE_GLOBAL_ERROR_MESSAGES } from "../providers/ApiProvider";
import { isEmbeddedLayout } from "../utils/getMainPlatformToken";
import { notifyGlobalError } from "../utils/globalErrorNotify";
import { cn } from "../utils/bem";
import "./ErrorBoundary.scss";

export const ErrorContext = React.createContext();

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, toastNotified: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, { componentStack }) {
    console.error(error);

    captureException(error, {
      extra: {
        component_stacktrace: componentStack,
        sentry_skip: error.sentry_skip || false,
      },
    });

    const message = error?.message ? String(error.message) : String(error);
    if (isEmbeddedLayout()) {
      notifyGlobalError("Runtime error", message);
    }

    this.setState({
      error,
      hasError: true,
      errorInfo: componentStack,
      toastNotified: true,
    });
  }

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;
      const message = error?.message ? String(error.message) : String(error);

      const goBack = () => {
        history.back();
        setTimeout(() => location.reload(), 32);
      };

      const stacktrace = isFF(IMPROVE_GLOBAL_ERROR_MESSAGES)
        ? undefined
        : `${errorInfo ? `Component Stack: ${errorInfo}` : ""}\n\n${this.state.error?.stack ?? ""}`;

      // Embed: toast + compact inline banner — do not block parent platform with a modal.
      if (isEmbeddedLayout()) {
        return (
          <div className={cn("embed-error-fallback").toClassName()}>
            <p className={cn("embed-error-fallback").elem("title").toClassName()}>页面加载出错</p>
            <p className={cn("embed-error-fallback").elem("message").toClassName()}>{message}</p>
            <div className={cn("embed-error-fallback").elem("actions").toClassName()}>
              <Button size="small" onClick={() => location.reload()}>
                重新加载
              </Button>
            </div>
          </div>
        );
      }

      return (
        <Modal onHide={() => location.reload()} style={{ width: "60vw" }} visible bare>
          <div style={{ padding: 40 }}>
            <ErrorWrapper
              title="Runtime error"
              message={error}
              stacktrace={stacktrace}
              onGoBack={goBack}
              onReload={() => location.reload()}
            />
          </div>
        </Modal>
      );
    }

    return (
      <ErrorContext.Provider
        value={{
          hasError: this.state.hasError,
          error: this.state.error,
          errorInfo: this.state.errorInfo,
          silence: this.silence,
          unsilence: this.unsilence,
        }}
      >
        {this.props.children}
      </ErrorContext.Provider>
    );
  }
}

export const ErrorUI = () => {
  const context = React.useContext(ErrorContext);

  return context.hasError && <div className="error">Error occurred</div>;
};
