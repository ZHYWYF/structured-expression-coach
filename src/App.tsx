import { useEffect } from "react";
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
  const controller = useWorkspace();
  const activeSection = pageToSection[controller.currentPage];
  const navigate = (section: SectionId) => controller.navigate(sectionToPage[section]);

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
      case "reports": return <ReportsPage controller={controller} />;
      case "settings": return <SettingsPage controller={controller} />;
      default: return <HomePage controller={controller} onNavigate={navigate} />;
    }
  };

  return (
    <AppShell
      active={activeSection}
      onNavigate={navigate}
      saveState={controller.persistenceError ? "保存异常" : controller.isSaving ? "正在保存" : controller.isHydrated ? "已保存到本地" : "正在载入"}
    >
      {renderSection()}
    </AppShell>
  );
}
