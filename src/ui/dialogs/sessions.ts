import { withLocalSessionNames } from "../../session/localNames";
import { agentSelectionTarget } from "../../session/selectionTarget";
import { rt } from "../../state/runtime";
import { logError } from "../../common/logging";
import { chatPanelState } from "../../common/chatPanelState";
import { persistPreferredAgent } from "../../session/defaults";
import type { SessionInfo, ProfileSummary } from "../../acp/types";
import { localized as nativeText } from "../../common/hostI18n";
import { _deleteSessionById, inlineDialogError, setTrackedInlineDialogState, showInlineNotice, startingNotice } from "./common";

// ──────────────────────────────────────────────
// Sessions dialog
// ──────────────────────────────────────────────

export function refreshOpenSessionsDialog(): void {
  if (rt.activeInlineDialogKind !== "sessions" || rt.sessionsDialogRefreshPending) return;
  rt.sessionsDialogRefreshPending = true;
  openSessionsDialog({ refreshOnly: true })
    .catch((error) => {
      inlineDialogError(error);
    })
    .finally(() => {
      rt.sessionsDialogRefreshPending = false;
    });
}

export async function openSessionsDialog(options: { refreshOnly?: boolean } = {}): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    showInlineNotice("warning", startingNotice());
    return;
  }
  if (!rt.currentCwd) {
    showInlineNotice("warning", nativeText("No workspace directory selected.", "尚未选择工作区目录。"));
    return;
  }
  panel.setInlineDialogBusy(true);
  try {
    const sessions = withLocalSessionNames(await sessionManager.listSessions(rt.currentCwd), rt.extensionContext?.workspaceState);
    if (panel !== rt.chatPanel || sessionManager !== rt.sessionManager) return;
    if (options.refreshOnly && rt.activeInlineDialogKind !== "sessions") {
      return;
    }
    setTrackedInlineDialogState({
      kind: "sessions",
      title: nativeText("Sessions", "会话"),
      subtitle: nativeText("Resume or start a iCode session without leaving the chat.", "无需离开聊天即可恢复或启动 iCode 会话。"),
      sessions,
    });
  } finally {
    panel.setInlineDialogBusy(false);
  }
}

export async function resumeLastSession(): Promise<void> {
  if (!rt.sessionManager || !rt.chatPanel) {
    showInlineNotice("warning", startingNotice());
    return;
  }
  if (!rt.currentCwd) {
    showInlineNotice("warning", nativeText("No workspace directory selected.", "尚未选择工作区目录。"));
    return;
  }
  const sessions = withLocalSessionNames(await rt.sessionManager.listSessions(rt.currentCwd), rt.extensionContext?.workspaceState);
  const latest = sessions[0];
  if (!latest) {
    showInlineNotice("warning", nativeText("No saved sessions.", "没有已保存会话。"));
    return;
  }
  if (await loadSavedSession(latest)) {
    rt.chatPanel?.inlineDialogNotice("info", nativeText(`Resumed ${latest.title || latest.sessionId}.`, `已恢复 ${latest.title || latest.sessionId}。`));
  }
}

export async function loadSavedSession(session: Pick<SessionInfo, "sessionId" | "cwd">): Promise<boolean> {
  const { openSessionTab } = await import("../../extension");
  return openSessionTab(session);
}

// ──────────────────────────────────────────────
// Agents dialog
// ──────────────────────────────────────────────

export async function openAgentsDialog(): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    showInlineNotice("warning", startingNotice());
    return;
  }
  panel.setInlineDialogBusy(true);
  try {
    const agents = await sessionManager.listAgentProfiles();
    if (panel !== rt.chatPanel || sessionManager !== rt.sessionManager) return;
    setTrackedInlineDialogState({
      kind: "agents",
      title: nativeText("Agents", "智能体"),
      subtitle: nativeText("Switch the active iCode agent in this session.", "切换当前会话使用的 iCode 智能体。"),
      agents: agents.filter((agent: ProfileSummary) => !agent.subAgentOnly),
      activeAgentName: rt.activeAgentName,
    });
  } finally {
    panel.setInlineDialogBusy(false);
  }
}


export async function refreshSessionsSidebar(): Promise<void> {
  if (!rt.chatPanel || rt.sessionsSidebarRefreshPending) return;
  const sessionManager = rt.sessionManager;
  const cwd = rt.currentCwd;
  if (!sessionManager || !cwd) {
    rt.chatPanel?.setSessionsSidebarState({
      status: "error",
      sessions: [],
      currentSessionId: rt.currentSessionId ?? undefined,
      error: nativeText("iCode is not connected to a workspace yet.", "iCode 尚未连接到工作区。"),
    });
    return;
  }

  rt.sessionsSidebarRefreshPending = true;
  rt.chatPanel?.setSessionsSidebarState({
    status: "loading",
    sessions: [],
    currentSessionId: rt.currentSessionId ?? undefined,
  });
  let refreshAgain = false;
  try {
    const sessions = withLocalSessionNames(await sessionManager.listSessions(cwd), rt.extensionContext?.workspaceState);
    if (rt.currentCwd !== cwd || rt.sessionManager !== sessionManager) {
      refreshAgain = true;
      return;
    }
    rt.chatPanel?.setSessionsSidebarState({
      status: "ready",
      sessions,
      currentSessionId: rt.currentSessionId ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Sessions sidebar refresh failed: ${message}`);
    rt.chatPanel?.setSessionsSidebarState({
      status: "error",
      sessions: [],
      currentSessionId: rt.currentSessionId ?? undefined,
      error: message,
    });
  } finally {
    rt.sessionsSidebarRefreshPending = false;
    if (refreshAgain) void refreshSessionsSidebar();
  }
}

export async function handleSessionsSidebarRequest(
  action: "refresh" | "resumeSession" | "deleteSession",
  payload?: { id: string; cwd?: string },
): Promise<void> {
  if (action === "refresh") {
    await refreshSessionsSidebar();
    return;
  }
  if (!payload?.id) return;

  if (action === "resumeSession") {
    await loadSavedSession({ sessionId: payload.id, cwd: payload.cwd || "" });
  } else {
    await _deleteSessionById(payload.id, payload.cwd);
  }
  await refreshSessionsSidebar();
}

export async function selectNextSessionAgent(name: string): Promise<boolean> {
  if (agentSelectionTarget(Boolean(rt.currentSessionId)) !== "next-session") return false;
  await persistPreferredAgent(name);
  rt.activeAgentName = name;
  rt.chatPanel?.setState(chatPanelState());
  rt.chatPanel?.appendDebugEvent("NextSessionAgentSelected", name);
  return true;
}
