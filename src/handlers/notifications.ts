import type { ChatMessage } from "../chat/provider";
import type { RuntimeUpdateMessage } from "../acp/types";
import { mergeRuntimeSnapshot } from "../common/runtimeSnapshot";
import * as vscode from "vscode";
import { rt } from "../state/runtime";
import { nextMessageId } from "../chat/provider";
import { formatCount } from "../common/utils";
import { logInfo, logWarn, logError } from "../common/logging";
import { chatPanelState } from "../common/chatPanelState";
import { formatRollbackResultMessage } from "../common/provenanceDisplay";
import { resolveUiLanguage, type UiLanguage } from "../common/i18n";
import type {
  RuntimeSnapshot,
  ChrysErrorNotification,
  ChrysWarningNotification,
  SessionRestoredNotification,
  ContextCompressedNotification,
  ContextPressureNotification,
  ToolCompactedNotification,
  UsageUpdateNotification,
  AgentLoadNotification,
  ApprovalReviewedNotification,
  ProfileSwitchedNotification,
  WorkspaceUpdatedNotification,
  UserInjectResultNotification,
  RollbackResultNotification,
  SubAgentNotification,
  CompactionNotification,
} from "../acp/types";

// Re-export pure runtime utility functions
export {
  runtimeModelName,
  runtimeLabel,
  runtimeDetailsTabs,
  runtimeModelSections,
  runtimeToolSections,
  runtimeMcpSections,
  runtimeSkillSections,
  runtimeFileSections,
  contextLabel,
  boolLabel,
  providerLabel,
  apiStyleLabel,
  uniqueStrings,
  kvLines,
  formatCompactNumber,
  countRecordValues,
  countRuntimeTools,
  countRuntimeFiles,
  platformLabel,
  platformName,
} from "../common/runtimeUtils";

// ──────────────────────────────────────────────
// Notification handlers
// ──────────────────────────────────────────────

function currentUiLanguage() {
  return resolveUiLanguage(vscode.workspace.getConfiguration("chrys").get<string>("ui.language"), vscode.env.language);
}

export function handleRuntimeUpdate(update: RuntimeUpdateMessage): void {
  const snapshot = normalizeRuntimeSnapshot(update, rt.currentRuntime);
  if (snapshot.sessionId && rt.currentSessionId && snapshot.sessionId !== rt.currentSessionId) return;
  rt.currentRuntime = snapshot;
  hydrateUsageFromSnapshot(snapshot);
  if (snapshot.agentProfile) rt.activeAgentName = snapshot.agentProfile;
  logInfo(`Runtime update: ${runtimeLabelHelper(snapshot)}`);
  rt.chatPanel?.setState(chatPanelState());
}

function cleanErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.message === "string") return parsed.message;
  } catch {}
  return text;
}

export function handleChrysError(update: ChrysErrorNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  const rawText = update.message || update.code || "Unknown iCode error";
  const text = cleanErrorMessage(rawText);

  if (update.code === "session_in_use") {
    logError(`session_in_use: ${text}`);
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "error",
      text: "This session is already active in another window.",
      timestamp: Date.now(),
    });
    rt.chatPanel?.setState(chatPanelState());
    return;
  }

  logError(`${update.code || "error"}: ${text}`);
  rt.activeTurnErrorReceived = true;
  if (rt.pendingUserEchoMessageId) {
    rt.transcript.removeMessage(rt.pendingUserEchoMessageId);
    rt.pendingUserEchoMessageId = null;
    rt.pendingUserEchoText = null;
  }
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "error",
    text: update.code ? `Error: ${update.code}\n${text}` : `Error: ${text}`,
    timestamp: Date.now(),
  });
  rt.chatPanel?.setState(chatPanelState());
}

export function handleChrysWarning(update: ChrysWarningNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  const text = update.message || update.code || "Unknown iCode warning";
  rt.chatPanel?.appendDebugEvent("Warning", update.code ? `${update.code}: ${text}` : text);
  logWarn(`${update.code || "warning"}: ${text}`);
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "separator",
    text: update.code ? `Warning: ${update.code}\n${text}` : `Warning: ${text}`,
    timestamp: Date.now(),
  });
}

