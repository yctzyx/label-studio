import { Button } from "@humansignal/ui";
import { modal } from "../../components/Modal/Modal";
import { useModalControls } from "../../components/Modal/ModalPopup";
import { Space } from "../../components/Space/Space";
import { cn } from "../../utils/bem";
import i18n from "../../i18n";

export const WebhookDeleteModal = ({ onDelete }) => {
  return modal({
    title: i18n.t("Delete webhook confirmation title"),
    body: () => {
      const ctrl = useModalControls();
      const rootClass = cn("webhook-delete-modal");
      return (
        <div className={rootClass}>
          <div className={rootClass.elem("modal-text")}>
            {i18n.t("Are you sure you want to delete the webhook? This action cannot be undone.")}
          </div>
        </div>
      );
    },
    footer: () => {
      const ctrl = useModalControls();
      const rootClass = cn("webhook-delete-modal");
      return (
        <Space align="end">
          <Button
            look="outlined"
            onClick={() => {
              ctrl.hide();
            }}
            aria-label={i18n.t("Cancel webhook deletion")}
          >
            {i18n.t("Cancel")}
          </Button>
          <Button
            variant="negative"
            onClick={async () => {
              await onDelete();
              ctrl.hide();
            }}
            aria-label={i18n.t("Confirm webhook deletion")}
          >
            {i18n.t("Delete Webhook")}
          </Button>
        </Space>
      );
    },
    style: { width: 512 },
  });
};
