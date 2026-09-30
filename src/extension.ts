import { openTrajectory, disposeTrajectory } from "./ui/trajectory";
import { openWorkflows, disposeWorkflowRuns } from "./ui/workflows";
import { withLocalSessionNames } from "./session/localNames";
import * as vscode from "vscode";
import { pruneStaleRuntimes } from "./runtime/install";
import { flushCompanionWrites } from "./companion/store";
import { ChatPanel } from "./chat/panel";
import { BUILTIN_AGENT_NAMES } from "./chat/agentProfileEdit";
import { nextMessageId } from "./chat/provider";
import { logInfo, logWarn, logError, recordDebugEvent } from "./common/logging";
import { resolveUiTheme } from "./common/uiTheme";
import { findSessionJsonPath, sessionShortId } from "./common/sessionFiles";
import { chatPanelState } from "./common/chatPanelState";
import { rt, currentRuntime, withRuntime, focusRuntime, createSessionRuntime, findSessionRuntime, sessionRuntimes } from "./state/runtime";
import { applyPreferredDefaultsToNewSession, initializePreferredDefaults } from "./session/defaults";
import type { SessionInfo } from "./acp/types";
import { localized as nativeText } from "./common/hostI18n";
import { abortPausedSubAgent, changeWorkspace, copySupportBundle, createModelProfile, deleteAgentFromDialog, deleteAgentProfile, deleteModelFromDialog, deleteModelProfile, handleInlineDialogAction, handleSessionsSidebarRequest, loadSavedSession, openAgentDialog, openModelDialog, openToolDiff, openWorkspaceFile, pickLanguageFromList, pickThemeFromList, refreshAgentDialog, refreshModelDialog, reloadChrysSettings, retryPausedSubAgent, rollbackSession, runDoctor, saveAgentFromDialog, saveModelFromDialog, setActiveAgentFromDialog, setActiveModelFromDialog, setApprovalMode, setConfigOption, setModelProfile, showAgentProfiles, showDiagnosticsReport, showModelProfiles, showRuntimeDetails, showSessionDiff, showStructuredHistory, switchActiveAgent, testMcpServer } from "./ui/dialogs";
import { showManagementPanel } from "./ui/management";
import { handleCancel, handleSendMessage, handleSleepSkip, handleWebviewCommand } from "./handlers/actions";
import { renameSessionLocally } from "./ui/sessionName";
import { showPromptHistory } from "./ui/promptHistory";
import { connectBackend, installBackendRuntime, offerBackendSetup, registerConfigurationListener, resolveInitialCwd, restartBackendConnection, setConnectionState } from "./backendConnection";
import { deleteSessionById, ensureSessionTree, selectAgentForNewSession, sessionFromTreeArg, sessionQuickPickItem, sessionTreeDebugSummary } from "./sessionCommands";
export { buildAcpArgs, restartBackendConnection } from "./backendConnection";
export { deleteSessionById } from "./sessionCommands";

export interface ChrysSessionStateEvent {
  sessionState: 'idle' | 'running' | 'cancelling';
  sessionId: string;
}

export interface ChrysApi {
  readonly restartBackend: () => Promise<boolean>;
  readonly onDidChangeSessionState: vscode.Event<ChrysSessionStateEvent>;
}

// Re-export helpers (maintain API compatibility)
export { formatCount, objectValue, stringField, numberField, boolField } from "./common/utils";
export { formatToolOutput, diffFromSnapshot, contentText } from "./handlers/session";
export { languageFromPath } from "./ui/dialogs";
export { PACKAGE_VERSION, PROTOCOL_VERSION } from "./common/version";
export const BUILTIN_AGENTS: readonly string[] = BUILTIN_AGENT_NAMES;
export const SELECT_AGENT_UNAVAILABLE_EVENT = "SelectAgentUnavailable";

export function recordLifecycleEvent(kind: string, detail = ""): void {
  if (rt.chatPanel) {
    rt.chatPanel?.appendDebugEvent(kind, detail);
  } else {
    recordDebugEvent(kind, detail);
  }
}


// ──────────────────────────────────────────────
// ChrysDiffProvider
// ──────────────────────────────────────────────

