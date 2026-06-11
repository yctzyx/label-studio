import { inject } from "mobx-react";
import { IconChevronLeft } from "@humansignal/icons";
import { Button } from "@humansignal/ui";
import { Interface } from "../../Common/Interface";

const injector = inject(({ store }) => ({
  store,
}));

export const BackButton = injector(({ store, size, style, ...rest }) => {
  return (
    <Interface name="explorerBackButton">
      <Button
        size={size ?? "small"}
        look="outlined"
        variant="neutral"
        leading={<IconChevronLeft />}
        aria-label="返回上一页"
        onClick={() => store.SDK.invoke("backClicked")}
        style={style}
        {...rest}
      >
        返回
      </Button>
    </Interface>
  );
});
