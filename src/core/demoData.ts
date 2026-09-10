import type {
  Feedback,
  InterviewSession,
  Material,
  PracticeSession,
  RecordingTask,
  Scenario,
  TrainingPlan,
  WorkspaceState,
} from "./types";

const updatedAt = "2026-09-10T09:30:00.000Z";

export const demoScenarios: Scenario[] = [
  {
    id: "scenario-weekly-report",
    title: "三分钟项目周报",
    description: "向跨职能团队说明进展、风险和下一步安排。",
    category: "work-report",
    prompt: "请用结论先行的方式汇报本周项目进展。",
    goals: ["先给结论", "使用事实和数字", "明确风险负责人"],
    suggestedMinutes: 3,
    tags: ["职场", "汇报", "结构化"],
  },
  {
    id: "scenario-product-review",
    title: "产品评审陈述",
    description: "在评审会上解释用户问题、方案取舍和成功指标。",
    category: "meeting",
    prompt: "请介绍方案背景，并说明为什么现在值得投入。",
    goals: ["问题定义清晰", "取舍有依据", "指标可验证"],
    suggestedMinutes: 5,
    tags: ["评审", "说服", "产品"],
  },
  {
    id: "scenario-interview",
    title: "行为面试模拟",
    description: "结合职位描述和个人简历回答经历类问题。",
    category: "interview",
    prompt: "请讲一次你推动复杂项目落地的经历。",
    goals: ["使用 STAR 结构", "突出个人贡献", "匹配岗位要求"],
    suggestedMinutes: 8,
    tags: ["面试", "STAR", "经历"],
  },
  {
    id: "scenario-free-practice",
    title: "自由表达练习",
    description: "围绕任意主题完成一段有开头、主体和结尾的表达。",
    category: "free-practice",
    prompt: "选择一个熟悉的话题，完成两分钟即兴表达。",
    goals: ["中心观点唯一", "段落衔接自然", "减少口头禅"],
    suggestedMinutes: 2,
    tags: ["日常", "即兴", "流畅度"],
  },
];

const jd: Material = {
  id: "material-jd-growth-pm",
  kind: "job-description",
  title: "增长产品经理职位描述",
  content:
    "负责用户增长策略、实验设计和跨团队推进；要求能通过数据识别机会，独立拆解目标，并推动研发、设计和运营协同交付。",
  sourceName: "演示职位描述.txt",
  createdAt: "2026-09-08T02:00:00.000Z",
  updatedAt: "2026-09-08T02:00:00.000Z",
};

const resume: Material = {
  id: "material-resume-lin",
  kind: "resume",
  title: "林晓的产品简历",
  content:
    "5 年互联网产品经验。主导新用户激活项目，通过漏斗分析定位首日关键行为，联合三支团队上线引导实验，使次日留存提升 8.4%，季度新增活跃用户提升 12%。",
  sourceName: "演示简历.txt",
  createdAt: "2026-09-08T02:05:00.000Z",
  updatedAt: "2026-09-08T02:05:00.000Z",
};

const interviewFeedback: Feedback = {
  id: "feedback-interview-1",
  sessionId: "session-interview-growth",
  statementId: "statement-interview-1",
  category: "structure",
  severity: "warning",
  title: "结果明确，但行动过程可以进一步分层",
  summary: "当前回答包含背景、行动和结果，建议把个人判断与团队执行拆开说明。",
  score: 82,
  evidence: [
    {
      quote: "我们很快推动了三个实验",
      explanation: "“很快”和“推动”较笼统，面试官难以判断你的具体贡献。",
    },
  ],
  suggestions: [
    {
      id: "suggestion-interview-1",
      title: "补充个人决策",
      description: "说明你如何确定实验优先级。",
      replacement: "我按影响范围和开发成本排序，先验证注册后首个关键行为的引导方案。",
      status: "pending",
    },
    {
      id: "suggestion-interview-2",
      title: "量化协作范围",
      description: "点明参与团队和推进机制。",
      status: "accepted",
    },
  ],
  createdAt: "2026-09-09T08:25:00.000Z",
};

