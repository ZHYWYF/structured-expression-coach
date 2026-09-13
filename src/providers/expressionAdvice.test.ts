import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./openAiCompatible", () => ({ requestChatCompletion: mocks.request }));
import { adviceToFeedback, buildExpressionAdvicePrompt, feedbackToAdvice, parseExpressionAdvice, requestExpressionAdvice } from "./expressionAdvice";

const text = "项目预计延期，目前还在等待接口确认。";
const response = JSON.stringify({ suggestions: [{ quote: "项目预计延期", issueType: "缺少影响说明", reason: "缺少延期影响", suggestion: "补充受影响的里程碑和应对方案", replacement: "已经成功上线" }] });
describe("表达AI语义建议", () => {
  it("解析准确原文位置，但不会把模型给的替换直接应用", () => {
    const result = parseExpressionAdvice(response, text, "自选模型");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ range: { start: 0, end: 6 }, matchedText: "项目预计延期", replacements: [], source: { type: "ai_live" } });
  });
  it("拒绝不存在或无法唯一定位的引用以及错误JSON结构", () => {
    expect(() => parseExpressionAdvice(response, "这里没有那个句子", "model")).toThrow("准确引用原文");
    expect(() => parseExpressionAdvice(response, `${text}${text}`, "model")).toThrow("准确引用原文");
    expect(() => parseExpressionAdvice('{"text":"重写全文"}', text, "model")).toThrow("格式不完整");
    expect(() => parseExpressionAdvice("invalid", text, "model")).toThrow();
  });
  it("允许空建议；同条建议去重；保留HTML为普通文本", () => {
    expect(parseExpressionAdvice('{"suggestions":[]}', text, "model")).toEqual([]);
    const row = { quote: "<script>malicious</script>", issueType: "示例", reason: "检查文本", suggestion: "这是一条普通文本" };
    expect(parseExpressionAdvice(JSON.stringify({ suggestions: [row, row] }), row.quote, "model")).toHaveLength(1);
  });
  it("同一原文按场景使用不同标准，只检索少量知识", () => {
    const report = buildExpressionAdvicePrompt(text, "report", []);
    const review = buildExpressionAdvicePrompt(text, "retrospective", []);
    expect(report[0].content).toContain("风险影响");
    expect(review[0].content).toContain("根因证据");
    const payload = JSON.parse(report[1].content);
    expect(payload.text).toBe(text);
    expect(payload.knowledge.cards.split("\n")).toHaveLength(8);
  });
  it("建议保存进已有feedback结构，原文变化不能复用", () => {
    const findings = parseExpressionAdvice(response, text, "model");
    const saved = adviceToFeedback("session-a", text, "report", findings, "model");
    expect(saved.sessionId).toBe("session-a");
    expect(feedbackToAdvice(saved, text, "report")).toEqual(findings);
    expect(feedbackToAdvice(saved, `${text}新文字`, "report")).toBeNull();
    expect(feedbackToAdvice(saved, text, "retrospective")).toBeNull();
    saved.suggestions[0].status = "dismissed";
    expect(feedbackToAdvice(saved, text, "report")).toEqual([]);
  });
  it("转发取消信号与token预算，并拦截取消后仍到达的结果", async () => {
    mocks.request.mockResolvedValue(response);
    const provider = { enabled: true, model: "model", baseUrl: "https://example.test", name: "测试配置" };
    const abort = new AbortController();
    expect(await requestExpressionAdvice(provider, text, "report", [], abort.signal)).toHaveLength(1);
    expect(mocks.request).toHaveBeenCalledWith(provider, expect.any(Array), { signal: abort.signal, maxTokens: 2200 });
    abort.abort();
    await expect(requestExpressionAdvice(provider, text, "report", [], abort.signal)).rejects.toThrow();
  });
});
