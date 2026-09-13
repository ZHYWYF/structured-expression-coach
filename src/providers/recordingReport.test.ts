import { describe, expect, it } from "vitest";
import type { Report, ScoreDimension } from "../core/types";
import { parseRecordingReport, readReportEvidence } from "./recordingReport";

const transcript = "我参与整理了资料。结果可能需要再核实。";
const goal = "首要目标：补齐证据\n练习方法：重述结论并标记待核实内容\n完成标准：指出一条依据及一项未知信息";
const strength = "原文：我参与整理了资料。\n亮点：清楚说明了实际贡献。";
const improvement = "原文：结果可能需要再核实。\n问题：结论缺少依据\n建议：结果可能需要核实【待补充：验证记录】\n原因：保留合理不确定性并补齐证据。";

function validReport(): Omit<Report, "id" | "sessionId" | "generatedAt"> {
  return { title: "表达练习报告", overallScore: 75,
    dimensions: (["structure", "clarity", "evidence", "brevity", "confidence"] as ScoreDimension["key"][])
      .map((key) => ({ key, label: key, score: 75, summary: "依据当前文字；无法评价声音表现。" })),
    strengths: [strength], improvements: [improvement], actionItems: [goal] };
}

describe("readReportEvidence", () => {
  it("读取亮点及多行局部改法，统一CRLF并保留逐字引用", () => {
    expect(readReportEvidence(strength.replaceAll("\n", "\r\n"), "strength")).toEqual({ quote: "我参与整理了资料。", strength: "清楚说明了实际贡献。" });
    expect(readReportEvidence(improvement.replace("结果可能需要核实【待补充：验证记录】", "结果可能需要核实\n【待补充：验证记录】"), "improvement"))
      .toEqual({ quote: "结果可能需要再核实。", problem: "结论缺少依据", suggestion: "结果可能需要核实\n【待补充：验证记录】", reason: "保留合理不确定性并补齐证据。" });
  });

  it("旧纯文本及缺少原因或亮点的条目返回空以供旧报告直接展示", () => {
    expect(readReportEvidence("先说结论，再补充证据", "improvement")).toBeNull();
    expect(readReportEvidence("原文：原句\n问题：问题\n建议：建议", "improvement")).toBeNull();
    expect(readReportEvidence("原文：原句\n亮点：  ", "strength")).toBeNull();
  });
});

