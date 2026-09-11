import { isTauri } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { createEmptyWorkspace } from "./defaultWorkspace";
import type { PersistedWorkspaceState, Session, WorkspaceState } from "./types";

const DATABASE_URL = "sqlite:structured-expression-coach.db";
const LOCAL_WORKSPACE_KEY = "structured-expression-coach:workspace:v1";
const LOCAL_SESSIONS_KEY = "structured-expression-coach:sessions:v1";
const WORKSPACE_ID = "default";

export interface Repository {
  readonly kind: "sqlite" | "localStorage";
  initialize(seed?: WorkspaceState): Promise<void>;
  loadWorkspace(): Promise<WorkspaceState | null>;
  saveWorkspace(workspace: WorkspaceState): Promise<void>;
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function workspaceWithoutSessions(workspace: WorkspaceState): PersistedWorkspaceState {
  const { sessions: _sessions, ...rest } = workspace;
  return rest;
}

function combineWorkspace(shell: PersistedWorkspaceState, sessions: Session[]): WorkspaceState {
  const selectedSessionId = sessions.some((session) => session.id === shell.selectedSessionId)
    ? shell.selectedSessionId
    : (sessions[0]?.id ?? null);

  return {
    ...shell,
    selectedSessionId,
    sessions,
  };
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPersistedWorkspaceState(value: unknown): value is PersistedWorkspaceState {
  if (!isRecord(value) || value.version !== 2) return false;
  if (!["home", "workspace", "interviews", "training", "recordings", "reports", "settings"].includes(String(value.currentPage))) return false;
  if (value.selectedSessionId !== null && typeof value.selectedSessionId !== "string") return false;
  if (!Array.isArray(value.scenarios) || !Array.isArray(value.trainingPlans) || !Array.isArray(value.recordingTasks) || !Array.isArray(value.tombstones)) return false;
  if (!isRecord(value.preferences)) return false;
  return (
    ["system", "light", "dark"].includes(String(value.preferences.theme)) &&
    typeof value.preferences.autoSave === "boolean" &&
    ["practice", "interview", "recording-review"].includes(String(value.preferences.defaultSessionKind)) &&
    ["local", "online"].includes(String(value.preferences.transcriptionProvider)) &&
    value.preferences.language === "zh-CN" &&
    isRecord(value.preferences.aiProvider) &&
    isRecord(value.preferences.onlineAsrProvider) &&
    isRecord(value.preferences.sync) &&
    Array.isArray(value.preferences.installedModels) &&
    typeof value.updatedAt === "string"
  );
}

const LEGACY_SEED_IDS = new Set([
  "session-interview-growth", "session-weekly-report", "plan-seven-days",
  "recording-weekly-1", "recording-interview-1",
]);

function migrateLegacyWorkspace(value: unknown, sessions: Session[]): WorkspaceState | null {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.preferences)) return null;
  if (!Array.isArray(value.scenarios) || !Array.isArray(value.trainingPlans) || !Array.isArray(value.recordingTasks)) return null;
  const empty = createEmptyWorkspace();
  const migratedSessions = sessions.filter((session) => !LEGACY_SEED_IDS.has(session.id));
  const trainingPlans = value.trainingPlans
    .filter((plan): plan is Record<string, unknown> => isRecord(plan) && typeof plan.id === "string" && !LEGACY_SEED_IDS.has(plan.id))
    .map((plan) => ({
      ...plan,
      scenarioId: typeof plan.scenarioId === "string" ? plan.scenarioId : "scenario-free-practice",
      goals: Array.isArray(plan.goals) ? plan.goals : (Array.isArray(plan.focusAreas) ? plan.focusAreas : []),
      currentLevel: ["beginner", "intermediate", "advanced"].includes(String(plan.currentLevel)) ? plan.currentLevel : "intermediate",
      levelSource: plan.levelSource === "baseline" ? "baseline" : "self-assessment",
      status: ["draft", "active", "paused", "completed", "archived"].includes(String(plan.status)) ? plan.status : "draft",
    })) as WorkspaceState["trainingPlans"];
  const recordingTasks = (value.recordingTasks as WorkspaceState["recordingTasks"]).filter((task) => !LEGACY_SEED_IDS.has(task.id));
  const currentPage = ["home", "workspace", "interviews", "training", "recordings", "reports", "settings"].includes(String(value.currentPage)) ? value.currentPage as WorkspaceState["currentPage"] : "home";
  const selectedSessionId = migratedSessions.some((session) => session.id === value.selectedSessionId) ? value.selectedSessionId as string : migratedSessions[0]?.id ?? null;
  return {
    ...empty,
    currentPage,
    selectedSessionId,
    sessions: migratedSessions,
    trainingPlans,
    recordingTasks,
    preferences: {
      ...empty.preferences,
      theme: ["system", "light", "dark"].includes(String(value.preferences.theme)) ? value.preferences.theme as WorkspaceState["preferences"]["theme"] : "system",
      autoSave: typeof value.preferences.autoSave === "boolean" ? value.preferences.autoSave : true,
      defaultSessionKind: ["practice", "interview", "recording-review"].includes(String(value.preferences.defaultSessionKind)) ? value.preferences.defaultSessionKind as WorkspaceState["preferences"]["defaultSessionKind"] : "practice",
      transcriptionProvider: value.preferences.transcriptionProvider === "online" ? "online" : "local",
    },
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

function hydrateWorkspace(shellValue: unknown, sessions: Session[]): WorkspaceState | null {
  if (isRecord(shellValue) && shellValue.version === 2) {
    const defaults = createEmptyWorkspace();
    const normalized = {
      ...shellValue,
      tombstones: Array.isArray(shellValue.tombstones) ? shellValue.tombstones : [],
      preferences: isRecord(shellValue.preferences)
        ? {
            ...defaults.preferences,
            ...shellValue.preferences,
            aiProvider: isRecord(shellValue.preferences.aiProvider) ? shellValue.preferences.aiProvider : defaults.preferences.aiProvider,
            onlineAsrProvider: isRecord(shellValue.preferences.onlineAsrProvider) ? shellValue.preferences.onlineAsrProvider : defaults.preferences.onlineAsrProvider,
            sync: isRecord(shellValue.preferences.sync) ? shellValue.preferences.sync : defaults.preferences.sync,
            installedModels: Array.isArray(shellValue.preferences.installedModels) ? shellValue.preferences.installedModels : [],
          }
        : defaults.preferences,
    };
    if (isPersistedWorkspaceState(normalized)) return recoverInterruptedRecordings(combineWorkspace(normalized, sessions));
  }
  return migrateLegacyWorkspace(shellValue, sessions);
}

function isSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  const baseIsValid = (
    typeof value.id === "string" &&
    ["practice", "interview", "recording-review"].includes(String(value.kind)) &&
    typeof value.title === "string" &&
    typeof value.scenarioId === "string" &&
    typeof value.draftText === "string" &&
    Array.isArray(value.statements) &&
    Array.isArray(value.messages) &&
    Array.isArray(value.feedback) &&
    Array.isArray(value.recordingTaskIds) &&
    Array.isArray(value.materials) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
  if (!baseIsValid) return false;
  if (value.kind !== "interview") return true;
  return (
    isRecord(value.jobDescription) &&
    typeof value.jobDescription.title === "string" &&
    typeof value.jobDescription.content === "string" &&
    isRecord(value.resume) &&
    typeof value.resume.title === "string" &&
    typeof value.resume.content === "string"
  );
}

function recoverInterruptedRecordings(workspace: WorkspaceState): WorkspaceState {
  const staleBefore = Date.now() - 5 * 60 * 1000;
  return {
    ...workspace,
    recordingTasks: workspace.recordingTasks.map((task) => {
      const updatedAt = Date.parse(task.updatedAt);
      const isInterrupted =
        (task.status === "recording" || task.status === "transcribing") &&
        (!Number.isFinite(updatedAt) || updatedAt < staleBefore);
      return isInterrupted
        ? {
            ...task,
            status: "failed",
            errorMessage: "上次任务已中断，可重新开始转写。",
          }
        : task;
    }),
  };
}

function parseWorkspace(storage: Storage): WorkspaceState | null {
  const shell = parseJson<unknown>(storage.getItem(LOCAL_WORKSPACE_KEY));
  const sessionValue = parseJson<unknown>(storage.getItem(LOCAL_SESSIONS_KEY));
  const sessions = Array.isArray(sessionValue) ? sessionValue.filter(isSession) : [];
  return hydrateWorkspace(shell, sessions);
}

class LocalStorageRepository implements Repository {
  readonly kind = "localStorage" as const;

  private get storage(): Storage | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  async initialize(seed = createEmptyWorkspace()): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    if (!storage.getItem(LOCAL_WORKSPACE_KEY)) {
      await this.saveWorkspace(seed);
    }
  }

  async loadWorkspace(): Promise<WorkspaceState | null> {
    const storage = this.storage;
    if (!storage) return null;
    return parseWorkspace(storage);
  }

  async saveWorkspace(workspace: WorkspaceState): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    storage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(workspaceWithoutSessions(workspace)));
    storage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(workspace.sessions));
  }

  async listSessions(): Promise<Session[]> {
    const storage = this.storage;
    if (!storage) return [];
    return clone(parseJson<Session[]>(storage.getItem(LOCAL_SESSIONS_KEY)) ?? []);
  }

  async getSession(id: string): Promise<Session | null> {
    const session = (await this.listSessions()).find((item) => item.id === id);
    return session ?? null;
  }

  async saveSession(session: Session): Promise<void> {
    const sessions = await this.listSessions();
    const index = sessions.findIndex((item) => item.id === session.id);
    if (index >= 0) sessions[index] = clone(session);
    else sessions.push(clone(session));
    this.storage?.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(sessions));
  }

  async deleteSession(id: string): Promise<void> {
    const sessions = (await this.listSessions()).filter((session) => session.id !== id);
    this.storage?.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(sessions));
  }
}

