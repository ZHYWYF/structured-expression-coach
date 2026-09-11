export type Id = string;
export type ISODateTime = string;

export type WorkspacePage =
  | "home"
  | "workspace"
  | "interviews"
  | "training"
  | "recordings"
  | "reports"
  | "settings";

export type SessionKind = "practice" | "interview" | "recording-review";
export type SessionStatus = "draft" | "active" | "completed" | "archived";
export type MessageRole = "user" | "coach" | "system";
export type SuggestionStatus = "pending" | "accepted" | "dismissed";
export type FeedbackSeverity = "info" | "warning" | "critical";
export type MaterialKind = "job-description" | "resume" | "reference" | "note";
export type RecordingStatus = "queued" | "recording" | "transcribing" | "completed" | "failed";
export type TrainingTaskStatus = "todo" | "in-progress" | "done" | "skipped";
export type TrainingPlanStatus = "draft" | "active" | "paused" | "completed" | "archived";
export type TrainingLevelSource = "self-assessment" | "baseline";
export type ProviderKind = "ai" | "online-asr";
export type ModelInstallStatus = "not-installed" | "downloading" | "paused" | "verifying" | "ready" | "failed";

export interface Scenario {
  id: Id;
  title: string;
  description: string;
  category: "work-report" | "meeting" | "presentation" | "interview" | "free-practice";
  prompt: string;
  goals: string[];
  suggestedMinutes: number;
  tags: string[];
}

