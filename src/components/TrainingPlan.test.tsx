// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkspace } from "../core/defaultWorkspace";
import { createLocalStorageRepository } from "../core/storage";
import type { PracticeSession, TrainingPlan as Plan, WorkspaceState } from "../core/types";
import { useWorkspace, type WorkspaceController } from "../core/useWorkspace";
import { TrainingPlan } from "./TrainingPlan";

const now = "2026-09-12T08:00:00.000Z";
function plan(id = "plan", status: Plan["status"] = "active"): Plan {
  return { id, title: `训练${id}`, description: "", startDate: "2026-09-12", endDate: "2026-09-18", scenarioId: "scenario-weekly-report",
    goals: ["结论先行"], focusAreas: ["结构"], currentLevel: "intermediate", levelSource: "self-assessment", status, createdAt: now, updatedAt: now,
    tasks: [{ id: `task-${id}`, title: `练习${id}`, description: "真实汇报练习", targetMinutes: 10, status: "todo" }] };
}
function scoredSession(id: string, scenarioId: string, overallScore: number): PracticeSession {
  return { id, title: id, kind: "practice", scenarioId, status: "completed", draftText: "练习原文", statements: [], messages: [], feedback: [], materials: [], recordingTaskIds: [], createdAt: now, updatedAt: now,
    report: { id: `report-${id}`, sessionId: id, title: "练习报告", overallScore, dimensions: [], strengths: [], improvements: [], actionItems: [], generatedAt: now } };
}
function dimensionedSession(id: string, overallScore: number, insufficient = false, generatedAt = now): PracticeSession {
  const session = scoredSession(id, "scenario-weekly-report", overallScore);
  return {
    ...session,
    report: {
      ...session.report!, title: `报告${id}`, generatedAt,
      dimensions: ([
        ["structure", "结构"], ["clarity", "清晰度"], ["evidence", "证据"],
        ["brevity", "简洁度"], ["confidence", "自信感"],
      ] as const).map(([key, label]) => ({ key, label, score: overallScore,
        summary: insufficient ? " \t信息不足：需要补充完整表达后再评价。" : "原文中的结论和依据可以用于评价。" })),
    },
  };
}
async function mountPlans(patch: Partial<WorkspaceState>) {
  const seed = { ...createEmptyWorkspace(), ...patch };
  seed.preferences.autoSave = false;
  const repository = createLocalStorageRepository();
  let current!: WorkspaceController;
  function Harness() {
    current = useWorkspace({ initialState: seed, repository });
    return <TrainingPlan controller={current} />;
  }
  render(<Harness />);
  await waitFor(() => expect(current.isHydrated).toBe(true));
  return () => current;
}

