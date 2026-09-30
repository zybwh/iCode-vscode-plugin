import { attachment, editorAttachment, problemsAttachment } from "../context/attachments";
import { openChanges } from "./changes";
import { withLocalSessionNames } from "../session/localNames";
import { restartBackendConnection } from "../extension";
import { agentSelectionTarget, workspaceSelectionTarget } from "../session/selectionTarget";
import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { rt, type ToolSnapshot } from "../state/runtime";
import { pickWorkspaceDirectory, pickAdditionalDirectories } from "./workspacePicker";
import { nextMessageId } from "../chat/provider";
import type { ChatInlineDialogState } from "../chat/panel";
import { formatCount } from "../common/utils";
import { logInfo, logWarn, logError } from "../common/logging";
import { chatPanelState } from "../common/chatPanelState";
import { apiStyleLabel, providerLabel, runtimeModelName, runtimeDetailsTabs, countRuntimeTools } from "../common/runtimeUtils";
import { toolRendererCoverage } from "../common/toolRendering";
import { resolveUiLanguage } from "../common/i18n";
import { SUPPORTED_UI_THEME_IDS, isSupportedUiTheme, resolveUiTheme, type UiTheme } from "../common/uiTheme";
import { findSessionJsonPath } from "../common/sessionFiles";
import { diffFromSnapshot } from "../handlers/session";
import { refreshRuntimeSnapshot } from "../handlers/notifications";
import { agentProfileMutation } from "../chat/agentProfileEdit";
import {
  rememberPreferredAgent,
  rememberPreferredApprovalMode,
  rememberPreferredConfigOption,
  persistPreferredModel,
  persistPreferredAgent,
} from "../session/defaults";
import { PROTOCOL_VERSION, buildAcpArgs } from "../extension";
import type {
  SessionInfo,
  ProfileSummary,
  ModelSummary,
  DiffEntry,
} from "../acp/types";
import { hostUiLanguage as currentUiLanguage, localized as nativeText } from "../common/hostI18n";


function chrysCliVersionLabel(localized = false): string {
  if (rt.chrysCliVersion) return `iCode CLI v${rt.chrysCliVersion}`;
  return localized ? nativeText("iCode CLI (version unknown)", "iCode CLI（版本未知）") : "iCode CLI (version unknown)";
}

// ──────────────────────────────────────────────
// Inline dialog helpers
// ──────────────────────────────────────────────

export function setTrackedInlineDialogState(state: ChatInlineDialogState): void {
  rt.activeInlineDialogKind = state.kind;
  rt.chatPanel?.setInlineDialogState(state);
}

function startingNotice(): string {
  return nativeText("iCode is still starting. Try again in a moment.", "iCode 仍在启动，请稍后再试。");
}

function currentSessionJsonPath(): string {
  return rt.currentSessionId ? findSessionJsonPath(rt.currentSessionId) ?? "(not found on this host)" : "(none)";
}

function localizedCurrentSessionJsonPath(): string {
  return rt.currentSessionId
    ? findSessionJsonPath(rt.currentSessionId) ?? nativeText("(not found on this host)", "(当前主机未找到)")
    : nativeText("(none)", "(无)");
}

function workspaceTerminalDetail(localized = false): string {
  const terminalState = workspaceTerminalStateLabel(localized);
  const cwd = rt.workspaceTerminalCwd || (localized ? nativeText("default terminal cwd", "默认终端目录") : "default terminal cwd");
  const nextCwd = rt.workspaceTerminalCwd || rt.currentCwd || (localized ? nativeText("default terminal cwd", "默认终端目录") : "default terminal cwd");
  if (!rt.workspaceTerminal || rt.workspaceTerminal.exitStatus) {
    return localized
      ? nativeText(`VS Code integrated terminal; state=${terminalState}; nextCwd=${nextCwd}`, `VS Code 集成终端；状态=${terminalState}；下次目录=${nextCwd}`)
      : `VS Code integrated terminal; state=${terminalState}; nextCwd=${nextCwd}`;
  }
  return localized
    ? nativeText(`VS Code integrated terminal; state=${terminalState}; cwd=${cwd}`, `VS Code 集成终端；状态=${terminalState}；目录=${cwd}`)
    : `VS Code integrated terminal; state=${terminalState}; cwd=${cwd}`;
}

function workspaceTerminalStateLabel(localized: boolean): string {
  if (!rt.workspaceTerminal) {
    return localized ? nativeText("not opened", "未打开") : "not opened";
  }
  if (rt.workspaceTerminal.exitStatus) {
    return localized ? nativeText("closed", "已关闭") : "closed";
  }
  return localized ? nativeText("open", "已打开") : "open";
}

function activeBlockingPromptDetail(localized = false): string {
  const parts: string[] = [];
  if (rt.activeApprovalRequest) {
    const approval = rt.activeApprovalRequest;
    parts.push(localized
      ? nativeText(
        `approval ${approval.requestId}: ${approval.title}${approval.kind ? ` [${approval.kind}]` : ""}`,
        `审批 ${approval.requestId}：${approval.title}${approval.kind ? ` [${approval.kind}]` : ""}`,
      )
      : `approval ${approval.requestId}: ${approval.title}${approval.kind ? ` [${approval.kind}]` : ""}`);
  }
  if (rt.activeAskUserRequest) {
    const firstQuestion = rt.activeAskUserRequest.questions[0] ?? "";
    const question = firstQuestion.length > 120
      ? `${firstQuestion.slice(0, 120)}...`
      : firstQuestion;
    const count = rt.activeAskUserRequest.questions.length;
    parts.push(localized
      ? nativeText(
        `ask-user ${rt.activeAskUserRequest.requestId} (${count}): ${question}`,
        `用户提问 ${rt.activeAskUserRequest.requestId}（${count} 题）：${question}`,
      )
      : `ask-user ${rt.activeAskUserRequest.requestId} (${count}): ${question}`);
  }
  if (parts.length) return parts.join("; ");
  return localized ? nativeText("none", "无") : "none";
}

function diagnosticsFrontendErrorCount(): number {
  return rt.logLines.filter((line) => line.includes("[error]")).length;
}

function isAcpStartupOutputIssue(line: string): boolean {
  return /\[(?:stdout|stderr)\]/.test(line) && /\b(?:ERROR|WARNING|Error:|Warning:|Retrying|No matching distribution|Failed to establish|timeout|timed out)\b/.test(line);
}

function diagnosticsAcpStartupIssueCount(): number {
  return rt.logLines.filter((line) => isAcpStartupOutputIssue(line)).length;
}

function currentSessionJsonFilePath(): string | null {
  return rt.currentSessionId ? findSessionJsonPath(rt.currentSessionId) ?? null : null;
}

function sessionTreeConsistencyDetail(localized = false): { ok: boolean; detail: string } {
  const snapshot = rt.sessionTreeProvider?.diagnosticsSnapshot();
  if (!rt.currentSessionId) {
    return {
      ok: true,
      detail: localized
        ? nativeText("No active session yet; tree consistency is not required.", "尚无活动会话；无需检查会话树一致性。")
        : "No active session yet; tree consistency is not required.",
    };
  }
  if (!snapshot?.hasSessionManager) {
    return {
      ok: false,
      detail: localized ? nativeText("Session tree provider is not ready.", "会话树尚未就绪。") : "Session tree provider is not ready.",
    };
  }
  if (snapshot.currentSessionInList) {
    return {
      ok: true,
      detail: localized ? nativeText("Current session appears in the Sessions tree.", "当前会话已出现在会话树中。") : "Current session appears in the Sessions tree.",
    };
  }
  const sessionJsonPath = currentSessionJsonFilePath();
  if (!sessionJsonPath) {
    return {
      ok: true,
      detail: localized
        ? nativeText("Current session is not persisted yet; it may be absent from the Sessions tree.", "当前会话尚未持久化，暂时不出现在会话树中是正常的。")
        : "Current session is not persisted yet; it may be absent from the Sessions tree.",
    };
  }
  return {
    ok: false,
    detail: localized
      ? nativeText(`session.json exists but the current session is absent from the Sessions tree: ${sessionJsonPath}`, `session.json 已存在，但当前会话不在会话树中：${sessionJsonPath}`)
      : `session.json exists but the current session is absent from the Sessions tree: ${sessionJsonPath}`,
  };
}

type ExtensionInstallState = {
  appName: string;
  uriScheme: string;
  extensionPath: string;
  extensionRealPath: string;
  extensionUri: string;
  isSymlink: boolean;
  storeRoot: string;
  storeKind: "openubmc-studio" | "vscode" | "unknown";
  developmentCheckout: boolean;
  versionedSiblings: string[];
  registryPath: string;
  registryLocation: string;
  registryRelativeLocation: string;
  registryReadError: string;
  pathReadError: string;
};

function diagnosticsExtensionInstallState(): ExtensionInstallState {
  const extensionPath = rt.extensionContext?.extensionPath || vscode.extensions.getExtension("chrys.chrys-vscode")?.extensionPath || "";
  const extensionUri = rt.extensionContext?.extensionUri.toString() || "";
  const state: ExtensionInstallState = {
    appName: vscode.env.appName,
    uriScheme: vscode.env.uriScheme,
    extensionPath,
    extensionRealPath: extensionPath,
    extensionUri,
    isSymlink: false,
    storeRoot: extensionPath ? path.dirname(extensionPath) : "",
    storeKind: "unknown",
    developmentCheckout: false,
    versionedSiblings: [],
    registryPath: "",
    registryLocation: "",
    registryRelativeLocation: "",
    registryReadError: "",
    pathReadError: "",
  };

  if (!extensionPath) return state;

  try {
    const stat = fs.lstatSync(extensionPath);
    state.isSymlink = stat.isSymbolicLink();
    state.extensionRealPath = fs.realpathSync(extensionPath);
  } catch (error) {
    state.pathReadError = error instanceof Error ? error.message : String(error);
  }

  state.storeKind = extensionStoreKind(state.extensionPath);
  state.developmentCheckout = isDevelopmentCheckout(state.extensionPath, state.extensionRealPath);
  state.registryPath = path.join(state.storeRoot, "extensions.json");

  try {
    state.versionedSiblings = fs.readdirSync(state.storeRoot)
      .filter((entry) => /^chrys\.chrys-vscode-\d/.test(entry))
      .sort();
  } catch (error) {
    state.pathReadError = state.pathReadError || (error instanceof Error ? error.message : String(error));
  }

  try {
    const registryText = fs.readFileSync(state.registryPath, "utf8");
    const registry = JSON.parse(registryText) as unknown;
    if (Array.isArray(registry)) {
      const entry = registry.find((item) => {
        const record = item as { identifier?: { id?: unknown } };
        return record.identifier?.id === "chrys.chrys-vscode";
      }) as { location?: { path?: unknown; fsPath?: unknown }; relativeLocation?: unknown } | undefined;
      state.registryLocation = typeof entry?.location?.fsPath === "string"
        ? entry.location.fsPath
        : typeof entry?.location?.path === "string"
          ? entry.location.path
          : "";
      state.registryRelativeLocation = typeof entry?.relativeLocation === "string" ? entry.relativeLocation : "";
    }
  } catch (error) {
    state.registryReadError = error instanceof Error ? error.message : String(error);
  }

  return state;
}

