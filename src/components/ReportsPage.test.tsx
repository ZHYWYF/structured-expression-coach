// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeSession, RecordingTask, Report, TrainingPlan, WorkspaceState } from "../core/types";
import { createController } from "../test/createController";
import { createEmptyWorkspace } from "../core/defaultWorkspace";
import { createLocalStorageRepository } from "../core/storage";
import { useWorkspace, type WorkspaceController } from "../core/useWorkspace";

const mocks = vi.hoisted(() => ({
  loadAudioFile: vi.fn(), saveAudioFile: vi.fn(), deleteAudioFile: vi.fn(),
  decodeAudioTo16Khz: vi.fn(), transcribe: vi.fn(), cancelAll: vi.fn(), requestChatCompletion: vi.fn(),
}));
vi.mock("../transcription/audioStore", () => ({ loadAudioFile: mocks.loadAudioFile, saveAudioFile: mocks.saveAudioFile, deleteAudioFile: mocks.deleteAudioFile }));
vi.mock("../transcription/localRuntime", () => ({ decodeAudioTo16Khz: mocks.decodeAudioTo16Khz, localTranscriptionRuntime: { transcribe: mocks.transcribe, cancelAll: mocks.cancelAll } }));
vi.mock("../providers/openAiCompatible", () => ({ requestChatCompletion: mocks.requestChatCompletion, transcribeWithOnlineProvider: vi.fn() }));

import { ReportsPage } from "./ReportsPage";

const now = "2026-09-11T08:00:00.000Z";
const session: PracticeSession = { id: "session", kind: "practice", title: "录音", scenarioId: "scenario-weekly-report", status: "draft", draftText: "", statements: [], messages: [], feedback: [], recordingTaskIds: ["recording"], materials: [], createdAt: now, updatedAt: now };
const task: RecordingTask = { id: "recording", sessionId: session.id, title: "audio.wav", sourceFileName: "audio.wav", status: "failed", provider: "local", progress: 0, reportStatus: "not-generated", createdAt: now, updatedAt: now };

function reportResponse(quote = "请求时的原始逐字稿") {
  return JSON.stringify({ title: "原文分析报告", overallScore: 80,
    dimensions: ["structure", "clarity", "evidence", "brevity", "confidence"].map((key) => ({ key, label: key, score: 80, summary: "依据原文评估" })),
    strengths: [`原文：${quote}\n亮点：表达了当前信息`],
    improvements: [`原文：${quote}\n问题：缺少验证依据\n建议：补充【待补充：验证记录】\n原因：便于核实结论`],
    actionItems: ["首要目标：补齐证据\n练习方法：重述结论并指出依据\n完成标准：提供一条可核实依据"] });
}

function legacyReport(): Report {
  return { ...JSON.parse(reportResponse()), id: "legacy-report", sessionId: session.id, generatedAt: now, title: "历史报告",
    strengths: ["旧亮点保持原样"], improvements: ["旧建议保持原样"], actionItems: ["练习开场", "补齐依据", "复盘行动"] };
}

function trainingPlan(patch: Partial<TrainingPlan> = {}): TrainingPlan {
  return { id: "current-plan", title: "本次计划", description: "合成数据", scenarioId: "scenario-weekly-report", goals: ["当前会话目标"], focusAreas: ["当前会话重点"],
    startDate: "2026-09-01", endDate: "2026-09-30", currentLevel: "beginner", levelSource: "self-assessment", status: "active", tasks: [],
    linkedSessionIds: [session.id], createdAt: now, updatedAt: now, ...patch };
}

function pendingReport() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  mocks.requestChatCompletion.mockReturnValue(new Promise<string>((done, fail) => { resolve = done; reject = fail; }));
  return { resolve: (value = reportResponse()) => resolve(value), reject: (reason: Error) => reject(reason) };
}

