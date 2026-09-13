import { describe, expect, it } from "vitest";
import publicKnowledge from "../../public/knowledge/local-knowledge.json";

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
    expect(localKnowledgeBase.runtime.executableRuleCount).toBe(89);
    expect(knowledgeBaseStats).toEqual({ lexicalRuleCount: 57, lexicalPatternCount: 227, heuristicRuleCount: 32, executableRuleCount: 89, advisoryRuleCount: 48 });
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

  it.each([
    ["进行一个沟通", "沟通"],
    ["进行一个确认", "确认"],
    ["做一个处理", "处理"],
  ])("精简%s时首选替换保留动作%s", (phrase, action) => {
    const text = `我与客户${phrase}。`;
    const finding = analyzeText(text, "report").find((item) => item.ruleId === "GEN-032");
    expect(finding).toBeDefined();
    expect(finding?.matchedText).toBe(phrase);
    expect(finding?.replacements[0]).toBe(action);
    const accepted = text.slice(0, finding!.range.start) + finding!.replacements[0] + text.slice(finding!.range.end);
    expect(accepted).toBe(`我与客户${action}。`);
  });

  it("金额额外配额名额中的额不被当作填充词", () => {
    const texts = ["合同金额为三万元。", "无需额外处理。", "配额已分配。", "招聘名额为三人。"];
    expect(texts.map((text) => analyzeText(text, "report").filter((item) => item.ruleId === "GEN-001"))).toEqual([[], [], [], []]);
  });

  it("独立填充词仍能定位且不改动原文", () => {
    const text = "额，我来说明。呃，请看数据。";
    const fillers = analyzeText(text, "general").filter((item) => item.ruleId === "GEN-001");
    expect(fillers.map((item) => item.matchedText)).toEqual(["额", "呃"]);
    for (const item of fillers) expect(text.slice(item.range.start, item.range.end)).toBe(item.matchedText);
    expect(text).toBe("额，我来说明。呃，请看数据。");
  });

  it("真实知识库千字分析的热运行P95低于100ms且结果稳定", () => {
    const text = "本周我完成三个里程碑，验收通过率提升至95%。下一步由我在周五前完成上线验证。".repeat(30);
    const expected = analyzeText(text, "report");
    const durations: number[] = [];
    for (let run = 0; run < 20; run += 1) {
      const start = performance.now();
      const actual = analyzeText(text, "report");
      durations.push(performance.now() - start);
      expect(actual).toEqual(expected);
    }
    const p95 = [...durations].sort((left, right) => left - right)[18];
    console.info(`本地文字分析：${text.length}字，20次热运行P95=${p95.toFixed(2)}ms`);
    expect(p95, `字符数=${text.length}，热运行P95=${p95.toFixed(2)}ms`).toBeLessThan(100);
  });

  it("public发布的基础规则与运行时基础规则一致", () => {
    expect(publicKnowledge.lexicalRules).toEqual(localKnowledgeRulePacks[0]);
    expect(publicKnowledge.packVersion).toBe(localKnowledgeBase.packVersion);
  });

  it("上下文给出量化和个人分工时不机械报错", () => {
    expect(analyzeText("很多（20位）用户参与了访谈。", "general").some((item) => item.ruleId === "GEN-004")).toBe(false);
    const text = "我们完成了项目。我负责方案设计与上线验证，研发负责实现，分工明确。";
    expect(analyzeText(text, "interview").some((item) => item.ruleId === "INT-021")).toBe(false);
    expect(analyzeText("不能认为肯定是系统的问题。", "general").some((item) => item.ruleId === "GEN-010")).toBe(false);
  });

  it("新上下文规则参与真实分析入口且保留原文", () => {
    const text = "本周项目预计延期，接口仍未完成。";
    expect(analyzeText(text, "report")).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: "CTX-R02", replacements: [] })]));
    expect(text).toBe("本周项目预计延期，接口仍未完成。");
  });
});
