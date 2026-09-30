import { openTrajectory, disposeTrajectory } from "./ui/trajectory";
import { openWorkflows, disposeWorkflowRuns } from "./ui/workflows";
import { withLocalSessionNames, setLocalSessionName } from "./session/localNames";
import { initialWorkspacePath } from "./common/workspace";
import type { ChatConnectionState } from "./chat/webview/connectionPresentation";
import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { managedRuntime, pruneStaleRuntimes } from "./runtime/install";
import { flushCompanionWrites } from "./companion/store";
import { resolveRuntime } from "./runtime/resolve";
import { ProcessManager } from "./process/manager";
import { SessionManager } from "./session/manager";
import { ChatPanel } from "./chat/panel";
import { BUILTIN_AGENT_NAMES } from "./chat/agentProfileEdit";
import { ApprovalHandler } from "./approval/modal";
import { AskUserHandler } from "./askUser/modal";
import { nextMessageId } from "./chat/provider";
import { SessionTreeProvider } from "./views/sessionTree";
import { logInfo, logWarn, logError, recordDebugEvent } from "./common/logging";
import { resolveUiTheme } from "./common/uiTheme";
import { expandHome, findSessionJsonPath, sessionShortId } from "./common/sessionFiles";
import { chatPanelState } from "./common/chatPanelState";
import { rt, bindRuntime, currentRuntime, withRuntime, focusRuntime, createSessionRuntime, findSessionRuntime, sessionRuntimes } from "./state/runtime";
import { applyPreferredDefaultsToNewSession, initializePreferredDefaults, refreshPreferredDefaultsFromSettings, rememberPreferredAgent } from "./session/defaults";
import { handleSessionUpdate } from "./handlers/session";
import { AcpRequestError } from "./acp/protocol";
import { resetRenderState, refreshRuntimeSnapshot } from "./handlers/notifications";
import { PACKAGE_VERSION, PROTOCOL_VERSION } from "./common/version";
import type { SessionInfo } from "./acp/types";
import { localized as nativeText } from "./common/hostI18n";
import { relativeSessionTime, sessionMetaLine } from "./common/sessionFormat";
import { abortPausedSubAgent, changeWorkspace, copySupportBundle, createModelProfile, deleteAgentFromDialog, deleteAgentProfile, deleteModelFromDialog, deleteModelProfile, handleInlineDialogAction, handleSessionsSidebarRequest, loadSavedSession, openAgentDialog, openModelDialog, openToolDiff, openWorkspaceFile, pickLanguageFromList, pickThemeFromList, refreshAgentDialog, refreshModelDialog, reloadChrysSettings, retryPausedSubAgent, rollbackSession, runDoctor, saveAgentFromDialog, saveModelFromDialog, setActiveAgentFromDialog, setActiveModelFromDialog, setApprovalMode, setConfigOption, setModelProfile, showAgentProfiles, showDiagnosticsReport, showModelProfiles, showRuntimeDetails, showSessionDiff, showStructuredHistory, switchActiveAgent, testMcpServer } from "./ui/dialogs";
import { showManagementPanel } from "./ui/management";
import { handleCancel, handleSendMessage, handleSleepSkip, handleWebviewCommand } from "./handlers/actions";
import { renameSessionLocally } from "./ui/sessionName";
import { showPromptHistory } from "./ui/promptHistory";
import { installManagedRuntime } from "./ui/runtimeInstall";

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
const MAX_RESTART_ATTEMPTS = 3;
const ACP_INITIALIZE_TIMEOUT_MS = 45_000;
export const BUILTIN_AGENTS: readonly string[] = BUILTIN_AGENT_NAMES;
const SELECT_AGENT_UNAVAILABLE_EVENT = "SelectAgentUnavailable";

