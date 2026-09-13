import { describe, expect, it } from "vitest";
import { reportHasUsableScore } from "./reportScore";
import type { Report } from "./types";

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "report-score", sessionId: "score-session", title: "练习报告", overallScore: 0,
    dimensions: [
      { key: "structure", label: "结构", score: 0, summary: "原文没有明确的结论。" },
      { key: "clarity", label: "清晰度", score: 0, summary: "原文的指代无法对应到具体事项。" },
      { key: "evidence", label: "证据", score: 0, summary: "原文的判断没有给出依据。" },
      { key: "brevity", label: "简洁度", score: 0, summary: "原文重复同一句话。" },
      { key: "confidence", label: "自信感", score: 0, summary: "原文反复否定自己的明确结论。" },
    ],
    strengths: [], improvements: [], actionItems: [], generatedAt: "2026-09-13T08:00:00.000Z",
    ...overrides,
  };
}

describe("reportHasUsableScore", () => {
  it.each(["", " \t\n"])("五个维度均信息不足时不评分，忽略摘要前导空白 %j", (prefix) => {
    const insufficient = report();
    insufficient.dimensions = insufficient.dimensions.map((dimension) => ({
      ...dimension, summary: `${prefix}信息不足：需要补充完整表达后再评价。`,
    }));

    expect(reportHasUsableScore(insufficient)).toBe(false);
  });

  it.each([0, 82])("保留有评价依据的真实 %i 分", (score) => {
    const scored = report({ overallScore: score });
    scored.dimensions = scored.dimensions.map((dimension) => ({ ...dimension, score }));

    expect(reportHasUsableScore(scored)).toBe(true);
  });

  it.each([0, 4])("第 %i 个维度有依据时，其他维度信息不足不使整份报告失效", (usableIndex) => {
    const mixed = report({ overallScore: 16 });
    mixed.dimensions = mixed.dimensions.map((dimension, index) => index === usableIndex
      ? { ...dimension, score: 80, summary: "原文给出了明确的结论和依据。" }
      : { ...dimension, summary: "信息不足：当前材料无法评价此维度。" });

    expect(reportHasUsableScore(mixed)).toBe(true);
  });

  it.each([0, 72])("旧报告维度为空时保留已存储的 %i 分", (overallScore) => {
    expect(reportHasUsableScore(report({ dimensions: [], overallScore }))).toBe(true);
  });
});
