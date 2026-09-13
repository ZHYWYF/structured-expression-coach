// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "../core/defaultWorkspace";
import { createLocalStorageRepository } from "../core/storage";
import type { InterviewSession } from "../core/types";
import { useWorkspace, type WorkspaceController } from "../core/useWorkspace";

const mocks = vi.hoisted(() => ({ requestChatCompletion: vi.fn() }));
vi.mock("../providers/openAiCompatible", () => mocks);
vi.mock("../materials/readDocument", () => ({ readDocumentText: vi.fn() }));
import { InterviewStudio } from "./InterviewStudio";

const now = "2026-09-12T08:00:00.000Z";
function interview(id: string): InterviewSession {
  return { id, title: `面试${id}`, kind: "interview", scenarioId: "scenario-interview", status: "active",
    draftText: `${id}原答案`, statements: [], messages: [], feedback: [], recordingTaskIds: [], materials: [], createdAt: now, updatedAt: now,
    jobDescription: { id: `jd-${id}`, title: `岗位${id}`, kind: "job-description", content: `负责${id}项目的数据分析。`, createdAt: now, updatedAt: now },
    resume: { id: `resume-${id}`, title: `简历${id}`, kind: "resume", content: `参与${id}项目交付。`, createdAt: now, updatedAt: now },
    materialsLocked: true, activeQuestionIndex: 0,
    interviewQuestions: [{ id: `q-${id}`, tag: "项目经历", text: `介绍${id}项目`, source: "local", suggestedMinutes: 3 }],
    questionAnswers: { [`q-${id}`]: `${id}原答案` } };
}
const feedback = { structure: "原答案结构反馈", jdMatch: "岗位证据", resumeConsistency: "未新增经历", evidenceStrength: "待补证据", overallSuggestion: "补充真实数据" };

async function mountInterviews() {
  const seed = createEmptyWorkspace();
  seed.preferences.autoSave = false;
  seed.preferences.aiProvider = { ...seed.preferences.aiProvider, enabled: true, model: "test-model" };
  seed.sessions = [interview("A"), interview("B")];
  seed.selectedSessionId = "A";
  const repository = createLocalStorageRepository();
  let current!: WorkspaceController;
  function Harness() {
    current = useWorkspace({ initialState: seed, repository });
    return <InterviewStudio controller={current} />;
  }
  render(<Harness />);
  await waitFor(() => expect(current.isHydrated).toBe(true));
  return { current: () => current, repository };
}
async function startAnalysis() {
  fireEvent.click(screen.getByRole("button", { name: "深度分析回答" }));
  const confirm = screen.queryByRole("button", { name: "同意并继续" });
  if (confirm) await act(async () => fireEvent.click(confirm));
}
function currentInterview(controller: WorkspaceController, id = "A") {
  return controller.sessions.find((session) => session.id === id) as InterviewSession;
}

