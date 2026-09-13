// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Report, ScoreDimension } from "../core/types";
import { RecordingReportReview } from "./RecordingReportReview";

function report(patch: Partial<Report> = {}): Report {
  return { id: "report", sessionId: "session", title: "合成报告", generatedAt: "2026-09-01T00:00:00.000Z", overallScore: 75,
    dimensions: (["structure", "clarity", "evidence", "brevity", "confidence"] as ScoreDimension["key"][])
      .map((key) => ({ key, label: key, score: 75, summary: `${key}的文字依据` })),
    strengths: ["原文：我参与整理资料。\n亮点：准确说明个人贡献"],
    improvements: ["原文：结果可能需要核实。\n问题：缺少验证依据\n建议：结果可能需要核实【待补充：验证记录】\n原因：保持不确定性并补齐证据"],
    actionItems: ["首要目标：补齐证据\n练习方法：重述一段结论\n完成标准：说出一条依据"], ...patch };
}

afterEach(cleanup);

describe("RecordingReportReview", () => {
  it("分别展示原句、有据亮点、改法、原因及一个未采纳的练习目标", () => {
    const input = report(); const before = structuredClone(input);
    render(<RecordingReportReview report={input} />);
    const strengths = within(screen.getByRole("region", { name: "值得保留的表达" }));
    expect(strengths.getByRole("blockquote").textContent).toBe("我参与整理资料。");
    expect(strengths.getByText("准确说明个人贡献")).toBeTruthy();
    const revisions = within(screen.getByRole("region", { name: "具体修改建议" }));
    expect(revisions.getByRole("blockquote").textContent).toBe("结果可能需要核实。");
    for (const text of ["缺少验证依据", "结果可能需要核实【待补充：验证记录】", "保持不确定性并补齐证据", "尚未采纳"]) expect(revisions.getByText(text)).toBeTruthy();
    expect(screen.getByRole("region", { name: "下一次练习" }).querySelectorAll("p")).toHaveLength(1);
    expect(screen.getByText(/不会替换原文/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /采纳|替换/ })).toBeNull();
    expect(screen.getByText("训练参考分")).toBeTruthy();
    expect(input).toEqual(before);
  });

  it("旧报告字符串及多个历史行动项原样显示且不要求迁移", () => {
    const legacy = report({ strengths: ["结论清楚\n保留事实"], improvements: ["建议先说结论\n再补证据"], actionItems: ["练习开场", "复查依据", "复述结论"] });
    render(<RecordingReportReview report={legacy} />);
    expect(screen.getByRole("region", { name: "值得保留的表达" }).querySelector("p")?.textContent).toBe(legacy.strengths[0]);
    expect(screen.getByRole("region", { name: "具体修改建议" }).querySelector("p")?.textContent).toBe(legacy.improvements[0]);
    expect([...screen.getByRole("region", { name: "下一次练习" }).querySelectorAll("p")].map((node) => node.textContent)).toEqual(legacy.actionItems);
    expect(screen.queryAllByRole("blockquote")).toHaveLength(0);
  });

  it("材料不足时隐藏兼容用零分并解释没有亮点或改进项", () => {
    const input = report({ strengths: [], improvements: [], overallScore: 0 });
    input.dimensions = input.dimensions.map((dimension) => ({ ...dimension, score: 0, summary: "信息不足：请补充完整表达" }));
    render(<RecordingReportReview report={input} />);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("暂不评分")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByText(/没有足够依据提炼亮点/)).toBeTruthy();
    expect(screen.getByText(/未发现有充分依据的改进项/)).toBeTruthy();
    expect(screen.getByText("查看五项评价依据").parentElement?.querySelectorAll("strong")).toHaveLength(5);
  });

  it("部分维度信息不足时仅隐藏该维度得分并以纯文本呈现报告内容", () => {
    const input = report({ title: "<script>合成文本</script>" });
    input.dimensions[0] = { ...input.dimensions[0], score: 0, summary: "信息不足：无法评价结构" };
    const { container } = render(<RecordingReportReview report={input} />);
    expect(screen.getByText("训练参考分")).toBeTruthy();
    expect(screen.getByText("structure · 暂不评分")).toBeTruthy();
    expect(screen.getByText("clarity · 75 分")).toBeTruthy();
    expect(screen.getByRole("heading", { name: input.title })).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
  });

  it.each([
    ["空格", "   "],
    ["换行", "\n\n"],
    ["全角空白", "\u3000"],
  ])("信息不足前有%s时总分和五项维度均暂不评分", (_name, prefix) => {
    const input = report({ overallScore: 0 });
    input.dimensions = input.dimensions.map((dimension) => ({ ...dimension, score: 0, summary: `${prefix}信息不足：请补充完整表达` }));
    render(<RecordingReportReview report={input} />);

    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("暂不评分")).toBeTruthy();
    expect(screen.queryByText("训练参考分")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    for (const dimension of input.dimensions) {
      expect(screen.getByText(`${dimension.label} · 暂不评分`)).toBeTruthy();
      expect(screen.queryByText(`${dimension.label} · 0 分`)).toBeNull();
    }
  });

  it.each([
    ["空格", "   "],
    ["换行", "\n\n"],
    ["全角空白", "\u3000"],
  ])("部分维度信息不足前有%s时保留其他维度的真实零分", (_name, prefix) => {
    const input = report();
    input.dimensions[0] = { ...input.dimensions[0], score: 0, summary: `${prefix}信息不足：无法评价结构` };
    input.dimensions[1] = { ...input.dimensions[1], score: 0, summary: `${prefix}结论与依据相互矛盾，需要重新组织表达` };
    render(<RecordingReportReview report={input} />);

    expect(screen.getByText("75")).toBeTruthy();
    expect(screen.getByText("训练参考分")).toBeTruthy();
    expect(screen.getByText("structure · 暂不评分")).toBeTruthy();
    expect(screen.queryByText("structure · 0 分")).toBeNull();
    expect(screen.getByText("clarity · 0 分")).toBeTruthy();
    for (const dimension of input.dimensions.slice(2)) {
      expect(screen.getByText(`${dimension.label} · 75 分`)).toBeTruthy();
    }
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText("暂不评分")).toBeNull();
  });

  it("有评价依据时保留真实零分总分和五项维度得分", () => {
    const input = report({ overallScore: 0 });
    input.dimensions = input.dimensions.map((dimension) => ({ ...dimension, score: 0, summary: "结论与依据相互矛盾，需要重新组织表达" }));
    render(<RecordingReportReview report={input} />);

    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("训练参考分")).toBeTruthy();
    for (const dimension of input.dimensions) {
      expect(screen.getByText(`${dimension.label} · 0 分`)).toBeTruthy();
    }
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.queryByText(/暂不评分/)).toBeNull();
  });
});
