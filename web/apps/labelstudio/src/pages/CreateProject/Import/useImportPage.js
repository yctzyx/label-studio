import React, { useCallback } from "react";
import { useAPI } from "../../../providers/ApiProvider";
import { unique } from "../../../utils/helpers";
import { importFiles } from "./utils";

const DEFAULT_COLUMN = "$undefined$";

function mapParentSelectionToPayload(selection) {
  return {
    dataset_id: selection.datasetId,
    dataset_name: selection.datasetName,
    source_id: selection.sourceId,
    source_name: selection.sourceName,
    path: selection.path,
    data_set_type: selection.dataSetType,
    data_set_type_label: selection.dataSetTypeLabel,
  };
}

export const useImportPage = (project, sample) => {
  const [uploading, setUploadingStatus] = React.useState(false);
  const [fileIds, setFileIds] = React.useState([]);
  const [parentDatasetSelection, setParentDatasetSelection] = React.useState(null);
  const [_columns, _setColumns] = React.useState([]);
  const addColumns = (cols) => _setColumns((current) => unique(current.concat(cols)));
  // undefined - no csv added, all good, keep moving
  // choose - csv added, block modal until user chooses a way to hangle csv
  // tasks | ts — choice made, all good, this cannot be undone
  const [csvHandling, setCsvHandling] = React.useState(); // undefined | choose | tasks | ts
  const uploadDisabled = csvHandling === "choose";
  const hasImportData =
    (fileIds && fileIds.length > 0) || parentDatasetSelection != null || sample != null;
  const api = useAPI();

  const onParentDatasetSelect = React.useCallback(
    async (selection) => {
      setParentDatasetSelection(selection);
      if (!project?.id) return;
      await api.callApi("updateProject", {
        params: { pk: project.id },
        body: { parent_platform_dataset: mapParentSelectionToPayload(selection) },
      });
    },
    [api, project?.id],
  );

  const onParentDatasetClear = React.useCallback(async () => {
    setParentDatasetSelection(null);
    if (!project?.id) return;
    await api.callApi("updateProject", {
      params: { pk: project.id },
      body: { parent_platform_dataset: null },
    });
  }, [api, project?.id]);

  // don't use columns from csv if we'll not use it as csv
  const columns = ["choose", "ts"].includes(csvHandling) ? [DEFAULT_COLUMN] : _columns;

  const finishUpload = async () => {
    setUploadingStatus(true);
    const onlyParentDataset =
      parentDatasetSelection &&
      (!fileIds || fileIds.length === 0) &&
      csvHandling !== "choose";

    if (onlyParentDataset) {
      // 后端绑定父平台数据集与 LS 任务源时再调用专用接口；此处仅完成创建项目流
      setUploadingStatus(false);
      return true;
    }

    const imported = await api.callApi("reimportFiles", {
      params: {
        pk: project.id,
      },
      body: {
        file_upload_ids: fileIds,
        files_as_tasks_list: csvHandling === "tasks",
      },
    });

    setUploadingStatus(false);
    return imported;
  };

  const uploadSample = useCallback(
    async (sample, onStart, onFinish) => {
      onStart?.();
      const url = sample.url;
      const body = new URLSearchParams({ url });
      await importFiles({
        files: [{ name: url }],
        body,
        project,
      });
      onFinish?.();
    },
    [project],
  );

  const pageProps = {
    onWaiting: setUploadingStatus,
    // onDisableSubmit: onDisableSubmit,
    highlightCsvHandling: uploadDisabled,
    addColumns,
    csvHandling,
    setCsvHandling,
    onFileListUpdate: setFileIds,
    dontCommitToProject: true,
    parentDatasetSelection,
    onParentDatasetSelect,
    onParentDatasetClear,
  };

  return {
    columns,
    uploading,
    uploadDisabled,
    hasImportData,
    finishUpload,
    fileIds,
    pageProps,
    uploadSample,
  };
};
