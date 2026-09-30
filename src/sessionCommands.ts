// Session tree, agent selection and saved-session command helpers.
import { setLocalSessionName } from "./session/localNames";
import * as vscode from "vscode";
import { SessionTreeProvider } from "./views/sessionTree";
import { logInfo, logWarn, logError } from "./common/logging";
import { findSessionJsonPath, sessionShortId } from "./common/sessionFiles";
import { chatPanelState } from "./common/chatPanelState";
import { rt, currentRuntime, withRuntime, findSessionRuntime } from "./state/runtime";
import { rememberPreferredAgent } from "./session/defaults";
import { resetRenderState } from "./handlers/notifications";
import type { SessionInfo } from "./acp/types";
import { localized as nativeText } from "./common/hostI18n";
import { relativeSessionTime, sessionMetaLine } from "./common/sessionFormat";
import { restartBackendConnection } from "./backendConnection";
import { BUILTIN_AGENTS, SELECT_AGENT_UNAVAILABLE_EVENT, openSessionTab } from "./extension";

export function ensureSessionTree(context: vscode.ExtensionContext): void {
  if (!rt.sessionTreeProvider) {
    rt.sessionTreeProvider = new SessionTreeProvider(
      () => rt.sessionManager,
      () => rt.currentCwd,
      () => rt.currentSessionId,
    );
    const treeView = vscode.window.createTreeView("chrys-sessions", {
      treeDataProvider: rt.sessionTreeProvider,
      showCollapseAll: true,
    });
    context.subscriptions.push(treeView);
  } else {
    rt.sessionTreeProvider.refresh();
  }
}

export async function showCommandUnavailable(eventName: string, commandName: string, detail: string, message: string): Promise<void> {
  rt.chatPanel?.appendDebugEvent(eventName, detail);
  logWarn(`${commandName} unavailable: ${detail}`);
  const openDoctor = nativeText("Open Doctor", "打开健康检查");
  const selected = await vscode.window.showWarningMessage(message, openDoctor);
  if (selected === openDoctor) {
    await vscode.commands.executeCommand("chrys.doctor");
  }
}

export async function selectAgentForNewSession(): Promise<void> {
  if (!rt.currentBinaryPath) {
    await showCommandUnavailable(
      SELECT_AGENT_UNAVAILABLE_EVENT,
      "SelectAgent",
      "binary missing",
      nativeText("iCode cannot switch agents until the iCode binary is resolved.", "需要先解析 iCode 可执行文件，才能切换智能体。"),
    );
    return;
  }
  if (!rt.currentCwd) {
    await showCommandUnavailable(
      SELECT_AGENT_UNAVAILABLE_EVENT,
      "SelectAgent",
      "workspace missing",
      nativeText("Select a iCode workspace before switching agents.", "请先选择 iCode 工作区，再切换智能体。"),
    );
    return;
  }
  if (!rt.currentSessionId && rt.sessionManager?.state && rt.sessionManager.state !== "idle") {
    const message = nativeText(
      "iCode cannot switch agents for a new session while the current task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能为新会话切换 iCode 智能体。请先中断或等待任务完成。",
    );
    vscode.window.showInformationMessage(message);
    rt.chatPanel?.appendDebugEvent("SelectAgentBlocked", rt.sessionManager.state);
    return;
  }
  if (!rt.processManager) {
    await showCommandUnavailable(
      SELECT_AGENT_UNAVAILABLE_EVENT,
      "SelectAgent",
      "process manager missing",
      nativeText("iCode cannot switch agents until the ACP process manager is ready.", "需要 ACP 进程管理器就绪后才能切换智能体。"),
    );
    return;
  }
  const selected = await vscode.window.showQuickPick(
    BUILTIN_AGENTS.map((agent) => ({
      label: agent,
      description: agent === rt.activeAgentName ? nativeText("current", "当前") : "",
    })),
    { placeHolder: nativeText("Select the iCode agent for a new session", "为新会话选择 iCode 智能体") },
  );
  if (!selected || selected.label === rt.activeAgentName) return;

  const switchAgentLabel = nativeText("Switch Agent", "切换智能体");
  const confirmed = await vscode.window.showWarningMessage(
    nativeText(
      `Switch to ${selected.label}? This starts a new iCode ACP process and creates a new session.`,
      `切换到 ${selected.label}？这会启动新的 iCode ACP 进程并创建新会话。`,
    ),
    { modal: true },
    switchAgentLabel,
  );
  if (confirmed !== switchAgentLabel) return;

  if (rt.currentSessionId) {
    await openSessionTab(undefined, selected.label);
    return;
  }

  rt.activeAgentName = selected.label;
  rememberPreferredAgent(selected.label);
  rt.skipRestoreOnce = true;
  rt.currentSessionId = null;
  resetRenderState(true);
  rt.transcript.clearMessages();
  await rt.dropSession();
  rt.clearPersistedSession();
  if (rt.extensionContext) await restartBackendConnection(rt.extensionContext, rt.currentBinaryPath);
}

