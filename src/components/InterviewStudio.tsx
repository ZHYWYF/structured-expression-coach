import { Check, ChevronRight, FileCheck2, FileUp, LoaderCircle, LockKeyhole, MessageCircleQuestion, Plus, Save, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import { isInterviewSession, type InterviewAnswerFeedback, type InterviewQuestion, type Material } from "../core/types";
import { requestChatCompletion } from "../providers/openAiCompatible";
import { analyzeText } from "../knowledge";
import { buildInterviewAnswerPrompt, buildInterviewQuestionPrompt } from "../prompts/scenarioPrompts";
import { readDocumentText } from "../materials/readDocument";
import { NewSessionButton, PageHeader, StatusDot } from "./ui";

function formatSessionTime(value: string): string {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? `今天 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`
    : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

function localQuestions(jd: string): InterviewQuestion[] {
  const clauses = jd.split(/[。；;\n]/).map((item) => item.trim()).filter((item) => item.length >= 6).slice(0, 4);
  return clauses.map((clause, index) => ({
    id: `question-${crypto.randomUUID?.() ?? `${Date.now()}-${index}`}`,
    tag: index === 0 ? "核心能力" : "岗位要求",
    text: `请结合一段真实经历，说明你如何体现“${clause.slice(0, 42)}${clause.length > 42 ? "…" : ""}”。`,
    suggestedMinutes: 3,
    source: "local",
    jdEvidence: clause,
  }));
}

function parseJsonObject<T>(content: string): T {
  const normalized = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(normalized) as T;
}

export function InterviewStudio({ controller }: { controller: WorkspaceController }) {
  const [materialEditorSessionId, setMaterialEditorSessionId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [actionError, setActionError] = useState("");
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
  const canUseAi = controller.preferences.aiProvider.enabled && Boolean(controller.preferences.aiProvider.model.trim());

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
    if (!file) return;
    try {
      updateMaterial(kind, { title: file.name, sourceName: file.name, content: await readDocumentText(file) });
      setActionError("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "材料解析失败");
    }
  };

  const confirmMaterials = () => {
    if (!selectedSession?.jobDescription.content.trim() || !selectedSession.resume.content.trim()) return;
    const initialQuestions = localQuestions(selectedSession.jobDescription.content);
    controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, materialsLocked: true, interviewQuestions: initialQuestions, activeQuestionIndex: 0 } : session);
    setMaterialEditorSessionId(null);
  };

  const generateQuestions = async () => {
    if (!selectedSession || !materialsLocked) return;
    if (!canUseAi) {
      const generated = localQuestions(selectedSession.jobDescription.content);
      controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, interviewQuestions: generated, activeQuestionIndex: 0 } : session);
      setActionError("当前使用本地材料规则生成问题。配置 AI 后可生成更深入的追问。");
      return;
    }
    setIsGenerating(true); setActionError("");
    try {
      const content = await requestChatCompletion(
        controller.preferences.aiProvider,
        buildInterviewQuestionPrompt(selectedSession.jobDescription.content, selectedSession.resume.content),
      );
      const parsed = parseJsonObject<{ questions: Array<Omit<InterviewQuestion, "id" | "source">> }>(content);
      const generated = parsed.questions.filter((item) => item.text?.trim()).map((item) => ({ ...item, id: `question-${crypto.randomUUID()}`, source: "ai" as const, suggestedMinutes: item.suggestedMinutes || 3 }));
      if (!generated.length) throw new Error("AI 未返回有效问题");
      controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, interviewQuestions: generated, activeQuestionIndex: 0, questionAnswers: {} } : session);
    } catch (error) { setActionError(error instanceof Error ? error.message : "问题生成失败"); }
    finally { setIsGenerating(false); }
  };

  const selectQuestion = (index: number) => selectedSession && controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, activeQuestionIndex: index, draftText: session.questionAnswers?.[questions[index].id] ?? "" } : session);
  const updateAnswer = (value: string) => selectedSession && question && controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, draftText: value, questionAnswers: { ...session.questionAnswers, [question.id]: value } } : session);

  const analyzeAnswer = async () => {
    if (!selectedSession || !question || !answer.trim()) return;
    if (!canUseAi) { setActionError("答案的岗位匹配与简历一致性分析需要先在设置中配置 AI。原答案已保存在本地。"); return; }
    setIsAnalyzing(true); setActionError("");
    try {
      const content = await requestChatCompletion(controller.preferences.aiProvider, buildInterviewAnswerPrompt({
        jobDescription: selectedSession.jobDescription.content,
        resume: selectedSession.resume.content,
        question: question.text,
        answer,
      }));
      const parsed = parseJsonObject<Omit<InterviewAnswerFeedback, "createdAt">>(content);
      const next = { ...parsed, createdAt: new Date().toISOString() };
      controller.updateSession(selectedSession.id, (session) => isInterviewSession(session) ? { ...session, interviewFeedback: { ...session.interviewFeedback, [question.id]: next } } : session);
    } catch (error) { setActionError(error instanceof Error ? error.message : "答案分析失败"); }
    finally { setIsAnalyzing(false); }
  };

  return (
    <div className="page interview-page">
      <PageHeader eyebrow="面试专区" title="围绕目标岗位，练到更具体" description="每个对话固定一份 JD 和一份简历；问题与反馈只使用当前会话材料。" action={<NewSessionButton onClick={newSession} />} />
      <div className="interview-layout">
        <aside className="session-rail"><div className="session-rail-title"><span>面试记录</span><strong>{sessions.length}</strong></div><div className="session-list">{sessions.map((session) => <button className={selectedSession?.id === session.id ? "session-item active" : "session-item"} type="button" key={session.id} onClick={() => { controller.selectSession(session.id); setMaterialEditorSessionId(null); setActionError(""); }}><span>{formatSessionTime(session.updatedAt)}</span><strong>{session.title}</strong><small>{session.materialsLocked ? `${session.interviewQuestions?.length ?? 0} 道题 · 材料已固定` : "等待上传材料"}</small></button>)}{!sessions.length ? <p className="empty-session-copy">还没有面试记录，请新建会话并上传材料。</p> : null}</div></aside>
        <div className="interview-main">
          {selectedSession ? <section className="context-strip"><button type="button" className="context-file ready" onClick={() => !materialsLocked && setMaterialEditorSessionId(selectedSession.id)}><span><FileCheck2 size={18} /></span><div><small>目标岗位 JD</small><strong>{selectedSession.jobDescription.title}</strong></div><em><StatusDot tone={selectedSession.jobDescription.content ? "green" : "amber"} /> {selectedSession.jobDescription.content ? "已读取" : "待上传"}</em></button><button type="button" className="context-file ready" onClick={() => !materialsLocked && setMaterialEditorSessionId(selectedSession.id)}><span><FileCheck2 size={18} /></span><div><small>个人简历</small><strong>{selectedSession.resume.title}</strong></div><em><StatusDot tone={selectedSession.resume.content ? "green" : "amber"} /> {selectedSession.resume.content ? "已读取" : "待上传"}</em></button><button type="button" className="context-upload" onClick={() => materialsLocked ? newSession() : setMaterialEditorSessionId(selectedSession.id)}>{materialsLocked ? <Plus size={17} /> : <FileUp size={17} />}{materialsLocked ? "用新材料新建" : "上传材料"}</button></section> : null}
          {isEditingMaterials && selectedSession ? <section className="material-editor"><div className="material-editor-heading"><div><p className="eyebrow">会话专属材料</p><h2>上传或粘贴 JD 与简历</h2></div><span><LockKeyhole size={14} /> 确认后固定</span></div><div className="material-editor-grid">{(["jobDescription", "resume"] as const).map((kind) => <label key={kind}><span>{kind === "jobDescription" ? "目标岗位 JD" : "个人简历"}</span><input value={selectedSession[kind].title} onChange={(event) => updateMaterial(kind, { title: event.target.value })} /><textarea value={selectedSession[kind].content} placeholder="粘贴正文，或从下方选择文件" onChange={(event) => updateMaterial(kind, { content: event.target.value })} /><em>选择文件<input type="file" accept=".txt,.md,.json,.csv,.pdf,.docx,text/plain" onChange={(event) => void importMaterial(kind, event.target.files?.[0])} /></em></label>)}</div><div className="material-editor-actions"><span>{materialSummary || "材料只保存在当前会话"}</span><button type="button" disabled={!selectedSession.jobDescription.content.trim() || !selectedSession.resume.content.trim()} onClick={confirmMaterials}><Save size={15} /> 确认并固定材料</button></div></section> : null}
          {!selectedSession ? <section className="empty-state"><FileUp size={30} /><h2>创建第一场面试模拟</h2><p>新建会话后上传一份 JD 和一份简历，确认后材料固定在该会话中。</p><button className="button-primary compact-button" type="button" onClick={newSession}><Plus size={15} /> 新建面试会话</button></section> : !materialsLocked ? <section className="empty-state"><FileUp size={30} /><h2>先完成材料设置</h2><p>上传或粘贴 JD 与简历后，系统才会生成针对性问题。</p><button className="button-primary compact-button" type="button" onClick={() => setMaterialEditorSessionId(selectedSession.id)}><FileUp size={15} /> 上传材料</button></section> : <>
            <section className="interview-question-panel"><div className="interview-question-topline"><div><p className="eyebrow">{question ? `模拟问题 ${activeQuestion + 1} / ${questions.length}` : "等待生成问题"}</p><span>{question ? `${question.tag} · 建议 ${question.suggestedMinutes} 分钟 · ${question.source === "ai" ? "AI 生成" : "本地规则"}` : "依据当前 JD 生成"}</span></div><button className="text-button" type="button" disabled={isGenerating} onClick={() => void generateQuestions()}>{isGenerating ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} 生成新问题</button></div>{question ? <><h2>{question.text}</h2>{question.jdEvidence ? <blockquote>依据 JD：{question.jdEvidence}</blockquote> : null}<textarea value={answer} onChange={(event) => updateAnswer(event.target.value)} placeholder="用 STAR 或结论先行的方式开始回答……" />{localAnswerFindings.length ? <div className="interview-live-feedback"><strong>本地即时建议 · {localAnswerFindings.length}</strong>{localAnswerFindings.map((finding) => <p key={`${finding.ruleId}-${finding.range.start}`}><span>{finding.issueType}</span>{finding.suggestion}</p>)}</div> : null}<div className="interview-question-actions"><span>{answer.length ? `${answer.length} 字` : "答案自动保存到当前会话"}</span><button type="button" disabled={!answer.trim() || isAnalyzing} onClick={() => void analyzeAnswer()}>{isAnalyzing ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} 深度分析回答</button><button className="next-question" type="button" disabled={questions.length < 2} onClick={() => selectQuestion((activeQuestion + 1) % questions.length)}>下一题 <ChevronRight size={16} /></button></div></> : <div className="question-empty"><p>尚未生成问题。</p><button type="button" onClick={() => void generateQuestions()}><Sparkles size={15} /> 根据材料生成</button></div>}</section>
            {actionError ? <div className="action-notice" role="status">{actionError}</div> : null}
            {feedback ? <section className="interview-feedback"><div className="section-heading compact"><div><p className="eyebrow">回答反馈</p><h2>基于 JD 与简历的四维检查</h2></div><span>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(feedback.createdAt))}</span></div><div className="feedback-grid"><article><strong>表达结构</strong><p>{feedback.structure}</p></article><article><strong>JD 匹配</strong><p>{feedback.jdMatch}</p></article><article><strong>简历一致性</strong><p>{feedback.resumeConsistency}</p></article><article><strong>证据强度</strong><p>{feedback.evidenceStrength}</p></article></div><div className="overall-suggestion"><strong>优先优化</strong><p>{feedback.overallSuggestion}</p></div></section> : null}
            <section className="question-outline"><div className="section-heading compact"><div><p className="eyebrow">本轮问题</p><h2>岗位针对性模拟</h2></div><span>{questions.length} 道题</span></div><div className="question-list">{questions.map((item, index) => <button className={activeQuestion === index ? "question-row active" : "question-row"} type="button" key={item.id} onClick={() => selectQuestion(index)}><span className="question-index">{selectedSession.questionAnswers?.[item.id] ? <Check size={14} /> : `0${index + 1}`}</span><span><strong>{item.tag}</strong><small>{item.text}</small></span><MessageCircleQuestion size={17} /></button>)}</div></section>
          </>}
        </div>
      </div>
    </div>
  );
}
