// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createController } from "./test/createController";
const mocks = vi.hoisted(() => ({ controller: undefined as unknown, reportMount: vi.fn(), reportUnmount: vi.fn() }));
vi.mock("./core/useWorkspace", () => ({ useWorkspace: () => mocks.controller }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("./components/HomePage", () => ({ HomePage: () => <div>首页内容</div> }));
vi.mock("./components/ExpressionWorkspace", () => ({ ExpressionWorkspace: () => <div>工作台内容</div> }));
vi.mock("./components/InterviewStudio", () => ({ InterviewStudio: () => null }));
vi.mock("./components/SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("./components/TrainingPlan", () => ({ TrainingPlan: () => null }));
vi.mock("./components/ReportsPage", async () => {
  const { useEffect } = await import("react");
  return { ReportsPage: () => { useEffect(() => { mocks.reportMount(); return mocks.reportUnmount; }, []); return <div>录音任务</div>; } };
});
import App from "./App";

describe("应用保存状态和录音页面生命周期", () => {
  beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false })));
  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
  it("自动保存中不插入顶部手动按钮，状态区域节点始终存在", () => {
    const controller = createController({ currentPage: "workspace", hasUnsavedChanges: false });
    mocks.controller = controller;
    const view = render(<App />);
    const bar = view.container.querySelector(".workspace-save-status");
    mocks.controller = { ...controller, hasUnsavedChanges: true };
    view.rerender(<App />);
    expect(screen.queryByRole("button", { name: "保存到本地" })).toBeNull();
    expect(view.container.querySelector(".workspace-save-status")).toBe(bar);
    mocks.controller = { ...controller, isSaving: true, hasUnsavedChanges: true };
    view.rerender(<App />);
    expect(view.container.querySelector(".workspace-save-status")).toBe(bar);
  });
  it("关闭自动保存或写入失败时保留手动恢复入口", () => {
    const controller = createController({ hasUnsavedChanges: true });
    controller.preferences.autoSave = false;
    mocks.controller = controller;
    const view = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "保存到本地" }));
    expect(controller.flush).toHaveBeenCalledTimes(1);
    mocks.controller = { ...controller, persistenceError: "磁盘写入失败" };
    view.rerender(<App />);
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }));
    expect(controller.flush).toHaveBeenCalledTimes(2);
  });
  it("离开录音页只隐藏，回到页面不会重建运行中的任务", () => {
    const controller = createController({ currentPage: "reports" });
    mocks.controller = controller;
    const view = render(<App />);
    expect(mocks.reportMount).toHaveBeenCalledTimes(1);
    mocks.controller = { ...controller, currentPage: "workspace" };
    view.rerender(<App />);
    expect(screen.getByText("录音任务").parentElement?.hidden).toBe(true);
    expect(mocks.reportUnmount).not.toHaveBeenCalled();
    mocks.controller = controller;
    view.rerender(<App />);
    expect(mocks.reportMount).toHaveBeenCalledTimes(1);
  });
});
