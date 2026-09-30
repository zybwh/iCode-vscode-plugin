import type { ChatMessage } from "../../provider";
import { state } from "../state";
import { el, formatTime, formatDurationMs, imageDataUri } from "../helpers";
import { renderMarkdown } from "../renderer";
import { processThinkTags } from "../thinkTags";
import { renderToolCall, effectiveToolStatus, normalizeToolKind, toolKindLabel } from "./toolCards";
import { updateStatusBar } from "./statusBar";
import type { ToolGroupState } from "../state";

function messageText(en: string, zh: string): string {
  return state.uiLanguage === "zh-CN" ? zh : en;
}

export function isToolMessage(msg: ChatMessage): boolean {
  return msg.kind === "tool_call" || msg.kind === "tool_result";
}

export function isToolDone(message: ChatMessage): boolean {
  const status = effectiveToolStatus(message);
  return status !== "pending" && status !== "in_progress";
}

export function messageLabel(_msg: ChatMessage, cls: string): string {
  if (cls.includes("user")) {
    return "You";
  }
  if (cls === "error") return messageText("Error", "错误");
  return state.currentAgentName;
}

function messageMarker(cls: string): string {
  if (cls.includes("user")) return cls.includes("injection") ? "└ ❯" : "❯";
  if (cls.includes("agent")) return "◇";
  return "◇";
}

export function renderBubble(msg: ChatMessage, cls: string): HTMLElement {
  const label = messageLabel(msg, cls);
  // User messages are plain text (TUI renders them as-is, no markdown).
  const isUser = cls.includes("user");
  const text = cls.includes("agent") ? processThinkTags(msg.text, cls.includes("intermediate")) : msg.text;
  const contentEl = isUser
    ? renderUserContent(msg)
    : el("div", { class: "bubble-content", innerHTML: renderMarkdown(text) });
  return el("div", { class: `bubble ${cls}` },
    el("div", { class: "bubble-header", "data-folded-label": messageText("folded", "已折叠") },
      el("span", { class: "bubble-marker" }, messageMarker(cls)),
      el("span", { class: "bubble-speaker" }, label),
      el("span", { class: "bubble-time" }, formatTime(msg.timestamp)),
    ),
    contentEl,
  );
}

function renderUserContent(msg: ChatMessage): HTMLElement {
  const content = el("div", { class: "bubble-content" });
  const line = el("div", { class: "user-message-line" });
  line.appendChild(el("span", { class: "user-message-text" }, msg.text));
  content.appendChild(line);
  if (!msg.imageAttachments?.length) return content;
  const grid = el("div", { class: "image-attachment-grid" },
    ...msg.imageAttachments.map((image) => {
      const size = image.bytes ? formatImageBytes(image.bytes) : "";
      const compressed = image.compressed ? messageText("compressed", "已压缩") : "";
      const meta = [image.mimeType, size, compressed].filter(Boolean).join(" · ");
      return el("figure", { class: "image-attachment" },
        el("img", {
          src: imageDataUri(image.mimeType, image.data),
          alt: image.name,
          loading: "lazy",
        }),
        el("figcaption", {},
          el("span", { class: "image-attachment-name", title: image.name }, image.name),
          el("span", { class: "image-attachment-meta" }, meta),
        ),
      );
    }),
  );
  content.appendChild(grid);
  return content;
}

function formatImageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function renderMessage(msg: ChatMessage): HTMLElement {
  switch (msg.kind) {
    case "user":
      return renderBubble(msg, msg.isInjection ? "user injection" : "user");
    case "agent": {
      const cls = msg.isIntermediate ? "agent intermediate" : "agent";
      const bubble = renderBubble(msg, cls);
      const header = bubble.querySelector(".bubble-header");
      if (header instanceof HTMLElement) {
        setupAgentBubbleToggle(bubble, header);
      }
      return bubble;
    }
    case "thought":
      return renderBubble(msg, "thought");
    case "tool_call":
      return renderToolCall(msg);
    case "tool_result":
      return renderToolCall(msg);
    case "error":
      return renderBubble(msg, "error");
    case "interrupted": {
      const extraCls = msg.actionLabel === "Retry" ? "-error" : "";
      const bubble = renderBubble(msg, `interrupted${extraCls ? ` ${extraCls}` : ""}`);
      if (msg.actionLabel) {
        const actionRow = el("div", { class: "interrupt-action-row" },
          el("button", { class: "interrupt-action-btn" }, msg.actionLabel),
        );
        bubble.appendChild(actionRow);
      }
      return bubble;
    }
    case "separator":
      return el("div", { class: "separator" },
        el("span", { class: "separator-label" }, msg.text),
      );
    case "system":
      return el("div", { class: "system-msg" }, `  ◦ ${msg.text}`);
    case "activity":
      return renderActivityCard(msg);
  }
}

