import { describe, expect, it } from "vitest";
import { createEmptyWorkspace, defaultScenarios } from "./defaultWorkspace";

describe("createEmptyWorkspace", () => {
  it("creates a real empty workspace with local-only defaults", () => {
    const workspace = createEmptyWorkspace();

    expect(workspace.version).toBe(2);
    expect(workspace.sessions).toEqual([]);
    expect(workspace.trainingPlans).toEqual([]);
    expect(workspace.recordingTasks).toEqual([]);
    expect(workspace.selectedSessionId).toBeNull();
    expect(workspace.preferences.transcriptionProvider).toBe("local");
    expect(workspace.preferences.aiProvider.enabled).toBe(false);
    expect(workspace.preferences.onlineAsrProvider.enabled).toBe(false);
    expect(workspace.preferences.installedModels).toEqual([]);
  });

  it("does not share mutable scenario collections between workspaces", () => {
    const first = createEmptyWorkspace();
    const second = createEmptyWorkspace();

    first.scenarios[0].goals.push("新增目标");
    first.scenarios[0].tags.push("新增标签");

    expect(second.scenarios[0].goals).toEqual(defaultScenarios[0].goals);
    expect(second.scenarios[0].tags).toEqual(defaultScenarios[0].tags);
  });
});
