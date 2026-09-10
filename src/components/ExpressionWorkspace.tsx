import { CornerDownLeft, FileText, MoreHorizontal, Sparkles } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import type { Session } from "../core/types";
import { analyzeText } from "../knowledge";
import type { AnalysisFinding, KnowledgeScenario } from "../knowledge";
import { NewSessionButton, PageHeader } from "./ui";

type AnalysisMode = "汇报" | "复盘";
type FindingTone = "filler" | "vague" | "structure";

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
  if (!findings.length) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const finding of findings) {
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
  const sessions = controller.sessions.filter((session) => session.kind !== "interview");
  const selectedSession = controller.selectedSession?.kind !== "interview"
    ? controller.selectedSession
    : sessions[0] ?? null;
  const selectedScenario = controller.scenarios.find((item) => item.id === selectedSession?.scenarioId);
  const mode: AnalysisMode = selectedScenario?.category === "meeting" ? "复盘" : "汇报";
  const text = selectedSession?.draftText ?? "";
  const scenario: KnowledgeScenario = mode === "复盘" ? "retrospective" : "report";
  const findings = useMemo(() => analyzeText(text, scenario), [scenario, text]);

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
    controller.updateSession(selectedSession.id, (session) => ({ ...session, status: "completed" }));
    setSavedText(text);
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
            <button className="icon-button" type="button" aria-label="更多选项"><MoreHorizontal size={19} /></button>
          </div>
          <textarea
            className="expression-input"
            value={text}
            disabled={!selectedSession}
            onChange={(event) => selectedSession && controller.updateSessionText(event.target.value, selectedSession.id)}
            placeholder={selectedSession ? "先写下你最想让对方记住的结论……" : "新建一个会话后开始表达……"}
          />
          <div className="editor-footer">
            <span>{text.length} 字 · {findings.length} 处可改善</span>
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
            {findings.slice(0, 5).map((finding) => {
              const tone = findingTone(finding);
              return (
                <div className="annotation-item" key={`${finding.ruleId}-${finding.range.start}`}>
                  <span className={`annotation-key ${tone}`}>{finding.matchedText}</span>
                  <div><strong>{finding.issueType}</strong><p>{finding.suggestion}</p></div>
                </div>
              );
            })}
            {!findings.length ? (
              <div className="empty-analysis"><FileText size={20} /><span>{text ? "当前规则未发现明显问题" : "等待输入表达内容"}</span></div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
