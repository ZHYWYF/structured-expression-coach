// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localTranscriptionRuntime } from "./localRuntime";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: object }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  respond(type: string, payload = {}) { this.onmessage?.({ data: { id: this.postMessage.mock.calls[0][0].id, type, ...payload } }); }
}

describe("本地转写任务生命周期", () => {
  beforeEach(() => { vi.useFakeTimers(); FakeWorker.instances = []; vi.stubGlobal("Worker", FakeWorker); });
  afterEach(() => { localTranscriptionRuntime.cancelAll(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("报告真实进度并成功释放运行锁", async () => {
    const progress = vi.fn();
    const request = localTranscriptionRuntime.transcribe("model", new Float32Array(1), progress);
    expect(localTranscriptionRuntime.isBusy).toBe(true);
    const worker = FakeWorker.instances[0];
    worker.respond("progress", { progress: 22, message: "正在识别第2段" });
    expect(progress).toHaveBeenCalledWith(22, "正在识别第2段");
    worker.respond("result", { text: "真实返回文本", chunks: [] });
    await expect(request).resolves.toEqual({ text: "真实返回文本", chunks: [] });
    expect(localTranscriptionRuntime.isBusy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("拒绝排队的第二个任务而不影响正在运行的任务", async () => {
    const first = localTranscriptionRuntime.install("model");
    await expect(localTranscriptionRuntime.transcribe("model", new Float32Array(1))).rejects.toThrow("其他任务");
    FakeWorker.instances[0].respond("loaded");
    await expect(first).resolves.toMatchObject({ text: "" });
  });
  it("长任务有新信号时续期，连续无响应10分钟才停止", async () => {
    const request = localTranscriptionRuntime.transcribe("model", new Float32Array(1)).catch((error: Error) => error);
    const worker = FakeWorker.instances[0];
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    worker.respond("progress", { progress: 30, message: "仍在推理" });
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    expect(localTranscriptionRuntime.isBusy).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await request as Error).message).toContain("连续 10 分钟");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(localTranscriptionRuntime.isBusy).toBe(false);
  });
  it.each(["onerror", "onmessageerror"] as const)("%s会拒绝任务且下次可重新启动", async (event) => {
    const first = localTranscriptionRuntime.install("model").catch((error: Error) => error);
    const worker = FakeWorker.instances[0];
    if (event === "onerror") worker.onerror?.({ message: "进程异常" }); else worker.onmessageerror?.();
    expect(await first).toBeInstanceOf(Error);
    const second = localTranscriptionRuntime.install("model");
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].respond("loaded");
    await second;
  });
  it("主动停止拒绝任务并清除超时器", async () => {
    const request = localTranscriptionRuntime.install("model").catch((error: Error) => error);
    localTranscriptionRuntime.cancelAll("用户停止");
    expect((await request as Error).message).toBe("用户停止");
    expect(vi.getTimerCount()).toBe(0);
  });
});
