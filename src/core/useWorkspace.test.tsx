// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "./defaultWorkspace";
import type { Repository } from "./storage";
import { useWorkspace } from "./useWorkspace";

function repository(seed = createEmptyWorkspace()): Repository {
  let workspace = seed;
  return {
    kind: "localStorage",
    initialize: vi.fn(async () => undefined),
    loadWorkspace: vi.fn(async () => workspace),
    saveWorkspace: vi.fn(async (next) => { workspace = next; }),
    listSessions: vi.fn(async () => workspace.sessions),
    getSession: vi.fn(async (id) => workspace.sessions.find((item) => item.id === id) ?? null),
    saveSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
  };
}

describe("useWorkspace", () => {
  it("hydrates an empty workspace and manages sessions, plans, recordings, and preferences", async () => {
    const repo = repository();
    const { result } = renderHook(() => useWorkspace({ repository: repo, persistDelayMs: 1 }));
    await waitFor(() => expect(result.current.isHydrated).toBe(true));

    let sessionId = "";
    act(() => {
      const session = result.current.createSession({ kind: "practice", title: "练习" });
      sessionId = session.id;
      result.current.updateSessionText("正文", session.id);
    });
    expect(result.current.selectedSession?.id).toBe(sessionId);
    expect(result.current.selectedSession?.draftText).toBe("正文");

    const now = new Date().toISOString();
    act(() => {
      result.current.upsertTrainingPlan({ id: "plan", title: "计划", description: "", scenarioId: "scenario-weekly-report", goals: ["清晰"], currentLevel: "intermediate", levelSource: "self-assessment", status: "active", startDate: "2026-09-11", endDate: "2026-09-18", focusAreas: [], tasks: [], createdAt: now, updatedAt: now });
      result.current.upsertRecordingTask({ id: "recording", sessionId, title: "录音", status: "queued", provider: "local", progress: 0, reportStatus: "not-generated", createdAt: now, updatedAt: now });
      result.current.updatePreferences({ theme: "dark" });
    });
    expect(result.current.trainingPlans).toHaveLength(1);
    expect(result.current.recordingTasks).toHaveLength(1);
    expect(result.current.selectedSession?.recordingTaskIds).toEqual(["recording"]);
    expect(result.current.preferences.theme).toBe("dark");

    act(() => result.current.deleteRecordingTask("recording"));
    expect(result.current.recordingTasks).toEqual([]);
    expect(result.current.selectedSession?.recordingTaskIds).toEqual([]);
  });

  it("persists the latest workspace when flushed", async () => {
    const repo = repository();
    const { result } = renderHook(() => useWorkspace({ repository: repo, persistDelayMs: 10_000 }));
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => result.current.navigate("settings"));
    await act(async () => result.current.flush());
    expect(repo.saveWorkspace).toHaveBeenCalledWith(expect.objectContaining({ currentPage: "settings" }));
  });
});
