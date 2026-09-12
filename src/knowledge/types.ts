export type KnowledgeScenario =
  | "general"
  | "interview"
  | "report"
  | "retrospective";

export type KnowledgeMatchType = "lexical" | "structural" | "semantic";

export type KnowledgeSeverity = "low" | "medium" | "high";

export interface KnowledgeRuleSource {
  type: "ai_generated";
  ref: string;
  reviewStatus: "sample_review";
}

export interface KnowledgeRuleBase {
  id: string;
  sourceType: "ai_generated";
  domain: KnowledgeScenario;
  category: string;
  issueType: string;
  matchType: KnowledgeMatchType;
  scenarios: KnowledgeScenario[];
  severity: KnowledgeSeverity;
  priority: number;
  sourceRef: string;
  reviewStatus: "sample_review";
  version: string;
}

export interface LexicalKnowledgeRule extends KnowledgeRuleBase {
  matchType: "lexical";
  patterns: string[];
  reason: string;
  suggestion: string;
  replacements: string[];
}

export interface AdvisoryRuleMetadata extends KnowledgeRuleBase {
  matchType: "structural" | "semantic";
}

export interface LocalKnowledgeBase {
  schemaVersion: string;
  packId: string;
  packVersion: string;
  reviewStatus: "sample_review";
  runtime: {
    mode: "lexical_exact" | "hybrid_local";
    executableRuleCount: number;
    metadataOnlyRuleCount: number;
    disabledPendingDictionaryCandidates: number;
  };
  lexicalRules: LexicalKnowledgeRule[];
  advisoryRuleCatalog: {
    description: string;
    structural: AdvisoryRuleMetadata[];
    semantic: AdvisoryRuleMetadata[];
  };
}

export interface TextRange {
  /** UTF-16 code-unit offset, matching JavaScript String indexes. */
  start: number;
  /** Exclusive UTF-16 code-unit offset. */
  end: number;
}

export interface AnalysisFinding {
  range: TextRange;
  matchedText: string;
  issueType: string;
  reason: string;
  suggestion: string;
  replacements: string[];
  ruleId: string;
  source: KnowledgeRuleSource;
  /** Document-level advice is shown in the list without forcing an in-text mark. */
  scope?: "span" | "document";
}