function renderActivityCard(msg: ChatMessage): HTMLElement {
  const status = msg.activityStatus ?? "running";
  const title = msg.activityTitle || activityFallbackTitle(msg.activityType, status);
  const meta = [
    msg.activitySubtitle,
    msg.activityProgress ? `${msg.activityProgress.current}/${msg.activityProgress.total}` : "",
    msg.activityDurationMs !== undefined ? formatDurationMs(msg.activityDurationMs) : "",
  ].filter(Boolean).join(" · ");
  const marker = status === "running" ? "◌" : status === "completed" ? "✓" : status === "cancelled" ? "■" : "!";
  return el("section", { class: `activity-card ${msg.activityType ?? "generic"} ${status}` },
    el("div", { class: "activity-card-header" },
      el("span", { class: "activity-card-marker", "aria-hidden": "true" }, marker),
      el("span", { class: "activity-card-title" }, title),
      meta ? el("span", { class: "activity-card-meta" }, meta) : "",
    ),
    msg.activityDetail ? el("details", { class: "activity-card-detail", open: status === "failed" || status === "warning" ? "" : undefined },
      el("summary", {}, messageText("Details", "详情")),
      el("div", { class: "activity-card-detail-body", innerHTML: renderMarkdown(msg.activityDetail) }),
    ) : "",
  );
}

function activityFallbackTitle(type: ChatMessage["activityType"], status: NonNullable<ChatMessage["activityStatus"]>): string {
  switch (type) {
    case "agent-load":
      if (status === "failed") return messageText("Agent load failed", "智能体加载失败");
      if (status === "completed") return messageText("Agent ready", "智能体已就绪");
      return messageText("Loading agent…", "正在加载智能体…");
    case "compaction":
      if (status === "failed") return messageText("Conversation compaction failed", "对话压缩失败");
      if (status === "cancelled") return messageText("Conversation compaction cancelled", "对话压缩已取消");
      if (status === "completed") return messageText("Conversation summarized", "对话已摘要");
      return messageText("Compacting conversation…", "正在压缩对话…");
    case "context-pressure":
      return messageText("Context pressure", "上下文压力");
    case "tool-compaction":
      return messageText("Tool history compacted", "工具历史已压缩");
    case "context-compressed":
      return messageText("Context compressed", "上下文已压缩");
    case "rollback":
      return messageText("Session rolled back", "会话已回滚");
    default:
      return messageText("iCode activity", "iCode 活动");
  }
}

function setupAgentBubbleToggle(bubble: HTMLElement, header: HTMLElement): void {
  const toggle = () => {
    const folded = !bubble.classList.contains("agent-folded");
    bubble.classList.toggle("agent-folded", folded);
    header.setAttribute("aria-expanded", folded ? "false" : "true");
    const marker = bubble.querySelector<HTMLElement>(".bubble-marker");
    if (marker) marker.textContent = folded ? "▶" : "◇";
  };
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", bubble.classList.contains("agent-folded") ? "false" : "true");
  header.setAttribute("aria-label", messageText("Toggle agent message", "折叠或展开智能体消息"));
  header.addEventListener("click", toggle);
  header.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
}

export function ensureToolGroup(msg: ChatMessage, messageArea: HTMLElement, statusBar: HTMLElement): ToolGroupState {
  if (state.activeToolGroup) return state.activeToolGroup;
  const summary = el("summary", { class: "tool-group-summary" }, "");
  const body = el("div", { class: "tool-group-body" });
  const root = el("details", { class: "tool-group", open: "" }, summary, body) as HTMLDetailsElement;
  const group: ToolGroupState = { root, summary, body, ids: [], startedAt: msg.timestamp };
  root.addEventListener("toggle", () => {
    updateToolGroup(group, statusBar);
  });
  state.activeToolGroup = group;
  messageArea.appendChild(root);
  return group;
}

export function finishActiveToolGroup(collapse: boolean, statusBar: HTMLElement): void {
  if (!state.activeToolGroup) return;
  const group = state.activeToolGroup;
  state.activeToolGroup = null;
  if (collapse) {
    group.root.open = false;
    group.autoCollapsed = true;
  }
  if (group.timer !== undefined) {
    window.clearInterval(group.timer);
    group.timer = undefined;
  }
  updateToolGroup(group, statusBar);
}

