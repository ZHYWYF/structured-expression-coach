import { useAppDialog } from "./useAppDialog";
import { FileAudio2, FileUp, LoaderCircle, Play, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import type { RecordingAnalysisScenario, RecordingTask, Report } from "../core/types";
import { requestChatCompletion, transcribeWithOnlineProvider } from "../providers/openAiCompatible";
import { deleteAudioFile, loadAudioFile, saveAudioFile } from "../transcription/audioStore";
import { decodeAudioTo16Khz, localTranscriptionRuntime } from "../transcription/localRuntime";
import { PageHeader } from "./ui";
import { buildRecordingReportPrompt, recordingScenarioLabels } from "../prompts/scenarioPrompts";
import { recordingReportContext } from "../prompts/recordingReportContext";
import { parseRecordingReport } from "../providers/recordingReport";
import { RecordingReportReview } from "./RecordingReportReview";

function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}
function formatDate(value: string): string { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }

export function ReportsPage({ controller, active = true }: { controller: WorkspaceController; active?: boolean }) {
  const appDialog = useAppDialog();
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
  const [runtimeStatus, setRuntimeStatus] = useState<{ taskId: string; message: string; startedAt: number; lastSignalAt: number } | null>(null);
  const [clock, setClock] = useState(Date.now());
  const transcriptionRef = useRef<{ taskId: string; abort: AbortController; localRunning: boolean } | null>(null);
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
    if (!runtimeStatus || !active) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [runtimeStatus?.taskId, active]);

  // Persisted status is not proof of a running worker after restarting the app.
  useEffect(() => {
    for (const task of controller.recordingTasks) {
      if (operationRef.current.has(task.id)) continue;
      if (task.status === "transcribing") patchTask(task.id, { status: "failed", errorMessage: "上次转写已中断，原始录音已保留。可点击重新转写，无需再次上传。" });
      if (task.reportStatus === "generating") patchTask(task.id, { reportStatus: "failed", errorMessage: "上次报告生成已中断，可重新生成。" });
    }
  }, [controller.recordingTasks]);

  useEffect(() => { if (!active) appDialog.cancelDialog(); }, [active, appDialog.cancelDialog]);

  const stopTranscription = () => {
    const running = transcriptionRef.current;
    if (!running) return;
    running.abort.abort(new Error("已停止本次转写，原始录音和已保存的逐字稿已保留，可重新转写。"));
    if (running.localRunning) localTranscriptionRuntime.cancelAll("已停止本次转写，原始录音和已保存的逐字稿已保留，可重新转写。");
  };
  useEffect(() => () => { stopTranscription(); }, []);

  useEffect(() => {
    let currentUrl = "";
    let cancelled = false;
    setAudioUrl("");
    if (!selectedTask || !active) { setAudioUrl(""); return; }
    void loadAudioFile(selectedTask.id).then((file) => {
      if (!file || cancelled) return;
      currentUrl = URL.createObjectURL(file);
      setAudioUrl(currentUrl);
    }).catch(() => { if (!cancelled) setAudioUrl(""); });
    return () => { cancelled = true; if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [selectedTask?.id, active]);

  const runTranscription = async (task: RecordingTask, file?: File) => {
    if (operationRef.current.size || deletedTaskIds.current.has(task.id)) return;
    operationRef.current.add(task.id);
    const provider = controller.preferences.transcriptionProvider;
    const updateTask = (next: RecordingTask) => {
      if (!deletedTaskIds.current.has(task.id) && currentTask(task.id)) {
        const { transcript: _transcript, analysisScenario: _scenario, ...result } = next;
        patchTask(task.id, result);
      }
    };
    let audio: File | null;
    try { audio = file ?? await loadAudioFile(task.id); } catch { operationRef.current.delete(task.id); setActionError("原始音频读取失败，请重试。"); return; }
    if (!audio) { operationRef.current.delete(task.id); setActionError("找不到原始音频，请重新上传。"); return; }
    if (deletedTaskIds.current.has(task.id) || !currentTask(task.id)) { operationRef.current.delete(task.id); return; }
    const running = { taskId: task.id, abort: new AbortController(), localRunning: false };
    transcriptionRef.current = running;
    const startedAt = Date.now();
    const signalProgress = (message: string) => setRuntimeStatus({ taskId: task.id, message, startedAt, lastSignalAt: Date.now() });
    const originalTranscript = task.transcript;
    const completeTranscript = (transcript: string, extra: Partial<RecordingTask> = {}) => {
      const current = currentTask(task.id);
      if (!current || deletedTaskIds.current.has(task.id) || running.abort.signal.aborted) return;
      if (current.transcript !== originalTranscript) {
        patchTask(task.id, { status: "completed", errorMessage: "识别期间逐字稿已被修改，已保留校对内容。", progress: 100 });
        return;
      }
      patchTask(task.id, { ...extra, transcript, status: "completed", provider, progress: 100, reportStatus: "not-generated", errorMessage: undefined });
      controller.updateSession(task.sessionId, (session) => ({ ...session, draftText: transcript, status: "completed", report: undefined }));
    };
    if (provider === "local") {
      const readyModel = controller.preferences.installedModels.find((model) => model.status === "ready");
      if (!readyModel) { operationRef.current.delete(task.id); transcriptionRef.current = null; updateTask({ ...task, status: "queued", provider: "local", errorMessage: "尚未安装本地转写模型", updatedAt: new Date().toISOString() }); setActionError("尚未安装可用的本地转写模型。请前往设置下载模型，或切换在线高精度转写。"); return; }
      setBusyTaskId(task.id); setActionError("");
      updateTask({ ...task, status: "transcribing", provider: "local", progress: 0, errorMessage: undefined, updatedAt: new Date().toISOString() });
      signalProgress("正在解码音频并转换为本地模型需要的格式…");
      try {
        if (localTranscriptionRuntime.isBusy) throw new Error("本地模型正在处理其他任务，请先停止语音输入或等待模型任务完成。");
        const decoded = await decodeAudioTo16Khz(audio);
        running.abort.signal.throwIfAborted();
        signalProgress("正在加载本地模型…");
        running.localRunning = true;
        const result = await localTranscriptionRuntime.transcribe(readyModel.id, decoded.samples, (progress, message) => {
          if (running.abort.signal.aborted) return;
          signalProgress(message);
          // Token heartbeats update the UI, not the persisted workspace on every token.
          const current = currentTask(task.id);
          if (current && (current.progress !== progress || current.durationSeconds !== decoded.durationSeconds)) patchTask(task.id, { progress, durationSeconds: decoded.durationSeconds });
        });
        running.abort.signal.throwIfAborted();
        if (!result.text) throw new Error("本地模型没有识别到有效语音");
        const transcriptSegments = (result.chunks ?? []).map((chunk, index) => ({ id: `segment-${crypto.randomUUID()}`, startMs: Math.round((chunk.timestamp?.[0] ?? 0) * 1000), endMs: Math.round((chunk.timestamp?.[1] ?? decoded.durationSeconds) * 1000), text: chunk.text?.trim() ?? "" })).filter((segment) => segment.text);
        completeTranscript(result.text, { durationSeconds: decoded.durationSeconds, transcriptSegments });
      } catch (error) {
        const message = error instanceof Error ? error.message : "本地转写失败";
        updateTask({ ...task, status: "failed", provider: "local", progress: 0, errorMessage: message, updatedAt: new Date().toISOString() });
        setActionError(message);
      } finally { operationRef.current.delete(task.id); transcriptionRef.current = null; setBusyTaskId(null); setRuntimeStatus(null); }
      return;
    }
    setBusyTaskId(task.id); setActionError("");
    updateTask({ ...task, status: "transcribing", provider: "online", progress: 0, errorMessage: undefined, updatedAt: new Date().toISOString() });
    signalProgress("正在上传并等待在线转写服务返回；服务不提供实时百分比。");
    try {
      let metadata: Partial<RecordingTask> = { transcriptSegments: [] };
      const transcript = await transcribeWithOnlineProvider(controller.preferences.onlineAsrProvider, audio, (details) => { metadata = details; }, running.abort.signal);
      running.abort.signal.throwIfAborted();
      completeTranscript(transcript, metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : "在线转写失败";
      updateTask({ ...task, status: "failed", provider: "online", progress: 0, errorMessage: message, updatedAt: new Date().toISOString() });
      setActionError(message);
    } finally { operationRef.current.delete(task.id); transcriptionRef.current = null; setBusyTaskId(null); setRuntimeStatus(null); }
  };

  const uploadAudio = async (file?: File) => {
    if (!file || uploadRef.current) return;
    if (operationRef.current.size) { setActionError("当前录音任务仍在处理，请等待完成或先停止转写，再上传新录音。"); return; }
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
    if (!target?.transcript?.trim() || operationRef.current.size) return;
    const sessionId = target.sessionId;
    if (!snapshot().sessions.some((session) => session.id === sessionId)) return;
    const transcript = target.transcript;
    const scenario = target.analysisScenario ?? "general";
    const workspace = snapshot();
    const context = recordingReportContext(scenario, sessionId, workspace.scenarios, workspace.trainingPlans);
    const stillCurrent = () => {
      const current = currentTask(target.id);
      const latest = snapshot();
      return current && !deletedTaskIds.current.has(target.id) && current.transcript === transcript && (current.analysisScenario ?? "general") === scenario &&
        JSON.stringify(recordingReportContext(scenario, sessionId, latest.scenarios, latest.trainingPlans)) === JSON.stringify(context);
    };
    operationRef.current.add(target.id);
    setBusyTaskId(target.id); setActionError("");
    patchTask(target.id, { reportStatus: "generating" });
    try {
      const content = await requestChatCompletion(
        controller.preferences.aiProvider,
        buildRecordingReportPrompt(scenario, transcript, context),
        { maxTokens: 8192 },
      );
      const parsed = parseRecordingReport(content, transcript);
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
      else if (currentTask(target.id)) patchTask(target.id, { reportStatus: "outdated", errorMessage: undefined });
      setActionError(message);
    } finally { operationRef.current.delete(target.id); setBusyTaskId(null); }
  };

  useEffect(() => {
    if (operationRef.current.size || !controller.preferences.aiProvider.enabled || !controller.preferences.aiProvider.model.trim()) return;
    const next = controller.recordingTasks.find((task) => task.status === "completed" && task.transcript?.trim() && task.reportStatus === "not-generated" && !operationRef.current.has(task.id));
    if (next) void generateReport(next);
  }, [controller.recordingTasks, controller.preferences.aiProvider, busyTaskId]);

  const removeRecording = async (task: RecordingTask) => {
    if (!await appDialog.confirm(`删除录音“${task.title}”及其逐字稿？此操作无法撤销。`, { destructive: true })) return;
    deletedTaskIds.current.add(task.id);
    if (transcriptionRef.current?.taskId === task.id) stopTranscription();
    try { await deleteAudioFile(task.id); }
    catch { deletedTaskIds.current.delete(task.id); setActionError("原始音频删除失败，已保留记录，请重试。"); return; }
    controller.deleteRecordingTask(task.id);
    controller.deleteSession(task.sessionId);
    setSelectedTaskId("");
  };

  return (
    <div className="page reports-page">
      {appDialog.dialog}
      <PageHeader eyebrow="录音与报告" title="回听每一段，让经验留下来" description="保留原始录音，逐句校对文字，再整理成有依据的结构化报告。" action={<><input id={audioInputId} ref={inputRef} disabled={uploading} className="visually-hidden" type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void uploadAudio(file); }} /><label className="button button-primary file-upload-trigger" htmlFor={audioInputId}><FileUp size={16} /> 上传录音</label></>} />
      <div className="transcription-mode"><span>转写方式</span><button type="button" className={controller.preferences.transcriptionProvider === "local" ? "active" : ""} onClick={() => controller.updatePreferences({ transcriptionProvider: "local" })}>本地转写</button><button type="button" className={controller.preferences.transcriptionProvider === "online" ? "active" : ""} onClick={() => controller.updatePreferences({ transcriptionProvider: "online" })}>在线高精度</button><span className="scenario-label">分析场景</span>{(Object.keys(recordingScenarioLabels) as RecordingAnalysisScenario[]).map((scenario) => <button type="button" key={scenario} className={uploadScenario === scenario ? "active" : ""} onClick={() => setUploadScenario(scenario)}>{recordingScenarioLabels[scenario]}</button>)}<small>{controller.preferences.transcriptionProvider === "online" ? "音频将发送到你配置的在线服务" : "音频不离开当前设备"}</small></div>
      {uploading ? <div className="processing-status" role="status"><LoaderCircle className="spin" size={16} />{busyTaskId ? "正在处理录音，请保持应用开启…" : "正在保存音频…"}</div> : null}{actionError ? <div className="action-notice" role="status">{actionError}</div> : null}
      {selectedTask?.status === "completed" && !selectedTask.transcriptSegments?.length ? <p className="file-warning">当前转写未提供时间戳分段，可使用播放器回听；时间戳定位和说话人标签需要转写服务返回分段数据。</p> : null}
      <div className="recording-workspace">
        <aside className="recording-list"><input type="search" aria-label="搜索录音" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索录音标题" /><div className="section-heading compact"><div><p className="eyebrow">历史录音</p><h2>{recordings.length} 条记录</h2></div></div>{recordings.filter((recording) => recording.title.includes(search)).map((recording) => <button className={selectedTask?.id === recording.id ? "recording-item active" : "recording-item"} type="button" key={recording.id} onClick={() => setSelectedTaskId(recording.id)}><span className="report-play"><Play size={14} fill="currentColor" /></span><span><strong>{recording.title}</strong><small>{formatDate(recording.updatedAt)} · {recording.status === "transcribing" ? `转写 ${recording.progress}%` : recording.status === "completed" ? "已完成" : recording.status === "failed" ? "失败" : "等待处理"}</small></span></button>)}{!recordings.length ? <div className="empty-list-copy">还没有录音。上传后会保存在当前设备。</div> : null}</aside>
        <section className="recording-detail">{selectedTask ? <><div className="recording-detail-head"><div><p className="eyebrow">录音详情</p><h2>{selectedTask.title}</h2><span><FileAudio2 size={14} /> {formatDuration(selectedTask.durationSeconds)} · {selectedTask.provider === "online" ? "在线转写" : "本地转写"} · {recordingScenarioLabels[selectedTask.analysisScenario ?? "general"]}</span></div><button className="danger-icon" type="button" aria-label="删除录音" onClick={() => void removeRecording(selectedTask)}><Trash2 size={16} /></button></div><div className="recording-scenario-switch"><span>报告分析场景</span>{(Object.keys(recordingScenarioLabels) as RecordingAnalysisScenario[]).map((scenario) => <button type="button" key={scenario} className={(selectedTask.analysisScenario ?? "general") === scenario ? "active" : ""} onClick={() => controller.upsertRecordingTask({ ...selectedTask, analysisScenario: scenario, reportStatus: selectedSession?.report ? "outdated" : "not-generated", updatedAt: new Date().toISOString() })}>{recordingScenarioLabels[scenario]}</button>)}</div>{audioUrl ? <audio ref={audioRef} className="audio-player" controls src={audioUrl} /> : <p className="file-warning">原始音频暂不可读取；逐字稿仍会保留。</p>}{selectedTask.status !== "completed" ? <div className="transcription-status"><strong>{selectedTask.status === "transcribing" ? "正在转写" : selectedTask.status === "failed" ? "转写失败" : "等待转写"}</strong>
            <p role="status">{runtimeStatus?.taskId === selectedTask.id ? runtimeStatus.message : selectedTask.errorMessage ?? "选择可用的转写方式后开始处理。"}</p>
            {runtimeStatus?.taskId === selectedTask.id ? <><p>已用时 {formatDuration(Math.max(0, (clock - runtimeStatus.startedAt) / 1000))} · 可以切换页面，请保持应用开启</p>{selectedTask.provider === "local" && selectedTask.progress > 0 ? <progress max={100} value={selectedTask.progress} aria-label="已处理音频进度" /> : <progress aria-label="正在准备或等待识别结果" />}{clock - runtimeStatus.lastSignalAt > 60_000 ? <p className="file-warning">模型暂未返回新的处理信号，不能据此确认是否卡死。高精度模型首次推理可能较慢；你可以继续等待，或停止后重试。</p> : null}<button type="button" onClick={stopTranscription}>停止转写</button></> : <button type="button" disabled={Boolean(busyTaskId)} onClick={() => void runTranscription(selectedTask)}><RefreshCw size={14} /> 重新转写</button>}</div> : <><label className="transcript-editor"><span>逐字稿（可直接校对）</span><textarea value={selectedTask.transcript ?? ""} onChange={(event) => updateTranscript(event.target.value)} /></label>{selectedTask.transcriptSegments?.length ? <details><summary>时间戳回听与说话人标签</summary>{selectedTask.transcriptSegments.map((segment) => <div className="transcript-segment" key={segment.id}><button type="button" onClick={() => { if (audioRef.current) { audioRef.current.currentTime = segment.startMs / 1000; void audioRef.current.play().catch(() => setActionError("请点击播放器开始回听")); } }}>{formatDuration(segment.startMs / 1000)} · {segment.text}</button><input aria-label={`说话人 ${formatDuration(segment.startMs / 1000)}`} placeholder="自填说话人" value={segment.speakerLabel ?? ""} onChange={(event) => patchTask(selectedTask.id, { transcriptSegments: selectedTask.transcriptSegments?.map((item) => item.id === segment.id ? { ...item, speakerLabel: event.target.value } : item) })} /></div>)}</details> : null}{!controller.preferences.aiProvider.enabled ? <button className="recovery-link" type="button" onClick={() => controller.navigate("settings")}>配置 AI 后自动生成报告</button> : null}<div className="report-actions"><span>{selectedTask.reportStatus === "outdated" ? "逐字稿、分析场景或训练目标已修改，报告需要更新" : selectedSession?.report ? "报告已生成" : "逐字稿已保存"}</span><button type="button" disabled={!selectedTask.transcript?.trim() || busyTaskId === selectedTask.id} onClick={() => void generateReport()}>{busyTaskId === selectedTask.id ? <LoaderCircle className="spin" size={14} /> : selectedSession?.report ? <RefreshCw size={14} /> : <Sparkles size={14} />}{selectedSession?.report ? "重新生成报告" : "生成报告"}</button></div>{selectedSession?.report ? <RecordingReportReview report={selectedSession.report} /> : null}</>}</> : <div className="empty-state"><FileAudio2 size={30} /><h2>选择或上传一段录音</h2><p>上传后可播放、转写、校对并生成结构化报告。</p><label className="button-primary compact-button file-upload-trigger" htmlFor={audioInputId}><FileUp size={15} /> 上传录音</label></div>}</section>
      </div>
    </div>
  );
}