interface WorkspaceRow {
  payload: string;
}

interface SessionRow {
  payload: string;
}

class SqliteRepository implements Repository {
  readonly kind = "sqlite" as const;
  private db: Database | null = null;

  private async database(): Promise<Database> {
    if (!this.db) this.db = await Database.load(DATABASE_URL);
    return this.db;
  }

  async initialize(seed = createEmptyWorkspace()): Promise<void> {
    const db = await this.database();
    await db.execute(
      `CREATE TABLE IF NOT EXISTS workspace_state (
        id TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    await db.execute(
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    );
    const rows = await db.select<Array<{ count: number }>>(
      "SELECT COUNT(*) AS count FROM workspace_state WHERE id = $1",
      [WORKSPACE_ID],
    );
    if (Number(rows[0]?.count ?? 0) === 0) await this.saveWorkspace(seed);
  }

  async loadWorkspace(): Promise<WorkspaceState | null> {
    const db = await this.database();
    const rows = await db.select<WorkspaceRow[]>(
      "SELECT payload FROM workspace_state WHERE id = $1 LIMIT 1",
      [WORKSPACE_ID],
    );
    const shell = parseJson<unknown>(rows[0]?.payload ?? null);
    return hydrateWorkspace(shell, await this.listSessions());
  }

  async saveWorkspace(workspace: WorkspaceState): Promise<void> {
    const db = await this.database();
    const shell = workspaceWithoutSessions(workspace);
    await db.execute(
      `INSERT INTO workspace_state (id, payload, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      [WORKSPACE_ID, JSON.stringify(shell), workspace.updatedAt],
    );

    for (const session of workspace.sessions) await this.saveSession(session);

    const ids = workspace.sessions.map((session) => session.id);
    if (ids.length === 0) {
      await db.execute("DELETE FROM sessions");
    } else {
      const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
      await db.execute(`DELETE FROM sessions WHERE id NOT IN (${placeholders})`, ids);
    }
  }

  async listSessions(): Promise<Session[]> {
    const db = await this.database();
    const rows = await db.select<SessionRow[]>(
      "SELECT payload FROM sessions ORDER BY updated_at DESC",
    );
    return rows.flatMap((row) => {
      const session = parseJson<unknown>(row.payload);
      return isSession(session) ? [session] : [];
    });
  }

  async getSession(id: string): Promise<Session | null> {
    const db = await this.database();
    const rows = await db.select<SessionRow[]>(
      "SELECT payload FROM sessions WHERE id = $1 LIMIT 1",
      [id],
    );
    const session = parseJson<unknown>(rows[0]?.payload ?? null);
    return isSession(session) ? session : null;
  }

  async saveSession(session: Session): Promise<void> {
    const db = await this.database();
    await db.execute(
      `INSERT INTO sessions (id, kind, title, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      [session.id, session.kind, session.title, JSON.stringify(session), session.updatedAt],
    );
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.database();
    await db.execute("DELETE FROM sessions WHERE id = $1", [id]);
  }
}

export function createLocalStorageRepository(): Repository {
  return new LocalStorageRepository();
}

export function createSqliteRepository(): Repository {
  return new SqliteRepository();
}

export async function createRepository(seed = createEmptyWorkspace()): Promise<Repository> {
  if (typeof window !== "undefined" && isTauri()) {
    try {
      const repository = createSqliteRepository();
      await repository.initialize(seed);
      return repository;
    } catch (error) {
      console.warn("SQLite 初始化失败，已降级为浏览器本地存储。", error);
    }
  }

  const repository = createLocalStorageRepository();
  await repository.initialize(seed);
  return repository;
}