function recordLifecycleEvent(kind: string, detail = ""): void {
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

async function handleAcpInitializeFailure(err: unknown): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  const recentOutput = rt.processManager?.recentOutput.trim() ?? "";
  const recentOutputTail = recentOutput.split("\n").slice(-20).join("\n");
  const msg = nativeText(
    `iCode ACP initialization failed: ${detail}. If this is a bundled platform VSIX, the bundled iCode runtime may be stuck during first-run setup. Open iCode logs for startup output, or try a iCode binary from PATH / chrys.binary.path while this platform package is being fixed.`,
    `iCode ACP 初始化失败：${detail}。如果你正在使用内置运行时的平台 VSIX，内置 iCode 可能卡在首次运行初始化。请打开 iCode 日志查看启动输出，或先使用 PATH / chrys.binary.path 中的 iCode，直到这个平台包修复。`,
  );
  logError(recentOutputTail ? `${msg}\nRecent iCode startup output:\n${recentOutputTail}` : msg);
  recordLifecycleEvent("AcpInitializeFailed", detail);
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "error",
    text: recentOutputTail
      ? `${msg}\n\nRecent iCode startup output:\n${recentOutputTail}`
      : msg,
    timestamp: Date.now(),
  });
  rt.chatPanel?.setState(chatPanelState());
  vscode.window.showErrorMessage(`iCode: ${msg}`);
  try {
    await rt.processManager?.stop();
  } catch (stopErr) {
    const stopMessage = stopErr instanceof Error ? stopErr.message : String(stopErr);
    logWarn(`Failed to stop iCode after initialize failure: ${stopMessage}`);
  }
}

function scheduleRestart(context: vscode.ExtensionContext): void {
  if (rt.shuttingDown || !rt.currentBinaryPath || !rt.currentCwd) return;
  if (rt.restartAttempts >= MAX_RESTART_ATTEMPTS) {
    vscode.window.showErrorMessage(nativeText(
      "The iCode backend crashed repeatedly. Reload the window to retry.",
      "iCode 后端连续崩溃。请重新加载窗口后重试。",
    ));
    return;
  }

  rt.restartAttempts += 1;
  const delay = Math.min(1000 * rt.restartAttempts, 5000);
  logWarn(`Scheduling ACP restart attempt ${rt.restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${delay}ms`);
  rt.clearRestartTimer();
  rt.restartTimer = setTimeout(() => {
    rt.restartTimer = null;
    if (rt.shuttingDown || !rt.processManager || rt.processManager.state !== "stopped" || !rt.currentBinaryPath || !rt.currentCwd) return;
    void connectBackend(context, rt.currentBinaryPath).then((connected) => {
      if (!connected) scheduleRestart(context);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logError(`ACP restart failed: ${message}`);
      console.error(`[iCode] ACP restart failed: ${message}`);
      scheduleRestart(context);
    });
  }, delay);
}

export function buildAcpArgs(config: vscode.WorkspaceConfiguration, cwd: string): string[] {
  const agent = rt.preferredAgentName || rt.activeAgentName || config.get<string>("agent.default") || process.env.CHRYS_DEFAULT_AGENT || "Code";
  const configuredApproval = rt.preferredApprovalMode || config.get<string>("approval.mode") || "auto";
  const approval = configuredApproval === "skip" ? "bypass" : configuredApproval;
  return ["acp", "--agent", agent, "--approval", approval, "--workdir", cwd];
}

// ──────────────────────────────────────────────
// Binary resolution
// ──────────────────────────────────────────────

async function resolveChrysBinary(config: vscode.WorkspaceConfiguration, context: vscode.ExtensionContext): Promise<string | null> {
  logInfo("Resolving iCode binary: configured -> bundled -> managed -> PATH");
  const resolved = await resolveRuntime({
    configured: async () => {
      const configured = config.get<string>("binary.path")?.trim();
      if (!configured) return null;
      const found = await executablePath(expandHome(configured));
      if (!found) logWarn(`Configured iCode executable is unavailable: ${configured}`);
      return found;
    },
    bundled: () => bundledChrysBinary(context),
    managed: () => context.globalStorageUri ? managedRuntime(context.globalStorageUri.fsPath) : Promise.resolve(null),
    path: async () => await findExecutableOnPath(process.platform === "win32" ? "icode.exe" : "icode")
      ?? await findExecutableOnPath(platformBinaryName()),
  });
  if (resolved) logInfo(`Using ${resolved.source} iCode runtime: ${resolved.path}`);
  return resolved?.path ?? null;
}

function platformBinaryName(): string {
  return process.platform === "win32" ? "chrys.exe" : "chrys";
}

async function executablePath(candidate: string): Promise<string | null> {
  try {
    const accessMode = process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK;
    if (!(await fs.promises.stat(candidate)).isFile()) return null;
    await fs.promises.access(candidate, accessMode);
    return candidate;
  } catch {
    return null;
  }
}

