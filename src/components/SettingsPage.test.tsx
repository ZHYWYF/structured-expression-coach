// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createController } from "../test/createController";

const runtimeMocks = vi.hoisted(() => ({ install: vi.fn(), cancelAll: vi.fn(), deleteCachedModel: vi.fn() }));
const secretMocks = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("../transcription/localRuntime", () => ({
  localModelCatalog: [
    { id: "model-a", label: "Model A", sizeBytes: 100, recommendation: "A" },
    { id: "model-b", label: "Model B", sizeBytes: 200, recommendation: "B" },
  ],
  localTranscriptionRuntime: { install: runtimeMocks.install, cancelAll: runtimeMocks.cancelAll },
  deleteCachedModel: runtimeMocks.deleteCachedModel,
}));
vi.mock("../providers/openAiCompatible", () => ({
  readDeviceSecret: vi.fn(async (kind: string) => secretMocks.values.get(kind) ?? ""),
  writeDeviceSecret: vi.fn(async (kind: string, value: string) => {
    const normalized = value.trim();
    if (normalized) secretMocks.values.set(kind, normalized);
    else secretMocks.values.delete(kind);
  }),
  testProviderConnection: vi.fn(),
}));
vi.mock("../sync/webdavSync", () => ({ syncWorkspace: vi.fn(), testSyncConnection: vi.fn() }));
vi.mock("../transcription/audioStore", () => ({ deleteAudioFile: vi.fn() }));

import { SettingsPage } from "./SettingsPage";

describe("SettingsPage", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    secretMocks.values.clear();
  });

  it("restores a saved API key after the settings page is remounted", async () => {
    const controller = createController();
    const firstRender = render(<SettingsPage controller={controller} />);
    const apiKeyInput = (await screen.findAllByLabelText(/API Key/))[0];

    fireEvent.change(apiKeyInput, { target: { value: "  persisted-key  " } });
    fireEvent.click(screen.getAllByText("保存")[0]);
    await waitFor(() => expect(secretMocks.values.get("ai")).toBe("persisted-key"));

    firstRender.unmount();
    const secondRender = render(<SettingsPage controller={controller} />);
    await waitFor(() => expect((screen.getAllByLabelText(/API Key/)[0] as HTMLInputElement).value).toBe("persisted-key"));
    secondRender.unmount();
  });

  it("preserves both model states when two downloads run concurrently", async () => {
    const pending: Array<{ progress: (value: number, message: string) => void; resolve: () => void }> = [];
    runtimeMocks.install.mockImplementation((_id: string, progress: (value: number, message: string) => void) => new Promise<void>((resolve) => pending.push({ progress, resolve })));
    const controller = createController();
    render(<SettingsPage controller={controller} />);

    const buttons = screen.getAllByText("下载");
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    pending[0].progress(50, "A 50%");
    pending[1].progress(50, "B 50%");

    await waitFor(() => {
      const patches = vi.mocked(controller.updatePreferences).mock.calls.map(([patch]) => patch.installedModels).filter(Boolean);
      expect(patches.some((models) => models?.map((item) => item.id).sort().join(",") === "model-a,model-b")).toBe(true);
    });
  });

  it("DeepSeek快捷配置不改动设备已保存的API密钥", async () => {
    secretMocks.values.set("ai", "test-device-credential");
    const controller = createController();
    const view = render(<SettingsPage controller={controller} />);
    await waitFor(() => expect((screen.getAllByLabelText(/API Key/)[0] as HTMLInputElement).value).toBe("test-device-credential"));
    fireEvent.click(screen.getByText("使用 DeepSeek 地址"));
    expect(controller.updatePreferences).toHaveBeenCalledWith({ aiProvider: expect.objectContaining({ name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "" }) });
    expect(secretMocks.values.get("ai")).toBe("test-device-credential");
    view.unmount();
  });
  it("信息行不是假按钮，清理全部数据可取消", async () => {
    const controller = createController();
    render(<SettingsPage controller={controller} />);
    expect(screen.queryByRole("button", { name: /内置知识库/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /清理本地数据/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("取消")));
    expect(controller.replaceWorkspace).not.toHaveBeenCalled();
  });
  it("删除模型确认后才清除缓存", async () => {
    runtimeMocks.deleteCachedModel.mockResolvedValue(undefined);
    const controller = createController();
    controller.preferences.installedModels = [{ id: "model-a", label: "Model A", fileName: "model", status: "ready", progress: 100, sizeBytes: 1 }];
    render(<SettingsPage controller={controller} />);
    fireEvent.click(screen.getByLabelText("删除模型"));
    await act(async () => fireEvent.click(screen.getByText("取消")));
    expect(runtimeMocks.deleteCachedModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("删除模型"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认删除" })));
    expect(runtimeMocks.deleteCachedModel).toHaveBeenCalledWith("model-a");
  });
});
