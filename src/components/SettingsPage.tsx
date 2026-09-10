import { ChevronRight, Database, HardDrive, Keyboard, Moon, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorkspaceController } from "../core/useWorkspace";
import type { WorkspacePreferences } from "../core/types";
import { PageHeader } from "./ui";

const themeLabels: Record<WorkspacePreferences["theme"], string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

const providerLabels: Record<WorkspacePreferences["transcriptionProvider"], string> = {
  demo: "演示转写",
  local: "本地转写（待安装）",
  online: "在线转写（待配置）",
};

export function SettingsPage({ controller }: { controller: WorkspaceController }) {
  const { preferences } = controller;
  const cycleTheme = () => {
    const next: WorkspacePreferences["theme"] = preferences.theme === "system" ? "light" : preferences.theme === "light" ? "dark" : "system";
    controller.updatePreferences({ theme: next });
  };
  const cycleProvider = () => {
    const next: WorkspacePreferences["transcriptionProvider"] = preferences.transcriptionProvider === "demo" ? "local" : preferences.transcriptionProvider === "local" ? "online" : "demo";
    controller.updatePreferences({ transcriptionProvider: next });
  };

  return (
    <div className="page settings-page">
      <PageHeader eyebrow="设置" title="让言序按你的方式工作" description="管理分析偏好、数据存储与应用体验。" />
      <div className="settings-layout">
        <section className="settings-group">
          <div className="settings-group-heading"><Sparkles size={18} /><div><h2>表达分析</h2><p>控制内容保存与语音处理方式</p></div></div>
          <SettingToggle icon={Sparkles} title="自动保存练习内容" description="输入后自动写入当前工作区" checked={preferences.autoSave} onChange={(autoSave) => controller.updatePreferences({ autoSave })} />
          <SettingRow icon={Volume2} title="语音转写引擎" value={providerLabels[preferences.transcriptionProvider]} onClick={cycleProvider} />
          <SettingRow icon={Keyboard} title="识别语言" value="普通话（简体中文）" />
        </section>
        <section className="settings-group">
          <div className="settings-group-heading"><ShieldCheck size={18} /><div><h2>数据与隐私</h2><p>表达内容优先保存在本地工作区</p></div></div>
          <SettingToggle
            icon={HardDrive}
            title="使用本地转写"
            description="音频无需发送到在线转写服务"
            checked={preferences.transcriptionProvider === "local"}
            onChange={(enabled) => controller.updatePreferences({ transcriptionProvider: enabled ? "local" : "demo" })}
          />
          <SettingRow icon={Database} title="本地工作区数据" value={`${controller.sessions.length} 个会话 · ${controller.recordingTasks.length} 段录音`} />
        </section>
        <section className="settings-group">
          <div className="settings-group-heading"><Moon size={18} /><div><h2>应用体验</h2><p>界面与显示偏好</p></div></div>
          <SettingRow icon={Moon} title="外观" value={themeLabels[preferences.theme]} onClick={cycleTheme} />
        </section>
      </div>
      <footer className="settings-footer"><strong>言序 0.1.0</strong><span>{controller.isSaving ? "正在保存本地数据" : controller.persistenceError ? "本地保存出现异常" : "本地工作区已就绪"}</span></footer>
    </div>
  );
}

function SettingToggle({ icon: Icon, title, description, checked, onChange }: { icon: LucideIcon; title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="setting-row">
      <span className="setting-icon"><Icon size={17} /></span>
      <div><strong>{title}</strong><small>{description}</small></div>
      <button className={checked ? "toggle active" : "toggle"} type="button" aria-pressed={checked} onClick={() => onChange(!checked)}><span /></button>
    </div>
  );
}

function SettingRow({ icon: Icon, title, value, onClick }: { icon: LucideIcon; title: string; value: string; onClick?: () => void }) {
  return (
    <button className="setting-row" type="button" onClick={onClick}>
      <span className="setting-icon"><Icon size={17} /></span><strong>{title}</strong><span className="setting-value">{value}</span>{onClick ? <ChevronRight size={16} /> : null}
    </button>
  );
}