async function findExecutableOnPath(binaryName: string): Promise<string | null> {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    logInfo("PATH is empty or unavailable in the extension host environment.");
    return null;
  }
  logInfo(`Searching PATH for ${binaryName}: ${pathValue}`);
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, binaryName);
    logInfo(`Checking PATH iCode candidate: ${candidate}`);
    const resolved = await executablePath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

async function bundledChrysBinary(context: vscode.ExtensionContext): Promise<string | null> {
  const runtimeCandidate = path.join(context.extensionUri.fsPath, "runtime", platformRuntimeLauncherName());
  logInfo(`Checking bundled iCode runtime candidate: ${runtimeCandidate}`);
  const runtimePath = await executablePath(runtimeCandidate);
  if (runtimePath) return runtimePath;

  const binaryCandidate = path.join(context.extensionUri.fsPath, "bin", platformBinaryName());
  logInfo(`Checking bundled iCode binary candidate: ${binaryCandidate}`);
  return executablePath(binaryCandidate);
}

function platformRuntimeLauncherName(): string {
  return process.platform === "win32" ? "chrys.cmd" : "chrys";
}

async function resolveInitialCwd(): Promise<string | null> {
  const activeFile = vscode.window.activeTextEditor?.document.uri;
  const activeWorkspace = activeFile?.scheme === "file" ? vscode.workspace.getWorkspaceFolder(activeFile) : undefined;
  const resolved = initialWorkspacePath({
    activeWorkspacePath: activeWorkspace?.uri.fsPath,
    firstWorkspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    activeFilePath: activeFile?.scheme === "file" ? activeFile.fsPath : undefined,
  });
  if (resolved) return resolved;

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(os.homedir()),
    title: nativeText("Select iCode workspace directory", "选择 iCode 工作区目录"),
  });
  return selected?.[0]?.fsPath ?? null;
}

// ──────────────────────────────────────────────
// On connected — initialize and restore session
// ──────────────────────────────────────────────