class ChrysDiffProvider implements vscode.TextDocumentContentProvider {
  readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return [...sessionRuntimes].map(owner => owner.diffDocuments.get(uri.path)).find(value => value !== undefined) ?? "";
  }
}

// ──────────────────────────────────────────────
// Activate
// ──────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): Promise<ChrysApi> {
  return withRuntime(currentRuntime(), () => activateRuntime(context));
}

async function activateRuntime(context: vscode.ExtensionContext): Promise<ChrysApi> {
  rt.extensionContext = context;
  rt.outputChannel = vscode.window.createOutputChannel("iCode");
  context.subscriptions.push(rt.outputChannel);
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("chrys-diff", new ChrysDiffProvider()));
  logInfo("Activating icode-vscode-plugin");
  const config = vscode.workspace.getConfiguration("chrys");
  initializePreferredDefaults();
  rt.activeAgentName = rt.preferredAgentName;
  rt.currentApprovalMode = rt.preferredApprovalMode;
  rt.currentTheme = resolveUiTheme(config.get<string>("ui.theme"), process.env.CHRYS_THEME);
  rt.connectionState = "resolving-workspace";
  rt.connectionDetail = nativeText("Reading the active VS Code workspace", "正在读取当前 VS Code 工作区");
  rt.connectionStartedAt = Date.now();
  rt.connectionDurationMs = null;
  registerCommands(context);
  registerConfigurationListener(context);
  if (context.globalStorageUri) {
    void pruneStaleRuntimes(context.globalStorageUri.fsPath).then((removed) => {
      if (removed.length) logInfo(`Removed superseded managed runtimes: ${removed.join(", ")}`);
    }, (error) => logWarn(`Managed runtime cleanup failed: ${String(error)}`));
  }
  ensureChatPanel(context);
  ensureSessionTree(context);
  rt.chatPanel?.reveal();
  rt.chatPanel?.setState(chatPanelState());

  rt.currentCwd = await resolveInitialCwd();
  if (!rt.currentCwd) {
    setConnectionState("error", nativeText("No working directory selected", "尚未选择工作目录"));
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "error",
      text: nativeText("Select a iCode workspace directory to start.", "请选择一个 iCode 工作区目录以开始。"),
      timestamp: Date.now(),
    });
    return {
      onDidChangeSessionState: rt.onDidChangeSessionState,
      restartBackend: () => restartBackendConnection(context, rt.currentBinaryPath ?? undefined),
    };
  }
  const saved = context.workspaceState.get<{ sessionId: string; cwd: string; additionalDirectories?: string[] }>("chrys.session");
  if (saved?.cwd === rt.currentCwd) rt.restoreSession = saved;
  setConnectionState("resolving-backend", rt.currentCwd);

  // Let VS Code finish activation while the external runtime warms up. The
  // webview stays visibly staged and its input remains locked until ACP is ready.
  void connectBackend(context).then(async (connected) => {
    if (!connected) await offerBackendSetup(context);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Background ACP startup failed: ${message}`);
    setConnectionState("error", message);
  });

  return {
    onDidChangeSessionState: rt.onDidChangeSessionState,
    restartBackend: () => restartBackendConnection(context, rt.currentBinaryPath ?? undefined),
  };
}


export function ensureChatPanel(context: vscode.ExtensionContext, preserveFocus = false): ChatPanel {
  if (!rt.chatPanel) {
    rt.cancelIdleRelease();
    const panel = rt.chatPanel = new ChatPanel(context, preserveFocus);

    const logFailure = (label: string) => (error: unknown) => {
      logError(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    };
    panel.onSendMessage((text, blocks) => {
      handleSendMessage(text, blocks).catch(logFailure("Send message"));
    });
    panel.onCancel(() => {
      handleCancel().catch(logFailure("Cancel"));
    });
    panel.onCommand((command, arg) => {
      handleWebviewCommand(command, arg).catch(logFailure(`Webview command (${command})`));
    });
    panel.onSessionsSidebarRequest((action, payload) => {
      handleSessionsSidebarRequest(action, payload).catch(logFailure("Sessions sidebar request"));
    });
    panel.onSleepSkip((toolCallId) => {
      handleSleepSkip(toolCallId).catch(logFailure("Sleep skip"));
    });
    panel.onInlineDialogAction((action, payload) => {
      handleInlineDialogAction(action, payload).catch(logFailure("Inline dialog action"));
    });
    panel.onToolDiff((toolCallId: string) => {
      openToolDiff(toolCallId).catch(logFailure("Open tool diff"));
    });
    panel.onModelDialogSave((model) => {
      saveModelFromDialog(model).catch(logFailure("Save model"));
    });
    panel.onModelDialogDelete((id) => {
      deleteModelFromDialog(id).catch(logFailure("Delete model"));
    });
    panel.onModelDialogSetActive((id) => {
      setActiveModelFromDialog(id).catch(logFailure("Set active model"));
    });
    panel.onApprovalModeSelect((mode) => {
      setApprovalMode(mode).catch(logFailure("Approval mode select"));
    });
    panel.onApprovalDialogDecision((optionId, reason) => {
      rt.approvalHandler?.resolve(optionId, reason);
    });
    panel.onAskUserDialogResponse((requestId, answers, cancelled, source) => {
      rt.askUserHandler?.resolve(requestId, answers, cancelled, source);
    });
    panel.onOpenFile((filePath, line) => {
      openWorkspaceFile(filePath, line).catch(logFailure("Open file"));
    });
    panel.onModelDialogRefresh(() => {
      refreshModelDialog().catch(logFailure("Refresh model dialog"));
    });
    panel.onAgentDialogSave((agent) => {
      saveAgentFromDialog(agent).catch(logFailure("Save agent"));
    });
    panel.onAgentDialogDelete((name) => {
      deleteAgentFromDialog(name).catch(logFailure("Delete agent"));
    });
    panel.onAgentDialogSetActive((name) => {
      setActiveAgentFromDialog(name).catch(logFailure("Set active agent"));
    });
    panel.onAgentDialogRefresh(() => {
      refreshAgentDialog().catch(logFailure("Refresh agent dialog"));
    });
  }
  rt.chatPanel.setState(chatPanelState());
  return rt.chatPanel;
}

// ──────────────────────────────────────────────
// Commands
// ──────────────────────────────────────────────

/** One live runtime per session, even if its editor tab is temporarily closed. */
export async function openSessionTab(session?: Pick<SessionInfo, "sessionId" | "cwd">, agentName?: string): Promise<boolean> {
  const context = rt.extensionContext;
  const cwd = session?.cwd || rt.currentCwd;
  if (!context || !cwd) {
    recordLifecycleEvent("NewSessionUnavailable", "workspace missing");
    vscode.window.showWarningMessage(nativeText("iCode cannot start a new session without a workspace.", "请先选择工作区，再新建 iCode 会话。"));
    return false;
  }
  const existing = session && findSessionRuntime(session.sessionId);
  if (existing) {
    return withRuntime(existing, () => {
      focusRuntime(existing);
      ensureChatPanel(context).reveal();
      rt.chatPanel?.setState(chatPanelState());
      return true;
    });
  }
  // Reserve the identity synchronously, before warm-up, to deduplicate double-clicks.
  const owner = createSessionRuntime(cwd);
  if (agentName) owner.activeAgentName = owner.preferredAgentName = agentName;
  if (session) { owner.restoreSession = { sessionId: session.sessionId, cwd }; owner.additionalDirectories = undefined; }
  focusRuntime(owner);
  const opening = withRuntime(owner, async () => {
    recordLifecycleEvent("SessionNewStarted", session?.sessionId ?? cwd);
    ensureChatPanel(context).reveal();
    if (!(await connectBackend(context, owner.currentBinaryPath ?? undefined))) return false;
    if (session) return owner.currentSessionId === session.sessionId;
    try {
      owner.currentSessionId = await owner.sessionManager.newSession(cwd, owner.additionalDirectories);
      recordLifecycleEvent("SessionNewSucceeded", owner.currentSessionId);
      await applyPreferredDefaultsToNewSession();
      owner.persistCurrentSession();
      owner.sessionTreeProvider?.refresh();
      owner.chatPanel?.setState(chatPanelState());
      return true;
    } catch (error) {
      logError(`New session failed: ${String(error)}`);
      setConnectionState("error", String(error));
      return false;
    }
  });
  owner.tabInitialization = opening;
  try { return await opening; }
  finally { owner.tabInitialization = null; }
}

function registerSessionCommand(command: string, handler: (...args: any[]) => any): vscode.Disposable {
  return vscode.commands.registerCommand(command, (...args: any[]) => {
    const owner = currentRuntime();
    return withRuntime(owner, () => handler(...args));
  });
}

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push({ dispose: disposeWorkflowRuns }, { dispose: disposeTrajectory });
  context.subscriptions.push(registerSessionCommand("chrys.installRuntime", () => installBackendRuntime(context)));
  context.subscriptions.push(registerSessionCommand("chrys.trajectory", async () => {
    const client = rt.processManager?.client;
    try { await openTrajectory(context, rt.currentBinaryPath, rt.currentCwd, rt.currentSessionId, client ? client.listSessions.bind(client) : undefined); }
    catch (error) { await vscode.window.showErrorMessage(`iCode Trajectory: ${error instanceof Error ? error.message : String(error)}`); }
  }));
  context.subscriptions.push(registerSessionCommand("chrys.workflows", async () => {
    try { await openWorkflows(context, rt.currentBinaryPath, rt.currentCwd); }
    catch (error) { await vscode.window.showErrorMessage(`iCode Workflow: ${error instanceof Error ? error.message : String(error)}`); }
  }));
  context.subscriptions.push(registerSessionCommand("chrys.focusChat", () => {
    if (!rt.extensionContext) return;
    ensureChatPanel(rt.extensionContext).reveal();
    rt.chatPanel?.setState(chatPanelState());
  }));

  context.subscriptions.push(registerSessionCommand("chrys.renameSession", async (
    item?: { sessionInfo?: SessionInfo },
  ) => {
    await renameSessionLocally(item?.sessionInfo?.sessionId ?? rt.currentSessionId, undefined, item?.sessionInfo?.title);
  }));

  context.subscriptions.push(registerSessionCommand("chrys.showPromptHistory", async () => {
    ensureChatPanel(context).reveal();
    await showPromptHistory();
  }));

  context.subscriptions.push(registerSessionCommand("chrys.newSession", () => openSessionTab()));

  context.subscriptions.push(registerSessionCommand("chrys.selectAgent", async () => {
    await selectAgentForNewSession();
  }));

  context.subscriptions.push(registerSessionCommand("chrys.listSessions", async () => {
    if (!rt.sessionManager) {
      rt.chatPanel?.appendDebugEvent("ListSessionsUnavailable", "session manager missing");
      const openDoctor = nativeText("Open Doctor", "打开健康检查");
      const selected = await vscode.window.showWarningMessage(
        nativeText("iCode sessions are unavailable until the ACP runtime is connected.", "需要连接 iCode ACP 运行时后才能查看会话。"),
        openDoctor,
      );
      if (selected === openDoctor) {
        await vscode.commands.executeCommand("chrys.doctor");
      }
      return;
    }
    if (!rt.currentCwd) {
      rt.chatPanel?.appendDebugEvent("ListSessionsUnavailable", "workspace missing");
      vscode.window.showWarningMessage(nativeText("Select a iCode workspace before listing sessions.", "请先选择 iCode 工作区，再查看会话。"));
      return;
    }
    let sessions: SessionInfo[];
    try {
      sessions = withLocalSessionNames(await rt.sessionManager.listSessions(rt.currentCwd), rt.extensionContext?.workspaceState);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`List sessions command failed: ${message}`);
      rt.chatPanel?.appendDebugEvent("ListSessionsFailed", message);
      const openDoctor = nativeText("Open Doctor", "打开健康检查");
      const selected = await vscode.window.showWarningMessage(
        nativeText(`Unable to list iCode sessions: ${message}`, `无法列出 iCode 会话：${message}`),
        openDoctor,
      );
      if (selected === openDoctor) {
        await vscode.commands.executeCommand("chrys.doctor");
      }
      return;
    }
    if (!sessions.length) {
      rt.chatPanel?.appendDebugEvent("ListSessions", "0 sessions");
      vscode.window.showInformationMessage(nativeText("No saved iCode sessions for this workspace.", "这个工作区暂无已保存的 iCode 会话。"));
      return;
    }
    const items = sessions.map((s) => sessionQuickPickItem(s));

    rt.chatPanel?.appendDebugEvent("ListSessions", `${sessions.length} sessions`);
    const selected = await vscode.window.showQuickPick(items, {
      title: nativeText("iCode Sessions", "iCode 会话"),
      placeHolder: nativeText("Select a session to resume", "选择要恢复的会话"),
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!selected) return;
    await loadSavedSession({ sessionId: selected.sessionId, cwd: selected.cwd });
  }));

  context.subscriptions.push(registerSessionCommand("chrys.sendPrompt", () => {
    rt.chatPanel?.reveal();
  }));

  context.subscriptions.push(registerSessionCommand("chrys.fillComposer", (args?: { text?: string; agent?: string }) => {
    if (!rt.extensionContext) return;
    if (args?.agent && BUILTIN_AGENTS.includes(args.agent)) {
      rt.activeAgentName = args.agent;
    }
    ensureChatPanel(rt.extensionContext).reveal();
    if (args?.text) {
      rt.chatPanel?.setComposer(args.text);
    }
    rt.chatPanel?.setState(chatPanelState());
  }));

  context.subscriptions.push(registerSessionCommand("chrys.sendText", async (args?: { text?: string; agent?: string }) => {
    if (!rt.extensionContext || !args?.text) return;
    if (args?.agent && BUILTIN_AGENTS.includes(args.agent)) {
      rt.activeAgentName = args.agent;
    }
    ensureChatPanel(rt.extensionContext).reveal();
    await handleSendMessage(args.text, [{ type: "text", text: args.text }]);
    rt.chatPanel?.setState(chatPanelState());
  }));

  context.subscriptions.push(registerSessionCommand("chrys.showLogs", () => {
    rt.outputChannel?.show();
  }));

  // Commands that open a dialog or picker without arguments.
  const dialogCommands: Array<[string, () => Promise<unknown>]> = [
    ["chrys.runtimeDetails", showRuntimeDetails],
    ["chrys.showDiff", showSessionDiff],
    ["chrys.rollback", rollbackSession],
    ["chrys.retrySubAgent", retryPausedSubAgent],
    ["chrys.abortSubAgent", abortPausedSubAgent],
    ["chrys.setApprovalMode", setApprovalMode],
    ["chrys.switchAgent", switchActiveAgent],
    ["chrys.showAgentProfiles", showAgentProfiles],
    ["chrys.showModelProfiles", showModelProfiles],
    ["chrys.reloadSettings", reloadChrysSettings],
    ["chrys.changeWorkspace", changeWorkspace],
    ["chrys.showStructuredHistory", showStructuredHistory],
    ["chrys.setModelProfile", setModelProfile],
    ["chrys.createModelProfile", createModelProfile],
    ["chrys.deleteModelProfile", deleteModelProfile],
    ["chrys.deleteAgentProfile", deleteAgentProfile],
    ["chrys.testMcpServer", testMcpServer],
    ["chrys.setConfigOption", setConfigOption],
    ["chrys.manage", showManagementPanel],
    ["chrys.manageModels", openModelDialog],
    ["chrys.manageAgents", openAgentDialog],
    ["chrys.pickTheme", pickThemeFromList],
    ["chrys.pickLanguage", pickLanguageFromList],
    ["chrys.diagnostics", showDiagnosticsReport],
    ["chrys.copySupportBundle", copySupportBundle],
    ["chrys.doctor", runDoctor],
  ];
  for (const [command, run] of dialogCommands) {
    context.subscriptions.push(registerSessionCommand(command, () => run()));
  }

  context.subscriptions.push(registerSessionCommand("chrys.showNotifications", () => {
    if (!rt.extensionContext) return;
    ensureChatPanel(rt.extensionContext).showNotifications();
  }));

  context.subscriptions.push(registerSessionCommand("chrys.loadSessionFromTree", async (sessionId: string, sessionCwd?: string) => {
    if (!sessionId) return;
    await loadSavedSession({ sessionId, cwd: sessionCwd || "" });
  }));

  context.subscriptions.push(registerSessionCommand("chrys.openSessionJsonFromTree", async (
    sessionIdOrItem: string | { sessionInfo?: SessionInfo },
    sessionCwd?: string,
  ) => {
    const session = sessionFromTreeArg(sessionIdOrItem, sessionCwd);
    if (!session?.sessionId) return;
    const sourcePath = findSessionJsonPath(session.sessionId);
    if (!sourcePath) {
      vscode.window.showWarningMessage(nativeText("Local session.json was not found for this session.", "未找到这个会话的本地 session.json。"));
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
    await vscode.window.showTextDocument(doc, { preview: false });
    rt.chatPanel?.appendDebugEvent("SessionJsonOpened", sourcePath);
  }));

  context.subscriptions.push(registerSessionCommand("chrys.copySessionJsonPathFromTree", async (
    sessionIdOrItem: string | { sessionInfo?: SessionInfo },
    sessionCwd?: string,
  ) => {
    const session = sessionFromTreeArg(sessionIdOrItem, sessionCwd);
    if (!session?.sessionId) return;
    const sourcePath = findSessionJsonPath(session.sessionId);
    if (!sourcePath) {
      vscode.window.showWarningMessage(nativeText("Local session.json was not found for this session.", "未找到这个会话的本地 session.json。"));
      return;
    }
    await vscode.env.clipboard.writeText(sourcePath);
    vscode.window.showInformationMessage(nativeText("Session JSON path copied.", "会话 JSON 路径已复制。"));
  }));

  context.subscriptions.push(registerSessionCommand("chrys.copySessionIdFromTree", async (
    sessionIdOrItem: string | { sessionInfo?: SessionInfo },
    sessionCwd?: string,
  ) => {
    const session = sessionFromTreeArg(sessionIdOrItem, sessionCwd);
    if (!session?.sessionId) return;
    await vscode.env.clipboard.writeText(session.sessionId);
    vscode.window.showInformationMessage(nativeText("Session ID copied.", "会话 ID 已复制。"));
  }));

  context.subscriptions.push(registerSessionCommand("chrys.copySessionSummaryFromTree", async (
    sessionIdOrItem: string | { sessionInfo?: SessionInfo },
    sessionCwd?: string,
  ) => {
    const session = sessionFromTreeArg(sessionIdOrItem, sessionCwd);
    if (!session?.sessionId) return;
    await vscode.env.clipboard.writeText(sessionTreeDebugSummary(session));
    vscode.window.showInformationMessage(nativeText("Session summary copied.", "会话摘要已复制。"));
    rt.chatPanel?.appendDebugEvent("SessionSummaryCopied", sessionShortId(session.sessionId));
  }));

  context.subscriptions.push(registerSessionCommand("chrys.deleteSessionFromTree", async (
    sessionIdOrItem: string | { sessionInfo?: SessionInfo },
    sessionCwd?: string,
  ) => {
    const session = sessionFromTreeArg(sessionIdOrItem, sessionCwd);
    if (!session?.sessionId) return;
    await deleteSessionById(session.sessionId, session.cwd);
  }));

  context.subscriptions.push(registerSessionCommand("chrys.refreshSessionTree", () => {
    rt.sessionTreeProvider?.refresh();
  }));
}
// ──────────────────────────────────────────────
// Deactivate
// ──────────────────────────────────────────────

export async function deactivate(): Promise<void> {
  flushCompanionWrites();
  await Promise.all([...sessionRuntimes].map(owner => withRuntime(owner, async () => {
    owner.shuttingDown = true;
    owner.clearRestartTimer();
    owner.cancelIdleRelease();
    owner.persistCurrentSession();
    owner.approvalHandler?.resolve();
    owner.askUserHandler?.cancelActive("extension-shutdown");
    owner.chatPanel?.dispose();
    owner.managementPanel?.dispose();
    owner.closeInlineDialog();
    await owner.dropSession();
    await owner.processManager?.stop().catch(() => {});
    owner.workspaceTerminal?.dispose();
  })));
}