export async function deleteSessionById(sessionId: string, cwd?: string): Promise<void> {
  const owner = findSessionRuntime(sessionId);
  if (owner && owner !== currentRuntime()) return withRuntime(owner, () => deleteSessionById(sessionId, cwd));
  const sessionCwd = cwd || rt.currentCwd;
  if (!rt.sessionManager || !sessionCwd || !sessionId) return;
  const deletingCurrent = rt.currentSessionId === sessionId;
  if (deletingCurrent && rt.sessionManager.state !== "idle") {
    const message = nativeText(
      "iCode cannot delete the current session while a task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能删除当前 iCode 会话。请先中断或等待任务完成。",
    );
    vscode.window.showWarningMessage(message);
    rt.chatPanel?.appendDebugEvent("SessionDeleteBlocked", rt.sessionManager.state);
    return;
  }
  const deleteLabel = nativeText("Delete", "删除");
  const confirmed = await vscode.window.showWarningMessage(
    nativeText("Delete this iCode session? This cannot be undone.", "删除这个 iCode 会话？此操作无法撤销。"),
    { modal: true },
    deleteLabel,
  );
  if (confirmed !== deleteLabel) return;
  // Opening the saved session while confirmation was pending changes its owner.
  // Leave it intact so this stale dialog cannot delete a newly opened live tab.
  if (findSessionRuntime(sessionId) !== owner) return;
  // The confirmation is asynchronous; the target may have started another turn.
  if (deletingCurrent && (rt.currentSessionId !== sessionId || rt.sessionManager.state !== "idle")) return;

  try {
    await rt.sessionManager.deleteSession(sessionCwd, sessionId);
    if (rt.extensionContext?.workspaceState) await setLocalSessionName(rt.extensionContext.workspaceState, sessionId, "").catch(error => logWarn(`Local session name cleanup failed: ${String(error)}`));
    logInfo(`Deleted session ${sessionId}`);
    rt.chatPanel?.appendDebugEvent("SessionDeleted", sessionId);
    if (deletingCurrent) {
      rt.currentSessionId = null;
      resetRenderState(true);
      rt.transcript.clearMessages();
      rt.currentCwd = sessionCwd;
      rt.clearPersistedSession();
      rt.chatPanel?.setState(chatPanelState());
    }
    rt.sessionTreeProvider?.refresh();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`Delete session failed: ${message}`);
    vscode.window.showErrorMessage(nativeText(`Failed to delete iCode session: ${message}`, `删除 iCode 会话失败：${message}`));
  }
}

export function sessionFromTreeArg(
  sessionIdOrItem: string | { sessionInfo?: SessionInfo },
  sessionCwd?: string,
): SessionInfo | Pick<SessionInfo, "sessionId" | "cwd"> | undefined {
  return typeof sessionIdOrItem === "string"
    ? { sessionId: sessionIdOrItem, cwd: sessionCwd || "" }
    : sessionIdOrItem.sessionInfo;
}

export function sessionTreeDebugSummary(session: SessionInfo | Pick<SessionInfo, "sessionId" | "cwd">): string {
  const fullSession = "updatedAt" in session ? session : undefined;
  const sessionJsonPath = findSessionJsonPath(session.sessionId);
  const meta = fullSession?._meta ?? {};
  const lines = [
    "# iCode Session Summary",
    "",
    `- Title: ${fullSession?.title || "(untitled)"}`,
    `- Session ID: ${session.sessionId}`,
    `- Short ID: ${sessionShortId(session.sessionId) || session.sessionId}`,
    `- Current in VSIX: ${session.sessionId === rt.currentSessionId ? "yes" : "no"}`,
    `- Workspace: ${session.cwd || "(unknown)"}`,
    `- Updated: ${fullSession?.updatedAt ? relativeSessionTime(fullSession.updatedAt) : "(unknown)"}`,
    `- local session.json: ${sessionJsonPath ?? "not found on this host"}`,
  ];
  const metaLine = fullSession ? sessionMetaLine(fullSession) : "";
  if (metaLine) lines.push(`- Profile/model/messages: ${metaLine}`);
  if (Object.keys(meta).length) {
    lines.push("", "## Raw Session Metadata", "", "```json", JSON.stringify(meta, null, 2), "```");
  }
  return lines.join("\n");
}

export type SessionQuickPickItem = vscode.QuickPickItem & {
  sessionId: string;
  cwd: string;
};

export function sessionQuickPickItem(session: SessionInfo): SessionQuickPickItem {
  const isCurrent = session.sessionId === rt.currentSessionId;
  const shortId = sessionShortId(session.sessionId);
  const title = session.title || shortId || session.sessionId;
  const metaLine = sessionMetaLine(session);
  const sessionJsonPath = findSessionJsonPath(session.sessionId);
  return {
    label: `${isCurrent ? "$(circle-filled) " : ""}${title}`,
    description: [
      isCurrent ? nativeText("current", "当前") : "",
      shortId ? nativeText(`id ${shortId}`, `ID ${shortId}`) : "",
      metaLine,
    ].filter(Boolean).join("  "),
    detail: [
      nativeText(
        `Updated: ${session.updatedAt ? relativeSessionTime(session.updatedAt) : "unknown"}`,
        `更新时间：${session.updatedAt ? relativeSessionTime(session.updatedAt) : "未知"}`,
      ),
      nativeText(`Workspace: ${session.cwd}`, `工作区：${session.cwd}`),
      nativeText(
        `local session.json: ${sessionJsonPath ?? "not found on this host"}`,
        `本地 session.json：${sessionJsonPath ?? "当前主机未找到"}`,
      ),
    ].join("\n"),
    sessionId: session.sessionId,
    cwd: session.cwd,
  };
}
