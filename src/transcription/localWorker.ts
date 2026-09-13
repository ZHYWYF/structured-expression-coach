import { BaseStreamer, env, pipeline } from "@huggingface/transformers";
import { whisperChunkProgress } from "./chunkProgress";

env.useBrowserCache = true;
env.useCustomCache = true;
env.customCache = {
  async match(request: RequestInfo | URL) {
    const response = await (await caches.open("transformers-cache")).match(request);
    // Older attempts may have cached the app's HTML fallback under a model key.
    // Ignore that entry without deleting valid weights or other user data.
    return response?.headers.get("Content-Type")?.toLowerCase().includes("text/html") ? undefined : response;
  },
  async put(request: RequestInfo | URL, response: Response) {
    await (await caches.open("transformers-cache")).put(request, response);
  },
};
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = new URL("/runtime/", self.location.href).href;
  env.backends.onnx.wasm.numThreads = 1;
}

type WorkerRequest = { id: string; type: "load"; modelId: string } | { id: string; type: "transcribe"; modelId: string; audio: Float32Array };
type ProgressPayload = { status?: string; progress?: number; file?: string };

let loadedModel = "";
let transcriber: ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string; chunks?: Array<{ text?: string; timestamp?: [number, number] }> }>) | null = null;

async function ensureModel(id: string, modelId: string, cachedOnly = false) {
  if (transcriber && loadedModel === modelId) return transcriber;
  // Installation downloads from the model host, never the app's HTML route.
  // Offline requests retain the library's local-only guard and may read cached
  // remote-model responses, but cannot initiate a remote download.
  env.allowLocalModels = cachedOnly;
  env.allowRemoteModels = !cachedOnly;
  self.postMessage({ id, type: "progress", progress: 0, message: cachedOnly ? "正在从设备缓存加载高精度模型…" : "准备下载模型" });
  transcriber = await pipeline("automatic-speech-recognition", modelId, {
    device: "wasm",
    dtype: "q4",
    local_files_only: cachedOnly,
    progress_callback: (event: ProgressPayload) => {
      const progress = typeof event.progress === "number" ? Math.max(0, Math.min(100, Math.round(event.progress))) : 0;
      self.postMessage({ id, type: "progress", progress: cachedOnly ? 0 : progress, message: cachedOnly ? "正在从设备缓存加载模型并准备推理…" : event.file ? `正在获取 ${event.file.split("/").at(-1)}` : "正在加载模型" });
    },
  }) as unknown as NonNullable<typeof transcriber>;
  loadedModel = modelId;
  return transcriber;
}

let queue: Promise<void> = Promise.resolve();
async function handleRequest(request: WorkerRequest) {
  try {
    const runtime = await ensureModel(request.id, request.modelId, request.type === "transcribe");
    if (request.type === "load") {
      self.postMessage({ id: request.id, type: "loaded" });
      return;
    }
    if (!request.audio.length) { self.postMessage({ id: request.id, type: "result", text: "", chunks: [] }); return; }
    const sampleCount = request.audio.length;
    let completedChunks = 0;
    let tokens = 0;
    let lastNotification = 0;
    const reportProgress = (finished = false) => {
      const progress = whisperChunkProgress(sampleCount, completedChunks);
      self.postMessage({ id: request.id, type: "progress", progress: progress.progress,
        message: finished ? "分段识别完成，正在合并时间戳和逐字稿…" : `正在识别第 ${Math.min(completedChunks + 1, progress.totalChunks)}/${progress.totalChunks} 段 · 已处理 ${Math.floor(progress.processedSeconds)}/${Math.ceil(progress.durationSeconds)} 秒音频${tokens ? ` · 本段已生成 ${tokens} 个识别标记` : ""}` });
    };
    class ProgressStreamer extends BaseStreamer {
      put(value: bigint[][]) {
        tokens += value[0]?.length ?? 0;
        if (Date.now() - lastNotification < 750) return;
        lastNotification = Date.now();
        reportProgress();
      }
      end() {
        completedChunks += 1;
        tokens = 0;
        reportProgress(completedChunks >= whisperChunkProgress(sampleCount, completedChunks).totalChunks);
      }
    }
    self.postMessage({ id: request.id, type: "progress", progress: 0, message: `正在准备 ${whisperChunkProgress(request.audio.length, 0).totalChunks} 段音频特征；高精度模型首次推理可能较慢…` });
    const result = await runtime(request.audio, {
      language: "zh",
      task: "transcribe",
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      streamer: new ProgressStreamer(),
    });
    self.postMessage({ id: request.id, type: "result", text: result.text?.trim() ?? "", chunks: "chunks" in result ? result.chunks : [] });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "本地转写失败";
    const message = /JSON|Unexpected token|<!doctype|<html/i.test(detail)
      ? "无法读取有效的模型配置。请检查网络是否返回了网页，并在设置中删除失败模型后重新下载；原始录音不会删除。"
      : /Failed to fetch|NetworkError|network|fetch failed|Load failed/i.test(detail)
        ? request.type === "load" ? "模型下载连接失败。请检查网络或代理后重试，已有录音和会话不会删除。" : "本地模型缓存不完整或无法读取。请到设置中重新下载模型后再离线转写，原始录音已保留。"
        : detail;
    self.postMessage({ id: request.id, type: "error", message });
  }
}
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  queue = queue.catch(() => undefined).then(() => handleRequest(request));
};
