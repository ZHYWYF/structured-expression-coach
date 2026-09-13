import { describe, expect, it } from "vitest";
import { coachingCards, collectContextualFindings, retrieveCoachingKnowledge } from "./coachingKnowledge";

describe("上下文知识规则", () => {
  it.each(coachingCards)("$id：命中缺口，已给出依据时免于重复提醒", (card) => {
    const scenario = card.scenarios[0];
    expect(collectContextualFindings(card.positive, scenario).some((item) => item.ruleId === card.id)).toBe(true);
    expect(collectContextualFindings(card.negative, scenario).some((item) => item.ruleId === card.id)).toBe(false);
  });
  it("规则编号唯一、场景隔离、引用范围对应原文", () => {
    expect(new Set(coachingCards.map((item) => item.id)).size).toBe(24);
    for (const card of coachingCards) {
      for (const finding of collectContextualFindings(card.positive, card.scenarios[0])) expect(card.positive.slice(finding.range.start, finding.range.end)).toBe(finding.matchedText);
      if (!card.scenarios.includes("general")) expect(collectContextualFindings(card.positive, "general").some((item) => item.ruleId === card.id)).toBe(false);
    }
  });
  it("只检索少量相关知识且不混入其他专属场景", () => {
    const context = retrieveCoachingKnowledge("我们项目预计延期。", "report");
    expect(context.split("\n")).toHaveLength(8);
    expect(context).toContain("CTX-R02");
    expect(context).not.toContain("CTX-I");
    expect(context).not.toContain("CTX-T");
  });
});
