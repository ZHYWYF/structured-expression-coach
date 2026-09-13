// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppDialog } from "./useAppDialog";

function Harness({ result }: { result: (value: unknown) => void }) {
  const dialog = useAppDialog();
  return <>{dialog.dialog}<button onClick={async () => result(await dialog.confirm("删除当前测试记录？", { destructive: true }))}>删除记录</button><button onClick={async () => result(await dialog.prompt("会话名称", "旧名称"))}>重命名</button></>;
}
describe("应用内确认弹窗", () => {
  afterEach(cleanup);
  it("点击取消和Escape均不确认删除，确认只返回一次", async () => {
    const result = vi.fn(); render(<Harness result={result} />);
    fireEvent.click(screen.getByText("删除记录"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("取消")));
    expect(result).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByText("删除记录"));
    await act(async () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }));
    expect(result).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByText("删除记录"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "确认删除" })));
    expect(result).toHaveBeenLastCalledWith(true);
    expect(result).toHaveBeenCalledTimes(3);
  });
  it("重命名保留输入并返回新名称，退出页面按取消处理", async () => {
    const result = vi.fn(); const view = render(<Harness result={result} />);
    fireEvent.click(screen.getByText("重命名"));
    expect((screen.getByLabelText("新名称") as HTMLInputElement).value).toBe("旧名称");
    fireEvent.change(screen.getByLabelText("新名称"), { target: { value: "我的面试" } });
    await act(async () => fireEvent.click(screen.getByText("保存名称")));
    expect(result).toHaveBeenLastCalledWith("我的面试");
    fireEvent.click(screen.getByText("删除记录"));
    await act(async () => view.unmount());
    expect(result).toHaveBeenLastCalledWith(false);
  });
});