export function handleSessionRestored(update: SessionRestoredNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  if (update.agentProfile) rt.activeAgentName = update.agentProfile;
  if (update.primaryCwd) rt.currentCwd = update.primaryCwd;
  if (update.cwdWarning) logWarn(`Session restore cwd warning: ${update.cwdWarning}`);
  rt.chatPanel?.appendDebugEvent("SessionRestored", `${update.messageCount ?? 0} message(s)`);
  logInfo(`Session restored: ${update.sessionId}${update.messageCount === undefined ? "" : ` (${update.messageCount} messages)`}`);
  rt.chatPanel?.setState(chatPanelState());
}

function formatTurnRange(turnRange?: number[]): string {
  const turns = turnRange?.filter((turn): turn is number => typeof turn === "number" && Number.isFinite(turn)) ?? [];
  if (!turns.length) return "";
  if (turns.length === 1 || turns[0] === turns[turns.length - 1]) return `turn ${turns[0]}`;
  return `turns ${turns[0]}-${turns[turns.length - 1]}`;
}

function contextCompressedText(update: ContextCompressedNotification): string {
  const source = update.source ? ` (${update.source})` : "";
  const range = formatTurnRange(update.turnRange);
  const rangeSuffix = range ? `; ${range}` : "";
  return `Context compressed${source}: freed ${update.freedMessages ?? 0} message(s)${rangeSuffix}.`;
}

export function handleContextCompressed(update: ContextCompressedNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  const range = formatTurnRange(update.turnRange);
  const text = contextCompressedText(update);
  rt.chatPanel?.appendDebugEvent(
    update.source ? `ContextCompressed:${update.source}` : "ContextCompressed",
    [`${update.freedMessages ?? 0} message(s)`, range].filter(Boolean).join("; "),
  );
  rt.compressedMessages.push(text);
  if (rt.compressedMessages.length > 50) rt.compressedMessages.splice(0, rt.compressedMessages.length - 50);
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "activity",
    activityType: "context-compressed",
    activityStatus: "completed",
    activitySubtitle: text,
    activityDetail: update.summary,
    text,
    timestamp: Date.now(),
  });
}

export function handleContextPressure(update: ContextPressureNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  const detail = formatContextPressureText(update, "en").replace(/^Context pressure: /, "");
  const text = formatContextPressureText(update, currentUiLanguage());
  rt.chatPanel?.appendDebugEvent("ContextPressure", detail);
  logWarn(text);
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "activity",
    activityType: "context-pressure",
    activityStatus: "warning",
    activityDetail: text,
    text,
    timestamp: Date.now(),
  });
  rt.chatPanel?.setState(chatPanelState());
}

export function formatContextPressureText(
  update: ContextPressureNotification,
  language: UiLanguage = currentUiLanguage(),
): string {
  const reason = update.reason || (language === "zh-CN" ? "上下文预算已用尽" : "context budget exhausted");
  const parts = [reason];
  if (update.source) {
    parts.push(language === "zh-CN" ? `来源=${update.source}` : `source=${update.source}`);
  }
  if (typeof update.attempts === "number") {
    parts.push(language === "zh-CN" ? `尝试次数=${update.attempts}` : `attempts=${update.attempts}`);
  }
  if (typeof update.sideCallTokens === "number") {
    const usage = `${update.sideCallTokens}${typeof update.sideCallTokenBudget === "number"
      ? `/${update.sideCallTokenBudget}`
      : ""}`;
    parts.push(language === "zh-CN" ? `侧调用 token=${usage}` : `side-call tokens=${usage}`);
  }
  return language === "zh-CN"
    ? `上下文压力：${parts.join("；")}`
    : `Context pressure: ${parts.join("; ")}`;
}

