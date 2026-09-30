import { restartBackendConnection } from "../../extension";
import * as vscode from "vscode";
import { rt, type ToolSnapshot } from "../../state/runtime";
import { formatCount } from "../../common/utils";
import { runtimeModelName, countRuntimeTools } from "../../common/runtimeUtils";
import { toolRendererCoverage } from "../../common/toolRendering";
import { resolveUiLanguage } from "../../common/i18n";
import { isSupportedUiTheme } from "../../common/uiTheme";
import { PROTOCOL_VERSION, buildAcpArgs } from "../../extension";
import { localized as nativeText } from "../../common/hostI18n";
import { ExtensionInstallState, activeBlockingPromptDetail, chrysCliVersionLabel, currentSessionJsonPath, diagnosticsAcpStartupIssueCount, diagnosticsExtensionInstallState, diagnosticsFrontendErrorCount, extensionInstallLine, isAcpStartupOutputIssue, localizedCurrentSessionJsonPath, localizedExtensionInstallDetail, redactDiagnosticsValue, redactSensitiveDiagnosticsText, sessionTreeConsistencyDetail, workspaceTerminalDetail, workspaceTerminalStateLabel } from "./common";
import { openLogsDialog } from "./runtimeDialog";
import { openModelDialog } from "./profiles";
import { changeWorkspace } from "./settings";

// ──────────────────────────────────────────────
// Runtime details (standalone command)
// ──────────────────────────────────────────────

export async function showRuntimeDetails(): Promise<void> {
  const config = vscode.workspace.getConfiguration("chrys");
  const currentBinaryPath = rt.currentBinaryPath ?? nativeText("(unresolved)", "(未解析)");
  const emptyValue = nativeText("(none)", "(无)");
  const notStartedValue = nativeText("(not started)", "(未启动)");
  const unknownValue = nativeText("(unknown)", "(未知)");
  const defaultValue = nativeText("(default)", "(默认)");
  const noWorkspaceValue = nativeText("(no workspace)", "(无工作区)");
  const content = [
    nativeText("# iCode Runtime Details", "# iCode 运行时详情"),
    "",
    `- ${nativeText("iCode CLI version", "iCode CLI 版本")}: ${chrysCliVersionLabel(true)}`,
    `- ${nativeText("Protocol version", "协议版本")}: ${PROTOCOL_VERSION}`,
    `- ${nativeText("Agent", "智能体")}: ${rt.currentRuntime?.agentProfile || rt.activeAgentName || config.get<string>("agent.default") || process.env.CHRYS_DEFAULT_AGENT || "Code"}`,
    `- ${nativeText("Model profile", "模型配置")}: ${rt.currentRuntime?.modelProfileId || config.get<string>("model.profile") || process.env.CHRYS_MODEL_PROFILE || defaultValue}`,
    `- ${nativeText("Model", "模型")}: ${runtimeModelName(rt.currentRuntime) || unknownValue}`,
    `- ${nativeText("Max context", "最大上下文")}: ${rt.currentRuntime?.maxContextTokens ? formatCount(rt.currentRuntime.maxContextTokens) : unknownValue}`,
    `- ${nativeText("Approval mode", "审批模式")}: ${rt.currentApprovalMode}`,
    `- ${nativeText("Workspace", "工作区")}: ${rt.currentCwd ?? emptyValue}`,
    `- ${nativeText("Session", "会话")}: ${rt.currentSessionId ?? emptyValue}`,
    `- local session.json: ${localizedCurrentSessionJsonPath()}`,
    `- ${nativeText("Session state", "会话状态")}: ${rt.sessionManager?.state ?? notStartedValue}`,
    `- ${nativeText("Process state", "进程状态")}: ${rt.processManager?.state ?? notStartedValue}`,
    `- ${nativeText("Binary", "二进制")}: ${currentBinaryPath}`,
    `- ${nativeText("Terminal", "终端")}: ${workspaceTerminalDetail(true)}`,
    `- ${nativeText("Theme", "主题")}: ${localizedThemeResolutionLine(config)}`,
    `- ${nativeText("Usage", "用量")}: ${rt.currentUsageText || emptyValue}`,
    `- ${nativeText("Restart attempts", "重启次数")}: ${rt.restartAttempts}`,
    "",
    nativeText("## ACP Command", "## ACP 命令"),
    "",
    "```text",
    rt.currentCwd ? `${currentBinaryPath} ${buildAcpArgs(config, rt.currentCwd).join(" ")}` : noWorkspaceValue,
    "```",
    "",
    nativeText("## Recent Tool Calls", "## 最近工具调用"),
    "",
    ...recentToolLinesLocal(true),
    "",
    nativeText("## Approval Judge", "## 审批判断"),
    "",
    ...approvalJudgeLines(true, 20),
    "",
    nativeText("## Runtime Snapshot", "## 运行时快照"),
    "",
    "```json",
    JSON.stringify(redactDiagnosticsValue(rt.currentRuntime ?? {}), null, 2),
    "```",
  ].join("\n");
  const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: true });
}

export async function showDiagnosticsReport(): Promise<void> {
  const content = buildDiagnosticsReportContent();
  const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: false });
}

export async function copySupportBundle(): Promise<void> {
  const content = buildDiagnosticsReportContent();
  await vscode.env.clipboard.writeText(content);
  rt.chatPanel?.appendDebugEvent("SupportBundleCopied", `${content.length} chars`);
  vscode.window.showInformationMessage(nativeText("iCode support bundle copied.", "iCode 支持快照已复制。"));
}

