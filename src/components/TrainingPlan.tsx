import { Check, ChevronRight, Circle, Flame, Target } from "lucide-react";
import type { WorkspaceController } from "../core/useWorkspace";
import { PageHeader } from "./ui";

function taskDayLabel(dueDate?: string): string {
  if (!dueDate) return "待安排";
  const date = new Date(`${dueDate}T00:00:00`);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今天";
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
}

export function TrainingPlan({ controller }: { controller: WorkspaceController }) {
  const plan = controller.trainingPlans[0];
  const tasks = plan?.tasks ?? [];
  const completed = tasks.filter((task) => task.status === "done").length;
  const reports = controller.sessions.flatMap((session) => session.report ? [session.report] : []);
  const averageScore = reports.length
    ? Math.round(reports.reduce((sum, report) => sum + report.overallScore, 0) / reports.length)
    : 0;

  return (
    <div className="page training-page">
      <PageHeader eyebrow="训练计划" title="少量、持续、针对性地练" description="计划会根据近期表达中的高频问题动态调整。" />
      <section className="training-overview">
        <div className="plan-summary">
          <p className="eyebrow">本周重点</p>
          <h2>{plan?.title ?? "还没有训练计划"}</h2>
          <p>{plan?.description ?? "创建计划后，训练任务会集中显示在这里。"}</p>
          <div className="plan-progress"><span style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%` }} /></div>
          <small>已完成 {completed}/{tasks.length} 项</small>
        </div>
        <div className="plan-metrics">
          <div><span><Flame size={18} /></span><strong>{completed} 项</strong><small>本计划已完成</small></div>
          <div><span><Target size={18} /></span><strong>{averageScore || "--"}</strong><small>平均清晰度</small></div>
        </div>
      </section>
      <section className="task-section">
        <div className="section-heading compact"><div><p className="eyebrow">训练安排</p><h2>本周任务</h2></div><span>{tasks.length ? `共 ${tasks.reduce((sum, task) => sum + task.targetMinutes, 0)} 分钟` : "等待安排"}</span></div>
        <div className="task-list">
          {tasks.map((task) => {
            const done = task.status === "done";
            return (
              <button
                className={done ? "task-row done" : "task-row"}
                type="button"
                key={task.id}
                onClick={() => plan && controller.updateTrainingTask(plan.id, task.id, done ? "todo" : "done")}
              >
                <span className="task-check">{done ? <Check size={15} /> : <Circle size={17} />}</span>
                <span className="task-day">{taskDayLabel(task.dueDate)}</span>
                <span className="task-copy"><strong>{task.title}</strong><small>{task.description}</small></span>
                <ChevronRight size={18} />
              </button>
            );
          })}
          {!tasks.length ? <p className="empty-list-copy">暂无训练任务</p> : null}
        </div>
      </section>
    </div>
  );
}