async function mountRecording(configure?: (seed: WorkspaceState) => void) {
  const seed = createEmptyWorkspace();
  seed.preferences.autoSave = false;
  seed.sessions = [{ ...session, draftText: "请求时的原始逐字稿" }];
  seed.selectedSessionId = session.id;
  seed.recordingTasks = [{ ...task, status: "completed", transcript: "请求时的原始逐字稿", analysisScenario: "report" }];
  configure?.(seed);
  const repository = createLocalStorageRepository();
  let current!: WorkspaceController;
  function Harness() {
    current = useWorkspace({ initialState: seed, repository });
    return <ReportsPage controller={current} />;
  }
  const view = render(<Harness />);
  await waitFor(() => expect(current.isHydrated).toBe(true));
  return { current: () => current, repository, view };
}

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
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
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认删除" })));
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
      strengths: ["原文：项目延期\n亮点：直接说明当前问题"],
      improvements: ["原文：主要原因是沟通不到位。\n问题：缺少根因证据\n建议：补充【待补充：沟通记录】\n原因：区分事实与判断"],
      actionItems: ["首要目标：补齐根因依据\n练习方法：核对一项沟通记录\n完成标准：说明记录与延期的关联"],
    }));
    const controller = createController({ sessions: [session], selectedSessionId: session.id, selectedSession: session, recordingTasks: [completedTask] });
    render(<ReportsPage controller={controller} />);

    fireEvent.click(screen.getByText("生成报告"));
    await waitFor(() => expect(mocks.requestChatCompletion).toHaveBeenCalled());
    const messages = mocks.requestChatCompletion.mock.calls[0][1] as Array<{ content: string }>;
    expect(messages.map((item) => item.content).join("\n")).toContain("根因证据");
    expect(mocks.requestChatCompletion.mock.calls[0][2]).toEqual({ maxTokens: 4096 });
    expect(controller.updateSession).toHaveBeenCalledWith(session.id, expect.any(Function));
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
    expect(saved.reportStatus).toBe("outdated");
    expect(harness.current().sessions[0].report).toBeUndefined();
  });

  it("报告生成期间删除录音后迟到响应不能复活任务", async () => {
    let resolve!: (value: string) => void;
    mocks.requestChatCompletion.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const harness = await mountRecording();
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    fireEvent.click(screen.getByLabelText("删除录音"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认删除" })));
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
    expect(stored?.version).toBe(2);
    expect(stored?.sessions[0].draftText).toBe("请求时的原始逐字稿");
    expect(stored?.sessions[0].report?.actionItems).toHaveLength(1);
    expect(stored?.sessions[0].report?.strengths.every((item) => typeof item === "string")).toBe(true);
    expect(mocks.requestChatCompletion.mock.calls[0][2]).toEqual({ maxTokens: 4096 });
  });

  it.each(["目标", "重点", "场景目标"])("生成期间相关%s变化后不保存旧结果且保留历史报告", async (field) => {
    const request = pendingReport(); const previous = legacyReport();
    const harness = await mountRecording((seed) => {
      seed.sessions[0].report = previous; seed.recordingTasks[0].reportStatus = "ready";
      if (field !== "场景目标") seed.trainingPlans = [trainingPlan()];
    });
    fireEvent.click(screen.getByRole("button", { name: "重新生成报告" }));
    expect(harness.current().recordingTasks[0].reportStatus).toBe("generating");
    const payload = JSON.parse(mocks.requestChatCompletion.mock.calls[0][1][1].content);
    expect(payload.trainingGoals).toEqual(field === "场景目标" ? ["结论先行", "事实与数据", "明确下一步"] : ["当前会话目标"]);
    expect(mocks.requestChatCompletion.mock.calls[0][2]).toEqual({ maxTokens: 4096 });
    act(() => {
      if (field === "场景目标") {
        const snapshot = harness.current().getSnapshot!();
        harness.current().replaceWorkspace({ ...snapshot, scenarios: snapshot.scenarios.map((item) => item.id === "scenario-weekly-report" ? { ...item, goals: ["更新后的场景目标"] } : item) });
      } else {
        harness.current().upsertTrainingPlan(trainingPlan(field === "目标" ? { goals: ["更新后的目标"] } : { focusAreas: ["更新后的重点"] }));
      }
    });
    await act(async () => request.resolve());
    expect(harness.current().sessions[0].report).toEqual(previous);
    expect(harness.current().recordingTasks[0].reportStatus).toBe("outdated");
    expect(harness.current().sessions[0].draftText).toBe("请求时的原始逐字稿");
    expect(mocks.requestChatCompletion).toHaveBeenCalledTimes(1);
    await act(async () => harness.current().flush());
    expect((await harness.repository.loadWorkspace())?.sessions[0].report).toEqual(previous);
  });

  it("不相关场景计划变化不误丢弃当前结果，请求只带本会话目标", async () => {
    const request = pendingReport();
    const other = trainingPlan({ id: "other", scenarioId: "scenario-interview", linkedSessionIds: ["另一会话"], goals: ["另一会话专属目标"] });
    const harness = await mountRecording((seed) => { seed.trainingPlans = [trainingPlan(), other]; });
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    const payload = JSON.parse(mocks.requestChatCompletion.mock.calls[0][1][1].content);
    expect(payload.trainingGoals).toEqual(["当前会话目标"]);
    expect(payload.focusAreas).toEqual(["当前会话重点"]);
    expect(JSON.stringify(payload)).not.toContain("另一会话专属目标");
    act(() => harness.current().upsertTrainingPlan({ ...other, goals: ["无关的新目标"] }));
    await act(async () => request.resolve());
    expect(harness.current().recordingTasks[0].reportStatus).toBe("ready");
    expect(harness.current().sessions[0].report?.title).toBe("原文分析报告");
  });

  it("切换录音查看另一场景时结果仍归属原会话，后续请求使用另一会话目标", async () => {
    const request = pendingReport();
    const harness = await mountRecording((seed) => {
      seed.trainingPlans = [trainingPlan(), trainingPlan({ id: "interview-plan", scenarioId: "scenario-interview", linkedSessionIds: ["other-session"], goals: ["面试专属目标"], focusAreas: ["面试专属重点"] })];
      seed.sessions.push({ ...session, id: "other-session", title: "另一录音", draftText: "另一段面试原文", recordingTaskIds: ["other-recording"] });
      seed.recordingTasks.push({ ...task, id: "other-recording", sessionId: "other-session", title: "另一录音.wav", status: "completed", transcript: "另一段面试原文", analysisScenario: "interview" });
    });
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    fireEvent.click(screen.getByRole("button", { name: /另一录音.wav/ }));
    await act(async () => request.resolve());
    expect(harness.current().sessions.find((item) => item.id === session.id)?.report?.sessionId).toBe(session.id);
    expect(harness.current().sessions.find((item) => item.id === "other-session")?.report).toBeUndefined();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("另一段面试原文");
    mocks.requestChatCompletion.mockResolvedValue(reportResponse("另一段面试原文"));
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    await waitFor(() => expect(harness.current().sessions.find((item) => item.id === "other-session")?.report).toBeTruthy());
    const first = JSON.parse(mocks.requestChatCompletion.mock.calls[0][1][1].content);
    const second = JSON.parse(mocks.requestChatCompletion.mock.calls[1][1][1].content);
    expect(first).toMatchObject({ scenario: "report", transcript: "请求时的原始逐字稿", trainingGoals: ["当前会话目标"] });
    expect(second).toMatchObject({ scenario: "interview", transcript: "另一段面试原文", trainingGoals: ["面试专属目标"], focusAreas: ["面试专属重点"] });
    expect(JSON.stringify(second)).not.toContain("当前会话目标");
  });

  it.each(["引用不存在", "请求拒绝"])("%s时保留旧报告与原文，失败状态允许重新生成", async (failure) => {
    const previous = legacyReport();
    if (failure === "引用不存在") mocks.requestChatCompletion.mockResolvedValue(reportResponse("并不存在于原文的句子"));
    else mocks.requestChatCompletion.mockRejectedValue(new Error("合成服务错误"));
    const harness = await mountRecording((seed) => { seed.sessions[0].report = previous; seed.recordingTasks[0].reportStatus = "ready"; });
    fireEvent.click(screen.getByRole("button", { name: "重新生成报告" }));
    await waitFor(() => expect(harness.current().recordingTasks[0].reportStatus).toBe("failed"));
    expect(harness.current().sessions[0].report).toEqual(previous);
    expect(harness.current().sessions[0].draftText).toBe("请求时的原始逐字稿");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("请求时的原始逐字稿");
    expect((screen.getByRole("button", { name: "重新生成报告" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => harness.current().flush());
    expect((await harness.repository.loadWorkspace())?.sessions[0].report).toEqual(previous);
  });

  it("旧报告存储后重新加载仍展示原有字符串和多个历史行动项", async () => {
    const previous = legacyReport();
    const harness = await mountRecording((seed) => { seed.sessions[0].report = previous; seed.recordingTasks[0].reportStatus = "ready"; });
    await act(async () => harness.current().flush());
    harness.view.unmount();
    const restored = await mountRecording();
    expect(restored.current().sessions[0].report).toEqual(previous);
    expect(screen.getByRole("heading", { name: "历史报告" })).toBeTruthy();
    expect(screen.getByText("旧亮点保持原样")).toBeTruthy();
    expect(screen.getByText("旧建议保持原样")).toBeTruthy();
    for (const action of previous.actionItems) expect(screen.getByText(action)).toBeTruthy();
    expect(mocks.requestChatCompletion).not.toHaveBeenCalled();
    expect(mocks.saveAudioFile).not.toHaveBeenCalled();
    expect(mocks.deleteAudioFile).not.toHaveBeenCalled();
  });

  it("目标变化后请求拒绝应退出生成中状态并保留旧报告", async () => {
    const request = pendingReport(); const previous = legacyReport();
    const harness = await mountRecording((seed) => { seed.trainingPlans = [trainingPlan()]; seed.sessions[0].report = previous; seed.recordingTasks[0].reportStatus = "ready"; });
    fireEvent.click(screen.getByRole("button", { name: "重新生成报告" }));
    act(() => harness.current().upsertTrainingPlan(trainingPlan({ goals: ["更新后的目标"] })));
    await act(async () => request.reject(new Error("合成服务错误")));
    expect(harness.current().sessions[0].report).toEqual(previous);
    expect((screen.getByRole("button", { name: "重新生成报告" }) as HTMLButtonElement).disabled).toBe(false);
    expect(harness.current().recordingTasks[0].reportStatus).toBe("outdated");
  });

  it("重启遗留的5%任务转为可重试状态，音频和逐字稿不删除", () => {
    const interrupted = { ...task, status: "transcribing" as const, progress: 5, transcript: "已校对内容" };
    const controller = createController({ sessions: [session], recordingTasks: [interrupted] });
    render(<ReportsPage controller={controller} />);
    expect(controller.upsertRecordingTask).toHaveBeenCalledWith(expect.objectContaining({ id: task.id, status: "failed", transcript: "已校对内容", errorMessage: expect.stringContaining("已中断") }));
    expect(mocks.deleteAudioFile).not.toHaveBeenCalled();
  });

  it("隐藏页面后仍保留真实进度与停止入口，重复点击不会再次启动", async () => {
    let resolve!: (value: { text: string; chunks: [] }) => void;
    mocks.transcribe.mockReturnValue(new Promise((done) => { resolve = done; }));
    const controller = createController({ sessions: [session], recordingTasks: [task], preferences: { ...createController().preferences, installedModels: [{ id: "model", label: "model", fileName: "model", sizeBytes: 1, progress: 100, status: "ready" }] } });
    const view = render(<ReportsPage controller={controller} />);
    fireEvent.click(screen.getByText("重新转写"));
    fireEvent.click(screen.getByText("重新转写"));
    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalledTimes(1));
    act(() => mocks.transcribe.mock.calls[0][2](32, "正在识别第 15/44 段"));
    expect(screen.getByText("正在识别第 15/44 段")).toBeTruthy();
    view.rerender(<ReportsPage controller={controller} active={false} />);
    view.rerender(<ReportsPage controller={controller} active />);
    expect(screen.getByText("正在识别第 15/44 段")).toBeTruthy();
    expect(screen.getByText("停止转写")).toBeTruthy();
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ text: "识别后的完整文本", chunks: [] }));
    expect(controller.upsertRecordingTask).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", transcript: "识别后的完整文本", progress: 100 }));
  });
  it("取消删除保留录音，音频删除失败保留记录并说明原因", async () => {
    const controller = createController({ sessions: [session], recordingTasks: [task] });
    render(<ReportsPage controller={controller} />);
    fireEvent.click(screen.getByLabelText("删除录音"));
    await act(async () => fireEvent.click(screen.getByText("取消")));
    expect(mocks.deleteAudioFile).not.toHaveBeenCalled();
    expect(controller.deleteRecordingTask).not.toHaveBeenCalled();
    mocks.deleteAudioFile.mockRejectedValue(new Error("测试删除失败"));
    fireEvent.click(screen.getByLabelText("删除录音"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认删除" })));
    expect(controller.deleteRecordingTask).not.toHaveBeenCalled();
    expect(screen.getByText("原始音频删除失败，已保留记录，请重试。")).toBeTruthy();
  });
});
