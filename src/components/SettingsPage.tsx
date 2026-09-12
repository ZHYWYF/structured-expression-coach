import { Cloud, Database, Download, HardDrive, KeyRound, Moon, Pause, RefreshCw, Save, Server, ShieldCheck, Trash2, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import type { ProviderConfiguration, WorkspacePreferences } from "../core/types";
import { readDeviceSecret, testProviderConnection, writeDeviceSecret, type SecretKind } from "../providers/openAiCompatible";
import { PageHeader } from "./ui";
import { deleteCachedModel, localModelCatalog, localTranscriptionRuntime } from "../transcription/localRuntime";
import { syncWorkspace, testSyncConnection } from "../sync/webdavSync";
import { createEmptyWorkspace } from "../core/defaultWorkspace";
import { deleteAudioFile } from "../transcription/audioStore";
import { knowledgeBaseStats } from "../knowledge";

const themeLabels: Record<WorkspacePreferences["theme"], string> = { system: "跟随系统", light: "浅色", dark: "深色" };
type ConnectionState = { status: "idle" | "testing" | "success" | "error"; message: string };

function ProviderForm({ title, description, kind, value, onChange }: { title: string; description: string; kind: Exclude<SecretKind, "sync">; value: ProviderConfiguration; onChange: (next: ProviderConfiguration) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [isSecretLoading, setIsSecretLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle", message: "尚未测试" });
  useEffect(() => {
    let cancelled = false;
    setIsSecretLoading(true);
    void readDeviceSecret(kind)
      .then((secret) => {
        if (!cancelled) setApiKey(secret);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : typeof error === "string" ? error : "读取凭证失败";
        setConnection({ status: "error", message });
      })
      .finally(() => {
        if (!cancelled) setIsSecretLoading(false);
      });
    return () => { cancelled = true; };
  }, [kind]);
  const save = async () => {
    await writeDeviceSecret(kind, apiKey);
    onChange(value);
    setConnection({ status: "idle", message: "配置已保存到当前设备" });
  };
  const test = async () => {
    setConnection({ status: "testing", message: "正在连接" });
    try {
      await writeDeviceSecret(kind, apiKey);
      const result = await testProviderConnection(value, apiKey, kind);
      setConnection(result.ok ? { status: "success", message: `连接成功 · ${result.latencyMs} ms` } : { status: "error", message: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : "保存凭证失败";
      setConnection({ status: "error", message });
    }
  };
  return (
    <section className="settings-group provider-settings">
      <div className="settings-group-heading"><Server size={18} /><div><h2>{title}</h2><p>{description}</p></div></div>
      <div className="settings-form-grid">
        <label><span>配置名称</span><input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} /></label>
        <label><span>模型名称</span><input value={value.model} placeholder={kind === "ai" ? "例如：gpt-4.1-mini" : "例如：whisper-1"} onChange={(event) => onChange({ ...value, model: event.target.value })} /></label>
        <label className="full"><span>服务地址</span><input value={value.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => onChange({ ...value, baseUrl: event.target.value })} /></label>
        <label className="full"><span>API Key（仅保存在当前设备，不参与同步）</span><input type="password" autoComplete="off" value={apiKey} disabled={isSecretLoading} placeholder={isSecretLoading ? "正在读取已保存的 API Key" : "输入 API Key"} onChange={(event) => setApiKey(event.target.value)} /></label>
      </div>
      <div className="settings-actions">
        <label className="inline-check"><input type="checkbox" checked={value.enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} /> 启用此配置</label>
        <span className={`connection-state ${connection.status}`}>{connection.message}</span>
        <button type="button" className="button-secondary" onClick={() => void test()} disabled={isSecretLoading || connection.status === "testing"}><RefreshCw size={14} /> 测试连接</button>
        <button type="button" className="button-primary compact-button" onClick={() => void save()} disabled={isSecretLoading}><Save size={14} /> 保存</button>
      </div>
    </section>
  );
}

export function SettingsPage({ controller }: { controller: WorkspaceController }) {
  const { preferences } = controller;
  const [modelMessage, setModelMessage] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const modelsRef = useRef(preferences.installedModels);
  useEffect(() => { void readDeviceSecret("sync").then(setSyncPassword); }, []);
  useEffect(() => { modelsRef.current = preferences.installedModels; }, [preferences.installedModels]);
  const cycleTheme = () => {
    const next: WorkspacePreferences["theme"] = preferences.theme === "system" ? "light" : preferences.theme === "light" ? "dark" : "system";
    controller.updatePreferences({ theme: next });
  };
  const installModel = async (model: typeof localModelCatalog[number]) => {
    const current = preferences.installedModels.find((item) => item.id === model.id);
    const update = (patch: Partial<NonNullable<typeof current>> & { status: "downloading" | "paused" | "verifying" | "ready" | "failed"; progress: number }) => {
      const existing = modelsRef.current.find((item) => item.id === model.id);
      const next = { id: model.id, label: model.label, fileName: model.id, sizeBytes: model.sizeBytes, ...existing, ...patch };
      modelsRef.current = [...modelsRef.current.filter((item) => item.id !== model.id), next];
      controller.updatePreferences({ installedModels: modelsRef.current });
    };
    update({ status: "downloading", progress: current?.progress ?? 0, errorMessage: undefined });
    setModelMessage("模型下载期间请保持应用开启。");
    try {
      await localTranscriptionRuntime.install(model.id, (progress, message) => { update({ status: progress >= 100 ? "verifying" : "downloading", progress }); setModelMessage(message); });
      update({ status: "ready", progress: 100, errorMessage: undefined });
      setModelMessage(`${model.label} 已安装并通过加载校验。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型安装失败";
      update({ status: message.includes("暂停") ? "paused" : "failed", progress: current?.progress ?? 0, errorMessage: message });
      setModelMessage(message);
    }
  };
  const pauseModel = (id: string) => {
    localTranscriptionRuntime.cancelAll();
    controller.updatePreferences({ installedModels: preferences.installedModels.map((item) => item.id === id ? { ...item, status: "paused" as const } : item) });
  };
  const removeModel = async (id: string) => {
    localTranscriptionRuntime.cancelAll("模型已删除");
    await deleteCachedModel(id);
    controller.updatePreferences({ installedModels: preferences.installedModels.filter((item) => item.id !== id) });
    setModelMessage("模型缓存已从当前设备删除。");
  };
  const syncCredentials = { endpoint: preferences.sync.endpoint, username: preferences.sync.account, password: syncPassword };
  const testSync = async () => {
    setIsSyncing(true); setSyncMessage("正在连接同步服务"); await writeDeviceSecret("sync", syncPassword);
    try { await testSyncConnection(syncCredentials); setSyncMessage("同步服务连接成功"); }
    catch (error) { setSyncMessage(error instanceof Error ? error.message : "同步服务连接失败"); }
    finally { setIsSyncing(false); }
  };
  const runSync = async () => {
    setIsSyncing(true); setSyncMessage("正在同步数据与录音"); await writeDeviceSecret("sync", syncPassword);
    controller.updatePreferences({ sync: { ...preferences.sync, status: "syncing", errorMessage: undefined } });
    try {
      const result = await syncWorkspace(controller, syncCredentials);
      controller.replaceWorkspace(result.workspace);
      setSyncMessage(`同步完成：上传 ${result.uploadedAudio} 段录音，下载 ${result.downloadedAudio} 段录音${result.conflicts ? `，保留 ${result.conflicts} 个冲突副本` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      controller.updatePreferences({ sync: { ...preferences.sync, status: "error", errorMessage: message } });
      setSyncMessage(message);
    } finally { setIsSyncing(false); }
  };
  const clearLocalData = async () => {
    if (!window.confirm("确定删除当前设备上的全部会话、录音、报告和训练计划？此操作不可撤销。")) return;
    await Promise.all(controller.recordingTasks.map((task) => deleteAudioFile(task.id).catch(() => undefined)));
    const empty = createEmptyWorkspace();
    empty.preferences = { ...empty.preferences, theme: preferences.theme, aiProvider: preferences.aiProvider, onlineAsrProvider: preferences.onlineAsrProvider, installedModels: preferences.installedModels, sync: preferences.sync };
    controller.replaceWorkspace(empty);
  };
  return (
    <div className="page settings-page">
      <PageHeader eyebrow="设置" title="连接真实能力，管理本地数据" description="API 凭证仅保存在当前设备；未配置外部服务时，本地知识库和历史数据仍可使用。" />
      <div className="settings-layout">
        <ProviderForm title="高级建议与总结" description="用于面试问题生成、答案深度反馈和结构化报告。支持 OpenAI-compatible 接口。" kind="ai" value={preferences.aiProvider} onChange={(aiProvider) => controller.updatePreferences({ aiProvider })} />
        <ProviderForm title="在线高精度转写" description="独立于 AI 配置，仅在你主动选择在线转写时上传音频。" kind="online-asr" value={preferences.onlineAsrProvider} onChange={(onlineAsrProvider) => controller.updatePreferences({ onlineAsrProvider })} />
        <section className="settings-group">
          <div className="settings-group-heading"><Volume2 size={18} /><div><h2>本地转写模型</h2><p>模型文件保存在当前设备，不参与跨端同步</p></div></div>
          <div className="model-list">{localModelCatalog.map((model) => { const installed = preferences.installedModels.find((item) => item.id === model.id); const running = installed?.status === "downloading" || installed?.status === "verifying"; return <div className="model-row" key={model.id}><span className="setting-icon"><HardDrive size={17} /></span><div><strong>{model.label}</strong><small>{model.recommendation}</small>{installed && installed.status !== "ready" ? <div className="model-progress"><i style={{ width: `${installed.progress}%` }} /></div> : null}</div><span className="setting-value">约 {(model.sizeBytes / 1024 / 1024).toFixed(0)} MB</span>{installed?.status === "ready" ? <button type="button" className="icon-action" aria-label="删除模型" onClick={() => void removeModel(model.id)}><Trash2 size={15} /></button> : running ? <button type="button" className="icon-action" onClick={() => pauseModel(model.id)}><Pause size={15} /></button> : <button type="button" className="button-secondary" onClick={() => void installModel(model)}>{installed?.status === "paused" ? <RefreshCw size={14} /> : <Download size={14} />}{installed?.status === "paused" ? "继续" : "下载"}</button>}</div>; })}</div>
          {modelMessage ? <div className="model-message">{modelMessage}</div> : null}
        </section>
        <section className="settings-group">
          <div className="settings-group-heading"><Cloud size={18} /><div><h2>跨端同步</h2><p>同步会话、材料、逐字稿、报告、计划和原始录音</p></div></div>
          <div className="settings-form-grid">
            <label className="full"><span>同步服务地址</span><input value={preferences.sync.endpoint} placeholder="填写你的私有同步服务地址" onChange={(event) => controller.updatePreferences({ sync: { ...preferences.sync, endpoint: event.target.value } })} /></label>
            <label><span>账号</span><input value={preferences.sync.account} placeholder="单用户账号" onChange={(event) => controller.updatePreferences({ sync: { ...preferences.sync, account: event.target.value } })} /></label>
            <label><span>设备名称</span><input value={preferences.sync.deviceName} placeholder="例如：我的 MacBook" onChange={(event) => controller.updatePreferences({ sync: { ...preferences.sync, deviceName: event.target.value } })} /></label>
            <label className="full"><span>同步密码或应用专用密码（仅保存在当前设备）</span><input type="password" autoComplete="off" value={syncPassword} onChange={(event) => setSyncPassword(event.target.value)} /></label>
          </div>
          <div className="settings-actions"><span className="connection-state">{syncMessage || (preferences.sync.lastSyncedAt ? `上次同步：${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(preferences.sync.lastSyncedAt))}` : "尚未同步")}</span><button className="button-secondary" type="button" disabled={isSyncing} onClick={() => void testSync()}><RefreshCw size={14} /> 测试连接</button><button className="button-primary compact-button" type="button" disabled={isSyncing} onClick={() => void runSync()}>{isSyncing ? <RefreshCw className="spin" size={14} /> : <Cloud size={14} />} 立即同步</button></div>
        </section>
        <section className="settings-group">
          <div className="settings-group-heading"><ShieldCheck size={18} /><div><h2>数据与应用</h2><p>控制本地保存和界面偏好</p></div></div>
          <SettingToggle icon={Database} title="自动保存" description="输入和修改自动写入当前设备" checked={preferences.autoSave} onChange={(autoSave) => controller.updatePreferences({ autoSave })} />
          <SettingRow icon={Moon} title="外观" value={themeLabels[preferences.theme]} onClick={cycleTheme} />
          <SettingRow icon={KeyRound} title="设备凭证" value="API Key 不参与同步" />
          <SettingRow icon={Database} title="内置知识库" value={`${knowledgeBaseStats.executableRuleCount} 条可执行规则 · ${knowledgeBaseStats.lexicalPatternCount} 个短语模式`} />
          <SettingRow icon={Trash2} title="清理本地数据" value="删除会话、录音、报告和计划" onClick={() => void clearLocalData()} />
        </section>
      </div>
      <footer className="settings-footer"><strong>言序 0.2.6</strong><span>{controller.isSaving ? "正在保存本地数据" : controller.persistenceError ? "本地保存出现异常" : "本地工作区已就绪"}</span></footer>
    </div>
  );
}

function SettingToggle({ icon: Icon, title, description, checked, onChange }: { icon: typeof Database; title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="setting-row"><span className="setting-icon"><Icon size={17} /></span><div><strong>{title}</strong><small>{description}</small></div><button className={checked ? "toggle active" : "toggle"} type="button" aria-pressed={checked} onClick={() => onChange(!checked)}><span /></button></div>;
}

function SettingRow({ icon: Icon, title, value, onClick }: { icon: typeof Database; title: string; value: string; onClick?: () => void }) {
  return <button className="setting-row" type="button" onClick={onClick}><span className="setting-icon"><Icon size={17} /></span><strong>{title}</strong><span className="setting-value">{value}</span></button>;
}
