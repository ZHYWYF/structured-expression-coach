import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const localModelCatalog = [
  { id: "onnx-community/whisper-large-v3-turbo", label: "Whisper Large V3 Turbo 高精度", sizeBytes: isTauri() ? 574_041_195 : 850_000_000, recommendation: isTauri() ? "Mac 使用原生 Metal 加速，适合重要面试和长录音，下载约 0.6 GB" : "适合重要面试和历史录音，下载约 0.8 GB" },
  { id: "Xenova/whisper-small", label: "Whisper Small 平衡版", sizeBytes: isTauri() ? 190_085_487 : 310_000_000, recommendation: isTauri() ? "Mac 使用原生 Metal 加速，占用约 0.2 GB，适合普通设备" : "占用较低，下载约 0.3 GB，适合较短录音和普通设备" },
] as const;

interface WorkerResponse { id: string; type: "progress" | "loaded" | "result" | "error"; progress?: number; message?: string; text?: string; chunks?: Array<{ text?: string; timestamp?: [number, number] }> }
interface PendingRequest { resolve: (value: { text: string; chunks: WorkerResponse["chunks"] }) => void; reject: (reason?: unknown) => void; onProgress?: (progress: number, message: string) => void; timer?: ReturnType<typeof setTimeout> }
interface NativeProgressEvent { taskId: string; progress: number; message: string }
interface NativeCapabilities { available: boolean; backend: string }
const INACTIVITY_TIMEOUT_MS = 10 * 60_000;

class Runtime {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private nativeTaskId: string | null = null;
  private nativeCapability: Promise<boolean> | null = null;
  get isBusy() { return this.pending.size > 0; }
  private useNativeRuntime() {
    if (!isTauri()) return Promise.resolve(false);
    this.nativeCapability ??= invoke<NativeCapabilities>("native_asr_capabilities")
      .then((result) => result.available)
      .catch(() => false);
    return this.nativeCapability;
  }
  private async nativeRequest(type: "install" | "transcribe", modelId: string, audio: Float32Array | undefined, onProgress?: PendingRequest["onProgress"]) {
    if (this.pending.size) throw new Error("本地模型正在处理其他任务，请等待完成或先停止当前任务。");
    const id = crypto.randomUUID();
    let unlisten: UnlistenFn | undefined;
    const result = new Promise<{ text: string; chunks: WorkerResponse["chunks"] }>(async (resolve, reject) => {
      const pending: PendingRequest = { resolve, reject, onProgress };
      this.pending.set(id, pending);
      this.nativeTaskId = id;
      this.armTimeout(pending);
      try {
        unlisten = await listen<NativeProgressEvent>("native-asr-progress", (event) => {
          if (event.payload.taskId !== id) return;
          this.armTimeout(pending);
          onProgress?.(event.payload.progress, event.payload.message);
        });
        const nativeResult = type === "install"
          ? await invoke<void>("native_asr_install_model", { modelId, taskId: id }).then(() => ({ text: "", chunks: [] }))
          : await invoke<void>(
            "native_asr_stage_audio",
            new Uint8Array(audio!.buffer, audio!.byteOffset, audio!.byteLength),
            { headers: { "x-task-id": id } },
          ).then(() => invoke<{ text: string; chunks?: WorkerResponse["chunks"] }>("native_asr_transcribe", { modelId, taskId: id }));
        if (this.pending.has(id)) resolve({ text: nativeResult.text ?? "", chunks: nativeResult.chunks });
      } catch (error) {
        if (this.pending.has(id)) reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        if (this.nativeTaskId === id) this.nativeTaskId = null;
        unlisten?.();
      }
    });
    return result;
  }
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
  install(modelId: string, onProgress?: PendingRequest["onProgress"]) {
    if (!isTauri()) return this.request("load", modelId, undefined, onProgress);
    return this.useNativeRuntime().then((native) => native ? this.nativeRequest("install", modelId, undefined, onProgress) : this.request("load", modelId, undefined, onProgress));
  }
  transcribe(modelId: string, audio: Float32Array, onProgress?: PendingRequest["onProgress"]) {
    if (!isTauri()) return this.request("transcribe", modelId, audio, onProgress);
    return this.useNativeRuntime().then((native) => native ? this.nativeRequest("transcribe", modelId, audio, onProgress) : this.request("transcribe", modelId, audio, onProgress));
  }
  cancelAll(message = "任务已暂停") {
    this.worker?.terminate(); this.worker = null;
    if (this.nativeTaskId) void invoke("native_asr_cancel").catch(() => undefined);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
    this.nativeTaskId = null;
  }
}

export const localTranscriptionRuntime = new Runtime();

export async function isLocalModelInstalled(modelId: string): Promise<boolean | null> {
  if (!isTauri()) return null;
  const capabilities = await invoke<NativeCapabilities>("native_asr_capabilities").catch(() => null);
  if (!capabilities?.available) return null;
  return invoke<boolean>("native_asr_model_status", { modelId });
}

export async function deleteCachedModel(modelId: string): Promise<void> {
  if (isTauri()) {
    const capabilities = await invoke<NativeCapabilities>("native_asr_capabilities").catch(() => null);
    if (capabilities?.available) {
      await invoke("native_asr_delete_model", { modelId });
      return;
    }
  }
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