const interviewSession: InterviewSession = {
  id: "session-interview-growth",
  kind: "interview",
  title: "增长产品经理一面准备",
  scenarioId: "scenario-interview",
  status: "active",
  jobDescription: jd,
  resume,
  questionAnswers: {
    "experience-deep-dive":
      "上一家公司新用户次日留存连续两个季度没有增长。我负责拆解激活漏斗，发现完成首个关键行为的用户留存明显更高。我们很快推动了三个实验，最终次日留存提升了 8.4%。",
  },
  activeQuestionIndex: 0,
  materialsLocked: true,
  materials: [
    {
      id: "material-company-notes",
      kind: "note",
      title: "公司业务笔记",
      content: "重点关注新用户价值发现、实验效率和跨团队影响力。",
      createdAt: "2026-09-08T02:10:00.000Z",
      updatedAt: "2026-09-08T02:10:00.000Z",
    },
  ],
  draftText:
    "上一家公司新用户次日留存连续两个季度没有增长。我负责拆解激活漏斗，发现完成首个关键行为的用户留存明显更高。我们很快推动了三个实验，最终次日留存提升了 8.4%。",
  statements: [
    {
      id: "statement-interview-1",
      sessionId: "session-interview-growth",
      text: "上一家公司新用户次日留存连续两个季度没有增长。我负责拆解激活漏斗，发现完成首个关键行为的用户留存明显更高。我们很快推动了三个实验，最终次日留存提升了 8.4%。",
      source: "typed",
      order: 0,
      createdAt: "2026-09-09T08:20:00.000Z",
      updatedAt: "2026-09-09T08:20:00.000Z",
      metrics: {
        wordCount: 69,
        fillerWordCount: 0,
        repeatedPhraseCount: 0,
        averageSentenceLength: 17.25,
      },
    },
  ],
  messages: [
    {
      id: "message-interview-user-1",
      sessionId: "session-interview-growth",
      role: "user",
      content: "请帮我检查这段回答是否符合 STAR 结构。",
      statementId: "statement-interview-1",
      createdAt: "2026-09-09T08:21:00.000Z",
    },
    {
      id: "message-interview-coach-1",
      sessionId: "session-interview-growth",
      role: "coach",
      content: "结果部分很清楚。建议补充任务目标、你的优先级判断和跨团队推进动作。",
      createdAt: "2026-09-09T08:25:00.000Z",
    },
  ],
  feedback: [interviewFeedback],
  report: {
    id: "report-interview-growth",
    sessionId: "session-interview-growth",
    title: "增长产品经理模拟面试报告",
    overallScore: 82,
    dimensions: [
      { key: "structure", label: "结构", score: 78, summary: "STAR 要素齐全，行动层次需加强。" },
      { key: "clarity", label: "清晰度", score: 86, summary: "问题和结果表达直接。" },
      { key: "evidence", label: "证据", score: 90, summary: "核心结果有量化数据。" },
      { key: "brevity", label: "简洁度", score: 84, summary: "篇幅合适，可替换少量模糊词。" },
      { key: "confidence", label: "自信度", score: 74, summary: "个人贡献表达偏弱。" },
    ],
    strengths: ["业务问题具体", "结果量化清晰", "经历与岗位匹配"],
    improvements: ["拆分关键行动", "减少“我们”并突出个人贡献"],
    actionItems: ["按 STAR 重写一次", "录制两分钟版本并复盘语速"],
    generatedAt: "2026-09-09T08:26:00.000Z",
  },
  recordingTaskIds: ["recording-interview-1"],
  createdAt: "2026-09-08T02:00:00.000Z",
  updatedAt: "2026-09-09T08:26:00.000Z",
};

