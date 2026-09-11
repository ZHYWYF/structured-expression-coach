// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "../core/defaultWorkspace";
import type { RecordingTask } from "../core/types";

const audioMocks = vi.hoisted(() => ({ loadAudioFile: vi.fn(), saveAudioFile: vi.fn() }));
vi.mock("../transcription/audioStore", () => audioMocks);

import { syncWorkspace, testSyncConnection } from "./webdavSync";

function recording(id: string, updatedAt: string, title = "audio.wav"): RecordingTask {
  return { id, sessionId: `session-${id}`, title, sourceFileName: title, status: "completed", provider: "local", progress: 100, reportStatus: "not-generated", createdAt: updatedAt, updatedAt };
}

describe("WebDAV sync", () => {
  beforeEach(() => {
    audioMocks.loadAudioFile.mockReset();
    audioMocks.saveAudioFile.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "conflict-id") });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("accepts WebDAV multi-status responses", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 207 }));
    await expect(testSyncConnection({ endpoint: "https://sync.test/", username: "user", password: "pass" })).resolves.toBeUndefined();
  });

  it("uploads local audio and writes a sanitized workspace", async () => {
    const local = createEmptyWorkspace();
    local.recordingTasks = [recording("one", "2026-09-11T01:00:00.000Z")];
    audioMocks.loadAudioFile.mockResolvedValue(new File(["audio"], "audio.wav", { type: "audio/wav" }));
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const result = await syncWorkspace(local, { endpoint: "https://sync.test/", username: "user", password: "pass" });

    expect(result.uploadedAudio).toBe(1);
    const workspacePut = vi.mocked(fetch).mock.calls.at(-1);
    expect(workspacePut?.[0]).toBe("https://sync.test/workspace.json");
    expect(String((workspacePut?.[1] as RequestInit).body)).toContain('"installedModels":[]');
  });

  it("keeps the remote audio attached to a recording conflict copy", async () => {
    const local = createEmptyWorkspace();
    local.preferences.sync.lastSyncedAt = "2026-09-10T00:00:00.000Z";
    local.recordingTasks = [recording("same", "2026-09-11T01:00:00.000Z", "local.wav")];
    const remote = createEmptyWorkspace();
    remote.preferences.sync.deviceName = "Android";
    remote.recordingTasks = [recording("same", "2026-09-11T02:00:00.000Z", "remote.wav")];
    audioMocks.loadAudioFile.mockImplementation(async (id: string) => id === "same" ? new File(["local"], "local.wav") : null);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "MKCOL" || init?.method === "PUT") return new Response(null, { status: 201 });
      if (url.endsWith("workspace.json")) return new Response(JSON.stringify(remote), { status: 200 });
      if (url.endsWith("audio/same-remote.wav")) return new Response(new Blob(["remote"], { type: "audio/wav" }), { status: 200 });
      return new Response(null, { status: 404 });
    });

    const result = await syncWorkspace(local, { endpoint: "https://sync.test", username: "user", password: "pass" });
    const conflict = result.workspace.recordingTasks.find((task) => task.id.includes("conflict"));

    expect(conflict).toBeDefined();
    expect(audioMocks.saveAudioFile).toHaveBeenCalledWith(conflict?.id, expect.any(File));
  });
});
