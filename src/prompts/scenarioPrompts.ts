import type { RecordingAnalysisScenario } from "../core/types";

export interface PromptMessage {
  role: "system" | "user";
  content: string;
}

const reportSchema = '{"title":"","overallScore":0,"dimensions":[{"key":"structure","label":"结构","score":0,"summary":""},{"key":"clarity","label":"清晰度","score":0,"summary":""},{"key":"evidence","label":"证据","score":0,"summary":""},{"key":"brevity","label":"简洁度","score":0,"summary":""},{"key":"confidence","label":"自信度","score":0,"summary":""}],"strengths":[],"improvements":[],"actionItems":[]}';

const recordingScenarioInstructions: Record<RecordingAnalysisScenario, { role: string; criteria: string }> = {
  general: {
    role: "中文结构化表达教练",
    criteria: "检查中心观点、信息分层、逻辑衔接、措辞清晰度、证据充分性和表达简洁度。",
  },
  interview: {
    role: "中文面试表达教练",
    criteria: "检查是否直接回答问题、STAR 是否完整、个人贡献是否清楚、决策理由是否充分、结果是否量化、回答是否可信且避免模板化。没有 JD 或简历时不得臆测岗位匹配和经历真实性。",
  },
  report: {
    role: "中文工作汇报教练",
    criteria: "检查是否结论先行，目标、进展、结果、数据、风险、影响、决策诉求和下一步负责人/时间是否完整。区分活动与结果，避免把工作量当成果。",
  },
  retrospective: {
    role: "中文项目复盘教练",
    criteria: "检查目标与结果差距、事实与判断边界、根因证据、是否存在单一归因或归责、成功经验是否可复用，以及改进动作是否包含负责人、时间和验证标准。",
  },
};

export function buildInterviewQuestionPrompt(jobDescription: string, resume: string): PromptMessage[] {
  return [
    {
      role: "system",
      content: "你是严谨的中文面试官和面试教练。只能依据用户提供的 JD 与简历出题，不得虚构候选人经历。问题应区分岗位核心能力、经历深挖、行为面试、风险验证和压力追问。只返回 JSON。",
    },
    {
      role: "user",
      content: `JD：\n${jobDescription}\n\n简历：\n${resume}\n\n生成 6 道有区分度的问题。每道题必须能追溯到 JD 要求或简历经历，避免泛泛而问。返回 {"questions":[{"tag":"","text":"","suggestedMinutes":3,"jdEvidence":"JD原文片段"}]}。`,
    },
  ];
}

export function buildInterviewAnswerPrompt(input: { jobDescription: string; resume: string; question: string; answer: string }): PromptMessage[] {
  return [
    {
      role: "system",
      content: "你是中文面试教练。严格依据 JD、简历、问题和回答分析，不得补造材料中不存在的事实。优先指出最影响录用判断的问题，建议只做局部改善，不重写整段。只返回 JSON。",
    },
    {
      role: "user",
      content: `JD：${input.jobDescription}\n简历：${input.resume}\n问题：${input.question}\n回答：${input.answer}\n\n按以下标准分析：是否直接回答、STAR 是否完整、个人贡献是否明确、行动是否解释决策理由、结果是否量化、是否匹配 JD、是否与简历一致。返回 {"structure":"","jdMatch":"","resumeConsistency":"","evidenceStrength":"","overallSuggestion":""}。`,
    },
  ];
}

export function buildRecordingReportPrompt(scenario: RecordingAnalysisScenario, transcript: string): PromptMessage[] {
  const configuration = recordingScenarioInstructions[scenario];
  return [
    {
      role: "system",
      content: `你是${configuration.role}。只分析用户提供的逐字稿，不虚构背景、数据、人物或结果。${configuration.criteria} 保留原意，给出可执行的局部优化。只返回 JSON。`,
    },
    {
      role: "user",
      content: `场景：${scenario}\n逐字稿：\n${transcript}\n\n请基于该场景输出报告。strengths 最多 3 条，improvements 和 actionItems 各 3 至 6 条，优先给出具体且不重复的建议。返回 ${reportSchema}。`,
    },
  ];
}

export const recordingScenarioLabels: Record<RecordingAnalysisScenario, string> = {
  general: "通用表达",
  interview: "面试回答",
  report: "工作汇报",
  retrospective: "项目复盘",
};
