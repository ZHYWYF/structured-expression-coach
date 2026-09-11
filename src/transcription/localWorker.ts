import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

type WorkerRequest = { id: string; type: "load"; modelId: string } | { id: string; type: "transcribe"; modelId: string; audio: Float32Array };
type ProgressPayload = { status?: string; progress?: number; file?: string };

let loadedModel = "";
let transcriber: ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string; chunks?: Array<{ text?: string; timestamp?: [number, number] }> }>) | null = null;

async function ensureModel(id: string, modelId: string) {
  if (transcriber && loadedModel === modelId) return transcriber;
  self.postMessage({ id, type: "progress", progress: 0, message: "准备下载模型" });
  transcriber = await pipeline("automatic-speech-recognition", modelId, {
    device: "wasm",
    dtype: "q4",
    progress_callback: (event: ProgressPayload) => {
      const progress = typeof event.progress === "number" ? Math.max(0, Math.min(100, Math.round(event.progress))) : 0;
      self.postMessage({ id, type: "progress", progress, message: event.file ? `正在获取 ${event.file.split("/").at(-1)}` : "正在加载模型" });
    },
  }) as unknown as NonNullable<typeof transcriber>;
  loadedModel = modelId;
  return transcriber;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const runtime = await ensureModel(request.id, request.modelId);
    if (request.type === "load") {
      self.postMessage({ id: request.id, type: "loaded" });
      return;
    }
    self.postMessage({ id: request.id, type: "progress", progress: 5, message: "正在离线识别" });
    const result = await runtime(request.audio, {
      language: "zh",
      task: "transcribe",
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ id: request.id, type: "result", text: result.text?.trim() ?? "", chunks: "chunks" in result ? result.chunks : [] });
  } catch (error) {
    self.postMessage({ id: request.id, type: "error", message: error instanceof Error ? error.message : "本地转写失败" });
  }
};