export function handleToolCompacted(update: ToolCompactedNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  const phase = update.phase ? ` ${update.phase}` : "";
  rt.chatPanel?.appendDebugEvent(update.phase ? `ToolCompacted:${update.phase}` : "ToolCompacted", `${update.compactedGroups ?? 0} group(s)`);
  logInfo(`Tool compaction${phase}: ${update.compactedGroups ?? 0} group(s)`);
  const tokenSummary = update.tokensBefore !== undefined && update.tokensAfter !== undefined
    ? `${formatCount(update.tokensBefore)} → ${formatCount(update.tokensAfter)} tokens`
    : "";
  const zh = currentUiLanguage() === "zh-CN";
  const detail = [
    update.compactedToolNames?.length ? `${zh ? "工具" : "Tools"}: ${update.compactedToolNames.join(", ")}` : "",
    update.turnNumbers?.length ? `${zh ? "轮次" : "Turns"}: ${update.turnNumbers.join(", ")}` : "",
    update.lastWordsGenerated ? (zh ? "已生成进度摘要。" : "A progress summary was generated.") : "",
  ].filter(Boolean).join("\n");
  upsertActivityMessage(`tool-compaction:${update.phase || "unknown"}:${Date.now()}`, {
    activityType: "tool-compaction",
    activityStatus: "completed",
    activitySubtitle: [`${update.compactedGroups ?? 0} ${zh ? "组" : "groups"}`, update.phase, tokenSummary].filter(Boolean).join(" · "),
    activityDetail: detail,
  });
}

export function isParentUsageUpdate(
  update: UsageUpdateNotification,
  sessionId: string | null,
): boolean {
  if (!update.usageSourceId) return true;
  return update.usageSourceId === (sessionId ?? update.sessionId);
}

export function handleRichUsageUpdate(update: UsageUpdateNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  if (!isParentUsageUpdate(update, rt.currentSessionId)) {
    const messageId = update.usageSourceId ? rt.subAgentMessageIds.get(update.usageSourceId) : undefined;
    if (messageId && update.totalTokens !== undefined) rt.transcript.updateMessage(messageId, { subAgentTokens: update.totalTokens });
    // Child notifications carry session-wide spend, but their context window
    // belongs to the child and must never replace the main agent's gauge.
    const cumulative = Object.fromEntries(Object.entries(update).filter(([key, value]) =>
      key.startsWith("totalSession") && typeof value === "number"));
    if (Object.keys(cumulative).length) {
      rt.currentUsageUpdate = { ...rt.currentUsageUpdate, sessionId: rt.currentSessionId ?? update.sessionId, ...cumulative };
      rt.chatPanel?.setState(chatPanelState());
    }
    return;
  }
  applyParentUsage(update);
  rt.chatPanel?.appendDebugEvent("UsageUpdate", rt.currentUsageText || "usage");
  rt.chatPanel?.setState(chatPanelState());
}

function applyParentUsage(update: UsageUpdateNotification): void {
  const reported = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
  rt.currentUsageUpdate = { ...rt.currentUsageUpdate, sessionId: update.sessionId, ...reported };
  if (typeof update.maxContextTokens === "number" && update.maxContextTokens > 0) rt.currentContextMaxTokens = update.maxContextTokens;
  // totalTokens is the latest context reading; totalSessionTokens is cumulative
  // spend across invocations. There is deliberately no fallback between them.
  if (typeof update.totalTokens === "number" && Number.isFinite(update.totalTokens) && update.totalTokens >= 0) {
    rt.currentContextUsedTokens = update.totalTokens;
    rt.currentContextPct = typeof update.pct === "number" && Number.isFinite(update.pct)
      ? update.pct
      : rt.currentContextMaxTokens ? update.totalTokens / rt.currentContextMaxTokens * 100 : undefined;
    const pct = rt.currentContextPct === undefined ? "" : ` (${rt.currentContextPct.toFixed(1)}%)`;
    rt.currentUsageText = `${formatCount(update.totalTokens)} tokens${pct}`;
  }
}

