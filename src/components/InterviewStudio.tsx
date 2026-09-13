import { Check, ChevronRight, FileCheck2, FileUp, LoaderCircle, LockKeyhole, MessageCircleQuestion, Plus, Save, Sparkles } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import { isInterviewSession, type InterviewAnswerFeedback, type InterviewQuestion, type Material } from "../core/types";
import { requestChatCompletion } from "../providers/openAiCompatible";
import { analyzeText } from "../knowledge";
import { buildInterviewAnswerPrompt, buildInterviewQuestionPrompt } from "../prompts/scenarioPrompts";
import { readDocumentText } from "../materials/readDocument";
import { NewSessionButton, PageHeader, StatusDot } from "./ui";
import { useAppDialog } from "./useAppDialog";
import { answerFramework, extractJobRequirements, localFollowUp, localQuestions, QUESTION_RULE_VERSION } from "../knowledge/interviewQuestions";
import { parseInterviewFeedback, parseInterviewQuestions } from "../providers/interviewResponse";

function formatSessionTime(value: string): string {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? `今天 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`
    : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

export function InterviewStudio({ controller }: { controller: WorkspaceController }) {
  const appDialog = useAppDialog();
  const materialInputPrefix = useId().replace(/:/g, "");
  const [materialEditorSessionId, setMaterialEditorSessionId] = useState<string | null>(null);
  const [operations, setOperations] = useState<string[]>([]);
  const operationRef = useRef(new Map<string, AbortController>());
  const consentRef = useRef(new Set<string>());
  const [generationMode, setGenerationMode] = useState<"local" | "ai" | null>(null);
  const [actionError, setActionError] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const importsRef = useRef(new Map<string, number>());
  const [importing, setImporting] = useState(0);
  const sessions = controller.sessions.filter(isInterviewSession);
  const selectedSession = controller.selectedSession && isInterviewSession(controller.selectedSession) ? controller.selectedSession : sessions[0] ?? null;
  const questions = selectedSession?.interviewQuestions ?? [];
  const activeQuestion = questions.length ? Math.min(selectedSession?.activeQuestionIndex ?? 0, questions.length - 1) : 0;
  const question = questions[activeQuestion];
  const answer = question ? (selectedSession?.questionAnswers?.[question.id] ?? "") : "";
  const localAnswerFindings = useMemo(() => analyzeText(answer, "interview"), [answer]);
  const feedback = question ? selectedSession?.interviewFeedback?.[question.id] : undefined;
  const materialsLocked = Boolean(selectedSession?.materialsLocked);
  const isEditingMaterials = selectedSession?.id === materialEditorSessionId;
  const canUseAi = controller.preferences.aiProvider.enabled && Boolean(controller.preferences.aiProvider.model.trim()) && Boolean(controller.preferences.aiProvider.baseUrl.trim());
  const mode = generationMode ?? (canUseAi ? "ai" : "local");
  const isGenerating = operations.includes(`questions:${selectedSession?.id}`);
  const isAnalyzing = operations.includes(`analysis:${selectedSession?.id}`);
  const legacyQuestions = questions.some((item) => item.source === "local" && !item.ruleVersion);
  const requirements = useMemo(() => extractJobRequirements(selectedSession?.jobDescription.content ?? ""), [selectedSession?.jobDescription.content]);
  useEffect(() => { setActionError(""); appDialog.cancelDialog(); }, [selectedSession?.id, appDialog.cancelDialog]);
  useEffect(() => () => { for (const abort of operationRef.current.values()) abort.abort(); operationRef.current.clear(); }, []);
  const beginOperation = (key: string) => {
    if (operationRef.current.has(key)) return null;
    const abort = new AbortController();
    operationRef.current.set(key, abort); setOperations([...operationRef.current.keys()]);
    return abort;
  };
  const endOperation = (key: string, abort: AbortController) => {
    if (operationRef.current.get(key) !== abort) return;
    operationRef.current.delete(key); setOperations([...operationRef.current.keys()]);
  };
  const isViewing = (id: string) => {
    const latest = controllerRef.current.getSnapshot?.() ?? controllerRef.current;
    const selected = latest.sessions.find((item) => item.id === latest.selectedSessionId && isInterviewSession(item)) ?? latest.sessions.find(isInterviewSession);
    return selected?.id === id;
  };
  const approveAi = async (sessionId: string) => {
    if (!canUseAi) { setActionError("请先在设置中启用AI，填写模型、服务地址并保存API Key；也可以继续使用本地出题与答题框架。"); return false; }
    const consentKey = JSON.stringify([sessionId, controller.preferences.aiProvider.baseUrl, controller.preferences.aiProvider.model]);
    if (consentRef.current.has(consentKey)) return true;
    const approved = await appDialog.confirm("将当前会话的JD、简历及本次问题和回答发送到你配置的AI服务，用于出题、追问与参考回答？不会发送其他会话；本次停留期间不重复询问。", { confirmLabel: "同意并继续" });
    if (approved && isViewing(sessionId)) { consentRef.current.add(consentKey); return true; }
    return false;
  };

  const materialSummary = useMemo(() => {
    if (!selectedSession) return "";
    return `JD ${selectedSession.jobDescription.content.length} 字 · 简历 ${selectedSession.resume.content.length} 字`;
  }, [selectedSession]);

  const newSession = () => {
    const session = controller.createSession({ kind: "interview", title: "新的面试准备", scenarioId: controller.scenarios.find((scenario) => scenario.category === "interview")?.id });
    setMaterialEditorSessionId(session.id);
    setActionError("");
  };

  const updateMaterial = (kind: "jobDescription" | "resume", patch: Partial<Pick<Material, "title" | "content" | "sourceName">>) => {
    if (!selectedSession || materialsLocked) return;
    controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, [kind]: { ...session[kind], ...patch, updatedAt: new Date().toISOString() } } : session);
  };

  const importMaterial = async (kind: "jobDescription" | "resume", file?: File) => {
    if (!file || !selectedSession || materialsLocked) return;
    const sessionId = selectedSession.id;
    const key = `${sessionId}:${kind}`;
    const revision = (importsRef.current.get(key) ?? 0) + 1;
    importsRef.current.set(key, revision);
    setImporting((count) => count + 1);
    try {
      const content = await readDocumentText(file);
      if (importsRef.current.get(key) !== revision) return;
      controller.updateSession(sessionId, (session) => isInterviewSession(session) && !session.materialsLocked ? { ...session, [kind]: { ...session[kind], title: file.name, sourceName: file.name, content, updatedAt: new Date().toISOString() } } : session);
      setActionError("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "材料解析失败");
    } finally { setImporting((count) => count - 1); }
  };

  const confirmMaterials = () => {
    if (importing || !selectedSession?.jobDescription.content.trim() || !selectedSession.resume.content.trim()) return;
    const initialQuestions = localQuestions(selectedSession.jobDescription.content, selectedSession.resume.content);
    controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, materialsLocked: true, interviewQuestions: initialQuestions, activeQuestionIndex: 0 } : session);
    setMaterialEditorSessionId(null);
    setActionError("材料已固定，先生成本地能力题。可在下方选择AI出题，或直接查看每题答题框架。");
  };

  const generateQuestions = async (followUp = false) => {
    if (!selectedSession || !materialsLocked) return;
    if (followUp && (!question || !answer.trim())) { setActionError("先在当前题目下填写回答，再根据回答追问。"); return; }
    if (mode === "local") {
      const generated = followUp && question ? localFollowUp(question, answer, questions) : localQuestions(selectedSession.jobDescription.content, selectedSession.resume.content, questions);
      if (!generated.length) { setActionError("本地相关题目已全部生成，不重复添加。可以继续作答后追问，或切换AI生成更深入的问题。"); return; }
      controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, interviewQuestions: [...(session.interviewQuestions ?? []), ...generated], activeQuestionIndex: session.interviewQuestions?.length ?? 0 } : session);
      setActionError(`已生成${generated.length}道${followUp ? "本地追问" : "本地能力题"}，原问题与回答继续保留。`);
      return;
    }
    const key = `questions:${selectedSession.id}`;
    const abort = beginOperation(key);
    if (!abort) return;
    setActionError("");
    try {
      if (!await approveAi(selectedSession.id)) return;
      abort.signal.throwIfAborted();
      const content = await requestChatCompletion(
        controller.preferences.aiProvider,
        buildInterviewQuestionPrompt(selectedSession.jobDescription.content, selectedSession.resume.content, followUp && question ? { question: question.text, answer } : undefined, questions.map((item) => item.text)),
        { signal: abort.signal, maxTokens: 2400 },
      );
      abort.signal.throwIfAborted();
      const generated = parseInterviewQuestions(content, selectedSession.jobDescription.content, selectedSession.resume.content, questions, followUp ? question?.id : undefined);
      controller.updateSession(selectedSession.id, (session) => {
        if (!isInterviewSession(session) || session.jobDescription.content !== selectedSession.jobDescription.content || session.resume.content !== selectedSession.resume.content || (followUp && question && session.questionAnswers?.[question.id] !== answer)) return session;
        const additions = generated.filter((item) => !(session.interviewQuestions ?? []).some((old) => old.text === item.text));
        return { ...session, interviewQuestions: [...(session.interviewQuestions ?? []), ...additions], activeQuestionIndex: isViewing(session.id) ? session.interviewQuestions?.length ?? 0 : session.activeQuestionIndex };
      });
    } catch (error) { if (!abort.signal.aborted && isViewing(selectedSession.id)) setActionError(error instanceof Error ? error.message : "问题生成失败"); }
    finally { endOperation(key, abort); }
  };

  const replaceLegacyQuestions = () => {
    if (!selectedSession) return;
    controller.updateSession(selectedSession.id, (session) => {
      if (!isInterviewSession(session)) return session;
      const kept = (session.interviewQuestions ?? []).filter((item) => item.source !== "local" || item.ruleVersion || session.questionAnswers?.[item.id]?.trim() || session.interviewFeedback?.[item.id]);
      const generated = localQuestions(session.jobDescription.content, session.resume.content, kept);
      return { ...session, interviewQuestions: [...kept, ...generated], activeQuestionIndex: generated.length ? kept.length : 0 };
    });
    setActionError("已更新尚未作答的旧本地题；有回答或反馈的题目继续保留。");
  };

  const selectQuestion = (index: number) => selectedSession && controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, activeQuestionIndex: index, draftText: session.questionAnswers?.[questions[index].id] ?? "" } : session);
  const updateAnswer = (value: string) => selectedSession && question && controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, draftText: value, interviewFeedback: { ...session.interviewFeedback, [question.id]: undefined }, questionAnswers: { ...session.questionAnswers, [question.id]: value } } : session);

  const analyzeAnswer = async () => {
    if (!selectedSession || !question) return;
    if (!answer.trim()) { setActionError("请先写下你的回答。尚未作答时可以参考下方的答题框架。"); return; }
    const key = `analysis:${selectedSession.id}`;
    const abort = beginOperation(key);
    if (!abort) return;
    setActionError("");
    try {
      if (!await approveAi(selectedSession.id)) return;
      abort.signal.throwIfAborted();
      const content = await requestChatCompletion(controller.preferences.aiProvider, buildInterviewAnswerPrompt({
        jobDescription: selectedSession.jobDescription.content,
        resume: selectedSession.resume.content,
        question: question.text,
        answer,
      }), { signal: abort.signal, maxTokens: 4200 });
      abort.signal.throwIfAborted();
      const next = parseInterviewFeedback(content, { resume: selectedSession.resume.content, answer });
      controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) && session.questionAnswers?.[question.id] === answer && session.jobDescription.content === selectedSession.jobDescription.content && session.resume.content === selectedSession.resume.content ? { ...session, interviewFeedback: { ...session.interviewFeedback, [question.id]: next } } : session);
    } catch (error) { if (!abort.signal.aborted && isViewing(selectedSession.id)) setActionError(error instanceof Error ? error.message : "答案分析失败"); }
    finally { endOperation(key, abort); }
  };

  return (
    <div className="page interview-page">
      {appDialog.dialog}
      <PageHeader eyebrow="面试专区" title="围绕目标岗位，练到更具体" description="每个对话固定一份 JD 和一份简历；问题与反馈只使用当前会话材料。" action={<NewSessionButton onClick={newSession} />} />
      {selectedSession ? <div className="quick-actions"><button type="button" onClick={async () => { const title = await appDialog.prompt("会话名称", selectedSession.title); if (title?.trim()) controller.updateSession(selectedSession.id, (session) => ({ ...session, title: title.trim() })); }}>重命名会话</button><button type="button" onClick={() => controller.updateSession(selectedSession.id, (session) => ({ ...session, status: session.status === "archived" ? "active" : "archived" }))}>{selectedSession.status === "archived" ? "恢复会话" : "归档会话"}</button><button type="button" onClick={async () => { if (await appDialog.confirm("删除当前面试及其材料和回答？此操作无法撤销。", { destructive: true })) { for (const [key, abort] of operationRef.current) if (key.endsWith(`:${selectedSession.id}`)) abort.abort(); controller.deleteSession(selectedSession.id); } }}>删除面试</button></div> : null}<div className="interview-layout">
        <aside className="session-rail"><div className="session-rail-title"><span>面试记录</span><strong>{sessions.length}</strong></div><label className="session-search"><input type="search" placeholder="搜索面试历史" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />显示归档</label><div className="session-list">{sessions.filter((session) => (showArchived || session.status !== "archived") && `${session.title} ${session.jobDescription.content}`.includes(search)).map((session) => <button className={selectedSession?.id === session.id ? "session-item active" : "session-item"} type="button" key={session.id} onClick={() => { controller.selectSession(session.id); setMaterialEditorSessionId(null); setActionError(""); }}><span>{formatSessionTime(session.updatedAt)}</span><strong>{session.title}</strong><small>{session.materialsLocked ? `${session.interviewQuestions?.length ?? 0} 道题 · 材料已固定` : "等待上传材料"}</small></button>)}{!sessions.length ? <p className="empty-session-copy">还没有面试记录，请新建会话并上传材料。</p> : null}</div></aside>
        <div className="interview-main">{actionError ? <div className="action-notice" role="status">{actionError}</div> : null}{importing > 0 ? <div className="processing-status" role="status"><LoaderCircle className="spin" size={16} />正在解析材料，请稍候…</div> : null}
          {selectedSession ? <section className="context-strip"><button type="button" className="context-file ready" onClick={() => setMaterialEditorSessionId(selectedSession.id)}><span><FileCheck2 size={18} /></span><div><small>目标岗位 JD</small><strong>{selectedSession.jobDescription.title}</strong></div><em><StatusDot tone={selectedSession.jobDescription.content ? "green" : "amber"} /> {selectedSession.jobDescription.content ? "已读取" : "待上传"}</em></button><button type="button" className="context-file ready" onClick={() => setMaterialEditorSessionId(selectedSession.id)}><span><FileCheck2 size={18} /></span><div><small>个人简历</small><strong>{selectedSession.resume.title}</strong></div><em><StatusDot tone={selectedSession.resume.content ? "green" : "amber"} /> {selectedSession.resume.content ? "已读取" : "待上传"}</em></button><button type="button" className="context-upload" onClick={() => materialsLocked ? newSession() : setMaterialEditorSessionId(selectedSession.id)}>{materialsLocked ? <Plus size={17} /> : <FileUp size={17} />}{materialsLocked ? "用新材料新建" : "上传材料"}</button></section> : null}
          {isEditingMaterials && selectedSession ? <section className="material-editor"><div className="material-editor-heading"><div><p className="eyebrow">会话专属材料</p><h2>上传或粘贴 JD 与简历</h2></div><span><LockKeyhole size={14} /> {materialsLocked ? "材料已固定，可查看不可编辑" : "确认后固定"}</span></div><div className="material-editor-grid">{(["jobDescription", "resume"] as const).map((kind) => { const inputId = `${materialInputPrefix}-${kind}`; return <div className="material-field" key={kind}><span>{kind === "jobDescription" ? "目标岗位 JD" : "个人简历"}</span><input aria-label={`${kind === "jobDescription" ? "目标岗位 JD" : "个人简历"}标题`} readOnly={materialsLocked} value={selectedSession[kind].title} onChange={(event) => updateMaterial(kind, { title: event.target.value })} /><textarea aria-label={`${kind === "jobDescription" ? "目标岗位 JD" : "个人简历"}正文`} readOnly={materialsLocked} value={selectedSession[kind].content} placeholder="粘贴正文，或从下方选择文件" onChange={(event) => updateMaterial(kind, { content: event.target.value })} /><input id={inputId} className="visually-hidden" disabled={materialsLocked || importing > 0} type="file" accept=".txt,.md,.json,.csv,.pdf,.docx,text/plain" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void importMaterial(kind, file); }} />{!materialsLocked ? <label className="material-file-trigger" htmlFor={inputId}><FileUp size={13} /> 选择文件</label> : <small>材料已固定；更换材料请新建会话</small>}</div>; })}</div><div className="material-editor-actions"><span>{materialSummary || "材料只保存在当前会话"}</span>{!materialsLocked ? <button type="button" disabled={importing > 0 || !selectedSession.jobDescription.content.trim() || !selectedSession.resume.content.trim()} onClick={confirmMaterials}><Save size={15} /> 确认并固定材料</button> : null}<button type="button" className="button-secondary" onClick={() => setMaterialEditorSessionId(null)}>关闭材料</button></div></section> : null}
          {!selectedSession ? <section className="empty-state"><FileUp size={30} /><h2>创建第一场面试模拟</h2><p>新建会话后上传一份 JD 和一份简历，确认后材料固定在该会话中。</p><button className="button-primary compact-button" type="button" onClick={newSession}><Plus size={15} /> 新建面试会话</button></section> : !materialsLocked ? <section className="empty-state"><FileUp size={30} /><h2>先完成材料设置</h2><p>上传或粘贴 JD 与简历后，系统才会生成针对性问题。</p><button className="button-primary compact-button" type="button" onClick={() => setMaterialEditorSessionId(selectedSession.id)}><FileUp size={15} /> 上传材料</button></section> : <>
            <section className="interview-mode-control" aria-label="面试出题方式">
              <span>出题与追问</span><button type="button" className={mode === "local" ? "active" : ""} aria-pressed={mode === "local"} onClick={() => setGenerationMode("local")}>本地出题</button>
              <button type="button" className={mode === "ai" ? "active" : ""} aria-pressed={mode === "ai"} onClick={() => setGenerationMode("ai")}>AI 出题</button>
              <small>{mode === "ai" ? canUseAi ? "使用设置中的AI配置；发送前会确认当前会话材料" : "尚未配置AI，请先设置；也可切回本地出题" : "离线能力题与追问，不发送材料"}</small>
              {!canUseAi ? <button type="button" onClick={() => controller.navigate("settings")}>前往 AI 设置</button> : null}
            </section>
            {!requirements.length ? <p className="file-warning">未识别到明确职责或能力要求，当前本地题仅为通用练习，不代表岗位定制。请核对JD正文。</p> : null}
            {legacyQuestions ? <div className="legacy-question-notice"><p>当前会话含旧版本地题。可更新未作答题目，已有回答与反馈不删除。</p><button type="button" onClick={replaceLegacyQuestions}>更新未作答的旧题</button></div> : null}
            <section className="interview-question-panel"><div className="interview-question-topline"><div><p className="eyebrow">{question ? `模拟问题 ${activeQuestion + 1} / ${questions.length}` : "等待生成问题"}</p><span>{question ? `${question.tag} · 建议 ${question.suggestedMinutes} 分钟 · ${question.source === "ai" ? "AI 生成" : "本地规则"}` : "依据当前 JD 生成"}</span></div><button className="text-button" type="button" disabled={isGenerating} onClick={() => void generateQuestions()}>{isGenerating ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} 生成新问题</button></div>{question ? <><h2>{question.text}</h2>{question.jdEvidence ? <blockquote>依据 JD：{question.jdEvidence}</blockquote> : null}{question.resumeEvidence ? <blockquote>关联简历：{question.resumeEvidence}</blockquote> : null}<textarea aria-label="面试回答" value={answer} onChange={(event) => updateAnswer(event.target.value)} placeholder="用 STAR 或结论先行的方式开始回答……" />{localAnswerFindings.length ? <div className="interview-live-feedback"><strong>本地即时建议 · {localAnswerFindings.length}</strong>{localAnswerFindings.map((finding) => <p key={`${finding.ruleId}-${finding.range.start}`}><span>{finding.issueType}</span>{finding.suggestion}</p>)}</div> : null}<div className="interview-question-actions"><button type="button" disabled={isGenerating} aria-describedby="interview-answer-hint" onClick={() => void generateQuestions(true)}>根据回答追问</button><span id="interview-answer-hint">{answer.trim() ? `${answer.length} 字 · 原答案保存在当前会话` : "先填写回答后可追问和分析；也可先看答题框架"}</span><button type="button" disabled={isAnalyzing} aria-describedby="interview-answer-hint" onClick={() => void analyzeAnswer()}>{isAnalyzing ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} 深度分析回答</button><button className="next-question" type="button" disabled={questions.length < 2} title={questions.length < 2 ? "目前只有一道题，请先生成新问题" : "切换到下一题，当前回答会保留"} onClick={() => selectQuestion((activeQuestion + 1) % questions.length)}>下一题 <ChevronRight size={16} /></button></div></> : <div className="question-empty"><p>尚未生成问题。</p><button type="button" onClick={() => void generateQuestions()}><Sparkles size={15} /> 根据材料生成</button></div>}</section>

            {question ? <section className="answer-framework"><p className="eyebrow">这道题怎么回答</p><h2>先搭结构，再填真实经历</h2><ol>{answerFramework(question.text).map((step) => <li key={step}>{step}</li>)}</ol><p>这是组织思路的框架，不是虚构的标准答案。填写你的回答后，AI可结合本会话材料生成参考稿。</p></section> : null}
            {feedback ? <section className="interview-feedback"><div className="section-heading compact"><div><p className="eyebrow">回答反馈</p><h2>基于 JD 与简历的四维检查</h2></div><span>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(feedback.createdAt))}</span></div><div className="feedback-grid"><article><strong>表达结构</strong><p>{feedback.structure}</p></article><article><strong>JD 匹配</strong><p>{feedback.jdMatch}</p></article><article><strong>简历一致性</strong><p>{feedback.resumeConsistency}</p></article><article><strong>证据强度</strong><p>{feedback.evidenceStrength}</p></article></div><div className="overall-suggestion"><strong>优先优化</strong><p>{feedback.overallSuggestion}</p></div>
              {feedback.referenceAnswer ? <div className="answer-reference">
                <p className="eyebrow">AI 优化参考 · 尚未采纳</p><h2>原回答与优化参考</h2><p>依据当前简历和原回答生成，仍需你核对事实；【待补充】必须由你填写，不代表唯一最优答案。</p>
                <div className="answer-comparison"><article><h3>你的原回答</h3><p>{feedback.answerSnapshot ?? answer}</p></article><article><h3>优化参考回答</h3><p>{feedback.referenceAnswer}</p></article></div>
                <h3>推荐答题框架</h3><ol>{feedback.answerFramework?.map((step, index) => <li key={index}>{step}</li>)}</ol>
                <h3>为什么这样改</h3><ul>{feedback.revisionNotes?.map((note, index) => <li key={index}>{note}</li>)}</ul>
                {feedback.missingFacts?.length ? <><h3>需要你补充的事实</h3><ul>{feedback.missingFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul></> : null}
                {feedback.supportingEvidence?.length ? <details><summary>查看引用依据</summary>{feedback.supportingEvidence.map((evidence, index) => <blockquote key={index}>{evidence.source === "resume" ? "简历" : "原回答"}：{evidence.quote}</blockquote>)}</details> : null}
              </div> : <div className="reference-missing"><p>这份历史反馈没有参考回答。可重新分析生成答题框架和优化参考稿，原答案不会被替换。</p><button type="button" disabled={isAnalyzing} onClick={() => void analyzeAnswer()}>生成优化参考回答</button></div>}
            </section> : null}
            <section className="question-outline"><div className="section-heading compact"><div><p className="eyebrow">本轮问题</p><h2>岗位针对性模拟</h2></div><span>{questions.length} 道题</span></div><div className="question-list">{questions.map((item, index) => <button className={activeQuestion === index ? "question-row active" : "question-row"} type="button" key={item.id} onClick={() => selectQuestion(index)}><span className="question-index">{selectedSession.questionAnswers?.[item.id] ? <Check size={14} /> : `0${index + 1}`}</span><span><strong>{item.tag}</strong><small>{item.text}</small></span><MessageCircleQuestion size={17} /></button>)}</div></section>
          </>}
        </div>
      </div>
    </div>
  );
}
