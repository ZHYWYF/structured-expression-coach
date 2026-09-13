// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "../core/defaultWorkspace";
import {
  readDeviceSecret,
  requestChatCompletion,
  testProviderConnection,
  transcribeWithOnlineProvider,
  writeDeviceSecret,
} from "./openAiCompatible";

describe("OpenAI-compatible provider", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores trimmed device secrets in memory outside Tauri and removes blank values", async () => {
    await writeDeviceSecret("ai", "  secret-value  ");
    await expect(readDeviceSecret("ai")).resolves.toBe("secret-value");

    await writeDeviceSecret("ai", "   ");
    await expect(readDeviceSecret("ai")).resolves.toBe("");
  });

  it("validates connection input and reports service errors", async () => {
    const configuration = createEmptyWorkspace().preferences.aiProvider;
    await expect(testProviderConnection({ ...configuration, baseUrl: "" }, "key")).resolves.toEqual({ ok: false, message: "请填写服务地址" });
    await expect(testProviderConnection(configuration, "")).resolves.toEqual({ ok: false, message: "请填写 API Key" });

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "unauthorized" } }), { status: 401 }));
    await expect(testProviderConnection(configuration, "key")).resolves.toEqual({ ok: false, message: "unauthorized" });
  });

  it("tests AI configuration through the configured chat model", async () => {
    const configuration = { ...createEmptyWorkspace().preferences.aiProvider, enabled: true, model: "deepseek-flash", baseUrl: "https://api.deepseek.com" };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 }));

    await expect(testProviderConnection(configuration, "key", "ai")).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(fetch).toHaveBeenCalledWith("https://api.deepseek.com/chat/completions", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
      model: "deepseek-flash",
      thinking: { type: "disabled" },
    });
  });

  it("HTTP成功但没有正文时连接测试失败，不再产生假阳性", async () => {
    const configuration = { ...createEmptyWorkspace().preferences.aiProvider, enabled: true, model: "deepseek-flash", baseUrl: "https://api.deepseek.com" };
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: null, reasoning_content: "推理尚未完成" } }] }), { status: 200 }));

    await expect(testProviderConnection(configuration, "key", "ai")).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/输出预算|正文/),
    });
  });

  it("preserves string errors returned by the native transport", async () => {
    const configuration = { ...createEmptyWorkspace().preferences.aiProvider, model: "deepseek-flash" };
    vi.mocked(fetch).mockRejectedValueOnce("network permission denied");

    await expect(testProviderConnection(configuration, "key", "ai")).resolves.toEqual({ ok: false, message: "network permission denied" });
  });

  it("requests chat completion with normalized URL and rejects empty content", async () => {
    const configuration = { ...createEmptyWorkspace().preferences.aiProvider, enabled: true, model: "model", baseUrl: "https://example.test/v1/" };
    await writeDeviceSecret("ai", "key");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: " result " } }] }), { status: 200 }));

    await expect(requestChatCompletion(configuration, [{ role: "user", content: "hello" }])).resolves.toBe("result");
    expect(fetch).toHaveBeenCalledWith("https://example.test/v1/chat/completions", expect.objectContaining({ method: "POST" }));

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(requestChatCompletion(configuration, [])).rejects.toThrow("没有返回可读取的正文");
  });

  it("兼容OpenAI文本数组响应，并在官方DeepSeek结构化任务中关闭思考", async () => {
    const configuration = { ...createEmptyWorkspace().preferences.aiProvider, enabled: true, model: "deepseek-flash", baseUrl: "https://api.deepseek.com" };
    await writeDeviceSecret("ai", "key");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: [{ type: "text", text: " 结构化结果 " }] } }] }), { status: 200 }));

    await expect(requestChatCompletion(configuration, [{ role: "user", content: "分析" }], { maxTokens: 8192 })).resolves.toBe("结构化结果");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toMatchObject({
      model: "deepseek-flash",
      max_tokens: 8192,
      thinking: { type: "disabled" },
    });
  });

  it("区分输出被截断、只有推理内容和未知响应结构", async () => {
    const configuration = { ...createEmptyWorkspace().preferences.aiProvider, enabled: true, model: "deepseek-flash", baseUrl: "https://api.deepseek.com" };
    await writeDeviceSecret("ai", "key");

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "", reasoning_content: "仍在推理" } }] }), { status: 200 }));
    await expect(requestChatCompletion(configuration, [])).rejects.toThrow(/输出预算不足/);

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: null, reasoning_content: "只有推理" } }] }), { status: 200 }));
    await expect(requestChatCompletion(configuration, [])).rejects.toThrow(/只返回了推理内容/);

    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "其他接口格式" }), { status: 200 }));
    await expect(requestChatCompletion(configuration, [])).rejects.toThrow(/返回格式不兼容/);
  });

  it("sends audio with the independently configured ASR credential", async () => {
    const configuration = { ...createEmptyWorkspace().preferences.onlineAsrProvider, enabled: true, model: "whisper" };
    await writeDeviceSecret("online-asr", "asr-key");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ text: " transcript " }), { status: 200 }));

    await expect(transcribeWithOnlineProvider(configuration, new File(["audio"], "sample.wav", { type: "audio/wav" }))).resolves.toBe("transcript");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("audio/transcriptions"), expect.objectContaining({ method: "POST" }));
  });

  it("语义建议使用既有凭证配置并携带预算与取消信号", async () => {
    await writeDeviceSecret("ai", "test-credential");
    const configuration = { ...createEmptyWorkspace().preferences.aiProvider, enabled: true, model: "chosen-model", baseUrl: "https://api.deepseek.com" };
    const abort = new AbortController();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"suggestions":[]}' } }] })));
    await requestChatCompletion(configuration, [{ role: "user", content: "当前会话" }], { signal: abort.signal, maxTokens: 2200 });
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(init?.body as string)).toMatchObject({ model: "chosen-model", max_tokens: 2200 });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
