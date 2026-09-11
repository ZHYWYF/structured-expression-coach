import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalStorageRepository } from "./storage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("LocalStorageRepository workspace validation", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("版本 1 的空工作区可以迁移为版本 2", async () => {
    window.localStorage.setItem(
      "structured-expression-coach:workspace:v1",
      JSON.stringify({
        version: 1, currentPage: "home", selectedSessionId: null, scenarios: [], trainingPlans: [], recordingTasks: [],
        preferences: { theme: "system", autoSave: true, defaultSessionKind: "practice", transcriptionProvider: "demo", language: "zh-CN" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    window.localStorage.setItem("structured-expression-coach:sessions:v1", "[]");

    const repository = createLocalStorageRepository();

    const workspace = await repository.loadWorkspace();
    expect(workspace?.version).toBe(2);
    expect(workspace?.sessions).toEqual([]);
    expect(workspace?.preferences.transcriptionProvider).toBe("local");
  });
});
