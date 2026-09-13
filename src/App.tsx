import { useAppDialog } from "./components/useAppDialog";
import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { ExpressionWorkspace } from "./components/ExpressionWorkspace";
import { HomePage } from "./components/HomePage";
import { InterviewStudio } from "./components/InterviewStudio";
import { ReportsPage } from "./components/ReportsPage";
import { SettingsPage } from "./components/SettingsPage";
import { TrainingPlan } from "./components/TrainingPlan";
import type { SectionId } from "./components/types";
import { useWorkspace } from "./core/useWorkspace";
import type { WorkspacePage } from "./core/types";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrandMark } from "./components/BrandMark";

const sectionToPage: Record<SectionId, WorkspacePage> = {
  home: "home",
  workspace: "workspace",
  interview: "interviews",
  training: "training",
  reports: "reports",
  settings: "settings",
};

const pageToSection: Record<WorkspacePage, SectionId> = {
  home: "home",
  workspace: "workspace",
  interviews: "interview",
  training: "training",
  recordings: "reports",
  reports: "reports",
  settings: "settings",
};

export default function App() {
  const appDialog = useAppDialog();
  const controller = useWorkspace();
  const activeSection = pageToSection[controller.currentPage];
  const navigate = (section: SectionId) => controller.navigate(sectionToPage[section]);
  const [reportsOpened, setReportsOpened] = useState(false);
  useEffect(() => { if (activeSection === "reports") setReportsOpened(true); }, [activeSection]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let closing = false;
    void getCurrentWindow().onCloseRequested(async (event) => {
      if (closing) return;
      event.preventDefault();
      try { await controller.flush(); closing = true; await getCurrentWindow().destroy(); }
      catch { void appDialog.notice("本地保存失败，已保留窗口。请重试保存后再退出。"); }
    }).then((off) => { if (disposed) off(); else unlisten = off; });
    return () => { disposed = true; unlisten?.(); };
  }, [controller.flush]);

  useEffect(() => {
    const root = document.documentElement;
    if (controller.preferences.theme === "system") {
      root.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } else {
      root.dataset.theme = controller.preferences.theme;
    }
  }, [controller.preferences.theme]);

  if (!controller.isHydrated) {
    return (
      <div className="boot-screen" role="status" aria-live="polite">
        <BrandMark className="boot-symbol" />
        <span className="boot-mark">言序</span>
        <p>正在载入本地工作区…</p>
      </div>
    );
  }

  const renderSection = () => {
    switch (activeSection) {
      case "workspace": return <ExpressionWorkspace controller={controller} />;
      case "interview": return <InterviewStudio controller={controller} />;
      case "training": return <TrainingPlan controller={controller} />;
      case "reports": return null;
      case "settings": return <SettingsPage controller={controller} />;
      default: return <HomePage controller={controller} onNavigate={navigate} />;
    }
  };

  return (
    <AppShell
      active={activeSection}
      onNavigate={navigate}
      saveState={controller.persistenceError ? "保存异常" : controller.isSaving ? "正在保存" : controller.hasUnsavedChanges ? "有未保存更改" : "已保存到本地"}
      completedTrainingCount={controller.trainingPlans.flatMap((plan) => plan.tasks).filter((task) => task.status === "done").length}
    >
      {appDialog.dialog}
      <div className="workspace-save-status" role="status" aria-live="polite">
        <span title={controller.persistenceError ?? undefined}>{controller.persistenceError ?? (controller.isSaving ? "正在保存到本地…" : controller.hasUnsavedChanges ? controller.preferences.autoSave ? "等待自动保存" : "自动保存已关闭，有未保存更改" : "已保存到本地")}</span>
        {controller.hasUnsavedChanges && (!controller.preferences.autoSave || controller.persistenceError) ? <button type="button" disabled={controller.isSaving} onClick={() => void controller.flush().catch(() => undefined)}>{controller.persistenceError ? "重试保存" : "保存到本地"}</button> : null}
      </div>
      {renderSection()}
      {reportsOpened || activeSection === "reports" ? <div hidden={activeSection !== "reports"}><ReportsPage controller={controller} active={activeSection === "reports"} /></div> : null}
    </AppShell>
  );
}
