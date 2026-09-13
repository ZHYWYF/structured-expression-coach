// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { HomePage } from "./HomePage";
import { TrainingPlan } from "./TrainingPlan";
import { InterviewStudio } from "./InterviewStudio";
import { ExpressionWorkspace } from "./ExpressionWorkspace";
import { createController } from "../test/createController";
import type { InterviewSession, PracticeSession } from "../core/types";
import { adviceToFeedback, parseExpressionAdvice } from "../providers/expressionAdvice";

const materialMocks = vi.hoisted(() => ({ readDocumentText: vi.fn() }));
vi.mock("../materials/readDocument", () => ({ readDocumentText: materialMocks.readDocumentText }));
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

  it("imports JD and resume files through explicit file inputs", async () => {
    materialMocks.readDocumentText.mockResolvedValue("文件解析内容");
    const controller = createController({ sessions: [interview], selectedSessionId: interview.id, selectedSession: interview });
    render(<InterviewStudio controller={controller} />);
    fireEvent.click(screen.getAllByText("上传材料")[0]);

    const fileInputs = screen.getAllByLabelText("选择文件") as HTMLInputElement[];
    expect(fileInputs).toHaveLength(2);
    fireEvent.change(fileInputs[0], { target: { files: [new File(["JD"], "job.md", { type: "text/markdown" })] } });

    expect(materialMocks.readDocumentText).toHaveBeenCalled();
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

  it("AI批注与本地词条重叠时预览仍与原文一致，不自动替换", () => {
    const text = "项目预计延期，因为仍然需要一些支持。";
    const result = parseExpressionAdvice(JSON.stringify({ suggestions: [{ quote: text, issueType: "风险影响", reason: "范围不清", suggestion: "补充受影响范围" }] }), text, "model");
    const current = { ...practice, draftText: text, feedback: [adviceToFeedback(practice.id, text, "report", result, "model")] };
    const controller = createController({ sessions: [current], selectedSessionId: current.id, selectedSession: current });
    controller.preferences.aiProvider.model = "model";
    render(<ExpressionWorkspace controller={controller} />);
    expect(screen.getByRole("region", { name: "原句修改预览" }).textContent).toBe(text);
    expect(screen.getByLabelText("表达原文").getAttribute("disabled")).toBeNull();
    expect(screen.getByText(/AI语义建议 · model/)).toBeTruthy();
    expect(controller.updateSessionText).not.toHaveBeenCalled();
  });
  it("工作台重命名和删除使用应用内弹窗", async () => {
    const controller = createController({ sessions: [practice], selectedSessionId: practice.id, selectedSession: practice });
    render(<ExpressionWorkspace controller={controller} />);
    fireEvent.click(screen.getByText("重命名"));
    fireEvent.change(screen.getByLabelText("新名称"), { target: { value: "新的标题" } });
    await act(async () => fireEvent.click(screen.getByText("保存名称")));
    expect(controller.updateSession).toHaveBeenCalledWith(practice.id, expect.any(Function));
    fireEvent.click(screen.getByText("删除当前会话"));
    await act(async () => fireEvent.click(screen.getByText("取消")));
    expect(controller.deleteSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("删除当前会话"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认删除" })));
    expect(controller.deleteSession).toHaveBeenCalledWith(practice.id);
  });
});