async function onConnected(
  context: vscode.ExtensionContext,
  client: import("./acp/client").ChrysAcpClient,
): Promise<void> {
  // Initialize ACP
  const initResp = await withTimeout(
    client.initialize(PROTOCOL_VERSION, {
      name: "icode-vscode-plugin",
      version: PACKAGE_VERSION,
    }),
    ACP_INITIALIZE_TIMEOUT_MS,
    nativeText(
      `initialize did not respond within ${ACP_INITIALIZE_TIMEOUT_MS / 1000}s`,
      `initialize 在 ${ACP_INITIALIZE_TIMEOUT_MS / 1000} 秒内没有响应`,
    ),
  );
  rt.restartAttempts = 0;
  rt.currentPromptCapabilities = initResp.agentCapabilities?.promptCapabilities ?? null;
  rt.supportsAdditionalDirectories = Boolean(initResp.agentCapabilities?.sessionCapabilities?.additionalDirectories);
  rt.chrysCliVersion = initResp.agentInfo?.version || "";
  logInfo(`ACP initialized with protocol ${initResp.protocolVersion}${rt.chrysCliVersion ? `, iCode CLI ${rt.chrysCliVersion}` : ""}`);

  // Check protocol version
  if (initResp.protocolVersion !== PROTOCOL_VERSION) {
    vscode.window.showWarningMessage(
      `iCode protocol version ${initResp.protocolVersion} differs from expected ${PROTOCOL_VERSION}. Some features may not work.`,
    );
  }

  // Create session manager
  rt.sessionManager = new SessionManager(client);

  ensureSessionTree(context);

  // Create approval handler
  rt.approvalHandler = new ApprovalHandler(() => ensureChatPanel(context, true), () => rt.currentCwd);
  client.onRequestPermission(bindRuntime((req) => rt.approvalHandler.requestPermission(req)));

  // Create ask_user handler
  rt.askUserHandler = new AskUserHandler(() => ensureChatPanel(context, true));
  client.onRequestInput(bindRuntime((req) => rt.askUserHandler.requestInput(req)));

  // Wire up notification handlers from modules
  const {
    handleRuntimeUpdate,
    handleChrysError,
    handleChrysWarning,
    handleSessionRestored,
    handleContextCompressed,
    handleContextPressure,
    handleToolCompacted,
    handleRichUsageUpdate,
    handleAgentLoadEvent,
    handleApprovalReviewed,
    handleProfileSwitched,
    handleWorkspaceUpdated,
    handleUserInjectResult,
    handleRollbackResult,
    handleSubAgentEvent,
    handleCompactionNotification,
  } = await import("./handlers/notifications");

  client.onRuntimeUpdate(bindRuntime((update) => handleRuntimeUpdate(update)));
  client.onError(bindRuntime((update) => handleChrysError(update)));
  client.onWarning(bindRuntime((update) => handleChrysWarning(update)));
  client.onSessionRestored(bindRuntime((update) => handleSessionRestored(update)));
  client.onContextCompressed(bindRuntime((update) => handleContextCompressed(update)));
  client.onContextPressure(bindRuntime((update) => handleContextPressure(update)));
  client.onToolCompacted(bindRuntime((update) => handleToolCompacted(update)));
  client.onUsageUpdate(bindRuntime((update) => handleRichUsageUpdate(update)));
  client.onAgentLoad(bindRuntime((eventName, update) => handleAgentLoadEvent(eventName, update)));
  client.onApprovalReviewed(bindRuntime((update) => handleApprovalReviewed(update)));
  client.onProfileSwitched(bindRuntime((update) => handleProfileSwitched(update)));
  client.onWorkspaceUpdated(bindRuntime((update) => handleWorkspaceUpdated(update)));
  client.onUserInjectResult(bindRuntime((update) => handleUserInjectResult(update)));
  client.onRollbackResult(bindRuntime((update) => handleRollbackResult(update)));
  client.onCompaction(bindRuntime((eventName, update) => handleCompactionNotification(eventName, update)));
  client.onApprovalModeUpdate(bindRuntime((update) => {
    if (update.mode) rt.currentApprovalMode = update.mode;
    rt.chatPanel?.setState(chatPanelState());
  }));
  client.onSubAgent(bindRuntime((eventName, update) => handleSubAgentEvent(eventName, update)));

  // Keep closed tabs closed when reconnecting in the background.

  // Listen for session updates
  client.onSessionUpdate(bindRuntime((sessionId, update) => {
    handleSessionUpdate(sessionId, update);
  }));

  rt.sessionInitialization = initializeActiveSession(context);
  try {
    await rt.sessionInitialization;
  } finally {
    rt.sessionInitialization = null;
  }

}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function initializeActiveSession(context: vscode.ExtensionContext): Promise<void> {
  if (!rt.sessionManager) return;
  // Try to restore session from workspace state
  const savedState = rt.restoreSession ?? (!rt.skipRestoreOnce ? context.workspaceState.get<{ sessionId: string; cwd: string; additionalDirectories?: string[] }>("chrys.session") : undefined);
  if (savedState && savedState.cwd === rt.currentCwd) {
    try {
      recordLifecycleEvent("SessionRestoreStarted", `${sessionShortId(savedState.sessionId)} @ ${savedState.cwd}`);
      rt.currentSessionId = savedState.sessionId;
      resetRenderState(true);
      rt.transcript.clearMessages();
      await rt.sessionManager.loadSession(rt.currentCwd!, savedState.sessionId, savedState.additionalDirectories);
      if(savedState.additionalDirectories) rt.additionalDirectories = [...savedState.additionalDirectories];
      rt.currentSessionId = savedState.sessionId;
      if (savedState.additionalDirectories === undefined && rt.processManager.client) {
        try {
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await rt.processManager.client!.listSessions(rt.currentCwd!, cursor);
          const entry = page.sessions.find(s => s.sessionId === savedState.sessionId);
          if(entry) { rt.additionalDirectories = entry.additionalDirectories ?? []; break; }
          cursor = page.nextCursor;
          if(cursor && seen.has(cursor))break;
          if(cursor)seen.add(cursor);
        } while(cursor);
        } catch(error) { rt.additionalDirectories=undefined; logWarn(`Could not read saved workspace roots: ${String(error)}`); }
      }
      rt.persistCurrentSession();
      await refreshRuntimeSnapshot();
      rt.chatPanel?.setState(chatPanelState());
      recordLifecycleEvent("SessionRestoreSucceeded", sessionShortId(savedState.sessionId));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordLifecycleEvent("SessionRestoreFailed", `${sessionShortId(savedState.sessionId)}: ${message}`);
      // Only a backend rejection means the session cannot be restored. A timeout or a
      // backend exit keeps the pointer so the next connection can retry the restore.
      if (error instanceof AcpRequestError) rt.clearPersistedSession();
      rt.currentSessionId = null;
      rt.transcript.appendMessage({
        id: nextMessageId(),
        kind: "separator",
        text: nativeText(
          `Previous iCode session ${sessionShortId(savedState.sessionId)} could not be restored. Start a new session or pick another saved session.`,
          `之前的 iCode 会话 ${sessionShortId(savedState.sessionId)} 无法恢复。可以新建会话，或从会话列表选择其他会话。`,
        ),
        timestamp: Date.now(),
      });
    }
  }
  rt.skipRestoreOnce = false;

  // Keep startup cheap: opening iCode should not create a persisted session.
  // The first prompt or explicit New Session action owns session creation.
  rt.currentSessionId = null;
  rt.chatPanel?.setState(chatPanelState());
  recordLifecycleEvent("SessionStartupIdle", rt.currentCwd ?? "(no workspace)");
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