export function buildDiagnosticsReportContent(): string {
  const config = vscode.workspace.getConfiguration("chrys");
  const currentBinaryPath = rt.currentBinaryPath ?? "(unresolved)";
  const extensionInstall = diagnosticsExtensionInstallState();
  const acpCommand = rt.currentCwd ? `${currentBinaryPath} ${buildAcpArgs(config, rt.currentCwd).join(" ")}` : "(no workspace)";
  const settings = {
    binaryPath: config.get<string>("binary.path") || "(PATH)",
    agentDefault: config.get<string>("agent.default") || "(default)",
    modelProfile: config.get<string>("model.profile") || "(default)",
    approvalMode: config.get<string>("approval.mode") || "auto",
    uiLanguage: config.get<string>("ui.language") || "auto",
    uiTheme: config.get<string>("ui.theme") || "auto",
  };
  const preferredDefaults = diagnosticsPreferredDefaults();
  const resolvedUiLanguage = resolveUiLanguage(settings.uiLanguage, vscode.env.language);
  const toolSnapshots = [...rt.toolSnapshots.values()].slice(-30).map((tool) => ({
    toolCallId: tool.toolCallId,
    title: tool.title,
    kind: tool.kind,
    status: tool.status,
    hasInput: tool.rawInput !== undefined,
    hasOutput: tool.rawOutput !== undefined,
    metadata: tool.metadata,
  }));
  const rendererCoverage = toolRendererCoverage(toolSnapshots);
  const healthChecks = diagnosticsHealthChecks(currentBinaryPath);
  const mismatchChecklist = diagnosticsMismatchChecklist(settings, currentBinaryPath, preferredDefaults, extensionInstall);
  const frontendHostState = diagnosticsFrontendHostState(settings, currentBinaryPath, preferredDefaults, extensionInstall);
  const sessionJsonPath = currentSessionJsonPath();
  const sessionTreeSnapshot = rt.sessionTreeProvider?.diagnosticsSnapshot() ?? {};
  const sessionLifecycleLines = diagnosticsSessionLifecycleLines();
  const operationGuardLines = diagnosticsOperationGuardLines();
  const inputParityLines = diagnosticsInputParityLines();
  const content = [
    "# iCode VSIX Diagnostics",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Frontend",
    "",
    `- iCode CLI version: ${chrysCliVersionLabel(false)}`,
    `- VS Code version: ${vscode.version}`,
    `- App: ${extensionInstall.appName}`,
    `- URI scheme: ${extensionInstall.uriScheme}`,
    `- Protocol version: ${PROTOCOL_VERSION}`,
    `- UI language setting: ${settings.uiLanguage}`,
    `- UI language resolution: configured=${settings.uiLanguage}; host=${vscode.env.language}; resolved=${resolvedUiLanguage}`,
    `- UI theme setting: ${settings.uiTheme}; active=${rt.currentTheme}`,
    `- UI theme resolution: ${themeResolutionLine(settings.uiTheme)}`,
    `- Extension host: ${vscode.env.remoteName || "local"}`,
    `- Extension install: ${extensionInstallLine(extensionInstall)}`,
    "",
    "## Runtime",
    "",
    `- Agent: ${rt.currentRuntime?.agentProfile || rt.activeAgentName || "Code"}`,
    `- Model profile: ${rt.currentRuntime?.modelProfileId || settings.modelProfile}`,
    `- Model: ${runtimeModelName(rt.currentRuntime) || "(unknown)"}`,
    `- Approval mode: ${rt.currentApprovalMode}`,
    `- Preferred defaults: agent=${preferredDefaults.agent}; model=${preferredDefaults.modelProfile}; approval=${preferredDefaults.approvalMode}`,
    `- Workspace: ${rt.currentCwd ?? "(none)"}`,
    `- Session: ${rt.currentSessionId ?? "(none)"}`,
    `- local session.json: ${sessionJsonPath}`,
    `- Blocking prompt: ${activeBlockingPromptDetail(false)}`,
    `- Session state: ${rt.sessionManager?.state ?? "(not started)"}`,
    `- Process state: ${rt.processManager?.state ?? "(not started)"}`,
    `- Binary: ${currentBinaryPath}`,
    `- Usage: ${rt.currentUsageText || "(none)"}`,
    `- Restart attempts: ${rt.restartAttempts}`,
    "",
    "## ACP Command",
    "",
    "```text",
    acpCommand,
    "```",
    "",
    "## Health Checks",
    "",
    ...healthChecks,
    "",
    "## VSIX / TUI Mismatch Checklist",
    "",
    ...mismatchChecklist,
    "",
    "## Frontend Host State",
    "",
    "```json",
    JSON.stringify(redactDiagnosticsValue(frontendHostState), null, 2),
    "```",
    "",
    "## Session Tree State",
    "",
    "```json",
    JSON.stringify(redactDiagnosticsValue(sessionTreeSnapshot), null, 2),
    "```",
    "",
    "## Frontend Event Summary",
    "",
    ...diagnosticsFrontendEventSummaryLines(200),
    "",
    "## Recent Frontend Events",
    "",
    ...(rt.debugEvents.length ? rt.debugEvents.slice(-80).map((event) => redactSensitiveDiagnosticsText(formatDebugEventLine(event))) : ["(no frontend events captured)"]),
    "",
    "## Session Lifecycle",
    "",
    ...sessionLifecycleLines,
    "",
    "## Approval Judge Reviews",
    "",
    ...approvalJudgeLines(false, 40),
    "",
    "## Operation Guard Events",
    "",
    ...operationGuardLines,
    "",
    "## Input / Shortcut Parity",
    "",
    ...inputParityLines,
    "",
    "## Watch Notes",
    "",
    "- If VSIX and TUI show different agent/model/approval values, compare Runtime, Effective VSIX Settings, ACP Command, and Runtime Snapshot.",
    "- If tool cards differ, compare Recent Tool Snapshots with the webview Debug sidebar Copy Snapshot output.",
    "- If session restore differs, compare Frontend Host State restore flags, current session id, workspace, and session.json.",
    "- If the Sessions tree differs from chat/status state, compare Session Tree State with Runtime and session.json.",
    "- If an action seems ignored, check Operation Guard Events for blocked/deferred actions caused by an active turn.",
    "- If composer behavior differs from TUI, compare Input / Shortcut Parity with Recent Frontend Events.",
    "- If logs are noisy, use /logs for the live frontend log view and /debugcopy for the webview-only state.",
    "- If openUBMC Studio behaves differently from VS Code, compare Extension install to confirm which extension store and copy are loaded.",
    "",
    "## Effective VSIX Settings",
    "",
    "```json",
    JSON.stringify(redactDiagnosticsValue(settings), null, 2),
    "```",
    "",
    "## VSIX Preferred Defaults",
    "",
    "```json",
    JSON.stringify(redactDiagnosticsValue(preferredDefaults), null, 2),
    "```",
    "",
    "## Recent Tool Snapshots",
    "",
    "```json",
    JSON.stringify(redactDiagnosticsValue(toolSnapshots), null, 2),
    "```",
    "",
    "## Tool Renderer Coverage",
    "",
    "```json",
    JSON.stringify(redactDiagnosticsValue(rendererCoverage), null, 2),
    "```",
    "",
    "## Recent Frontend Logs",
    "",
    "```text",
    redactSensitiveDiagnosticsText(rt.logLines.slice(-250).join("\n")) || "(no logs captured)",
    "```",
    "",
    "## Runtime Snapshot",
    "",
    "```json",
    JSON.stringify(redactDiagnosticsValue(rt.currentRuntime ?? {}), null, 2),
    "```",
  ].join("\n");
  return redactSensitiveDiagnosticsText(content);
}