export function handleAgentLoadEvent(eventName: string, update: AgentLoadNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  const label = update.message || update.phase || update.toProfile || update.agentProfile || update.operation || "";
  rt.chatPanel?.appendDebugEvent("AgentLoad", label || eventName.replace("chrys/", ""));
  if (label) logInfo(`Agent load: ${label}`);
  const failed = eventName.endsWith("agent_load_failed");
  const finished = eventName.endsWith("agent_load_finished");
  const displayLabel = [update.displayName || update.agentProfile || update.toProfile, update.serverName]
    .filter(Boolean)
    .join(" · ");
  rt.agentLifecycle = {
    status: failed ? "failed" : finished ? "ready" : "loading",
    label: displayLabel,
    detail: update.message || update.phase,
    current: update.current,
    total: update.total,
    updatedAt: Date.now(),
  };

  // Agent loading is transient chrome in the TUI, not conversation content.
  // Keep only failures in the transcript; progress and success live in the
  // session status surface so they cannot displace the actual conversation.
  if (failed) {
    upsertActivityMessage("agent-load", {
      activityType: "agent-load",
      activityStatus: "failed",
      activitySubtitle: displayLabel,
      activityDetail: update.message || update.phase,
      activityProgress: update.current !== undefined && update.total !== undefined
        ? { current: update.current, total: update.total }
        : undefined,
    });
  } else {
    const staleMessageId = rt.activityMessageIds.get("agent-load");
    if (staleMessageId) {
      rt.transcript.removeMessage(staleMessageId);
      rt.activityMessageIds.delete("agent-load");
    }
  }
  rt.chatPanel?.setState(chatPanelState());
}

export function handleApprovalReviewed(update: ApprovalReviewedNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  const existing = lastApprovalJudgeReview(update.requestId);
  const status = update.approved ? "approved" : "flagged";
  const reason = update.reason || "";
  const detail = `${status}: ${existing?.intentSummary || existing?.toolName || update.requestId}${reason ? ` (${reason})` : ""}`;
  rt.approvalJudgeReviews.push({
    time: Date.now(),
    requestId: update.requestId,
    status,
    toolName: existing?.toolName,
    toolKind: existing?.toolKind,
    intentSummary: existing?.intentSummary,
    reason,
  });
  if (rt.approvalJudgeReviews.length > 50) rt.approvalJudgeReviews.splice(0, rt.approvalJudgeReviews.length - 50);
  rt.chatPanel?.appendDebugEvent("ApprovalJudge", detail);
  logInfo(`Approval judge ${detail}`);
}

function lastApprovalJudgeReview(requestId: string) {
  for (let index = rt.approvalJudgeReviews.length - 1; index >= 0; index -= 1) {
    const review = rt.approvalJudgeReviews[index];
    if (review.requestId === requestId) return review;
  }
  return undefined;
}

export function handleProfileSwitched(update: ProfileSwitchedNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  if (update.toProfile) rt.activeAgentName = update.toProfile;
  rt.chatPanel?.appendDebugEvent("ProfileSwitched", `${update.fromDisplayName || update.fromProfile || "(previous)"} -> ${update.toDisplayName || update.toProfile || "(current)"}`);
  rt.currentRuntime = normalizeRuntimeSnapshot({
    sessionId: update.sessionId,
    agentProfile: update.toProfile,
    displayName: update.toDisplayName,
    modelProfileId: update.modelProfileId,
    maxContextTokens: update.maxContextTokens,
    toolNames: update.toolNames,
    skillNames: update.skillNames,
    memoryFiles: update.memoryFiles,
    runtimeDetails: update.runtimeDetails,
  });
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "system",
    text: `Agent profile switched: ${update.fromDisplayName || update.fromProfile || "(previous)"} → ${update.toDisplayName || update.toProfile || "(current)"}`,
    timestamp: Date.now(),
  });
  rt.chatPanel?.setState(chatPanelState());
}