function extensionStoreKind(extensionPath: string): ExtensionInstallState["storeKind"] {
  const normalized = extensionPath.split(path.sep).join("/");
  if (normalized.includes("/.bmc-studio/extensions/")) return "openubmc-studio";
  if (normalized.includes("/.vscode/extensions/") || normalized.includes("/.vscode-insiders/extensions/")) return "vscode";
  return "unknown";
}

function isDevelopmentCheckout(extensionPath: string, extensionRealPath: string): boolean {
  const normalizedPath = extensionPath.split(path.sep).join("/");
  const normalizedRealPath = extensionRealPath.split(path.sep).join("/");
  return normalizedPath.endsWith("/chrys/vscode") || normalizedRealPath.endsWith("/chrys/vscode");
}

function extensionInstallLine(state: ExtensionInstallState): string {
  const siblings = state.versionedSiblings.length ? state.versionedSiblings.join(", ") : "(none)";
  return `app=${state.appName}; scheme=${state.uriScheme}; store=${state.storeKind}; path=${state.extensionPath || "(unknown)"}; realPath=${state.extensionRealPath || "(unknown)"}; symlink=${state.isSymlink ? "yes" : "no"}; devCheckout=${state.developmentCheckout ? "yes" : "no"}; registryLocation=${state.registryLocation || "(missing)"}; versionedSiblings=${siblings}`;
}

function localizedExtensionInstallDetail(state: ExtensionInstallState): string {
  const issues = [
    state.pathReadError ? nativeText(`path read failed: ${state.pathReadError}`, `路径读取失败：${state.pathReadError}`) : "",
    state.registryReadError ? nativeText(`registry read failed: ${state.registryReadError}`, `扩展清单读取失败：${state.registryReadError}`) : "",
  ].filter(Boolean);
  const base = nativeText(extensionInstallLine(state), extensionInstallLine(state));
  return issues.length ? `${base}; ${issues.join("; ")}` : base;
}

const REDACTED_DIAGNOSTICS_VALUE = "<redacted>";
const SENSITIVE_DIAGNOSTICS_KEY = /^(?:api[_-]?key|apikey|authorization|proxy[_-]?authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|x-api-key|api-key|client[_-]?secret|secret|password|passwd|private[_-]?key|credential|cookie|set-cookie)$/i;
const SENSITIVE_DIAGNOSTICS_ENV_KEY = /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|AZURE_OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|API_KEY|AUTHORIZATION|PASSWORD|SECRET)\b/i;

function isSensitiveDiagnosticsKey(key: string): boolean {
  return SENSITIVE_DIAGNOSTICS_KEY.test(key) || SENSITIVE_DIAGNOSTICS_ENV_KEY.test(key);
}