describe("parseRecordingReport", () => {
  it("接受有据报告并仅返回原有Report字段及字符串数组", () => {
    const report = validReport();
    const parsed = parseRecordingReport(JSON.stringify({ ...report, title: ` ${report.title} `, injected: "不应保存" }), transcript);
    expect(parsed).toEqual(report);
    expect([parsed.strengths, parsed.improvements, parsed.actionItems].every((items) => items.every((item) => typeof item === "string"))).toBe(true);
    expect(parsed.actionItems).toHaveLength(1);
  });

  it("兼容JSON围栏及CRLF；材料不足时允许空亮点和改进列表", () => {
    const report = validReport();
    report.overallScore = 0;
    report.dimensions = report.dimensions.map((item) => ({ ...item, score: 0, summary: "信息不足：需补充完整表达" }));
    report.strengths = []; report.improvements = []; report.actionItems = [goal.replaceAll("\n", "\r\n")];
    expect(parseRecordingReport(`\n\u0060\u0060\u0060json\n${JSON.stringify(report)}\n\u0060\u0060\u0060`, "")).toEqual(report);
  });

  it.each(["不是JSON", "null", "[]"])("拒绝无法作为报告对象的输入：%s", (content) => {
    expect(() => parseRecordingReport(content, transcript)).toThrow(/JSON|格式/);
  });

  it.each([
    ["缺少维度", (r: ReturnType<typeof validReport>) => { r.dimensions.pop(); }],
    ["重复维度", (r: ReturnType<typeof validReport>) => { r.dimensions[1].key = r.dimensions[0].key; }],
    ["总分超过范围", (r: ReturnType<typeof validReport>) => { r.overallScore = 101; }],
    ["维度分数低于范围", (r: ReturnType<typeof validReport>) => { r.dimensions[0].score = -1; }],
    ["维度说明为空", (r: ReturnType<typeof validReport>) => { r.dimensions[0].summary = " "; }],
    ["标题为空", (r: ReturnType<typeof validReport>) => { r.title = " "; }],
  ] as const)("拒绝破坏评分结构的报告：%s", (_, change) => {
    const report = validReport(); change(report);
    expect(() => parseRecordingReport(JSON.stringify(report), transcript)).toThrow("五个评价维度");
  });

  it.each(["strengths", "improvements"] as const)("拒绝%s中不存在于当前逐字稿的引用", (field) => {
    const report = validReport();
    report[field] = [report[field][0].replace(field === "strengths" ? "我参与整理了资料。" : "结果可能需要再核实。", "其他会话的训练目标")];
    expect(() => parseRecordingReport(JSON.stringify(report), transcript)).toThrow("不存在的内容");
  });

  it.each(["我参与…资料。", "我主导整理了资料。", "我参与整理了资料！"])("拒绝拼接或改写的原文引用：%s", (quote) => {
    const report = validReport(); report.strengths = [`原文：${quote}\n亮点：保留表达`];
    expect(() => parseRecordingReport(JSON.stringify(report), transcript)).toThrow("不存在的内容");
  });

  it("拒绝把对象或旧纯文本用作新报告的证据条目", () => {
    expect(() => parseRecordingReport(JSON.stringify({ ...validReport(), strengths: [{ quote: transcript, strength: "清楚" }] }), transcript)).toThrow("五个评价维度");
    expect(() => parseRecordingReport(JSON.stringify({ ...validReport(), strengths: ["结论明确"] }), transcript)).toThrow("缺少原句");
  });

  it.each(["strengths", "improvements"] as const)("拒绝%s同一列表重复引用", (field) => {
    const report = validReport(); report[field].push(report[field][0]);
    expect(() => parseRecordingReport(JSON.stringify(report), transcript)).toThrow("重复条目");
  });

  it("引用允许240字但拒绝241字和超出列表数量上限", () => {
    const report = validReport(); report.improvements = [];
    report.strengths = [`原文：${"字".repeat(240)}\n亮点：表意清楚`];
    expect(parseRecordingReport(JSON.stringify(report), "字".repeat(241)).strengths).toEqual(report.strengths);
    report.strengths = [`原文：${"字".repeat(241)}\n亮点：表意清楚`];
    expect(() => parseRecordingReport(JSON.stringify(report), "字".repeat(241))).toThrow("缺少原句");
    expect(() => parseRecordingReport(JSON.stringify({ ...validReport(), strengths: Array(4).fill(strength) }), transcript)).toThrow("五个评价维度");
    expect(() => parseRecordingReport(JSON.stringify({ ...validReport(), improvements: Array(7).fill(improvement) }), transcript)).toThrow("五个评价维度");
  });

  it.each([{ label: "零个", actionItems: [] }, { label: "两个", actionItems: [goal, goal] }])("拒绝$label 下一次目标", ({ actionItems }) => {
    expect(() => parseRecordingReport(JSON.stringify({ ...validReport(), actionItems }), transcript)).toThrow("一个优先练习目标");
  });

  it("拒绝没有练习方法或完成标准的目标", () => {
    expect(() => parseRecordingReport(JSON.stringify({ ...validReport(), actionItems: ["首要目标：补证据\n练习方法：重述"] }), transcript)).toThrow("练习方法或完成标准");
  });

  it.each(["首要目标", "练习方法"])("拒绝%s仅有空白字符的练习安排", (field) => {
    const actionItems = [goal.replace(new RegExp(`${field}：[^\\n]+`), `${field}：  `)];
    expect(() => parseRecordingReport(JSON.stringify({ ...validReport(), actionItems }), transcript)).toThrow();
  });
});
