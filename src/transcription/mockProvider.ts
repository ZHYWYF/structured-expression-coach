import type {
  TranscriptSegment,
  TranscriptionProgress,
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResult,
} from "./types";

const DEMO_SEGMENTS: Omit<TranscriptSegment, "id">[] = [
  {
    startMs: 0,
    endMs: 5200,
    text: "这次项目的目标，是降低新用户完成首次任务的操作成本。",
    stable: true,
    speakerLabel: "我",
  },
  {
    startMs: 5200,
    endMs: 11800,
    text: "我先分析了转化漏斗，然后重新设计了入口和引导流程。",
    stable: true,
    speakerLabel: "我",
  },
  {
    startMs: 11800,
    endMs: 17600,
    text: "上线四周后，任务完成率提升了九个百分点。",
    stable: true,
    speakerLabel: "我",
  },
];

const wait = (milliseconds: number) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

export class MockLocalTranscriptionProvider implements TranscriptionProvider {
  readonly id = "mock-local" as const;
  readonly displayName = "本地高精度演示引擎";

  async transcribe(
    request: TranscriptionRequest,
    onProgress?: (progress: TranscriptionProgress) => void,
  ): Promise<TranscriptionResult> {
    const stages: TranscriptionProgress[] = [
      { stage: "preparing", progress: 0.12, message: "正在准备本地模型" },
      { stage: "running", progress: 0.48, message: "正在识别中文语音" },
      { stage: "finalizing", progress: 0.82, message: "正在校正标点和专有词" },
    ];

    for (const stage of stages) {
      onProgress?.(stage);
      await wait(180);
    }

    const segments = DEMO_SEGMENTS.map((segment, index) => ({
      ...segment,
      id: `demo-segment-${index + 1}`,
    }));

    onProgress?.({ stage: "completed", progress: 1, message: "本地转写完成" });

    return {
      revisionId: `demo-revision-${Date.now()}`,
      engine: this.id,
      model: request.mode === "batch" ? "high-accuracy-demo" : "balanced-demo",
      language: "zh-CN",
      segments,
      durationMs: request.durationMs,
      processingMs: 540,
    };
  }
}
