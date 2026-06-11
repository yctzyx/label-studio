// 若 hostname 已含 /api（如网关路径 https://gateway:9000/api/label-studio），则直接作为 API base，否则拼 /api
const apiGateway =
  window.APP_SETTINGS?.hostname && String(window.APP_SETTINGS.hostname).indexOf("/api") !== -1
    ? window.APP_SETTINGS.hostname.replace(/(\/)+$/, "")
    : `${window.APP_SETTINGS?.hostname ?? ""}/api`;

export const API_CONFIG = {
  gateway: apiGateway,
  endpoints: {
    // Users
    users: "/users",
    updateUser: "PATCH:/users/:pk",
    updateUserAvatar: "POST:/users/:pk/avatar",
    deleteUserAvatar: "DELETE:/users/:pk/avatar",
    me: "/current-user/whoami",
    hotkeys: "GET:/current-user/hotkeys/",
    updateHotkeys: "PATCH:/current-user/hotkeys/",

    // Organization
    organizationsList: "/organizations",
    memberships: "/organizations/:pk/memberships",
    userMemberships: "/organizations/:pk/memberships/:userPk",
    inviteLink: "/invite",
    resetInviteLink: "POST:/invite/reset-token",
    /** 父平台 pub_org/pub_user/pub_user_org → LS 组织与用户（仅 staff） */
    syncPubDirectory: "POST:/parent-integration/sync-pub-directory/",

    // Project
    projects: "/projects",
    project: "/projects/:pk",
    updateProject: "PATCH:/projects/:pk",
    /** 父平台数据集：按桶前缀列举 S3 对象并生成任务（异步，返回 job_id） */
    syncParentDataset: "POST:/projects/:pk/parent-dataset/sync",
    /** 父平台数据集同步进度 */
    syncParentDatasetStatus: "GET:/projects/:pk/parent-dataset/sync",
    createProject: "POST:/projects",
    deleteProject: "DELETE:/projects/:pk",
    projectResetCache: "POST:/projects/:pk/summary/reset",
    /** 项目人员与流程：团队分配 */
    projectWorkflowTeam: "/projects/:pk/workflow/team",
    createProjectWorkflowTeam: "POST:/projects/:pk/workflow/team",
    deleteProjectWorkflowTeam: "DELETE:/projects/:pk/workflow/team/:allocation_id",
    projectWorkflowDistribute: "POST:/projects/:pk/workflow/distribute",
    /** 当前用户在项目内的 workflow 任务（annotate / review / accept） */
    projectWorkflowMyTasks: "/projects/:pk/workflow/my-tasks",

    // Presigning
    presignUrlForTask: "/../tasks/:taskID/presign",
    presignUrlForProject: "/../projects/:projectId/presign",

    // Config and Import
    configTemplates: "/templates",
    validateConfig: "POST:/projects/:pk/validate",
    createSampleTask: "POST:/projects/:pk/sample-task",
    fileUploads: "/projects/:pk/file-uploads",
    deleteFileUploads: "DELETE:/projects/:pk/file-uploads",
    importFiles: "POST:/projects/:pk/import",
    reimportFiles: "POST:/projects/:pk/reimport",
    dataSummary: "/projects/:pk/summary",

    // DM
    deleteTabs: "DELETE:/dm/views/reset",

    // Storages
    listStorages: "/storages/:target?",
    storageTypes: "/storages/:target?/types",
    storageForms: "/storages/:target?/:type/form",
    createStorage: "POST:/storages/:target?/:type",
    deleteStorage: "DELETE:/storages/:target?/:type/:pk",
    updateStorage: "PATCH:/storages/:target?/:type/:pk",
    syncStorage: "POST:/storages/:target?/:type/:pk/sync",
    validateStorage: "POST:/storages/:target?/:type/validate",
    storageFiles: "POST:/storages/:target?/:type/files",

    // ML
    mlBackends: "GET:/ml",
    mlBackend: "GET:/ml/:pk",
    addMLBackend: "POST:/ml",
    updateMLBackend: "PATCH:/ml/:pk",
    deleteMLBackend: "DELETE:/ml/:pk",
    trainMLBackend: "POST:/ml/:pk/train",
    predictWithML: "POST:/ml/:pk/predict/test",
    projectModelVersions: "/projects/:pk/model-versions",
    deletePredictions: "DELETE:/projects/:pk/model-versions",
    modelVersions: "/ml/:pk/versions",
    mlInteractive: "POST:/ml/:pk/interactive-annotating",

    // Export
    export: "/projects/:pk/export",
    previousExports: "/projects/:pk/export/files",
    exportFormats: "/projects/:pk/export/formats",

    // Version
    version: "/version",

    // Webhook
    webhooks: "/webhooks",
    webhook: "/webhooks/:pk",
    updateWebhook: "PATCH:/webhooks/:pk",
    createWebhook: "POST:/webhooks",
    deleteWebhook: "DELETE:/webhooks/:pk",
    webhooksInfo: "/webhooks/info",

    // Product tours
    getProductTour: "GET:/current-user/product-tour",
    updateProductTour: "PATCH:/current-user/product-tour",

    // Tokens
    accessTokenList: "GET:/token",
    accessTokenGetRefreshToken: "POST:/token",
    accessTokenRevoke: "POST:/token/blacklist",

    accessTokenSettings: "GET:/jwt/settings",
    accessTokenUpdateSettings: "POST:/jwt/settings",

    // FSM
    fsmStateHistory: "GET:/fsm/entities/:entityType/:entityId/history",
  },
  alwaysExpectJSON: false,
};
