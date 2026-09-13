import { useAppDialog } from "./useAppDialog";
import { Check, ChevronDown, ChevronUp, Circle, Edit3, Flame, Pause, Play, Plus, Save, Target, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { TrainingPlan as TrainingPlanModel, TrainingTask, TrainingPlanStatus } from "../core/types";
import type { WorkspaceController } from "../core/useWorkspace";
import { PageHeader, PrimaryButton } from "./ui";
import { reportHasUsableScore } from "../core/reportScore";

const goalSuggestions = ["结论先行", "减少口头禅", "增强数据证据", "提升 STAR 完整度", "表达更简洁", "增强自信感"];
const taskSuggestions = [
  { title: "三分钟结论先行", description: "围绕一个真实事项，先说结论，再补充三条依据。", targetMinutes: 10 },
  { title: "STAR 经历复述", description: "选择一段经历，明确情境、任务、行动和结果。", targetMinutes: 15 },
  { title: "模糊词替换", description: "找出近期表达中的模糊词，并改为事实、数字或具体动作。", targetMinutes: 10 },
];

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function addDays(date: Date, days: number): string {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function blankPlan(scenarioId: string): TrainingPlanModel {
  const now = new Date();
  const iso = now.toISOString();
  return {
    id: newId("plan"), title: "", description: "", scenarioId, goals: [], currentLevel: "intermediate", levelSource: "self-assessment", status: "draft",
    startDate: iso.slice(0, 10), endDate: addDays(now, 13), focusAreas: [], tasks: [], linkedSessionIds: [], createdAt: iso, updatedAt: iso,
  };
}

const statusLabels: Record<TrainingPlanStatus, string> = { draft: "草稿", active: "进行中", paused: "已暂停", completed: "已完成", archived: "已归档" };

export function TrainingPlan({ controller }: { controller: WorkspaceController }) {
  const appDialog = useAppDialog();
  const [editing, setEditing] = useState<TrainingPlanModel | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState(controller.trainingPlans[0]?.id ?? null);
  const plan = controller.trainingPlans.find((item) => item.id === selectedPlanId) ?? controller.trainingPlans[0] ?? null;
  const tasks = plan?.tasks ?? [];
  const completed = tasks.filter((task) => task.status === "done").length;
  const reports = controller.sessions.filter((session) => session.scenarioId === (editing?.scenarioId ?? plan?.scenarioId) && (!plan?.linkedSessionIds || plan.linkedSessionIds.includes(session.id))).flatMap((session) => session.report ? [session.report] : []);
  const baselineReports = controller.sessions.filter((session) => session.scenarioId === editing?.scenarioId && session.report && reportHasUsableScore(session.report)).map((session) => session.report!).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  const baselineScore = baselineReports[0]?.overallScore;
  const [planError, setPlanError] = useState("");
  const invalidPlan = editing && (!editing.startDate || !editing.endDate || editing.endDate < editing.startDate || editing.tasks.some((task) => !task.title.trim() || !Number.isFinite(task.targetMinutes) || task.targetMinutes < 1 || task.targetMinutes > 1440));
  const scoredReports = reports.filter(reportHasUsableScore);
  const averageScore = scoredReports.length ? Math.round(scoredReports.reduce((sum, report) => sum + report.overallScore, 0) / scoredReports.length) : undefined;

  const activeConflict = useMemo(() => editing && editing.status === "active"
    ? controller.trainingPlans.find((item) => item.id !== editing.id && item.status === "active" && item.scenarioId === editing.scenarioId)
    : undefined, [controller.trainingPlans, editing]);

  const startNew = () => setEditing(blankPlan(controller.scenarios.find((item) => item.category === "work-report")?.id ?? controller.scenarios[0]?.id ?? "scenario-free-practice"));
  const savePlan = () => {
    if (!editing?.title.trim() || !editing.goals.length || !editing.tasks.length || activeConflict || invalidPlan) return;
    controller.upsertTrainingPlan({ ...editing, title: editing.title.trim(), updatedAt: new Date().toISOString() });
    setSelectedPlanId(editing.id);
    setEditing(null);
  };
  const patchTask = (taskId: string, patch: Partial<TrainingTask>) => setEditing((current) => current ? ({ ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task) }) : current);
  const moveTask = (index: number, direction: -1 | 1) => setEditing((current) => {
    if (!current) return current;
    const target = index + direction;
    if (target < 0 || target >= current.tasks.length) return current;
    const tasksCopy = [...current.tasks];
    [tasksCopy[index], tasksCopy[target]] = [tasksCopy[target], tasksCopy[index]];
    return { ...current, tasks: tasksCopy };
  });
  const launchTask = (task: TrainingTask) => {
    if (!plan || ["completed", "archived"].includes(plan.status)) return;
    let session = controller.sessions.find((item) => item.id === task.sessionId);
    if (!session) session = controller.createSession({ kind: controller.scenarios.find((item) => item.id === plan.scenarioId)?.category === "interview" ? "interview" : "practice", scenarioId: plan.scenarioId, title: task.title });
    controller.upsertTrainingPlan({ ...plan, linkedSessionIds: [...new Set([...(plan.linkedSessionIds ?? []), session.id])], tasks: plan.tasks.map((item) => item.id === task.id ? { ...item, sessionId: session!.id, status: "in-progress" } : item), updatedAt: new Date().toISOString() });
    controller.selectSession(session.id);
    controller.navigate(session.kind === "interview" ? "interviews" : "workspace");
  };

  if (editing) {
    return (
      <div className="page training-page">
      {appDialog.dialog}
        <PageHeader eyebrow="训练计划设置" title={controller.trainingPlans.some((item) => item.id === editing.id) ? "编辑训练计划" : "创建训练计划"} description="通用选项可以直接选择，所有字段也支持自行填写和调整。" />
        <section className="plan-editor">
          <div className="form-section"><div className="form-section-title"><span>01</span><div><h2>训练目标</h2><p>可多选推荐目标，也可添加自己的目标。</p></div></div>
            <label className="form-field"><span>计划名称</span><input value={editing.title} placeholder="例如：两周面试表达强化" onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
            <div className="chip-picker">{goalSuggestions.map((goal) => <button type="button" className={editing.goals.includes(goal) ? "chip selected" : "chip"} key={goal} onClick={() => setEditing({ ...editing, goals: editing.goals.includes(goal) ? editing.goals.filter((item) => item !== goal) : [...editing.goals, goal], focusAreas: editing.goals.includes(goal) ? editing.focusAreas.filter((item) => item !== goal) : [...editing.focusAreas, goal] })}>{goal}</button>)}</div>
            <label className="form-field"><span>自定义目标（回车添加）</span><input placeholder="输入你的训练目标" onKeyDown={(event) => { if (event.key === "Enter" && event.currentTarget.value.trim()) { event.preventDefault(); const goal = event.currentTarget.value.trim(); setEditing({ ...editing, goals: [...new Set([...editing.goals, goal])], focusAreas: [...new Set([...editing.focusAreas, goal])] }); event.currentTarget.value = ""; } }} /></label>
            <div className="selected-items">{editing.goals.map((goal) => <span key={goal}>{goal}<button type="button" onClick={() => setEditing({ ...editing, goals: editing.goals.filter((item) => item !== goal), focusAreas: editing.focusAreas.filter((item) => item !== goal) })}><X size={12} /></button></span>)}</div>
          </div>
          <div className="form-section"><div className="form-section-title"><span>02</span><div><h2>当前水平与场景</h2><p>支持自评；后续完成基线练习后可以修正。</p></div></div>
            <div className="settings-form-grid"><label><span>训练场景</span><select value={editing.scenarioId} onChange={(event) => setEditing({ ...editing, scenarioId: event.target.value })}>{controller.scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title}</option>)}</select></label><label><span>当前水平</span><select value={editing.currentLevel} onChange={(event) => setEditing({ ...editing, currentLevel: event.target.value as TrainingPlanModel["currentLevel"] })}><option value="beginner">入门：经常说不清重点</option><option value="intermediate">进阶：基本清楚但不稳定</option><option value="advanced">强化：追求说服力和精度</option></select></label></div>
            <label className="form-field"><span>自评补充（可自行填写）</span><textarea value={editing.levelNotes ?? ""} onChange={(event) => setEditing({ ...editing, levelNotes: event.target.value })} placeholder="描述当前表达困难，或修正平台评估" /></label><div className="quick-actions"><button type="button" className={editing.levelSource === "self-assessment" ? "selected" : ""} onClick={() => setEditing({ ...editing, levelSource: "self-assessment" })}>使用自评</button><button type="button" className={editing.levelSource === "baseline" ? "selected" : ""} disabled={baselineScore === undefined} onClick={() => { const level = (baselineScore ?? 0) >= 85 ? "advanced" : (baselineScore ?? 0) >= 70 ? "intermediate" : "beginner"; setEditing({ ...editing, levelSource: "baseline", currentLevel: level }); }}>使用最近报告评估{baselineScore !== undefined ? `（${baselineScore} 分）` : "（暂无可评分的同场景报告）"}</button></div>
          </div>
          <div className="form-section"><div className="form-section-title"><span>03</span><div><h2>计划周期</h2><p>选择日期或使用快捷周期。</p></div></div>
            <div className="quick-actions">{[7, 14, 30].map((days) => <button type="button" key={days} onClick={() => setEditing({ ...editing, startDate: new Date().toISOString().slice(0, 10), endDate: addDays(new Date(), days - 1) })}>{days} 天</button>)}</div>
            <div className="settings-form-grid"><label><span>开始日期</span><input type="date" value={editing.startDate} onChange={(event) => setEditing({ ...editing, startDate: event.target.value })} /></label><label><span>结束日期</span><input type="date" value={editing.endDate} onChange={(event) => setEditing({ ...editing, endDate: event.target.value })} /></label></div>
          </div>
          <div className="form-section"><div className="form-section-title"><span>04</span><div><h2>训练任务</h2><p>可加入推荐任务，也可编辑、删除和排序。</p></div></div>
            <div className="quick-actions">{taskSuggestions.map((item) => <button type="button" key={item.title} onClick={() => setEditing({ ...editing, tasks: [...editing.tasks, { ...item, id: newId("task"), status: "todo" }] })}><Plus size={13} /> {item.title}</button>)}<button type="button" onClick={() => setEditing({ ...editing, tasks: [...editing.tasks, { id: newId("task"), title: "", description: "", targetMinutes: 10, status: "todo" }] })}><Plus size={13} /> 自定义任务</button></div>
            <div className="editable-task-list">{editing.tasks.map((task, index) => <div className="editable-task" key={task.id}><input value={task.title} placeholder="任务名称" onChange={(event) => patchTask(task.id, { title: event.target.value })} /><input value={task.description} placeholder="任务说明" onChange={(event) => patchTask(task.id, { description: event.target.value })} /><input type="number" min={1} value={task.targetMinutes} onChange={(event) => patchTask(task.id, { targetMinutes: Number(event.target.value) || 1 })} /><div><button type="button" disabled={index === 0} onClick={() => moveTask(index, -1)}><ChevronUp size={14} /></button><button type="button" disabled={index === editing.tasks.length - 1} onClick={() => moveTask(index, 1)}><ChevronDown size={14} /></button><button type="button" onClick={() => setEditing({ ...editing, tasks: editing.tasks.filter((item) => item.id !== task.id) })}><Trash2 size={14} /></button></div></div>)}</div>
          </div>
          <div className="form-section"><div className="form-section-title"><span>05</span><div><h2>计划状态</h2><p>草稿可继续编辑，进行中计划会出现在首页。</p></div></div><div className="chip-picker">{(["draft", "active", "paused", "completed", "archived"] as const).map((status) => <button type="button" className={editing.status === status ? "chip selected" : "chip"} key={status} onClick={() => setEditing({ ...editing, status })}>{statusLabels[status]}</button>)}</div>{activeConflict ? <p className="form-error">“{activeConflict.title}”已是该场景的进行中计划，请先暂停或完成它。</p> : null}</div>
          {invalidPlan ? <p className="form-error">请检查起止日期、任务名称和时长（1–1440 分钟）。</p> : null}<div className="plan-editor-actions"><button className="button-secondary" type="button" onClick={() => setEditing(null)}>取消</button><PrimaryButton onClick={savePlan} disabled={!editing.title.trim() || !editing.goals.length || !editing.tasks.length || Boolean(activeConflict) || Boolean(invalidPlan)}><Save size={15} /> 保存计划</PrimaryButton></div>
        </section>
      </div>
    );
  }

  return (
    <div className="page training-page">
      {appDialog.dialog}
      <PageHeader eyebrow="训练计划" title="少量、持续、针对性地练" description="从目标、水平和周期开始建立自己的训练安排。" action={<PrimaryButton onClick={startNew}><Plus size={15} /> 新建计划</PrimaryButton>} />
      {planError ? <p className="action-notice" role="status">{planError}</p> : null}{controller.trainingPlans.length ? <div className="plan-tabs">{controller.trainingPlans.map((item) => <button type="button" className={plan?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelectedPlanId(item.id)}>{item.title}<small>{statusLabels[item.status]}</small></button>)}</div> : null}
      {plan ? <><section className="training-overview"><div className="plan-summary"><p className="eyebrow">{statusLabels[plan.status]}</p><h2>{plan.title}</h2><p>{plan.description || plan.goals.join(" · ")}</p><div className="plan-progress"><span style={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%` }} /></div><small>已完成 {completed}/{tasks.length} 项</small><div className="plan-summary-actions"><button type="button" disabled={["completed", "archived"].includes(plan.status)} onClick={() => setEditing(structuredClone(plan))}><Edit3 size={14} /> 编辑</button>{plan.status === "completed" || plan.status === "archived" ? <button type="button" onClick={() => setEditing({ ...structuredClone(plan), id: newId("plan"), title: `${plan.title}（新）`, status: "draft", linkedSessionIds: [], tasks: plan.tasks.map((task) => ({ ...task, id: newId("task"), status: "todo", completedAt: undefined, sessionId: undefined })), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })}><Plus size={14} /> 复制为新计划</button> : <button type="button" onClick={() => { const conflict = controller.trainingPlans.find((item) => item.id !== plan.id && item.scenarioId === plan.scenarioId && item.status === "active"); if (plan.status !== "active" && conflict) { setPlanError(`请先暂停或完成“${conflict.title}”。`); return; } setPlanError(""); controller.upsertTrainingPlan({ ...plan, status: plan.status === "active" ? "paused" : "active", updatedAt: new Date().toISOString() }); }}>{plan.status === "active" ? <Pause size={14} /> : <Play size={14} />}{plan.status === "active" ? "暂停" : plan.status === "paused" ? "继续" : "开始"}</button>}<button type="button" onClick={async () => { if (await appDialog.confirm(`删除训练计划“${plan.title}”？此操作无法撤销。`, { destructive: true })) controller.deleteTrainingPlan(plan.id); }}><Trash2 size={14} /> 删除</button></div></div><div className="plan-metrics"><div><span><Flame size={18} /></span><strong>{completed} 项</strong><small>本计划已完成</small></div><div><span><Target size={18} /></span><strong>{averageScore ?? "--"}</strong><small>关联练习平均分</small></div></div></section><section className="task-section"><div className="section-heading compact"><div><p className="eyebrow">训练安排</p><h2>计划任务</h2></div><span>共 {tasks.reduce((sum, task) => sum + task.targetMinutes, 0)} 分钟</span></div><div className="task-list">{tasks.map((task) => { const done = task.status === "done"; return <div key={task.id}><button disabled={["completed", "archived"].includes(plan.status)} className={done ? "task-row done" : "task-row"} type="button" key={task.id} onClick={() => controller.updateTrainingTask(plan.id, task.id, done ? "todo" : "done")}><span className="task-check">{done ? <Check size={15} /> : <Circle size={17} />}</span><span className="task-day">{task.targetMinutes} 分钟</span><span className="task-copy"><strong>{task.title}</strong><small>{task.description}</small></span></button><button className="button-secondary" type="button" disabled={["completed", "archived"].includes(plan.status)} onClick={() => launchTask(task)}>{task.sessionId ? "继续关联练习" : "开始任务练习"}</button></div>; })}</div></section><section className="task-section"><h2>关联练习与阶段变化</h2>{reports.length ? reports.map((report) => <article key={report.id}><strong>{report.title} · {reportHasUsableScore(report) ? `${report.overallScore} 分` : "暂不评分"}</strong><p>{report.improvements.join("；")}</p><button type="button" onClick={() => { const session = controller.sessions.find((item) => item.id === report.sessionId); if (session) { controller.selectSession(session.id); controller.navigate(session.kind === "interview" ? "interviews" : session.kind === "recording-review" ? "reports" : "workspace"); } }}>回看来源练习</button></article>) : <p>开始任务练习后，会话会关联到本计划；完成练习后在这里回看变化。</p>}</section></> : <section className="empty-state"><Target size={30} /><h2>还没有训练计划</h2><p>设置目标、当前水平、周期和任务后，首页会展示真实训练进度。</p><PrimaryButton onClick={startNew}><Plus size={15} /> 创建第一个计划</PrimaryButton></section>}
    </div>
  );
}
