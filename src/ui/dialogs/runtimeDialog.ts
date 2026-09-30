import { rt } from "../../state/runtime";
import { chatPanelState } from "../../common/chatPanelState";
import { runtimeDetailsTabs } from "../../common/runtimeUtils";
import { refreshRuntimeSnapshot } from "../../handlers/notifications";
import { rememberPreferredAgent } from "../../session/defaults";
import { hostUiLanguage as currentUiLanguage, localized as nativeText } from "../../common/hostI18n";
import { _deleteSessionById, setTrackedInlineDialogState } from "./common";
import { loadSavedSession, openAgentsDialog, openSessionsDialog } from "./sessions";

// ──────────────────────────────────────────────
// Runtime dialog
// ──────────────────────────────────────────────

export async function openRuntimeDialog(activeTabId?: string): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!panel) return;
  await refreshRuntimeSnapshot();
  if (panel !== rt.chatPanel || sessionManager !== rt.sessionManager) return;
  const language = currentUiLanguage();
  setTrackedInlineDialogState({
    kind: "runtimeDetails",
    title: nativeText("Runtime Details", "运行时详情"),
    subtitle: "",
    tabs: runtimeDetailsTabs(rt.currentRuntime, language),
    activeTabId,
  });
}

export function openLogsDialog(): void {
  if (!rt.chatPanel) return;
  rt.logsDialogSignature = "";
  pushLogDialogState();
  startLogsRefresh();
}

export const LOG_MODULES: Array<{ id: string; label: string | (() => string); pattern: RegExp }> = [
  { id: "events", label: () => nativeText("Events", "事件"), pattern: /\[event:/i },
  { id: "chrys", label: "chrys", pattern: /\[chrys\]/i },
  { id: "agent-framework", label: "agent-framework", pattern: /\[agent_framework\]/i },
  { id: "openai", label: "openai", pattern: /\[openai\]/i },
  { id: "anthropic", label: "anthropic", pattern: /\[anthropic\]/i },
  { id: "httpcore", label: "httpcore", pattern: /\[httpcore\]/i },
  { id: "httpx", label: "httpx", pattern: /\[httpx\]/i },
];

export function parseLogModules(lines: string[]): Array<{ id: string; label: string; text: string }> {
  const modules = new Map<string, string[]>();
  const all: string[] = [];
  for (const line of lines) {
    all.push(line);
    let matched = false;
    for (const mod of LOG_MODULES) {
      if (mod.pattern.test(line)) {
        if (!modules.has(mod.id)) modules.set(mod.id, []);
        modules.get(mod.id)!.push(line);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!modules.has("other")) modules.set("other", []);
      modules.get("other")!.push(line);
    }
  }
  const tabs: Array<{ id: string; label: string; text: string }> = [
    { id: "all", label: nativeText("All", "全部"), text: all.join("\n") },
  ];
  for (const mod of LOG_MODULES) {
    const modLines = modules.get(mod.id);
    if (modLines && modLines.length) {
      tabs.push({ id: mod.id, label: typeof mod.label === "function" ? mod.label() : mod.label, text: modLines.join("\n") });
    }
  }
  const otherLines = modules.get("other");
  if (otherLines && otherLines.length) {
    tabs.push({ id: "other", label: nativeText("Other", "其他"), text: otherLines.join("\n") });
  }
  return tabs;
}

export function pushLogDialogState(): void {
  const lines = rt.logLines.slice(-250);
  // The refresh timer fires every 2s; skip re-sending ~250 lines twice when nothing changed.
  const signature = `${rt.logLines.length}\0${lines.at(-1) ?? ""}\0${lines[0] ?? ""}`;
  if (signature === rt.logsDialogSignature) return;
  rt.logsDialogSignature = signature;
  const tabs = parseLogModules(lines);
  setTrackedInlineDialogState({
    kind: "logs",
    title: nativeText("Logs", "日志"),
    subtitle: nativeText("Recent iCode extension logs captured by this frontend.", "当前前端捕获的近期 iCode 扩展日志。"),
    logTabs: tabs,
  });
}

export function startLogsRefresh(): void {
  if (rt.logsRefreshTimer) clearInterval(rt.logsRefreshTimer);
  rt.logsRefreshTimer = setInterval(() => {
    if (rt.activeInlineDialogKind === "logs") {
      pushLogDialogState();
    } else {
      if (rt.logsRefreshTimer) {
        clearInterval(rt.logsRefreshTimer);
        rt.logsRefreshTimer = null;
      }
    }
  }, 2000);
}

export function clearLogsRefreshTimer(): void {
  if (rt.logsRefreshTimer) {
    clearInterval(rt.logsRefreshTimer);
    rt.logsRefreshTimer = null;
  }
}

// ──────────────────────────────────────────────
// Inline dialog actions
// ──────────────────────────────────────────────

export async function handleInlineDialogAction(
  action: "resumeSession" | "deleteSession" | "switchAgent" | "newSession",
  payload: { id?: string; cwd?: string; name?: string },
): Promise<void> {
  if (!rt.sessionManager || !rt.chatPanel) return;
  rt.chatPanel?.setInlineDialogBusy(true);
  try {
    if (action === "newSession") {
      const { openSessionTab } = await import("../../extension");
      await openSessionTab();
      return;
    }

    if (action === "resumeSession" && payload.id) {
      if (await loadSavedSession({ sessionId: payload.id, cwd: payload.cwd || "" })) {
        rt.chatPanel?.inlineDialogNotice("info", nativeText("Session loaded.", "会话已加载。"));
        await openSessionsDialog();
      }
      return;
    }

    if (action === "deleteSession" && payload.id) {
      await _deleteSessionById(payload.id, payload.cwd);
      await openSessionsDialog();
      return;
    }

    if (action === "switchAgent" && payload.name && payload.name !== rt.activeAgentName) {
      if (rt.sessionManager.state !== "idle") {
        rt.chatPanel?.inlineDialogNotice("warning", nativeText(
          "iCode cannot switch agents while the current task is running.",
          "当前任务运行时不能切换 iCode 智能体。",
        ));
        rt.chatPanel?.appendDebugEvent("AgentSwitchBlocked", rt.sessionManager.state);
        return;
      }
      await rt.sessionManager.switchAgent(payload.name);
      rt.activeAgentName = payload.name;
      rememberPreferredAgent(payload.name);
      await refreshRuntimeSnapshot();
      rt.chatPanel?.setState(chatPanelState());
      rt.chatPanel?.inlineDialogNotice("info", nativeText(`Switched to ${payload.name}.`, `已切换到 ${payload.name}。`));
      await openAgentsDialog();
    }
  } finally {
    rt.chatPanel?.setInlineDialogBusy(false);
  }
}
