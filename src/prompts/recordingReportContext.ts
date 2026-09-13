import type { RecordingAnalysisScenario, Scenario, TrainingPlan } from "../core/types";

export interface RecordingReportContext {
  goals: string[];
  focusAreas: string[];
}

const categories: Record<RecordingAnalysisScenario, Scenario["category"][]> = {
  general: ["free-practice", "presentation"],
  interview: ["interview"],
  report: ["work-report"],
  retrospective: ["meeting"],
};

export function boundedReportGoals(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 6).map((value) => value.slice(0, 160));
}

// Derive request context without changing sessions, plans or their storage schema.
// A plan linked to a different conversation must never become report context.
export function recordingReportContext(scenario: RecordingAnalysisScenario, sessionId: string, scenarios: Scenario[], plans: TrainingPlan[]): RecordingReportContext {
  const matching = scenarios.filter((item) => categories[scenario].includes(item.category));
  const candidates = plans.filter((plan) => plan.status === "active" && matching.some((item) => item.id === plan.scenarioId));
  const linked = candidates.filter((plan) => plan.linkedSessionIds?.includes(sessionId));
  const unlinked = candidates.filter((plan) => !plan.linkedSessionIds?.length);
  // Ambiguous active plans are not silently chosen on the user's behalf.
  const applicable = linked.length ? linked : unlinked;
  const plan = applicable.length === 1 ? applicable[0] : undefined;
  return {
    goals: boundedReportGoals(plan?.goals.length ? plan.goals : matching.flatMap((item) => item.goals)),
    focusAreas: boundedReportGoals(plan?.focusAreas ?? []),
  };
}
