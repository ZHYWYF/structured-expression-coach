import { Check, CornerDownLeft, FileText, Mic, MicOff, Search, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import type { Session } from "../core/types";
import { analyzeText } from "../knowledge";
import type { AnalysisFinding, KnowledgeScenario } from "../knowledge";
import { NewSessionButton, PageHeader } from "./ui";
import { localTranscriptionRuntime } from "../transcription/localRuntime";

type AnalysisMode = "汇报" | "复盘";
type FindingTone = "filler" | "vague" | "structure";
type MicrophoneSession = {
  stream: MediaStream;
  context: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  chunks: Float32Array[];
  sampleRate: number;
  busy: boolean;
  stopping: boolean;
  processing: Promise<void> | null;
};

const LIVE_TRANSCRIPTION_WINDOW_SECONDS = 1.5;

function formatSessionTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((dayStart - targetStart) / 86_400_000);
  const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  if (dayDifference === 0) return `今天 ${time}`;
  if (dayDifference === 1) return `昨天 ${time}`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function sessionPreview(session: Session): string {
  const text = session.draftText || session.statements.at(-1)?.text || "等待输入…";
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

function findingTone(finding: AnalysisFinding): FindingTone {
  if (/口头|填充|重复|冗余/.test(finding.issueType)) return "filler";
  if (/结构|顺序|主体|目标|下一步|负责人|情境/.test(finding.issueType)) return "structure";
  return "vague";
}

function HighlightedText({ text, findings }: { text: string; findings: AnalysisFinding[] }) {
  if (!text) return <span className="placeholder-copy">输入后，这里会同步展示局部标注。</span>;
  const spanFindings = findings.filter((finding) => finding.scope !== "document" && finding.range.end > finding.range.start);
  if (!spanFindings.length) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const finding of spanFindings) {
    if (finding.range.start > cursor) nodes.push(text.slice(cursor, finding.range.start));
    nodes.push(
      <mark className={`annotation-mark ${findingTone(finding)}`} key={`${finding.ruleId}-${finding.range.start}`}>
        {text.slice(finding.range.start, finding.range.end)}
      </mark>,
    );
    cursor = finding.range.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

export function ExpressionWorkspace({ controller }: { controller: WorkspaceController }) {
  const [savedText, setSavedText] = useState("");
  const [search, setSearch] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const microphoneRef = useRef<MicrophoneSession | null>(null);
  useEffect(() => () => {
    const microphone = microphoneRef.current;
    if (!microphone) return;
    microphone.processor.disconnect();
    microphone.source.disconnect();
    microphone.stream.getTracks().forEach((track) => track.stop());
    void microphone.context.close();
    microphoneRef.current = null;
  }, []);
  const sessions = controller.sessions.filter((session) => session.kind !== "interview" && (!search.trim() || `${session.title}\n${session.draftText}`.toLowerCase().includes(search.trim().toLowerCase())));
  const selectedSession = controller.selectedSession?.kind !== "interview"
    ? controller.selectedSession
    : sessions[0] ?? null;
  const selectedScenario = controller.scenarios.find((item) => item.id === selectedSession?.scenarioId);
  const mode: AnalysisMode = selectedScenario?.category === "meeting" ? "复盘" : "汇报";
  const text = selectedSession?.draftText ?? "";
  const scenario: KnowledgeScenario = mode === "复盘" ? "retrospective" : "report";
  const findings = useMemo(() => analyzeText(text, scenario).filter((item) => !dismissed.includes(`${item.ruleId}:${item.range.start}:${item.matchedText}`)), [dismissed, scenario, text]);

  const newSession = () => {
    const scenarioId = controller.scenarios.find((item) =>
      mode === "复盘" ? item.category === "meeting" : item.category === "work-report",
    )?.id;
    controller.createSession({
      kind: "practice",
      title: mode === "复盘" ? "新的项目复盘" : "新的工作汇报",
      scenarioId,
    });
  };

  const changeMode = (nextMode: AnalysisMode) => {
    if (!selectedSession || nextMode === mode) return;
    const scenarioId = controller.scenarios.find((item) =>
      nextMode === "复盘" ? item.category === "meeting" : item.category === "work-report",
    )?.id;
    if (!scenarioId) return;
    controller.updateSession(selectedSession.id, (session) => ({
      ...session,
      scenarioId,
      title: session.title.startsWith("新的")
        ? (nextMode === "复盘" ? "新的项目复盘" : "新的工作汇报")
        : session.title,
    }));
  };

  const finishExpression = () => {
    if (!selectedSession || !text.trim() || text === savedText) return;
    controller.addStatement(
      {
        text: text.trim(),
        source: "typed",
        metrics: {
          wordCount: text.trim().length,
          fillerWordCount: findings.filter((item) => /口头|填充/.test(item.issueType)).length,
          repeatedPhraseCount: findings.filter((item) => /重复|冗余/.test(item.issueType)).length,
          averageSentenceLength: text.trim().length / Math.max(1, text.split(/[。！？!?]/).filter(Boolean).length),
        },
      },
      selectedSession.id,
    );
    const score = Math.max(60, 96 - findings.length * 4);
    controller.updateSession(selectedSession.id, (session) => ({ ...session, status: "completed", report: {
      id: `report-${crypto.randomUUID()}`, sessionId: session.id, title: `${session.title}复盘`, overallScore: score,
      dimensions: [
        { key: "structure", label: "结构", score: Math.max(60, score - findings.filter((item) => findingTone(item) === "structure").length * 3), summary: "根据本地结构规则生成" },
        { key: "clarity", label: "清晰度", score, summary: "根据模糊表达和句长生成" },
        { key: "evidence", label: "证据", score, summary: "建议用事实和数字支撑关键结论" },
        { key: "brevity", label: "简洁度", score: Math.max(60, score - findings.filter((item) => findingTone(item) === "filler").length * 3), summary: "根据口头禅和冗余表达生成" },
        { key: "confidence", label: "自信度", score, summary: "本地文字分析暂不判断语音状态" },
      ], strengths: findings.length ? ["原文已完整保留，可逐项修正"] : ["未发现已知的高频表达问题"],
      improvements: findings.slice(0, 3).map((item) => `${item.issueType}：${item.suggestion}`),
      actionItems: findings.slice(0, 2).map((item) => item.suggestion), generatedAt: new Date().toISOString(),
    } }));
    setSavedText(text);
  };

  const acceptFinding = (finding: AnalysisFinding) => {
    if (!selectedSession) return;
    const replacement = finding.replacements[0];
    if (!replacement) return;
    controller.updateSessionText(`${text.slice(0, finding.range.start)}${replacement}${text.slice(finding.range.end)}`, selectedSession.id);
  };

  const processVoiceChunks = async (force = false): Promise<void> => {
    const microphone = microphoneRef.current;
    if (!microphone) return;
    if (microphone.processing) return microphone.processing;
    const threshold = microphone.sampleRate * LIVE_TRANSCRIPTION_WINDOW_SECONDS;
    if (!force && microphone.chunks.reduce((sum, item) => sum + item.length, 0) < threshold) return;
    const model = controller.preferences.installedModels.find((item) => item.status === "ready");
    const sessionId = selectedSession?.id;
    microphone.processing = (async () => {
      microphone.busy = true;
      try {
        if (!model) throw new Error("请先在设置中下载本地转写模型");
        do {
          const sourceLength = microphone.chunks.reduce((sum, item) => sum + item.length, 0);
          if (!sourceLength || (!force && sourceLength < threshold)) break;
          const source = new Float32Array(sourceLength); let offset = 0;
          for (const chunk of microphone.chunks) { source.set(chunk, offset); offset += chunk.length; }
          microphone.chunks = [];
          const targetLength = Math.max(1, Math.round(source.length * 16_000 / microphone.sampleRate));
          const samples = new Float32Array(targetLength);
          for (let index = 0; index < targetLength; index += 1) {
            const position = index * microphone.sampleRate / 16_000;
            const before = Math.floor(position); const after = Math.min(source.length - 1, before + 1); const ratio = position - before;
            samples[index] = source[before] * (1 - ratio) + source[after] * ratio;
          }
          setVoiceStatus("正在识别，同时继续聆听…");
          const result = await localTranscriptionRuntime.transcribe(model.id, samples);
          if (result.text && sessionId) {
            controller.updateSession(sessionId, (session) => ({ ...session, draftText: `${session.draftText}${result.text.trim()}` }));
          }
          force = microphone.stopping;
        } while (microphone.chunks.reduce((sum, item) => sum + item.length, 0) >= (force ? 1 : threshold));
        setVoiceStatus(microphone.stopping ? "正在完成最后一段识别…" : "正在聆听");
      } catch (error) {
        setVoiceStatus(error instanceof Error ? error.message : "语音识别失败");
      } finally {
        microphone.busy = false;
        microphone.processing = null;
      }
    })();
    return microphone.processing;
  };

  const toggleMicrophone = async () => {
    if (microphoneRef.current) {
      const current = microphoneRef.current;
      current.stopping = true;
      current.processor.disconnect(); current.source.disconnect(); current.stream.getTracks().forEach((track) => track.stop());
      setIsListening(false); setVoiceStatus("正在完成最后一段识别…");
      if (current.processing) await current.processing;
      await processVoiceChunks(true);
      await current.context.close(); microphoneRef.current = null; setVoiceStatus("语音输入已结束");
      return;
    }
    if (!selectedSession) return;
    if (!controller.preferences.installedModels.some((item) => item.status === "ready")) { setVoiceStatus("请先在设置中下载本地转写模型"); return; }
    try {
      const model = controller.preferences.installedModels.find((item) => item.status === "ready");
      if (!model) return;
      setVoiceStatus("正在预热本地转写模型…");
      await localTranscriptionRuntime.install(model.id);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const context = new AudioContext(); const source = context.createMediaStreamSource(stream); const processor = context.createScriptProcessor(4096, 1, 1);
      microphoneRef.current = { stream, context, processor, source, chunks: [], sampleRate: context.sampleRate, busy: false, stopping: false, processing: null };
      processor.onaudioprocess = (event) => { const current = microphoneRef.current; if (!current) return; current.chunks.push(event.inputBuffer.getChannelData(0).slice()); void processVoiceChunks(); };
      source.connect(processor); processor.connect(context.destination); setIsListening(true); setVoiceStatus("正在聆听，约 1.5 秒更新一次文字");
    } catch (error) { setVoiceStatus(error instanceof Error ? error.message : "无法访问麦克风"); }
  };

  return (
    <div className="page workspace-page">
      <PageHeader
        eyebrow="表达工作台"
        title="把内容从“能听懂”推到“记得住”"
        description="边写边看局部反馈，不打断你的完整思路。"
        action={<NewSessionButton onClick={newSession} />}
      />

      <div className="studio-layout">
        <aside className="session-rail">
          <div className="session-rail-title"><span>历史会话</span><strong>{sessions.length}</strong></div>
          <label className="session-search"><Search size={13} /><input value={search} placeholder="搜索标题或内容" onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="session-list">
            {sessions.map((session) => (
              <button
                className={selectedSession?.id === session.id ? "session-item active" : "session-item"}
                type="button"
                key={session.id}
                onClick={() => controller.selectSession(session.id)}
              >
                <span>{formatSessionTime(session.updatedAt)}</span>
                <strong>{session.title}</strong>
                <small>{sessionPreview(session)}</small>
              </button>
            ))}
            {!sessions.length ? <p className="empty-session-copy">还没有表达会话</p> : null}
          </div>
        </aside>

        <section className="editor-panel">
          <div className="editor-toolbar">
            <div className="segmented-control">
              {(["汇报", "复盘"] as const).map((item) => (
                <button className={mode === item ? "active" : ""} type="button" key={item} onClick={() => changeMode(item)}>{item}</button>
              ))}
            </div>
            <button className={isListening ? "icon-button recording" : "icon-button"} type="button" aria-label={isListening ? "停止语音输入" : "开始语音输入"} onClick={() => void toggleMicrophone()}>{isListening ? <MicOff size={18} /> : <Mic size={18} />}</button>
          </div>
          <textarea
            className="expression-input"
            value={text}
            disabled={!selectedSession}
            onChange={(event) => selectedSession && controller.updateSessionText(event.target.value, selectedSession.id)}
            placeholder={selectedSession ? "先写下你最想让对方记住的结论……" : "新建一个会话后开始表达……"}
          />
          <div className="editor-footer">
            <span>{voiceStatus || `${text.length} 字 · ${findings.length} 处可改善`}</span>
            <button type="button" disabled={!selectedSession || !text.trim() || text === savedText} onClick={finishExpression}><CornerDownLeft size={15} /> {text === savedText && text ? "已记录" : "完成表达"}</button>
          </div>
        </section>

        <aside className="analysis-panel">
          <div className="analysis-heading">
            <span><Sparkles size={16} /> 即时标注</span>
            <strong>{Math.max(60, 94 - findings.length * 4)}</strong>
          </div>
          <div className="annotated-preview">
            <HighlightedText text={text} findings={findings} />
          </div>
          <div className="annotation-list">
            {findings.map((finding) => {
              const tone = findingTone(finding);
              return (
                <div className="annotation-item" key={`${finding.ruleId}-${finding.range.start}`}>
                  <span className={`annotation-key ${tone}`}>{finding.matchedText}</span>
                  <div><strong>{finding.issueType}</strong><p>{finding.reason} {finding.suggestion}</p><div className="finding-actions"><button type="button" onClick={() => finding.replacements[0] ? acceptFinding(finding) : setDismissed([...dismissed, `${finding.ruleId}:${finding.range.start}:${finding.matchedText}`])}><Check size={12} /> {finding.replacements[0] ? `改为“${finding.replacements[0]}”` : "采纳建议"}</button><button type="button" onClick={() => setDismissed([...dismissed, `${finding.ruleId}:${finding.range.start}:${finding.matchedText}`])}><X size={12} /> 忽略</button></div></div>
                </div>
              );
            })}
            {!findings.length ? (
              <div className="empty-analysis"><FileText size={20} /><span>{text ? "当前规则未发现明显问题" : "等待输入表达内容"}</span></div>
            ) : null}
          </div>
          {voiceStatus.includes("设置") ? <button className="recovery-link" type="button" onClick={() => controller.navigate("settings")}>前往设置下载模型</button> : null}
          {selectedSession?.report ? <div className="session-review"><p className="eyebrow">本次复盘</p><strong>{selectedSession.report.overallScore} 分</strong><p>{selectedSession.report.improvements[0] ?? selectedSession.report.strengths[0]}</p><button type="button" onClick={() => { const plan = controller.trainingPlans.find((item) => item.status === "active") ?? controller.trainingPlans[0]; if (!plan) { controller.navigate("training"); return; } controller.upsertTrainingPlan({ ...plan, tasks: [...plan.tasks, { id: `task-${crypto.randomUUID()}`, title: `复盘：${selectedSession.title}`, description: selectedSession.report?.actionItems[0] ?? "再次完成同场景练习", scenarioId: selectedSession.scenarioId, targetMinutes: 10, status: "todo" }], updatedAt: new Date().toISOString() }); }}>加入训练计划</button></div> : null}
          {selectedSession ? <button className="delete-session" type="button" onClick={() => { if (window.confirm(`删除会话“${selectedSession.title}”？`)) controller.deleteSession(selectedSession.id); }}><Trash2 size={13} /> 删除当前会话</button> : null}
        </aside>
      </div>
    </div>
  );
}
