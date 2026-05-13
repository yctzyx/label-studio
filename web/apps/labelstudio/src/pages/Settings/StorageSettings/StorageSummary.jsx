import { format } from "date-fns/esm";
import { Button, CodeBlock, IconFileCopy, Space, Tooltip } from "@humansignal/ui";
import { DescriptionList } from "../../../components/DescriptionList/DescriptionList";
import { modal } from "../../../components/Modal/Modal";
import { Oneof } from "../../../components/Oneof/Oneof";
import { useTranslation } from "react-i18next";
import { getLastTraceback } from "../../../utils/helpers";
import { useCopyText } from "@humansignal/core";

// Component to handle copy functionality within the modal
const CopyButton = ({ msg }) => {
  const [copyText, copied] = useCopyText({ defaultText: msg });
  const { t } = useTranslation();

  return (
    <Button variant="neutral" icon={<IconFileCopy />} onClick={() => copyText()} disabled={copied} className="w-[7rem]">
      {copied ? t("Copied!") : t("Copy")}
    </Button>
  );
};

export const StorageSummary = ({ target, storage, className, storageTypes = [] }) => {
  const { t } = useTranslation();
  const storageStatus = storage.status.replace(/_/g, " ").replace(/(^\w)/, (match) => match.toUpperCase());
  const last_sync_count = storage.last_sync_count ? storage.last_sync_count : 0;

  const tasks_existed =
    typeof storage.meta?.tasks_existed !== "undefined" && storage.meta?.tasks_existed !== null
      ? storage.meta.tasks_existed
      : 0;
  const total_annotations =
    typeof storage.meta?.total_annotations !== "undefined" && storage.meta?.total_annotations !== null
      ? storage.meta.total_annotations
      : 0;

  // help text for tasks and annotations
  const tasks_added_help = t("tasks_added_help", { count: last_sync_count });
  const tasks_total_help =
    `${t("tasks_already_synced_hint", { count: tasks_existed })}\n` +
    `${t("tasks_added_total_hint", { total: tasks_existed + last_sync_count })}`;
  const annotations_help = t("annotations_saved_hint", { count: last_sync_count });
  const total_annotations_help =
    typeof storage.meta?.total_annotations !== "undefined"
      ? t("annotations_total_seen_hint", { count: storage.meta.total_annotations })
      : "";

  const handleButtonClick = () => {
    const msg =
      `Error logs for ${target === "export" ? "export " : ""}${storage.type} ` +
      `storage ${storage.id} in project ${storage.project} and job ${storage.last_sync_job}:\n\n` +
      `${getLastTraceback(storage.traceback)}\n\n` +
      `meta = ${JSON.stringify(storage.meta)}\n`;

    const currentModal = modal({
      title: t("Storage Sync Error Log"),
      body: <CodeBlock code={msg} variant="negative" className="max-h-[50vh] overflow-y-auto" />,
      footer: (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {!window.APP_SETTINGS?.whitelabel_is_active && (
            <div>
              <>
                <a
                  href="https://labelstud.io/guide/storage.html#Troubleshooting"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={t("Learn more about cloud storage troubleshooting")}
                >
                  {t("See docs")}
                </a>
                {" "}
                {t("for troubleshooting tips on cloud storage connections.")}
              </>
            </div>
          )}
          <Space>
            <CopyButton msg={msg} />
            <Button variant="primary" className="w-[7rem]" onClick={() => currentModal.close()}>
              {t("Close")}
            </Button>
          </Space>
        </div>
      ),
      style: { width: "700px" },
      optimize: false,
      allowClose: true,
    });
  };

  return (
    <div className={className}>
      <DescriptionList>
        <DescriptionList.Item term={t("Type")}>
          {(storageTypes ?? []).find((s) => s.name === storage.type)?.title ?? storage.type}
        </DescriptionList.Item>

        <Oneof value={storage.type}>
          <SummaryS3 case={["s3", "s3s"]} storage={storage} />
          <GSCStorage case="gcs" storage={storage} />
          <AzureStorage case="azure" storage={storage} />
          <RedisStorage case="redis" storage={storage} />
          <LocalStorage case="localfiles" storage={storage} />
        </Oneof>

        <DescriptionList.Item term={t("Status")} help={t("storage_status_help_tooltip")}>
          {storageStatus === "Failed" || storageStatus === "Completed with errors" ? (
            <span
              className="cursor-pointer border-b border-dashed border-negative-border-subtle text-negative-content"
              onClick={handleButtonClick}
            >
              {storageStatus} {t("(View Logs)")}
            </span>
          ) : (
            storageStatus
          )}
        </DescriptionList.Item>

        {target === "export" ? (
          <DescriptionList.Item term={t("Annotations")} help={`${annotations_help}\n${total_annotations_help}`}>
            <Tooltip title={annotations_help}>
              <span>{last_sync_count}</span>
            </Tooltip>
            <Tooltip title={total_annotations_help}>
              <span> {t("annotations_count_total", { count: total_annotations })}</span>
            </Tooltip>
          </DescriptionList.Item>
        ) : (
          <DescriptionList.Item term={t("Tasks")} help={`${tasks_added_help}\n${tasks_total_help}`}>
            <Tooltip title={`${tasks_added_help}\n${tasks_total_help}`} style={{ whiteSpace: "pre-wrap" }}>
              <span>{last_sync_count + tasks_existed}</span>
            </Tooltip>
            <Tooltip title={tasks_added_help}>
              <span> {t("tasks_count_new", { count: last_sync_count })}</span>
            </Tooltip>
          </DescriptionList.Item>
        )}

        <DescriptionList.Item term={t("Last Sync")}>
          {storage.last_sync ? format(new Date(storage.last_sync), "MMMM dd, yyyy ∙ HH:mm:ss") : t("Not synced yet")}
        </DescriptionList.Item>
      </DescriptionList>
    </div>
  );
};

const SummaryS3 = ({ storage }) => {
  const { t } = useTranslation();
  return <DescriptionList.Item term={t("Bucket")}>{storage.bucket}</DescriptionList.Item>;
};

const GSCStorage = ({ storage }) => {
  const { t } = useTranslation();
  return <DescriptionList.Item term={t("Bucket")}>{storage.bucket}</DescriptionList.Item>;
};

const AzureStorage = ({ storage }) => {
  const { t } = useTranslation();
  return <DescriptionList.Item term={t("Container")}>{storage.container}</DescriptionList.Item>;
};

const RedisStorage = ({ storage }) => {
  const { t } = useTranslation();
  return (
    <>
      <DescriptionList.Item term={t("Path")}>{storage.path}</DescriptionList.Item>
      <DescriptionList.Item term={t("Host")}>
        {storage.host}
        {storage.port ? `:${storage.port}` : ""}
      </DescriptionList.Item>
    </>
  );
};

const LocalStorage = ({ storage }) => {
  const { t } = useTranslation();
  return <DescriptionList.Item term={t("Path")}>{storage.path}</DescriptionList.Item>;
};
