import type { ModelProfile } from "./types";

export const modelProfiles: ModelProfile[] = [
  {
    id: "mac-high-accuracy",
    label: "Mac 高精度",
    engine: "whisper-cpp",
    accuracyTier: "high",
    installed: false,
    sizeLabel: "待基准测试后确定",
    recommendation: "历史录音和重要面试优先使用",
  },
  {
    id: "mac-balanced",
    label: "Mac 实时平衡",
    engine: "whisper-cpp",
    accuracyTier: "balanced",
    installed: false,
    sizeLabel: "待基准测试后确定",
    recommendation: "实时口述和短时练习",
  },
  {
    id: "android-recommended",
    label: "Android 推荐档",
    engine: "sherpa-onnx",
    accuracyTier: "high",
    installed: false,
    sizeLabel: "按设备能力推荐",
    recommendation: "在准确率、内存和温升之间动态选择",
  },
];