describe("TrainingPlan", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("关联练习均分不混入其他场景报告", async () => {
    await mountPlans({ trainingPlans: [plan()], sessions: [scoredSession("weekly", "scenario-weekly-report", 80), scoredSession("interview", "scenario-interview", 20)] });
    const metric = screen.getByText("关联练习平均分").parentElement!;
    expect(within(metric).getByText("80")).toBeTruthy();
    expect(within(metric).queryByText("50")).toBeNull();
  });

  it("同场景已有进行中计划时继续暂停计划不创建第二个进行中计划", async () => {
    const current = await mountPlans({ trainingPlans: [plan("paused", "paused"), plan("active", "active")] });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(current().trainingPlans.filter((item) => item.status === "active" && item.scenarioId === "scenario-weekly-report").map((item) => item.id)).toEqual(["active"]);
  });

  it("完成计划的历史内容不能通过编辑原ID覆盖", async () => {
    const original = plan("history", "completed");
    const current = await mountPlans({ trainingPlans: [original] });
    const edit = screen.queryByRole<HTMLButtonElement>("button", { name: "编辑" });
    if (edit && !edit.disabled) {
      fireEvent.click(edit);
      fireEvent.change(screen.getByLabelText("计划名称"), { target: { value: "覆盖历史的标题" } });
      fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
    }
    expect(current().trainingPlans.find((item) => item.id === original.id)).toEqual(original);
  });

  it("空报告显示无评分且完成任务只改变当前计划", async () => {
    const other = plan("other", "paused");
    const current = await mountPlans({ trainingPlans: [plan(), other], sessions: [] });
    const metric = screen.getByText("关联练习平均分").parentElement!;
    expect(within(metric).getByText("--")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /练习plan/ }));
    expect(current().trainingPlans[0].tasks[0]).toMatchObject({ status: "done", completedAt: expect.any(String) });
    expect(current().trainingPlans[1]).toEqual(other);
  });
  it("训练计划删除需要明确确认，取消不改数据", async () => {
    const current = await mountPlans({ trainingPlans: [plan(), plan("other", "paused")] });
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await act(async () => fireEvent.click(screen.getByText("取消")));
    expect(current().trainingPlans).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认删除" })));
    expect(current().trainingPlans.map((item) => item.id)).toEqual(["other"]);
  });

  it("只有信息不足报告时显示暂不评分、均分占位并禁用报告基线", async () => {
    const insufficient = dimensionedSession("信息不足", 0, true);
    const originalPlan = { ...plan(), linkedSessionIds: [insufficient.id] };
    const current = await mountPlans({ trainingPlans: [originalPlan], sessions: [insufficient] });

    const metric = screen.getByText("关联练习平均分").parentElement!;
    expect(within(metric).getByText("--")).toBeTruthy();
    expect(within(metric).queryByText("0")).toBeNull();
    expect(screen.getByText("报告信息不足 · 暂不评分")).toBeTruthy();
    expect(screen.queryByText("报告信息不足 · 0 分")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const baseline = screen.getByRole<HTMLButtonElement>("button", { name: "使用最近报告评估（暂无可评分的同场景报告）" });
    expect(baseline.disabled).toBe(true);
    fireEvent.click(baseline);
    expect(screen.getByLabelText<HTMLSelectElement>("当前水平").value).toBe("intermediate");
    expect(current().trainingPlans[0]).toEqual(originalPlan);
    expect(current().sessions[0].report).toEqual(insufficient.report);
  });

  it("有依据的真实零分显示为0且可用作基线，更新的信息不足报告不遮蔽它", async () => {
    const zero = dimensionedSession("真实零分", 0);
    const insufficient = dimensionedSession("最新信息不足", 0, true, "2026-09-13T09:00:00.000Z");
    const current = await mountPlans({ trainingPlans: [{ ...plan(), linkedSessionIds: [zero.id, insufficient.id] }], sessions: [insufficient, zero] });

    const metric = screen.getByText("关联练习平均分").parentElement!;
    expect(within(metric).getByText("0")).toBeTruthy();
    expect(within(metric).queryByText("--")).toBeNull();
    expect(screen.getByText("报告真实零分 · 0 分")).toBeTruthy();
    expect(screen.getByText("报告最新信息不足 · 暂不评分")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const baseline = screen.getByRole<HTMLButtonElement>("button", { name: "使用最近报告评估（0 分）" });
    expect(baseline.disabled).toBe(false);
    fireEvent.click(baseline);
    expect(screen.getByLabelText<HTMLSelectElement>("当前水平").value).toBe("beginner");
    fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
    expect(current().trainingPlans[0]).toMatchObject({ levelSource: "baseline", currentLevel: "beginner" });
    expect(current().sessions.find((session) => session.id === zero.id)?.report).toEqual(zero.report);
  });

  it("混合均分保留零分和部分维度有效报告，排除信息不足、未关联及其他场景", async () => {
    const zero = dimensionedSession("零分", 0);
    const partial = dimensionedSession("部分有效", 81);
    partial.report!.dimensions = partial.report!.dimensions.map((dimension, index) => index === 0
      ? dimension : { ...dimension, score: 0, summary: "信息不足：当前材料无法评价此维度。" });
    const insufficient = dimensionedSession("不足", 0, true);
    const unlinked = dimensionedSession("未关联", 100);
    const other = { ...dimensionedSession("其他场景", 20), scenarioId: "scenario-interview" };
    await mountPlans({
      trainingPlans: [{ ...plan(), linkedSessionIds: [zero.id, partial.id, insufficient.id, other.id] }],
      sessions: [insufficient, zero, partial, unlinked, other],
    });

    const metric = screen.getByText("关联练习平均分").parentElement!;
    expect(within(metric).getByText("41")).toBeTruthy();
    expect(screen.getByText("报告零分 · 0 分")).toBeTruthy();
    expect(screen.getByText("报告部分有效 · 81 分")).toBeTruthy();
    expect(screen.getByText("报告不足 · 暂不评分")).toBeTruthy();
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByText(/报告未关联/)).toBeNull();
    expect(screen.queryByText(/报告其他场景/)).toBeNull();
  });

  it("基线按生成时间选择最近有效同场景报告并跳过更新的信息不足报告", async () => {
    const older = dimensionedSession("较早有效", 73, false, "2026-09-11T08:00:00.000Z");
    const insufficient = dimensionedSession("最新不足", 0, true, "2026-09-13T08:00:00.000Z");
    const latest = dimensionedSession("最近有效", 88, false, "2026-09-12T08:00:00.000Z");
    const other = { ...dimensionedSession("其他场景", 100, false, "2026-09-13T09:00:00.000Z"), scenarioId: "scenario-interview" };
    const sessions = [older, insufficient, other, latest];
    const current = await mountPlans({ trainingPlans: [{ ...plan(), linkedSessionIds: [] }], sessions });

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const baseline = screen.getByRole<HTMLButtonElement>("button", { name: "使用最近报告评估（88 分）" });
    expect(baseline.disabled).toBe(false);
    fireEvent.click(baseline);
    expect(screen.getByLabelText<HTMLSelectElement>("当前水平").value).toBe("advanced");
    fireEvent.click(screen.getByRole("button", { name: "保存计划" }));

    expect(current().trainingPlans[0]).toMatchObject({ levelSource: "baseline", currentLevel: "advanced", linkedSessionIds: [] });
    expect(current().sessions.map((session) => session.id)).toEqual(sessions.map((session) => session.id));
    expect(current().sessions.map((session) => session.report)).toEqual(sessions.map((session) => session.report));
  });

  it.each([
    { score: 0, level: "beginner" },
    { score: 72, level: "intermediate" },
  ])("旧报告维度为空时，保留 $score 分展示、平均分和基线", async ({ score, level }) => {
    const legacy = scoredSession("legacy", "scenario-weekly-report", score);
    const current = await mountPlans({ trainingPlans: [{ ...plan(), linkedSessionIds: [legacy.id] }], sessions: [legacy] });

    const metric = screen.getByText("关联练习平均分").parentElement!;
    expect(within(metric).getByText(String(score))).toBeTruthy();
    expect(screen.getByText(`练习报告 · ${score} 分`)).toBeTruthy();
    expect(screen.queryByText(/暂不评分/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const baseline = screen.getByRole<HTMLButtonElement>("button", { name: `使用最近报告评估（${score} 分）` });
    expect(baseline.disabled).toBe(false);
    fireEvent.click(baseline);
    expect(screen.getByLabelText<HTMLSelectElement>("当前水平").value).toBe(level);
    fireEvent.click(screen.getByRole("button", { name: "保存计划" }));
    expect(current().trainingPlans[0]).toMatchObject({ levelSource: "baseline", currentLevel: level });
    expect(current().sessions[0].report).toEqual(legacy.report);
  });

  it("切换到仅有信息不足报告的场景时重新禁用基线评估", async () => {
    const insufficient = dimensionedSession("汇报不足", 0, true);
    const interview = { ...dimensionedSession("面试有效", 90), scenarioId: "scenario-interview" };
    await mountPlans({ trainingPlans: [plan()], sessions: [insufficient, interview] });
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));

    expect(screen.getByRole<HTMLButtonElement>("button", { name: /暂无可评分的同场景报告/ }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("训练场景"), { target: { value: "scenario-interview" } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "使用最近报告评估（90 分）" }).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("训练场景"), { target: { value: "scenario-weekly-report" } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /暂无可评分的同场景报告/ }).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "使用最近报告评估（90 分）" })).toBeNull();
  });
});
