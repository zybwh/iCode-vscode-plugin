import type { ContentBlock, ToolKind, ToolCallStatus } from "../acp/types";

/** Kinds of rendered messages in the chat.
 * `tool_result` is handled by the webview switch but never produced by the extension host;
 * it is kept in the union so that existing session state containing this kind remains valid. */
export type MessageKind = "user" | "agent" | "thought" | "tool_call" | "tool_result" | "error" | "separator" | "interrupted" | "system" | "activity";

/** A chat message in the provider model — what gets sent to the webview. */
export interface ChatMessage {
  id: string;
  kind: MessageKind;
  /** Markdown text for user/agent/error messages. */
  text: string;
  /** Tool call details (for kind=tool_call or tool_result). */
  toolCallId?: string;
  toolName?: string;
  toolKind?: ToolKind;
  toolStatus?: ToolCallStatus;
  toolInput?: unknown;
  toolOutput?: string;
  /** ACP structured tool content, projected from tool_call content wrappers. */
  toolContent?: ContentBlock[];
  /** ACP extension metadata, including hosted provider provenance. */
  toolMeta?: Record<string, unknown>;
  canDiff?: boolean;
  /** Render user message as a mid-turn injection. */
  isInjection?: boolean;
  /** Render agent message as intermediate (dimmed, between tool calls). */
  isIntermediate?: boolean;
  /** Turn number for user messages (1-based). */
  turnNumber?: number;
  /** User-attached images rendered as thumbnails in the chat transcript. */
  imageAttachments?: Array<{
    name: string;
    mimeType: string;
    data: string;
    bytes?: number;
    originalBytes?: number;
    compressed?: boolean;
  }>;
  /** Unix timestamp in ms. */
  timestamp: number;
  /** Sub-agent: accumulated inner tool call entries (set by handleSubAgentEvent). */
  innerToolCalls?: Array<{ toolName: string; status: "running" | "complete" | "error"; durationMs?: number; result?: string }>;
  /** Sub-agent: true when the sub-agent is paused awaiting retry/abort. */
  subAgentPaused?: boolean;
  /** Sub-agent: last error message when paused. */
  subAgentLastError?: string;
  /** Sub-agent: retry attempt count when paused. */
  subAgentRetryAttempts?: number;
  subAgentInvocationId?: string;
  /** Sub-agent context-window and cumulative usage metrics. */
  subAgentTokens?: number;
  subAgentUsageTokens?: number;
  subAgentCompactions?: number;
  /** Structured lifecycle card used for Agent loading and context compaction. */
  activityType?: "agent-load" | "compaction" | "context-pressure" | "tool-compaction" | "context-compressed" | "rollback";
  activityStatus?: "running" | "completed" | "warning" | "failed" | "cancelled";
  activityTitle?: string;
  activitySubtitle?: string;
  activityDetail?: string;
  activityProgress?: { current: number; total: number };
  activityDurationMs?: number;
  /** Label for interrupt action button (e.g. "Continue", "Retry"). */
  actionLabel?: string;
}

let messageCounter = 0;

export function nextMessageId(): string {
  return `msg-${++messageCounter}`;
}

// IDs stay monotonic across session resets so concurrently open transcripts cannot collide.
