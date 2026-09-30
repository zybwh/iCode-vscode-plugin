import type { ChatMessage } from "../provider";
import type { ProfileSummary } from "../../acp/types";
import type { UiLanguage } from "../../common/i18n";
import type { UiTheme } from "../../common/uiTheme";
import type {
  ChatApprovalDialogState,
  ChatInlineDialogState,
  ChatModelDialogState,
  ChatPanelState,
} from "../panel";

// ──────────────────────────────────────────────
// State interfaces
// ──────────────────────────────────────────────

export interface ToolGroupState {
  root: HTMLDetailsElement;
  summary: HTMLElement;
  body: HTMLElement;
  ids: string[];
  startedAt: number;
  timer?: number;
  autoCollapsed?: boolean;
}

export interface DebugEvent {
  time: number;
  kind: string;
  detail: string;
}

// ──────────────────────────────────────────────
// Mutable state object (single export to allow mutation from importing modules)
// ──────────────────────────────────────────────

export const state = {
  messages: [] as ChatMessage[],
  /** O(1) lookup for streamed/tool updates; mirrors `messages`. */
  messageById: new Map<string, ChatMessage>(),
  messageMap: new Map<string, HTMLElement>(),
  usageHistory: [0] as number[],
  statusRunStartedAt: undefined as number | undefined,
  statusTimer: undefined as number | undefined,
  lastCompletedElapsed: "",
  companionPettingUntil: 0,
  modelDialogState: { models: [] as ChatModelDialogState["models"], profiles: {} as Record<string, Record<string, unknown>>, activeModelProfileId: "" },
  selectedModelId: "",
  agentDialogState: { agents: [] as ProfileSummary[], profiles: {} as Record<string, Record<string, unknown>>, activeAgentName: "" },
  selectedAgentName: "",
  inlineDialogState: null as ChatInlineDialogState | null,
  isComposingText: false,
  localSubmitPending: false,
  queuedInjectionPending: false,
  inputTriggerPending: false,
  currentAgentName: "Code Agent",
  uiLanguage: "en" as UiLanguage,
  currentTheme: "chrys" as UiTheme,
  currentSessionState: "idle" as ChatPanelState["sessionState"],
  latestState: null as ChatPanelState | null,
  activeToolGroup: null as ToolGroupState | null,
  toolGroupByMessageId: new Map<string, ToolGroupState>(),
  debugEvents: [] as DebugEvent[],
  MESSAGE_SCROLL_ANCHOR_PX: 8,
  messageScrollAnchored: true,
  messageScrollSyncScheduled: false,
  forceFollowNextMessage: false,
  promptHistory: [] as string[],
  promptHistoryIndex: 0,
  promptHistoryDraft: "",
};

// ──────────────────────────────────────────────
// State mutation helpers
// ──────────────────────────────────────────────

/** Pick the English or Simplified Chinese variant for the webview's current language. */
export function uiText(en: string, zh: string): string {
  return state.uiLanguage === "zh-CN" ? zh : en;
}

export function recordPromptHistory(text: string): void {
  const value = text.trim();
  if (!value) return;
  const last = state.promptHistory[state.promptHistory.length - 1];
  if (last !== value) {
    state.promptHistory.push(value);
    if (state.promptHistory.length > 100) state.promptHistory.splice(0, state.promptHistory.length - 100);
  }
  state.promptHistoryIndex = state.promptHistory.length;
  state.promptHistoryDraft = "";
}

export function shouldNavigatePromptHistory(direction: -1 | 1, inputField: HTMLTextAreaElement): boolean {
  if (!state.promptHistory.length || state.currentSessionState !== "idle" || state.queuedInjectionPending) return false;
  if (inputField.selectionStart !== inputField.selectionEnd) return false;
  const cursor = inputField.selectionStart ?? 0;
  if (direction < 0) {
    return cursor === 0 || !inputField.value.slice(0, cursor).includes("\n");
  }
  return cursor === inputField.value.length || !inputField.value.slice(cursor).includes("\n");
}

export function navigatePromptHistory(direction: -1 | 1, inputField: HTMLTextAreaElement): void {
  if (!state.promptHistory.length) return;
  if (state.promptHistoryIndex === state.promptHistory.length) {
    state.promptHistoryDraft = inputField.value;
  }
  state.promptHistoryIndex = Math.max(0, Math.min(state.promptHistory.length, state.promptHistoryIndex + direction));
  inputField.value = state.promptHistoryIndex === state.promptHistory.length ? state.promptHistoryDraft : state.promptHistory[state.promptHistoryIndex];
}
