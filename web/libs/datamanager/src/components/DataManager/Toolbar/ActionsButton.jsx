import { IconChevronDown, IconChevronRight, IconTrash } from "@humansignal/icons";
import { Button, Spinner, EnterpriseBadge } from "@humansignal/ui";
import { inject, observer } from "mobx-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActions } from "../../../hooks/useActions";
import { cn } from "../../../utils/bem";
import { FF_LOPS_E_3, isFF } from "../../../utils/feature-flags";
import { Dropdown } from "@humansignal/ui";
import Form from "../../Common/Form/Form";
import { Menu } from "../../Common/Menu/Menu";
import { Modal } from "../../Common/Modal/ModalPopup";
import "./ActionsButton.scss";

const isFFLOPSE3 = isFF(FF_LOPS_E_3);
const injector = inject(({ store }) => ({
  store,
  hasSelected: store.currentView?.selected?.hasSelected ?? false,
}));

const DialogContent = ({ text, form, formRef, store, action }) => {
  const [formData, setFormData] = useState(form);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!formData) {
      setIsLoading(true);
      store
        .fetchActionForm(action.id)
        .then((form) => {
          setFormData(form);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [formData, store, action.id]);

  const fields = formData?.toJSON ? formData.toJSON() : formData;

  return (
    <div className={cn("dialog-content").toClassName()}>
      <div className={cn("dialog-content").elem("text").toClassName()}>{text}</div>
      {isLoading && (
        <div
          className={cn("dialog-content").elem("loading").toClassName()}
          style={{ display: "flex", justifyContent: "center", marginTop: 16 }}
        >
          <Spinner />
        </div>
      )}
      {formData && (
        <div className={cn("dialog-content").elem("form").toClassName()} style={{ paddingTop: 16 }}>
          <Form.Builder ref={formRef} fields={fields} autosubmit={false} withActions={false} />
        </div>
      )}
    </div>
  );
};

const predictionProgressListeners = new Set();
let predictionProgressState = {
  status: "idle",
  selectedCount: 0,
  detail: "",
  error: "",
};
let predictionProgressModal = null;

const setPredictionProgressState = (patch) => {
  predictionProgressState = { ...predictionProgressState, ...patch };
  predictionProgressListeners.forEach((listener) => listener(predictionProgressState));
};

const subscribePredictionProgress = (listener) => {
  predictionProgressListeners.add(listener);
  listener(predictionProgressState);
  return () => predictionProgressListeners.delete(listener);
};

const PredictionProgressBody = ({ status = "running", selectedCount, detail, error }) => {
  const isRunning = status === "running";
  const isFailed = status === "failed";
  const isIdle = status === "idle";

  return (
    <div className={cn("prediction-progress").toClassName()}>
      <div className={cn("prediction-progress").elem("status").toClassName()}>
        {isRunning && <Spinner />}
        <div>
          <div className={cn("prediction-progress").elem("title").toClassName()}>
            {isIdle
              ? "暂无预标注任务"
              : isRunning
                ? "正在获取预测结果"
                : isFailed
                  ? "获取预测结果失败"
                  : "获取预测结果完成"}
          </div>
          <div className={cn("prediction-progress").elem("description").toClassName()}>
            {isIdle
              ? "当前没有正在运行或最近完成的预标注任务。"
              : isRunning
                ? `已提交 ${selectedCount || 0} 条任务到 ML 后端，请等待模型返回。`
                : isFailed
                  ? error || "请求失败，请查看后端日志。"
                  : detail || "预测结果已写入所选任务。"}
          </div>
        </div>
      </div>
      {isRunning && <div className={cn("prediction-progress").elem("bar").toClassName()} />}
    </div>
  );
};

const getPredictionProgressFooter = (status) => {
  if (status === "running") {
    return (
      <div className="flex justify-end">
        <Button
          variant="neutral"
          look="outlined"
          onClick={() => predictionProgressModal?.close()}
          aria-label="后台运行预标注任务"
          data-testid="prediction-progress-background"
        >
          后台运行
        </Button>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <Button
        variant="primary"
        onClick={() => predictionProgressModal?.close()}
        aria-label="关闭预标注进度弹窗"
        data-testid="prediction-progress-close"
      >
        {status === "failed" ? "关闭" : "完成"}
      </Button>
    </div>
  );
};

const openPredictionProgressModal = () => {
  const state = predictionProgressState;
  predictionProgressModal = Modal.modal({
    unique: "retrieve-tasks-predictions-progress",
    title: "预标注进度",
    body: <PredictionProgressBody {...state} />,
    allowClose: true,
    closeOnClickOutside: false,
    footer: getPredictionProgressFooter(state.status),
    onHidden: () => {
      predictionProgressModal = null;
    },
  });
  return predictionProgressModal;
};

const updatePredictionProgressModal = () => {
  if (!predictionProgressModal?.visible) return;
  const state = predictionProgressState;
  predictionProgressModal.update({
    title: "预标注进度",
    body: <PredictionProgressBody {...state} />,
    allowClose: true,
    closeOnClickOutside: false,
    footer: getPredictionProgressFooter(state.status),
  });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pollPredictionRetrievalJob = async (store, jobId, selectedCount) => {
  const projectId = store.project?.id;
  if (!projectId || !jobId) {
    throw new Error("缺少预标注任务 ID");
  }

  while (true) {
    await sleep(2000);
    const raw = await store.apiCall(
      "predictionRetrievalStatus",
      { project: projectId, job_id: jobId },
      null,
      {
        errorHandler: () => true,
      },
    );
    const payload = raw?.response ?? raw;
    if (raw?.error || payload?.detail) {
      const httpStatus = raw?.status ?? payload?.status;
      if (httpStatus >= 400 || raw?.error) {
        setPredictionProgressState({
          status: "failed",
          selectedCount,
          detail: "",
          error: payload?.detail || raw?.error || "查询预标注进度失败。",
        });
        updatePredictionProgressModal();
        return;
      }
    }
    const status = payload?.status;
    const total = payload?.total ?? selectedCount;
    const completed = payload?.completed ?? 0;

    if (status === "queued" || status === "running") {
      setPredictionProgressState({
        status: "running",
        selectedCount,
        detail: payload?.detail || `已完成 ${completed}/${total} 条任务`,
        error: "",
      });
      updatePredictionProgressModal();
      continue;
    }

    if (status === "completed") {
      const created = payload?.predictions_created ?? 0;
      if (created === 0) {
        setPredictionProgressState({
          status: "failed",
          selectedCount,
          detail: "",
          error: payload?.detail || "未生成任何预测结果。",
        });
      } else {
        setPredictionProgressState({
          status: "done",
          selectedCount,
          detail: payload?.detail || `已成功为 ${created} 条任务获取预测结果。`,
          error: "",
        });
        await store.currentView?.reload();
        await store.fetchProject();
        store.currentView?.clearSelection();
      }
      updatePredictionProgressModal();
      return;
    }

    if (status === "failed") {
      setPredictionProgressState({
        status: "failed",
        selectedCount,
        detail: "",
        error: payload?.error || payload?.detail || "获取预测结果失败。",
      });
      updatePredictionProgressModal();
      return;
    }
  }
};

const resolvePredictionActionError = (result) => {
  if (!result) return "请求失败，请查看后端日志。";
  const payload = result?.response ?? result;
  const httpStatus = result?.status ?? payload?.status;
  const responseCode = payload?.response_code;
  const detail = payload?.detail;

  if (result?.error) {
    return detail || result.error || "请求失败，请查看后端日志。";
  }
  if ((httpStatus && httpStatus >= 400) || (responseCode && responseCode >= 400)) {
    return detail || "获取预测结果失败。";
  }
  if (payload?.predictions_created === 0) {
    return detail || "未生成任何预测结果。";
  }
  return null;
};

const showPredictionProgress = ({ action, store, body }) => {
  const selectedCount = store.currentView?.selectedCount ?? 0;

  setPredictionProgressState({
    status: "running",
    selectedCount,
    detail: "",
    error: "",
  });
  openPredictionProgressModal();

  Promise.resolve(store.invokeAction(action.id, { body, reload: false }))
    .then(async (result) => {
      const payload = result?.response ?? result;
      const jobId = payload?.job_id ?? result?.job_id;
      if (payload?.async && jobId) {
        await pollPredictionRetrievalJob(store, jobId, selectedCount);
        return;
      }

      const errorMessage = resolvePredictionActionError(result);
      if (errorMessage) {
        setPredictionProgressState({
          status: "failed",
          selectedCount,
          detail: "",
          error: errorMessage,
        });
        updatePredictionProgressModal();
        return;
      }

      setPredictionProgressState({
        status: "done",
        selectedCount,
        detail: payload?.detail || `已处理 ${payload?.processed_items ?? selectedCount} 条任务。`,
        error: "",
      });
      updatePredictionProgressModal();
      await store.currentView?.reload();
      await store.fetchProject();
      store.currentView?.clearSelection();
    })
    .catch((error) => {
      setPredictionProgressState({
        status: "failed",
        selectedCount,
        detail: "",
        error: error?.message || "请求失败，请查看后端日志。",
      });
      updatePredictionProgressModal();
    });
};

export const PredictionProgressButton = ({ size }) => {
  const [progress, setProgress] = useState(predictionProgressState);
  const isRunning = progress.status === "running";

  useEffect(() => subscribePredictionProgress(setProgress), []);

  return (
    <Button
      size={size}
      variant={isRunning ? "primary" : "neutral"}
      look={isRunning ? undefined : "outlined"}
      onClick={openPredictionProgressModal}
      aria-label="查看预标注进度"
      data-testid="prediction-progress-button"
    >
      {isRunning ? `预标注中 ${progress.selectedCount || 0}` : "预标注进度"}
    </Button>
  );
};

const ActionButton = ({ action, parentRef, store, formRef }) => {
  const isDeleteAction = action.id.includes("delete");
  const hasChildren = !!action.children?.length;
  const submenuRef = useRef();

  const onClick = useCallback(
    (e) => {
      e.preventDefault();
      if (action.disabled) return;
      action?.callback
        ? action?.callback(store.currentView?.selected?.snapshot, action)
        : invokeAction(action, isDeleteAction, store, formRef);
      parentRef?.current?.close?.();
    },
    [store.currentView?.selected, action, isDeleteAction, parentRef, store, formRef],
  );

  const titleContainer = (
    <Menu.Item
      key={action.id}
      className={cn("actionButton")
        .mod({
          hasSeperator: isDeleteAction,
          hasSubMenu: action.children?.length > 0,
          isSeparator: action.isSeparator,
          isTitle: action.isTitle,
          danger: isDeleteAction,
          disabled: action.disabled,
        })
        .toClassName()}
      size="small"
      onClick={onClick}
      aria-label={action.title}
    >
      <div
        className={cn("actionButton").elem("titleContainer").toClassName()}
        {...(action.disabled ? { title: action.disabledReason } : {})}
      >
        <div className={cn("actionButton").elem("title").toClassName()}>
          {action.title}
          {action.enterprise_badge && <EnterpriseBadge className="ml-1" ghost />}
        </div>
        {hasChildren ? <IconChevronRight className={cn("actionButton").elem("icon").toClassName()} /> : null}
      </div>
    </Menu.Item>
  );

  if (hasChildren) {
    return (
      <Dropdown.Trigger
        key={action.id}
        align="top-right-outside"
        toggle={false}
        ref={submenuRef}
        content={
          <ul className={cn("actionButton-submenu").toClassName()}>
            {action.children.map((childAction) => (
              <ActionButton
                key={childAction.id}
                action={childAction}
                parentRef={parentRef}
                store={store}
                formRef={formRef}
              />
            ))}
          </ul>
        }
      >
        {titleContainer}
      </Dropdown.Trigger>
    );
  }

  return (
    <Menu.Item
      size="small"
      key={action.id}
      variant={isDeleteAction ? "negative" : undefined}
      onClick={onClick}
      className={`actionButton${action.isSeparator ? "_isSeparator" : action.isTitle ? "_isTitle" : ""} ${
        action.disabled ? "actionButton_disabled" : ""
      }`}
      icon={isDeleteAction && <IconTrash />}
      title={action.disabled ? action.disabledReason : null}
      aria-label={action.title}
      disabled={action.disabled}
      tooltip={action.disabled_reason}
      tooltipAlignment="bottom-center"
    >
      <span className="flex items-center justify-between gap-base w-full">
        {action.title}
        {action.enterprise_badge && <EnterpriseBadge ghost />}
      </span>
    </Menu.Item>
  );
};

const invokeAction = (action, destructive, store, formRef) => {
  const isPredictionRetrieval = action.id === "retrieve_tasks_predictions";

  if (action.dialog) {
    const { type: dialogType, text, form, title } = action.dialog;
    const dialog = Modal[dialogType] ?? Modal.confirm;

    // Generate dynamic content for destructive actions
    let dialogTitle = title;
    let dialogText = text;
    let okButtonText = "确定";

    if (destructive && !title) {
      const objectMap = {
        delete_tasks: "任务",
        delete_annotations: "标注",
        delete_predictions: "预测",
        delete_reviews: "审核记录",
        delete_reviewers: "审核分配",
        delete_annotators: "标注分配",
        delete_ground_truths: "标准答案",
      };

      const objectType = objectMap[action.id] || action.title;
      dialogTitle = `确定删除所选${objectType}？`;
      okButtonText = `删除${objectType}`;
    }

    if (destructive && !form) {
      dialogText = `你正在删除所选项。\n\n此操作不可撤销。`;
    }

    dialog({
      title: dialogTitle ? dialogTitle : destructive ? "危险操作" : "确认操作",
      body: <DialogContent text={dialogText} form={form} formRef={formRef} store={store} action={action} />,
      buttonLook: destructive ? "negative" : "primary",
      okText: destructive ? okButtonText : undefined,
      onOk() {
        const body = formRef.current?.assembleFormData({ asJSON: true });

        store.SDK.invoke("actionDialogOk", action.id, { body });
        if (isPredictionRetrieval) {
          showPredictionProgress({ action, store, body });
        } else {
          store.invokeAction(action.id, { body });
        }
      },
      closeOnClickOutside: false,
    });
  } else {
    if (isPredictionRetrieval) {
      showPredictionProgress({ action, store });
    } else {
      store.invokeAction(action.id);
    }
  }
};

export const ActionsButton = injector(
  observer(({ store, size, hasSelected, ...rest }) => {
    const formRef = useRef();
    const selectedCount = store.currentView.selectedCount;
    const [isOpen, setIsOpen] = useState(false);

    // Use TanStack Query hook for fetching actions
    const {
      actions: serverActions,
      isLoading,
      isFetching,
    } = useActions({
      enabled: isOpen,
      projectId: store.SDK.projectId,
    });

    const actions = useMemo(() => {
      return [...store.availableActions, ...serverActions].filter((a) => !a.hidden).sort((a, b) => a.order - b.order);
    }, [store.availableActions, serverActions]);
    const actionButtons = actions.map((action) => (
      <ActionButton key={action.id} action={action} parentRef={formRef} store={store} formRef={formRef} />
    ));
    const recordTypeLabel = isFFLOPSE3 && store.SDK.type === "DE" ? "条记录" : "条任务";

    return (
      <Dropdown.Trigger
        content={
          <Menu size="compact">
            {isLoading || isFetching ? (
              <Menu.Item data-testid="loading-actions" disabled>
                加载操作中...
              </Menu.Item>
            ) : (
              actionButtons
            )}
          </Menu>
        }
        openUpwardForShortViewport={false}
        disabled={!hasSelected}
        onToggle={setIsOpen}
      >
        <Button
          size={size}
          variant="neutral"
          look="outlined"
          disabled={!hasSelected}
          trailing={<IconChevronDown />}
          aria-label="任务操作"
          {...rest}
        >
          {selectedCount > 0 ? `${selectedCount} ${recordTypeLabel}` : "操作"}
        </Button>
      </Dropdown.Trigger>
    );
  }),
);
