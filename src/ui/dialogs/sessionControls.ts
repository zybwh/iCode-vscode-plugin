import { openChanges } from "../changes";
import * as vscode from "vscode";
import { rt } from "../../state/runtime";
import { chatPanelState } from "../../common/chatPanelState";
import { rememberPreferredApprovalMode } from "../../session/defaults";
import type { DiffEntry } from "../../acp/types";
import { localized as nativeText } from "../../common/hostI18n";


// ──────────────────────────────────────────────
// Session diff / rollback
// ──────────────────────────────────────────────

export async function showSessionDiff(): Promise<void> {
  await openChanges(false, undefined, openDiffEntry);
}

export async function openDiffEntry(entry: DiffEntry, titlePrefix: string): Promise<boolean> {
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

export async function applyApprovalModeToActiveSession(mode: string): Promise<void> {
  if (!rt.sessionManager?.sessionId) {
    rt.chatPanel?.appendDebugEvent("ApprovalModeDefaultOnly", mode);
    return;
  }
  await rt.sessionManager.setApprovalMode(mode);
}

export function approvalModeAfter(current: string): "manual" | "auto" | "bypass" {
  if (current === "manual") return "auto";
  if (current === "auto") return "bypass";
  return "manual";
}

export function approvalModeOrDefault(current: string): "manual" | "auto" | "bypass" {
  return current === "manual" || current === "auto" || current === "bypass" ? current : "bypass";
}
