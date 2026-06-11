/** 与标注项目列表侧栏、创建项目第一步共用 */
export const PROJECT_TYPE_FILTERS = [
  { key: "image", labelKey: "Image" },
  { key: "video", labelKey: "Video" },
  { key: "text", labelKey: "Text" },
  { key: "audio", labelKey: "Audio" },
  { key: "general", labelKey: "General" },
];

/** 与 annotation_templates/groups.txt 一致；侧栏不展示「社区贡献」 */
export const DEFAULT_TEMPLATE_GROUPS = [
  "Computer Vision",
  "Natural Language Processing",
  "Audio/Speech Processing",
  "Conversational AI",
  "Chat",
  "Ranking & Scoring",
  "Structured Data Parsing",
  "Time Series Analysis",
  "Videos",
  "Generative AI",
];

export function filterSidebarTemplateGroups(groups) {
  return groups.filter((g) => String(g).trim().toLowerCase() !== "community contributions");
}

/** 列表筛选用：优先已保存的 data_type_category，旧项目回退到 id 伪随机 */
export function resolveProjectDataTypeKey(project) {
  const saved = String(project?.data_type_category ?? "").trim();

  if (saved && PROJECT_TYPE_FILTERS.some(({ key }) => key === saved)) {
    return saved;
  }

  const keys = PROJECT_TYPE_FILTERS.map(({ key }) => key);
  return keys[Math.abs(Number(project?.id)) % keys.length];
}
