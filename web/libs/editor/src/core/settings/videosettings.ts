import type { SettingsProperties } from "./types";

export default {
  videoDrawOutside: {
    description: "允许在视频区域外绘制",
    defaultValue: false,
    type: "boolean",
  },
  videoHopSize: {
    description: "视频跳跃帧数",
    defaultValue: 10,
    type: "number",
  },
} as SettingsProperties;
