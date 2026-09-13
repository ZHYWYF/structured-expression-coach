import { useEffect, useRef, useState } from "react";
import type { WorkspaceController } from "../core/useWorkspace";
import type { Session } from "../core/types";
import type { AnalysisFinding, KnowledgeScenario } from "../knowledge";
import { adviceToFeedback, feedbackToAdvice, requestExpressionAdvice } from "../providers/expressionAdvice";

const MAX_TEXT_LENGTH = 12_000;
const MIN_REQUEST_INTERVAL = 15_000;
export function useExpressionAdvice(controller: WorkspaceController, session: Session | null, text: string, scenario: KnowledgeScenario, localFindings: AnalysisFinding[]) {
  // Explicit, session-scoped consent. No text is sent merely by opening the page.
  const [enabledSession, setEnabledSession] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ key: string; status: "waiting" | "loading" | "ready" | "error"; message: string; findings: AnalysisFinding[] }>({ key: "", status: "ready", message: "", findings: [] });
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const localRef = useRef(localFindings);
  localRef.current = localFindings;
  const lastStarted = useRef(0);
  const forceNext = useRef(false);
  const latestKey = useRef("");
  const provider = controller.preferences.aiProvider;
  const key = JSON.stringify([session?.id, scenario, text, provider.baseUrl, provider.model, provider.enabled, revision]);
  latestKey.current = key;
  const enabled = Boolean(session && enabledSession === session.id);
  const cached = session?.feedback.filter((item) => item.id.startsWith("expression-ai-") && item.summary === provider.model).reverse().find((item) => feedbackToAdvice(item, text, scenario) !== null);
  const cachedAdvice = feedbackToAdvice(cached, text, scenario);
  const cacheRef = useRef(cachedAdvice);
  cacheRef.current = cachedAdvice;
  const canRequest = Boolean(provider.enabled && provider.baseUrl.trim() && provider.model.trim());
  const textEligible = text.trim().length >= 16 && /[\p{L}]/u.test(text) && text.length <= MAX_TEXT_LENGTH;

  useEffect(() => { setEnabledSession(null); }, [session?.id]);
  useEffect(() => {
    if (!enabled || !session || !canRequest || !textEligible) return;
    if (!forceNext.current && cacheRef.current) {
      setState({ key, status: "ready", message: "已复用此版本原文的建议，未重复请求", findings: cacheRef.current });
      return;
    }
    const requestKey = key;
    const abort = new AbortController();
    const sessionId = session.id;
    const scenarioId = session.scenarioId;
    setState({ key: requestKey, status: "waiting", message: "文字稳定后自动分析；两次请求至少间隔15秒", findings: [] });
    const delay = Math.max(900, MIN_REQUEST_INTERVAL - (Date.now() - lastStarted.current));
    const timer = window.setTimeout(async () => {
      if (abort.signal.aborted) return;
      forceNext.current = false;
      lastStarted.current = Date.now();
      setState({ key: requestKey, status: "loading", message: "正在分析语义，本地标注仍即时更新…", findings: [] });
      try {
        const findings = await requestExpressionAdvice(provider, text, scenario, localRef.current, abort.signal);
        if (abort.signal.aborted || latestKey.current !== requestKey) return;
        const snapshot = controllerRef.current.getSnapshot?.() ?? controllerRef.current;
        const current = snapshot.sessions.find((item) => item.id === sessionId);
        if (!current || current.draftText !== text || current.scenarioId !== scenarioId) return;
        const feedback = adviceToFeedback(sessionId, text, scenario, findings, provider.model);
        controllerRef.current.updateSession(sessionId, (item) => item.draftText !== text || item.scenarioId !== scenarioId ? item : ({ ...item,
          feedback: [...item.feedback.filter((entry) => !entry.id.startsWith("expression-ai-") || entry.evidence[0]?.quote !== text || entry.title !== feedback.title), feedback],
        }));
        setState({ key: requestKey, status: "ready", message: findings.length ? "AI建议已保存，仅供参考，尚未采纳" : "AI未发现值得补充的建议，不代表表达没有问题", findings });
      } catch (error) {
        if (abort.signal.aborted || latestKey.current !== requestKey) return;
        setState({ key: requestKey, status: "error", message: error instanceof Error ? error.message : "AI分析失败，可重试；本地标注不受影响", findings: [] });
      }
    }, delay);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [key, enabled, canRequest, textEligible]);

  const currentState = state.key === key ? state : null;
  const findings = (currentState?.status === "ready" ? currentState.findings : cachedAdvice) ?? [];
  const message = !enabled ? cachedAdvice ? "展示此版本原文已保存的AI建议；自动分析未开启" : "仅运行本地规则，启用后会将本会话原文发送到所配AI服务" :
    !canRequest ? "请先在设置中配置并启用AI服务（支持DeepSeek兼容接口）" :
    text.length > MAX_TEXT_LENGTH ? "原文超过12000字，请拆分到独立会话分析；未截断或发送原文" :
    !textEligible ? "写下至少16字的有效表达后开始语义分析" : currentState?.message ?? (cachedAdvice ? "已复用此版本原文的建议，未重复请求" : "等待文字稳定后分析…");
  return { enabled, findings, message, busy: enabled && (currentState?.status === "loading" || currentState?.status === "waiting"),
    toggle: (next: boolean) => setEnabledSession(next ? session?.id ?? null : null),
    retry: () => { forceNext.current = true; setRevision((value) => value + 1); }, canRetry: enabled && canRequest && textEligible };
}