function redactSensitiveDiagnosticsText(text: string): string {
  return text
    .replace(
      /((?:"|')?(?:api[_-]?key|apikey|authorization|proxy[_-]?authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|x-api-key|api-key|client[_-]?secret|secret|password|passwd|private[_-]?key|credential|cookie|set-cookie)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi,
      `$1${REDACTED_DIAGNOSTICS_VALUE}`,
    )
    .replace(
      /(\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|AZURE_OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|API_KEY|AUTHORIZATION|PASSWORD|SECRET)\b\s*=\s*)([^\s]+)/gi,
      `$1${REDACTED_DIAGNOSTICS_VALUE}`,
    )
    .replace(
      /(\b(?:authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie)\s*:\s*)([^\n]+)/gi,
      `$1${REDACTED_DIAGNOSTICS_VALUE}`,
    )
    .replace(
      /([?&](?:api_key|apikey|key|token|access_token|auth|authorization|password|secret)=)([^&#\s]+)/gi,
      `$1${REDACTED_DIAGNOSTICS_VALUE}`,
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, `$1${REDACTED_DIAGNOSTICS_VALUE}`)
    .replace(/\bsk-[A-Za-z0-9._-]{12,}\b/g, REDACTED_DIAGNOSTICS_VALUE);
}

function redactDiagnosticsValue(value: unknown, keyHint = ""): unknown {
  if (isSensitiveDiagnosticsKey(keyHint)) {
    return REDACTED_DIAGNOSTICS_VALUE;
  }
  if (typeof value === "string") {
    return redactSensitiveDiagnosticsText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticsValue(entry, keyHint));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const headerName = typeof record.name === "string" ? record.name : "";
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    redacted[key] = key === "value" && isSensitiveDiagnosticsKey(headerName)
      ? REDACTED_DIAGNOSTICS_VALUE
      : redactDiagnosticsValue(entry, key);
  }
  return redacted;
}

export function showInlineNotice(level: "info" | "warning" | "error", text: string): void {
  setTrackedInlineDialogState({
    kind: "notice",
    title: "iCode",
    subtitle: "",
    body: text,
  });
  rt.chatPanel?.inlineDialogNotice(level, text);
}

export function inlineDialogError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logError(`Inline dialog failed: ${message}`);
  rt.chatPanel?.setInlineDialogBusy(false);
  showInlineNotice("error", message);
}

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
  const { openSessionTab } = await import("../extension");
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

const LOG_MODULES: Array<{ id: string; label: string | (() => string); pattern: RegExp }> = [
  { id: "events", label: () => nativeText("Events", "事件"), pattern: /\[event:/i },
  { id: "chrys", label: "chrys", pattern: /\[chrys\]/i },
  { id: "agent-framework", label: "agent-framework", pattern: /\[agent_framework\]/i },
  { id: "openai", label: "openai", pattern: /\[openai\]/i },
  { id: "anthropic", label: "anthropic", pattern: /\[anthropic\]/i },
  { id: "httpcore", label: "httpcore", pattern: /\[httpcore\]/i },
  { id: "httpx", label: "httpx", pattern: /\[httpx\]/i },
];

function parseLogModules(lines: string[]): Array<{ id: string; label: string; text: string }> {
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

function pushLogDialogState(): void {
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

function startLogsRefresh(): void {
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
      const { openSessionTab } = await import("../extension");
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

// ──────────────────────────────────────────────
// Session diff / rollback
// ──────────────────────────────────────────────

export async function showSessionDiff(): Promise<void> {
  await openChanges(false, undefined, openDiffEntry);
}

async function openDiffEntry(entry: DiffEntry, titlePrefix: string): Promise<boolean> {
  const label = vscode.workspace.asRelativePath(entry.path);
  if (entry.isBinary) {
    vscode.window.showInformationMessage(nativeText(`Binary diff is not available for ${label}.`, `${label} 是二进制文件，无法显示文本差异。`));
    return false;
  }
  const safeId = encodeURIComponent(`${rt.tabId}:session:${entry.path}:${titlePrefix}`);
  const left = vscode.Uri.parse(`chrys-diff:/${safeId}/before/${encodeURIComponent(label)}`);
  const right = vscode.Uri.parse(`chrys-diff:/${safeId}/after/${encodeURIComponent(label)}`);
  rt.diffDocuments.set(left.path, entry.beforeText);
  rt.diffDocuments.set(right.path, entry.afterText);
  await vscode.commands.executeCommand("vscode.diff", left, right, `${titlePrefix}: ${label}`);
  return true;
}

export async function rollbackSession(arg?: string): Promise<void> {
  await openChanges(true, arg, openDiffEntry);
}

// ──────────────────────────────────────────────
// Sub-agent actions
// ──────────────────────────────────────────────

export async function retryPausedSubAgent(): Promise<void> {
  const invocationId = await selectPausedSubAgent(nativeText("Retry which paused sub-agent?", "重试哪个暂停的子智能体？"));
  if (!invocationId || !rt.sessionManager) return;
  await rt.sessionManager.retrySubAgent(invocationId);
}

export async function abortPausedSubAgent(): Promise<void> {
  const invocationId = await selectPausedSubAgent(nativeText("Abort which paused sub-agent?", "终止哪个暂停的子智能体？"));
  if (!invocationId || !rt.sessionManager) return;
  const abortLabel = nativeText("Abort", "终止");
  const confirmed = await vscode.window.showWarningMessage(
    nativeText(`Abort sub-agent ${invocationId}?`, `终止子智能体 ${invocationId}？`),
    { modal: true },
    abortLabel,
  );
  if (confirmed !== abortLabel) return;
  await rt.sessionManager.abortSubAgent(invocationId);
}

export async function selectPausedSubAgent(placeHolder: string): Promise<string | undefined> {
  if (!rt.pausedSubAgents.size) {
    vscode.window.showInformationMessage(nativeText("No paused sub-agent invocation is waiting for a decision.", "当前没有等待决策的暂停子智能体调用。"));
    return undefined;
  }
  const selected = await vscode.window.showQuickPick(
    [...rt.pausedSubAgents.entries()].map(([invocationId, update]) => ({
      label: `${update.agentName} (${invocationId})`,
      description: invocationId,
      invocationId,
    })),
    { placeHolder },
  );
  return selected?.invocationId;
}

// ──────────────────────────────────────────────
// Approval mode
// ──────────────────────────────────────────────

export async function setApprovalMode(mode?: string): Promise<void> {
  if (!rt.sessionManager) return;
  if (mode === "__cycle") {
    const previous = approvalModeOrDefault(rt.currentApprovalMode);
    const next = approvalModeAfter(rt.currentApprovalMode);
    rt.currentApprovalMode = next;
    rememberPreferredApprovalMode(next);
    rt.chatPanel?.setState(chatPanelState());
    rt.chatPanel?.appendDebugEvent("ApprovalModeCycle", `${previous} -> ${next}`);
    await applyApprovalModeToActiveSession(next);
    return;
  }
  if (mode) {
    if (!["manual", "auto", "bypass"].includes(mode) || mode === rt.currentApprovalMode) return;
    rt.currentApprovalMode = mode;
    rememberPreferredApprovalMode(mode);
    rt.chatPanel?.setState(chatPanelState());
    await applyApprovalModeToActiveSession(mode);
    return;
  }
  const selected = await vscode.window.showQuickPick(
    [
      { mode: "manual", label: nativeText("Manual approval", "手动批准"), description: rt.currentApprovalMode === "manual" ? nativeText("current", "当前") : "" },
      { mode: "auto", label: nativeText("Approve for me", "帮我批准"), description: rt.currentApprovalMode === "auto" ? nativeText("current", "当前") : "" },
      { mode: "bypass", label: nativeText("Full access", "完全访问"), description: rt.currentApprovalMode === "bypass" ? nativeText("current", "当前") : "" },
    ],
    { placeHolder: nativeText("Select iCode approval mode", "选择 iCode 审批模式") },
  );
  if (!selected || selected.mode === rt.currentApprovalMode) return;
  rt.currentApprovalMode = selected.mode;
  rememberPreferredApprovalMode(selected.mode);
  rt.chatPanel?.setState(chatPanelState());
  await applyApprovalModeToActiveSession(selected.mode);
}

async function applyApprovalModeToActiveSession(mode: string): Promise<void> {
  if (!rt.sessionManager?.sessionId) {
    rt.chatPanel?.appendDebugEvent("ApprovalModeDefaultOnly", mode);
    return;
  }
  await rt.sessionManager.setApprovalMode(mode);
}

function approvalModeAfter(current: string): "manual" | "auto" | "bypass" {
  if (current === "manual") return "auto";
  if (current === "auto") return "bypass";
  return "manual";
}

function approvalModeOrDefault(current: string): "manual" | "auto" | "bypass" {
  return current === "manual" || current === "auto" || current === "bypass" ? current : "bypass";
}

// ──────────────────────────────────────────────
// Agent switching
// ──────────────────────────────────────────────

export async function switchActiveAgent(targetName?: string): Promise<void> {
  if (!rt.sessionManager) return;
  if (rt.sessionManager.state !== "idle") {
    vscode.window.showInformationMessage(nativeText(
      "iCode cannot switch agents while the current task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能切换 iCode 智能体。请先中断或等待任务完成。",
    ));
    rt.chatPanel?.appendDebugEvent("AgentSwitchBlocked", rt.sessionManager.state);
    return;
  }
  const agents = await rt.sessionManager.listAgentProfiles();
  const directTarget = targetName?.trim();
  if (directTarget) {
    const matched = agents.find((agent) => (
      !agent.subAgentOnly
      && (agent.name.toLowerCase() === directTarget.toLowerCase()
        || (agent.displayName || "").toLowerCase() === directTarget.toLowerCase())
    ));
    if (!matched) {
      vscode.window.showWarningMessage(nativeText(
        `No main iCode agent profile matches "${directTarget}".`,
        `没有匹配 “${directTarget}” 的主 iCode 智能体配置。`,
      ));
      rt.chatPanel?.appendDebugEvent("AgentSwitchFailed", directTarget);
      return;
    }
    if (matched.name === rt.activeAgentName) return;
    if (await selectNextSessionAgent(matched.name)) return;
    await rt.sessionManager.switchAgent(matched.name);
    rememberPreferredAgent(matched.name);
    await refreshRuntimeSnapshot();
    rt.chatPanel?.setState(chatPanelState());
    vscode.window.showInformationMessage(nativeText(
      `Switched iCode agent to ${matched.displayName || matched.name}.`,
      `已切换 iCode 智能体为 ${matched.displayName || matched.name}。`,
    ));
    rt.chatPanel?.appendDebugEvent("AgentSwitch", matched.name);
    return;
  }
  const selected = await vscode.window.showQuickPick(
    agents
      .filter((agent: ProfileSummary) => !agent.subAgentOnly)
      .map((agent: ProfileSummary) => agentQuickPickItem(agent, { activeAgentName: rt.activeAgentName })),
    { placeHolder: nativeText("Switch active iCode agent", "切换当前 iCode 智能体") },
  );
  if (!selected || selected.profileName === rt.activeAgentName) return;
  if (await selectNextSessionAgent(selected.profileName)) return;
  await rt.sessionManager.switchAgent(selected.profileName);
  rememberPreferredAgent(selected.profileName);
  await refreshRuntimeSnapshot();
  rt.chatPanel?.setState(chatPanelState());
  vscode.window.showInformationMessage(nativeText(
    `Switched iCode agent to ${selected.label.replace(/^\$\(circle-filled\)\s*/, "")}.`,
    `已切换 iCode 智能体为 ${selected.label.replace(/^\$\(circle-filled\)\s*/, "")}。`,
  ));
  rt.chatPanel?.appendDebugEvent("AgentSwitch", selected.profileName);
}

export async function showAgentProfiles(): Promise<void> {
  if (!rt.sessionManager) {
    vscode.window.showInformationMessage(nativeText("iCode is still starting. Try again in a moment.", "iCode 仍在启动，请稍后再试。"));
    return;
  }
  const agents = await rt.sessionManager.listAgentProfiles();
  const selected = await vscode.window.showQuickPick(
    agents.map((agent: ProfileSummary) => agentQuickPickItem(agent, { activeAgentName: rt.activeAgentName, includeSubAgentOnly: true })),
    { placeHolder: nativeText("Select an agent profile to inspect", "选择要查看的智能体配置") },
  );
  if (!selected) return;
  const profile = await rt.sessionManager.readAgentProfile(selected.profileName);
  await showJsonDocument(`iCode Agent Profile: ${selected.profileName}`, profile);
}

type AgentQuickPickItem = vscode.QuickPickItem & {
  profileName: string;
};

function agentQuickPickItem(
  agent: ProfileSummary,
  options: { activeAgentName?: string; includeSubAgentOnly?: boolean } = {},
): AgentQuickPickItem {
  const isActive = Boolean(options.activeAgentName && agent.name === options.activeAgentName);
  const role = agent.subAgentOnly
    ? nativeText("sub-agent only", "仅子智能体")
    : nativeText("main agent", "主智能体");
  const description = [
    isActive ? nativeText("current", "当前") : "",
    role,
    agent.name,
  ].filter(Boolean).join("  ");
  const detail = [
    agent.description || nativeText("No description.", "暂无描述。"),
    options.includeSubAgentOnly
      ? nativeText(
        `Profile id: ${agent.id || agent.name}; usable as main agent: ${agent.subAgentOnly ? "no" : "yes"}`,
        `配置 ID：${agent.id || agent.name}；可作为主智能体：${agent.subAgentOnly ? "否" : "是"}`,
      )
      : nativeText(`Profile id: ${agent.id || agent.name}`, `配置 ID：${agent.id || agent.name}`),
  ].join("\n");
  return {
    label: `${isActive ? "$(circle-filled) " : ""}${agent.displayName || agent.name}`,
    description,
    detail,
    profileName: agent.name,
  };
}

export async function showModelProfiles(): Promise<void> {
  if (!rt.sessionManager) {
    vscode.window.showInformationMessage(nativeText("iCode is still starting. Try again in a moment.", "iCode 仍在启动，请稍后再试。"));
    return;
  }
  const models = await rt.sessionManager.listModelProfiles();
  if (!models.length) {
    vscode.window.showInformationMessage(nativeText("No iCode model profiles are configured.", "尚未配置 iCode 模型配置。"));
    return;
  }
  const selected = await vscode.window.showQuickPick(
    models.map((model: ModelSummary) => modelQuickPickItem(model, { activeModelProfileId: rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "" })),
    { placeHolder: nativeText("Select a model profile to inspect", "选择要查看的模型配置") },
  );
  if (!selected) return;
  const profile = await rt.sessionManager.readModelProfile(selected.id);
  await showJsonDocument(`iCode Model Profile: ${selected.label}`, profile);
}

type ModelQuickPickItem = vscode.QuickPickItem & {
  id: string;
};

function modelQuickPickItem(
  model: ModelSummary,
  options: { activeModelProfileId?: string } = {},
): ModelQuickPickItem {
  const isActive = Boolean(options.activeModelProfileId && model.id === options.activeModelProfileId);
  const provider = model.provider ? providerLabel(model.provider) : nativeText("provider unknown", "供应商未知");
  const apiStyle = model.apiStyle ? apiStyleLabel(String(model.apiStyle)) : nativeText("API style unknown", "API 样式未知");
  const modelId = model.modelId || nativeText("model id unknown", "模型 ID 未知");
  const context = model.maxContextTokens ? formatCount(model.maxContextTokens) : nativeText("context unknown", "上下文未知");
  const capabilities = [
    model.stream === false ? nativeText("stream off", "非流式") : nativeText("stream", "流式"),
    model.vision ? nativeText("vision", "视觉") : nativeText("text only", "仅文本"),
  ].join(" · ");
  return {
    label: `${isActive ? "$(circle-filled) " : ""}${model.name || model.id}`,
    description: [
      isActive ? nativeText("current", "当前") : "",
      model.id,
      capabilities,
    ].filter(Boolean).join("  "),
    detail: [
      nativeText(`Provider: ${provider}; API: ${apiStyle}; Model: ${modelId}`, `供应商：${provider}；API：${apiStyle}；模型：${modelId}`),
      nativeText(`Context: ${context}; Image input: ${model.vision ? "yes" : "no"}`, `上下文：${context}；图片输入：${model.vision ? "是" : "否"}`),
    ].join("\n"),
    id: model.id,
  };
}

// ──────────────────────────────────────────────
// Settings / workspace
// ──────────────────────────────────────────────

export async function reloadChrysSettings(): Promise<void> {
  if (!rt.sessionManager) return;
  if (rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText(
      "iCode cannot reload settings while the current task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能重新加载 iCode 设置。请先中断或等待任务完成。",
    ));
    rt.chatPanel?.appendDebugEvent("SettingsReloadBlocked", rt.sessionManager.state);
    return;
  }
  await rt.sessionManager.reloadSettings();
  rt.chatPanel?.setState(chatPanelState());
  vscode.window.showInformationMessage(nativeText("iCode settings reloaded.", "iCode 设置已重新加载。"));
  rt.chatPanel?.appendDebugEvent("SettingsReloaded", "manual");
}

export async function changeWorkspace(targetPath?: string): Promise<void> {
  if (rt.connectionInitialization) await rt.connectionInitialization;
  if (!rt.sessionManager) return;
  if (rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText("Cannot change directory while iCode is busy.", "iCode 忙碌时不能切换目录。"));
    rt.chatPanel?.appendDebugEvent("WorkspaceChangeBlocked", rt.sessionManager.state);
    return;
  }
  if (targetPath?.trim() === "roots") {
    if(!rt.supportsAdditionalDirectories){
      vscode.window.showWarningMessage(nativeText("This iCode CLI does not advertise additional-directory support.","当前 iCode CLI 未声明支持额外工作目录。"));return;
    }
    if (!rt.currentCwd) return;
    const roots = await pickAdditionalDirectories(rt.currentCwd, rt.additionalDirectories ?? []);
    if (!roots || rt.sessionManager.state !== "idle") return;
    const previous = rt.additionalDirectories;
    rt.additionalDirectories = roots;
    if (rt.currentSessionId && rt.extensionContext) {
      const empty = (await rt.sessionManager.history()).messages.length === 0;
      if (empty) { rt.clearPersistedSession(); rt.currentSessionId=null; rt.skipRestoreOnce=true; }
      else rt.persistCurrentSession();
      if (!(await restartBackendConnection(rt.extensionContext, rt.currentBinaryPath ?? undefined))) {
        rt.additionalDirectories = previous;
        return;
      }
      if(empty) {
        rt.currentSessionId=await rt.sessionManager.newSession(rt.currentCwd, roots);
        await refreshRuntimeSnapshot();rt.persistCurrentSession();
      }
    }
    rt.chatPanel?.setState(chatPanelState());
    return;
  }
  const expandedTarget = expandWorkspacePath(targetPath);
  if (expandedTarget) {
    const uri = vscode.Uri.file(expandedTarget);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.Directory) {
        vscode.window.showWarningMessage(nativeText(`Not a directory: ${expandedTarget}`, `不是目录：${expandedTarget}`));
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(nativeText(`Cannot access workspace directory: ${message}`, `无法访问工作区目录：${message}`));
      return;
    }
    await applyWorkspaceChange(expandedTarget);
    return;
  }
  const directory = await pickWorkspaceDirectory(rt.currentCwd ?? undefined);
  if (!directory) return;
  await applyWorkspaceChange(directory);
}

async function applyWorkspaceChange(targetPath: string): Promise<void> {
  const normalizedTarget = path.resolve(targetPath);
  if (rt.currentCwd && path.resolve(rt.currentCwd) === normalizedTarget) return;
  rt.chatPanel?.appendDebugEvent("WorkspaceChangeRequested", normalizedTarget);
  if (workspaceSelectionTarget(Boolean(rt.currentSessionId)) === "restart-backend") {
    if (!rt.extensionContext) return;
    rt.currentCwd = normalizedTarget;
    rt.skipRestoreOnce = true;
    if (!(await restartBackendConnection(rt.extensionContext))) return;
  } else {
    const result = await rt.sessionManager!.setWorkspace(normalizedTarget);
    rt.currentCwd = result.primaryCwd ?? normalizedTarget;
    if(result.workingDirs)rt.additionalDirectories=result.workingDirs.filter(p=>p!==rt.currentCwd);
  }
  rt.persistCurrentSession();
  rt.chatPanel?.setState(chatPanelState());
  rt.sessionTreeProvider?.refresh();
  const displayCwd = rt.currentCwd;
  vscode.window.setStatusBarMessage(nativeText(
    `iCode workspace changed: ${displayCwd}`,
    `iCode 工作区已切换：${displayCwd}`,
  ), 4000);
  rt.chatPanel?.appendDebugEvent("WorkspaceChanged", displayCwd);
}

export function expandWorkspacePath(targetPath?: string): string | undefined {
  const trimmed = targetPath?.trim();
  if (!trimmed) return undefined;
  const withoutQuotes = trimmed.replace(/^["']|["']$/g, "");
  if (withoutQuotes === "~") return os.homedir();
  if (withoutQuotes.startsWith("~/")) return path.join(os.homedir(), withoutQuotes.slice(2));
  return path.isAbsolute(withoutQuotes)
    ? withoutQuotes
    : path.resolve(rt.currentCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(), withoutQuotes);
}

export function managementTabFromArg(arg?: string): "agents" | "models" | "config" | "mcp" {
  const value = arg?.trim().toLowerCase();
  if (value === "models" || value === "model") return "models";
  if (value === "config" || value === "settings") return "config";
  if (value === "mcp") return "mcp";
  return "agents";
}

// ──────────────────────────────────────────────
// History / model profiles
// ──────────────────────────────────────────────

export async function showStructuredHistory(): Promise<void> {
  if (!rt.sessionManager) return;
  const history = await rt.sessionManager.history();
  await showJsonDocument("iCode Structured History", history);
  rt.chatPanel?.appendDebugEvent("SessionHistoryOpened", history.sessionId);

  const sourcePath = findSessionJsonPath(history.sessionId);
  const openSessionJson = nativeText("Open local session.json", "打开本地 session.json");
  const copyPath = nativeText("Copy path", "复制路径");
  const copyJson = nativeText("Copy JSON", "复制 JSON");
  const actions = [
    ...(sourcePath ? [openSessionJson, copyPath] : []),
    copyJson,
  ];
  const action = await vscode.window.showInformationMessage(
    sourcePath
      ? nativeText(`Opened ACP structured history. Local session.json: ${sourcePath}`, `已打开 ACP 结构化历史。本地 session.json：${sourcePath}`)
      : nativeText("Opened ACP structured history. Local session.json was not found on this host.", "已打开 ACP 结构化历史。当前主机未找到本地 session.json。"),
    ...actions,
  );
  if (action === openSessionJson && sourcePath) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
    await vscode.window.showTextDocument(doc, { preview: false });
    rt.chatPanel?.appendDebugEvent("SessionJsonOpened", sourcePath);
  } else if (action === copyPath && sourcePath) {
    await vscode.env.clipboard.writeText(sourcePath);
    vscode.window.showInformationMessage(nativeText("Session path copied.", "会话路径已复制。"));
  } else if (action === copyJson) {
    await vscode.env.clipboard.writeText(JSON.stringify(history, null, 2));
    vscode.window.showInformationMessage(nativeText("Structured session JSON copied.", "结构化会话 JSON 已复制。"));
  }
}

export async function setModelProfile(): Promise<void> {
  if (!rt.sessionManager) return;
  if (rt.sessionManager.state !== "idle") {
    vscode.window.showInformationMessage(nativeText(
      "iCode cannot switch model profiles while the current task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能切换 iCode 模型配置。请先中断或等待任务完成。",
    ));
    rt.chatPanel?.appendDebugEvent("ModelSwitchBlocked", rt.sessionManager.state);
    return;
  }
  const models = await rt.sessionManager.listModelProfiles();
  const activeModelProfileId = rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "";
  const selected = await vscode.window.showQuickPick(
    models.map((model: ModelSummary) => modelQuickPickItem(model, { activeModelProfileId })),
    {
      title: nativeText("iCode Model Profile", "iCode 模型配置"),
      placeHolder: nativeText("Select the active model profile and default for new VSIX sessions", "选择当前模型配置，并作为新 VSIX 会话默认值"),
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!selected) return;
  if (rt.currentSessionId) await rt.sessionManager.setModel(selected.id);
  await persistPreferredModel(selected.id);
  await refreshRuntimeSnapshot();
  rt.chatPanel?.setState(chatPanelState());
  vscode.window.showInformationMessage(nativeText(
    `iCode model profile set to ${selected.id} and saved as the VSIX default.`,
    `iCode 模型配置已切换到 ${selected.id}，并保存为 VSIX 默认值。`,
  ));
  rt.chatPanel?.appendDebugEvent("ModelSwitch", selected.id);
}

// ──────────────────────────────────────────────
// Model dialog (inline)
// ──────────────────────────────────────────────

export async function openModelDialog(selectedModelId?: string): Promise<void> {
  if (!rt.chatPanel) return;
  logInfo("Opening inline Models dialog.");
  rt.chatPanel?.reveal();
  rt.chatPanel?.setModelDialogState({
    models: [],
    profiles: {},
    activeModelProfileId: rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "",
    selectedModelId,
  });
  rt.chatPanel?.modelDialogNotice("info", nativeText("Loading model profiles...", "正在加载模型配置..."));
  await refreshModelDialog();
}

export async function refreshModelDialog(panel = rt.chatPanel): Promise<void> {
  const sessionManager = rt.sessionManager;
  if (panel !== rt.chatPanel) return;
  if (!sessionManager || !panel) {
    modelDialogUnavailable("ModelDialogRefreshUnavailable");
    return;
  }
  panel.setModelDialogBusy(true);
  try {
    logInfo("Refreshing inline Models dialog state.");
    const models = await sessionManager.listModelProfiles();
    const profileEntries = await Promise.all(
      models.map(async (model: ModelSummary) => [model.id, await sessionManager.readModelProfile(model.id)] as const),
    );
    if (panel !== rt.chatPanel || sessionManager !== rt.sessionManager) return;
    logInfo(`Loaded ${models.length} model profile(s).`);
    const state = {
      models,
      profiles: Object.fromEntries(profileEntries),
      activeModelProfileId: rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "",
    };
    panel.setModelDialogState(state);
  } catch (error) {
    modelDialogError(error, panel);
  } finally {
    panel.setModelDialogBusy(false);
  }
}

export async function saveModelFromDialog(model: Record<string, unknown>): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    modelDialogUnavailable("ModelDialogSaveUnavailable");
    return;
  }
  panel.setModelDialogBusy(true);
  try {
    await sessionManager.writeModelProfile(model);
    panel.modelDialogNotice("info", nativeText("Model profile saved.", "模型配置已保存。"));
    await refreshModelDialog(panel);
  } finally {
    panel.setModelDialogBusy(false);
  }
}

export async function deleteModelFromDialog(id: string): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    modelDialogUnavailable("ModelDialogDeleteUnavailable");
    return;
  }
  if (isActiveModelProfile(id) && sessionManager.state !== "idle") {
    panel.modelDialogNotice("warning", nativeText(
      "iCode cannot delete the active model profile while the current task is running.",
      "当前任务运行时不能删除正在使用的 iCode 模型配置。",
    ));
    panel.appendDebugEvent("ModelDeleteBlocked", id);
    return;
  }
  panel.setModelDialogBusy(true);
  try {
    await sessionManager.deleteModelProfile(id);
    panel.appendDebugEvent("ModelDeleted", id);
    panel.modelDialogNotice("info", nativeText(`Model profile ${id} deleted.`, `模型配置 ${id} 已删除。`));
    await refreshModelDialog(panel);
  } finally {
    panel.setModelDialogBusy(false);
  }
}

