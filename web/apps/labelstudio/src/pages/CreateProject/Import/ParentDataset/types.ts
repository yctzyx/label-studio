/** 用户确认的父平台数据集，供后续与 LS 项目绑定或同步任务使用 */
export type ParentDatasetSelection = {
  datasetId: number;
  datasetName: string;
  sourceId: number;
  sourceName?: string;
  path: string;
  dataSetType?: string;
  dataSetTypeLabel?: string;
};

export type ParentDatasourceRow = {
  id: number;
  name: string;
  databaseType?: number;
};

export type ParentDatasetRow = {
  id: number;
  dataSetName: string;
  sourceId: number;
  /** 后端关联 data_database.name */
  sourceName?: string;
  path: string;
  dataSetType?: string;
  /** 后端根据类型码转换的中文，如 图像 / 文档 */
  dataSetTypeLabel?: string;
};
