import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "./defaultWorkspace";
import type { PracticeSession } from "./types";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  loadDatabase: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: tauriMocks.isTauri,
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: tauriMocks.loadDatabase },
}));

import { createLocalStorageRepository, createRepository } from "./storage";

function createTestWorkspace() {
  const workspace = createEmptyWorkspace();
  const now = new Date().toISOString();
  const session = (id: string, title: string): PracticeSession => ({
    id, title, kind: "practice", scenarioId: "scenario-weekly-report", status: "draft",
    draftText: "", statements: [], messages: [], feedback: [], recordingTaskIds: [], materials: [], createdAt: now, updatedAt: now,
  });
  workspace.sessions = [session("session-one", "会话一"), session("session-two", "会话二")];
  workspace.selectedSessionId = "session-one";
  return workspace;
}

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

describe("LocalStorageRepository", () => {
  beforeEach(() => {
    tauriMocks.isTauri.mockReturnValue(false);
    tauriMocks.loadDatabase.mockReset();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: new MemoryStorage() },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("首次初始化时写入完整工作区，并保持会话相互独立", async () => {
    const repository = createLocalStorageRepository();
    const seed = createTestWorkspace();

    await repository.initialize(seed);
    const loaded = await repository.loadWorkspace();

    expect(loaded).toEqual(seed);
    expect(await repository.getSession("session-one")).toEqual(seed.sessions[0]);
    expect(await repository.getSession("session-two")).toEqual(seed.sessions[1]);
  });

  it("保存工作区后删除已移除的会话，并修正失效的选中项", async () => {
    const repository = createLocalStorageRepository();
    const seed = createTestWorkspace();
    await repository.initialize(seed);

    const remainingSession = seed.sessions[1];
    await repository.saveWorkspace({
      ...seed,
      selectedSessionId: "missing-session",
      sessions: [remainingSession],
    });

    const loaded = await repository.loadWorkspace();
    expect(loaded?.sessions).toEqual([remainingSession]);
    expect(loaded?.selectedSessionId).toBe(remainingSession.id);
    expect(await repository.getSession(seed.sessions[0].id)).toBeNull();
  });

  it("读取到损坏的工作区数据时安全返回空值", async () => {
    window.localStorage.setItem("structured-expression-coach:workspace:v1", "not-json");
    const repository = createLocalStorageRepository();

    expect(await repository.loadWorkspace()).toBeNull();
  });

  it("会话增删改不会泄漏调用方对象引用", async () => {
    const repository = createLocalStorageRepository();
    const seed = createTestWorkspace();
    await repository.initialize(seed);

    const added = {
      ...seed.sessions[1],
      id: "session-added",
      title: "新增会话",
    };
    await repository.saveSession(added);
    added.title = "调用方后续修改";

    expect((await repository.getSession("session-added"))?.title).toBe("新增会话");

    const listed = await repository.listSessions();
    listed[0].title = "列表结果后续修改";
    expect((await repository.getSession(listed[0].id))?.title).not.toBe("列表结果后续修改");

    await repository.deleteSession("session-added");
    expect(await repository.getSession("session-added")).toBeNull();
  });

  it("已有工作区存在时初始化不会覆盖用户数据", async () => {
    const repository = createLocalStorageRepository();
    const seed = createTestWorkspace();
    await repository.initialize(seed);

    const changed = { ...seed, currentPage: "settings" as const };
    await repository.saveWorkspace(changed);
    await repository.initialize(createTestWorkspace());

    expect((await repository.loadWorkspace())?.currentPage).toBe("settings");
  });

  it("非 Tauri 环境使用本地存储仓储", async () => {
    const repository = await createRepository(createTestWorkspace());

    expect(repository.kind).toBe("localStorage");
    expect(await repository.loadWorkspace()).not.toBeNull();
    expect(tauriMocks.loadDatabase).not.toHaveBeenCalled();
  });

  it("SQLite 初始化失败时降级为本地存储仓储", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.loadDatabase.mockRejectedValueOnce(new Error("database unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const repository = await createRepository(createTestWorkspace());

    expect(repository.kind).toBe("localStorage");
    expect(await repository.loadWorkspace()).not.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
