import type { ProviderConfiguration, RecordingTask } from "../core/types";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { appFetch } from "./http";

export type SecretKind = "ai" | "online-asr" | "sync";

const memorySecrets = new Map<SecretKind, string>();

export async function readDeviceSecret(kind: SecretKind): Promise<string> {
  if (isTauri()) return (await invoke<string | null>("get_device_secret", { kind })) ?? "";
  return memorySecrets.get(kind) ?? "";
}

export async function writeDeviceSecret(kind: SecretKind, value: string): Promise<void> {
  if (isTauri()) {
    await invoke("set_device_secret", { kind, value: value.trim() });
    return;
  }
  if (value.trim()) memorySecrets.set(kind, value.trim());
  else memorySecrets.delete(kind);
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function isDeepSeek(configuration: ProviderConfiguration): boolean {
  try {
    return new URL(configuration.baseUrl).hostname === "api.deepseek.com";
  } catch {
    return false;
  }
}

interface ChatCompletionBody {
  choices?: Array<{
    finish_reason?: unknown;
    text?: unknown;
    message?: { content?: unknown; reasoning_content?: unknown };
  }>;
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => {
    if (typeof part === "string") return [part];
    if (!part || typeof part !== "object") return [];
    const item = part as Record<string, unknown>;
    return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
  }).join("").trim();
}

function readChatCompletion(body: ChatCompletionBody): string {
  const choice = body.choices?.[0];
  const content = messageText(choice?.message?.content) || messageText(choice?.text);
  if (content) return content;
  if (choice?.finish_reason === "length") {
    throw new Error("AI 输出预算不足，最终正文被截断。请重试；应用已为结构化分析提高预算并关闭 DeepSeek 思考模式。");
  }
  if (messageText(choice?.message?.reasoning_content)) {
    throw new Error("AI 只返回了推理内容，没有返回最终正文。请重试；DeepSeek 结构化任务将自动关闭思考模式。");
  }
  if (Array.isArray(body.choices)) throw new Error("AI 服务没有返回可读取的正文");
  throw new Error("AI 服务返回格式不兼容：未找到 choices[0].message.content");
}

function redact(value: string, secret = ""): string {
  return (secret.length >= 3 ? value.split(secret).join("<REDACTED>") : value).replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer <REDACTED>").replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "<REDACTED>");
}
async function responseError(response: Response, secret = ""): Promise<string> {
  const text = await response.text();
  if (!text) return `服务返回 ${response.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
    const message = parsed.error?.message ?? parsed.message;
    return typeof message === "string" ? redact(message, secret) : `服务返回 ${response.status}`;
  } catch {
    return `服务返回 ${response.status}`;
  }
}

function requestError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : "连接失败，请检查网络、服务地址和应用网络权限";
  } catch {
    return "连接失败，请检查网络、服务地址和应用网络权限";
  }
}

export async function testProviderConnection(
  configuration: ProviderConfiguration,
  apiKey: string,
  kind: Exclude<SecretKind, "sync"> = "ai",
): Promise<{ ok: true; latencyMs: number } | { ok: false; message: string }> {
  if (!configuration.baseUrl.trim()) return { ok: false, message: "请填写服务地址" };
  if (!apiKey.trim()) return { ok: false, message: "请填写 API Key" };
  const startedAt = performance.now();
  try {
    const response = kind === "ai"
      ? await appFetch(apiUrl(configuration.baseUrl, "chat/completions"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: configuration.model.trim(),
            messages: [{ role: "user", content: "请只回复 OK" }],
            max_tokens: 32,
            temperature: 0,
            ...(isDeepSeek(configuration) ? { thinking: { type: "disabled" } } : {}),
          }),
        })
      : await appFetch(apiUrl(configuration.baseUrl, "models"), {
          headers: { Authorization: `Bearer ${apiKey.trim()}` },
        });
    if (!response.ok) return { ok: false, message: await responseError(response, apiKey) };
    if (kind === "ai") {
      try { readChatCompletion(await response.json() as ChatCompletionBody); }
      catch (error) { return { ok: false, message: error instanceof Error ? error.message : "AI 服务没有返回可读取的正文" }; }
    }
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { ok: false, message: redact(requestError(error), apiKey) };
  }
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export async function requestChatCompletion(
  configuration: ProviderConfiguration,
  messages: ChatMessage[],
  options: { signal?: AbortSignal; maxTokens?: number } = {},
): Promise<string> {
  const apiKey = await readDeviceSecret("ai");
  if (!configuration.enabled || !configuration.model.trim() || !apiKey) {
    throw new Error("请先在设置中启用并完成 AI 配置");
  }
  const requestBody = {
    model: configuration.model.trim(),
    messages,
    temperature: 0.2,
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    ...(isDeepSeek(configuration) ? { thinking: { type: "disabled" } } : {}),
  };
  const response = await appFetch(apiUrl(configuration.baseUrl, "chat/completions"), {
    method: "POST",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) throw new Error(await responseError(response, apiKey));
  return readChatCompletion(await response.json() as ChatCompletionBody);
}

export interface OnlineTranscriptionMetadata {
  durationSeconds?: number;
  transcriptSegments: NonNullable<RecordingTask["transcriptSegments"]>;
}

export async function transcribeWithOnlineProvider(
  configuration: ProviderConfiguration,
  file: File,
  onMetadata?: (metadata: OnlineTranscriptionMetadata) => void,
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = await readDeviceSecret("online-asr");
  if (!configuration.enabled || !configuration.model.trim() || !apiKey) {
    throw new Error("请先在设置中启用并完成在线转写配置");
  }
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("model", configuration.model);
  form.append("language", "zh");
  form.append("response_format", "verbose_json");
  const response = await appFetch(apiUrl(configuration.baseUrl, "audio/transcriptions"), {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) throw new Error(await responseError(response, apiKey));
  const body = await response.json() as { text?: string; duration?: unknown; segments?: unknown };
  if (typeof body.text !== "string" || !body.text.trim()) throw new Error("在线转写服务没有返回有效文本");
  const durationSeconds = typeof body.duration === "number" && Number.isFinite(body.duration) && body.duration > 0 ? body.duration : undefined;
  const transcriptSegments = (Array.isArray(body.segments) ? body.segments : []).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== "object") return [];
    const segment = raw as Record<string, unknown>;
    if (typeof segment.text !== "string" || !segment.text.trim() ||
        typeof segment.start !== "number" || !Number.isFinite(segment.start) || segment.start < 0 ||
        typeof segment.end !== "number" || !Number.isFinite(segment.end) || segment.end <= segment.start ||
        (durationSeconds !== undefined && segment.start >= durationSeconds)) return [];
    return [{ id: `segment-${crypto.randomUUID()}`, startMs: Math.round(segment.start * 1000),
      endMs: Math.round(Math.min(segment.end, durationSeconds ?? segment.end) * 1000), text: segment.text.trim() }];
  }).sort((left, right) => left.startMs - right.startMs);
  onMetadata?.({ durationSeconds, transcriptSegments });
  return body.text.trim();
}