function ensureSessionTree(context: vscode.ExtensionContext): void {
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

async function showCommandUnavailable(eventName: string, commandName: string, detail: string, message: string): Promise<void> {
  rt.chatPanel?.appendDebugEvent(eventName, detail);
  logWarn(`${commandName} unavailable: ${detail}`);
  const openDoctor = nativeText("Open Doctor", "打开健康检查");
  const selected = await vscode.window.showWarningMessage(message, openDoctor);
  if (selected === openDoctor) {
    await vscode.commands.executeCommand("chrys.doctor");
  }
}

async function selectAgentForNewSession(): Promise<void> {
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

function sessionFromTreeArg(
  sessionIdOrItem: string | { sessionInfo?: SessionInfo },
  sessionCwd?: string,
): SessionInfo | Pick<SessionInfo, "sessionId" | "cwd"> | undefined {
  return typeof sessionIdOrItem === "string"
    ? { sessionId: sessionIdOrItem, cwd: sessionCwd || "" }
    : sessionIdOrItem.sessionInfo;
}

function sessionTreeDebugSummary(session: SessionInfo | Pick<SessionInfo, "sessionId" | "cwd">): string {
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

type SessionQuickPickItem = vscode.QuickPickItem & {
  sessionId: string;
  cwd: string;
};

function sessionQuickPickItem(session: SessionInfo): SessionQuickPickItem {
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

function setConnectionState(state: ChatConnectionState, detail = ""): void {
  const wasPending = isPendingConnectionState(rt.connectionState);
  const willBePending = isPendingConnectionState(state);
  if (!wasPending && willBePending) {
    rt.connectionStartedAt = Date.now();
    rt.connectionDurationMs = null;
  } else if (wasPending && !willBePending) {
    rt.connectionDurationMs = Math.max(0, Date.now() - rt.connectionStartedAt);
    logInfo(`ACP connection entered ${state} after ${rt.connectionDurationMs} ms.`);
    recordLifecycleEvent("AcpConnectionSettled", `${state} in ${rt.connectionDurationMs} ms`);
  }
  rt.connectionState = state;
  rt.connectionDetail = detail;
  rt.chatPanel?.setState(chatPanelState());
}

function isPendingConnectionState(state: ChatConnectionState): boolean {
  return state === "resolving-workspace"
    || state === "resolving-backend"
    || state === "starting"
    || state === "initializing";
}

function registerConfigurationListener(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("chrys")) return;
      for (const owner of sessionRuntimes) withRuntime(owner, () => {
        const changedConfig = vscode.workspace.getConfiguration("chrys");
        if (
          event.affectsConfiguration("chrys.agent.default")
          || event.affectsConfiguration("chrys.model.profile")
          || event.affectsConfiguration("chrys.approval.mode")
        ) {
          refreshPreferredDefaultsFromSettings();
          rt.chatPanel?.appendDebugEvent(
            "DefaultSettingsChanged",
            `agent=${rt.preferredAgentName}; model=${rt.preferredModelProfileId || "(default)"}; approval=${rt.preferredApprovalMode}`,
          );
        }
        rt.currentTheme = resolveUiTheme(changedConfig.get<string>("ui.theme"), process.env.CHRYS_THEME);
        rt.chatPanel?.setState(chatPanelState());
        rt.chatPanel?.appendDebugEvent("SettingsChanged", "chrys");
        if (event.affectsConfiguration("chrys.binary.path")) {
          void reconnectBackend(context);
        }
      });
    }),
  );
}

function clearSessionManager(): void {
  (rt as { sessionManager: SessionManager | undefined }).sessionManager = undefined;
}