export async function setActiveModelFromDialog(id: string): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    modelDialogUnavailable("ModelDialogSetActiveUnavailable");
    return;
  }
  if (sessionManager.state !== "idle") {
    panel.modelDialogNotice("warning", nativeText(
      "iCode cannot switch model profiles while the current task is running.",
      "当前任务运行时不能切换 iCode 模型配置。",
    ));
    panel.appendDebugEvent("ModelSwitchBlocked", sessionManager.state);
    return;
  }
  panel.setModelDialogBusy(true);
  try {
    if (rt.currentSessionId) await sessionManager.setModel(id);
    await persistPreferredModel(id);
    await refreshRuntimeSnapshot();
    panel.setState(chatPanelState());
    panel.modelDialogNotice(
      "info",
      id
        ? nativeText("Active model profile updated and saved as the VSIX default.", "当前模型配置已更新，并保存为 VSIX 默认值。")
        : nativeText("Active model profile reset to default and saved as the VSIX default.", "当前模型配置已恢复默认，并保存为 VSIX 默认值。"),
    );
    panel.appendDebugEvent("ModelSwitch", id || "(default)");
    await refreshModelDialog(panel);
  } finally {
    panel.setModelDialogBusy(false);
  }
}

export function modelDialogError(error: unknown, panel = rt.chatPanel): void {
  if (panel !== rt.chatPanel) return;
  const message = error instanceof Error ? error.message : String(error);
  logError(`Model dialog failed: ${message}`);
  rt.chatPanel?.setModelDialogBusy(false);
  rt.chatPanel?.modelDialogNotice("error", message);
}

