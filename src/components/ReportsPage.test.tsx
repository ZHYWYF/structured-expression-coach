// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeSession, RecordingTask } from "../core/types";
import { createController } from "../test/createController";

const mocks = vi.hoisted(() => ({
  loadAudioFile: vi.fn(), saveAudioFile: vi.fn(), deleteAudioFile: vi.fn(),
  decodeAudioTo16Khz: vi.fn(), transcribe: vi.fn(),
}));
vi.mock("../transcription/audioStore", () => ({ loadAudioFile: mocks.loadAudioFile, saveAudioFile: mocks.saveAudioFile, deleteAudioFile: mocks.deleteAudioFile }));
vi.mock("../transcription/localRuntime", () => ({ decodeAudioTo16Khz: mocks.decodeAudioTo16Khz, localTranscriptionRuntime: { transcribe: mocks.transcribe } }));
vi.mock("../providers/openAiCompatible", () => ({ requestChatCompletion: vi.fn(), transcribeWithOnlineProvider: vi.fn() }));

import { ReportsPage } from "./ReportsPage";

const now = "2026-09-11T08:00:00.000Z";
const session: PracticeSession = { id: "session", kind: "practice", title: "录音", scenarioId: "scenario-weekly-report", status: "draft", draftText: "", statements: [], messages: [], feedback: [], recordingTaskIds: ["recording"], materials: [], createdAt: now, updatedAt: now };
const task: RecordingTask = { id: "recording", sessionId: session.id, title: "audio.wav", sourceFileName: "audio.wav", status: "failed", provider: "local", progress: 0, reportStatus: "not-generated", createdAt: now, updatedAt: now };

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
    mocks.loadAudioFile.mockResolvedValue(new File(["audio"], "audio.wav", { type: "audio/wav" }));
    mocks.deleteAudioFile.mockResolvedValue(undefined);
    mocks.decodeAudioTo16Khz.mockResolvedValue({ samples: new Float32Array([0]), durationSeconds: 1 });
  });

  it("does not resurrect a recording deleted while transcription is finishing", async () => {
    let resolveTranscription!: (value: { text: string; chunks: [] }) => void;
    mocks.transcribe.mockReturnValue(new Promise((resolve) => { resolveTranscription = resolve; }));
    const controller = createController({
      sessions: [session], selectedSessionId: session.id, selectedSession: session,
      recordingTasks: [task],
      preferences: { ...createController().preferences, installedModels: [{ id: "model", label: "Model", fileName: "model", sizeBytes: 1, status: "ready", progress: 100 }] },
    });
    render(<ReportsPage controller={controller} />);

    fireEvent.click(screen.getByText("重新转写"));
    fireEvent.click(screen.getByLabelText("删除录音"));
    await waitFor(() => expect(controller.deleteRecordingTask).toHaveBeenCalledWith("recording"));
    vi.mocked(controller.upsertRecordingTask).mockClear();
    vi.mocked(controller.updateSession).mockClear();

    await act(async () => resolveTranscription({ text: "完成文本", chunks: [] }));

    expect(controller.upsertRecordingTask).not.toHaveBeenCalled();
    expect(controller.updateSession).not.toHaveBeenCalled();
  });
});
