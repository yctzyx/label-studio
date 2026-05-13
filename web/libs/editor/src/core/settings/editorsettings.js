export default {
  enableHotkeys: {
    newUI: {
      title: "标注快捷键",
      description: "启用快捷键以快速选择标签",
    },
    description: "启用标注快捷键",
    onChangeEvent: "toggleHotkeys",
    defaultValue: true,
  },
  enableTooltips: {
    newUI: {
      title: "工具提示中显示快捷键",
      description: "在工具和操作的提示中显示快捷键",
    },
    description: "显示快捷键提示",
    onChangeEvent: "toggleTooltips",
    checked: "",
    defaultValue: false,
  },
  enableLabelTooltips: {
    newUI: {
      title: "标签上显示快捷键",
      description: "在标签上显示对应的快捷键",
    },
    description: "在标签上显示快捷键提示",
    onChangeEvent: "toggleLabelTooltips",
    defaultValue: true,
  },
  showLabels: {
    newUI: {
      title: "显示选区标签",
      description: "在选区中显示标签名",
    },
    description: "在选区内显示标签",
    onChangeEvent: "toggleShowLabels",
    defaultValue: false,
  },
  continuousLabeling: {
    newUI: {
      title: "创建选区后保持标签选中",
      description: "保持当前标签选中以连续创建选区",
    },
    description: "创建选区后保持标签选中",
    onChangeEvent: "toggleContinuousLabeling",
    defaultValue: false,
  },
  selectAfterCreate: {
    newUI: {
      title: "创建后自动选中选区",
      description: "新建选区后自动选中它",
    },
    description: "创建后选中选区",
    onChangeEvent: "toggleSelectAfterCreate",
    defaultValue: false,
  },
  showLineNumbers: {
    newUI: {
      tags: "Text 标签",
      title: "显示行号",
      description: "便于在文档中定位特定行",
    },
    description: "为 Text 显示行号",
    onChangeEvent: "toggleShowLineNumbers",
    defaultValue: false,
  },
  preserveSelectedTool: {
    newUI: {
      tags: "Image 标签",
      title: "记住已选工具",
      description: "在任务之间记住已选中的工具",
    },
    description: "记住已选工具",
    onChangeEvent: "togglepreserveSelectedTool",
    defaultValue: true,
  },
  enableSmoothing: {
    newUI: {
      tags: "Image 标签",
      title: "缩放时启用像素平滑",
      description: "图像放大时对像素进行平滑处理",
    },
    description: "缩放时启用图像平滑",
    onChangeEvent: "toggleSmoothing",
    defaultValue: true,
  },
  invertedZoom: {
    newUI: {
      tags: "Image 标签",
      title: "反转缩放方向",
      description: "反转鼠标滚轮缩放的方向",
    },
    description: "启用反向缩放",
    onChangeEvent: "toggleInvertedZoom",
    defaultValue: false,
  },
};
