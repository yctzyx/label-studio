/**
 * 国际化配置 - 汉化 Label Studio
 * 专业术语保持统一：标注(Annotation)、标签(Label)、任务(Task)、项目(Project)、预测(Prediction) 等
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import zhCN from "./locales/zh-CN.json";

const resources = {
  "zh-CN": { translation: zhCN },
  zh: { translation: zhCN }, // zh 与 zh-CN 使用相同翻译
  en: { translation: {} }, // 英文使用 key 作为显示文本
};

const syncDocumentLang = (lng: string | null | undefined) => {
  if (typeof document !== "undefined" && lng) {
    document.documentElement.lang = lng;
  }
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: ["zh-CN", "zh", "en"],
    interpolation: {
      escapeValue: false, // React 已处理 XSS
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "label-studio-locale",
    },
    // 中文浏览器默认使用中文
    load: "currentOnly",
  })
  .then(() => {
    syncDocumentLang(i18n.language);
    i18n.on("languageChanged", syncDocumentLang);
  });

export default i18n;
