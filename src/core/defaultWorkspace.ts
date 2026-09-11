import type { Scenario, WorkspaceState } from "./types";

export const defaultScenarios: Scenario[] = [
  {
    id: "scenario-weekly-report",
    title: "工作汇报",
    description: "说明进展、结果、风险和下一步安排。",
    category: "work-report",
    prompt: "请用结论先行的方式汇报当前工作进展。",
    goals: ["结论先行", "事实与数据", "明确下一步"],
    suggestedMinutes: 3,
    tags: ["职场", "汇报", "结构化"],
  },
  {
    id: "scenario-project-review",
    title: "项目复盘",
    description: "梳理目标、事实、判断和可复用经验。",
    category: "meeting",
    prompt: "请说明项目目标、实际结果、关键原因与后续动作。",
    goals: ["区分事实与判断", "解释关键原因", "形成行动项"],
    suggestedMinutes: 5,
    tags: ["复盘", "总结", "行动"],
  },
  {
    id: "scenario-interview",
    title: "岗位面试",
    description: "结合职位描述和个人简历进行针对性训练。",
    category: "interview",
    prompt: "请围绕目标岗位完成一次模拟面试。",
    goals: ["STAR 结构", "岗位匹配", "证据充分"],
    suggestedMinutes: 20,
    tags: ["面试", "JD", "简历"],
  },
  {
    id: "scenario-free-practice",
    title: "自由表达",
    description: "围绕任意主题练习清晰、简洁地表达。",
    category: "free-practice",
    prompt: "选择一个熟悉的话题，完成一段结构化表达。",
    goals: ["中心观点明确", "衔接自然", "减少口头禅"],
    suggestedMinutes: 3,
    tags: ["即兴", "表达", "流畅度"],
  },
];

export function createEmptyWorkspace(): WorkspaceState {
  return {
    version: 2,
    currentPage: "home",
    selectedSessionId: null,
    sessions: [],
    scenarios: defaultScenarios.map((scenario) => ({ ...scenario, goals: [...scenario.goals], tags: [...scenario.tags] })),
    trainingPlans: [],
    recordingTasks: [],
    tombstones: [],
    preferences: {
      theme: "system",
      autoSave: true,
      defaultSessionKind: "practice",
      transcriptionProvider: "local",
      language: "zh-CN",
      aiProvider: {
        name: "OpenAI-compatible",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        enabled: false,
      },
      onlineAsrProvider: {
        name: "OpenAI-compatible ASR",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        enabled: false,
      },
      sync: {
        enabled: false,
        endpoint: "",
        account: "",
        deviceName: "",
        lastSyncedAt: null,
        status: "not-configured",
      },
      installedModels: [],
    },
    updatedAt: new Date().toISOString(),
  };
}
