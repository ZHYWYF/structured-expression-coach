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

  it("语法合法但结构损坏的工作区数据应安全返回空值", async () => {
    window.localStorage.setItem(
      "structured-expression-coach:workspace:v1",
      JSON.stringify({ version: 1 }),
    );
    window.localStorage.setItem("structured-expression-coach:sessions:v1", "[]");

    const repository = createLocalStorageRepository();

    expect(await repository.loadWorkspace()).toBeNull();
  });
});
