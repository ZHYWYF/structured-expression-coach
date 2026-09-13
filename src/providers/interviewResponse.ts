import type { InterviewAnswerFeedback, InterviewQuestion } from "../core/types";
import { extractJobRequirements } from "../knowledge/interviewQuestions";

function json(content: string): unknown { return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
const strings = (value: unknown, limit = 8) => Array.isArray(value) && value.length <= limit && value.every((item) => typeof item === "string" && item.trim() && item.length <= 1200);

export function parseInterviewQuestions(content: string, jd: string, resume: string, existing: InterviewQuestion[], parentQuestionId?: string): InterviewQuestion[] {
  const parsed = json(content) as { questions?: unknown[] } | null;
  if (!parsed || !Array.isArray(parsed.questions) || !parsed.questions.length || parsed.questions.length > 12) throw new Error("AI返回的问题格式不完整，请重试");
  const known = new Set(existing.map((item) => item.text.replace(/\s/g, "")));
  const requirements = extractJobRequirements(jd);
  const generated = parsed.questions.flatMap((raw): InterviewQuestion[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.text !== "string" || item.text.trim().length < 8 || item.text.length > 800 || typeof item.tag !== "string" || !item.tag.trim()) return [];
    const text = item.text.trim(); const key = text.replace(/\s/g, "");
    if (known.has(key) || /如何体现[“"「]?(?:北京|上海|校招|社招)|(?:如何体现|展示).{0,60}职位\s*(?:ID|编号)/i.test(text)) return [];
    const jdEvidence = typeof item.jdEvidence === "string" && item.jdEvidence.trim() && jd.includes(item.jdEvidence) && requirements.some((requirement) => requirement.includes(item.jdEvidence as string) || (item.jdEvidence as string).includes(requirement)) ? item.jdEvidence : undefined;
    const resumeEvidence = typeof item.resumeEvidence === "string" && item.resumeEvidence.trim() && resume.includes(item.resumeEvidence) ? item.resumeEvidence : undefined;
    if (!jdEvidence && !resumeEvidence && !parentQuestionId) return [];
    known.add(key);
    return [{ id: `question-${crypto.randomUUID()}`, tag: item.tag.trim().slice(0, 50), text, jdEvidence, resumeEvidence, parentQuestionId,
      suggestedMinutes: typeof item.suggestedMinutes === "number" && Number.isFinite(item.suggestedMinutes) ? Math.max(1, Math.min(15, item.suggestedMinutes)) : 3, source: "ai" }];
  });
  if (!generated.length) throw new Error("AI没有返回新的、可追溯到职责或简历的问题。原题与答案已保留，可重试或改用本地出题。");
  return generated.slice(0, parentQuestionId ? 2 : 6);
}

export function parseInterviewFeedback(content: string, input: { resume: string; answer: string }): InterviewAnswerFeedback {
  const parsed = json(content);
  if (!parsed || typeof parsed !== "object") throw new Error("AI返回的反馈格式不完整，请重试");
  const item = parsed as Record<string, unknown>;
  const keys = ["structure", "jdMatch", "resumeConsistency", "evidenceStrength", "overallSuggestion"] as const;
  if (keys.some((key) => typeof item[key] !== "string" || !(item[key] as string).trim() || (item[key] as string).length > 4000)) throw new Error("AI返回的反馈格式不完整，请重试");
  const base = Object.fromEntries(keys.map((key) => [key, item[key]])) as Pick<InterviewAnswerFeedback, typeof keys[number]>;
  const hasReference = typeof item.referenceAnswer === "string" && item.referenceAnswer.trim() && item.referenceAnswer.length <= 12000;
  // Older compatible services may return only the existing report: preserve it,
  // but show a clear missing-reference state instead of pretending a template exists.
  if (!hasReference) return { ...base, answerSnapshot: input.answer, createdAt: new Date().toISOString() };
  if (!strings(item.answerFramework, 6) || !(item.answerFramework as string[]).length || !strings(item.revisionNotes) || !strings(item.missingFacts, 12) || !Array.isArray(item.supportingEvidence) || item.supportingEvidence.length > 20) throw new Error("AI参考回答缺少答题框架、修改说明或事实依据，请重新生成");
  const evidence = item.supportingEvidence.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("AI参考回答的事实引用无效，已保留原答案");
    const entry = raw as Record<string, unknown>;
    if ((entry.source !== "resume" && entry.source !== "answer") || typeof entry.quote !== "string" || !entry.quote.trim() || !input[entry.source].includes(entry.quote)) throw new Error("AI引用了简历或原回答中不存在的事实，已拦截参考稿");
    return { source: entry.source, quote: entry.quote } as { source: "resume" | "answer"; quote: string };
  });
  const reference = item.referenceAnswer as string;
  const withoutPlaceholders = reference.replace(/【待补充[:：][^】]*】/g, "");
  const numbers = withoutPlaceholders.match(/\d+(?:\.\d+)?%?/g) ?? [];
  if (numbers.some((value) => !`${input.resume}\n${input.answer}`.includes(value))) throw new Error("AI参考稿出现材料中没有的数字，已拦截，请重试");
  if (!evidence.length && !/【待补充[:：]/.test(reference)) throw new Error("AI参考稿未提供事实依据或待补充标记，请重新生成");
  return { ...base, answerFramework: item.answerFramework as string[], referenceAnswer: reference.trim(),
    revisionNotes: item.revisionNotes as string[], missingFacts: item.missingFacts as string[], supportingEvidence: evidence,
    answerSnapshot: input.answer, createdAt: new Date().toISOString() };
}