export function handleWorkspaceUpdated(update: WorkspaceUpdatedNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  if (update.primaryCwd) {
    rt.currentCwd = update.primaryCwd;
    rt.persistCurrentSession();
    rt.sessionTreeProvider?.refresh();
  }
  if (update.workingDirs) rt.additionalDirectories = update.workingDirs.filter(p => p !== rt.currentCwd);
  rt.persistCurrentSession();
  rt.chatPanel?.appendDebugEvent("WorkspaceUpdated", update.primaryCwd || "(unchanged)");
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "system",
    text: `Working directory → ${update.primaryCwd || "(unchanged)"}`,
    timestamp: Date.now(),
  });
  rt.chatPanel?.setState(chatPanelState());
}

export function handleUserInjectResult(update: UserInjectResultNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  rt.chatPanel?.appendDebugEvent("UserInjectResult", update.consumed ? "consumed" : "restored");
  if (update.consumed) {
    const timestamp = update.createdAt ? Date.parse(update.createdAt) : Date.now();
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "user",
      text: update.text,
      isInjection: true,
      timestamp,
    });
    rt.chatPanel?.setComposer("");
    return;
  }
  rt.chatPanel?.setComposer(update.text);
}

export function handleRollbackResult(update: RollbackResultNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  rt.chatPanel?.appendDebugEvent("RollbackResult", `turn=${update.targetTurn}, files=${update.filesReverted}`);
  if (update.rolledBackUserText) {
    rt.restoredInterruptedText = update.rolledBackUserText;
    rt.chatPanel?.appendDebugEvent("RollbackComposerRestored", `${update.rolledBackUserText.length} chars`);
  }
  resetRenderState(true);
  rt.transcript.clearMessages();
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "activity",
    text: "",
    activityType: "rollback",
    activityStatus: update.warnings?.length || update.exclusions?.length ? "warning" : "completed",
    activityDetail: formatRollbackResultMessage(update, { language: currentUiLanguage() }),
    timestamp: Date.now(),
  });
  if (update.rolledBackUserText) {
    rt.chatPanel?.setComposer(update.rolledBackUserText);
  }
  rt.chatPanel?.setState(chatPanelState());
}

