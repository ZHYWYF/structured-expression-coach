// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "../core/defaultWorkspace";
import type { PracticeSession, RecordingTask, Tombstone, TrainingPlan, WorkspaceState } from "../core/types";

const audioMocks = vi.hoisted(() => ({ loadAudioFile: vi.fn(), saveAudioFile: vi.fn() }));
vi.mock("../transcription/audioStore", () => audioMocks);

import { syncWorkspace, testSyncConnection } from "./webdavSync";

function recording(id: string, updatedAt: string, title = "audio.wav"): RecordingTask {
  return { id, sessionId: `session-${id}`, title, sourceFileName: title, status: "completed", provider: "local", progress: 100, reportStatus: "not-generated", createdAt: updatedAt, updatedAt };
}

const acceptanceTime = "2026-09-12T08:00:00.000Z";
const acceptanceCredentials = { endpoint: "https://sync.test", username: "<REDACTED>", password: "<REDACTED>" };
function practice(id: string, updatedAt = acceptanceTime): PracticeSession {
  return { id, title: id, kind: "practice", scenarioId: "scenario-weekly-report", status: "draft", draftText: "原文", statements: [], messages: [], feedback: [], recordingTaskIds: [], materials: [], createdAt: acceptanceTime, updatedAt };
}
function plan(id: string, updatedAt: string): TrainingPlan {
  return { id, title: id, description: "", scenarioId: "scenario-weekly-report", goals: ["结论先行"], currentLevel: "beginner", levelSource: "self-assessment", status: "draft", startDate: "2026-09-12", endDate: "2026-09-18", focusAreas: [], tasks: [], createdAt: acceptanceTime, updatedAt };
}
function remoteServer(remote: WorkspaceState) {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (init?.method === "MKCOL" || init?.method === "PUT") return new Response(null, { status: 201 });
    if (String(input).endsWith("workspace.json")) return new Response(JSON.stringify(remote), { status: 200 });
    return new Response(null, { status: 404 });
  });
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

  it.each<Tombstone["entityType"]>(["session", "recording", "training-plan"])("删除%s后离线设备更新不能恢复原ID", async (entityType) => {
    const local = createEmptyWorkspace();
    local.tombstones = [{ entityType, entityId: "removed", deletedAt: "2026-09-12T10:00:00.000Z" }];
    const remote = createEmptyWorkspace();
    for (const updatedAt of ["2026-09-12T09:00:00.000Z", "2026-09-12T11:00:00.000Z"]) {
      remote.sessions = entityType === "session" ? [practice("removed", updatedAt)] : [];
      remote.recordingTasks = entityType === "recording" ? [recording("removed", updatedAt)] : [];
      remote.trainingPlans = entityType === "training-plan" ? [plan("removed", updatedAt)] : [];
      remoteServer(remote);
      const result = await syncWorkspace(local, acceptanceCredentials);
      expect([...result.workspace.sessions, ...result.workspace.recordingTasks, ...result.workspace.trainingPlans].map((item) => item.id), `远端更新时间${updatedAt}`).not.toContain("removed");
      expect(result.workspace.tombstones).toEqual(local.tombstones);
    }
  });

  it("远端删除当前会话后选择仍存在的会话", async () => {
    const local = createEmptyWorkspace();
    local.sessions = [practice("removed"), practice("survivor")];
    local.selectedSessionId = "removed";
    const remote = createEmptyWorkspace();
    remote.tombstones = [{ entityType: "session", entityId: "removed", deletedAt: "2026-09-12T10:00:00.000Z" }];
    remoteServer(remote);
    const { workspace } = await syncWorkspace(local, acceptanceCredentials);
    expect(workspace.sessions.map((item) => item.id)).toEqual(["survivor"]);
    expect(workspace.selectedSessionId).toBe("survivor");
  });

  it("两端相同录音首次合并不因传输字段产生冲突", async () => {
    const local = createEmptyWorkspace();
    local.recordingTasks = [recording("same", acceptanceTime)];
    const remote = structuredClone(local);
    remoteServer(remote);
    const result = await syncWorkspace(local, acceptanceCredentials);
    expect(result.conflicts).toBe(0);
    expect(result.workspace.recordingTasks.map((item) => item.id)).toEqual(["same"]);
  });

  it("两端改动保留两份会话并正确重连冲突录音", async () => {
    const local = createEmptyWorkspace();
    local.preferences.sync.lastSyncedAt = "2026-09-11T00:00:00.000Z";
    local.sessions = [{ ...practice("session"), draftText: "本地原文", recordingTaskIds: ["audio"] }];
    local.recordingTasks = [{ ...recording("audio", acceptanceTime), sessionId: "session", transcript: "本地逐字稿" }];
    const remote = structuredClone(local);
    remote.sessions[0].draftText = "远端原文";
    remote.recordingTasks[0].transcript = "远端逐字稿";
    remoteServer(remote);
    const snapshot = structuredClone(local);
    const result = await syncWorkspace(local, acceptanceCredentials);
    expect(result.conflicts).toBe(2);
    const copy = result.workspace.sessions.find((item) => item.id !== "session")!;
    const audio = result.workspace.recordingTasks.find((item) => item.id !== "audio")!;
    expect(copy.draftText).toBe("远端原文");
    expect(audio.sessionId).toBe(copy.id);
    expect(copy.recordingTaskIds).toEqual([audio.id]);
    expect(result.workspace.sessions.find((item) => item.id === "session")?.draftText).toBe("本地原文");
    expect(local).toEqual(snapshot);
  });
});
