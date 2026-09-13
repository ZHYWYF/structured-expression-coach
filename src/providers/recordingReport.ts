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

export function parseRecordingReport(content: string, transcript: string): ReportContent {
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
  for (const [kind, entries] of [["strength", data.strengths], ["improvement", data.improvements]] as const) {
    const seen = new Set<string>();
    for (const entry of entries) {
      const evidence = readReportEvidence(entry, kind);
      if (!evidence || evidence.quote.length > 240 || !transcript.includes(evidence.quote)) {
        throw new Error("AI 报告缺少原句或引用了逐字稿中不存在的内容，已拦截新报告；原有报告和逐字稿已保留。");
      }
      if (seen.has(evidence.quote)) throw new Error("AI 对同一原句给出了重复条目，请重新生成。");
      seen.add(evidence.quote);
    }
  }
  const practice = /^首要目标：([^\n]+)\n练习方法：([^\n]+)\n完成标准：([^\n]+)$/.exec(data.actionItems[0].trim().replace(/\r\n/g, "\n"));
  if (!practice || practice.slice(1).some((field) => !field.trim())) {
    throw new Error("AI 报告缺少具体练习方法或完成标准，请重新生成。");
  }
  return { title: data.title.trim(), overallScore: data.overallScore, dimensions: data.dimensions as ScoreDimension[],
    strengths: data.strengths, improvements: data.improvements, actionItems: data.actionItems };
}
