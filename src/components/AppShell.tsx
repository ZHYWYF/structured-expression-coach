import {
  AudioLines,
  CalendarRange,
  House,
  MessageSquareText,
  Settings2,
  UserRoundSearch,
} from "lucide-react";
import type { ReactNode } from "react";
import type { NavigationItem, SectionId } from "./types";
import { BrandMark } from "./BrandMark";

const navigation: NavigationItem[] = [
  { id: "home", label: "首页", shortLabel: "首页", icon: House },
  { id: "workspace", label: "表达工作台", shortLabel: "表达", icon: MessageSquareText },
  { id: "interview", label: "面试专区", shortLabel: "面试", icon: UserRoundSearch },
  { id: "training", label: "训练计划", shortLabel: "训练", icon: CalendarRange },
  { id: "reports", label: "录音与报告", shortLabel: "报告", icon: AudioLines },
  { id: "settings", label: "设置", shortLabel: "设置", icon: Settings2 },
];

export function AppShell({
  active,
  onNavigate,
  saveState,
  completedTrainingCount,
  children,
}: {
  active: SectionId;
  onNavigate: (section: SectionId) => void;
  saveState: string;
  completedTrainingCount: number;
  children: ReactNode;
}) {
  const activeItem = navigation.find((item) => item.id === active)!;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" type="button" onClick={() => onNavigate("home")}>
          <BrandMark className="brand-mark" />
          <span>
            <strong>言序</strong>
            <small>你的专业编辑室</small>
          </span>
        </button>

        <nav className="primary-navigation" aria-label="一级导航">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={active === id ? "nav-item active" : "nav-item"}
              type="button"
              key={id}
              aria-current={active === id ? "page" : undefined}
              onClick={() => onNavigate(id)}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="streak-number">{completedTrainingCount}</div>
          <div>
            <strong>已完成训练</strong>
            <span>{saveState}</span>
          </div>
        </div>
      </aside>

      <div className="mobile-topbar">
        <button className="mobile-brand" type="button" onClick={() => onNavigate("home")}>
          <BrandMark /> 言序
        </button>
        <span>{activeItem.label}</span>
      </div>

      <main className="main-content">{children}</main>

      <nav className="mobile-navigation" aria-label="移动端一级导航">
        {navigation.map(({ id, shortLabel, icon: Icon }) => (
          <button
            className={active === id ? "mobile-nav-item active" : "mobile-nav-item"}
            type="button"
            key={id}
            aria-current={active === id ? "page" : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon size={19} strokeWidth={1.8} />
            <span>{shortLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
