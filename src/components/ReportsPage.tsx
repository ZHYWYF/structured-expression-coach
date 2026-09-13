import { BarChart3, FileAudio2, FileUp, LoaderCircle, Play, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import type { RecordingAnalysisScenario, RecordingTask, Report, ScoreDimension } from "../core/types";
import { requestChatCompletion, transcribeWithOnlineProvider } from "../providers/openAiCompatible";
import { deleteAudioFile, loadAudioFile, saveAudioFile } from "../transcription/audioStore";
import { decodeAudioTo16Khz, localTranscriptionRuntime } from "../transcription/localRuntime";
import { PageHeader } from "./ui";
import { buildRecordingReportPrompt, recordingScenarioLabels } from "../prompts/scenarioPrompts";

function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
function formatDate(value: string): string { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
function parseJsonObject<T>(content: string): T { return JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()) as T; }

export function ReportsPage({ controller }: { controller: WorkspaceController }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioInputId = "recording-audio-upload";
  const [selectedTaskId, setSelectedTaskId] = useState(controller.recordingTasks[0]?.id ?? null);
  const [audioUrl, setAudioUrl] = useState("");
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [uploadScenario, setUploadScenario] = useState<RecordingAnalysisScenario>("report");
  const deletedTaskIds = useRef(new Set<string>());
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const operationRef = useRef(new Set<string>());
  const uploadRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const snapshot = () => controllerRef.current.getSnapshot?.() ?? controllerRef.current;
  const currentTask = (id: string) => snapshot().recordingTasks.find((item) => item.id === id);
  const patchTask = (id: string, patch: Partial<RecordingTask>) => {
    if (deletedTaskIds.current.has(id)) return;
    const current = currentTask(id);
    if (current) controllerRef.current.upsertRecordingTask({ ...current, ...patch, updatedAt: new Date().toISOString() });
  };
  const recordings = [...controller.recordingTasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const selectedTask = recordings.find((item) => item.id === selectedTaskId) ?? recordings[0] ?? null;
  const selectedSession = controller.sessions.find((item) => item.id === selectedTask?.sessionId);

  useEffect(() => {
    let currentUrl = "";
    let cancelled = false;
    setAudioUrl("");
    if (!selectedTask) { setAudioUrl(""); return; }
    void loadAudioFile(selectedTask.id).then((file) => {
      if (!file || cancelled) return;
      currentUrl = URL.createObjectURL(file);
      setAudioUrl(currentUrl);
    }).catch(() => { if (!cancelled) setAudioUrl(""); });
    return () => { cancelled = true; if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [selectedTask?.id]);

  const runTranscription = async (task: RecordingTask, file?: File) => {
    if (operationRef.current.has(task.id) || deletedTaskIds.current.has(task.id)) return;
    const provider = controller.preferences.transcriptionProvider;
    const updateTask = (next: RecordingTask) => {
      if (!deletedTaskIds.current.has(task.id) && currentTask(task.id)) {
        const { transcript: _transcript, analysisScenario: _scenario, ...result } = next;
        patchTask(task.id, result);
      }
    };
    let audio: File | null;
    try { audio = file ?? await loadAudioFile(task.id); } catch { setActionError("原始音频读取失败，请重试。"); return; }
    if (!audio) { setActionError("找不到原始音频，请重新上传。"); return; }
    operationRef.current.add(task.id);
    const originalTranscript = task.transcript;
    const completeTranscript = (transcript: string, extra: Partial<RecordingTask> = {}) => {
      const current = currentTask(task.id);
      if (!current || deletedTaskIds.current.has(task.id)) return;
      if (current.transcript !== originalTranscript) {
        patchTask(task.id, { status: "completed", errorMessage: "识别期间逐字稿已被修改，已保留校对内容。", progress: 100 });
        return;
      }
      patchTask(task.id, { ...extra, transcript, status: "completed", provider, progress: 100, reportStatus: "not-generated", errorMessage: undefined });
      controller.updateSession(task.sessionId, (session) => ({ ...session, draftText: transcript, status: "completed", report: undefined }));
    };
    if (provider === "local") {
      const readyModel = controller.preferences.installedModels.find((model) => model.status === "ready");
      if (!readyModel) { operationRef.current.delete(task.id); updateTask({ ...task, status: "queued", provider: "local", errorMessage: "尚未安装本地转写模型", updatedAt: new Date().toISOString() }); setActionError("尚未安装可用的本地转写模型。请前往设置下载模型，或切换在线高精度转写。"); return; }
      setBusyTaskId(task.id); setActionError("");
      updateTask({ ...task, status: "transcribing", provider: "local", progress: 1, errorMessage: undefined, updatedAt: new Date().toISOString() });
      try {
        const decoded = await decodeAudioTo16Khz(audio);
        const result = await localTranscriptionRuntime.transcribe(readyModel.id, decoded.samples, (progress) => updateTask({ ...task, status: "transcribing", provider: "local", progress: Math.max(1, progress), durationSeconds: decoded.durationSeconds, updatedAt: new Date().toISOString() }));
        if (!result.text) throw new Error("本地模型没有识别到有效语音");
        const transcriptSegments = (result.chunks ?? []).map((chunk, index) => ({ id: `segment-${crypto.randomUUID()}`, startMs: Math.round((chunk.timestamp?.[0] ?? 0) * 1000), endMs: Math.round((chunk.timestamp?.[1] ?? decoded.durationSeconds) * 1000), text: chunk.text?.trim() ?? "" })).filter((segment) => segment.text);
        completeTranscript(result.text, { durationSeconds: decoded.durationSeconds, transcriptSegments });
      } catch (error) {
        const message = error instanceof Error ? error.message : "本地转写失败";
        updateTask({ ...task, status: "failed", provider: "local", progress: 0, errorMessage: message, updatedAt: new Date().toISOString() });
        setActionError(message);
      } finally { operationRef.current.delete(task.id); setBusyTaskId(null); }
      return;
    }
    setBusyTaskId(task.id); setActionError("");
    updateTask({ ...task, status: "transcribing", provider: "online", progress: 10, errorMessage: undefined, updatedAt: new Date().toISOString() });
    try {
      let metadata: Partial<RecordingTask> = { transcriptSegments: [] };
      const transcript = await transcribeWithOnlineProvider(controller.preferences.onlineAsrProvider, audio, (details) => { metadata = details; });
      completeTranscript(transcript, metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : "在线转写失败";
      updateTask({ ...task, status: "failed", provider: "online", progress: 0, errorMessage: message, updatedAt: new Date().toISOString() });
      setActionError(message);
    } finally { operationRef.current.delete(task.id); setBusyTaskId(null); }
  };

  const uploadAudio = async (file?: File) => {
    if (!file || uploadRef.current) return;
    if (!file.size || (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|aac|flac|ogg|webm|mp4)$/i.test(file.name))) { setActionError("请选择非空的音频文件。支持 WAV、MP3、M4A、AAC、FLAC、OGG、WebM。"); return; }
    uploadRef.current = true; setUploading(true);
    const recordingId = `recording-${crypto.randomUUID()}`;
    try { await saveAudioFile(recordingId, file); }
    catch (error) { setActionError(error instanceof Error ? error.message : "音频保存失败"); uploadRef.current = false; setUploading(false); return; }
    const session = controller.createSession({ kind: "recording-review", title: file.name.replace(/\.[^.]+$/, "") || "录音复盘" });
    controller.navigate("reports");
    const now = new Date().toISOString();
    const task: RecordingTask = { id: recordingId, sessionId: session.id, title: file.name, sourceFileName: file.name, sourceMimeType: file.type, status: "queued", provider: controller.preferences.transcriptionProvider, analysisScenario: uploadScenario, progress: 0, reportStatus: "not-generated", createdAt: now, updatedAt: now };
    try {
      controller.upsertRecordingTask(task);
      setSelectedTaskId(task.id);
      await runTranscription(task, file);
    } catch (error) { setActionError(error instanceof Error ? error.message : "音频导入失败"); }
    finally { uploadRef.current = false; setUploading(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const updateTranscript = (value: string) => {
    if (!selectedTask) return;
    controller.upsertRecordingTask({ ...selectedTask, transcript: value, reportStatus: "outdated", updatedAt: new Date().toISOString() });
    controller.updateSession(selectedTask.sessionId, (session) => ({ ...session, draftText: value }));
  };

  const generateReport = async (target = selectedTask) => {
    if (!target?.transcript?.trim() || operationRef.current.has(target.id)) return;
    const sessionId = target.sessionId;
    if (!snapshot().sessions.some((session) => session.id === sessionId)) return;
    const transcript = target.transcript;
    const scenario = target.analysisScenario ?? "general";
    const stillCurrent = () => { const current = currentTask(target.id); return current && !deletedTaskIds.current.has(target.id) && current.transcript === transcript && (current.analysisScenario ?? "general") === scenario; };
    operationRef.current.add(target.id);
    setBusyTaskId(target.id); setActionError("");
    patchTask(target.id, { reportStatus: "generating" });
    try {
      const content = await requestChatCompletion(
        controller.preferences.aiProvider,
        buildRecordingReportPrompt(scenario, transcript),
      );
      const parsed = parseJsonObject<Partial<Omit<Report, "id" | "sessionId" | "generatedAt">>>(content);
      const validKeys = new Set<ScoreDimension["key"]>(["structure", "clarity", "evidence", "brevity", "confidence"]);
      if (typeof parsed.title !== "string" || typeof parsed.overallScore !== "number" || !Number.isFinite(parsed.overallScore) ||
          !Array.isArray(parsed.dimensions) || parsed.dimensions.length !== 5 || new Set(parsed.dimensions.map((item) => item?.key)).size !== 5 || parsed.dimensions.some((item) => !item || !validKeys.has(item.key) || typeof item.label !== "string" || !Number.isFinite(item.score) || item.score < 0 || item.score > 100 || typeof item.summary !== "string") ||
          !Array.isArray(parsed.strengths) || !parsed.strengths.every((item) => typeof item === "string") ||
          !Array.isArray(parsed.improvements) || !parsed.improvements.every((item) => typeof item === "string") ||
          !Array.isArray(parsed.actionItems) || !parsed.actionItems.every((item) => typeof item === "string")) {
        throw new Error("AI 返回的报告格式不完整，请重试或更换模型");
      }
      const report: Report = {
        id: `report-${crypto.randomUUID()}`,
        sessionId,
        title: parsed.title,
        overallScore: Math.max(0, Math.min(100, parsed.overallScore)),
        dimensions: parsed.dimensions,
        strengths: parsed.strengths,
        improvements: parsed.improvements,
        actionItems: parsed.actionItems,
        generatedAt: new Date().toISOString(),
      };
      if (!stillCurrent()) { if (currentTask(target.id)) patchTask(target.id, { reportStatus: "outdated" }); return; }
      controller.updateSession(sessionId, (session) => ({ ...session, report }));
      patchTask(target.id, { reportStatus: "ready", errorMessage: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : "报告生成失败";
      if (stillCurrent()) patchTask(target.id, { reportStatus: "failed", errorMessage: message });
      setActionError(message);
    } finally { operationRef.current.delete(target.id); setBusyTaskId(null); }
  };

  useEffect(() => {
    if (!controller.preferences.aiProvider.enabled || !controller.preferences.aiProvider.model.trim()) return;
    const next = controller.recordingTasks.find((task) => task.status === "completed" && task.transcript?.trim() && task.reportStatus === "not-generated" && !operationRef.current.has(task.id));
    if (next) void generateReport(next);
  }, [controller.recordingTasks, controller.preferences.aiProvider, busyTaskId]);

  const removeRecording = async (task: RecordingTask) => {
    if (!window.confirm(`删除录音“${task.title}”及其逐字稿？`)) return;
    deletedTaskIds.current.add(task.id);
    try { await deleteAudioFile(task.id); }
    catch { deletedTaskIds.current.delete(task.id); setActionError("原始音频删除失败，已保留记录，请重试。"); return; }
    controller.deleteRecordingTask(task.id);
    controller.deleteSession(task.sessionId);
    setSelectedTaskId("");
  };

  return (
    <div className="page reports-page">
      <PageHeader eyebrow="录音与报告" title="回听每一段，让经验留下来" description="保留原始录音，逐句校对文字，再整理成有依据的结构化报告。" action={<><input id={audioInputId} ref={inputRef} disabled={uploading} className="visually-hidden" type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void uploadAudio(file); }} /><label className="button button-primary file-upload-trigger" htmlFor={audioInputId}><FileUp size={16} /> 上传录音</label></>} />
      <div className="transcription-mode"><span>转写方式</span><button type="button" className={controller.preferences.transcriptionProvider === "local" ? "active" : ""} onClick={() => controller.updatePreferences({ transcriptionProvider: "local" })}>本地转写</button><button type="button" className={controller.preferences.transcriptionProvider === "online" ? "active" : ""} onClick={() => controller.updatePreferences({ transcriptionProvider: "online" })}>在线高精度</button><span className="scenario-label">分析场景</span>{(Object.keys(recordingScenarioLabels) as RecordingAnalysisScenario[]).map((scenario) => <button type="button" key={scenario} className={uploadScenario === scenario ? "active" : ""} onClick={() => setUploadScenario(scenario)}>{recordingScenarioLabels[scenario]}</button>)}<small>{controller.preferences.transcriptionProvider === "online" ? "音频将发送到你配置的在线服务" : "音频不离开当前设备"}</small></div>
      {uploading ? <div className="processing-status" role="status"><LoaderCircle className="spin" size={16} />{busyTaskId ? "正在处理录音，请保持应用开启…" : "正在保存音频…"}</div> : null}{actionError ? <div className="action-notice" role="status">{actionError}</div> : null}
      {selectedTask?.status === "completed" && !selectedTask.transcriptSegments?.length ? <p className="file-warning">当前转写未提供时间戳分段，可使用播放器回听；时间戳定位和说话人标签需要转写服务返回分段数据。</p> : null}
      <div className="recording-workspace">
        <aside className="recording-list"><input type="search" aria-label="搜索录音" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索录音标题" /><div className="section-heading compact"><div><p className="eyebrow">历史录音</p><h2>{recordings.length} 条记录</h2></div></div>{recordings.filter((recording) => recording.title.includes(search)).map((recording) => <button className={selectedTask?.id === recording.id ? "recording-item active" : "recording-item"} type="button" key={recording.id} onClick={() => setSelectedTaskId(recording.id)}><span className="report-play"><Play size={14} fill="currentColor" /></span><span><strong>{recording.title}</strong><small>{formatDate(recording.updatedAt)} · {recording.status === "transcribing" ? `转写 ${recording.progress}%` : recording.status === "completed" ? "已完成" : recording.status === "failed" ? "失败" : "等待处理"}</small></span></button>)}{!recordings.length ? <div className="empty-list-copy">还没有录音。上传后会保存在当前设备。</div> : null}</aside>
        <section className="recording-detail">{selectedTask ? <><div className="recording-detail-head"><div><p className="eyebrow">录音详情</p><h2>{selectedTask.title}</h2><span><FileAudio2 size={14} /> {formatDuration(selectedTask.durationSeconds)} · {selectedTask.provider === "online" ? "在线转写" : "本地转写"} · {recordingScenarioLabels[selectedTask.analysisScenario ?? "general"]}</span></div><button className="danger-icon" type="button" aria-label="删除录音" onClick={() => void removeRecording(selectedTask)}><Trash2 size={16} /></button></div><div className="recording-scenario-switch"><span>报告分析场景</span>{(Object.keys(recordingScenarioLabels) as RecordingAnalysisScenario[]).map((scenario) => <button type="button" key={scenario} className={(selectedTask.analysisScenario ?? "general") === scenario ? "active" : ""} onClick={() => controller.upsertRecordingTask({ ...selectedTask, analysisScenario: scenario, reportStatus: selectedSession?.report ? "outdated" : "not-generated", updatedAt: new Date().toISOString() })}>{recordingScenarioLabels[scenario]}</button>)}</div>{audioUrl ? <audio ref={audioRef} className="audio-player" controls src={audioUrl} /> : <p className="file-warning">原始音频暂不可读取；逐字稿仍会保留。</p>}{selectedTask.status !== "completed" ? <div className="transcription-status"><strong>{selectedTask.status === "transcribing" ? "正在转写" : selectedTask.status === "failed" ? "转写失败" : "等待转写"}</strong><p>{selectedTask.errorMessage ?? "选择可用的转写方式后开始处理。"}</p><button type="button" disabled={busyTaskId === selectedTask.id} onClick={() => void runTranscription(selectedTask)}>{busyTaskId === selectedTask.id ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} 重新转写</button></div> : <><label className="transcript-editor"><span>逐字稿（可直接校对）</span><textarea value={selectedTask.transcript ?? ""} onChange={(event) => updateTranscript(event.target.value)} /></label>{selectedTask.transcriptSegments?.length ? <details><summary>时间戳回听与说话人标签</summary>{selectedTask.transcriptSegments.map((segment) => <div className="transcript-segment" key={segment.id}><button type="button" onClick={() => { if (audioRef.current) { audioRef.current.currentTime = segment.startMs / 1000; void audioRef.current.play().catch(() => setActionError("请点击播放器开始回听")); } }}>{formatDuration(segment.startMs / 1000)} · {segment.text}</button><input aria-label={`说话人 ${formatDuration(segment.startMs / 1000)}`} placeholder="自填说话人" value={segment.speakerLabel ?? ""} onChange={(event) => patchTask(selectedTask.id, { transcriptSegments: selectedTask.transcriptSegments?.map((item) => item.id === segment.id ? { ...item, speakerLabel: event.target.value } : item) })} /></div>)}</details> : null}{!controller.preferences.aiProvider.enabled ? <button className="recovery-link" type="button" onClick={() => controller.navigate("settings")}>配置 AI 后自动生成报告</button> : null}<div className="report-actions"><span>{selectedTask.reportStatus === "outdated" ? "逐字稿或分析场景已修改，报告需要更新" : selectedSession?.report ? "报告已生成" : "逐字稿已保存"}</span><button type="button" disabled={!selectedTask.transcript?.trim() || busyTaskId === selectedTask.id} onClick={() => void generateReport()}>{busyTaskId === selectedTask.id ? <LoaderCircle className="spin" size={14} /> : selectedSession?.report ? <RefreshCw size={14} /> : <Sparkles size={14} />}{selectedSession?.report ? "重新生成报告" : "生成报告"}</button></div>{selectedSession?.report ? <div className="generated-report"><div className="report-score-large"><BarChart3 size={20} /><strong>{selectedSession.report.overallScore}</strong><span>综合得分</span></div><div><h3>{selectedSession.report.title}</h3><p>{selectedSession.report.improvements.join("；")}</p><ul>{selectedSession.report.actionItems.map((item) => <li key={item}>{item}</li>)}</ul></div></div> : null}</>}</> : <div className="empty-state"><FileAudio2 size={30} /><h2>选择或上传一段录音</h2><p>上传后可播放、转写、校对并生成结构化报告。</p><label className="button-primary compact-button file-upload-trigger" htmlFor={audioInputId}><FileUp size={15} /> 上传录音</label></div>}</section>
      </div>
    </div>
  );
}
