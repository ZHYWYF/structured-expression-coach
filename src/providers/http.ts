import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export function appFetch(input: string, init?: RequestInit): Promise<Response> {
  return isTauri() ? tauriFetch(input, init) : fetch(input, init);
}