describe("InterviewStudio", () => {
  beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("分析等待期间编辑答案后拒绝旧答案反馈", async () => {
    let resolve!: (value: string) => void;
    mocks.requestChatCompletion.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const harness = await mountInterviews();
    await startAnalysis();
    expect(mocks.requestChatCompletion).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "A校对后的新答案" } });
    await act(async () => resolve(JSON.stringify(feedback)));
    const session = currentInterview(harness.current());
    expect(session.questionAnswers?.["q-A"]).toBe("A校对后的新答案");
    expect(session.interviewFeedback?.["q-A"]).toBeUndefined();
  });

  it("空对象反馈显示格式错误且不保存无效结果", async () => {
    mocks.requestChatCompletion.mockResolvedValue("{}");
    const harness = await mountInterviews();
    await startAnalysis();
    expect(currentInterview(harness.current()).interviewFeedback?.["q-A"]).toBeUndefined();
    expect(screen.getByRole("status").textContent).toMatch(/格式|有效|完整/);
    expect(currentInterview(harness.current()).questionAnswers?.["q-A"]).toBe("A原答案");
  });

  it("切换面试会话后返回结果只写回原问题和原材料", async () => {
    let resolve!: (value: string) => void;
    mocks.requestChatCompletion.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const harness = await mountInterviews();
    await startAnalysis();
    const requestText = JSON.stringify(mocks.requestChatCompletion.mock.calls[0][1]);
    expect(requestText).toContain("负责A项目");
    expect(requestText).toContain("A原答案");
    expect(requestText).not.toContain("负责B项目");
    fireEvent.click(screen.getByRole("button", { name: /面试B/ }));
    await act(async () => resolve(JSON.stringify(feedback)));
    expect(harness.current().selectedSessionId).toBe("B");
    expect(currentInterview(harness.current(), "B").interviewFeedback).toBeUndefined();
    expect(currentInterview(harness.current()).interviewFeedback?.["q-A"]).toMatchObject(feedback);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("B原答案");
    await act(async () => harness.current().flush());
    const stored = await harness.repository.loadWorkspace();
    expect((stored?.sessions[0] as InterviewSession).interviewFeedback?.["q-A"]).toMatchObject(feedback);
  });

  it("分析服务失败保留答案并允许重试", async () => {
    mocks.requestChatCompletion.mockRejectedValue(new Error("测试服务暂不可用"));
    const harness = await mountInterviews();
    await startAnalysis();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("测试服务暂不可用"));
    expect(currentInterview(harness.current()).questionAnswers?.["q-A"]).toBe("A原答案");
    expect(currentInterview(harness.current()).interviewFeedback).toBeUndefined();
    expect((screen.getByRole("button", { name: "深度分析回答" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("删除面试先取消保留，再确认删除，只影响目标会话", async () => {
    const harness = await mountInterviews();
    fireEvent.click(screen.getByText("删除面试"));
    await act(async () => fireEvent.click(screen.getByText("取消")));
    expect(harness.current().sessions).toHaveLength(2);
    fireEvent.click(screen.getByText("删除面试"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认删除" })));
    expect(harness.current().sessions.map((item) => item.id)).toEqual(["B"]);
  });
  it("材料固定后简历仍可只读查看，关闭后恢复回答区", async () => {
    await mountInterviews();
    fireEvent.click(screen.getByRole("button", { name: /个人简历.*简历A/ }));
    expect((screen.getByLabelText("个人简历正文") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByText("选择文件")).toBeNull();
    fireEvent.click(screen.getByText("关闭材料"));
    expect(screen.queryByLabelText("个人简历正文")).toBeNull();
  });
  it("本地模式能生成新问题和基于回答的追问", async () => {
    const harness = await mountInterviews();
    fireEvent.click(screen.getByText("本地出题"));
    fireEvent.click(screen.getByRole("button", { name: "生成新问题" }));
    expect(currentInterview(harness.current()).interviewQuestions!.length).toBeGreaterThan(1);
    fireEvent.change(screen.getByLabelText("面试回答"), { target: { value: "我们推进了项目，最后做得很好。" } });
    const before = currentInterview(harness.current()).interviewQuestions!.length;
    fireEvent.click(screen.getByText("根据回答追问"));
    expect(currentInterview(harness.current()).interviewQuestions!.length).toBe(before + 2);
    expect(mocks.requestChatCompletion).not.toHaveBeenCalled();
  });
  it("空回答点击追问会说明条件，不静默无反应", async () => {
    await mountInterviews();
    fireEvent.change(screen.getByLabelText("面试回答"), { target: { value: "" } });
    fireEvent.click(screen.getByText("根据回答追问"));
    expect(screen.getByRole("status").textContent).toContain("先在当前题目下填写回答");
    expect(screen.getByText("先搭结构，再填真实经历")).toBeTruthy();
  });
  it("AI出题前确认，拒绝不发送，允许后生成并保留原答案", async () => {
    mocks.requestChatCompletion.mockResolvedValue(JSON.stringify({ questions: [{ tag: "数据", text: "请描述你通过数据分析解决项目问题的经历。", jdEvidence: "负责A项目的数据分析" }] }));
    const harness = await mountInterviews();
    fireEvent.click(screen.getByRole("button", { name: "生成新问题" }));
    await act(async () => fireEvent.click(screen.getByText("取消")));
    expect(mocks.requestChatCompletion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "生成新问题" }));
    await act(async () => fireEvent.click(screen.getByText("同意并继续")));
    expect(currentInterview(harness.current()).interviewQuestions).toHaveLength(2);
    expect(currentInterview(harness.current()).questionAnswers?.["q-A"]).toBe("A原答案");
  });
  it("优化参考稿与原答案并排保存，不改写用户答案", async () => {
    mocks.requestChatCompletion.mockResolvedValue(JSON.stringify({ ...feedback, answerFramework: ["目标", "行动", "结果"],
      referenceAnswer: "我参与A项目交付。我的具体职责是【待补充：个人职责】。",
      revisionNotes: ["先给已知经历，再标出事实缺口"], missingFacts: ["个人职责"], supportingEvidence: [{ source: "resume", quote: "参与A项目交付。" }] }));
    const harness = await mountInterviews();
    await startAnalysis();
    expect(screen.getByText("优化参考回答")).toBeTruthy();
    expect(currentInterview(harness.current()).questionAnswers?.["q-A"]).toBe("A原答案");
    expect(currentInterview(harness.current()).interviewFeedback?.["q-A"]?.referenceAnswer).toContain("【待补充");
    await act(async () => harness.current().flush());
    const stored = await harness.repository.loadWorkspace();
    expect((stored?.sessions[0] as InterviewSession).interviewFeedback?.["q-A"]?.answerSnapshot).toBe("A原答案");
  });
  it("更新旧题保留已作答题目及答案", async () => {
    const harness = await mountInterviews();
    fireEvent.click(screen.getByText("更新未作答的旧题"));
    expect(currentInterview(harness.current()).interviewQuestions?.some((item) => item.id === "q-A")).toBe(true);
    expect(currentInterview(harness.current()).questionAnswers?.["q-A"]).toBe("A原答案");
  });
});
