// ACP backend lifecycle: binary resolution, connection, restart and session restore.
import { initialWorkspacePath } from "./common/workspace";
import type { ChatConnectionState } from "./chat/webview/connectionPresentation";
import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { managedRuntime } from "./runtime/install";
import { resolveRuntime } from "./runtime/resolve";
import { ProcessManager } from "./process/manager";
import { SessionManager } from "./session/manager";
import { ApprovalHandler } from "./approval/modal";
import { AskUserHandler } from "./askUser/modal";
import { nextMessageId } from "./chat/provider";
import { logInfo, logWarn, logError } from "./common/logging";
import { resolveUiTheme } from "./common/uiTheme";
import { expandHome, sessionShortId } from "./common/sessionFiles";
import { chatPanelState } from "./common/chatPanelState";
import { rt, bindRuntime, currentRuntime, withRuntime, sessionRuntimes } from "./state/runtime";
import { refreshPreferredDefaultsFromSettings } from "./session/defaults";
import { handleSessionUpdate } from "./handlers/session";
import { AcpRequestError } from "./acp/protocol";
import { resetRenderState, refreshRuntimeSnapshot } from "./handlers/notifications";
import { PACKAGE_VERSION, PROTOCOL_VERSION } from "./common/version";
import { localized as nativeText } from "./common/hostI18n";
import { installManagedRuntime } from "./ui/runtimeInstall";
import { ensureSessionTree } from "./sessionCommands";
import { ensureChatPanel, recordLifecycleEvent } from "./extension";

const MAX_RESTART_ATTEMPTS = 3;
const ACP_INITIALIZE_TIMEOUT_MS = 45_000;

export async function handleAcpInitializeFailure(err: unknown): Promise<void> {
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

export function scheduleRestart(context: vscode.ExtensionContext): void {
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

export async function resolveChrysBinary(config: vscode.WorkspaceConfiguration, context: vscode.ExtensionContext): Promise<string | null> {
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

export function platformBinaryName(): string {
  return process.platform === "win32" ? "chrys.exe" : "chrys";
}

export async function executablePath(candidate: string): Promise<string | null> {
  try {
    const accessMode = process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK;
    if (!(await fs.promises.stat(candidate)).isFile()) return null;
    await fs.promises.access(candidate, accessMode);
    return candidate;
  } catch {
    return null;
  }
}

export async function findExecutableOnPath(binaryName: string): Promise<string | null> {
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

export async function bundledChrysBinary(context: vscode.ExtensionContext): Promise<string | null> {
  const runtimeCandidate = path.join(context.extensionUri.fsPath, "runtime", platformRuntimeLauncherName());
  logInfo(`Checking bundled iCode runtime candidate: ${runtimeCandidate}`);
  const runtimePath = await executablePath(runtimeCandidate);
  if (runtimePath) return runtimePath;

  const binaryCandidate = path.join(context.extensionUri.fsPath, "bin", platformBinaryName());
  logInfo(`Checking bundled iCode binary candidate: ${binaryCandidate}`);
  return executablePath(binaryCandidate);
}

export function platformRuntimeLauncherName(): string {
  return process.platform === "win32" ? "chrys.cmd" : "chrys";
}

export async function resolveInitialCwd(): Promise<string | null> {
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

export async function onConnected(
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
    void handleSessionUpdate(sessionId, update);
  }));

  rt.sessionInitialization = initializeActiveSession(context);
  try {
    await rt.sessionInitialization;
  } finally {
    rt.sessionInitialization = null;
  }

}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function initializeActiveSession(context: vscode.ExtensionContext): Promise<void> {
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

export function setConnectionState(state: ChatConnectionState, detail = ""): void {
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

export function isPendingConnectionState(state: ChatConnectionState): boolean {
  return state === "resolving-workspace"
    || state === "resolving-backend"
    || state === "starting"
    || state === "initializing";
}

export function registerConfigurationListener(context: vscode.ExtensionContext): void {
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

export function clearSessionManager(): void {
  (rt as { sessionManager: SessionManager | undefined }).sessionManager = undefined;
}

/** Settle pending approval/ask-user requests, stop the ACP process and drop its session manager. */
export async function teardownBackend(reason: string): Promise<void> {
  rt.approvalHandler?.resolve();
  rt.askUserHandler?.cancelActive(reason);
  if (rt.processManager && rt.processManager.state !== "stopped") await rt.processManager.stop();
  clearSessionManager();
}

export async function connectBackend(context: vscode.ExtensionContext, binaryOverride?: string): Promise<boolean> {
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

export async function restartRuntimeConnection(context: vscode.ExtensionContext, binaryOverride?: string): Promise<boolean> {
  if (rt.connectionInitialization) await rt.connectionInitialization;
  rt.clearRestartTimer();
  await teardownBackend("backend-restarting");
  return connectBackend(context, binaryOverride);
}

export async function connectBackendOnce(context: vscode.ExtensionContext, binaryOverride?: string): Promise<boolean> {
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

export function createProcessManager(context: vscode.ExtensionContext): ProcessManager {
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

export async function reconnectBackend(context: vscode.ExtensionContext): Promise<void> {
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

export async function installBackendRuntime(context: vscode.ExtensionContext): Promise<void> {
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

export async function offerBackendSetup(context: vscode.ExtensionContext): Promise<void> {
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