export function updateToolGroup(group: ToolGroupState, statusBar: HTMLElement): void {
  const groupMessages = group.ids
    .map((id) => state.messages.find((message) => message.id === id))
    .filter((message): message is ChatMessage => message !== undefined);
  const total = groupMessages.length;
  const done = groupMessages.filter(isToolDone).length;
  const failed = groupMessages.filter((message) => message.toolStatus === "failed").length;
  const lastTimestamp = groupMessages[groupMessages.length - 1]?.timestamp ?? Date.now();
  const endTimestamp = done < total ? Date.now() : lastTimestamp;
  const elapsedMs = Math.max(0, endTimestamp - group.startedAt);
  group.summary.textContent = toolGroupSummaryText(group.root.open, groupMessages, done, total, failed, elapsedMs);
  group.summary.setAttribute("aria-label", toolGroupAriaLabel(done, total, failed, elapsedMs));
  group.root.classList.toggle("has-failed", failed > 0);
  if (done < total) {
    if (group.timer === undefined) {
      group.timer = window.setInterval(() => updateToolGroup(group, statusBar), 1000);
    }
  } else if (group.timer !== undefined) {
    window.clearInterval(group.timer);
    group.timer = undefined;
  }
  updateStatusBar(statusBar, state.latestState);
}

function toolGroupSummaryText(open: boolean, messages: ChatMessage[], done: number, total: number, failed: number, elapsedMs: number): string {
  const arrow = open ? "▼" : "▶";
  const parts = [`${arrow} ${messageText("Tools", "工具")} ${done}/${total}`];
  const kindSummary = toolKindSummary(messages);
  if (kindSummary) parts.push(kindSummary);
  if (elapsedMs >= 1000) parts.push(formatDurationMs(elapsedMs));
  if (failed) parts.push(state.uiLanguage === "zh-CN" ? `${failed} 个失败` : `${failed} failed`);
  return parts.join(" · ");
}

function toolGroupAriaLabel(done: number, total: number, failed: number, elapsedMs: number): string {
  const base = state.uiLanguage === "zh-CN" ? `工具调用，${done}/${total} 已完成` : `Tool calls, ${done} of ${total} complete`;
  const failedText = failed ? (state.uiLanguage === "zh-CN" ? `，${failed} 个失败` : `, ${failed} failed`) : "";
  const elapsed = elapsedMs >= 1000 ? (state.uiLanguage === "zh-CN" ? `，耗时 ${formatDurationMs(elapsedMs)}` : `, ${formatDurationMs(elapsedMs)}`) : "";
  return `${base}${failedText}${elapsed}`;
}

function toolKindSummary(messages: ChatMessage[]): string {
  const counts = new Map<string, { label: string; count: number }>();
  for (const message of messages) {
    const kind = normalizeToolKind(message.toolKind, message.toolName);
    const existing = counts.get(kind);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(kind, { label: toolKindLabel(kind, message.toolName), count: 1 });
    }
  }
  const entries = [...counts.values()].slice(0, 3);
  const summary = entries.map((entry) => `${entry.label} ${entry.count}`).join(" · ");
  const hidden = counts.size - entries.length;
  if (!hidden) return summary;
  return `${summary} · +${hidden}`;
}

export function appendToolMessage(msg: ChatMessage, messageArea: HTMLElement, statusBar: HTMLElement): void {
  const group = ensureToolGroup(msg, messageArea, statusBar);
  const toolCard = renderMessage(msg);
  group.body.appendChild(toolCard);
  group.ids.push(msg.id);
  state.messageMap.set(msg.id, toolCard);
  state.toolGroupByMessageId.set(msg.id, group);
  updateToolGroup(group, statusBar);
}

export function shouldFollowMessages(messageArea: HTMLElement): boolean {
  return state.messageScrollAnchored || isMessageAreaAtBottom(messageArea);
}

export function forceFollowMessages(): void {
  state.forceFollowNextMessage = true;
  state.messageScrollAnchored = true;
}

export function consumeForceFollowNextMessage(): boolean {
  const shouldForce = state.forceFollowNextMessage;
  state.forceFollowNextMessage = false;
  if (shouldForce) state.messageScrollAnchored = true;
  return shouldForce;
}

export function isMessageAreaAtBottom(messageArea: HTMLElement): boolean {
  const remaining = messageArea.scrollHeight - messageArea.clientHeight - messageArea.scrollTop;
  return remaining <= state.MESSAGE_SCROLL_ANCHOR_PX;
}

export function scheduleMessageAnchorSync(shouldFollow: boolean, messageArea: HTMLElement): void {
  if (!shouldFollow) return;
  state.messageScrollAnchored = true;
  if (state.messageScrollSyncScheduled) return;
  state.messageScrollSyncScheduled = true;
  requestAnimationFrame(() => {
    syncMessageAnchorBottom(messageArea);
    requestAnimationFrame(() => {
      syncMessageAnchorBottom(messageArea);
      state.messageScrollSyncScheduled = false;
    });
  });
}

function syncMessageAnchorBottom(messageArea: HTMLElement): void {
  if (!state.messageScrollAnchored) return;
  messageArea.scrollTop = messageArea.scrollHeight;
}
