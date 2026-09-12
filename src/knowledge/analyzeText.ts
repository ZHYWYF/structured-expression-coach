import knowledgeBaseJson from "./data/local-knowledge.json";
import generatedKnowledgeJson from "./data/generated-v1.json";

import type {
  AnalysisFinding,
  KnowledgeScenario,
  LexicalKnowledgeRule,
  LocalKnowledgeBase,
} from "./types";

interface MatchCandidate extends AnalysisFinding {
  priority: number;
}

const conclusionSignals = /(?:结论|结果|核心|重点|总体|本周|目前|当前|建议|需要|风险)/;
const evidenceSignals = /(?:\d|百分之|数据|指标|用户|客户|反馈|测试|验证|调研|日志|样本|同比|环比)/;
const resultVerbs = /(?:完成|提升|增长|降低|减少|优化|改善|上线|交付|解决|达成)/;
const actionSignals = /(?:下一步|后续|计划|将会|准备|持续|继续)/;
const timeSignals = /(?:今天|明天|本周|下周|本月|月底|季度|\d{1,2}[月日号]|周[一二三四五六日天]|前完成|截止)/;
const ownerSignals = /(?:我|我们|负责人|产品|研发|设计|运营|销售|团队|同学|部门)/;
const verificationSignals = /(?:验收|验证|复测|检查|监控|指标|标准|完成率|通过率)/;

function documentFinding(
  text: string,
  ruleId: string,
  issueType: string,
  reason: string,
  suggestion: string,
  priority: number,
  sourceRef: string,
): MatchCandidate {
  return {
    range: { start: text.length, end: text.length },
    matchedText: "整体表达",
    issueType,
    reason,
    suggestion,
    replacements: [],
    ruleId,
    source: { type: "ai_generated", ref: sourceRef, reviewStatus: "sample_review" },
    priority,
    scope: "document",
  };
}

function spanFinding(
  text: string,
  pattern: RegExp,
  ruleId: string,
  issueType: string,
  reason: string,
  suggestion: string,
  priority: number,
  sourceRef: string,
): MatchCandidate | null {
  const match = pattern.exec(text);
  if (!match || match.index < 0 || !match[0]) return null;
  return {
    range: { start: match.index, end: match.index + match[0].length },
    matchedText: match[0],
    issueType,
    reason,
    suggestion,
    replacements: [],
    ruleId,
    source: { type: "ai_generated", ref: sourceRef, reviewStatus: "sample_review" },
    priority,
    scope: "span",
  };
}

function collectHeuristicMatches(text: string, scenario: KnowledgeScenario): MatchCandidate[] {
  const findings: MatchCandidate[] = [];
  const trimmed = text.trim();
  if (trimmed.length < 12) return findings;

  const sentences = trimmed.split(/[。！？!?；;\n]+/).map((item) => item.trim()).filter(Boolean);
  const actionSentence = sentences.find((sentence) => actionSignals.test(sentence)) ?? "";
  const longSentence = sentences.find((sentence) => sentence.length >= 55);
  if (longSentence) {
    const start = text.indexOf(longSentence);
    const anchorLength = Math.min(12, longSentence.length);
    findings.push({
      range: { start, end: start + anchorLength },
      matchedText: longSentence.slice(0, anchorLength),
      issueType: "一句承载过多信息",
      reason: "单句信息过多会增加听者记忆和理解负担。",
      suggestion: "拆成“结论—依据—行动”三句，每句只承载一个核心信息。",
      replacements: [],
      ruleId: "GEN-016",
      source: { type: "ai_generated", ref: "产品规则/句子负荷", reviewStatus: "sample_review" },
      priority: 72,
      scope: "span",
    });
  }

  const weakSubject = spanFinding(
    text,
    /(?:^|[。！？!?；;\n])\s*(完成了?|推进了?|优化了?|处理了?|解决了?|上线了?)/,
    "GEN-020",
    "行动主体缺失",
    "听者无法判断是谁承担了关键动作。",
    "补充明确主体，例如“我负责”“产品团队完成”“我们与研发共同推进”。",
    80,
    "产品规则/责任主体",
  );
  if (weakSubject) findings.push(weakSubject);

  if (trimmed.length >= 24 && resultVerbs.test(trimmed) && !evidenceSignals.test(trimmed)) {
    findings.push(documentFinding(
      text,
      "GEN-017",
      "观点或结果缺少依据",
      "结果判断没有事实、数据或反馈支撑，可信度有限。",
      "补充一个可核验依据：数字变化、用户反馈、测试结果或具体案例。",
      92,
      "产品规则/证据强度",
    ));
  }

  const repeatedConnector = (() => {
    const matches = [...text.matchAll(/然后|所以|但是|其实|就是/g)];
    if (matches.length < 3) return null;
    const repeated = matches.find((item, index) => index > 0 && item[0] === matches[index - 1][0]);
    const target = repeated ?? matches[2];
    return target.index === undefined ? null : {
      range: { start: target.index, end: target.index + target[0].length },
      matchedText: target[0],
      issueType: "连接词重复",
      reason: "连续使用同一连接词会掩盖信息之间的真实关系。",
      suggestion: "明确这里是因果、转折、递进还是时间顺序，再选择连接方式或直接分句。",
      replacements: [],
      ruleId: "GEN-015",
      source: { type: "ai_generated" as const, ref: "产品规则/逻辑关系", reviewStatus: "sample_review" as const },
      priority: 88,
      scope: "span" as const,
    };
  })();
  if (repeatedConnector) findings.push(repeatedConnector);

  if (scenario === "report") {
    const opening = sentences[0] ?? "";
    if (trimmed.length >= 24 && !conclusionSignals.test(opening.slice(0, 35))) {
      findings.push(documentFinding(
        text,
        "RPT-001",
        "缺少结论摘要",
        "开头没有先交代结果、重点或需要的决策，听者需要自行提炼。",
        "第一句先给结论：当前结果是什么、最大风险是什么、需要对方做什么。",
        98,
        "产品规则/汇报结论",
      ));
    }
    if (actionSentence && (!timeSignals.test(actionSentence) || !ownerSignals.test(actionSentence))) {
      const action = spanFinding(
        text,
        actionSignals,
        "RPT-006",
        "下一步缺少负责人或时间",
        "行动项缺少负责人或时间节点，难以跟进和验收。",
        "补齐“谁—在什么时间前—完成什么—如何确认完成”。",
        96,
        "产品规则/行动闭环",
      );
      if (action) findings.push(action);
    }
  }

  if (scenario === "retrospective") {
    if (trimmed.length >= 24 && /(?:问题|故障|失败|延期|下降|异常)/.test(trimmed) && !/(?:因为|原因|根因|导致|由于)/.test(trimmed)) {
      findings.push(documentFinding(
        text,
        "RET-003",
        "现象尚未下钻到原因",
        "当前描述停留在发生了什么，还没有说明为什么发生。",
        "补充直接原因、系统性原因和对应证据，避免把现象本身当作根因。",
        98,
        "产品规则/根因分析",
      ));
    }
    if (actionSentence && !verificationSignals.test(actionSentence)) {
      const action = spanFinding(
        text,
        actionSignals,
        "RET-007",
        "行动缺少验证方式",
        "改进动作没有成功标准，后续无法判断是否真正解决问题。",
        "为行动补充验收指标、复查时间和失败后的升级措施。",
        95,
        "产品规则/行动验证",
      );
      if (action) findings.push(action);
    }
  }

  return findings;
}

