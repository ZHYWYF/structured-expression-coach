import { vi } from "vitest";
import { createEmptyWorkspace } from "../core/defaultWorkspace";
import type { WorkspaceController } from "../core/useWorkspace";

export function createController(overrides: Partial<WorkspaceController> = {}): WorkspaceController {
  const workspace = createEmptyWorkspace();
  return {
    ...workspace,
    selectedSession: null,
    isHydrated: true,
    isSaving: false,
    persistenceError: null,
    navigate: vi.fn(),
    selectSession: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    updateSessionText: vi.fn(),
    updateSession: vi.fn(),
    addStatement: vi.fn(),
    addMessage: vi.fn(),
    setSuggestionStatus: vi.fn(),
    updateTrainingTask: vi.fn(),
    upsertTrainingPlan: vi.fn(),
    deleteTrainingPlan: vi.fn(),
    upsertRecordingTask: vi.fn(),
    deleteRecordingTask: vi.fn(),
    updatePreferences: vi.fn(),
    replaceWorkspace: vi.fn(),
    clearPersistenceError: vi.fn(),
    flush: vi.fn(async () => undefined),
    ...overrides,
  };
}
