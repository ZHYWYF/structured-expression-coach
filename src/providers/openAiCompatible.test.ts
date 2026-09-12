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
    expect(fetch).toHaveBeenCalledWith("https://api.deepseek.com/chat/completions", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"model":"deepseek-flash"'),
    }));
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
    await expect(requestChatCompletion(configuration, [])).rejects.toThrow("AI 服务没有返回有效内容");
  });

  it("sends audio with the independently configured ASR credential", async () => {
    const configuration = { ...createEmptyWorkspace().preferences.onlineAsrProvider, enabled: true, model: "whisper" };
    await writeDeviceSecret("online-asr", "asr-key");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ text: " transcript " }), { status: 200 }));

    await expect(transcribeWithOnlineProvider(configuration, new File(["audio"], "sample.wav", { type: "audio/wav" }))).resolves.toBe("transcript");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("audio/transcriptions"), expect.objectContaining({ method: "POST" }));
  });
});
