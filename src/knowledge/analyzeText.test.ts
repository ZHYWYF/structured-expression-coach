import { describe, expect, it } from "vitest";

import { analyzeText, knowledgeBaseStats, localKnowledgeBase, localKnowledgeRulePacks } from "./index";

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

  it("adds local structural and evidence findings without an AI request", () => {
    const text = "这个季度我们推进了多个项目，完成了相关工作。后续继续优化。";
    const ruleIds = analyzeText(text, "report").map((finding) => finding.ruleId);

    expect(ruleIds).toContain("RPT-001");
    expect(ruleIds).toContain("GEN-017");
    expect(ruleIds).toContain("RPT-006");
  });

  it("detects long sentences and repeated connectors", () => {
    const text = `我们先完成需求分析然后推进设计然后组织评审然后协调开发和测试，${"并持续处理上线问题".repeat(4)}。`;
    const ruleIds = analyzeText(text, "retrospective").map((finding) => finding.ruleId);

    expect(ruleIds).toContain("GEN-016");
    expect(ruleIds).toContain("GEN-015");
  });

  it("tracks the hybrid local runtime catalog", () => {
    expect(localKnowledgeBase.lexicalRules).toHaveLength(16);
    expect(localKnowledgeBase.advisoryRuleCatalog.structural).toHaveLength(18);
    expect(localKnowledgeBase.advisoryRuleCatalog.semantic).toHaveLength(30);
    expect(localKnowledgeBase.runtime.mode).toBe("hybrid_local");
    expect(localKnowledgeBase.runtime.executableRuleCount).toBe(65);
    expect(knowledgeBaseStats).toEqual({ lexicalRuleCount: 57, lexicalPatternCount: 227, heuristicRuleCount: 8, executableRuleCount: 65, advisoryRuleCount: 48 });
    expect(localKnowledgeBase.runtime.disabledPendingDictionaryCandidates).toBe(
      321,
    );
  });

  it("runs generated scenario-specific knowledge rules", () => {
    expect(analyzeText("我们完成了项目，学到了很多。", "interview").map((item) => item.ruleId)).toEqual(expect.arrayContaining(["INT-021", "INT-023"]));
    expect(analyzeText("项目进展顺利，目前没有风险。", "report").map((item) => item.ruleId)).toEqual(expect.arrayContaining(["RPT-011", "RPT-013"]));
    expect(analyzeText("主要原因是沟通不到位，下次注意。", "retrospective").map((item) => item.ruleId)).toEqual(expect.arrayContaining(["RET-011", "RET-012"]));
  });

  it("runs the second generated knowledge pack across all coaching scenarios", () => {
    expect(analyzeText("我性格开朗，负责相关工作，最后获得一致认可。", "interview").map((item) => item.ruleId)).toEqual(expect.arrayContaining(["INT-025", "INT-026", "INT-027"]));
    expect(analyzeText("项目基本完成，但遇到一些问题，需要领导拍板。", "report").map((item) => item.ruleId)).toEqual(expect.arrayContaining(["RPT-015", "RPT-016", "RPT-017"]));
    expect(analyzeText("需求总是变，以后不会了，我们要更加重视。", "retrospective").map((item) => item.ruleId)).toEqual(expect.arrayContaining(["RET-013", "RET-015", "RET-016"]));
  });

  it("keeps every executable knowledge rule identifiable and usable", () => {
    const rules = localKnowledgeRulePacks.flat();
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
    for (const rule of rules) {
      expect(rule.patterns.length).toBeGreaterThan(0);
      expect(rule.patterns.every((pattern) => pattern.trim().length >= 1)).toBe(true);
      expect(rule.scenarios.length).toBeGreaterThan(0);
      expect(rule.reason.trim()).not.toBe("");
      expect(rule.suggestion.trim()).not.toBe("");
    }
  });
});