export const localKnowledgeBase = knowledgeBaseJson as LocalKnowledgeBase;
const generatedLexicalRules = (generatedKnowledgeJson as { lexicalRules: LexicalKnowledgeRule[] }).lexicalRules;

function collectMatches(
  text: string,
  scenario: KnowledgeScenario,
  rules: LexicalKnowledgeRule[],
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];

  for (const rule of rules) {
    if (!rule.scenarios.includes(scenario)) {
      continue;
    }

    for (const pattern of new Set(rule.patterns)) {
      if (pattern.length === 0) {
        continue;
      }

      let start = text.indexOf(pattern);
      while (start !== -1) {
        candidates.push({
          range: { start, end: start + pattern.length },
          matchedText: pattern,
          issueType: rule.issueType,
          reason: rule.reason,
          suggestion: rule.suggestion,
          replacements: [...rule.replacements],
          ruleId: rule.id,
          source: {
            type: rule.sourceType,
            ref: rule.sourceRef,
            reviewStatus: rule.reviewStatus,
          },
          priority: rule.priority,
        });

        start = text.indexOf(pattern, start + 1);
      }
    }
  }

  return candidates;
}

function overlaps(left: MatchCandidate, right: MatchCandidate): boolean {
  return left.range.start < right.range.end && right.range.start < left.range.end;
}

function resolveOverlaps(candidates: MatchCandidate[]): AnalysisFinding[] {
  const selected: MatchCandidate[] = [];

  const ranked = [...candidates].sort((left, right) => {
    const lengthDifference =
      right.range.end - right.range.start - (left.range.end - left.range.start);

    return (
      lengthDifference ||
      right.priority - left.priority ||
      left.range.start - right.range.start ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.matchedText.localeCompare(right.matchedText)
    );
  });

  for (const candidate of ranked) {
    if (candidate.scope === "document" || !selected.some((existing) => existing.scope !== "document" && overlaps(existing, candidate))) {
      selected.push(candidate);
    }
  }

  return selected
    .sort(
      (left, right) =>
        left.range.start - right.range.start ||
        right.range.end - left.range.end ||
        right.priority - left.priority ||
        left.ruleId.localeCompare(right.ruleId),
    )
    .map(({ priority: _priority, ...finding }) => finding);
}

/**
 * Runs deterministic lexical and lightweight structural analysis locally.
 * It deliberately avoids network calls so feedback can update on every edit.
 */
export function analyzeText(
  text: string,
  scenario: KnowledgeScenario,
): AnalysisFinding[] {
  if (text.length === 0) {
    return [];
  }

  return resolveOverlaps(
    [
      ...collectMatches(text, scenario, [...localKnowledgeBase.lexicalRules, ...generatedLexicalRules]),
      ...collectHeuristicMatches(text, scenario),
    ],
  );
}
