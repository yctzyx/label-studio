import { useQuery } from "@tanstack/react-query";

// Extend Window interface to include DataManager properties
declare global {
  interface Window {
    DM?: {
      store?: {
        apiCall: (method: string, params?: any) => Promise<any>;
      };
      apiCall?: (method: string, params?: any) => Promise<any>;
    };
  }
}

interface Action {
  id: string;
  title: string;
  order: number;
  hidden?: boolean;
  dialog?: {
    type?: string;
    text?: string;
    form?: any;
    title?: string;
  };
  children?: Action[];
  disabled?: boolean;
  disabledReason?: string;
  isSeparator?: boolean;
  isTitle?: boolean;
  callback?: (selection: any, action: Action) => void;
}

const ACTION_LOCALE_MAP: Record<
  string,
  {
    title?: string;
    dialogTitle?: string;
    dialogText?: string;
  }
> = {
  retrieve_tasks_predictions: {
    title: "获取预测结果",
    dialogTitle: "获取预测结果",
    dialogText: "将所选任务发送到当前项目连接的全部 ML 后端以生成预测。请确认是否继续。",
  },
  predictions_to_annotations: {
    title: "从预测创建标注",
    dialogTitle: "从预测创建标注",
    dialogText: "使用所选预测为每个任务创建标注，并将这些标注归属到当前账号。请确认是否继续。",
  },
  remove_duplicates: {
    title: "移除重复任务",
    dialogText:
      "确认移除数据字段完全重复的任务。重复任务会被删除，相关标注会迁移到保留任务。请确认是否继续。",
  },
  delete_tasks: {
    title: "删除任务",
    dialogText: "你将删除所选任务。此操作不可撤销，请确认是否继续。",
  },
  delete_tasks_annotations: {
    title: "删除标注",
    dialogText: "你将删除所选任务中的标注。可按标注人筛选删除范围，请确认是否继续。",
  },
  delete_tasks_predictions: {
    title: "删除预测",
    dialogText: "你将删除所选任务中的全部预测结果。请确认是否继续。",
  },
};

const localizeAction = (action: Action): Action => {
  const locale = ACTION_LOCALE_MAP[action.id];
  const children = action.children?.map(localizeAction);

  if (!locale) {
    return {
      ...action,
      ...(children ? { children } : {}),
    };
  }

  const dialog = action.dialog
    ? {
        ...action.dialog,
        ...(locale.dialogTitle ? { title: locale.dialogTitle } : {}),
        ...(locale.dialogText ? { text: locale.dialogText } : {}),
      }
    : action.dialog;

  return {
    ...action,
    ...(locale.title ? { title: locale.title } : {}),
    ...(dialog ? { dialog } : {}),
    ...(children ? { children } : {}),
  };
};

interface UseActionsOptions {
  projectId?: string;
  enabled?: boolean;
  staleTime?: number;
  cacheTime?: number;
}

/**
 * Hook to fetch available actions from the DataManager API
 * Uses TanStack Query for data fetching and caching
 *
 * @param options - Configuration options for the query
 * @returns Object containing actions data, loading state, error state, and refetch function
 */
export const useActions = (options: UseActionsOptions = {}) => {
  const {
    enabled = true,
    staleTime = 5 * 60 * 1000, // 5 minutes
    cacheTime = 10 * 60 * 1000, // 10 minutes
    projectId,
  } = options;

  const queryKey = ["actions", projectId];

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      // Use the correct DataManager API pattern - window.DM is the AppStore
      const store = window?.DM?.store || window?.DM;

      if (!store) {
        throw new Error("DataManager store not available");
      }

      const response = await store.apiCall?.("actions");

      if (!response) {
        throw new Error("No actions found in response or response is invalid");
      }

      return (response as Action[]).map(localizeAction);
    },
    enabled,
    staleTime,
    cacheTime,
  });

  const actions = data ?? [];

  return {
    actions,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  };
};