export interface Material {
  id: Id;
  kind: MaterialKind;
  title: string;
  content: string;
  sourceName?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface StatementMetrics {
  wordCount: number;
  durationSeconds?: number;
  fillerWordCount: number;
  repeatedPhraseCount: number;
  averageSentenceLength: number;
}

export interface Statement {
  id: Id;
  sessionId: Id;
  text: string;
  source: "typed" | "transcript" | "generated";
  order: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  metrics?: StatementMetrics;
}

export interface Message {
  id: Id;
  sessionId: Id;
  role: MessageRole;
  content: string;
  statementId?: Id;
  createdAt: ISODateTime;
}

export interface FeedbackEvidence {
  quote: string;
  explanation: string;
  startOffset?: number;
  endOffset?: number;
}

export interface FeedbackSuggestion {
  id: Id;
  title: string;
  description: string;
  replacement?: string;
  status: SuggestionStatus;
}

export interface Feedback {
  id: Id;
  sessionId: Id;
  statementId?: Id;
  category: "structure" | "clarity" | "evidence" | "brevity" | "confidence" | "language";
  severity: FeedbackSeverity;
  title: string;
  summary: string;
  score?: number;
  evidence: FeedbackEvidence[];
  suggestions: FeedbackSuggestion[];
  createdAt: ISODateTime;
}

export interface ScoreDimension {
  key: "structure" | "clarity" | "evidence" | "brevity" | "confidence";
  label: string;
  score: number;
  summary: string;
}

export interface Report {
  id: Id;
  sessionId: Id;
  title: string;
  overallScore: number;
  dimensions: ScoreDimension[];
  strengths: string[];
  improvements: string[];
  actionItems: string[];
  generatedAt: ISODateTime;
}

export interface TrainingTask {
  id: Id;
  title: string;
  description: string;
  scenarioId?: Id;
  targetMinutes: number;
  status: TrainingTaskStatus;
  dueDate?: string;
  completedAt?: ISODateTime;
}

export interface TrainingPlan {
  id: Id;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  focusAreas: string[];
  scenarioId: Id;
  goals: string[];
  currentLevel: "beginner" | "intermediate" | "advanced";
  levelSource: TrainingLevelSource;
  status: TrainingPlanStatus;
  tasks: TrainingTask[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface RecordingTask {
  id: Id;
  sessionId: Id;
  title: string;
  status: RecordingStatus;
  audioPath?: string;
  durationSeconds?: number;
  progress: number;
  transcript?: string;
  transcriptSegments?: Array<{ id: Id; startMs: number; endMs: number; text: string; speakerLabel?: string }>;
  provider?: "local" | "online";
  sourceFileName?: string;
  sourceMimeType?: string;
  remoteAudioId?: string;
  reportStatus?: "not-generated" | "generating" | "ready" | "outdated" | "failed";
  errorMessage?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SessionBase {
  id: Id;
  kind: SessionKind;
  title: string;
  scenarioId: Id;
  status: SessionStatus;
  draftText: string;
  statements: Statement[];
  messages: Message[];
  feedback: Feedback[];
  report?: Report;
  recordingTaskIds: Id[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface InterviewSession extends SessionBase {
  kind: "interview";
  jobDescription: Material;
  resume: Material;
  questionAnswers?: Record<string, string>;
  activeQuestionIndex?: number;
  materialsLocked?: boolean;
  interviewQuestions?: InterviewQuestion[];
  interviewFeedback?: Record<string, InterviewAnswerFeedback>;
  materials: Material[];
}

export interface InterviewQuestion {
  id: Id;
  tag: string;
  text: string;
  suggestedMinutes: number;
  source: "local" | "ai";
  jdEvidence?: string;
}

export interface InterviewAnswerFeedback {
  structure: string;
  jdMatch: string;
  resumeConsistency: string;
  evidenceStrength: string;
  overallSuggestion: string;
  createdAt: ISODateTime;
}

export interface PracticeSession extends SessionBase {
  kind: "practice" | "recording-review";
  materials: Material[];
  jobDescription?: never;
  resume?: never;
}

export type Session = InterviewSession | PracticeSession;

export interface WorkspacePreferences {
  theme: "system" | "light" | "dark";
  autoSave: boolean;
  defaultSessionKind: SessionKind;
  transcriptionProvider: "local" | "online";
  language: "zh-CN";
  aiProvider: ProviderConfiguration;
  onlineAsrProvider: ProviderConfiguration;
  sync: SyncConfiguration;
  installedModels: InstalledModel[];
}

export interface ProviderConfiguration {
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

export interface InstalledModel {
  id: string;
  label: string;
  fileName: string;
  sizeBytes: number;
  status: ModelInstallStatus;
  progress: number;
  localPath?: string;
  errorMessage?: string;
}

export interface SyncConfiguration {
  enabled: boolean;
  endpoint: string;
  account: string;
  deviceName: string;
  lastSyncedAt: ISODateTime | null;
  status: "not-configured" | "idle" | "syncing" | "error";
  errorMessage?: string;
}

export interface WorkspaceState {
  version: 2;
  currentPage: WorkspacePage;
  selectedSessionId: Id | null;
  sessions: Session[];
  scenarios: Scenario[];
  trainingPlans: TrainingPlan[];
  recordingTasks: RecordingTask[];
  tombstones: Tombstone[];
  preferences: WorkspacePreferences;
  updatedAt: ISODateTime;
}

export interface PersistedWorkspaceState {
  version: 2;
  currentPage: WorkspacePage;
  selectedSessionId: Id | null;
  scenarios: Scenario[];
  trainingPlans: TrainingPlan[];
  recordingTasks: RecordingTask[];
  tombstones: Tombstone[];
  preferences: WorkspacePreferences;
  updatedAt: ISODateTime;
}

export interface Tombstone {
  entityType: "session" | "training-plan" | "recording";
  entityId: Id;
  deletedAt: ISODateTime;
}

export type NewSessionInput =
  | {
      kind: "interview";
      title?: string;
      scenarioId?: Id;
      jobDescription?: Pick<Material, "title" | "content">;
      resume?: Pick<Material, "title" | "content">;
    }
  | {
      kind?: "practice" | "recording-review";
      title?: string;
      scenarioId?: Id;
    };

export function isInterviewSession(session: Session): session is InterviewSession {
  return session.kind === "interview";
}
