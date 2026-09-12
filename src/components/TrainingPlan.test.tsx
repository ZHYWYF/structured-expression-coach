// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
});
