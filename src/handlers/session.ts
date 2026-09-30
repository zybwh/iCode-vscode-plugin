import { rt, type ToolSnapshot } from "../state/runtime";
import { nextMessageId, type ChatMessage } from "../chat/provider";
import { objectValue, stringField, formatCount } from "../common/utils";
import { logError } from "../common/logging";
import { chatPanelState } from "../common/chatPanelState";
import type {
  ContentBlock,
  SessionUpdate,
  UserMessageChunk,
  AgentMessageChunk,
  AgentThoughtChunk,
  ToolCallStart,
  ToolCallProgress,
  UsageUpdate,
  AgentPlanUpdate,
  SessionInfoUpdate,
} from "../acp/types";
import { awardCompanionUsageEvent } from "./companion";

// ──────────────────────────────────────────────
// Session update dispatch
// ──────────────────────────────────────────────

export async function handleSessionUpdate(sessionId: string, update: SessionUpdate): Promise<void> {
  // Replay sets the target session before dispatch; reject foreign traffic
  // before inspecting its payload or touching presentation state.
  if (rt.currentSessionId && sessionId !== rt.currentSessionId) return;
  try {
    emitSessionDebugEvent(update);

    switch (update.sessionUpdate) {
      case "user_message_chunk":
        handleUserChunk(update);
        break;
      case "agent_message_chunk":
        handleAgentChunk(update);
        break;
      case "agent_thought_chunk":
        handleThoughtChunk(update);
        break;
      case "tool_call":
        handleToolCallStart(update);
        break;
      case "tool_call_update":
        handleToolCallProgress(update);
        break;
      case "usage_update":
        handleUsageUpdate(update);
        break;
      case "plan":
        handlePlanUpdate(update);
        break;
      case "session_info_update":
        handleSessionInfoUpdate(update);
        break;
      case "current_mode_update":
        rt.currentApprovalMode = update.currentModeId;
        rt.chatPanel?.setState(chatPanelState());
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Failed to render session update ${update.sessionUpdate}: ${message}`);
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "error",
      text: `Error: failed to render ${update.sessionUpdate}\n${message}`,
      timestamp: Date.now(),
    });
  }
}

export function emitSessionDebugEvent(update: SessionUpdate): void {
  switch (update.sessionUpdate) {
    case "user_message_chunk":
      rt.chatPanel?.appendDebugEvent("UserMessage", `(${contentText(update.content).length} chars)`);
      break;
    // Streams produce one event per message rather than per chunk: per-chunk events
    // flooded the webview and the bounded log buffer used by Doctor and support bundles.
    case "agent_message_chunk":
      const newSourceMessage = Boolean(update.messageId && rt.activeAgentSourceMessageId && update.messageId !== rt.activeAgentSourceMessageId);
      if (!rt.activeAgentMessageId || newSourceMessage || isIntermediateChunk(update)) {
        rt.chatPanel?.appendDebugEvent("AgentMessage", `stream started (${contentText(update.content).length} chars)`);
      }
      break;
    case "agent_thought_chunk":
      if (!rt.activeThoughtMessageId) {
        rt.chatPanel?.appendDebugEvent("AgentThinking", `stream started (${contentText(update.content).length} chars)`);
      }
      break;
    case "tool_call":
      rt.chatPanel?.appendDebugEvent("ToolCallStart", update.title ?? update.toolCallId);
      break;
    case "tool_call_update":
      if (update.status === "completed" || update.status === "failed") {
        rt.chatPanel?.appendDebugEvent("ToolCallResult", `${update.title ?? update.toolCallId}${update.status ? ` (${update.status})` : ""}`);
      }
      break;
    case "usage_update":
      rt.chatPanel?.appendDebugEvent("UsageUpdate", rt.currentUsageText || "usage");
      break;
    case "plan":
      rt.chatPanel?.appendDebugEvent("PlanUpdate", `${update.entries.length} entries`);
      break;
    case "session_info_update":
      rt.chatPanel?.appendDebugEvent("SessionInfo", update.title ? `title=${update.title}` : "title cleared");
      break;
    case "current_mode_update":
      rt.chatPanel?.appendDebugEvent("StateChanged", `approval=${update.currentModeId}`);
      break;
  }
}

// ──────────────────────────────────────────────
// Chunk handlers
// ──────────────────────────────────────────────

export function handleUserChunk(update: UserMessageChunk): void {
  rt.activeAgentMessageId = null;
  rt.activeAgentText = "";
  rt.activeThoughtMessageId = null;
  rt.activeThoughtText = "";
  const text = contentText(update.content);
  if (rt.pendingUserEchoConsumed) {
    // Second identical text — not an echo, render it
    rt.pendingUserEchoConsumed = false;
  } else if (rt.pendingUserEchoText === text) {
    rt.pendingUserEchoText = null;
    rt.pendingUserEchoMessageId = null;
    rt.pendingUserEchoConsumed = true;
    return;
  }
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "user",
    text,
    timestamp: Date.now(),
  });
}

export function handleAgentChunk(update: AgentMessageChunk): void {
  const text = contentText(update.content);
  if (!text) return;

  // Intermediate text arrives alongside tool calls and represents the
  // agent's reasoning between tool invocations.  Render it as a standalone
  // dimmed message, like the TUI's AgentMessage(is_intermediate=True).
  // Do NOT reset activeAgentMessageId — subsequent streaming chunks after
  // the tool call continue on the same widget.
  if (isIntermediateChunk(update)) {
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "agent",
      text,
      timestamp: Date.now(),
      isIntermediate: true,
    });
    return;
  }

  if (update.messageId && rt.activeAgentSourceMessageId && update.messageId !== rt.activeAgentSourceMessageId) {
    rt.activeAgentMessageId = null;
    rt.activeAgentText = "";
  }
  if (!rt.activeAgentMessageId) {
    rt.activeAgentSourceMessageId = update.messageId ?? null;
    rt.activeAgentMessageId = nextMessageId();
    rt.activeAgentText = text;
    rt.transcript.appendMessage({
      id: rt.activeAgentMessageId,
      kind: "agent",
      text: rt.activeAgentText,
      timestamp: Date.now(),
    });
  } else {
    if (update.messageId) rt.activeAgentSourceMessageId = update.messageId;
    rt.activeAgentText += text;
    rt.transcript.updateMessageTextOnly(rt.activeAgentMessageId, rt.activeAgentText);
  }
}

function isIntermediateChunk(update: AgentMessageChunk): boolean {
  const blocks = Array.isArray(update.content) ? update.content : [update.content];
  for (const block of blocks) {
    if (block.type === "text" && block._meta && typeof block._meta === "object" && (block._meta as Record<string, unknown>).is_intermediate === true) {
      return true;
    }
  }
  return false;
}

export function contentText(content: ContentBlock[] | ContentBlock): string {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "resource" && "text" in block.resource) return block.resource.text;
    if (block.type === "resource_link") return block.uri;
    return "";
  }).join("");
}

export function handleThoughtChunk(update: AgentThoughtChunk): void {
  const text = contentText(update.content);
  if (!text) return;

  if (!rt.activeThoughtMessageId) {
    rt.activeThoughtMessageId = nextMessageId();
    rt.activeThoughtText = text;
    rt.transcript.appendMessage({
      id: rt.activeThoughtMessageId,
      kind: "thought",
      text: rt.activeThoughtText,
      timestamp: Date.now(),
    });
  } else {
    rt.activeThoughtText += text;
    rt.transcript.updateMessageTextOnly(rt.activeThoughtMessageId, rt.activeThoughtText);
  }
}

// ──────────────────────────────────────────────
// Tool call handlers
// ──────────────────────────────────────────────

export function handleToolCallStart(update: ToolCallStart): void {
  rt.activeAgentMessageId = null;
  rt.activeAgentText = "";
  rt.activeThoughtMessageId = null;
  rt.activeThoughtText = "";

  const prior = rt.toolSnapshots.get(update.toolCallId);
  if (rt.toolMessageIds.has(update.toolCallId)) {
    // A progress/result frame may precede the start frame. Enrich that card,
    // retaining its terminal status until another terminal result arrives.
    const terminalStatus = prior?.status === "completed" || prior?.status === "failed" ? prior.status : undefined;
    handleToolCallProgress({
      ...update,
      sessionUpdate: "tool_call_update",
      status: terminalStatus && update.status !== "completed" && update.status !== "failed"
        ? terminalStatus : update.status,
    });
    return;
  }
  const invocationId = rt.subAgentInvocationByParentCallId.get(update.toolCallId);
  const existingMessageId = invocationId ? rt.subAgentMessageIds.get(invocationId) : undefined;
  const messageId = existingMessageId ?? nextMessageId();
  rt.toolMessageIds.set(update.toolCallId, messageId);
  const snapshot = {
    toolCallId: update.toolCallId,
    title: update.title,
    kind: update.kind,
    status: update.status,
    rawInput: update.rawInput,
    content: update.content,
    metadata: update._meta,
  };
  rt.toolSnapshots.set(update.toolCallId, snapshot);
  const message: ChatMessage = {
    id: messageId,
    kind: "tool_call",
    text: "",
    toolCallId: update.toolCallId,
    toolName: update.title,
    toolKind: update.kind,
    toolStatus: update.status,
    toolInput: update.rawInput,
    toolContent: toolContentBlocks(update.content),
    toolMeta: update._meta,
    canDiff: diffFromSnapshot(snapshot) !== null,
    timestamp: Date.now(),
  };
  if (existingMessageId) rt.transcript.updateMessage(existingMessageId, message);
  else rt.transcript.appendMessage(message);
}

export function handleToolCallProgress(update: ToolCallProgress): void {
  const messageId = rt.toolMessageIds.get(update.toolCallId);
  const snapshot = rt.toolSnapshots.get(update.toolCallId) ?? { toolCallId: update.toolCallId };
  if (update.title !== undefined) snapshot.title = update.title;
  if (update.kind !== undefined) snapshot.kind = update.kind;
  if (update.status !== undefined) snapshot.status = update.status;
  if (update.rawInput !== undefined) snapshot.rawInput = update.rawInput;
  if (update.content !== undefined) snapshot.content = update.content;
  if (update._meta !== undefined) snapshot.metadata = update._meta;
  if (update.rawOutput !== undefined) {
    if (typeof update.rawOutput === "string" && typeof snapshot.rawOutput === "string" && update.status !== "completed" && update.status !== "failed") {
      snapshot.rawOutput = appendStreamedToolOutput(snapshot, update.rawOutput);
    } else {
      snapshot.rawOutput = update.rawOutput;
      snapshot.rawOutputDroppedChars = 0;
    }
  }
  rt.toolSnapshots.set(update.toolCallId, snapshot);
  awardCompanionForToolUpdate(update);

  const patch: Partial<ChatMessage> = {};
  if (update.title !== undefined) patch.toolName = update.title;
  if (update.kind !== undefined) patch.toolKind = update.kind;
  if (update.status !== undefined) patch.toolStatus = update.status;
  if (update.rawInput !== undefined) patch.toolInput = update.rawInput;
  if (update.content !== undefined) patch.toolContent = toolContentBlocks(update.content, update.rawOutput);
  if (update._meta !== undefined) patch.toolMeta = update._meta;
  if (update.rawOutput !== undefined) {
    const toolOutput = formatToolOutput(snapshot.rawOutput, snapshot.rawOutputDroppedChars);
    // Once output passes the display limit, further chunks do not change what is shown.
    if (toolOutput !== snapshot.lastToolOutput) patch.toolOutput = snapshot.lastToolOutput = toolOutput;
  }
  if (update.rawInput !== undefined || update.title !== undefined || snapshot.canDiff === undefined) {
    snapshot.canDiff = diffFromSnapshot(snapshot) !== null;
    patch.canDiff = snapshot.canDiff;
  }

  if (messageId) {
    rt.transcript.updateMessage(messageId, patch);
  } else {
    const newMessageId = nextMessageId();
    rt.toolMessageIds.set(update.toolCallId, newMessageId);
    rt.transcript.appendMessage({
      id: newMessageId,
      kind: "tool_call",
      text: "",
      toolCallId: update.toolCallId,
      toolName: update.title,
      toolKind: update.kind,
      toolStatus: update.status,
      toolInput: update.rawInput,
      toolContent: toolContentBlocks(snapshot.content, update.rawOutput),
      toolMeta: snapshot.metadata,
      toolOutput: update.rawOutput === undefined ? undefined : formatToolOutput(snapshot.rawOutput, snapshot.rawOutputDroppedChars),
      canDiff: diffFromSnapshot(snapshot) !== null,
      timestamp: Date.now(),
    });
  }
}

function toolContentBlocks(content: ToolCallStart["content"], duplicateRawOutput?: unknown): ContentBlock[] {
  if (!content) return [];
  const duplicateText = typeof duplicateRawOutput === "string" ? duplicateRawOutput.trim() : "";
  return content.flatMap((entry) => {
    if (!entry.content) return [];
    if (entry.content.type === "text" && duplicateText && entry.content.text.trim() === duplicateText) return [];
    return [entry.content];
  });
}

function awardCompanionForToolUpdate(update: ToolCallProgress): void {
  if (update.status !== "completed" && update.status !== "failed") return;
  if (rt.companionAwardedToolCalls.has(update.toolCallId)) return;
  rt.companionAwardedToolCalls.add(update.toolCallId);
  awardCompanionUsageEvent(update.status === "completed" ? "tool_completed" : "tool_failed");
}

export function handleUsageUpdate(update: UsageUpdate): void {
  rt.currentContextUsedTokens = update.used;
  rt.currentContextMaxTokens = update.size > 0 ? update.size : undefined;
  rt.currentContextPct = update.size > 0 ? (update.used / update.size) * 100 : undefined;
  rt.currentUsageText = update.size > 0 ? `${formatCount(update.used)} / ${formatCount(update.size)} tokens` : "";
  rt.chatPanel?.setState(chatPanelState());
}

export function handlePlanUpdate(update: AgentPlanUpdate): void {
  rt.currentPlanEntries = update.entries;
  rt.chatPanel?.setState(chatPanelState());
}

export function handleSessionInfoUpdate(update: SessionInfoUpdate): void {
  if (update.updatedAt !== undefined) rt.currentSessionUpdatedAt = update.updatedAt ?? "";
  if (update.title !== undefined) {
    rt.currentSessionTitle = update.title ?? "";
  }
  rt.chatPanel?.setState(chatPanelState());
  rt.sessionTreeProvider?.refresh();
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Streaming tool output kept in memory; the chat shows the first 5000 characters. */
export const MAX_STREAMED_TOOL_OUTPUT_CHARS = 256 * 1024;

function appendStreamedToolOutput(snapshot: ToolSnapshot, chunk: string): string {
  const current = snapshot.rawOutput as string;
  const room = MAX_STREAMED_TOOL_OUTPUT_CHARS - current.length;
  if (room >= chunk.length) return current + chunk;
  snapshot.rawOutputDroppedChars = (snapshot.rawOutputDroppedChars ?? 0) + chunk.length - Math.max(0, room);
  return room > 0 ? current + chunk.slice(0, room) : current;
}

export function formatToolOutput(output: unknown, droppedChars = 0): string {
  if (typeof output === "string") {
    const total = output.length + droppedChars;
    if (total > 5000) {
      return output.slice(0, 5000) + `\n... (truncated, ${total} total chars)`;
    }
    return output;
  }
  return JSON.stringify(output, null, 2);
}

export function diffFromSnapshot(snapshot: { title?: string; toolCallId?: string; rawInput?: unknown; rawOutput?: unknown }): { label: string; before: string; after: string } | null {
  const input = objectValue(snapshot.rawInput);
  if (!input) return null;

  const label = stringField(input, "path")
    ?? stringField(input, "file_path")
    ?? stringField(input, "filepath")
    ?? stringField(input, "target_file")
    ?? snapshot.title
    ?? snapshot.toolCallId
    ?? "";

  const before = stringField(input, "old_string")
    ?? stringField(input, "old_text")
    ?? stringField(input, "before")
    ?? "";
  const after = stringField(input, "new_string")
    ?? stringField(input, "new_text")
    ?? stringField(input, "after")
    ?? stringField(input, "content");

  if (after === undefined) return null;
  if (before === after) return null;
  return { label, before, after };
}
