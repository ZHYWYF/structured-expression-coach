import { describe, expect, it } from "vitest";
import type { RecordingAnalysisScenario, Scenario, TrainingPlan } from "../core/types";
import { boundedReportGoals, recordingReportContext } from "./recordingReportContext";

const scenarios: Scenario[] = ["work-report", "interview", "meeting", "free-practice", "presentation"].map((category) => ({
  id: category, category: category as Scenario["category"], title: category, description: "合成场景", prompt: "合成提示",
  goals: [`${category}场景目标`], suggestedMinutes: 3, tags: [],
}));

function plan(patch: Partial<TrainingPlan> = {}): TrainingPlan {
  return { id: "plan", title: "合成计划", description: "", scenarioId: "work-report", goals: ["明确决策诉求"], focusAreas: ["证据"],
    startDate: "2026-09-01", endDate: "2026-09-30", currentLevel: "beginner", levelSource: "self-assessment", status: "active", tasks: [],
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...patch };
}

describe("recordingReportContext", () => {
  it.each<[RecordingAnalysisScenario, string[]]>([
    ["report", ["work-report场景目标"]], ["interview", ["interview场景目标"]],
    ["retrospective", ["meeting场景目标"]], ["general", ["free-practice场景目标", "presentation场景目标"]],
  ])("%s只获取相应场景目标", (scenario, goals) => {
    expect(recordingReportContext(scenario, "本会话", scenarios, [])).toEqual({ goals, focusAreas: [] });
  });

  it("优先当前会话唯一关联计划，排除其他会话、场景和非活动计划", () => {
    const plans = [plan({ id: "unlinked" }), plan({ id: "mine", goals: ["本次目标"], focusAreas: ["本次重点"], linkedSessionIds: ["本会话"] }),
      plan({ id: "other", goals: ["其他会话秘密"], linkedSessionIds: ["其他会话"] }),
      plan({ id: "interview", scenarioId: "interview", linkedSessionIds: ["本会话"] }),
      plan({ id: "paused", status: "paused", linkedSessionIds: ["本会话"] })];
    const before = structuredClone({ scenarios, plans });
    expect(recordingReportContext("report", "本会话", scenarios, plans)).toEqual({ goals: ["本次目标"], focusAreas: ["本次重点"] });
    expect({ scenarios, plans }).toEqual(before);
  });

  it("没有当前关联计划时可使用唯一未绑定计划但不读取其他会话计划", () => {
    const plans = [plan(), plan({ id: "other", goals: ["另一会话目标"], linkedSessionIds: ["另一会话"] })];
    expect(recordingReportContext("report", "本会话", scenarios, plans)).toEqual({ goals: ["明确决策诉求"], focusAreas: ["证据"] });
    expect(recordingReportContext("report", "本会话", scenarios, [plans[1]])).toEqual({ goals: ["work-report场景目标"], focusAreas: [] });
  });

  it.each([{ linkedSessionIds: undefined }, { linkedSessionIds: ["本会话"] }])("多个可用计划有歧义时回退场景且不混入个人重点（$linkedSessionIds）", ({ linkedSessionIds }) => {
    const plans = [plan({ id: "one", linkedSessionIds }), plan({ id: "two", linkedSessionIds })];
    expect(recordingReportContext("report", "本会话", scenarios, plans)).toEqual({ goals: ["work-report场景目标"], focusAreas: [] });
  });

  it("旧计划没有关联字段且目标为空时保留重点并回退场景；无场景时返回空上下文", () => {
    expect(recordingReportContext("report", "本会话", scenarios, [plan({ goals: [] })])).toEqual({ goals: ["work-report场景目标"], focusAreas: ["证据"] });
    expect(recordingReportContext("report", "本会话", [], [plan()])).toEqual({ goals: [], focusAreas: [] });
  });
});

describe("boundedReportGoals", () => {
  it("去空去重、最多六项且每项160字，不改变输入", () => {
    const values = ["  结论先行 ", "", "\t", "结论先行", "长".repeat(180), "三", "四", "五", "六", "七"];
    const before = [...values];
    expect(boundedReportGoals(values)).toEqual(["结论先行", "长".repeat(160), "三", "四", "五", "六"]);
    expect(values).toEqual(before);
    expect(boundedReportGoals([])).toEqual([]);
  });
});
