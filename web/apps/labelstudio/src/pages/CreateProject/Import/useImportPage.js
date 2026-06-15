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
  const [pendingLocalFiles, setPendingLocalFiles] = React.useState([]);
  const [parentDatasetSelection, setParentDatasetSelection] = React.useState(null);
  const [_columns, _setColumns] = React.useState([]);
  const addColumns = (cols) => _setColumns((current) => unique(current.concat(cols)));
  const [csvHandling, setCsvHandling] = React.useState();
  const uploadDisabled = csvHandling === "choose";
  const hasImportData =
    (fileIds && fileIds.length > 0) ||
    pendingLocalFiles.length > 0 ||
    parentDatasetSelection != null ||
    sample != null;
  const api = useAPI();

  const queueLocalFiles = React.useCallback((files) => {
    setPendingLocalFiles((prev) => unique([...prev, ...files], (a, b) => a.name === b.name && a.size === b.size));
  }, []);

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

  const columns = ["choose", "ts"].includes(csvHandling) ? [DEFAULT_COLUMN] : _columns;

  const uploadPendingLocalFiles = useCallback(
    async (targetProject) => {
      if (!pendingLocalFiles.length || !targetProject?.id) return fileIds;

      return new Promise((resolve, reject) => {
        const fd = new FormData();
        for (const file of pendingLocalFiles) {
          fd.append(file.name, file);
        }

        importFiles({
          files: pendingLocalFiles,
          body: fd,
          project: targetProject,
          dontCommitToProject: true,
          onFinish: (res) => {
            const ids = res?.file_upload_ids ?? [];
            setFileIds(ids);
            setPendingLocalFiles([]);
            resolve(ids);
          },
          onError: (err) => reject(err),
        });
      });
    },
    [fileIds, pendingLocalFiles],
  );

  const finishUpload = async (targetProject = project) => {
    if (!targetProject?.id) return false;

    setUploadingStatus(true);
    const onlyParentDataset =
      parentDatasetSelection &&
      (!fileIds || fileIds.length === 0) &&
      pendingLocalFiles.length === 0 &&
      csvHandling !== "choose";

    try {
      let uploadIds = fileIds;

      if (pendingLocalFiles.length) {
        uploadIds = await uploadPendingLocalFiles(targetProject);
      }

      if (onlyParentDataset) {
        const startRes = await api.callApi("syncParentDataset", {
          params: { pk: targetProject.id },
          body: {},
          errorFilter: () => true,
        });
        if (startRes?.error || startRes === null) {
          setUploadingStatus(false);
          return false;
        }
        setUploadingStatus(false);
        return true;
      }

      if (!uploadIds?.length) {
        setUploadingStatus(false);
        return true;
      }

      const imported = await api.callApi("reimportFiles", {
        params: {
          pk: targetProject.id,
        },
        body: {
          file_upload_ids: uploadIds,
          files_as_tasks_list: csvHandling === "tasks",
        },
      });

      setUploadingStatus(false);
      return imported;
    } catch {
      setUploadingStatus(false);
      return false;
    }
  };

  const uploadSample = useCallback(
    async (sample, onStart, onFinish) => {
      if (!project?.id) return;
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
    highlightCsvHandling: uploadDisabled,
    addColumns,
    csvHandling,
    setCsvHandling,
    onFileListUpdate: setFileIds,
    dontCommitToProject: true,
    parentDatasetSelection,
    onParentDatasetSelect,
    onParentDatasetClear,
    pendingLocalFiles,
    onQueueLocalFiles: queueLocalFiles,
  };

  return {
    columns,
    uploading,
    uploadDisabled,
    hasImportData,
    finishUpload,
    fileIds,
    parentDatasetSelection,
    pageProps,
    uploadSample,
  };
};