function modelDialogUnavailable(eventName: string): void {
  const message = startingNotice();
  logWarn(`${eventName}: ${message}`);
  rt.chatPanel?.appendDebugEvent(eventName, "session manager missing");
  rt.chatPanel?.setModelDialogBusy(false);
  rt.chatPanel?.modelDialogNotice("warning", message);
}

function isActiveModelProfile(id: string): boolean {
  const active = rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "";
  return Boolean(id && active && id === active);
}

// ──────────────────────────────────────────────
// Agent dialog (inline)
// ──────────────────────────────────────────────

export async function openAgentDialog(): Promise<void> {
  if (!rt.chatPanel) return;
  logInfo("Opening inline Agents dialog.");
  rt.chatPanel?.reveal();
  rt.chatPanel?.agentDialogNotice("info", nativeText("Loading agent profiles...", "正在加载智能体配置..."));
  await refreshAgentDialog();
}

export async function refreshAgentDialog(panel = rt.chatPanel, updatedAgentName?: string): Promise<void> {
  const sessionManager = rt.sessionManager;
  if (panel !== rt.chatPanel) return;
  if (!sessionManager || !panel) {
    agentDialogUnavailable("AgentDialogRefreshUnavailable");
    return;
  }
  panel.setAgentDialogBusy(true);
  try {
    logInfo("Refreshing inline Agents dialog state.");
    const agents = await sessionManager.listAgentProfiles();
    const profileEntries = await Promise.all(
      agents.map(async (agent) => [agent.name, await sessionManager.readAgentProfile(agent.name)] as const),
    );
    if (panel !== rt.chatPanel || sessionManager !== rt.sessionManager) return;
    logInfo(`Loaded ${agents.length} agent profile(s).`);
    const state = {
      agents,
      updatedAgentName,
      profiles: Object.fromEntries(profileEntries),
      activeAgentName: rt.activeAgentName || process.env.CHRYS_DEFAULT_AGENT || "",
    };
    panel.setAgentDialogState(state);
  } catch (error) {
    agentDialogError(error, panel);
  } finally {
    panel.setAgentDialogBusy(false);
  }
}

export async function saveAgentFromDialog(agent: Record<string, unknown>): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    agentDialogUnavailable("AgentDialogSaveUnavailable");
    return;
  }
  panel.setAgentDialogBusy(true);
  try {
    await sessionManager.writeAgentProfile(agent);
    if (sessionManager.state === "idle") {
      if (rt.currentSessionId) await sessionManager.reloadSettings();
      panel.appendDebugEvent("AgentProfileSaved", "agent profile save");
      panel.agentDialogNotice("info", nativeText("Agent profile saved.", "智能体配置已保存。"));
    } else {
      panel.appendDebugEvent("SettingsReloadDeferred", "agent profile save");
      panel.agentDialogNotice("warning", nativeText(
        "Agent profile saved. Reload settings after the current task finishes to apply it.",
        "智能体配置已保存。请在当前任务结束后重新加载设置以应用。",
      ));
    }
    await refreshAgentDialog(panel, String(agent.name));
  } catch (error) {
    agentDialogError(error, panel);
  } finally {
    panel.setAgentDialogBusy(false);
  }
}

export async function deleteAgentFromDialog(name: string): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    agentDialogUnavailable("AgentDialogDeleteUnavailable");
    return;
  }
  if (isActiveAgentProfile(name) && sessionManager.state !== "idle") {
    panel.agentDialogNotice("warning", nativeText(
      "iCode cannot delete the active agent profile while the current task is running.",
      "当前任务运行时不能删除正在使用的 iCode 智能体配置。",
    ));
    panel.appendDebugEvent("AgentDeleteBlocked", name);
    return;
  }
  panel.setAgentDialogBusy(true);
  try {
    const agents = await sessionManager.listAgentProfiles();
    const profile = agents.find((agent) => agent.name === name);
    if (!profile) throw new Error(nativeText(`Agent profile ${name} was not found.`, `未找到智能体配置 ${name}。`));
    const mutation = agentProfileMutation(profile);
    const result = mutation === "reset"
      ? await sessionManager.resetAgentProfile(name)
      : await sessionManager.deleteAgentProfile(name);
    const outcome = mutation === "reset"
      ? (result.changed === true ? "restored_builtin" : "already_builtin")
      : (result.deleted === true ? "deleted" : "not_found");
    if (rt.currentSessionId && sessionManager.state === "idle") {
      await sessionManager.reloadSettings();
      panel.appendDebugEvent("SettingsReloaded", `agent profile ${mutation}`);
    } else {
      panel.appendDebugEvent("SettingsReloadDeferred", `agent profile ${mutation}`);
    }
    panel.appendDebugEvent("AgentDeleteResult", `${name}: ${outcome}`);
    if (outcome === "restored_builtin") {
      panel.agentDialogNotice("info", nativeText(
        `Removed the user override for ${name}; the iCode built-in profile is active again.`,
        `已移除 ${name} 的用户覆盖，并重新启用 iCode 内置配置。`,
      ));
    } else if (outcome === "already_builtin") {
      panel.agentDialogNotice("info", nativeText(
        `${name} is already using the iCode built-in profile.`,
        `${name} 已在使用 iCode 内置配置。`,
      ));
    } else if (outcome === "deleted") {
      panel.agentDialogNotice("info", nativeText(
        `Agent profile ${name} deleted.`,
        `智能体配置 ${name} 已删除。`,
      ));
    } else {
      panel.agentDialogNotice("warning", nativeText(
        `Agent profile ${name} was not found.`,
        `未找到智能体配置 ${name}。`,
      ));
    }
    await refreshAgentDialog(panel, name);
  } catch (error) {
    agentDialogError(error, panel);
  } finally {
    panel.setAgentDialogBusy(false);
  }
}

export async function setActiveAgentFromDialog(name: string): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    agentDialogUnavailable("AgentDialogSetActiveUnavailable");
    return;
  }
  if (sessionManager.state !== "idle") {
    panel.agentDialogNotice("warning", nativeText(
      "iCode cannot switch agents while the current task is running.",
      "当前任务运行时不能切换 iCode 智能体。",
    ));
    panel.appendDebugEvent("AgentSwitchBlocked", sessionManager.state);
    return;
  }
  panel.setAgentDialogBusy(true);
  try {
    if (!(await selectNextSessionAgent(name))) {
      await sessionManager.switchAgent(name);
      rememberPreferredAgent(name);
      await refreshRuntimeSnapshot();
    }
    panel.setState(chatPanelState());
    panel.agentDialogNotice("info", nativeText("Active agent profile updated.", "当前智能体配置已更新。"));
    panel.appendDebugEvent("AgentSwitch", name);
    await refreshAgentDialog(panel);
  } finally {
    panel.setAgentDialogBusy(false);
  }
}

function agentDialogError(error: unknown, panel = rt.chatPanel): void {
  if (panel !== rt.chatPanel) return;
  const message = error instanceof Error ? error.message : String(error);
  logError(`Agent dialog failed: ${message}`);
  rt.chatPanel?.setAgentDialogBusy(false);
  rt.chatPanel?.agentDialogNotice("error", message);
}

function agentDialogUnavailable(eventName: string): void {
  const message = startingNotice();
  logWarn(`${eventName}: ${message}`);
  rt.chatPanel?.appendDebugEvent(eventName, "session manager missing");
  rt.chatPanel?.setAgentDialogBusy(false);
  rt.chatPanel?.agentDialogNotice("warning", message);
}

function isActiveAgentProfile(name: string): boolean {
  const active = rt.activeAgentName || process.env.CHRYS_DEFAULT_AGENT || "";
  return Boolean(name && active && name === active);
}

// ──────────────────────────────────────────────
// Management commands (model/agent CRUD)
// ──────────────────────────────────────────────

export async function createModelProfile(): Promise<void> {
  await openModelDialog("__new__");
}

export async function deleteModelProfile(): Promise<void> {
  if (!rt.sessionManager) return;
  const models = await rt.sessionManager.listModelProfiles();
  const activeModelProfileId = rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "";
  const selected = await vscode.window.showQuickPick(
    models.map((model: ModelSummary) => modelQuickPickItem(model, { activeModelProfileId })),
    { placeHolder: nativeText("Delete which model profile?", "删除哪个模型配置？") },
  );
  if (!selected) return;
  if (isActiveModelProfile(selected.id) && rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText(
      "iCode cannot delete the active model profile while the current task is running.",
      "当前任务运行时不能删除正在使用的 iCode 模型配置。",
    ));
    rt.chatPanel?.appendDebugEvent("ModelDeleteBlocked", selected.id);
    return;
  }
  const deleteLabel = nativeText("Delete", "删除");
  const confirmed = await vscode.window.showWarningMessage(
    nativeText(`Delete model profile ${selected.id}?`, `删除模型配置 ${selected.id}？`),
    { modal: true },
    deleteLabel,
  );
  if (confirmed !== deleteLabel) return;
  await rt.sessionManager.deleteModelProfile(selected.id);
  rt.chatPanel?.appendDebugEvent("ModelDeleted", selected.id);
}

export async function deleteAgentProfile(): Promise<void> {
  if (!rt.sessionManager) return;
  const agents = await rt.sessionManager.listAgentProfiles();
  const selected = await vscode.window.showQuickPick(
    agents
      .filter((agent: ProfileSummary) => agent.builtin !== true)
      .map((agent: ProfileSummary) => ({
        ...agentQuickPickItem(agent, { activeAgentName: rt.activeAgentName, includeSubAgentOnly: true }),
        name: agent.name,
      })),
    { placeHolder: nativeText("Delete which user agent profile?", "删除哪个用户智能体配置？") },
  );
  if (!selected) return;
  if (isActiveAgentProfile(selected.name) && rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText(
      "iCode cannot delete the active agent profile while the current task is running.",
      "当前任务运行时不能删除正在使用的 iCode 智能体配置。",
    ));
    rt.chatPanel?.appendDebugEvent("AgentDeleteBlocked", selected.name);
    return;
  }
  const deleteLabel = nativeText("Delete", "删除");
  const confirmed = await vscode.window.showWarningMessage(
    nativeText(`Delete agent profile ${selected.name}?`, `删除智能体配置 ${selected.name}？`),
    { modal: true },
    deleteLabel,
  );
  if (confirmed !== deleteLabel) return;
  await rt.sessionManager.deleteAgentProfile(selected.name);
  if (rt.sessionManager.state === "idle") {
    await rt.sessionManager.reloadSettings();
    rt.chatPanel?.appendDebugEvent("SettingsReloaded", "agent profile delete");
  } else {
    rt.chatPanel?.appendDebugEvent("SettingsReloadDeferred", "agent profile delete");
  }
  rt.chatPanel?.appendDebugEvent("AgentDeleted", selected.name);
}

