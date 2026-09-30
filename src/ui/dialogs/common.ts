import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { rt } from "../../state/runtime";
import type { ChatInlineDialogState } from "../../chat/panel";
import { logInfo, logError } from "../../common/logging";
import { findSessionJsonPath } from "../../common/sessionFiles";
import { localized as nativeText } from "../../common/hostI18n";
import { refreshOpenSessionsDialog } from "./sessions";

export function chrysCliVersionLabel(localized = false): string {
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

export function startingNotice(): string {
  return nativeText("iCode is still starting. Try again in a moment.", "iCode 仍在启动，请稍后再试。");
}

export function currentSessionJsonPath(): string {
  return rt.currentSessionId ? findSessionJsonPath(rt.currentSessionId) ?? "(not found on this host)" : "(none)";
}

export function localizedCurrentSessionJsonPath(): string {
  return rt.currentSessionId
    ? findSessionJsonPath(rt.currentSessionId) ?? nativeText("(not found on this host)", "(当前主机未找到)")
    : nativeText("(none)", "(无)");
}

export function workspaceTerminalDetail(localized = false): string {
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

export function workspaceTerminalStateLabel(localized: boolean): string {
  if (!rt.workspaceTerminal) {
    return localized ? nativeText("not opened", "未打开") : "not opened";
  }
  if (rt.workspaceTerminal.exitStatus) {
    return localized ? nativeText("closed", "已关闭") : "closed";
  }
  return localized ? nativeText("open", "已打开") : "open";
}

export function activeBlockingPromptDetail(localized = false): string {
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

export function diagnosticsFrontendErrorCount(): number {
  return rt.logLines.filter((line) => line.includes("[error]")).length;
}

export function isAcpStartupOutputIssue(line: string): boolean {
  return /\[(?:stdout|stderr)\]/.test(line) && /\b(?:ERROR|WARNING|Error:|Warning:|Retrying|No matching distribution|Failed to establish|timeout|timed out)\b/.test(line);
}

export function diagnosticsAcpStartupIssueCount(): number {
  return rt.logLines.filter((line) => isAcpStartupOutputIssue(line)).length;
}

export function currentSessionJsonFilePath(): string | null {
  return rt.currentSessionId ? findSessionJsonPath(rt.currentSessionId) ?? null : null;
}

export function sessionTreeConsistencyDetail(localized = false): { ok: boolean; detail: string } {
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

export type ExtensionInstallState = {
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

export function diagnosticsExtensionInstallState(): ExtensionInstallState {
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

export function extensionStoreKind(extensionPath: string): ExtensionInstallState["storeKind"] {
  const normalized = extensionPath.split(path.sep).join("/");
  if (normalized.includes("/.bmc-studio/extensions/")) return "openubmc-studio";
  if (normalized.includes("/.vscode/extensions/") || normalized.includes("/.vscode-insiders/extensions/")) return "vscode";
  return "unknown";
}

export function isDevelopmentCheckout(extensionPath: string, extensionRealPath: string): boolean {
  const normalizedPath = extensionPath.split(path.sep).join("/");
  const normalizedRealPath = extensionRealPath.split(path.sep).join("/");
  return normalizedPath.endsWith("/chrys/vscode") || normalizedRealPath.endsWith("/chrys/vscode");
}

export function extensionInstallLine(state: ExtensionInstallState): string {
  const siblings = state.versionedSiblings.length ? state.versionedSiblings.join(", ") : "(none)";
  return `app=${state.appName}; scheme=${state.uriScheme}; store=${state.storeKind}; path=${state.extensionPath || "(unknown)"}; realPath=${state.extensionRealPath || "(unknown)"}; symlink=${state.isSymlink ? "yes" : "no"}; devCheckout=${state.developmentCheckout ? "yes" : "no"}; registryLocation=${state.registryLocation || "(missing)"}; versionedSiblings=${siblings}`;
}

export function localizedExtensionInstallDetail(state: ExtensionInstallState): string {
  const issues = [
    state.pathReadError ? nativeText(`path read failed: ${state.pathReadError}`, `路径读取失败：${state.pathReadError}`) : "",
    state.registryReadError ? nativeText(`registry read failed: ${state.registryReadError}`, `扩展清单读取失败：${state.registryReadError}`) : "",
  ].filter(Boolean);
  const base = nativeText(extensionInstallLine(state), extensionInstallLine(state));
  return issues.length ? `${base}; ${issues.join("; ")}` : base;
}

export const REDACTED_DIAGNOSTICS_VALUE = "<redacted>";
export const SENSITIVE_DIAGNOSTICS_KEY = /^(?:api[_-]?key|apikey|authorization|proxy[_-]?authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|x-api-key|api-key|client[_-]?secret|secret|password|passwd|private[_-]?key|credential|cookie|set-cookie)$/i;
export const SENSITIVE_DIAGNOSTICS_ENV_KEY = /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|AZURE_OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|API_KEY|AUTHORIZATION|PASSWORD|SECRET)\b/i;

export function isSensitiveDiagnosticsKey(key: string): boolean {
  return SENSITIVE_DIAGNOSTICS_KEY.test(key) || SENSITIVE_DIAGNOSTICS_ENV_KEY.test(key);
}

export function redactSensitiveDiagnosticsText(text: string): string {
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

export function redactDiagnosticsValue(value: unknown, keyHint = ""): unknown {
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

export async function _deleteSessionById(sessionId: string, cwd?: string): Promise<void> {
  const { deleteSessionById } = await import("../../extension");
  await deleteSessionById(sessionId, cwd);
  refreshOpenSessionsDialog();
}
