// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeSession, RecordingTask } from "../core/types";
import { createController } from "../test/createController";
import { createEmptyWorkspace } from "../core/defaultWorkspace";
import { createLocalStorageRepository } from "../core/storage";
import { useWorkspace, type WorkspaceController } from "../core/useWorkspace";

const mocks = vi.hoisted(() => ({
  loadAudioFile: vi.fn(), saveAudioFile: vi.fn(), deleteAudioFile: vi.fn(),
  decodeAudioTo16Khz: vi.fn(), transcribe: vi.fn(), requestChatCompletion: vi.fn(),
}));
vi.mock("../transcription/audioStore", () => ({ loadAudioFile: mocks.loadAudioFile, saveAudioFile: mocks.saveAudioFile, deleteAudioFile: mocks.deleteAudioFile }));
vi.mock("../transcription/localRuntime", () => ({ decodeAudioTo16Khz: mocks.decodeAudioTo16Khz, localTranscriptionRuntime: { transcribe: mocks.transcribe } }));
vi.mock("../providers/openAiCompatible", () => ({ requestChatCompletion: mocks.requestChatCompletion, transcribeWithOnlineProvider: vi.fn() }));

import { ReportsPage } from "./ReportsPage";

const now = "2026-09-11T08:00:00.000Z";
const session: PracticeSession = { id: "session", kind: "practice", title: "录音", scenarioId: "scenario-weekly-report", status: "draft", draftText: "", statements: [], messages: [], feedback: [], recordingTaskIds: ["recording"], materials: [], createdAt: now, updatedAt: now };
const task: RecordingTask = { id: "recording", sessionId: session.id, title: "audio.wav", sourceFileName: "audio.wav", status: "failed", provider: "local", progress: 0, reportStatus: "not-generated", createdAt: now, updatedAt: now };

function reportResponse() {
  return JSON.stringify({ title: "原文分析报告", overallScore: 80,
    dimensions: ["structure", "clarity", "evidence", "brevity", "confidence"].map((key) => ({ key, label: key, score: 80, summary: "依据原文评估" })),
    strengths: ["结论明确"], improvements: ["补充证据"], actionItems: ["周五复查"] });
}

async function mountRecording() {
  const seed = createEmptyWorkspace();
  seed.preferences.autoSave = false;
  seed.sessions = [{ ...session, draftText: "请求时的原始逐字稿" }];
  seed.selectedSessionId = session.id;
  seed.recordingTasks = [{ ...task, status: "completed", transcript: "请求时的原始逐字稿", analysisScenario: "report" }];
  const repository = createLocalStorageRepository();
  let current!: WorkspaceController;
  function Harness() {
    current = useWorkspace({ initialState: seed, repository });
    return <ReportsPage controller={current} />;
  }
  render(<Harness />);
  await waitFor(() => expect(current.isHydrated).toBe(true));
  return { current: () => current, repository };
}

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
    mocks.loadAudioFile.mockResolvedValue(new File(["audio"], "audio.wav", { type: "audio/wav" }));
    mocks.deleteAudioFile.mockResolvedValue(undefined);
    mocks.decodeAudioTo16Khz.mockResolvedValue({ samples: new Float32Array([0]), durationSeconds: 1 });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it("associates the upload trigger with the audio file input", () => {
    const controller = createController();
    render(<ReportsPage controller={controller} />);

    const input = screen.getByLabelText("上传录音") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toContain("audio/*");
  });

  it("uses the selected scenario prompt when generating a report", async () => {
    const completedTask: RecordingTask = { ...task, status: "completed", transcript: "项目延期，主要原因是沟通不到位。", analysisScenario: "retrospective" };
    mocks.requestChatCompletion.mockResolvedValue(JSON.stringify({
      title: "项目复盘报告", overallScore: 72,
      dimensions: [
        { key: "structure", label: "结构", score: 70, summary: "需补齐复盘结构" },
        { key: "clarity", label: "清晰度", score: 72, summary: "原因较抽象" },
        { key: "evidence", label: "证据", score: 65, summary: "缺少证据" },
        { key: "brevity", label: "简洁度", score: 80, summary: "较简洁" },
        { key: "confidence", label: "自信度", score: 75, summary: "表达稳定" },
      ],
      strengths: ["问题明确"], improvements: ["补充根因证据"], actionItems: ["定义验证标准"],
    }));
    const controller = createController({ sessions: [session], selectedSessionId: session.id, selectedSession: session, recordingTasks: [completedTask] });
    render(<ReportsPage controller={controller} />);

    fireEvent.click(screen.getByText("生成报告"));
    await waitFor(() => expect(mocks.requestChatCompletion).toHaveBeenCalled());
    const messages = mocks.requestChatCompletion.mock.calls[0][1] as Array<{ content: string }>;
    expect(messages.map((item) => item.content).join("\n")).toContain("根因证据");
  });

  it.each(["逐字稿", "场景"])("报告等待期间修改%s后保留新输入并拒绝旧报告", async (field) => {
    let resolve!: (value: string) => void;
    mocks.requestChatCompletion.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const harness = await mountRecording();
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    expect(mocks.requestChatCompletion).toHaveBeenCalledTimes(1);
    if (field === "逐字稿") {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "已校对的新逐字稿" } });
    } else {
      const switcher = screen.getByText("报告分析场景").parentElement!;
      fireEvent.click(within(switcher).getByRole("button", { name: "项目复盘" }));
    }
    await act(async () => resolve(reportResponse()));
    const saved = harness.current().recordingTasks[0];
    expect(saved.transcript).toBe(field === "逐字稿" ? "已校对的新逐字稿" : "请求时的原始逐字稿");
    expect(saved.analysisScenario).toBe(field === "场景" ? "retrospective" : "report");
    expect(saved.reportStatus).not.toBe("ready");
    expect(harness.current().sessions[0].report).toBeUndefined();
  });

  it("报告生成期间删除录音后迟到响应不能复活任务", async () => {
    let resolve!: (value: string) => void;
    mocks.requestChatCompletion.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const harness = await mountRecording();
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    fireEvent.click(screen.getByLabelText("删除录音"));
    await waitFor(() => expect(harness.current().recordingTasks).toEqual([]));
    await act(async () => resolve(reportResponse()));
    expect(harness.current().sessions).toEqual([]);
    expect(harness.current().recordingTasks).toEqual([]);
    expect(harness.current().tombstones).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "recording", entityId: task.id }),
      expect.objectContaining({ entityType: "session", entityId: session.id }),
    ]));
  });

  it("未改输入的有效报告与逐字稿保存后可重新读取", async () => {
    mocks.requestChatCompletion.mockResolvedValue(reportResponse());
    const harness = await mountRecording();
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    await waitFor(() => expect(harness.current().recordingTasks[0].reportStatus).toBe("ready"));
    await act(async () => harness.current().flush());
    const stored = await harness.repository.loadWorkspace();
    expect(stored?.sessions[0].report).toMatchObject({ sessionId: session.id, title: "原文分析报告", overallScore: 80 });
    expect(stored?.recordingTasks[0]).toMatchObject({ transcript: "请求时的原始逐字稿", analysisScenario: "report", reportStatus: "ready" });
  });
});
