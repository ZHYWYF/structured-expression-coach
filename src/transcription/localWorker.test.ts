import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pipeline: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({ env: { backends: { onnx: { wasm: {} } } }, pipeline: mocks.pipeline, BaseStreamer: class {} }));

describe("离线识别Worker", () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
  it("从缓存加载并通过真实streamer回调推进进度，不改变重叠分段算法", async () => {
    const output = vi.fn();
    const worker = { location: { href: "https://local.test/" }, postMessage: output, onmessage: undefined as undefined | ((value: { data: object }) => void) };
    vi.stubGlobal("self", worker);
    mocks.pipeline.mockResolvedValue(async (_audio: unknown, options: Record<string, unknown>) => {
      expect(options).toMatchObject({ language: "zh", return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
      const streamer = options.streamer as { put(value: bigint[][]): void; end(): void };
      streamer.put([[1n]]); streamer.end(); streamer.put([[2n]]); streamer.end();
      return { text: "识别完成", chunks: [{ text: "识别完成", timestamp: [0, 50] }] };
    });
    await import("./localWorker");
    worker.onmessage?.({ data: { id: "a", type: "transcribe", modelId: "model", audio: new Float32Array(50 * 16000) } });
    await vi.waitFor(() => expect(output).toHaveBeenCalledWith(expect.objectContaining({ type: "result", text: "识别完成" })));
    expect(mocks.pipeline).toHaveBeenCalledWith("automatic-speech-recognition", "model", expect.objectContaining({ local_files_only: true, dtype: "q4", device: "wasm" }));
    const progress = output.mock.calls.map(([value]) => value).filter((item) => item.type === "progress");
    expect(progress.some((item) => item.progress === 50)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ progress: 99, message: expect.stringContaining("合并") });
  });
  it("离线模型缺失返回错误，不伪造成功", async () => {
    const output = vi.fn();
    const worker = { location: { href: "https://local.test/" }, postMessage: output, onmessage: undefined as undefined | ((value: { data: object }) => void) };
    vi.stubGlobal("self", worker);
    mocks.pipeline.mockRejectedValue(new Error("本地缓存缺失"));
    await import("./localWorker");
    worker.onmessage?.({ data: { id: "a", type: "transcribe", modelId: "model", audio: new Float32Array(1) } });
    await vi.waitFor(() => expect(output).toHaveBeenCalledWith({ id: "a", type: "error", message: "本地缓存缺失" }));
  });
  it("安装只取远端模型，离线加载禁用远端请求", async () => {
    const output = vi.fn();
    const worker = { location: { href: "https://local.test/" }, postMessage: output, onmessage: undefined as undefined | ((value: { data: object }) => void) };
    vi.stubGlobal("self", worker);
    const { env } = await import("@huggingface/transformers");
    const policies: Array<[boolean, boolean]> = [];
    mocks.pipeline.mockImplementation(async () => {
      policies.push([env.allowLocalModels, env.allowRemoteModels]);
      return async () => ({ text: "", chunks: [] });
    });
    await import("./localWorker");
    worker.onmessage?.({ data: { id: "install", type: "load", modelId: "model-a" } });
    await vi.waitFor(() => expect(output).toHaveBeenCalledWith({ id: "install", type: "loaded" }));
    worker.onmessage?.({ data: { id: "offline", type: "transcribe", modelId: "model-b", audio: new Float32Array(0) } });
    await vi.waitFor(() => expect(output).toHaveBeenCalledWith({ id: "offline", type: "result", text: "", chunks: [] }));
    expect(policies).toEqual([[false, true], [true, false]]);
  });
  it("忽略缓存中的HTML回退页，仍保留有效模型缓存", async () => {
    vi.stubGlobal("self", { location: { href: "https://local.test/" } });
    const valid = new Response('{"model_type":"whisper"}', { headers: { "Content-Type": "application/json" } });
    const cache = { match: vi.fn().mockResolvedValueOnce(new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } })).mockResolvedValueOnce(valid), put: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue(cache) });
    await import("./localWorker");
    const { env } = await import("@huggingface/transformers");
    expect(env.useCustomCache).toBe(true);
    await expect(env.customCache!.match("https://model.test/config.json")).resolves.toBeUndefined();
    await expect(env.customCache!.match("https://model.test/config.json")).resolves.toBe(valid);
    await env.customCache!.put("https://model.test/config.json", valid);
    expect(cache.put).toHaveBeenCalledWith("https://model.test/config.json", valid);
  });
  it("模型JSON响应错误给出可操作说明，不直接展示解析异常", async () => {
    const output = vi.fn();
    const worker = { location: { href: "https://local.test/" }, postMessage: output, onmessage: undefined as undefined | ((value: { data: object }) => void) };
    vi.stubGlobal("self", worker);
    mocks.pipeline.mockRejectedValue(new SyntaxError("Unexpected token '<', <!doctype html> is not valid JSON"));
    await import("./localWorker");
    worker.onmessage?.({ data: { id: "a", type: "load", modelId: "model" } });
    await vi.waitFor(() => expect(output).toHaveBeenCalledWith({ id: "a", type: "error", message: expect.stringMatching(/模型配置.*重新下载/) }));
  });
});
