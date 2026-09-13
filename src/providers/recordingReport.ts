import type { Report, ScoreDimension } from "../core/types";

type ReportContent = Omit<Report, "id" | "sessionId" | "generatedAt">;
export type ReportEvidence = { quote: string; strength: string } | { quote: string; problem: string; suggestion: string; reason: string };

// Strings remain the persisted contract. Legacy strings are displayed as-is;
// only newly generated reports are required to contain verifiable evidence.
export function readReportEvidence(value: string, kind: "strength" | "improvement"): ReportEvidence | null {
  const normalized = value.trim().replace(/\r\n/g, "\n");
  if (kind === "strength") {
    const match = /^原文：([^\n]+)\n亮点：([\s\S]+)$/.exec(normalized);
    return match?.[1].trim() && match[2].trim() ? { quote: match[1], strength: match[2].trim() } : null;
  }
  const match = /^原文：([^\n]+)\n问题：([^\n]+)\n建议：([\s\S]+?)\n原因：([\s\S]+)$/.exec(normalized);
  return match && match.slice(1).every((part) => part.trim())
    ? { quote: match[1], problem: match[2].trim(), suggestion: match[3].trim(), reason: match[4].trim() }
    : null;
}

const nonempty = (value: unknown, limit: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= limit;
function stringList(value: unknown, limit: number): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every((item) => nonempty(item, 2400));
}

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]/gu, "");
}

function alignQuoteToTranscript(quote: string, transcript: string): string | null {
  if (transcript.includes(quote)) return quote;
  const target = normalizeEvidenceText(quote);
  if (!target || target.length < 4) return null;
  let normalized = "";
  const sourceIndexes: number[] = [];
  for (let index = 0; index < transcript.length;) {
    const character = String.fromCodePoint(transcript.codePointAt(index)!);
    const folded = normalizeEvidenceText(character);
    for (const item of folded) {
      normalized += item;
      sourceIndexes.push(index);
    }
    index += character.length;
  }
  const start = normalized.indexOf(target);
  if (start < 0) return null;
  const sourceStart = sourceIndexes[start];
  const lastIndex = sourceIndexes[start + target.length - 1];
  if (sourceStart === undefined || lastIndex === undefined) return null;
  const lastCharacter = String.fromCodePoint(transcript.codePointAt(lastIndex)!);
  return transcript.slice(sourceStart, lastIndex + lastCharacter.length);
}

function replaceEvidenceQuote(entry: string, quote: string, alignedQuote: string): string {
  return entry.replace(`原文：${quote}`, `原文：${alignedQuote}`);
}

function readableValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  const labels: Record<string, string> = {
    quote: "原文", strength: "亮点", problem: "问题", suggestion: "建议", reason: "原因",
    goal: "首要目标", method: "练习方法", criteria: "完成标准",
  };
  const lines = Object.entries(object).flatMap(([key, item]) => {
    const text = readableValue(item);
    return text ? [`${labels[key] ?? key}：${text}`] : [];
  });
  return lines.join("\n");
}

function readableList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(readableValue).filter(Boolean);
}

function parseLooseRecordingReport(raw: unknown, rawContent: string): ReportContent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const allowedKeys = new Set<ScoreDimension["key"]>(["structure", "clarity", "evidence", "brevity", "confidence"]);
  const dimensions = (Array.isArray(data.dimensions) ? data.dimensions : []).flatMap((value): ScoreDimension[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (!allowedKeys.has(item.key as ScoreDimension["key"])) return [];
    const score = typeof item.score === "number" && Number.isFinite(item.score) ? Math.max(0, Math.min(100, item.score)) : 0;
    return [{ key: item.key as ScoreDimension["key"], label: readableValue(item.label) || String(item.key), score,
      summary: readableValue(item.summary) || "AI 未提供该维度的详细说明。" }];
  });
  const strengths = readableList(data.strengths);
  const improvements = readableList(data.improvements);
  const actionItems = readableList(data.actionItems);
  const recognizable = typeof data.title === "string" || typeof data.overallScore === "number" || dimensions.length || strengths.length || improvements.length || actionItems.length;
  if (!recognizable) return null;
  return {
    title: readableValue(data.title) || "AI 分析报告",
    overallScore: typeof data.overallScore === "number" && Number.isFinite(data.overallScore) ? Math.max(0, Math.min(100, data.overallScore)) : 0,
    dimensions,
    strengths,
    improvements,
    actionItems,
    rawContent: dimensions.length || strengths.length || improvements.length || actionItems.length ? undefined : rawContent,
  };
}