/** Settle pending approval/ask-user requests, stop the ACP process and drop its session manager. */
async function teardownBackend(reason: string): Promise<void> {
  rt.approvalHandler?.resolve();
  rt.askUserHandler?.cancelActive(reason);
  if (rt.processManager && rt.processManager.state !== "stopped") await rt.processManager.stop();
  clearSessionManager();
}

async function connectBackend(context: vscode.ExtensionContext, binaryOverride?: string): Promise<boolean> {
  if (rt.connectionInitialization) return rt.connectionInitialization;
  const operation = connectBackendOnce(context, binaryOverride);
  rt.connectionInitialization = operation;
  try {
    return await operation;
  } finally {
    if (rt.connectionInitialization === operation) rt.connectionInitialization = null;
  }
}

export function restartBackendConnection(
  context: vscode.ExtensionContext,
  binaryOverride?: string,
): Promise<boolean> {
  return withRuntime(currentRuntime(), () => restartRuntimeConnection(context, binaryOverride));
}

async function restartRuntimeConnection(context: vscode.ExtensionContext, binaryOverride?: string): Promise<boolean> {
  if (rt.connectionInitialization) await rt.connectionInitialization;
  rt.clearRestartTimer();
  await teardownBackend("backend-restarting");
  return connectBackend(context, binaryOverride);
}

async function connectBackendOnce(context: vscode.ExtensionContext, binaryOverride?: string): Promise<boolean> {
  if (rt.shuttingDown || !rt.currentCwd) return false;
  const config = vscode.workspace.getConfiguration("chrys");
  setConnectionState("resolving-backend", rt.currentCwd);
  const binaryPath = binaryOverride ?? await resolveChrysBinary(config, context);
  if (!binaryPath) {
    setConnectionState("error", nativeText("iCode backend not found", "未找到 iCode 后端"));
    return false;
  }
  if (
    rt.currentBinaryPath === binaryPath
    && rt.processManager?.state === "running"
    && rt.sessionManager
  ) {
    setConnectionState("ready", rt.currentCwd);
    return true;
  }

  if (!rt.processManager) {
    rt.processManager = createProcessManager(context);
  } else if (rt.processManager.state !== "stopped") {
    await rt.processManager.stop();
  }

  rt.currentBinaryPath = binaryPath;
  setConnectionState("starting", rt.currentCwd);
  try {
    if (rt.shuttingDown) return false;
    const client = await rt.processManager.start(binaryPath, buildAcpArgs(config, rt.currentCwd), rt.currentCwd);
    setConnectionState("initializing", rt.currentCwd);
    await onConnected(context, client);
    setConnectionState("ready", rt.currentCwd);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`ACP initialization failed: ${message}`);
    recordLifecycleEvent("AcpInitializationFailed", message);
    setConnectionState("error", message);
    await handleAcpInitializeFailure(error);
    if (rt.processManager.state === "running") await rt.processManager.stop();
    clearSessionManager();
    return false;
  }
}

function createProcessManager(context: vscode.ExtensionContext): ProcessManager {
  const manager = new ProcessManager();
  manager.on("started", bindRuntime((binaryPath, args) => {
    logInfo(`Starting ACP process: ${String(binaryPath)} ${Array.isArray(args) ? args.join(" ") : ""}`);
    recordLifecycleEvent("AcpProcessStarted", `${String(binaryPath)} ${Array.isArray(args) ? args.join(" ") : ""}`.trim());
  }));
  manager.on("stdout", bindRuntime((line) => { logInfo(`[stdout] ${String(line)}`); }));
  manager.on("stderr", bindRuntime((text) => {
    logInfo(`[stderr] ${String(text).trimEnd()}`);
  }));
  manager.on("connected", bindRuntime(() => {
    logInfo("ACP transport connected");
    recordLifecycleEvent("AcpProcessConnected", rt.currentCwd ?? "(no workspace)");
  }));
  manager.on("disconnected", bindRuntime((reason, detail) => {
    logWarn(`ACP process disconnected: ${String(detail ?? reason)}`);
    recordLifecycleEvent("AcpProcessDisconnected", String(reason));
    console.warn(`[iCode] ACP process disconnected: ${String(reason)}`);
    rt.approvalHandler?.resolve();
    rt.askUserHandler?.cancelActive("backend-disconnected");
    rt.persistCurrentSession();
    clearSessionManager();
    setConnectionState("disconnected", String(reason));
    rt.chatPanel?.showReconnectNotice();
    // An exit during initialize is reported by connectBackendOnce; restarting here too
    // would race its error handling. Restart retries chain through scheduleRestart itself.
    if (!rt.connectionInitialization) scheduleRestart(context);
  }));
  return manager;
}

