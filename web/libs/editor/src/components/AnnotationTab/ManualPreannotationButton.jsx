import { inject, observer } from "mobx-react";
import { Button } from "@humansignal/ui";
import { cn } from "../../utils/bem";
import "./ManualPreannotationButton.scss";

export const ManualPreannotationButton = inject("store")(
  observer(({ store }) => {
    if (!store.hasInterface("retrieve-predictions")) return null;

    const predictionsCount = store.annotationStore?.predictions?.length ?? 0;
    const isPredicting = store.mlPredicting;
    const hasPredictions = predictionsCount > 0;

    const handleClick = () => {
      if (!store.events?.hasEvent("retrieveTaskPredictions")) return;
      void store.events.invokeFirst("retrieveTaskPredictions", store);
    };

    return (
      <div className={cn("manual-preannotation").toClassName()}>
        <Button
          variant="neutral"
          size="small"
          look="outlined"
          disabled={isPredicting || hasPredictions}
          waiting={isPredicting}
          onClick={handleClick}
          aria-label="模型预标注"
          data-testid="bottombar-manual-preannotation-button"
        >
          {isPredicting ? "模型标注中..." : "模型预标注"}
        </Button>
      </div>
    );
  }),
);