function parseStructuredRecordingReport(content: string, transcript: string): ReportContent {
  let raw: unknown;
  try { raw = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("AI 返回的报告不是有效 JSON，原有报告已保留，请重新生成。"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("AI 返回的报告格式不完整，请重新生成。");
  const data = raw as Record<string, unknown>;
  const keys = new Set(["structure", "clarity", "evidence", "brevity", "confidence"]);
  if (!nonempty(data.title, 160) || typeof data.overallScore !== "number" || !Number.isFinite(data.overallScore) || data.overallScore < 0 || data.overallScore > 100 ||
      !Array.isArray(data.dimensions) || data.dimensions.length !== 5 ||
      data.dimensions.some((item) => !item || !keys.has(item.key) || !nonempty(item.label, 80) || !nonempty(item.summary, 1600) || typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 100) ||
      new Set(data.dimensions.map((item) => item.key)).size !== 5 ||
      !stringList(data.strengths, 3) || !stringList(data.improvements, 6) || !stringList(data.actionItems, 1) || data.actionItems.length !== 1) {
    throw new Error("AI 报告需包含五个评价维度、原文依据和一个优先练习目标，请重新生成。");
  }
  for (const [kind, entries, field] of [["strength", data.strengths, "strengths"], ["improvement", data.improvements, "improvements"]] as const) {
    const seen = new Set<string>();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const evidence = readReportEvidence(entry, kind);
      const alignedQuote = evidence && evidence.quote.length <= 240 ? alignQuoteToTranscript(evidence.quote, transcript) : null;
      if (!evidence || !alignedQuote) {
        throw new Error("AI 报告缺少原句或引用了逐字稿中不存在的内容，已拦截新报告；原有报告和逐字稿已保留。");
      }
      const identity = normalizeEvidenceText(alignedQuote);
      if (seen.has(identity)) throw new Error("AI 对同一原句给出了重复条目，请重新生成。");
      seen.add(identity);
      if (alignedQuote !== evidence.quote) (data[field] as string[])[index] = replaceEvidenceQuote(entry, evidence.quote, alignedQuote);
    }
  }
  const practice = /^首要目标：([^\n]+)\n练习方法：([^\n]+)\n完成标准：([^\n]+)$/.exec(data.actionItems[0].trim().replace(/\r\n/g, "\n"));
  if (!practice || practice.slice(1).some((field) => !field.trim())) {
    throw new Error("AI 报告缺少具体练习方法或完成标准，请重新生成。");
  }
  return { title: data.title.trim(), overallScore: data.overallScore, dimensions: data.dimensions as ScoreDimension[],
    strengths: data.strengths, improvements: data.improvements, actionItems: data.actionItems };
}

export function parseRecordingReport(content: string, transcript: string): ReportContent {
  const rawContent = content.trim();
  if (!rawContent) {
    return { title: "AI 原始分析", overallScore: 0, dimensions: [], strengths: [], improvements: [], actionItems: [], rawContent: "AI 未返回可显示内容。" };
  }
  try {
    return parseStructuredRecordingReport(rawContent, transcript);
  } catch {
    try {
      const parsed = JSON.parse(rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      return parseLooseRecordingReport(parsed, rawContent) ?? { title: "AI 原始分析", overallScore: 0, dimensions: [], strengths: [], improvements: [], actionItems: [], rawContent };
    } catch {
      return { title: "AI 原始分析", overallScore: 0, dimensions: [], strengths: [], improvements: [], actionItems: [], rawContent };
    }
  }
}