const practiceSession: PracticeSession = {
  id: "session-weekly-report",
  kind: "practice",
  title: "支付改版项目周报",
  scenarioId: "scenario-weekly-report",
  status: "completed",
  materials: [],
  draftText:
    "本周支付改版已完成灰度，核心支付成功率保持稳定。当前主要风险是旧版埋点缺失，数据团队将在周五前完成补录。下周计划扩大到 30% 流量。",
  statements: [
    {
      id: "statement-weekly-1",
      sessionId: "session-weekly-report",
      text: "本周支付改版已完成灰度，核心支付成功率保持稳定。当前主要风险是旧版埋点缺失，数据团队将在周五前完成补录。下周计划扩大到 30% 流量。",
      source: "transcript",
      order: 0,
      createdAt: "2026-09-07T10:00:00.000Z",
      updatedAt: "2026-09-07T10:00:00.000Z",
      metrics: {
        wordCount: 64,
        durationSeconds: 41,
        fillerWordCount: 2,
        repeatedPhraseCount: 1,
        averageSentenceLength: 21.3,
      },
    },
  ],
  messages: [],
  feedback: [
    {
      id: "feedback-weekly-1",
      sessionId: "session-weekly-report",
      statementId: "statement-weekly-1",
      category: "clarity",
      severity: "info",
      title: "结论先行且责任清楚",
      summary: "进展、风险、负责人和下一步均已覆盖。",
      score: 91,
      evidence: [],
      suggestions: [
        {
          id: "suggestion-weekly-1",
          title: "补充灰度比例",
          description: "用当前流量比例帮助听众判断进度。",
          status: "dismissed",
        },
      ],
      createdAt: "2026-09-07T10:02:00.000Z",
    },
  ],
  report: {
    id: "report-weekly-1",
    sessionId: "session-weekly-report",
    title: "支付改版周报表达报告",
    overallScore: 89,
    dimensions: [
      { key: "structure", label: "结构", score: 93, summary: "进展、风险和计划层次清晰。" },
      { key: "clarity", label: "清晰度", score: 91, summary: "关键信息易于捕捉。" },
      { key: "evidence", label: "证据", score: 84, summary: "可以补充当前灰度比例。" },
      { key: "brevity", label: "简洁度", score: 90, summary: "表达紧凑。" },
      { key: "confidence", label: "自信度", score: 87, summary: "语气稳定。" },
    ],
    strengths: ["结论先行", "风险责任人明确"],
    improvements: ["补充关键进度数据"],
    actionItems: ["下次周报加入当前灰度比例"],
    generatedAt: "2026-09-07T10:03:00.000Z",
  },
  recordingTaskIds: ["recording-weekly-1"],
  createdAt: "2026-09-07T09:55:00.000Z",
  updatedAt: "2026-09-07T10:03:00.000Z",
};

export const demoSessions = [interviewSession, practiceSession];

export const demoTrainingPlans: TrainingPlan[] = [
  {
    id: "plan-seven-days",
    title: "七天结构化表达训练",
    description: "从结论先行、证据组织到完整模拟，形成稳定表达框架。",
    startDate: "2026-09-08",
    endDate: "2026-09-14",
    focusAreas: ["结论先行", "STAR", "数据证据", "语速控制"],
    tasks: [
      {
        id: "task-day-1",
        title: "三分钟周报",
        description: "按进展、风险、计划完成一次录音。",
        scenarioId: "scenario-weekly-report",
        targetMinutes: 10,
        status: "done",
        dueDate: "2026-09-08",
        completedAt: "2026-09-08T11:00:00.000Z",
      },
      {
        id: "task-day-2",
        title: "STAR 行动拆解",
        description: "重写一段项目经历，至少包含两个个人行动。",
        scenarioId: "scenario-interview",
        targetMinutes: 15,
        status: "in-progress",
        dueDate: "2026-09-10",
      },
      {
        id: "task-day-3",
        title: "产品方案评审",
        description: "围绕问题、方案、取舍和指标完成五分钟陈述。",
        scenarioId: "scenario-product-review",
        targetMinutes: 20,
        status: "todo",
        dueDate: "2026-09-12",
      },
    ],
    createdAt: "2026-09-08T01:00:00.000Z",
    updatedAt,
  },
];

export const demoRecordingTasks: RecordingTask[] = [
  {
    id: "recording-weekly-1",
    sessionId: "session-weekly-report",
    title: "支付改版周报录音",
    status: "completed",
    audioPath: "recordings/payment-weekly-report.m4a",
    durationSeconds: 41,
    progress: 100,
    transcript: practiceSession.draftText,
    createdAt: "2026-09-07T09:59:00.000Z",
    updatedAt: "2026-09-07T10:00:00.000Z",
  },
  {
    id: "recording-interview-1",
    sessionId: "session-interview-growth",
    title: "增长项目经历模拟回答",
    status: "failed",
    durationSeconds: 96,
    progress: 68,
    errorMessage: "上次任务已中断，可重新开始转写。",
    createdAt: "2026-09-10T09:20:00.000Z",
    updatedAt,
  },
];

export const demoWorkspace: WorkspaceState = {
  version: 1,
  currentPage: "home",
  selectedSessionId: "session-interview-growth",
  sessions: demoSessions,
  scenarios: demoScenarios,
  trainingPlans: demoTrainingPlans,
  recordingTasks: demoRecordingTasks,
  preferences: {
    theme: "system",
    autoSave: true,
    defaultSessionKind: "practice",
    transcriptionProvider: "demo",
    language: "zh-CN",
  },
  updatedAt,
};

export function createDemoWorkspace(): WorkspaceState {
  return JSON.parse(JSON.stringify(demoWorkspace)) as WorkspaceState;
}
