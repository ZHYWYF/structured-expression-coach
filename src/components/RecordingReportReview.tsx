import { BarChart3 } from "lucide-react";
import type { Report } from "../core/types";
import { readReportEvidence } from "../providers/recordingReport";
import { reportHasUsableScore } from "../core/reportScore";

export function RecordingReportReview({ report }: { report: Report }) {
  const insufficient = !reportHasUsableScore(report);
  return <div className="generated-report">
    <div className="report-score-large"><BarChart3 size={20} /><strong>{insufficient ? "—" : report.overallScore}</strong><span>{insufficient ? "暂不评分" : "训练参考分"}</span></div>
    <div className="report-review-body">
      <h3>{report.title}</h3>
      <p className="report-limit-note">仅依据逐字稿评价，不代表客观能力或心理状态。以下均为建议，尚未采纳，不会替换原文。</p>
      <section aria-label="值得保留的表达" className="report-review-section"><h4>值得保留的表达</h4>
        {report.strengths.length ? report.strengths.map((item, index) => {
          const evidence = readReportEvidence(item, "strength");
          return <div className="report-evidence-item" key={index}>{evidence && "strength" in evidence ? <><span className="report-field-label">原文</span><blockquote>{evidence.quote}</blockquote><p>{evidence.strength}</p></> : <p className="report-preserve-lines">{item}</p>}</div>;
        }) : <p>本次没有足够依据提炼亮点，不强行给出表扬。</p>}
      </section>
      <section aria-label="具体修改建议" className="report-review-section"><h4>具体修改建议 <small>尚未采纳</small></h4>
        {report.improvements.length ? report.improvements.map((item, index) => {
          const evidence = readReportEvidence(item, "improvement");
          return <div className="report-evidence-item" key={index}>{evidence && "suggestion" in evidence ? <><span className="report-field-label">原文</span><blockquote>{evidence.quote}</blockquote><dl className="report-revision"><dt>问题</dt><dd>{evidence.problem}</dd><dt>建议</dt><dd className="report-suggestion">{evidence.suggestion}</dd><dt>原因</dt><dd>{evidence.reason}</dd></dl></> : <p className="report-preserve-lines">{item}</p>}</div>;
        }) : <p>本次未发现有充分依据的改进项，不为凑数挑错。</p>}
      </section>
      <section aria-label="下一次练习" className="report-review-section report-next-practice"><h4>下一次练习</h4>{report.actionItems.map((item, index) => <p className="report-preserve-lines" key={index}>{item}</p>)}</section>
      <details className="report-dimensions"><summary>查看五项评价依据</summary>{report.dimensions.map((dimension) => <div key={dimension.key}><strong>{dimension.label} · {dimension.summary.trimStart().startsWith("信息不足：") ? "暂不评分" : `${dimension.score} 分`}</strong><p>{dimension.summary}</p></div>)}</details>
    </div>
  </div>;
}
