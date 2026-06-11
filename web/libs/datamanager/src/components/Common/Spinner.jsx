import { inject } from "mobx-react";
import React from "react";
import { Spinner as UiSpinner } from "@humansignal/ui";

const injector = inject(({ store }) => {
  return {
    SDK: store?.SDK,
  };
});

export const Spinner = injector(({ SDK, visible = true, size: sizeKey, className, style, ...rest }) => {
  const size = React.useMemo(() => {
    switch (sizeKey) {
      case "large":
        return SDK?.spinnerSize?.large ?? 32;
      case "middle":
        return SDK?.spinnerSize?.middle ?? 32;
      case "small":
        return SDK?.spinnerSize?.small ?? 32;
      default:
        return SDK?.spinnerSize?.middle ?? 32;
    }
  }, [SDK?.spinnerSize?.large, SDK?.spinnerSize?.middle, SDK?.spinnerSize?.small, sizeKey]);

  const ExternalSpinner = SDK?.spinner;

  if (!visible) return null;

  return (
    <div
      className={className}
      style={{ width: size, height: size, ...style }}
      {...rest}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {ExternalSpinner ? <ExternalSpinner size={size} /> : <UiSpinner size={size} />}
      </div>
    </div>
  );
});
