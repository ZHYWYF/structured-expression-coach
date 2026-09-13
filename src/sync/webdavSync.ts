import type { RecordingTask, Session, Tombstone, TrainingPlan, WorkspaceState } from "../core/types";
import { loadAudioFile, saveAudioFile } from "../transcription/audioStore";
import { appFetch } from "../providers/http";
import { validateSyncWorkspace } from "../core/storage";

interface SyncCredentials { endpoint: string; username: string; password: string }
interface SyncResult { workspace: WorkspaceState; uploadedAudio: number; downloadedAudio: number; conflicts: number; warnings: string[] }

function authorization(credentials: SyncCredentials): string {
  return `Basic ${btoa(unescape(encodeURIComponent(`${credentials.username}:${credentials.password}`)))}`;
}
function baseUrl(endpoint: string): string {
  const value = endpoint.trim();
  if (!value) throw new Error("请先填写同步服务地址（WebDAV），再测试连接");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("同步服务地址格式不正确，请填写包含 https:// 的完整 WebDAV 地址"); }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) throw new Error("同步地址必须使用 HTTPS；仅本机 localhost 允许 HTTP");
  return value.replace(/\/+$/, "");
}
function requestHeaders(credentials: SyncCredentials, contentType?: string): Record<string, string> {
  return { Authorization: authorization(credentials), ...(contentType ? { "Content-Type": contentType } : {}) };
}
function isWorkspace(value: unknown): value is WorkspaceState {
  return validateSyncWorkspace(value);
}
function updatedAfter(value: { updatedAt: string }, timestamp: string | null): boolean {
  return !timestamp || Date.parse(value.updatedAt) > Date.parse(timestamp);
}
function comparable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(comparable).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([key]) => !["remoteAudioId", "audioPath"].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ":" + comparable(item)).join(",") + "}";
  return JSON.stringify(value);
}
function conflictCopy<T extends { id: string; title: string; updatedAt: string }>(value: T, deviceName: string): T {
  return { ...value, id: `${value.id}-conflict-${crypto.randomUUID()}`, title: `${value.title}（来自 ${deviceName || "另一设备"} 的冲突副本）` };
}
function mergeEntities<T extends { id: string; title: string; updatedAt: string }>(local: T[], remote: T[], lastSyncedAt: string | null, remoteDevice: string): { items: T[]; conflicts: number; conflictIds: Map<string, string> } {
  const result = new Map(local.map((item) => [item.id, item]));
  let conflicts = 0;
  const conflictIds = new Map<string, string>();
  for (const remoteItem of remote) {
    const localItem = result.get(remoteItem.id);
    if (!localItem) { result.set(remoteItem.id, remoteItem); continue; }
    const localChanged = updatedAfter(localItem, lastSyncedAt);
    const remoteChanged = updatedAfter(remoteItem, lastSyncedAt);
    if (localChanged && remoteChanged && comparable(localItem) !== comparable(remoteItem)) {
      const copy = conflictCopy(remoteItem, remoteDevice);
      result.set(copy.id, copy); conflictIds.set(remoteItem.id, copy.id); conflicts += 1;
    } else if (Date.parse(remoteItem.updatedAt) > Date.parse(localItem.updatedAt)) result.set(remoteItem.id, remoteItem);
  }
  return { items: [...result.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), conflicts, conflictIds };
}
function mergeTombstones(local: Tombstone[], remote: Tombstone[]): Tombstone[] {
  const result = new Map<string, Tombstone>();
  for (const item of [...local, ...remote]) {
    const key = `${item.entityType}:${item.entityId}`;
    const existing = result.get(key);
    if (!existing || Date.parse(item.deletedAt) > Date.parse(existing.deletedAt)) result.set(key, item);
  }
  return [...result.values()];
}
function removeDeleted<T extends { id: string; updatedAt: string }>(items: T[], tombstones: Tombstone[], entityType: Tombstone["entityType"]): T[] {
  const deleted = new Map(tombstones.filter((item) => item.entityType === entityType).map((item) => [item.entityId, item.deletedAt]));
  return items.filter((item) => !deleted.has(item.id));
}
export function mergeWorkspace(local: WorkspaceState, remote: WorkspaceState): { workspace: WorkspaceState; conflicts: number } {
  const lastSync = local.preferences.sync.lastSyncedAt;
  const tombstones = mergeTombstones(local.tombstones, remote.tombstones);
  const sessions = mergeEntities<Session>(removeDeleted(local.sessions, tombstones, "session"), removeDeleted(remote.sessions, tombstones, "session"), lastSync, remote.preferences.sync.deviceName);
  const remoteRecordings = removeDeleted(remote.recordingTasks, tombstones, "recording").map((task) => ({ ...task, sessionId: sessions.conflictIds.get(task.sessionId) ?? task.sessionId, remoteAudioId: task.remoteAudioId ?? task.id }));
  const recordings = mergeEntities<RecordingTask>(removeDeleted(local.recordingTasks, tombstones, "recording"), remoteRecordings, lastSync, remote.preferences.sync.deviceName);
  const conflictSessionIds = new Set(sessions.conflictIds.values());
  const mergedSessions = sessions.items.map((session) => conflictSessionIds.has(session.id) ? { ...session,
    statements: session.statements.map((item) => ({ ...item, sessionId: session.id })),
    messages: session.messages.map((item) => ({ ...item, sessionId: session.id })),
    feedback: session.feedback.map((item) => ({ ...item, sessionId: session.id })),
    report: session.report ? { ...session.report, sessionId: session.id } : undefined,
    recordingTaskIds: session.recordingTaskIds.map((id) => recordings.conflictIds.get(id) ?? id) } : session);
  const plans = mergeEntities<TrainingPlan>(removeDeleted(local.trainingPlans, tombstones, "training-plan"), removeDeleted(remote.trainingPlans, tombstones, "training-plan"), lastSync, remote.preferences.sync.deviceName);
  return {
    conflicts: sessions.conflicts + plans.conflicts + recordings.conflicts,
    workspace: {
      ...local,
      sessions: mergedSessions,
      trainingPlans: plans.items,
      recordingTasks: recordings.items,
      tombstones,
      selectedSessionId: sessions.items.some((session) => session.id === local.selectedSessionId) ? local.selectedSessionId : sessions.items[0]?.id ?? null,
      preferences: { ...remote.preferences, ...local.preferences, installedModels: local.preferences.installedModels, sync: local.preferences.sync },
      updatedAt: new Date().toISOString(),
    },
  };
}
function remoteWorkspace(workspace: WorkspaceState): WorkspaceState {
  return { ...workspace, preferences: { ...workspace.preferences, installedModels: [], sync: { ...workspace.preferences.sync, status: "idle", errorMessage: undefined } } };
}
async function put(credentials: SyncCredentials, path: string, body: BodyInit, contentType: string): Promise<void> {
  const response = await appFetch(`${baseUrl(credentials.endpoint)}/${path}`, { method: "PUT", headers: requestHeaders(credentials, contentType), body });
  if (!response.ok) throw new Error(`同步服务写入失败（${response.status}）`);
}

