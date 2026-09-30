import type { ChatPanelState } from "../../panel";
import { state } from "../state";
import { formatDurationMs } from "../helpers";
import { effectiveToolStatus } from "./toolCards";

const STATUS_LABELS = {
  en: {
    running: "Thinking",
    cancelling: "Cancelling",
    idle: "Completed",
    toolCall: "tool call",
    toolCalls: "tool calls",
  },
  "zh-CN": {
    running: "思考中",
    cancelling: "取消中",
    idle: "已完成",
    toolCall: "工具调用",
    toolCalls: "工具调用",
  },
};

export function statusLabel(sessionState: ChatPanelState["sessionState"]): string {
  return STATUS_LABELS[state.uiLanguage][sessionState];
}

export function currentToolStats(): { total: number; done: number } {
  let total = 0;
  let done = 0;
  for (const message of state.messages) {
    if (message.kind !== "tool_call" && message.kind !== "tool_result") continue;
    total += 1;
    const status = effectiveToolStatus(message);
    if (status !== "pending" && status !== "in_progress") done += 1;
  }
  return { total, done };
}

export function hasStatusRunContent(sessionState: ChatPanelState["sessionState"], toolStats: { total: number }): boolean {
  return sessionState !== "idle" || Boolean(state.lastCompletedElapsed) || toolStats.total > 0;
}

export function updateStatusBar(statusBar: HTMLElement, panelState?: ChatPanelState | null): void {
  const statusRun = statusBar.querySelector(".status-run")!;
  const statusState = statusBar.querySelector(".status-state")!;
  const statusTrail = statusBar.querySelector(".status-trail")!;
  const statusTokens = statusBar.querySelector(".status-tokens");
  const sessionState = panelState?.sessionState ?? state.currentSessionState;
  const toolStats = currentToolStats();
  const showRun = hasStatusRunContent(sessionState, toolStats);
  statusRun.classList.toggle("hidden", !showRun);
  statusTokens?.classList.toggle("hidden", !panelState?.usageText);
  if (!showRun) {
    statusState.textContent = "";
    statusTrail.textContent = "";
    return;
  }
  const label = statusLabel(sessionState);
  statusState.textContent = label;
  statusState.className = `status-state status-${sessionState}`;
  const trail: string[] = [];
  if (sessionState === "running" && state.statusRunStartedAt) {
    trail.push(formatDurationMs(Date.now() - state.statusRunStartedAt));
  } else if (state.lastCompletedElapsed) {
    trail.push(state.lastCompletedElapsed);
  }
  if (toolStats.total) {
    const label = toolStats.total === 1 ? STATUS_LABELS[state.uiLanguage].toolCall : STATUS_LABELS[state.uiLanguage].toolCalls;
    trail.push(`${toolStats.done}/${toolStats.total} ${label}`);
  }
  statusTrail.textContent = trail.length ? `  (${trail.join(" · ")})` : "";
}
