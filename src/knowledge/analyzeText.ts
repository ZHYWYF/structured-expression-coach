import knowledgeBaseJson from "./data/local-knowledge.json";

import type {
  AnalysisFinding,
  KnowledgeScenario,
  LexicalKnowledgeRule,
  LocalKnowledgeBase,
} from "./types";

interface MatchCandidate extends AnalysisFinding {
  priority: number;
}

export const localKnowledgeBase = knowledgeBaseJson as LocalKnowledgeBase;

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
    if (!selected.some((existing) => overlaps(existing, candidate))) {
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
 * Runs deterministic exact lexical matching against the embedded local pack.
 * Structural and semantic catalog entries are intentionally not evaluated.
 */
export function analyzeText(
  text: string,
  scenario: KnowledgeScenario,
): AnalysisFinding[] {
  if (text.length === 0) {
    return [];
  }

  return resolveOverlaps(
    collectMatches(text, scenario, localKnowledgeBase.lexicalRules),
  );
}