export async function testSyncConnection(credentials: SyncCredentials): Promise<void> {
  const endpoint = baseUrl(credentials.endpoint);
  if (!credentials.username.trim()) throw new Error("请填写同步账号，再测试连接");
  if (!credentials.password.trim()) throw new Error("请填写同步密码，再测试连接");
  const response = await appFetch(endpoint, { method: "PROPFIND", headers: { ...requestHeaders(credentials), Depth: "0" } });
  if (!response.ok && response.status !== 207) throw new Error(`同步服务连接失败（${response.status}）`);
}

export async function syncWorkspace(local: WorkspaceState, credentials: SyncCredentials): Promise<SyncResult> {
  if (!credentials.endpoint || !credentials.username || !credentials.password) throw new Error("请完整填写同步地址、账号和密码");
  const collectionResponse = await appFetch(`${baseUrl(credentials.endpoint)}/audio`, { method: "MKCOL", headers: requestHeaders(credentials) });
  if (!collectionResponse.ok && ![405, 409].includes(collectionResponse.status)) throw new Error(`无法创建远端音频目录（${collectionResponse.status}）`);
  const remoteResponse = await appFetch(`${baseUrl(credentials.endpoint)}/workspace.json`, { headers: requestHeaders(credentials) });
  let merged = { workspace: local, conflicts: 0 };
  if (remoteResponse.ok) {
    const value: unknown = await remoteResponse.json();
    if (!isWorkspace(value)) throw new Error("远端工作区格式不兼容");
    merged = mergeWorkspace(local, value);
  } else if (remoteResponse.status !== 404) throw new Error(`读取远端工作区失败（${remoteResponse.status}）`);

  let uploadedAudio = 0;
  let downloadedAudio = 0;
  const warnings: string[] = [];
  const recordingTasks = merged.workspace.recordingTasks.map((task) => ({ ...task }));
  for (const task of recordingTasks) {
    const localFile = await loadAudioFile(task.id);
    const remoteAudioId = task.remoteAudioId ?? task.id;
    const audioPath = `audio/${encodeURIComponent(remoteAudioId)}-${encodeURIComponent(task.sourceFileName ?? task.title)}`;
    if (!localFile) {
      const response = await appFetch(`${baseUrl(credentials.endpoint)}/${audioPath}`, { headers: requestHeaders(credentials) });
      if (response.ok) {
        const blob = await response.blob();
        await saveAudioFile(task.id, new File([blob], task.sourceFileName ?? task.title, { type: blob.type }));
        downloadedAudio += 1;
      } else { warnings.push(`“${task.title}”原始音频未同步（${response.status}），请从保留原件的设备重试。`); }
    }
  }
  for (const task of recordingTasks) {
    const localFile = await loadAudioFile(task.id);
    if (!localFile) continue;
    const canonicalPath = `audio/${encodeURIComponent(task.id)}-${encodeURIComponent(task.sourceFileName ?? task.title)}`;
    await put(credentials, canonicalPath, localFile, localFile.type || "application/octet-stream");
    task.remoteAudioId = task.id;
    uploadedAudio += 1;
  }
  const now = new Date().toISOString();
  const etag = remoteResponse.headers.get("etag");
  const conditionalHeaders: Record<string, string> = remoteResponse.status === 404 ? { "If-None-Match": "*" } : { "If-Match": etag ?? "*" };
  if (remoteResponse.ok && !etag) {
    // Some WebDAV services omit ETag. Never call this a completed safe sync.
    warnings.push("同步服务未提供 ETag，并发覆盖保护不可用；本次仅合并到本地，未覆盖远端工作区。");
  }
  const workspace: WorkspaceState = { ...merged.workspace, recordingTasks, preferences: { ...merged.workspace.preferences, sync: { ...merged.workspace.preferences.sync, status: warnings.length ? "error" : "idle", lastSyncedAt: warnings.length ? local.preferences.sync.lastSyncedAt : now, errorMessage: warnings.join(" ") || undefined } }, updatedAt: now };
  if (!warnings.length) {
    const response = await appFetch(`${baseUrl(credentials.endpoint)}/workspace.json`, { method: "PUT", headers: { ...requestHeaders(credentials, "application/json"), ...conditionalHeaders }, body: JSON.stringify(remoteWorkspace(workspace)) });
    if (response.status === 412) throw new Error("另一台设备刚更新了数据，已停止覆盖。请再次同步以重新合并。");
    if (!response.ok) throw new Error(`同步服务写入失败（${response.status}）`);
  }
  return { workspace, uploadedAudio, downloadedAudio, conflicts: merged.conflicts, warnings };
}
