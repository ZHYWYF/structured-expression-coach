import { BarChart3, Download, FileAudio2, LoaderCircle, Mic2, MoreHorizontal, Play } from "lucide-react";
import { useState } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import type { RecordingTask } from "../core/types";
import { MockLocalTranscriptionProvider } from "../transcription";
import { PageHeader, PrimaryButton } from "./ui";

function formatDuration(seconds?: number): string {
  if (!seconds) return "--:--";
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function ReportsPage({ controller }: { controller: WorkspaceController }) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recordings = [...controller.recordingTasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const selectedProvider = controller.preferences.transcriptionProvider;
  const providerReady = selectedProvider === "demo";
  const hasActiveRecording = recordings.some((item) => item.status === "recording" || item.status === "transcribing");
  const totalSeconds = recordings.reduce((sum, recording) => sum + (recording.durationSeconds ?? 0), 0);
  const reportScores = controller.sessions.flatMap((session) => session.report ? [session.report.overallScore] : []);
  const averageScore = reportScores.length ? Math.round(reportScores.reduce((sum, score) => sum + score, 0) / reportScores.length) : 0;

  const createRecording = async () => {
    if (isTranscribing || hasActiveRecording || !providerReady) return;
    setIsTranscribing(true);
    const session = controller.createSession({ kind: "recording-review", title: "本地转写演示" });
    controller.navigate("reports");
    const now = new Date().toISOString();
    const taskId = `recording-${Date.now()}`;
    let task: RecordingTask = {
      id: taskId,
      sessionId: session.id,
      title: "本地高精度转写演示.wav",
      status: "transcribing",
      durationSeconds: 18,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    controller.upsertRecordingTask(task);

    try {
      const provider = new MockLocalTranscriptionProvider();
      const result = await provider.transcribe(
        { mode: "batch", audioName: task.title, durationMs: 18_000 },
        (progress) => {
          task = {
            ...task,
            progress: Math.round(progress.progress * 100),
            updatedAt: new Date().toISOString(),
          };
          controller.upsertRecordingTask(task);
        },
      );
      const transcript = result.segments.map((segment) => segment.text).join("");
      task = { ...task, status: "completed", progress: 100, transcript, updatedAt: new Date().toISOString() };
      controller.upsertRecordingTask(task);
      controller.updateSession(session.id, (current) => ({ ...current, draftText: transcript, status: "completed" }));
    } catch (error) {
      task = {
        ...task,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "本地转写失败",
        updatedAt: new Date().toISOString(),
      };
      controller.upsertRecordingTask(task);
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="page reports-page">
      <PageHeader
        eyebrow="录音与报告"
        title="每次表达，都留下可复盘的证据"
        description="统一查看录音、转写文本和分析报告。"
        action={<PrimaryButton onClick={() => void createRecording()} disabled={isTranscribing || hasActiveRecording || !providerReady}>{isTranscribing ? <LoaderCircle className="spin" size={16} /> : <Mic2 size={16} />} {isTranscribing ? "演示转写中" : hasActiveRecording ? "已有任务处理中" : "新录音"}</PrimaryButton>}
      />
      {!providerReady ? (
        <div className="provider-notice" role="status">
          当前选择的是{selectedProvider === "local" ? "本地高精度" : "在线高精度"}转写，但该适配器尚未安装。请先在设置中切换为“演示转写”；真实服务接入后会直接复用当前任务接口。
        </div>
      ) : null}
      <section className="report-summary">
        <div><p>录音记录</p><strong>{recordings.length}<small>次</small></strong><span>{recordings.filter((item) => item.status === "completed").length} 次已完成转写</span></div>
        <div><p>总表达时长</p><strong>{(totalSeconds / 3600).toFixed(1)}<small>小时</small></strong><span>本地训练持续累积</span></div>
        <div><p>平均清晰度</p><strong>{averageScore || "--"}<small>分</small></strong><span className="positive">来自 {reportScores.length} 份报告</span></div>
      </section>
      <section className="report-list-section">
        <div className="section-heading compact"><div><p className="eyebrow">全部记录</p><h2>近期报告</h2></div><button className="text-button" type="button"><Download size={15} /> 导出</button></div>
        <div className="report-list">
          {recordings.map((recording) => {
            const session = controller.sessions.find((item) => item.id === recording.sessionId);
            const score = session?.report?.overallScore;
            const type = session?.kind === "interview" ? "面试模拟" : session?.kind === "recording-review" ? "自由录音" : "表达练习";
            return (
              <button className="report-row" type="button" key={recording.id} onClick={() => controller.selectSession(recording.sessionId)}>
                <span className="report-play"><Play size={15} fill="currentColor" /></span>
                <span className="report-copy"><strong>{recording.title}</strong><small>{formatDate(recording.updatedAt)} · {formatDuration(recording.durationSeconds)} · {recording.status === "transcribing" ? `转写 ${recording.progress}%` : recording.status === "completed" ? "已完成" : recording.status === "failed" ? "已中断，可重新开始" : "等待处理"}</small></span>
                <span className="report-type"><FileAudio2 size={14} /> {type}</span>
                <span className="report-score"><BarChart3 size={15} /><strong>{score ?? "--"}</strong><small>清晰度</small></span>
                <MoreHorizontal size={18} />
              </button>
            );
          })}
          {!recordings.length ? <p className="empty-list-copy">还没有录音与报告</p> : null}
        </div>
      </section>
    </div>
  );
}