export function handleCompactionNotification(eventName: string, update: CompactionNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  const isCommitted = eventName.endsWith("_committed");
  const isFinished = eventName.endsWith("_finished");
  const key = "invocationId" in update
    ? `${update.invocationId}:${update.compactionId}`
    : update.compactionId;

  if (isCommitted) {
    rt.committedCompactions.add(key);
  } else if (isFinished) {
    rt.activeCompactions.delete(key);
  } else {
    rt.activeCompactions.set(key, update);
  }

  let detail = "agentName" in update
    ? `${update.agentName} ${update.compactionId}`
    : update.compactionId;
  if ("outcome" in update) {
    detail += `; outcome=${update.outcome}`;
    if (update.failureReason) detail += `; ${update.failureReason}`;
  }
  const debugKind = isCommitted
    ? "CompactionCommitted"
    : isFinished
      ? "CompactionFinished"
      : "CompactionStarted";
  rt.chatPanel?.appendDebugEvent(debugKind, detail);

  if ("invocationId" in update) {
    handleSubAgentEvent(eventName, update);
  } else {
    const outcome = "outcome" in update ? update.outcome : "";
    upsertActivityMessage(`compaction:${key}`, {
      activityType: "compaction",
      activityStatus: !isFinished ? "running" : outcome === "failed" ? "failed" : outcome === "canceled" ? "cancelled" : "completed",
      activitySubtitle: "phase" in update ? update.phase : undefined,
      activityDetail: "outcome" in update ? [update.lastWords, update.failureReason, update.formatViolation].filter(Boolean).join("\n\n") : undefined,
      activityDurationMs: "durationMs" in update ? update.durationMs : undefined,
    });
  }
  rt.chatPanel?.setState(chatPanelState());
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function handleSubAgentEvent(eventName: string, update: SubAgentNotification): void {
  if (update.sessionId && rt.currentSessionId && update.sessionId !== rt.currentSessionId) return;
  rt.chatPanel?.appendDebugEvent("SubAgent", `${eventName.replace("chrys/", "")}: ${update.agentName || update.invocationId}`);
  const invocationId = update.invocationId;
  let messageId = rt.subAgentMessageIds.get(invocationId);
  const payload = update as unknown as Record<string, unknown>;
  if (eventName.endsWith("invocation_start") && typeof payload.parentCallId === "string") {
    rt.subAgentInvocationByParentCallId.set(payload.parentCallId, invocationId);
    messageId = rt.toolMessageIds.get(payload.parentCallId) ?? messageId;
    if (messageId) rt.subAgentMessageIds.set(invocationId, messageId);
  }
  const text = formatSubAgentEvent(eventName, update);

  // Accumulate structured inner tool call data
  let innerToolCalls = rt.subAgentInnerToolCalls.get(invocationId);
  if (!innerToolCalls) {
    // Structured events may arrive after the standard parent tool card. Keep
    // the nested state by invocation id and project it onto that same card.
    innerToolCalls = [];
    rt.subAgentInnerToolCalls.set(invocationId, innerToolCalls);
  }

  if (eventName.endsWith("tool_call_start") && innerToolCalls) {
    innerToolCalls.push({ toolName: String(payload.toolName ?? "unknown"), status: "running" });
  }
  if (eventName.endsWith("tool_call_result") && innerToolCalls) {
    const result = String(payload.result ?? "");
    const durationMs = typeof payload.durationMs === "number" ? payload.durationMs : undefined;
    // Find the most recent matching running entry by toolName and update it
    const entry = [...innerToolCalls].reverse().find((tc) => tc.toolName === String(payload.toolName ?? "") && tc.status === "running");
    if (entry) {
      entry.status = "complete";
      entry.durationMs = durationMs;
      entry.result = result;
    }
  }

  let paused = false;
  let lastError: string | undefined;
  let retryAttempts: number | undefined;

  if (eventName.endsWith("paused")) {
    paused = true;
    lastError = String(payload.lastError || payload.reason || "");
    retryAttempts = typeof payload.retryAttempts === "number" ? payload.retryAttempts : undefined;
  }

  let subAgentTokens: number | undefined;
  let subAgentUsageTokens: number | undefined;
  if (eventName.endsWith("progress")) {
    subAgentTokens = typeof payload.totalTokens === "number" ? payload.totalTokens : undefined;
    subAgentUsageTokens = typeof payload.totalUsageTokens === "number" ? payload.totalUsageTokens : undefined;
  }

  let subAgentCompactions: number | undefined;
  if (eventName.endsWith("compaction_committed") && typeof payload.compactionId === "string") {
    const committed = rt.subAgentCommittedCompactions.get(invocationId) ?? new Set<string>();
    committed.add(payload.compactionId);
    rt.subAgentCommittedCompactions.set(invocationId, committed);
    subAgentCompactions = committed.size;
  }

  if (!messageId) {
    messageId = nextMessageId();
    rt.subAgentMessageIds.set(invocationId, messageId);
    rt.transcript.appendMessage({
      id: messageId,
      kind: "tool_call",
      text: "",
      toolCallId: invocationId,
      toolName: `Sub-agent: ${update.agentName}`,
      toolKind: "other",
      toolStatus: paused || eventName.endsWith("aborted") ? "failed" : "in_progress",
      toolInput: { invocationId },
      toolOutput: text,
      innerToolCalls: innerToolCalls ?? undefined,
      subAgentPaused: paused || undefined,
      subAgentLastError: lastError,
      subAgentRetryAttempts: retryAttempts,
      subAgentInvocationId: invocationId,
      ...(subAgentTokens !== undefined ? { subAgentTokens } : {}),
      ...(subAgentUsageTokens !== undefined ? { subAgentUsageTokens } : {}),
      ...(subAgentCompactions !== undefined ? { subAgentCompactions } : {}),
      timestamp: Date.now(),
    });
  } else {
    rt.transcript.updateMessage(messageId, {
      toolStatus: paused || eventName.endsWith("aborted") ? "failed" : "in_progress",
      toolOutput: text,
      innerToolCalls: innerToolCalls ?? undefined,
      subAgentPaused: paused || undefined,
      subAgentLastError: lastError,
      subAgentRetryAttempts: retryAttempts,
      subAgentInvocationId: invocationId,
      ...(subAgentTokens !== undefined ? { subAgentTokens } : {}),
      ...(subAgentUsageTokens !== undefined ? { subAgentUsageTokens } : {}),
      ...(subAgentCompactions !== undefined ? { subAgentCompactions } : {}),
    });
  }
  if (eventName.endsWith("paused")) {
    rt.pausedSubAgents.set(invocationId, update);
  } else if (eventName.endsWith("resumed") || eventName.endsWith("aborted") || eventName.endsWith("cascade_aborted")) {
    rt.pausedSubAgents.delete(invocationId);
  }
  if (eventName.endsWith("aborted") || eventName.endsWith("cascade_aborted") || eventName.endsWith("resumed")) {
    rt.subAgentInnerToolCalls.delete(invocationId);
  }
}

export function formatSubAgentEvent(
  eventName: string,
  update: SubAgentNotification,
  language: UiLanguage = currentUiLanguage(),
): string {
  const base = `${update.agentName} (${update.invocationId})`;
  const payload = update as unknown as Record<string, unknown>;
  if (eventName.endsWith("invocation_start")) {
    return `${base} started.`;
  }
  if (eventName.endsWith("tool_call_start")) {
    return `${base} started tool ${String(payload.toolName ?? "unknown")}.`;
  }
  if (eventName.endsWith("tool_call_result")) {
    const dur = typeof payload.durationMs === "number" ? ` (${formatDurationMs(payload.durationMs)})` : "";
    return `${base} completed tool ${String(payload.toolName ?? "unknown")}${dur}.\n\n${String(payload.result ?? "")}`;
  }
  if (eventName.endsWith("progress")) {
    const toolCallCount = Number(payload.toolCallCount ?? 0);
    const contextTokens = Number(payload.totalTokens ?? 0);
    if (language === "zh-CN") {
      const cumulative = typeof payload.totalUsageTokens === "number"
        ? `，累计 ${payload.totalUsageTokens} 个 token`
        : "";
      return `${base}：${toolCallCount} 次工具调用，${contextTokens} 个上下文 token${cumulative}。`;
    }
    const context = `${Number(payload.totalTokens ?? 0)} context token(s)`;
    const cumulative = typeof payload.totalUsageTokens === "number"
      ? `, ${payload.totalUsageTokens} cumulative token(s)`
      : "";
    return `${base}: ${Number(payload.toolCallCount ?? 0)} tool call(s), ${context}${cumulative}.`;
  }
  if (eventName.endsWith("retry_attempt")) {
    return `${base} retry ${Number(payload.attempt ?? 0)}/${Number(payload.maxAttempts ?? 0)}: ${String(payload.message ?? "")}`;
  }
  if (eventName.endsWith("paused")) {
    const errText = String(payload.lastError || payload.reason || "");
    const attemptInfo = typeof payload.retryAttempts === "number" && (payload.retryAttempts as number) > 0
      ? ` (after ${payload.retryAttempts} retry attempt(s))`
      : "";
    return `${base} paused${attemptInfo}: ${errText}\n\n⚠ Sub-agent is paused — use "iCode: Retry Paused Sub-agent" or "iCode: Abort Paused Sub-agent" from the command palette.`;
  }
  if (eventName.endsWith("resumed")) {
    return `${base} resumed.`;
  }
  if (eventName.endsWith("aborted")) {
    return `${base} aborted: ${String(payload.lastError || "")}`;
  }
  return `${base}: ${eventName}`;
}

// ──────────────────────────────────────────────
// Snapshot helpers
// ──────────────────────────────────────────────

export async function refreshRuntimeSnapshot(): Promise<void> {
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !rt.currentSessionId) return;
  const sessionId = rt.currentSessionId;
  try {
    let snapshot = await sessionManager.runtime();
    const details = snapshot.runtimeDetails ?? {};
    const needsMcp = details.mcp_tools === undefined && details.mcpTools === undefined;
    const needsSkills = details.skill_sources === undefined && details.skillSources === undefined;
    if (needsMcp || needsSkills) {
      const [mcpResult, skillsResult] = await Promise.allSettled([
        needsMcp ? sessionManager.listMcp() : Promise.resolve(undefined),
        needsSkills ? sessionManager.listSkills() : Promise.resolve(undefined),
      ]);
      snapshot = {
        ...snapshot,
        runtimeDetails: {
          ...details,
          ...(mcpResult.status === "fulfilled" && mcpResult.value ? {
            mcpTools: mcpResult.value.mcpTools,
            mcpFailures: mcpResult.value.mcpFailures,
          } : {}),
          ...(skillsResult.status === "fulfilled" && skillsResult.value ? {
            skillSources: skillsResult.value.skillSources,
            skillDetails: skillsResult.value.skillDetails,
          } : {}),
        },
      };
    }
    if (rt.sessionManager !== sessionManager || rt.currentSessionId !== sessionId) return;
    handleRuntimeUpdate(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn(`Runtime snapshot unavailable: ${message}`);
  }
}

export function normalizeRuntimeSnapshot(
  update: RuntimeUpdateMessage,
  previous: RuntimeSnapshot | null = null,
): RuntimeSnapshot {
  return mergeRuntimeSnapshot(previous, update);
}

export function hydrateUsageFromSnapshot(snapshot: RuntimeSnapshot): void {
  if (snapshot.sessionId && rt.currentSessionId && snapshot.sessionId !== rt.currentSessionId) return;
  applyParentUsage({
    sessionId: snapshot.sessionId ?? rt.currentSessionId ?? "",
    inputTokens: snapshot.inputTokens,
    outputTokens: snapshot.outputTokens,
    totalTokens: snapshot.totalTokens,
    pct: snapshot.pct,
    maxContextTokens: snapshot.maxContextTokens,
    totalSessionTokens: snapshot.totalSessionTokens,
    totalSessionInputTokens: snapshot.totalSessionInputTokens,
    totalSessionOutputTokens: snapshot.totalSessionOutputTokens,
    cacheHitTokens: snapshot.cacheHitTokens,
    totalSessionCacheHitTokens: snapshot.totalSessionCacheHitTokens,
    localTokens: snapshot.localTokens,
    calibrationRatio: snapshot.calibrationRatio,
    systemOverheadTokens: snapshot.systemOverheadTokens,
  });
}

// ──────────────────────────────────────────────
// Internal render-state reset
// ──────────────────────────────────────────────

export function resetRenderState(resetCounter = false): void {
  rt.resetRenderState(resetCounter);
}

// ──────────────────────────────────────────────
// Local helper (avoid circular import from handlers)
// ──────────────────────────────────────────────

function runtimeLabelHelper(snapshot: RuntimeSnapshot): string {
  const model = snapshot.runtimeDetails?.model;
  const modelId = model?.modelId ?? model?.model_id ?? snapshot.modelProfileId ?? "(unknown model)";
  return `${snapshot.agentProfile ?? "(unknown agent)"} / ${modelId}`;
}

function upsertActivityMessage(
  key: string,
  patch: Omit<Partial<ChatMessage>, "id" | "kind" | "timestamp">,
): void {
  const messageId = rt.activityMessageIds.get(key);
  if (messageId) {
    rt.transcript.updateMessage(messageId, patch);
    return;
  }
  const id = nextMessageId();
  rt.activityMessageIds.set(key, id);
  rt.transcript.appendMessage({
    id,
    kind: "activity",
    text: "",
    timestamp: Date.now(),
    ...patch,
  });
}
