import { describe, expect, it } from "vitest";

import { analyzeText, localKnowledgeBase } from "./index";

describe("analyzeText", () => {
  it("returns lexical findings with source details and exact ranges", () => {
    const text = "最近我处理了一下很多相关工作。";

    const findings = analyzeText(text, "report");

    expect(findings.map((finding) => finding.matchedText)).toEqual([
      "最近",
      "处理了一下",
      "很多",
      "相关工作",
    ]);
    expect(findings[1]).toEqual({
      range: {
        start: text.indexOf("处理了一下"),
        end: text.indexOf("处理了一下") + "处理了一下".length,
      },
      matchedText: "处理了一下",
      issueType: "泛化动作词",
      reason: "泛化动作词无法说明具体采取了什么行动。",
      suggestion: "替换为可观察的动作，例如分析、设计、协调、验证、上线。",
      replacements: ["分析", "设计", "协调", "验证", "上线"],
      ruleId: "GEN-003",
      source: {
        type: "ai_generated",
        ref: "产品规则/动作具体性",
        reviewStatus: "sample_review",
      },
    });
  });

  it("isolates scenario-specific rules", () => {
    const text = "贵公司平台很好，我想学习成长。";

    expect(analyzeText(text, "general")).toEqual([]);
    expect(
      analyzeText(text, "interview").map((finding) => finding.ruleId),
    ).toEqual(["INT-003", "INT-003"]);
  });

  it("resolves overlapping occurrences without duplicate positions", () => {
    expect(analyzeText("嗯嗯嗯", "general")).toEqual([
      expect.objectContaining({
        range: { start: 0, end: 2 },
        matchedText: "嗯嗯",
        ruleId: "GEN-001",
      }),
    ]);
  });

  it("keeps separate non-overlapping occurrences of the same rule", () => {
    const text = "最近完成了复盘，最近开始整理行动项。";

    expect(
      analyzeText(text, "report")
        .filter((finding) => finding.matchedText === "最近")
        .map((finding) => finding.range),
    ).toEqual([
      { start: 0, end: 2 },
      { start: text.lastIndexOf("最近"), end: text.lastIndexOf("最近") + 2 },
    ]);
  });

  it("reports UTF-16 code-unit offsets for text containing emoji", () => {
    const text = "🎯最近完成了三个里程碑。";

    expect(analyzeText(text, "report")[0]).toEqual(
      expect.objectContaining({
        matchedText: "最近",
        range: { start: 2, end: 4 },
      }),
    );
  });

  it("returns no findings when no lexical rule matches", () => {
    expect(analyzeText("本周完成三个里程碑。", "report")).toEqual([]);
    expect(analyzeText("", "general")).toEqual([]);
  });

  it("keeps structural and semantic rules metadata-only", () => {
    expect(localKnowledgeBase.lexicalRules).toHaveLength(16);
    expect(localKnowledgeBase.advisoryRuleCatalog.structural).toHaveLength(18);
    expect(localKnowledgeBase.advisoryRuleCatalog.semantic).toHaveLength(30);
    expect(localKnowledgeBase.runtime.disabledPendingDictionaryCandidates).toBe(
      321,
    );
    expect(
      localKnowledgeBase.lexicalRules.some((rule) =>
        rule.id.startsWith("IMP-"),
      ),
    ).toBe(false);
  });
});
