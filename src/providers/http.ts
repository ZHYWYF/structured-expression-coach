import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export async function appFetch(input: string, init?: RequestInit): Promise<Response> {
  const abort = new AbortController();
  const forwardAbort = () => abort.abort(init?.signal?.reason);
  init?.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (init?.signal?.aborted) forwardAbort();
  const timer = setTimeout(() => abort.abort(new Error("请求超时，请检查网络后重试")), 120_000);
  try {
    const response = await (isTauri() ? tauriFetch(input, { ...init, signal: abort.signal }) : fetch(input, { ...init, signal: abort.signal }));
    const body = response.body ? await response.arrayBuffer() : null;
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", forwardAbort);
  }
}
