export const localModelCatalog = [
  { id: "onnx-community/whisper-large-v3-turbo", label: "Whisper Large V3 Turbo 高精度", sizeBytes: 850_000_000, recommendation: "适合重要面试和历史录音，下载约 0.8 GB" },
  { id: "Xenova/whisper-small", label: "Whisper Small 平衡版", sizeBytes: 310_000_000, recommendation: "占用较低，下载约 0.3 GB，适合较短录音和普通设备" },
] as const;

interface WorkerResponse { id: string; type: "progress" | "loaded" | "result" | "error"; progress?: number; message?: string; text?: string; chunks?: Array<{ text?: string; timestamp?: [number, number] }> }
interface PendingRequest { resolve: (value: { text: string; chunks: WorkerResponse["chunks"] }) => void; reject: (reason?: unknown) => void; onProgress?: (progress: number, message: string) => void; timer?: ReturnType<typeof setTimeout> }
const INACTIVITY_TIMEOUT_MS = 10 * 60_000;

class Runtime {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  get isBusy() { return this.pending.size > 0; }
  private armTimeout(pending: PendingRequest) {
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => this.cancelAll("本地模型连续 10 分钟未返回处理信号，已停止本次任务。原始录音和已保存的逐字稿不会被删除；可重试或自行选择在线转写。"), INACTIVITY_TIMEOUT_MS);
  }
  private getWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("./localWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.armTimeout(pending);
      if (response.type === "progress") { pending.onProgress?.(response.progress ?? 0, response.message ?? "正在处理"); return; }
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.type === "error") pending.reject(new Error(response.message ?? "本地转写失败"));
      else pending.resolve({ text: response.text ?? "", chunks: response.chunks });
    };
    this.worker.onerror = (event) => this.cancelAll(event.message || "本地推理进程异常，原始录音已保留，请重试");
    this.worker.onmessageerror = () => this.cancelAll("本地推理结果传输失败，原始录音已保留，请重试");
    return this.worker;
  }
  private request(type: "load" | "transcribe", modelId: string, audio: Float32Array | undefined, onProgress?: PendingRequest["onProgress"]) {
    return new Promise<{ text: string; chunks: WorkerResponse["chunks"] }>((resolve, reject) => {
      if (this.pending.size) { reject(new Error("本地模型正在处理其他任务，请等待完成或先停止当前任务。")); return; }
      const id = crypto.randomUUID();
      const pending: PendingRequest = { resolve, reject, onProgress };
      this.pending.set(id, pending);
      this.armTimeout(pending);
      try {
        if (audio) this.getWorker().postMessage({ id, type, modelId, audio }, [audio.buffer]);
        else this.getWorker().postMessage({ id, type, modelId });
      } catch (error) { clearTimeout(pending.timer); this.pending.delete(id); reject(error); }
    });
  }
  install(modelId: string, onProgress?: PendingRequest["onProgress"]) { return this.request("load", modelId, undefined, onProgress); }
  transcribe(modelId: string, audio: Float32Array, onProgress?: PendingRequest["onProgress"]) { return this.request("transcribe", modelId, audio, onProgress); }
  cancelAll(message = "任务已暂停") {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
  }
}

export const localTranscriptionRuntime = new Runtime();

export async function deleteCachedModel(modelId: string): Promise<void> {
  if (!("caches" in window)) return;
  const names = await caches.keys();
  for (const name of names) {
    const cache = await caches.open(name);
    const requests = await cache.keys();
    await Promise.all(requests.filter((request) => decodeURIComponent(request.url).includes(modelId)).map((request) => cache.delete(request)));
  }
}

export async function decodeAudioTo16Khz(file: File): Promise<{ samples: Float32Array; durationSeconds: number }> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const frameCount = Math.ceil(decoded.duration * 16_000);
    const offline = new OfflineAudioContext(1, frameCount, 16_000);
    const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
    const target = mono.getChannelData(0);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const source = decoded.getChannelData(channel);
      for (let index = 0; index < source.length; index += 1) target[index] += source[index] / decoded.numberOfChannels;
    }
    const node = offline.createBufferSource(); node.buffer = mono; node.connect(offline.destination); node.start();
    const rendered = await offline.startRendering();
    return { samples: rendered.getChannelData(0).slice(), durationSeconds: decoded.duration };
  } finally { await context.close(); }
}