export type DoctorAction =
  | "diagnostics"
  | "copySupportBundle"
  | "copyDiagnosticsSummary"
  | "copyRecentLogs"
  | "logs"
  | "binarySettings"
  | "restartAcp"
  | "workspace"
  | "models"
  | "newSession"
  | "reloadWindow";

export type DoctorItem = vscode.QuickPickItem & {
  action?: DoctorAction;
};

export async function runDoctor(): Promise<void> {
  const items = buildDoctorItems();
  rt.chatPanel?.appendDebugEvent("DoctorOpened", `${items.filter((item) => item.action === undefined).length} checks`);
  const selected = await vscode.window.showQuickPick(items, {
    title: nativeText("iCode Doctor", "iCode 健康检查"),
    placeHolder: nativeText("Review health checks or choose a repair action", "查看健康检查，或选择修复操作"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected?.action) return;

  switch (selected.action) {
    case "diagnostics":
      await showDiagnosticsReport();
      break;
    case "copySupportBundle":
      await copySupportBundle();
      break;
    case "copyDiagnosticsSummary":
      await vscode.env.clipboard.writeText(buildDiagnosticsSummary());
      vscode.window.showInformationMessage(nativeText("iCode diagnostics summary copied.", "iCode 诊断摘要已复制。"));
      break;
    case "copyRecentLogs":
      await copyRecentLogsFromDoctor();
      break;
    case "logs":
      openLogsDialog();
      break;
    case "binarySettings":
      await vscode.commands.executeCommand("workbench.action.openSettings", "chrys.binary.path");
      break;
    case "restartAcp":
      await restartAcpFromDoctor();
      break;
    case "workspace":
      await changeWorkspace();
      break;
    case "models":
      await openModelDialog();
      break;
    case "newSession":
      await vscode.commands.executeCommand("chrys.newSession");
      break;
    case "reloadWindow":
      await reloadWindowFromDoctor();
      break;
  }
}

export function buildDoctorItems(): DoctorItem[] {
  const currentBinaryPath = rt.currentBinaryPath ?? "";
  const extensionInstall = diagnosticsExtensionInstallState();
  const processState = rt.processManager?.state ?? "not started";
  const sessionState = rt.sessionManager?.state ?? "not started";
  const modelName = runtimeModelName(rt.currentRuntime);
  const recentFrontendErrors = diagnosticsFrontendErrorCount();
  const acpStartupIssues = diagnosticsAcpStartupIssueCount();
  const hasActiveSession = Boolean(rt.currentSessionId);
  const sessionTreeConsistency = sessionTreeConsistencyDetail(true);
  const noActiveSessionDetail = nativeText(
    "Idle. The first prompt or New Session action will create a session.",
    "空闲中。首条消息或“新建会话”会创建会话。",
  );
  const checks: DoctorItem[] = [
    doctorCheck(nativeText("Binary", "iCode 可执行文件"), Boolean(currentBinaryPath), currentBinaryPath || nativeText("iCode binary has not been resolved.", "尚未解析到 iCode 可执行文件。")),
    doctorCheck(nativeText("Workspace", "工作区"), Boolean(rt.currentCwd), rt.currentCwd || nativeText("No workspace directory is selected.", "尚未选择工作区目录。")),
    doctorCheck(nativeText("Extension install", "扩展安装"), Boolean(extensionInstall.extensionPath), localizedExtensionInstallDetail(extensionInstall)),
    doctorCheck(nativeText("ACP process", "ACP 进程"), processState === "running", processState),
    doctorCheck(nativeText("Session manager", "会话管理器"), Boolean(rt.sessionManager), sessionState),
    doctorCheck(nativeText("Session readiness", "会话就绪状态"), Boolean(rt.sessionManager), rt.currentSessionId || noActiveSessionDetail),
    doctorCheck(nativeText("Blocking prompt", "阻塞交互"), !rt.activeApprovalRequest && !rt.activeAskUserRequest, activeBlockingPromptDetail(true)),
    doctorCheck(nativeText("Terminal integration", "终端集成"), true, workspaceTerminalDetail(true)),
    doctorCheck(nativeText("Runtime snapshot", "运行时快照"), !hasActiveSession || Boolean(rt.currentRuntime), hasActiveSession ? (rt.currentRuntime ? nativeText("available", "可用") : nativeText("not available", "不可用")) : noActiveSessionDetail),
    doctorCheck(nativeText("Model visible to VSIX", "VSIX 可见模型"), !hasActiveSession || Boolean(modelName), hasActiveSession ? (modelName || nativeText("No active model details are visible.", "当前看不到模型详情。")) : noActiveSessionDetail),
    doctorCheck(nativeText("Approval mode", "审批模式"), Boolean(rt.currentApprovalMode), rt.currentApprovalMode || nativeText("unknown", "未知")),
    doctorCheck(nativeText("Session tree consistency", "会话树一致性"), sessionTreeConsistency.ok, sessionTreeConsistency.detail),
    doctorCheck(nativeText("Recent VSIX frontend errors", "近期 VSIX 前端错误"), recentFrontendErrors === 0, recentFrontendErrors ? nativeText(`${recentFrontendErrors} recent frontend error log(s)`, `${recentFrontendErrors} 条近期前端错误日志`) : nativeText("none", "无")),
    doctorCheck(nativeText("ACP startup warnings/errors", "ACP 启动警告/错误"), acpStartupIssues === 0, acpStartupIssues ? nativeText(`${acpStartupIssues} ACP startup warning/error log(s)`, `${acpStartupIssues} 条 ACP 启动警告/错误日志`) : nativeText("none", "无")),
    doctorCheck(nativeText("Restart attempts", "重启尝试"), rt.restartAttempts === 0, String(rt.restartAttempts)),
  ];

  const actions: DoctorItem[] = [
    { label: nativeText("$(output) Open Diagnostics Report", "$(output) 打开诊断报告"), description: nativeText("Full markdown report", "完整 Markdown 报告"), action: "diagnostics" },
    { label: nativeText("$(clippy) Copy Support Bundle", "$(clippy) 复制支持快照"), description: nativeText("Full VSIX/TUI mismatch report for sharing", "可分享的完整 VSIX/TUI 不一致排查报告"), action: "copySupportBundle" },
    { label: nativeText("$(copy) Copy Diagnostics Summary", "$(copy) 复制诊断摘要"), description: nativeText("Small VSIX/TUI mismatch checklist", "精简 VSIX/TUI 不一致排查清单"), action: "copyDiagnosticsSummary" },
    { label: nativeText("$(copy) Copy Recent Logs", "$(copy) 复制近期日志"), description: nativeText("Redacted VSIX/ACP frontend log buffer", "已脱敏的 VSIX/ACP 前端日志缓存"), action: "copyRecentLogs" },
    { label: nativeText("$(list-flat) Open Logs", "$(list-flat) 打开日志"), description: nativeText("Recent VSIX/ACP frontend logs", "近期 VSIX/ACP 前端日志"), action: "logs" },
  ];
  if (!currentBinaryPath) {
    actions.push({ label: nativeText("$(settings-gear) Set iCode Binary Path", "$(settings-gear) 设置 iCode 可执行文件路径"), description: nativeText("Open chrys.binary.path setting", "打开 chrys.binary.path 设置"), action: "binarySettings" });
  }
  if (rt.currentBinaryPath && rt.currentCwd) {
    actions.push({ label: nativeText("$(debug-restart) Restart ACP Process", "$(debug-restart) 重启 ACP 进程"), description: nativeText("Stop and start the current ACP process", "停止并重新启动当前 ACP 进程"), action: "restartAcp" });
  }
  actions.push({ label: nativeText("$(folder-opened) Change Workspace", "$(folder-opened) 更换工作区"), description: rt.currentCwd || nativeText("Select workspace directory", "选择工作区目录"), action: "workspace" });
  actions.push({ label: nativeText("$(server-process) Manage Models", "$(server-process) 管理模型"), description: nativeText("Fix model/profile configuration", "修复模型/配置问题"), action: "models" });
  if (rt.sessionManager && rt.currentCwd) {
    actions.push({ label: nativeText("$(add) New Session", "$(add) 新建会话"), description: nativeText("Start a clean iCode session", "启动一个干净的 iCode 会话"), action: "newSession" });
  }
  actions.push({ label: nativeText("$(refresh) Reload Window", "$(refresh) 重新加载窗口"), description: nativeText("Restart the VS Code extension host", "重启 VS Code 扩展宿主"), action: "reloadWindow" });

  return [
    { label: nativeText("Actions", "操作"), kind: vscode.QuickPickItemKind.Separator },
    ...actions,
    { label: nativeText("Health Checks", "健康检查"), kind: vscode.QuickPickItemKind.Separator },
    ...checks,
  ];
}

export function doctorCheck(name: string, ok: boolean, detail: string): DoctorItem {
  return {
    label: ok ? `$(pass) ${name}` : `$(warning) ${name}`,
    description: ok ? nativeText("OK", "正常") : nativeText("Needs attention", "需要处理"),
    detail,
  };
}

export async function copyRecentLogsFromDoctor(): Promise<void> {
  const logs = redactSensitiveDiagnosticsText(rt.logLines.slice(-250).join("\n")) || "(no logs captured)";
  await vscode.env.clipboard.writeText(logs);
  rt.chatPanel?.appendDebugEvent("DoctorLogsCopied", `${logs.length} chars`);
  vscode.window.showInformationMessage(nativeText("Recent iCode logs copied.", "近期 iCode 日志已复制。"));
}

export async function restartAcpFromDoctor(): Promise<void> {
  if (rt.sessionManager?.state && rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText(
      "iCode cannot restart the ACP process while the current task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能重启 iCode ACP 进程。请先中断或等待任务完成。",
    ));
    rt.chatPanel?.appendDebugEvent("DoctorRestartAcpBlocked", rt.sessionManager.state);
    return;
  }
  if (!rt.processManager || !rt.currentBinaryPath || !rt.currentCwd) {
    vscode.window.showWarningMessage(nativeText("iCode ACP cannot be restarted until the binary and workspace are resolved.", "需要先解析 iCode 可执行文件并选择工作区，才能重启 ACP。"));
    return;
  }
  if (!rt.extensionContext) return;
  rt.chatPanel?.appendDebugEvent("DoctorRestartAcp", rt.currentCwd);
  if (!(await restartBackendConnection(rt.extensionContext, rt.currentBinaryPath))) return;
  vscode.window.showInformationMessage(nativeText("iCode ACP process restarted.", "iCode ACP 进程已重启。"));
}

export async function reloadWindowFromDoctor(): Promise<void> {
  if (rt.sessionManager?.state && rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText(
      "iCode cannot reload the VS Code window while the current task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能重新加载 VS Code 窗口。请先中断或等待任务完成。",
    ));
    rt.chatPanel?.appendDebugEvent("DoctorReloadWindowBlocked", rt.sessionManager.state);
    return;
  }
  const reloadLabel = nativeText("Reload Window", "重新加载窗口");
  const confirmed = await vscode.window.showWarningMessage(
    nativeText("Reload the VS Code window? This restarts the extension host.", "重新加载 VS Code 窗口？这会重启扩展宿主。"),
    { modal: true },
    reloadLabel,
  );
  if (confirmed !== reloadLabel) return;
  rt.chatPanel?.appendDebugEvent("DoctorReloadWindow", "confirmed");
  await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

export function diagnosticsHealthChecks(currentBinaryPath: string): string[] {
  const frontendErrors = diagnosticsFrontendErrorCount();
  const acpStartupIssues = diagnosticsAcpStartupIssueCount();
  const treeConsistency = sessionTreeConsistencyDetail(false);
  const checks: string[] = [];
  checks.push(currentBinaryPath === "(unresolved)"
    ? "- [ ] iCode binary resolved"
    : `- [x] iCode binary resolved: ${currentBinaryPath}`);
  checks.push(rt.processManager?.state === "running"
    ? "- [x] ACP process running"
    : `- [ ] ACP process state: ${rt.processManager?.state ?? "not started"}`);
  checks.push(rt.sessionManager?.state
    ? `- [x] Session manager state: ${rt.sessionManager.state}`
    : "- [ ] Session manager unavailable");
  checks.push(rt.currentCwd
    ? `- [x] Workspace selected: ${rt.currentCwd}`
    : "- [ ] Workspace selected");
  if (!rt.currentSessionId) {
    checks.push("- [x] Session idle: no active session yet; first prompt or New Session will create one");
    checks.push("- [x] Runtime snapshot not requested while idle");
    checks.push("- [x] Model details not requested while idle");
  } else {
    checks.push(rt.currentRuntime
      ? "- [x] Runtime snapshot available"
      : "- [ ] Runtime snapshot unavailable");
    checks.push(runtimeModelName(rt.currentRuntime)
      ? `- [x] Model visible to frontend: ${runtimeModelName(rt.currentRuntime)}`
      : "- [ ] Model visible to frontend");
  }
  checks.push(rt.currentApprovalMode
    ? `- [x] Approval mode synced: ${rt.currentApprovalMode}`
    : "- [ ] Approval mode synced");
  checks.push(rt.activeApprovalRequest || rt.activeAskUserRequest
    ? `- [!] Active blocking prompt: ${activeBlockingPromptDetail(false)}`
    : "- [x] No active blocking approval or ask-user prompt");
  checks.push(treeConsistency.ok
    ? `- [x] Session tree consistency: ${treeConsistency.detail}`
    : `- [!] Session tree consistency: ${treeConsistency.detail}`);
  checks.push(frontendErrors > 0
    ? `- [!] Recent VSIX frontend errors exist (${frontendErrors}); inspect the log section below.`
    : "- [x] No VSIX frontend errors in recent log buffer");
  checks.push(acpStartupIssues > 0
    ? `- [!] ACP startup warnings/errors present (${acpStartupIssues}); inspect the log section below.`
    : "- [x] No ACP startup warnings/errors in recent log buffer");
  return checks;
}

export function diagnosticsPreferredDefaults(): { agent: string; modelProfile: string; approvalMode: string } {
  return {
    agent: rt.preferredAgentName || "Code",
    modelProfile: rt.preferredModelProfileId || "(default)",
    approvalMode: rt.preferredApprovalMode || "auto",
  };
}

export function diagnosticsMismatchChecklist(
  settings: { binaryPath: string; agentDefault: string; modelProfile: string; approvalMode: string; uiLanguage: string; uiTheme: string },
  currentBinaryPath: string,
  preferredDefaults: { agent: string; modelProfile: string; approvalMode: string },
  extensionInstall: ExtensionInstallState,
): string[] {
  const runtimeAgent = rt.currentRuntime?.agentProfile || rt.activeAgentName || "Code";
  const runtimeModelProfile = rt.currentRuntime?.modelProfileId || "(default)";
  const runtimeModel = runtimeModelName(rt.currentRuntime) || "(unknown)";
  const runtimeToolCount = countRuntimeTools(rt.currentRuntime);
  const frontendErrors = diagnosticsFrontendErrorCount();
  const acpStartupIssues = diagnosticsAcpStartupIssueCount();
  const treeConsistency = sessionTreeConsistencyDetail(false);
  const configuredAgent = settings.agentDefault === "(default)" ? process.env.CHRYS_DEFAULT_AGENT || "Code" : settings.agentDefault;
  const configuredModelProfile = settings.modelProfile === "(default)" ? process.env.CHRYS_MODEL_PROFILE || "(default)" : settings.modelProfile;
  const resolvedUiLanguage = resolveUiLanguage(settings.uiLanguage, vscode.env.language);
  return [
    `- Agent: configured/new-process=${configuredAgent}; preferred/new-session=${preferredDefaults.agent}; active/runtime=${runtimeAgent}`,
    `- Model profile: configured/new-process=${configuredModelProfile}; preferred/new-session=${preferredDefaults.modelProfile}; runtime=${runtimeModelProfile}; model=${runtimeModel}`,
    `- Approval mode: configured=${settings.approvalMode}; preferred/new-session=${preferredDefaults.approvalMode}; active/session=${rt.currentApprovalMode}`,
    `- Workspace: VSIX current=${rt.currentCwd ?? "(none)"}; persisted session=${rt.currentSessionId ?? "(none)"}`,
    `- local session.json: ${currentSessionJsonPath()}`,
    `- Extension install: ${extensionInstallLine(extensionInstall)}`,
    `- Binary: setting=${settings.binaryPath}; resolved=${currentBinaryPath}`,
    `- Shell mode: ${workspaceTerminalDetail(false)}; VSIX intentionally uses the IDE terminal instead of the TUI embedded PTY panel`,
    `- Process/session: process=${rt.processManager?.state ?? "not started"}; session=${rt.sessionManager?.state ?? "not started"}; restartAttempts=${rt.restartAttempts}`,
    `- Restore flags: skipRestoreOnce=${rt.skipRestoreOnce}; restoredInterrupted=${Boolean(rt.restoredInterruptedText)}`,
    `- Runtime snapshot: ${rt.currentRuntime ? "available" : "missing"}; runtimeTools=${runtimeToolCount}; recentToolSnapshots=${rt.toolSnapshots.size}; compressedMessages=${rt.compressedMessages.length}`,
    `- Session tree consistency: ${treeConsistency.ok ? "ok" : "attention"}; ${treeConsistency.detail}`,
    `- Recent VSIX frontend errors: ${frontendErrors}`,
    `- ACP startup warnings/errors: ${acpStartupIssues}`,
    `- UI language: configured=${settings.uiLanguage}; VS Code=${vscode.env.language}; resolved=${resolvedUiLanguage}`,
    `- Theme: ${themeResolutionLine(settings.uiTheme)}`,
  ];
}

export function themeResolutionLine(configuredTheme: string): string {
  const envTheme = process.env.CHRYS_THEME || "(unset)";
  const active = rt.currentTheme;
  const fallback = themeFallbackReason(configuredTheme);
  return `configured=${configuredTheme}; active/frontend=${active}; CHRYS_THEME=${envTheme}${fallback ? `; fallback=${fallback}` : ""}`;
}

export function localizedThemeResolutionLine(config: vscode.WorkspaceConfiguration): string {
  const configuredTheme = config.get<string>("ui.theme") || "auto";
  const fallback = themeFallbackReason(configuredTheme);
  const base = nativeText(
    `configured=${configuredTheme}; active=${rt.currentTheme}; CHRYS_THEME=${process.env.CHRYS_THEME || "(unset)"}`,
    `设置=${configuredTheme}；当前=${rt.currentTheme}；CHRYS_THEME=${process.env.CHRYS_THEME || "（未设置）"}`,
  );
  if (!fallback) return base;
  return nativeText(`${base}; fallback=${fallback}`, `${base}；回退=${fallback}`);
}

export function themeFallbackReason(configuredTheme: string): string {
  const configured = configuredTheme.trim().toLowerCase();
  const envTheme = process.env.CHRYS_THEME?.trim() || "";
  if (configured !== "auto") {
    return isSupportedUiTheme(configured) ? "" : `unsupported VSIX theme setting ${configuredTheme}`;
  }
  if (envTheme && !isSupportedUiTheme(envTheme)) {
    return `unsupported CHRYS_THEME ${envTheme}; VSIX supports Textual themes plus chrys/chrys-ansi`;
  }
  if (!envTheme) {
    return "CHRYS_THEME unset; using chrys";
  }
  return "";
}

export function diagnosticsFrontendHostState(
  settings: { binaryPath: string; agentDefault: string; modelProfile: string; approvalMode: string; uiLanguage: string; uiTheme: string },
  currentBinaryPath: string,
  preferredDefaults: { agent: string; modelProfile: string; approvalMode: string },
  extensionInstall: ExtensionInstallState,
): Record<string, unknown> {
  return {
    generatedAt: new Date().toISOString(),
    settings,
    preferredDefaults,
    vscode: {
      version: vscode.version,
      language: vscode.env.language,
      resolvedUiLanguage: resolveUiLanguage(settings.uiLanguage, vscode.env.language),
      remoteName: vscode.env.remoteName || "local",
      appName: vscode.env.appName,
      uriScheme: vscode.env.uriScheme,
    },
    extensionInstall,
    runtime: {
      binaryPath: currentBinaryPath,
      acpArgs: rt.currentCwd ? buildAcpArgs(vscode.workspace.getConfiguration("chrys"), rt.currentCwd) : [],
      processState: rt.processManager?.state ?? "not started",
      sessionState: rt.sessionManager?.state ?? "not started",
      restartAttempts: rt.restartAttempts,
      currentCwd: rt.currentCwd,
      currentSessionId: rt.currentSessionId,
      currentSessionJsonPath: currentSessionJsonPath(),
      activeApprovalRequest: rt.activeApprovalRequest,
      activeAskUserRequest: rt.activeAskUserRequest,
      activeBlockingPrompt: activeBlockingPromptDetail(false),
      activeAgentName: rt.activeAgentName,
      currentApprovalMode: rt.currentApprovalMode,
      preferredAgentName: rt.preferredAgentName,
      preferredModelProfileId: rt.preferredModelProfileId,
      preferredApprovalMode: rt.preferredApprovalMode,
      promptCapabilities: rt.currentPromptCapabilities,
      modelProfileId: rt.currentRuntime?.modelProfileId,
      modelName: runtimeModelName(rt.currentRuntime),
      skipRestoreOnce: rt.skipRestoreOnce,
      restoredInterruptedText: rt.restoredInterruptedText,
      activeTurnErrorReceived: rt.activeTurnErrorReceived,
    },
    terminal: {
      integration: "vscode.integratedTerminal",
      state: workspaceTerminalStateLabel(false),
      cwd: rt.workspaceTerminalCwd,
      nextCwd: rt.workspaceTerminalCwd || rt.currentCwd,
      note: "VSIX intentionally uses the IDE terminal instead of the TUI embedded PTY panel.",
    },
    sessionTree: rt.sessionTreeProvider?.diagnosticsSnapshot() ?? {},
    rendering: {
      activeAgentMessageId: rt.activeAgentMessageId,
      activeThoughtMessageId: rt.activeThoughtMessageId,
      pendingUserEchoMessageId: rt.pendingUserEchoMessageId,
      pendingUserEchoConsumed: rt.pendingUserEchoConsumed,
      theme: rt.currentTheme,
      imageInputEnabled: rt.currentRuntime?.runtimeDetails?.model?.vision ?? (rt.currentPromptCapabilities?.image === true),
    },
    usage: {
      text: rt.currentUsageText,
      contextUsedTokens: rt.currentContextUsedTokens,
      contextMaxTokens: rt.currentContextMaxTokens,
      contextPct: rt.currentContextPct,
      usageUpdate: rt.currentUsageUpdate,
    },
    counts: {
      runtimeTools: countRuntimeTools(rt.currentRuntime),
      toolSnapshots: rt.toolSnapshots.size,
      subAgentMessages: rt.subAgentMessageIds.size,
      pausedSubAgents: rt.pausedSubAgents.size,
      diffDocuments: rt.diffDocuments.size,
      compressedMessages: rt.compressedMessages.length,
      logLines: rt.logLines.length,
      debugEvents: rt.debugEvents.length,
      sessionLifecycleEvents: sessionLifecycleEvents().length,
      approvalJudgeReviews: rt.approvalJudgeReviews.length,
    },
    approvalJudgeReviews: rt.approvalJudgeReviews.slice(-20),
  };
}

export function buildDiagnosticsSummary(): string {
  const config = vscode.workspace.getConfiguration("chrys");
  const currentBinaryPath = rt.currentBinaryPath ?? "(unresolved)";
  const extensionInstall = diagnosticsExtensionInstallState();
  const settings = {
    binaryPath: config.get<string>("binary.path") || "(PATH)",
    agentDefault: config.get<string>("agent.default") || "(default)",
    modelProfile: config.get<string>("model.profile") || "(default)",
    approvalMode: config.get<string>("approval.mode") || "auto",
    uiLanguage: config.get<string>("ui.language") || "auto",
    uiTheme: config.get<string>("ui.theme") || "auto",
  };
  const preferredDefaults = diagnosticsPreferredDefaults();
  const recentFrontendErrors = rt.logLines.filter((line) => line.includes("[error]")).slice(-20);
  const recentAcpStartupIssues = rt.logLines.filter((line) => isAcpStartupOutputIssue(line)).slice(-20);
  const sessionLifecycleLines = diagnosticsSessionLifecycleLines(20);
  const operationGuardLines = diagnosticsOperationGuardLines(20);
  const inputParityLines = diagnosticsInputParityLines(20);
  const sessionTreeSnapshot = rt.sessionTreeProvider?.diagnosticsSnapshot();
  const content = [
    "# iCode VSIX Diagnostics Summary",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Health Checks",
    "",
    ...diagnosticsHealthChecks(currentBinaryPath),
    "",
    "## VSIX / TUI Mismatch Checklist",
    "",
    ...diagnosticsMismatchChecklist(settings, currentBinaryPath, preferredDefaults, extensionInstall),
    "",
    "## Recent Tool Calls",
    "",
    ...recentToolLinesLocal(),
    "",
    "## Session Tree State",
    "",
    "```json",
    JSON.stringify(redactDiagnosticsValue(sessionTreeSnapshot ?? {}), null, 2),
    "```",
    "",
    "## Tool Renderer Coverage",
    "",
    ...toolRendererCoverageLines(),
    "",
    "## Recent VSIX Frontend Errors",
    "",
    ...(recentFrontendErrors.length ? recentFrontendErrors.map((line) => `- ${redactSensitiveDiagnosticsText(line)}`) : ["- (none)"]),
    "",
    "## Recent ACP Startup Warnings/Errors",
    "",
    ...(recentAcpStartupIssues.length ? recentAcpStartupIssues.map((line) => `- ${redactSensitiveDiagnosticsText(line)}`) : ["- (none)"]),
    "",
    "## Recent Frontend Events",
    "",
    ...(rt.debugEvents.length ? rt.debugEvents.slice(-20).map((event) => redactSensitiveDiagnosticsText(formatDebugEventLine(event))) : ["- (none)"]),
    "",
    "## Frontend Event Summary",
    "",
    ...diagnosticsFrontendEventSummaryLines(80),
    "",
    "## Session Lifecycle",
    "",
    ...sessionLifecycleLines,
    "",
    "## Approval Judge Reviews",
    "",
    ...approvalJudgeLines(false, 20),
    "",
    "## Operation Guard Events",
    "",
    ...operationGuardLines,
    "",
    "## Input / Shortcut Parity",
    "",
    ...inputParityLines,
  ].join("\n");
  return redactSensitiveDiagnosticsText(content);
}

export const OPERATION_GUARD_EVENT_PATTERN = /(?:Blocked|Deferred)$/;
export const SESSION_LIFECYCLE_EVENT_PATTERN = /^(?:AcpProcess|Session(?:Startup|Restore|Initialization|New))/;

export function sessionLifecycleEvents(): typeof rt.debugEvents {
  return rt.debugEvents.filter((event) => SESSION_LIFECYCLE_EVENT_PATTERN.test(event.kind));
}

export function diagnosticsFrontendEventSummaryLines(limit = 200): string[] {
  const events = rt.debugEvents.slice(-limit);
  if (!events.length) return ["- (none)"];

  const byKind = new Map<string, { count: number; lastTime: number; lastDetail: string }>();
  for (const event of events) {
    const existing = byKind.get(event.kind);
    if (existing) {
      existing.count += 1;
      existing.lastTime = event.time;
      existing.lastDetail = event.detail;
    } else {
      byKind.set(event.kind, { count: 1, lastTime: event.time, lastDetail: event.detail });
    }
  }
  const rows = [...byKind.entries()]
    .sort((left, right) => right[1].count - left[1].count || right[1].lastTime - left[1].lastTime)
    .slice(0, 24)
    .map(([kind, summary]) => {
      const detail = summary.lastDetail ? `; last=${summary.lastDetail.slice(0, 160)}` : "";
      return `- ${kind}: count=${summary.count}; lastAt=${new Date(summary.lastTime).toISOString()}${detail}`;
    });
  return [
    `- Window: last ${events.length} event(s)`,
    ...rows.map((line) => redactSensitiveDiagnosticsText(line)),
  ];
}

export function diagnosticsSessionLifecycleLines(limit = 40): string[] {
  const events = sessionLifecycleEvents().slice(-limit);
  if (!events.length) {
    return [
      "- (none)",
      "- Expected lifecycle order: AcpProcessStarted -> AcpProcessConnected -> SessionRestoreStarted/Succeeded or SessionStartupIdle -> SessionNewStarted/Succeeded.",
    ];
  }
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  const failures = events.filter((event) => event.kind.endsWith("Failed") || event.kind.endsWith("Error") || event.kind.endsWith("Disconnected"));
  return [
    `- Lifecycle event count: ${events.length}`,
    `- By type: ${[...counts.entries()].map(([kind, count]) => `${kind}=${count}`).join(", ")}`,
    failures.length ? `- Attention: ${failures.length} failure/disconnect event(s) captured.` : "- Attention: none",
    ...events.map((event) => redactSensitiveDiagnosticsText(formatDebugEventLine(event))),
  ];
}

export function diagnosticsOperationGuardLines(limit = 40): string[] {
  const events = rt.debugEvents
    .filter((event) => OPERATION_GUARD_EVENT_PATTERN.test(event.kind))
    .slice(-limit);
  if (!events.length) return ["- (none)"];

  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  return [
    `- Guarded event count: ${events.length}`,
    `- By type: ${[...counts.entries()].map(([kind, count]) => `${kind}=${count}`).join(", ")}`,
    ...events.map((event) => redactSensitiveDiagnosticsText(formatDebugEventLine(event))),
  ];
}

export function formatDebugEventLine(event: { time: number; kind: string; detail: string }): string {
  const timestamp = new Date(event.time).toISOString();
  return `- ${timestamp} [${event.kind}] ${event.detail}`;
}

export function recentToolLinesLocal(localized = false): string[] {
  if (rt.toolSnapshots.size === 0) {
    return [
      localized
        ? nativeText("No tool calls recorded in this frontend session.", "当前前端会话还没有记录工具调用。")
        : "No tool calls recorded in this frontend session.",
    ];
  }
  return [...rt.toolSnapshots.values()].slice(-20).map((tool: ToolSnapshot) => {
    const status = recentToolStatusLabel(tool, localized);
    return `- ${tool.title ?? tool.toolCallId} (${tool.kind ?? "other"}, ${status})`;
  });
}

export function recentToolStatusLabel(tool: ToolSnapshot, localized: boolean): string {
  if (tool.rawOutput === undefined) {
    return localized ? nativeText("started", "已开始") : "started";
  }
  return localized ? nativeText("updated", "已更新") : "updated";
}

export function approvalJudgeLines(localized = false, limit = 20): string[] {
  const reviews = rt.approvalJudgeReviews.slice(-limit);
  if (!reviews.length) {
    return [localized ? nativeText("- (none)", "- (无)") : "- (none)"];
  }
  return reviews.map((review) => {
    const status = approvalReviewStatusLabel(review.status, localized);
    const timestamp = new Date(review.time).toISOString();
    const subject = review.intentSummary || review.toolName || review.requestId;
    const kind = review.toolKind ? ` [${review.toolKind}]` : "";
    const reason = review.reason ? ` - ${review.reason}` : "";
    return `- ${timestamp} ${status}${kind}: ${subject}${reason}`;
  });
}

export function approvalReviewStatusLabel(status: "judging" | "approved" | "flagged", localized: boolean): string {
  if (!localized) return status;
  switch (status) {
    case "judging":
      return nativeText("judging", "判断中");
    case "approved":
      return nativeText("approved", "已自动允许");
    case "flagged":
      return nativeText("flagged", "已标记");
  }
}

export function diagnosticsInputParityLines(limit = 40): string[] {
  const eventKinds = [
    "Shortcut",
    "ComposerHint",
    "ApprovalDialogShown",
    "ApprovalDialogSubmitted",
    "AskUserDialogShown",
    "AskUserRequest",
    "AskUserFallback",
    "AskUserResponse",
    "PasteTruncated",
    "ImagePathMentioned",
    "ImageAttached",
    "ImageCompressed",
    "ImageInputState",
    "FileMentionInserted",
    "ShellPromptSubmitted",
    "ShellBlocked",
    "ShellCommand",
    "ShellOpened",
    "AgentSwitch",
    "AgentSwitchBlocked",
  ];
  const events = rt.debugEvents
    .filter((event) => eventKinds.includes(event.kind))
    .slice(-limit);
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  return [
    "- Composer shortcuts: Enter=send; Ctrl+J=newline; Ctrl+B=interrupt. Non-composer actions use slash commands, the iCode TreeView title menu, Command Palette, or session context menus.",
    "- Composer hint buttons: #=agents; !=shell; /=slash command search; @=file mention.",
    "- Single-character triggers: / and fullwidth ／ open command search; @ and fullwidth ＠ mention files at start/space/CJK boundary; # and fullwidth ＃ switch agents; ! and fullwidth ！ open shell.",
    "- Slash aliases: English commands and Chinese command aliases share the same command registry; examples include /search and /搜索, /grep and /检索, /models and /模型管理, /doctor and /健康检查.",
    "- Paste/drop behavior: text line endings normalized; large text paste truncated near 30k estimated tokens; image files paste/drop as attachments; path-only image payloads become @\"path\" mentions.",
    events.length
      ? `- Recent input event counts: ${[...counts.entries()].map(([kind, count]) => `${kind}=${count}`).join(", ")}`
      : "- Recent input event counts: (none)",
    ...events.map((event) => redactSensitiveDiagnosticsText(formatDebugEventLine(event))),
  ];
}

export function toolRendererCoverageLines(): string[] {
  const coverage = toolRendererCoverage([...rt.toolSnapshots.values()].map((tool) => ({
    toolCallId: tool.toolCallId,
    title: tool.title,
    kind: tool.kind,
    status: tool.status,
    hasInput: tool.rawInput !== undefined,
    hasOutput: tool.rawOutput !== undefined,
  })), 20);
  if (coverage.total === 0) return ["- (no tool calls recorded)"];
  const rendererCounts = Object.entries(coverage.byRenderer).map(([renderer, count]) => `${renderer}=${count}`).join(", ");
  return [
    `- Total recent tool calls: ${coverage.total}`,
    `- Generic renderer fallbacks: ${coverage.generic}`,
    `- Missing ACP kind: ${coverage.missingKind}`,
    `- By renderer: ${rendererCounts || "(none)"}`,
    ...coverage.recent.map((entry) => `- ${entry.toolName || entry.id || "(unknown tool)"}: kind=${entry.rawKind || "(missing)"} normalized=${entry.normalizedKind} renderer=${entry.renderer}`),
  ];
}
