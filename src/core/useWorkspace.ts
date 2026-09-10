import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDemoWorkspace } from "./demoData";
import { createRepository, type Repository } from "./storage";
import type {
  FeedbackSuggestion,
  InterviewSession,
  Material,
  Message,
  NewSessionInput,
  RecordingTask,
  Session,
  Statement,
  SuggestionStatus,
  TrainingTaskStatus,
  WorkspacePage,
  WorkspacePreferences,
  WorkspaceState,
} from "./types";

export interface UseWorkspaceOptions {
  repository?: Repository;
  initialState?: WorkspaceState;
  persistDelayMs?: number;
}

export interface WorkspaceController extends WorkspaceState {
  selectedSession: Session | null;
  isHydrated: boolean;
  isSaving: boolean;
  persistenceError: string | null;
  navigate(page: WorkspacePage): void;
  selectSession(sessionId: string): void;
  createSession(input?: NewSessionInput): Session;
  deleteSession(sessionId: string): void;
  updateSessionText(text: string, sessionId?: string): void;
  updateSession(sessionId: string, updater: (session: Session) => Session): void;
  addStatement(input: Omit<Statement, "id" | "sessionId" | "order" | "createdAt" | "updatedAt">, sessionId?: string): Statement | null;
  addMessage(input: Omit<Message, "id" | "sessionId" | "createdAt">, sessionId?: string): Message | null;
  setSuggestionStatus(suggestionId: string, status: SuggestionStatus, sessionId?: string): void;
  updateTrainingTask(planId: string, taskId: string, status: TrainingTaskStatus): void;
  upsertRecordingTask(task: RecordingTask): void;
  updatePreferences(patch: Partial<WorkspacePreferences>): void;
  clearPersistenceError(): void;
  flush(): Promise<void>;
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createMaterial(kind: "job-description" | "resume", value?: Pick<Material, "title" | "content">): Material {
  const now = new Date().toISOString();
  return {
    id: newId(kind === "resume" ? "resume" : "jd"),
    kind,
    title: value?.title ?? (kind === "resume" ? "未命名简历" : "未命名职位描述"),
    content: value?.content ?? "",
    createdAt: now,
    updatedAt: now,
  };
}

function buildSession(input: NewSessionInput, workspace: WorkspaceState): Session {
  const now = new Date().toISOString();
  const kind = input.kind ?? workspace.preferences.defaultSessionKind;
  const scenarioId =
    input.scenarioId ??
    workspace.scenarios.find((scenario) =>
      kind === "interview" ? scenario.category === "interview" : scenario.category !== "interview",
    )?.id ??
    workspace.scenarios[0]?.id ??
    "scenario-free-practice";
  const base = {
    id: newId("session"),
    kind,
    title: input.title ?? (kind === "interview" ? "新的面试会话" : "新的表达练习"),
    scenarioId,
    status: "draft" as const,
    draftText: "",
    statements: [],
    messages: [],
    feedback: [],
    recordingTaskIds: [],
    materials: [],
    createdAt: now,
    updatedAt: now,
  };

  if (kind === "interview") {
    const interviewInput = input as Extract<NewSessionInput, { kind: "interview" }>;
    return {
      ...base,
      kind: "interview",
      jobDescription: createMaterial("job-description", interviewInput.jobDescription),
      resume: createMaterial("resume", interviewInput.resume),
      questionAnswers: {},
      activeQuestionIndex: 0,
      materialsLocked: false,
    } satisfies InterviewSession;
  }

  return { ...base, kind };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "本地数据写入失败";
}

export function useWorkspace(options: UseWorkspaceOptions = {}): WorkspaceController {
  const initialState = useMemo(
    () => options.initialState ?? createDemoWorkspace(),
    [options.initialState],
  );
  const [workspace, setWorkspace] = useState<WorkspaceState>(initialState);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const repositoryRef = useRef<Repository | null>(options.repository ?? null);
  const workspaceRef = useRef(workspace);
  const saveSequenceRef = useRef(0);
  const autoSaveRef = useRef(initialState.preferences.autoSave);
  const persistDelayMs = options.persistDelayMs ?? 250;

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const repository = repositoryRef.current ?? (await createRepository(initialState));
        repositoryRef.current = repository;
        await repository.initialize(initialState);
        const stored = await repository.loadWorkspace();
        if (!cancelled && stored) setWorkspace(stored);
      } catch (error) {
        if (!cancelled) setPersistenceError(errorMessage(error));
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialState]);

  useEffect(() => {
    if (!isHydrated) return;
    const isAutoSaveTransition = autoSaveRef.current !== workspace.preferences.autoSave;
    autoSaveRef.current = workspace.preferences.autoSave;
    if (!workspace.preferences.autoSave && !isAutoSaveTransition) return;
    const sequence = ++saveSequenceRef.current;
    const timer = window.setTimeout(() => {
      const repository = repositoryRef.current;
      if (!repository) return;
      setIsSaving(true);
      void repository
        .saveWorkspace(workspace)
        .then(() => {
          if (sequence === saveSequenceRef.current) setPersistenceError(null);
        })
        .catch((error: unknown) => {
          if (sequence === saveSequenceRef.current) setPersistenceError(errorMessage(error));
        })
        .finally(() => {
          if (sequence === saveSequenceRef.current) setIsSaving(false);
        });
    }, persistDelayMs);
    return () => window.clearTimeout(timer);
  }, [isHydrated, persistDelayMs, workspace]);

  const mutate = useCallback((updater: (current: WorkspaceState) => WorkspaceState) => {
    setWorkspace((current) => {
      const next = updater(current);
      const committed = { ...next, updatedAt: new Date().toISOString() };
      workspaceRef.current = committed;
      return committed;
    });
  }, []);

  const navigate = useCallback(
    (page: WorkspacePage) => mutate((current) => ({ ...current, currentPage: page })),
    [mutate],
  );

  const selectSession = useCallback(
    (sessionId: string) =>
      mutate((current) => ({
        ...current,
        selectedSessionId: current.sessions.some((session) => session.id === sessionId)
          ? sessionId
          : current.selectedSessionId,
      })),
    [mutate],
  );

  const createSession = useCallback(
    (input: NewSessionInput = { kind: "practice" }) => {
      const session = buildSession(input, workspaceRef.current);
      mutate((current) => ({
        ...current,
        currentPage: session.kind === "interview" ? "interviews" : "workspace",
        selectedSessionId: session.id,
        sessions: [session, ...current.sessions],
      }));
      return session;
    },
    [mutate],
  );

  const deleteSession = useCallback(
    (sessionId: string) =>
      mutate((current) => {
        const sessions = current.sessions.filter((session) => session.id !== sessionId);
        return {
          ...current,
          sessions,
          recordingTasks: current.recordingTasks.filter((task) => task.sessionId !== sessionId),
          selectedSessionId:
            current.selectedSessionId === sessionId
              ? (sessions[0]?.id ?? null)
              : current.selectedSessionId,
        };
      }),
    [mutate],
  );

  const updateSession = useCallback(
    (sessionId: string, updater: (session: Session) => Session) =>
      mutate((current) => ({
        ...current,
        sessions: current.sessions.map((session) =>
          session.id === sessionId
            ? { ...updater(session), id: session.id, updatedAt: new Date().toISOString() }
            : session,
        ),
      })),
    [mutate],
  );

  const resolveSessionId = useCallback(
    (sessionId?: string) => sessionId ?? workspaceRef.current.selectedSessionId,
    [],
  );

  const updateSessionText = useCallback(
    (text: string, sessionId?: string) => {
      const id = resolveSessionId(sessionId);
      if (id) updateSession(id, (session) => ({ ...session, draftText: text }));
    },
    [resolveSessionId, updateSession],
  );

  const addStatement = useCallback(
    (
      input: Omit<Statement, "id" | "sessionId" | "order" | "createdAt" | "updatedAt">,
      sessionId?: string,
    ): Statement | null => {
      const id = resolveSessionId(sessionId);
      const session = workspaceRef.current.sessions.find((item) => item.id === id);
      if (!id || !session) return null;
      const now = new Date().toISOString();
      const statement: Statement = {
        ...input,
        id: newId("statement"),
        sessionId: id,
        order: session.statements.length,
        createdAt: now,
        updatedAt: now,
      };
      updateSession(id, (current) => ({ ...current, statements: [...current.statements, statement] }));
      return statement;
    },
    [resolveSessionId, updateSession],
  );

  const addMessage = useCallback(
    (input: Omit<Message, "id" | "sessionId" | "createdAt">, sessionId?: string): Message | null => {
      const id = resolveSessionId(sessionId);
      if (!id || !workspaceRef.current.sessions.some((session) => session.id === id)) return null;
      const message: Message = {
        ...input,
        id: newId("message"),
        sessionId: id,
        createdAt: new Date().toISOString(),
      };
      updateSession(id, (session) => ({ ...session, messages: [...session.messages, message] }));
      return message;
    },
    [resolveSessionId, updateSession],
  );

  const setSuggestionStatus = useCallback(
    (suggestionId: string, status: SuggestionStatus, sessionId?: string) => {
      const id = resolveSessionId(sessionId);
      if (!id) return;
      updateSession(id, (session) => ({
        ...session,
        feedback: session.feedback.map((feedback) => ({
          ...feedback,
          suggestions: feedback.suggestions.map((suggestion): FeedbackSuggestion =>
            suggestion.id === suggestionId ? { ...suggestion, status } : suggestion,
          ),
        })),
      }));
    },
    [resolveSessionId, updateSession],
  );

  const updateTrainingTask = useCallback(
    (planId: string, taskId: string, status: TrainingTaskStatus) =>
      mutate((current) => ({
        ...current,
        trainingPlans: current.trainingPlans.map((plan) =>
          plan.id === planId
            ? {
                ...plan,
                updatedAt: new Date().toISOString(),
                tasks: plan.tasks.map((task) =>
                  task.id === taskId
                    ? {
                        ...task,
                        status,
                        completedAt: status === "done" ? new Date().toISOString() : undefined,
                      }
                    : task,
                ),
              }
            : plan,
        ),
      })),
    [mutate],
  );

  const upsertRecordingTask = useCallback(
    (task: RecordingTask) =>
      mutate((current) => {
        const exists = current.recordingTasks.some((item) => item.id === task.id);
        return {
          ...current,
          recordingTasks: exists
            ? current.recordingTasks.map((item) => (item.id === task.id ? task : item))
            : [task, ...current.recordingTasks],
          sessions: current.sessions.map((session) =>
            session.id === task.sessionId && !session.recordingTaskIds.includes(task.id)
              ? { ...session, recordingTaskIds: [...session.recordingTaskIds, task.id] }
              : session,
          ),
        };
      }),
    [mutate],
  );

  const updatePreferences = useCallback(
    (patch: Partial<WorkspacePreferences>) =>
      mutate((current) => ({
        ...current,
        preferences: { ...current.preferences, ...patch },
      })),
    [mutate],
  );

  const flush = useCallback(async () => {
    const repository = repositoryRef.current;
    if (!repository) return;
    setIsSaving(true);
    try {
      await repository.saveWorkspace(workspaceRef.current);
      setPersistenceError(null);
    } catch (error) {
      setPersistenceError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }, []);

  const selectedSession = useMemo(
    () => workspace.sessions.find((session) => session.id === workspace.selectedSessionId) ?? null,
    [workspace.selectedSessionId, workspace.sessions],
  );

  return {
    ...workspace,
    selectedSession,
    isHydrated,
    isSaving,
    persistenceError,
    navigate,
    selectSession,
    createSession,
    deleteSession,
    updateSessionText,
    updateSession,
    addStatement,
    addMessage,
    setSuggestionStatus,
    updateTrainingTask,
    upsertRecordingTask,
    updatePreferences,
    clearPersistenceError: () => setPersistenceError(null),
    flush,
  };
}