async function reconnectBackend(context: vscode.ExtensionContext): Promise<void> {
  if (rt.connectionInitialization) await rt.connectionInitialization;
  rt.clearRestartTimer();
  const configured = vscode.workspace.getConfiguration("chrys").get<string>("binary.path")?.trim() ?? "";
  if (configured && rt.currentBinaryPath === expandHome(configured) && rt.processManager?.state === "running" && rt.sessionManager) {
    return;
  }
  await teardownBackend("backend-restarting");
  rt.currentBinaryPath = null;
  if (!(await connectBackend(context))) await offerBackendSetup(context);
}

async function installBackendRuntime(context: vscode.ExtensionContext): Promise<void> {
  const installed = await installManagedRuntime(context);
  if (!installed) return;
  // Installing never interrupts a conversation, approvals or another tab's runtime.
  if (rt.currentSessionId || (rt.sessionManager && rt.sessionManager.state !== "idle")) {
    await vscode.window.showInformationMessage(nativeText(
      `iCode installed at ${installed}. Existing sessions keep their runtime; the next backend connection uses the runtime selection order.`,
      `iCode 已安装到 ${installed}。现有会话继续使用原运行时，下次连接后端时按运行时优先级选择。`,
    ));
    return;
  }
  const config = vscode.workspace.getConfiguration("chrys");
  if (config.get<string>("binary.path")?.trim() || await bundledChrysBinary(context)) {
    await vscode.window.showInformationMessage(nativeText(
      `iCode is installed at ${installed}. Your configured or bundled runtime remains the first choice. Set chrys.binary.path to this path if you want to switch.`,
      `iCode 已安装到 ${installed}。当前仍优先使用显式配置或内置运行时；如需切换，可将 chrys.binary.path 设置为此路径。`,
    ));
    return;
  }
  if (rt.currentCwd) await restartBackendConnection(context);
  else await vscode.window.showInformationMessage(nativeText(
    "iCode is installed. Open a workspace to start chatting.",
    "iCode 已安装，打开工作区即可开始聊天。",
  ));
}

async function offerBackendSetup(context: vscode.ExtensionContext): Promise<void> {
  const message = nativeText(
    "Download and install iCode, select an existing executable, or use a full platform VSIX with an included runtime.",
    "可下载并安装 iCode、选择已有可执行文件，或使用内置运行时的完整版 VSIX。",
  );
  const locate = nativeText("Select installed iCode", "选择已有 iCode");
  const install = nativeText("Download and install iCode", "下载并安装 iCode");
  const openSettings = nativeText("Open Settings", "打开设置");
  logError(message);
  rt.transcript.appendMessage({ id: nextMessageId(), kind: "error", text: message, timestamp: Date.now() });
  rt.chatPanel?.setState(chatPanelState());
  const choice = await vscode.window.showErrorMessage(message, install, locate, openSettings);
  if (choice === install) { await installBackendRuntime(context); return; }
  if (choice === openSettings) {
    await vscode.commands.executeCommand("workbench.action.openSettings", "chrys.binary.path");
    return;
  }
  if (choice !== locate) return;

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title: nativeText("Select the iCode executable", "选择 iCode 可执行文件"),
    filters: process.platform === "win32" ? { "chrys.exe": ["exe"] } : undefined,
  });
  const selectedPath = selected?.[0]?.fsPath;
  if (!selectedPath) return;
  const resolved = await executablePath(selectedPath);
  if (!resolved) {
    await vscode.window.showErrorMessage(nativeText(
      `The selected file is not executable: ${selectedPath}`,
      `所选文件不可执行：${selectedPath}`,
    ));
    return;
  }
  if (await connectBackend(context, resolved)) {
    await vscode.workspace.getConfiguration("chrys").update("binary.path", resolved, vscode.ConfigurationTarget.Global);
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "system",
      text: nativeText(`iCode connected to the iCode backend at ${resolved}.`, `iCode 已连接到 iCode 后端：${resolved}。`),
      timestamp: Date.now(),
    });
  }
}
