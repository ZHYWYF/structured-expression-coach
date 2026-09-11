// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { HomePage } from "./HomePage";
import { TrainingPlan } from "./TrainingPlan";
import { InterviewStudio } from "./InterviewStudio";
import { ExpressionWorkspace } from "./ExpressionWorkspace";
import { createController } from "../test/createController";
import type { InterviewSession, PracticeSession } from "../core/types";

vi.mock("../materials/readDocument", () => ({ readDocumentText: vi.fn() }));
vi.mock("../providers/openAiCompatible", () => ({ requestChatCompletion: vi.fn(), readDeviceSecret: vi.fn(() => ""), writeDeviceSecret: vi.fn(), testProviderConnection: vi.fn() }));
vi.mock("../transcription/localRuntime", () => ({ localTranscriptionRuntime: { transcribe: vi.fn(), install: vi.fn(), cancelAll: vi.fn() }, localModelCatalog: [] }));

const now = "2026-09-11T08:00:00.000Z";
const practice: PracticeSession = { id: "practice", kind: "practice", title: "工作汇报", scenarioId: "scenario-weekly-report", status: "draft", draftText: "最近完成了工作", statements: [], messages: [], feedback: [], recordingTaskIds: [], materials: [], createdAt: now, updatedAt: now };
const interview: InterviewSession = { ...practice, id: "interview", kind: "interview", title: "面试", scenarioId: "scenario-interview", jobDescription: { id: "jd", kind: "job-description", title: "JD", content: "负责项目推进和数据分析能力。", createdAt: now, updatedAt: now }, resume: { id: "resume", kind: "resume", title: "简历", content: "负责过项目推进。", createdAt: now, updatedAt: now }, questionAnswers: {}, activeQuestionIndex: 0, materialsLocked: false };

describe("product page flows", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("navigates from desktop and mobile app shell", () => {
    const onNavigate = vi.fn();
    render(<AppShell active="home" onNavigate={onNavigate} saveState="已保存" completedTrainingCount={2}><div>content</div></AppShell>);
    fireEvent.click(screen.getAllByText("设置")[0]);
    expect(onNavigate).toHaveBeenCalledWith("settings");
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("shows the real home empty state and starts a practice", () => {
    const controller = createController();
    const onNavigate = vi.fn();
    render(<HomePage controller={controller} onNavigate={onNavigate} />);
    expect(screen.getByText("创建第一段表达")).toBeTruthy();
    fireEvent.click(screen.getByText("工作汇报"));
    expect(controller.createSession).toHaveBeenCalledWith(expect.objectContaining({ kind: "practice", title: "新的工作汇报" }));
  });

  it("creates a training plan from the empty state", () => {
    const controller = createController();
    render(<TrainingPlan controller={controller} />);
    fireEvent.click(screen.getByText("创建第一个计划"));
    expect(screen.getByText("创建训练计划")).toBeTruthy();
  });

  it("locks interview materials and creates local questions", () => {
    const controller = createController({ sessions: [interview], selectedSessionId: interview.id, selectedSession: interview });
    render(<InterviewStudio controller={controller} />);
    fireEvent.click(screen.getAllByText("上传材料")[0]);
    fireEvent.click(screen.getByText("确认并固定材料"));
    expect(controller.updateSession).toHaveBeenCalled();
    const updater = vi.mocked(controller.updateSession).mock.calls.at(-1)?.[1];
    const updated = updater?.(interview) as InterviewSession;
    expect(updated.materialsLocked).toBe(true);
    expect(updated.interviewQuestions?.length).toBeGreaterThan(0);
  });

  it("searches sessions and records a completed expression", () => {
    const controller = createController({ sessions: [practice], selectedSessionId: practice.id, selectedSession: practice });
    render(<ExpressionWorkspace controller={controller} />);
    fireEvent.change(screen.getByPlaceholderText("搜索标题或内容"), { target: { value: "不存在" } });
    expect(screen.getByText("还没有表达会话")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("搜索标题或内容"), { target: { value: "" } });
    fireEvent.click(screen.getByText("完成表达"));
    expect(controller.addStatement).toHaveBeenCalled();
    expect(controller.updateSession).toHaveBeenCalled();
  });
});
