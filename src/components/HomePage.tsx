import { ArrowRight, BriefcaseBusiness, Clock3, FolderKanban, Mic2, UserRoundSearch } from "lucide-react";
import type { WorkspaceController } from "../core/useWorkspace";
import type { SectionId } from "./types";
import { ArrowLink } from "./ui";
import { BrandMark } from "./BrandMark";

function formatToday(): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "long",
  }).formatToParts(new Date());
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  return `${month} 月 ${day} 日 · ${weekday}`;
}

export function HomePage({ controller, onNavigate }: { controller: WorkspaceController; onNavigate: (section: SectionId) => void }) {
  const plan = controller.trainingPlans.find((item) => item.status === "active");
  const completedTasks = plan?.tasks.filter((task) => task.status === "done").length ?? 0;
  const taskTotal = plan?.tasks.length ?? 0;
  const recentSession = [...controller.sessions]
    .filter((session) => session.kind === "practice" && session.status !== "archived")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  const continueRecent = () => {
    if (recentSession) controller.selectSession(recentSession.id);
    onNavigate("workspace");
  };

  const startPractice = (category: "work-report" | "meeting", title: string) => {
    controller.createSession({
      kind: "practice",
      title,
      scenarioId: controller.scenarios.find((scenario) => scenario.category === category)?.id,
    });
  };

  return (
    <div className="page home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow">{formatToday()}</p>
          <p className="hero-product">言序<span>专业编辑室</span></p>
          <h1 aria-label="言序｜让每一句，都更有分量">让每一句，<br />都更有<span className="hero-emphasis">分量</span>。</h1>
          <p>从你的原话出发。看见问题，打磨表达，让想法被清楚地听见。</p>
        </div>
        <div className="hero-imprint" aria-hidden="true"><BrandMark /><span>斟词 · 酌句</span></div>
      </section>

      <section className="daily-progress" aria-label="当前计划进度">
        {plan ? <>
          <span>当前计划</span>
          <strong>{completedTasks}<small>/{taskTotal}</small></strong>
          <div className="progress-track"><i style={{ width: `${taskTotal ? (completedTasks / taskTotal) * 100 : 0}%` }} /></div>
          <em>{completedTasks === taskTotal && taskTotal ? "计划任务已完成" : `还有 ${Math.max(0, taskTotal - completedTasks)} 项训练待完成`}</em>
          <button type="button" onClick={() => onNavigate("training")}>继续训练：{plan.title}<ArrowRight size={15} /></button>
        </> : <>
          <span>循序练习</span>
          <p>还没有进行中的训练计划。从一个小目标开始。</p>
          <button type="button" onClick={() => onNavigate("training")}>制定训练计划<ArrowRight size={15} /></button>
        </>}
      </section>

      <section className="scenario-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">开始表达</p>
            <h2>今天想梳理什么？</h2>
          </div>
          <span>无需准备，先写下第一句话</span>
        </div>

        <div className="scenario-list">
          <button className="scenario-row" type="button" onClick={() => startPractice("work-report", "新的工作汇报")}>
            <span className="scenario-icon coral"><BriefcaseBusiness size={22} /></span>
            <span className="scenario-copy">
              <strong>工作汇报</strong>
              <small>将进展、结果和下一步说得有重点</small>
            </span>
            <span className="scenario-meta">约 8 分钟</span>
            <ArrowRight size={18} />
          </button>

          <button className="scenario-row" type="button" onClick={() => startPractice("meeting", "新的项目复盘")}>
            <span className="scenario-icon blue"><FolderKanban size={22} /></span>
            <span className="scenario-copy">
              <strong>项目复盘</strong>
              <small>提炼事实、判断和可复用的经验</small>
            </span>
            <span className="scenario-meta">约 12 分钟</span>
            <ArrowRight size={18} />
          </button>

          <button className="scenario-row interview-entry" type="button" onClick={() => onNavigate("interview")}>
            <span className="scenario-icon ink"><UserRoundSearch size={22} /></span>
            <span className="scenario-copy">
              <strong>进入面试专区</strong>
              <small>带上 JD 与简历，进行针对性模拟</small>
            </span>
            <span className="scenario-meta">独立空间</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      <section className="home-lower-grid">
        <div className="recent-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">最近继续</p>
              <h2>你的表达现场</h2>
            </div>
            <ArrowLink onClick={() => onNavigate("workspace")}>查看全部</ArrowLink>
          </div>
          <button className="recent-session" type="button" onClick={continueRecent}>
            <span className="recent-date"><Clock3 size={16} /> {recentSession ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(recentSession.updatedAt)) : "暂无记录"}</span>
            <strong>{recentSession?.title ?? "创建第一段表达"}</strong>
            <p>{recentSession?.draftText || "从工作汇报或项目复盘开始一次练习。"}</p>
            <span className="session-score">清晰度 {recentSession?.report?.overallScore ?? "--"}</span>
          </button>
        </div>

        <div className="voice-panel">
          <span className="voice-icon"><Mic2 size={20} /></span>
          <div>
            <p className="eyebrow">快速记录</p>
            <h2>回听真实录音</h2>
            <p>上传已有录音，转写校对并生成场景报告。</p>
          </div>
          <button type="button" onClick={() => onNavigate("reports")}>上传录音</button>
        </div>
      </section>
    </div>
  );
}