export async function testMcpServer(): Promise<void> {
  if (!rt.sessionManager) return;
  const raw = await vscode.window.showInputBox({
    prompt: nativeText("HTTP MCP server JSON config", "HTTP MCP server JSON 配置"),
    placeHolder: "{\"name\":\"server\",\"transport\":\"http\",\"url\":\"https://example.com/mcp\"}",
  });
  if (!raw) return;
  let server: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
    server = parsed as Record<string, unknown>;
  } catch (err) {
    vscode.window.showErrorMessage(`Invalid MCP JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (server.transport !== "http") {
    vscode.window.showWarningMessage(nativeText(
      "MCP test supports HTTP MCP servers only. Client-supplied stdio is not run from the VS Code extension.",
      "MCP 测试只支持 HTTP MCP server。VS Code 扩展不会运行客户端提供的 stdio MCP。",
    ));
    return;
  }
  const result = await rt.sessionManager.testMcpServer(server);
  const ok = result.ok === true;
  const message = typeof result.message === "string" ? result.message : JSON.stringify(result);
  if (ok) {
    vscode.window.showInformationMessage(`MCP test passed: ${message}`);
  } else {
    vscode.window.showWarningMessage(`MCP test failed: ${message}`);
  }
}

export async function setConfigOption(): Promise<void> {
  if (!rt.sessionManager) return;
  const optionsPayload = await rt.sessionManager.configOptions();
  const options = Array.isArray(optionsPayload.options) ? optionsPayload.options : [];
  const selected = await vscode.window.showQuickPick(
    options.map((option: Record<string, unknown>) => ({
      label: String(option.key ?? option.envKey ?? ""),
      description: String(option.envKey ?? ""),
      detail: String(option.value ?? ""),
    })).filter((item: { label: string }) => item.label),
    { placeHolder: "Select iCode config option" },
  );
  if (!selected) return;
  const value = await vscode.window.showInputBox({
    prompt: `Set ${selected.label}`,
    value: selected.detail,
  });
  if (value === undefined) return;
  const result = await rt.sessionManager.setConfigOption(selected.label, value);
  rememberPreferredConfigOption(
    typeof result.key === "string" ? result.key : selected.label,
    typeof result.value === "string" ? result.value : value,
  );
  rt.chatPanel?.setState(chatPanelState());
  vscode.window.showInformationMessage(nativeText(`Updated iCode config ${selected.label}.`, `iCode 配置 ${selected.label} 已更新。`));
}

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

function buildDiagnosticsReportContent(): string {
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

type DoctorAction =
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

type DoctorItem = vscode.QuickPickItem & {
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

function buildDoctorItems(): DoctorItem[] {
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

function doctorCheck(name: string, ok: boolean, detail: string): DoctorItem {
  return {
    label: ok ? `$(pass) ${name}` : `$(warning) ${name}`,
    description: ok ? nativeText("OK", "正常") : nativeText("Needs attention", "需要处理"),
    detail,
  };
}

async function copyRecentLogsFromDoctor(): Promise<void> {
  const logs = redactSensitiveDiagnosticsText(rt.logLines.slice(-250).join("\n")) || "(no logs captured)";
  await vscode.env.clipboard.writeText(logs);
  rt.chatPanel?.appendDebugEvent("DoctorLogsCopied", `${logs.length} chars`);
  vscode.window.showInformationMessage(nativeText("Recent iCode logs copied.", "近期 iCode 日志已复制。"));
}

async function restartAcpFromDoctor(): Promise<void> {
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

async function reloadWindowFromDoctor(): Promise<void> {
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

function diagnosticsHealthChecks(currentBinaryPath: string): string[] {
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

function diagnosticsPreferredDefaults(): { agent: string; modelProfile: string; approvalMode: string } {
  return {
    agent: rt.preferredAgentName || "Code",
    modelProfile: rt.preferredModelProfileId || "(default)",
    approvalMode: rt.preferredApprovalMode || "auto",
  };
}

function diagnosticsMismatchChecklist(
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

function themeResolutionLine(configuredTheme: string): string {
  const envTheme = process.env.CHRYS_THEME || "(unset)";
  const active = rt.currentTheme;
  const fallback = themeFallbackReason(configuredTheme);
  return `configured=${configuredTheme}; active/frontend=${active}; CHRYS_THEME=${envTheme}${fallback ? `; fallback=${fallback}` : ""}`;
}

function localizedThemeResolutionLine(config: vscode.WorkspaceConfiguration): string {
  const configuredTheme = config.get<string>("ui.theme") || "auto";
  const fallback = themeFallbackReason(configuredTheme);
  const base = nativeText(
    `configured=${configuredTheme}; active=${rt.currentTheme}; CHRYS_THEME=${process.env.CHRYS_THEME || "(unset)"}`,
    `设置=${configuredTheme}；当前=${rt.currentTheme}；CHRYS_THEME=${process.env.CHRYS_THEME || "（未设置）"}`,
  );
  if (!fallback) return base;
  return nativeText(`${base}; fallback=${fallback}`, `${base}；回退=${fallback}`);
}

function themeFallbackReason(configuredTheme: string): string {
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

function diagnosticsFrontendHostState(
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

function buildDiagnosticsSummary(): string {
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

const OPERATION_GUARD_EVENT_PATTERN = /(?:Blocked|Deferred)$/;
const SESSION_LIFECYCLE_EVENT_PATTERN = /^(?:AcpProcess|Session(?:Startup|Restore|Initialization|New))/;

function sessionLifecycleEvents(): typeof rt.debugEvents {
  return rt.debugEvents.filter((event) => SESSION_LIFECYCLE_EVENT_PATTERN.test(event.kind));
}

function diagnosticsFrontendEventSummaryLines(limit = 200): string[] {
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

function diagnosticsSessionLifecycleLines(limit = 40): string[] {
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

function diagnosticsOperationGuardLines(limit = 40): string[] {
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

function formatDebugEventLine(event: { time: number; kind: string; detail: string }): string {
  const timestamp = new Date(event.time).toISOString();
  return `- ${timestamp} [${event.kind}] ${event.detail}`;
}

function recentToolLinesLocal(localized = false): string[] {
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

function recentToolStatusLabel(tool: ToolSnapshot, localized: boolean): string {
  if (tool.rawOutput === undefined) {
    return localized ? nativeText("started", "已开始") : "started";
  }
  return localized ? nativeText("updated", "已更新") : "updated";
}

function approvalJudgeLines(localized = false, limit = 20): string[] {
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

function approvalReviewStatusLabel(status: "judging" | "approved" | "flagged", localized: boolean): string {
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

function diagnosticsInputParityLines(limit = 40): string[] {
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

function toolRendererCoverageLines(): string[] {
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

// ──────────────────────────────────────────────
// File composer helpers
// ──────────────────────────────────────────────

export async function attachFileToComposer(arg?: string): Promise<void> {
  const panel = rt.chatPanel;
  if (!panel) return;
  if (rt.sessionManager && rt.sessionManager.state !== "idle") {
    vscode.window.showInformationMessage(nativeText(
      "Full file attach is available after the current turn finishes. Use @file mention for queued follow-up text.",
      "完整文件附加请在当前轮次结束后使用。排队追加文本可以先使用 @file 引用。",
    ));
    panel.appendDebugEvent("FileAttachBlocked", rt.sessionManager.state);
    return;
  }
  const kind = arg?.trim() || (await vscode.window.showQuickPick([
    {label:nativeText("File", "文件"),sourceKind:"file"},
    {label:nativeText("Editor selection / cursor context", "编辑器选区 / 光标上下文"),sourceKind:"selection"},
    {label:nativeText("Problems", "问题诊断"),sourceKind:"problems"},
  ], {title:nativeText("Attach context", "附加上下文")}))?.sourceKind;
  if (!kind) return;
  if (kind === "selection") {
    const item=editorAttachment();
    if(item)panel.addTextAttachment(item);
    else vscode.window.showInformationMessage(nativeText("Select a text editor first.","请先选择文本编辑器。"));
    return;
  }
  if (kind === "problems") {panel.addTextAttachment(problemsAttachment());return;}
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: rt.currentCwd ? vscode.Uri.file(rt.currentCwd) : undefined,
    title: nativeText("Attach file to iCode prompt", "附加文件到 iCode 输入框"),
  });
  const uri = selected?.[0];
  if (!uri) return;

  const bytes = await vscode.workspace.fs.readFile(uri);
  const maxBytes = 120_000;
  const truncated = bytes.byteLength > maxBytes;
  const text = new TextDecoder("utf-8").decode(truncated ? bytes.slice(0, maxBytes) : bytes);
  const relativePath = vscode.workspace.asRelativePath(uri);
  const language = languageFromPath(relativePath);
  const suffix = truncated
    ? nativeText(`\n\n[File truncated to ${maxBytes} bytes before sending.]`, `\n\n[发送前已将文件截断到 ${maxBytes} bytes。]`)
    : "";
  panel.addTextAttachment(attachment(relativePath + ":1-" + text.split("\n").length + (truncated ? " …" : ""), "@file " + relativePath + ":1-" + text.split("\n").length + "\n```" + language + "\n" + text + "\n```" + suffix));
  panel.appendDebugEvent(
    "FileAttached",
    `${relativePath} (${Math.min(bytes.byteLength, maxBytes)}/${bytes.byteLength} bytes${truncated ? ", truncated" : ""})`,
  );
}

export async function insertFileMention(existingText?: string): Promise<void> {
  const panel = rt.chatPanel;
  if (!panel) return;
  const uri = await pickWorkspaceFile();
  if (!uri) return;
  const relativePath = rt.currentCwd ? path.relative(rt.currentCwd, uri.fsPath) : vscode.workspace.asRelativePath(uri);
  const mention = `@file ${relativePath}`;
  const base = existingText?.trimEnd() ?? "";
  panel.setComposer(base ? `${base} ${mention} ` : `${mention} `);
  panel.appendDebugEvent("FileMentionInserted", relativePath);
}

type WorkspaceSearchItem = vscode.QuickPickItem & {
  itemType: "match" | "searchView" | "copyResults" | "insertComposer";
  uri?: vscode.Uri;
  line?: number;
  preview?: string;
};

export async function searchWorkspace(initialQuery?: string): Promise<void> {
  const cwd = rt.currentCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    showInlineNotice("warning", nativeText("No workspace directory selected.", "尚未选择工作区目录。"));
    return;
  }

  const query = (initialQuery?.trim() || await vscode.window.showInputBox({
    title: nativeText("Search iCode workspace", "搜索 iCode 工作区"),
    prompt: nativeText("Open VS Code Search scoped to the current iCode workspace.", "打开限定在当前 iCode 工作区的 VS Code 搜索。"),
    placeHolder: nativeText("Text to search", "要搜索的文本"),
  }) || "").trim();
  if (!query) return;

  await openVsCodeSearchView(query, cwd);
}

export async function grepWorkspace(initialQuery?: string): Promise<void> {
  const cwd = rt.currentCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    showInlineNotice("warning", nativeText("No workspace directory selected.", "尚未选择工作区目录。"));
    return;
  }

  const query = (initialQuery?.trim() || await vscode.window.showInputBox({
    title: nativeText("Grep iCode workspace", "检索 iCode 工作区"),
    prompt: nativeText("Show matching lines from the current workspace.", "从当前工作区中列出匹配行。"),
    placeHolder: nativeText("Text to search", "要搜索的文本"),
  }) || "").trim();
  if (!query) return;

  const results: WorkspaceSearchItem[] = [];
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(cwd, "**/*"),
    "**/{.git,node_modules,dist,out,build,coverage,.venv,venv,__pycache__}/**",
    3000,
  );
  const needle = query.toLowerCase();
  const maxBytes = 1_000_000;
  let skippedLarge = 0;
  let skippedBinary = 0;
  let failedReads = 0;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: nativeText(`Searching iCode workspace: ${query}`, `正在检索 iCode 工作区：${query}`),
    cancellable: true,
  }, async (progress, token) => {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      if (token.isCancellationRequested || results.length >= 80) break;
      const uri = files[fileIndex];
      if (fileIndex % 50 === 0) {
        progress.report({
          message: nativeText(
            `${fileIndex}/${files.length} files, ${results.length} matches`,
            `${fileIndex}/${files.length} 个文件，${results.length} 个匹配`,
          ),
        });
      }
      let bytes: Uint8Array;
      try {
        bytes = await vscode.workspace.fs.readFile(uri);
      } catch (err) {
        failedReads += 1;
        logError(`Workspace search could not read ${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (bytes.byteLength > maxBytes) {
        skippedLarge += 1;
        continue;
      }
      if (bytes.includes(0)) {
        skippedBinary += 1;
        continue;
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length && results.length < 80; index += 1) {
        const lineText = lines[index];
        if (!lineText.toLowerCase().includes(needle)) continue;
        const line = index + 1;
        const relativePath = path.relative(cwd, uri.fsPath);
        const preview = lineText.trim().slice(0, 220);
        results.push({
          itemType: "match",
          label: `${relativePath}:${line}`,
          description: preview,
          detail: uri.fsPath,
          uri,
          line,
          preview,
        });
      }
    }
  });

  const skipped = skippedLarge + skippedBinary;
  const searchStats = nativeText(
    `${results.length} result(s), ${files.length} file(s), ${skipped} skipped, ${failedReads} failed`,
    `${results.length} 个结果，${files.length} 个文件，跳过 ${skipped} 个，失败 ${failedReads} 个`,
  );
  rt.chatPanel?.appendDebugEvent("WorkspaceGrep", `${query} (${searchStats})`);
  if (!results.length) {
    const openSearch = nativeText("Open Search View", "打开搜索视图");
    const selected = await vscode.window.showInformationMessage(nativeText(
      `No results for "${query}". Scanned ${files.length} file(s); skipped ${skipped}; failed ${failedReads}.`,
      `没有找到 “${query}”。已扫描 ${files.length} 个文件；跳过 ${skipped} 个；失败 ${failedReads} 个。`,
    ), openSearch);
    if (selected === openSearch) {
      await openVsCodeSearchView(query, cwd);
    }
    return;
  }
  if (failedReads > 0) {
    vscode.window.showWarningMessage(nativeText(
      `Search found ${results.length} result(s), but ${failedReads} file(s) could not be read.`,
      `搜索找到 ${results.length} 个结果，但有 ${failedReads} 个文件无法读取。`,
    ));
  }

  const resultText = formatWorkspaceSearchResults(query, cwd, results, searchStats);
  const picked = await vscode.window.showQuickPick([
    {
      itemType: "searchView" as const,
      label: nativeText("$(search) Open all results in VS Code Search", "$(search) 在 VS Code 搜索中打开全部结果"),
      description: nativeText("Use the native Search view for full results, filters, and replace.", "使用原生搜索视图查看完整结果、过滤和替换。"),
      detail: query,
    },
    {
      itemType: "copyResults" as const,
      label: nativeText("$(copy) Copy matches", "$(copy) 复制匹配结果"),
      description: nativeText("Copy the shown grep results as text.", "将当前检索结果复制为文本。"),
      detail: searchStats,
    },
    {
      itemType: "insertComposer" as const,
      label: nativeText("$(edit) Insert matches into composer", "$(edit) 插入匹配结果到输入框"),
      description: nativeText("Use these matches as context for the next agent prompt.", "把这些匹配结果作为下一条 agent 提示的上下文。"),
      detail: searchStats,
    },
    ...results,
  ], {
    title: nativeText(`Search: ${query}`, `搜索：${query}`),
    placeHolder: nativeText(`${searchStats}. Select one to open, or open Search view.`, `${searchStats}。选择一个打开，或进入搜索视图。`),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;
  if (picked.itemType === "searchView") {
    await openVsCodeSearchView(query, cwd);
    return;
  }
  if (picked.itemType === "copyResults") {
    await vscode.env.clipboard.writeText(resultText);
    vscode.window.showInformationMessage(nativeText("Search results copied.", "搜索结果已复制。"));
    rt.chatPanel?.appendDebugEvent("WorkspaceGrepCopied", `${query} (${results.length})`);
    return;
  }
  if (picked.itemType === "insertComposer") {
    rt.chatPanel?.setComposer(resultText);
    rt.chatPanel?.appendDebugEvent("WorkspaceGrepInserted", `${query} (${results.length})`);
    return;
  }
  if (!picked.uri || picked.line === undefined) return;
  const doc = await vscode.workspace.openTextDocument(picked.uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  const position = new vscode.Position(Math.max(0, picked.line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function formatWorkspaceSearchResults(query: string, cwd: string, results: WorkspaceSearchItem[], searchStats: string): string {
  const lines = [
    nativeText(`Search results for "${query}"`, `“${query}” 的搜索结果`),
    nativeText(`Workspace: ${cwd}`, `工作区：${cwd}`),
    searchStats,
    "",
    ...results
      .filter((item) => item.itemType === "match")
      .map((item) => `- ${item.label}${item.preview ? `: ${item.preview}` : ""}`),
  ];
  return lines.join("\n").trimEnd();
}

async function openVsCodeSearchView(query: string, cwd: string): Promise<void> {
  try {
    const args: Record<string, unknown> = {
      query,
      triggerSearch: true,
      isRegex: false,
      isCaseSensitive: false,
      matchWholeWord: false,
    };
    const includePattern = searchIncludePattern(cwd);
    if (includePattern) {
      args.filesToInclude = includePattern;
    }
    await vscode.commands.executeCommand("workbench.action.findInFiles", args);
    rt.chatPanel?.appendDebugEvent("WorkspaceSearchView", query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Failed to open VS Code Search view: ${message}`);
    vscode.window.showWarningMessage(nativeText(`Could not open VS Code Search view: ${message}`, `无法打开 VS Code 搜索视图：${message}`));
  }
}

function searchIncludePattern(cwd: string): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd));
  if (!folder) return cwd;
  const relative = path.relative(folder.uri.fsPath, cwd).replaceAll(path.sep, "/");
  if (!relative || relative === ".") return undefined;
  return `${relative}/**`;
}

export async function findWorkspaceFile(initialQuery?: string): Promise<void> {
  const uri = await pickWorkspaceFile(initialQuery?.trim());
  if (!uri) return;
  await vscode.window.showTextDocument(uri, { preview: true });
  const relativePath = rt.currentCwd ? path.relative(rt.currentCwd, uri.fsPath) : vscode.workspace.asRelativePath(uri);
  rt.chatPanel?.appendDebugEvent("WorkspaceFileOpen", relativePath);
}

export async function pickWorkspaceFile(initialQuery?: string): Promise<vscode.Uri | undefined> {
  if (!rt.currentCwd) {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: nativeText("Select file to mention", "选择要引用的文件"),
    });
    return selected?.[0];
  }

  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(rt.currentCwd, "**/*"),
    "**/{.git,node_modules,dist,out,build,coverage,.venv,venv,__pycache__}/**",
    3000,
  );
  const openItems = openEditorFileItems();
  const openPaths = new Set(openItems.map((item) => item.uri.fsPath));
  const query = initialQuery?.trim().toLowerCase() || "";
  const items = [
    ...openItems,
    ...files
      .filter((uri: vscode.Uri) => !openPaths.has(uri.fsPath))
      .map((uri: vscode.Uri) => {
        const relativePath = path.relative(rt.currentCwd!, uri.fsPath);
        return { label: relativePath, description: path.dirname(relativePath), detail: nativeText("Workspace file", "工作区文件"), uri };
      }),
  ]
    .filter((item) => !query || `${item.label} ${item.description} ${item.detail}`.toLowerCase().includes(query))
    .sort((left, right) => {
      const leftOpen = left.detail?.startsWith("Open") ? 0 : 1;
      const rightOpen = right.detail?.startsWith("Open") ? 0 : 1;
      return leftOpen - rightOpen || left.label.localeCompare(right.label);
    });
  if (!items.length) {
    if (query) {
      vscode.window.showInformationMessage(nativeText(`No workspace files match "${initialQuery}".`, `没有匹配 “${initialQuery}” 的工作区文件。`));
      return undefined;
    }
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(rt.currentCwd),
      title: nativeText("Select file to mention", "选择要引用的文件"),
    });
    return selected?.[0];
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: initialQuery
      ? nativeText(`Open or mention a file matching "${initialQuery}"`, `打开或引用匹配 “${initialQuery}” 的文件`)
      : nativeText("Mention an open or workspace file", "引用已打开文件或工作区文件"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.uri;
}

export function openEditorFileItems(): Array<{ label: string; description: string; detail: string; uri: vscode.Uri }> {
  const byPath = new Map<string, vscode.Uri>();
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file") {
    byPath.set(activeUri.fsPath, activeUri);
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.scheme === "file") {
      byPath.set(editor.document.uri.fsPath, editor.document.uri);
    }
  }
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.scheme === "file") {
        byPath.set(input.uri.fsPath, input.uri);
      }
    }
  }
  return [...byPath.values()]
    .map((uri) => {
      const relativePath = rt.currentCwd ? path.relative(rt.currentCwd, uri.fsPath) : vscode.workspace.asRelativePath(uri);
      return {
        label: relativePath,
        description: path.dirname(relativePath),
        detail: uri.fsPath === activeUri?.fsPath
          ? nativeText("Open file - active editor", "已打开文件 - 当前编辑器")
          : nativeText("Open file", "已打开文件"),
        uri,
      };
    });
}

// ──────────────────────────────────────────────
// Terminal / file navigation
// ──────────────────────────────────────────────

export function openWorkspaceShell(command?: string): void {
  const cwd = rt.currentCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const normalizedCwd = cwd ? path.resolve(cwd) : undefined;
  const terminalCwdChanged = normalizedCwd && rt.workspaceTerminalCwd && path.resolve(rt.workspaceTerminalCwd) !== normalizedCwd;
  if (terminalCwdChanged && rt.workspaceTerminal && !rt.workspaceTerminal.exitStatus) {
    rt.workspaceTerminal.dispose();
    rt.chatPanel?.appendDebugEvent("ShellRecreated", `${rt.workspaceTerminalCwd} -> ${normalizedCwd}`);
    rt.workspaceTerminal = null;
    rt.workspaceTerminalCwd = null;
  }
  if (!rt.workspaceTerminal || rt.workspaceTerminal.exitStatus) {
    rt.workspaceTerminal = vscode.window.createTerminal({
      name: "iCode Shell",
      cwd: normalizedCwd,
    });
    rt.workspaceTerminalCwd = normalizedCwd ?? null;
  }
  const terminal = rt.workspaceTerminal;
  terminal.show();
  const trimmedCommand = command?.trim();
  if (trimmedCommand) {
    terminal.sendText(trimmedCommand, true);
    vscode.window.setStatusBarMessage(nativeText(
      `iCode Shell: running ${trimmedCommand.slice(0, 80)}`,
      `iCode 终端：正在运行 ${trimmedCommand.slice(0, 80)}`,
    ), 3500);
    rt.chatPanel?.appendDebugEvent("ShellCommand", `${normalizedCwd ?? "(default cwd)"} :: ${trimmedCommand.slice(0, 120)}`);
  } else {
    vscode.window.setStatusBarMessage(nativeText(
      `iCode Shell opened in ${normalizedCwd ?? "default terminal cwd"}`,
      `iCode 终端已打开：${normalizedCwd ?? "默认终端目录"}`,
    ), 3500);
    rt.chatPanel?.appendDebugEvent("ShellOpened", normalizedCwd ?? "(default cwd)");
  }
}

export async function openToolDiff(toolCallId: string): Promise<void> {
  const snapshot = rt.toolSnapshots.get(toolCallId);
  const diff = snapshot ? diffFromSnapshot(snapshot) : null;
  if (!diff) {
    vscode.window.showInformationMessage(nativeText("No diff is available for this tool call.", "这个工具调用没有可用差异。"));
    return;
  }

  const safeId = encodeURIComponent(`${rt.tabId}:${toolCallId}`);
  const left = vscode.Uri.parse(`chrys-diff:/${safeId}/before/${encodeURIComponent(diff.label)}`);
  const right = vscode.Uri.parse(`chrys-diff:/${safeId}/after/${encodeURIComponent(diff.label)}`);
  rt.diffDocuments.set(left.path, diff.before);
  rt.diffDocuments.set(right.path, diff.after);
  await vscode.commands.executeCommand("vscode.diff", left, right, `iCode Diff: ${diff.label}`);
}

export async function openWorkspaceFile(filePath: string, line?: number): Promise<void> {
  if (!rt.currentCwd) {
    const change = nativeText("Change Workspace", "切换工作区");
    rt.chatPanel?.appendDebugEvent("WorkspaceFileOpenFailed", `${filePath}: no workspace`);
    const selected = await vscode.window.showWarningMessage(
      nativeText(
        `Cannot open ${filePath} because no iCode workspace is selected.`,
        `无法打开 ${filePath}，因为尚未选择 iCode 工作区。`,
      ),
      change,
    );
    if (selected === change) {
      await changeWorkspace();
    }
    return;
  }
  const uri = vscode.Uri.file(requirePathJoin(rt.currentCwd, filePath));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    if (line !== undefined && Number.isFinite(line) && line > 0) {
      const position = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    rt.chatPanel?.appendDebugEvent("WorkspaceFileOpen", `${filePath}${line ? `:${line}` : ""}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rt.chatPanel?.appendDebugEvent("WorkspaceFileOpenFailed", `${filePath}: ${message}`);
    const openSearch = nativeText("Open Search", "打开搜索");
    const selected = await vscode.window.showWarningMessage(
      nativeText(`Unable to open ${filePath}: ${message}`, `无法打开 ${filePath}：${message}`),
      openSearch,
    );
    if (selected === openSearch) {
      await searchWorkspace(path.basename(filePath));
    }
  }
}

export function requirePathJoin(base: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(base, target);
}

// ──────────────────────────────────────────────
// JSON document
// ──────────────────────────────────────────────

export async function showJsonDocument(title: string, value: unknown): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({
    content: JSON.stringify(value, null, 2),
    language: "json",
  });
  await vscode.window.showTextDocument(doc, { preview: true });
  logInfo(title);
}

// ──────────────────────────────────────────────
// Language detection
// ──────────────────────────────────────────────

export function languageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "md":
      return "markdown";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
      return "html";
    default:
      return "";
  }
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

async function _deleteSessionById(sessionId: string, cwd?: string): Promise<void> {
  const { deleteSessionById } = await import("../extension");
  await deleteSessionById(sessionId, cwd);
  refreshOpenSessionsDialog();
}

// ──────────────────────────────────────────────
// Theme picker
// ──────────────────────────────────────────────

type LanguageSetting = "auto" | "en" | "zh-CN";

function normalizeLanguageSetting(value: string | undefined): LanguageSetting | undefined {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "auto") return "auto";
  if (normalized === "en" || normalized === "en-us" || normalized === "en-gb") return "en";
  if (normalized === "zh" || normalized === "zh-cn") return "zh-CN";
  return undefined;
}

export async function pickLanguageFromList(arg?: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("chrys");
  const configured = normalizeLanguageSetting(config.get<string>("ui.language")) ?? "auto";
  const current = resolveUiLanguage(configured, vscode.env.language);
  const languages: Array<{ id: LanguageSetting; name: string; detail: string }> = [
    {
      id: "auto",
      name: nativeText("Auto", "自动"),
      detail: nativeText(
        "Follow the VS Code display language.",
        "跟随 VS Code 显示语言。",
      ),
    },
    {
      id: "en",
      name: nativeText("English", "英文"),
      detail: nativeText("Use English UI text.", "使用英文界面。"),
    },
    {
      id: "zh-CN",
      name: nativeText("Simplified Chinese", "简体中文"),
      detail: nativeText("Use Simplified Chinese UI text.", "使用简体中文界面。"),
    },
  ];

  const direct = normalizeLanguageSetting(arg);
  if (direct) {
    const directLabel = languages.find((language) => language.id === direct)?.name ?? direct;
    await applyLanguageSelection(direct, directLabel, config, configured);
    return;
  }

  const items = languages.map((language) => ({
    label: language.name,
    description: language.id === "auto" ? nativeText(`active: ${current}`, `当前：${current}`) : language.id,
    detail: language.detail,
    id: language.id,
    picked: configured === language.id,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: nativeText("Select iCode language", "选择 iCode 语言"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected) return;
  await applyLanguageSelection(selected.id, selected.label, config, configured);
}

async function applyLanguageSelection(
  languageSetting: LanguageSetting,
  label: string,
  workspaceConfig: vscode.WorkspaceConfiguration,
  previousSetting: LanguageSetting,
): Promise<void> {
  if (previousSetting === languageSetting) return;
  await workspaceConfig.update("ui.language", languageSetting, vscode.ConfigurationTarget.Global);
  rt.sessionTreeProvider?.refresh();
  rt.chatPanel?.setState(chatPanelState());
  rt.chatPanel?.appendDebugEvent("LanguageChanged", `setting=${languageSetting}; active=${resolveUiLanguage(languageSetting, vscode.env.language)}`);
  vscode.window.showInformationMessage(nativeText(
    `iCode language changed to ${label}.`,
    `iCode 语言已切换到 ${label}。`,
  ));
}

export async function pickThemeFromList(arg?: string): Promise<void> {
  if (!rt.chatPanel) return;
  const themeLabels: Partial<Record<UiTheme, string>> = {
    chrys: "iCode",
    "chrys-ansi": "iCode ANSI",
  };
  const themes: Array<{ id: UiTheme | "auto"; name: string; detail: string }> = [
    {
      id: "auto",
      name: "Auto",
      detail: nativeText("Follow CHRYS_THEME when it is a supported TUI theme; otherwise fall back to chrys.", "当 CHRYS_THEME 是受支持的 TUI 主题时跟随；否则回退到 chrys。"),
    },
    ...SUPPORTED_UI_THEME_IDS.map((id) => ({
      id,
      name: themeLabels[id] ?? id,
      detail: nativeText("Mirrors the TUI theme palette.", "镜像 TUI 主题配色。"),
    })),
  ];
  const config = vscode.workspace.getConfiguration("chrys");
  const configured = config.get<string>("ui.theme") || "auto";
  const current = resolveUiTheme(config.get<string>("ui.theme"), process.env.CHRYS_THEME);
  const direct = themes.find((theme) => theme.id === arg?.trim().toLowerCase());
  if (direct) {
    await applyThemeSelection(direct.id, direct.name, config);
    return;
  }
  const items = themes.map((t) => ({
    label: t.name,
    description: t.id === "auto" ? nativeText(`active: ${current}`, `当前：${current}`) : t.id,
    detail: t.id === "auto" ? `${t.detail}${themeFallbackReason("auto") ? `\n${themeResolutionLine("auto")}` : ""}` : t.detail,
    id: t.id,
    picked: configured === t.id || (configured === "auto" && t.id === "auto"),
  }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: nativeText("Select iCode theme", "选择 iCode 主题"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected) return;
  await applyThemeSelection(selected.id, selected.label, config);

  async function applyThemeSelection(themeSetting: UiTheme | "auto", label: string, workspaceConfig: vscode.WorkspaceConfiguration): Promise<void> {
    const nextTheme = themeSetting === "auto" ? resolveUiTheme("auto", process.env.CHRYS_THEME) : themeSetting;
    const previousSetting = workspaceConfig.get<string>("ui.theme") || "auto";
    if (previousSetting === themeSetting && nextTheme === current) return;
    rt.currentTheme = nextTheme;
    await workspaceConfig.update("ui.theme", themeSetting, vscode.ConfigurationTarget.Global);
    rt.chatPanel?.applyTheme(nextTheme);
    const fallback = themeFallbackReason(themeSetting);
    const fallbackText = fallback ? nativeText(` ${fallback}.`, ` ${fallback}。`) : "";
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "system",
      text: nativeText(
        `Theme changed to ${label} (active: ${nextTheme}).${fallbackText}`,
        `主题已切换到 ${label}（当前：${nextTheme}）。${fallbackText}`,
      ),
      timestamp: Date.now(),
    });
    rt.chatPanel?.appendDebugEvent("ThemeChanged", themeResolutionLine(themeSetting));
    rt.chatPanel?.setState(chatPanelState());
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

async function selectNextSessionAgent(name: string): Promise<boolean> {
  if (agentSelectionTarget(Boolean(rt.currentSessionId)) !== "next-session") return false;
  await persistPreferredAgent(name);
  rt.activeAgentName = name;
  rt.chatPanel?.setState(chatPanelState());
  rt.chatPanel?.appendDebugEvent("NextSessionAgentSelected", name);
  return true;
}
