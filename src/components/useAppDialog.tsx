import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DialogRequest = { kind: "confirm" | "prompt" | "notice"; message: string; initialValue?: string; confirmLabel?: string; destructive?: boolean };
type PendingDialog = DialogRequest & { resolve: (result: string | boolean | null) => void };

// Native JavaScript confirm/prompt are not a reliable UI surface inside WKWebView.
// Keep confirmation in the app, and resolve cancellation on unmount.
export function useAppDialog() {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const pendingRef = useRef<PendingDialog | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const settle = useCallback((result: string | boolean | null) => {
    const request = pendingRef.current;
    if (!request) return;
    pendingRef.current = null;
    setPending(null);
    request.resolve(result);
    previousFocus.current?.focus();
  }, []);
  const cancelDialog = useCallback(() => settle(null), [settle]);
  const ask = useCallback((request: DialogRequest) => new Promise<string | boolean | null>((resolve) => {
    if (pendingRef.current) { resolve(null); return; }
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const value = { ...request, resolve };
    pendingRef.current = value;
    setPending(value);
  }), []);
  const confirm = useCallback(async (message: string, options: { confirmLabel?: string; destructive?: boolean } = {}) => (await ask({ kind: "confirm", message, ...options })) === true, [ask]);
  const prompt = useCallback(async (message: string, initialValue = "") => {
    const result = await ask({ kind: "prompt", message, initialValue });
    return typeof result === "string" ? result : null;
  }, [ask]);
  const notice = useCallback(async (message: string) => { await ask({ kind: "notice", message }); }, [ask]);
  useEffect(() => {
    if (!pending) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (pending.kind === "prompt") { inputRef.current?.focus(); inputRef.current?.select(); }
    else cancelRef.current?.focus();
  }, [pending]);
  useEffect(() => () => { const request = pendingRef.current; pendingRef.current = null; request?.resolve(null); }, []);

  const dialog = pending ? createPortal(
    <dialog ref={dialogRef} className="app-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); cancelDialog(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); cancelDialog(); }
        if (event.key !== "Tab") return;
        const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input, button") ?? []);
        const first = nodes[0]; const last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <form onSubmit={(event) => { event.preventDefault(); settle(pending.kind === "prompt" ? inputRef.current?.value ?? "" : true); }}>
        <h2 id={titleId}>{pending.kind === "prompt" ? "修改名称" : pending.kind === "notice" ? "操作提示" : pending.destructive ? "确认删除" : "请确认"}</h2>
        <p id={descriptionId}>{pending.message}</p>
        {pending.kind === "prompt" ? <input ref={inputRef} aria-label="新名称" defaultValue={pending.initialValue} maxLength={160} required /> : null}
        <div className="app-dialog-actions">
          {pending.kind !== "notice" ? <button ref={cancelRef} type="button" className="button-secondary" onClick={cancelDialog}>取消</button> : null}
          <button ref={pending.kind === "notice" ? cancelRef : undefined} type="submit" className={pending.destructive ? "button-primary dialog-danger" : "button-primary"}>{pending.confirmLabel ?? (pending.kind === "prompt" ? "保存名称" : pending.kind === "notice" ? "知道了" : pending.destructive ? "确认删除" : "确认继续")}</button>
        </div>
      </form>
    </dialog>, document.body,
  ) : null;
  return { confirm, prompt, notice, cancelDialog, dialog };
}
