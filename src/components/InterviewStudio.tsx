import { Check, ChevronRight, FileCheck2, FileUp, LockKeyhole, MessageCircleQuestion, Play, Plus, Save } from "lucide-react";
import { useState } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import { isInterviewSession, type Material } from "../core/types";
import { NewSessionButton, PageHeader, StatusDot } from "./ui";

const questions = [
  { id: "experience-deep-dive", tag: "经历深挖", text: "讲一个你通过数据发现问题，并推动产品策略调整的案例。", time: "建议 3 分钟" },
  { id: "role-match", tag: "岗位匹配", text: "如果负责一个新业务的冷启动，你会如何定义首月目标？", time: "建议 4 分钟" },
  { id: "pressure-follow-up", tag: "压力追问", text: "这个结果是否只是外部流量增长造成的？如何证明你的贡献？", time: "建议 2 分钟" },
];

const fixedJobDescription = {
  title: "商业化产品经理 JD",
  content: "负责用户增长策略、实验设计和跨团队推进；要求能够通过数据识别机会并独立拆解目标。",
};

const fixedResume = {
  title: "产品经理简历",
  content: "5 年互联网产品经验，具有增长、数据分析与复杂项目推进经历。",
};

function formatSessionTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) {
    return `今天 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`;
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

export function InterviewStudio({ controller }: { controller: WorkspaceController }) {
  const [materialEditorSessionId, setMaterialEditorSessionId] = useState<string | null>(null);
  const sessions = controller.sessions.filter(isInterviewSession);
  const selectedSession = controller.selectedSession && isInterviewSession(controller.selectedSession)
    ? controller.selectedSession
    : sessions[0] ?? null;
  const activeQuestion = Math.min(selectedSession?.activeQuestionIndex ?? 0, questions.length - 1);
  const question = questions[activeQuestion];
  const answer = selectedSession?.questionAnswers?.[question.id]
    ?? (activeQuestion === 0 ? selectedSession?.draftText : "")
    ?? "";
  const score = selectedSession?.report?.overallScore ?? selectedSession?.feedback[0]?.score ?? 86;
  const materialsLocked = selectedSession
    ? (selectedSession.materialsLocked ?? Boolean(selectedSession.jobDescription.content && selectedSession.resume.content))
    : false;
  const isEditingMaterials = selectedSession?.id === materialEditorSessionId;

  const newSession = () => {
    const session = controller.createSession({
      kind: "interview",
      title: "新的面试准备",
      scenarioId: controller.scenarios.find((scenario) => scenario.category === "interview")?.id,
      jobDescription: fixedJobDescription,
      resume: fixedResume,
    });
    setMaterialEditorSessionId(session.id);
  };

  const updateMaterial = (kind: "jobDescription" | "resume", patch: Partial<Pick<Material, "title" | "content" | "sourceName">>) => {
    if (!selectedSession || materialsLocked) return;
    controller.updateSession(selectedSession.id, (session) => {
      if (!isInterviewSession(session)) return session;
      return {
        ...session,
        [kind]: {
          ...session[kind],
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  };

  const importMaterial = async (kind: "jobDescription" | "resume", file?: File) => {
    if (!file) return;
    updateMaterial(kind, { title: file.name, sourceName: file.name, content: await file.text() });
  };

  const confirmMaterials = () => {
    if (!selectedSession?.jobDescription.content.trim() || !selectedSession.resume.content.trim()) return;
    controller.updateSession(selectedSession.id, (session) => isInterviewSession(session)
      ? { ...session, materialsLocked: true }
      : session);
    setMaterialEditorSessionId(null);
  };

  const selectQuestion = (index: number) => {
    if (!selectedSession) return;
    const targetQuestion = questions[index];
    controller.updateSession(selectedSession.id, (session) => {
      if (!isInterviewSession(session)) return session;
      return {
        ...session,
        activeQuestionIndex: index,
        draftText: session.questionAnswers?.[targetQuestion.id] ?? "",
      };
    });
  };

  const updateAnswer = (value: string) => {
    if (!selectedSession) return;
    controller.updateSession(selectedSession.id, (session) => {
      if (!isInterviewSession(session)) return session;
      return {
        ...session,
        draftText: value,
        questionAnswers: { ...session.questionAnswers, [question.id]: value },
      };
    });
  };

  return (
    <div className="page interview-page">
      <PageHeader
        eyebrow="面试专区"
        title="围绕目标岗位，练到更具体"
        description="结合 JD 与简历生成问题，并保留每次模拟记录。"
        action={<NewSessionButton onClick={newSession} />}
      />

      <div className="interview-layout">
        <aside className="session-rail">
          <div className="session-rail-title"><span>面试记录</span><strong>{sessions.length}</strong></div>
          <div className="session-list">
            {sessions.map((session) => (
              <button
                className={selectedSession?.id === session.id ? "session-item active" : "session-item"}
                type="button"
                key={session.id}
                onClick={() => {
                  controller.selectSession(session.id);
                  setMaterialEditorSessionId(null);
                }}
              >
                <span>{formatSessionTime(session.updatedAt)}</span>
                <strong>{session.title}</strong>
                <small>{session.draftText ? `${session.draftText.slice(0, 24)}${session.draftText.length > 24 ? "…" : ""}` : "等待开始模拟"}</small>
              </button>
            ))}
            {!sessions.length ? <p className="empty-session-copy">还没有面试记录</p> : null}
          </div>
        </aside>

        <div className="interview-main">
          <section className="context-strip">
            <button type="button" className="context-file ready" disabled={!selectedSession} onClick={() => !materialsLocked && selectedSession && setMaterialEditorSessionId(selectedSession.id)}>
              <span><FileCheck2 size={18} /></span>
              <div><small>目标岗位 JD</small><strong>{selectedSession?.jobDescription.title ?? fixedJobDescription.title}</strong></div>
              <em><StatusDot tone={selectedSession?.jobDescription.content ? "green" : "amber"} /> {selectedSession?.jobDescription.content ? "已解析" : "待补充"}</em>
            </button>
            <button type="button" className="context-file ready" disabled={!selectedSession} onClick={() => !materialsLocked && selectedSession && setMaterialEditorSessionId(selectedSession.id)}>
              <span><FileCheck2 size={18} /></span>
              <div><small>个人简历</small><strong>{selectedSession?.resume.title ?? fixedResume.title}</strong></div>
              <em><StatusDot tone={selectedSession?.resume.content ? "green" : "amber"} /> {selectedSession?.resume.content ? "已解析" : "待补充"}</em>
            </button>
            <button
              type="button"
              className="context-upload"
              disabled={!selectedSession}
              onClick={() => materialsLocked ? newSession() : selectedSession && setMaterialEditorSessionId(selectedSession.id)}
            >
              {materialsLocked ? <Plus size={17} /> : <FileUp size={17} />}
              {materialsLocked ? "用新材料新建" : "编辑材料"}
            </button>
          </section>

          {isEditingMaterials && selectedSession ? (
            <section className="material-editor" aria-label="面试材料编辑">
              <div className="material-editor-heading">
                <div><p className="eyebrow">会话专属材料</p><h2>确认后固定 JD 与简历</h2></div>
                <span><LockKeyhole size={14} /> 仅用于当前会话</span>
              </div>
              <div className="material-editor-grid">
                <label>
                  <span>目标岗位 JD</span>
                  <input value={selectedSession.jobDescription.title} onChange={(event) => updateMaterial("jobDescription", { title: event.target.value })} />
                  <textarea value={selectedSession.jobDescription.content} onChange={(event) => updateMaterial("jobDescription", { content: event.target.value })} />
                  <em>导入文本文件<input type="file" accept=".txt,.md,.json,text/plain" onChange={(event) => void importMaterial("jobDescription", event.target.files?.[0])} /></em>
                </label>
                <label>
                  <span>个人简历</span>
                  <input value={selectedSession.resume.title} onChange={(event) => updateMaterial("resume", { title: event.target.value })} />
                  <textarea value={selectedSession.resume.content} onChange={(event) => updateMaterial("resume", { content: event.target.value })} />
                  <em>导入文本文件<input type="file" accept=".txt,.md,.json,text/plain" onChange={(event) => void importMaterial("resume", event.target.files?.[0])} /></em>
                </label>
              </div>
              <div className="material-editor-actions">
                <span>确认后不可替换；需要更换时请创建新会话。</span>
                <button type="button" disabled={!selectedSession.jobDescription.content.trim() || !selectedSession.resume.content.trim()} onClick={confirmMaterials}><Save size={15} /> 确认并固定材料</button>
              </div>
            </section>
          ) : null}

          <section className="mock-panel">
            <div className="mock-topline">
              <div>
                <p className="eyebrow">模拟问题 {activeQuestion + 1} / {questions.length}</p>
                <span>{question.tag} · {question.time}</span>
              </div>
              <button className="text-button" type="button"><Plus size={15} /> 换一组问题</button>
            </div>
            <h2>{question.text}</h2>
            <textarea
              value={answer}
              disabled={!selectedSession}
              onChange={(event) => updateAnswer(event.target.value)}
              placeholder={selectedSession ? "用 STAR 或结论先行的方式开始回答……" : "新建面试会话后开始回答……"}
            />
            <div className="mock-actions">
              <button className="record-answer" type="button" disabled={!selectedSession}><Play size={16} fill="currentColor" /> 语音作答</button>
              <span>{answer.length ? `${answer.length} 字` : "也可以直接输入文字"}</span>
              <button className="next-question" type="button" disabled={!selectedSession} onClick={() => selectQuestion((activeQuestion + 1) % questions.length)}>下一题 <ChevronRight size={16} /></button>
            </div>
          </section>

          <section className="question-outline">
            <div className="section-heading compact">
              <div><p className="eyebrow">本轮问题</p><h2>岗位针对性模拟</h2></div>
              <span>当前表达得分 {score}</span>
            </div>
            <div className="question-list">
              {questions.map((question, index) => (
                <button className={activeQuestion === index ? "question-row active" : "question-row"} type="button" key={question.id} onClick={() => selectQuestion(index)}>
                  <span className="question-index">{index < activeQuestion ? <Check size={14} /> : `0${index + 1}`}</span>
                  <span><strong>{question.tag}</strong><small>{question.text}</small></span>
                  <MessageCircleQuestion size={17} />
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
