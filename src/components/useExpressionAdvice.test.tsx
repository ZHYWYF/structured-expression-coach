// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createController } from "../test/createController";
import type { PracticeSession } from "../core/types";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../providers/openAiCompatible", () => ({ requestChatCompletion: mocks.request }));
import { useExpressionAdvice } from "./useExpressionAdvice";
import { adviceToFeedback } from "../providers/expressionAdvice";

const text = "项目预计延期，目前还在等待接口确认。";
const reply = JSON.stringify({ suggestions: [{ quote: "项目预计延期", issueType: "影响", reason: "影响未说明", suggestion: "补充影响范围" }] });
const session: PracticeSession = { id: "one", kind: "practice", title: "汇报", scenarioId: "scenario-weekly-report", status: "draft", draftText: text, statements: [], messages: [], feedback: [], materials: [], recordingTaskIds: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" };
function setup(seed = session) {
  const controller = createController({ sessions: [seed], selectedSessionId: seed.id, selectedSession: seed });
  controller.preferences.aiProvider = { name: "provider", enabled: true, model: "model", baseUrl: "https://example.test" };
  controller.getSnapshot = () => controller;
  const hook = renderHook(({ current, value }: { current: PracticeSession; value: string }) => useExpressionAdvice(controller, current, value, "report", []), { initialProps: { current: seed, value: seed.draftText } });
  return { ...hook, controller };
}
describe("会话AI分析调度", () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.request.mockReset(); mocks.request.mockResolvedValue(reply); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it("默认不开启；启用后一次分析保存到原会话", async () => {
    const { result, controller } = setup();
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(mocks.request).not.toHaveBeenCalled();
    act(() => result.current.toggle(true));
    await act(async () => vi.advanceTimersByTimeAsync(900));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(result.current.findings).toHaveLength(1);
    expect(controller.updateSession).toHaveBeenCalledWith("one", expect.any(Function));
  });
  it("编辑时取消旧请求，迟到内容不保存，新请求至少间隔15秒", async () => {
    let resolve!: (value: string) => void;
    mocks.request.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const { result, rerender, controller } = setup();
    act(() => result.current.toggle(true));
    await act(async () => vi.advanceTimersByTimeAsync(900));
    const signal = mocks.request.mock.calls[0][2].signal as AbortSignal;
    const next = { ...session, draftText: `${text}新的内容需要保护。` };
    controller.sessions = [next];
    rerender({ current: next, value: next.draftText });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(reply));
    expect(controller.updateSession).not.toHaveBeenCalled();
    expect(result.current.findings).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("切换会话自动关闭并取消旧请求", async () => {
    let resolve!: (value: string) => void;
    mocks.request.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
    const { result, rerender, controller } = setup();
    act(() => result.current.toggle(true));
    await act(async () => vi.advanceTimersByTimeAsync(900));
    const next = { ...session, id: "two" };
    controller.sessions = [session, next];
    rerender({ current: next, value: text });
    await act(async () => resolve(reply));
    expect(result.current.enabled).toBe(false);
    expect(result.current.findings).toEqual([]);
    expect(controller.updateSession).not.toHaveBeenCalled();
  });
  it("缓存空结果也不重复请求，超长文本不截断发送", async () => {
    const cached = { ...session, feedback: [adviceToFeedback(session.id, text, "report", [], "model")] };
    const { result, rerender } = setup(cached);
    act(() => result.current.toggle(true));
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(mocks.request).not.toHaveBeenCalled();
    const long = "表达内容".repeat(4000);
    rerender({ current: { ...session, draftText: long }, value: long });
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result.current.message).toContain("未截断");
  });
});
