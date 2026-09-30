import type { TextAttachment } from "../context/attachments";
import type { CompanionViewState } from "../companion/types";
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { ChatMessage } from "./provider";
import type { ContentBlock, ModelSummary, PermissionOption, PlanEntry, ProfileSummary, RequestInputAnswer, RequestInputQuestion, SessionInfo } from "../acp/types";
import { rt, bindRuntime, currentRuntime, focusRuntime, scheduleIdleRuntimeRelease } from "../state/runtime";
import type { UiLanguage } from "../common/i18n";
import type { UiBrand } from "../common/uiBrand";
import type { UiTheme } from "../common/uiTheme";
import { logError, recordDebugEvent } from "../common/logging";
import { runtimeVisionEnabled } from "../common/runtimeUtils";
import { ReadyMessageQueue } from "./readyMessageQueue";
import type { ChatConnectionState } from "./webview/connectionPresentation";
import { hostUiLanguage, localized as panelText } from "../common/hostI18n";

/** Changes once per extension-host start so rebuilt bundles are not served from cache. */
const WEBVIEW_ASSET_VERSION = Date.now().toString(36);
/** Upper bound on how long a streamed text update waits before reaching the webview. */
export const STREAM_FLUSH_MS = 40;

export interface ChatModelDialogState {
  models: ModelSummary[];
  profiles: Record<string, Record<string, unknown>>;
  activeModelProfileId: string;
  selectedModelId?: string;
}

export interface ChatAgentDialogState {
  updatedAgentName?: string;
  agents: ProfileSummary[];
  profiles: Record<string, Record<string, unknown>>;
  activeAgentName: string;
}

export interface ChatApprovalDialogState {
  requestId: string;
  title: string;
  subtitle: string;
  detail: string;
  preview?: {
    label: string;
    subtitle?: string;
    before: string;
    after: string;
  };
  options: PermissionOption[];
  reasonEnabled?: boolean;
}

export interface ChatAskUserDialogState {
  requestId: string;
  title: string;
  subtitle: string;
  questions: RequestInputQuestion[];
  responsePlaceholder: string;
  notePlaceholder: string;
  reviewLabel: string;
  reviewTitle: string;
  editLabel: string;
  unansweredLabel: string;
  submitLabel: string;
  previousLabel: string;
  nextLabel: string;
  skipLabel: string;
}

export interface ChatSessionsSidebarState {
  status: "idle" | "loading" | "ready" | "error";
  sessions: SessionInfo[];
  currentSessionId?: string;
  error?: string;
}

export interface ChatAgentLifecycleState {
  status: "loading" | "ready" | "failed";
  label?: string;
  detail?: string;
  current?: number;
  total?: number;
  updatedAt: number;
}

export type ChatInlineDialogState =
  | {
      kind: "sessions";
      title: string;
      subtitle: string;
      sessions: SessionInfo[];
    }
  | {
      kind: "agents";
      title: string;
      subtitle: string;
      agents: ProfileSummary[];
      activeAgentName: string;
    }
  | {
      kind: "runtime" | "notice";
      title: string;
      subtitle: string;
      body: string;
    }
  | {
      kind: "logs";
      title: string;
      subtitle: string;
      logTabs: LogTab[];
    }
  | {
      kind: "runtimeDetails";
      title: string;
      subtitle: string;
      tabs: RuntimeDetailsTab[];
      activeTabId?: string;
    };

export interface LogTab {
  id: string;
  label: string;
  text: string;
}

export interface RuntimeDetailsTab {
  id: string;
  label: string;
  sections: RuntimeDetailsSection[];
}

export interface RuntimeDetailsSection {
  title: string;
  lines: string[];
  empty?: string;
}

// ──────────────────────────────────────────────
// Webview message protocol (host → webview)
// ──────────────────────────────────────────────

export type HostMessage =
  | { type: "appendMessage"; message: ChatMessage }
  | { type: "appendMessages"; messages: ChatMessage[] }
  | { type: "updateMessage"; messageId: string; patch: Partial<ChatMessage> }
  | { type: "updateMessageTextOnly"; messageId: string; text: string }
  | { type: "removeMessage"; messageId: string }
  | { type: "clearMessages" }
  | { type: "setState"; state: ChatPanelState }
  | { type: "setComposer"; text: string; restore?: boolean }
  | { type: "addTextAttachment"; attachment: TextAttachment }
  | { type: "reconnectNotice" }
  | { type: "debugEvent"; kind: string; detail: string }
  | { type: "localCommand"; command: "notifications" }
  | { type: "modelDialogState"; state: ChatModelDialogState }
  | { type: "modelDialogBusy"; busy: boolean }
  | { type: "modelDialogNotice"; level: "info" | "warning" | "error"; text: string }
  | { type: "agentDialogState"; state: ChatAgentDialogState }
  | { type: "agentDialogBusy"; busy: boolean }
  | { type: "agentDialogNotice"; level: "info" | "warning" | "error"; text: string }
  | { type: "applyTheme"; theme: string }
  | { type: "inlineDialogState"; state: ChatInlineDialogState }
  | { type: "inlineDialogBusy"; busy: boolean }
  | { type: "inlineDialogNotice"; level: "info" | "warning" | "error"; text: string }
  | { type: "approvalDialogState"; state: ChatApprovalDialogState | null }
  | { type: "askUserDialogState"; state: ChatAskUserDialogState | null }
  | { type: "sessionsSidebarState"; state: ChatSessionsSidebarState };

// ──────────────────────────────────────────────
// Webview → host messages
// ──────────────────────────────────────────────

type WebviewMessage =
  | { type: "composerDraft"; text: string }
  | { type: "sendMessage"; text: string; attachments?: TextAttachment[]; images?: Array<{ data: string; mimeType: string; uri?: string; _meta?: Record<string, unknown> }> }
  | { type: "cancel" }
  | {
      type: "command";
      command: ChatCommand;
      arg?: string;
    }
  | { type: "modelDialogRefresh" }
  | { type: "modelDialogSave"; model: Record<string, unknown> }
  | { type: "modelDialogDelete"; id: string }
  | { type: "modelDialogSetActive"; id: string }
  | { type: "agentDialogRefresh" }
  | { type: "agentDialogSave"; agent: Record<string, unknown> }
  | { type: "agentDialogDelete"; name: string }
  | { type: "agentDialogSetActive"; name: string }
  | {
      type: "inlineDialogAction";
      action: "resumeSession" | "deleteSession" | "switchAgent" | "newSession";
      id?: string;
      cwd?: string;
      name?: string;
    }
  | { type: "inlineDialogClosed" }
  | { type: "approvalDialogDecision"; optionId?: string; reason?: string }
  | { type: "askUserDialogResponse"; requestId: string; answers: RequestInputAnswer[]; cancelled: boolean; source?: string }
  | { type: "openApprovalPreviewDiff"; label: string; before: string; after: string }
  | { type: "setApprovalMode"; mode: string }
  | { type: "sessionsSidebarRefresh" }
  | { type: "sessionsSidebarAction"; action: "resumeSession" | "deleteSession"; id: string; cwd?: string }
  | { type: "skipSleep"; toolCallId: string }
  | { type: "openToolDiff"; toolCallId: string }
  | { type: "openFile"; path: string; line?: number }
  | { type: "openExternalResource"; uri: string }
  | { type: "webviewReady" }
  | { type: "frontendDebugEvent"; kind: string; detail: string }
  | { type: "webviewError"; message: string; source?: string; lineno?: number; colno?: number; stack?: string };

// ──────────────────────────────────────────────

export interface ChatPanelState {
  chrysCliVersion?: string;
  uiLanguage?: UiLanguage;
  uiTheme?: UiTheme;
  uiBrand?: UiBrand;
  agentName: string;
  modelName: string;
  sessionId: string;
  sessionState: "idle" | "running" | "cancelling";
  platformLabel?: string;
  usageText?: string;
  latestInputTokens?: number;
  latestOutputTokens?: number;
  latestCacheHitTokens?: number;
  localTokens?: number;
  calibrationRatio?: number;
  systemOverheadTokens?: number;
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  contextPct?: number;
  cacheHitTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  compressedMessages?: string[];
  imageInputEnabled?: boolean;
  companion?: CompanionViewState | null;
  activeCompactionCount?: number;
  committedCompactionCount?: number;
  approvalMode?: string;
  workspacePath?: string;
  additionalDirectories?: string[];
  toolCount?: number;
  fileCount?: number;
  mcpTools?: Record<string, string[]>;
  runtimeSkillNames?: string[];
  mcpFailures?: Record<string, string>;
  memoryFiles?: string[];
  subAgentToolNames?: string[];
  planEntries?: PlanEntry[];
  sessionTitle?: string;
  sessionUpdatedAt?: string;
  agentLifecycle?: ChatAgentLifecycleState | null;
  connectionState?: ChatConnectionState;
  connectionDetail?: string;
  connectionStartedAt?: number;
}

type SendHandler = (text: string, blocks: ContentBlock[]) => void;
type CancelHandler = () => void;
export type ChatCommand =
  | "newSession"
  | "resumeLastSession"
  | "showSessions"
  | "clearChat"
  | "showPromptHistory"
  | "renameSession"
  | "attachFile"
  | "insertFileMention"
  | "openShell"
  | "runtimeTools"
  | "runtimeFiles"
  | "searchWorkspace"
  | "grepWorkspace"
  | "findWorkspaceFile"
  | "showLogs"
  | "runtimeDetails"
  | "selectAgent"
  | "showDiff"
  | "rollback"
  | "retrySubAgent"
  | "abortSubAgent"
  | "setApprovalMode"
  | "switchAgent"
  | "showAgentProfiles"
  | "showModelProfiles"
  | "reloadSettings"
  | "changeWorkspace"
  | "showStructuredHistory"
  | "setModelProfile"
  | "createModelProfile"
  | "deleteModelProfile"
  | "deleteAgentProfile"
  | "testMcpServer"
  | "setConfigOption"
  | "manage"
  | "manageModels"
  | "manageAgents"
  | "diagnostics"
  | "copySupportBundle"
  | "trajectory"
  | "workflows"
  | "doctor"
  | "companionCommand"
  | "summonCompanion"
  | "pickBrand"
  | "pickTheme"
  | "closeChat";
type CommandHandler = (command: ChatCommand, arg?: string) => void;
type ToolDiffHandler = (toolCallId: string) => void;
type OpenFileHandler = (path: string, line?: number) => void;
type ModelDialogRefreshHandler = () => void;
type ModelDialogSaveHandler = (model: Record<string, unknown>) => void;
type ModelDialogDeleteHandler = (id: string) => void;
type ModelDialogSetActiveHandler = (id: string) => void;
type AgentDialogRefreshHandler = () => void;
type AgentDialogSaveHandler = (agent: Record<string, unknown>) => void;
type AgentDialogDeleteHandler = (name: string) => void;
type AgentDialogSetActiveHandler = (name: string) => void;
type InlineDialogActionHandler = (
  action: "resumeSession" | "deleteSession" | "switchAgent" | "newSession",
  payload: { id?: string; cwd?: string; name?: string },
) => void;
type InlineDialogClosedHandler = () => void;
type ApprovalDialogDecisionHandler = (optionId?: string, reason?: string) => void;
type AskUserDialogResponseHandler = (requestId: string, answers: RequestInputAnswer[], cancelled: boolean, source?: string) => void;
type ApprovalModeSelectHandler = (mode: string) => void;
type SleepSkipHandler = (toolCallId: string) => void;
type SessionsSidebarRequestHandler = (
  action: "refresh" | "resumeSession" | "deleteSession",
  payload?: { id: string; cwd?: string },
) => void;

/** Host-side handlers for webview messages; cleared together when the panel is disposed. */
interface PanelHandlers {
  send: SendHandler;
  cancel: CancelHandler;
  command: CommandHandler;
  toolDiff: ToolDiffHandler;
  openFile: OpenFileHandler;
  modelDialogRefresh: ModelDialogRefreshHandler;
  modelDialogSave: ModelDialogSaveHandler;
  modelDialogDelete: ModelDialogDeleteHandler;
  modelDialogSetActive: ModelDialogSetActiveHandler;
  agentDialogRefresh: AgentDialogRefreshHandler;
  agentDialogSave: AgentDialogSaveHandler;
  agentDialogDelete: AgentDialogDeleteHandler;
  agentDialogSetActive: AgentDialogSetActiveHandler;
  inlineDialogAction: InlineDialogActionHandler;
  inlineDialogClosed: InlineDialogClosedHandler;
  approvalDialogDecision: ApprovalDialogDecisionHandler;
  askUserDialogResponse: AskUserDialogResponseHandler;
  approvalModeSelect: ApprovalModeSelectHandler;
  sleepSkip: SleepSkipHandler;
  sessionsSidebarRequest: SessionsSidebarRequestHandler;
}

export class ChatPanel {
  private panel: vscode.WebviewPanel;
  private disposed = false;
  private webviewReady = false;
  private lastState: ChatPanelState | undefined;
  private lastApproval: ChatApprovalDialogState | null = null;
  private lastAskUser: ChatAskUserDialogState | null = null;
  private companionAssetBaseUri: string;
  private readonly readyMessages: ReadyMessageQueue<HostMessage>;
  private handlers: Partial<PanelHandlers> = {};
  /** Latest streamed text per message, flushed at most every STREAM_FLUSH_MS. */
  private readonly pendingText = new Map<string, string>();
  private textFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly owner = currentRuntime();

  constructor(context: vscode.ExtensionContext, preserveFocus = false) {
    this.panel = vscode.window.createWebviewPanel(
      "chrys.chat",
      "iCode",
      { viewColumn: vscode.ViewColumn.Two, preserveFocus },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "dist"),
        ],
      },
    );
    this.companionAssetBaseUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "assets")).toString();
    this.readyMessages = new ReadyMessageQueue((message) => {
      void this.panel.webview.postMessage(message);
    });
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "icon.png");

    this.panel.webview.onDidReceiveMessage(bindRuntime((msg: WebviewMessage) => {
      if (this.disposed) return;
      switch (msg.type) {
        case "composerDraft":
          this.owner.composerDraft = msg.text;
          break;
        case "sendMessage":
          if (msg.images?.length) {
            if ((runtimeVisionEnabled(rt.currentRuntime) ?? (rt.currentPromptCapabilities?.image === true)) !== true) {
              const warning = panelText(
                "The active iCode model profile does not support image input.",
                "当前 iCode 模型配置不支持图片输入。",
              );
              this.appendDebugEvent("ImageSendBlocked", warning);
              vscode.window.showWarningMessage(warning);
              break;
            }
            this.appendDebugEvent("ImageSend", `${msg.images.length} image(s)`);
          }
          if (msg.attachments?.length && rt.sessionManager?.state !== "idle") break;
          this.handlers.send?.(msg.text, [
            { type: "text", text: msg.text },
            ...(msg.attachments ?? []).slice(0,20).filter(a=>typeof a.text==="string").map(a=>({type:"text" as const,text:a.text.slice(0,120000)})),
            ...(msg.images ?? []).map((image) => ({ type: "image" as const, ...image })),
          ]);
          break;
        case "cancel":
          this.handlers.cancel?.();
          break;
        case "command":
          this.handlers.command?.(msg.command, msg.arg);
          break;
        case "modelDialogRefresh":
          this.handlers.modelDialogRefresh?.();
          break;
        case "modelDialogSave":
          this.handlers.modelDialogSave?.(msg.model);
          break;
        case "modelDialogDelete":
          this.handlers.modelDialogDelete?.(msg.id);
          break;
        case "modelDialogSetActive":
          this.handlers.modelDialogSetActive?.(msg.id);
          break;
        case "agentDialogRefresh":
          this.handlers.agentDialogRefresh?.();
          break;
        case "agentDialogSave":
          this.handlers.agentDialogSave?.(msg.agent);
          break;
        case "agentDialogDelete":
          this.handlers.agentDialogDelete?.(msg.name);
          break;
        case "agentDialogSetActive":
          this.handlers.agentDialogSetActive?.(msg.name);
          break;
        case "inlineDialogAction":
          this.handlers.inlineDialogAction?.(msg.action, { id: msg.id, cwd: msg.cwd, name: msg.name });
          break;
        case "inlineDialogClosed":
          rt.closeInlineDialog();
          this.handlers.inlineDialogClosed?.();
          break;
        case "approvalDialogDecision":
          this.handlers.approvalDialogDecision?.(msg.optionId, msg.reason);
          break;
        case "askUserDialogResponse":
          this.handlers.askUserDialogResponse?.(msg.requestId, msg.answers, msg.cancelled, msg.source);
          break;
        case "openApprovalPreviewDiff":
          this._openApprovalPreviewDiff(msg.label, msg.before, msg.after).catch(() => {});
          break;
        case "setApprovalMode":
          this.handlers.approvalModeSelect?.(msg.mode);
          break;
        case "sessionsSidebarRefresh":
          this.handlers.sessionsSidebarRequest?.("refresh");
          break;
        case "sessionsSidebarAction":
          this.handlers.sessionsSidebarRequest?.(msg.action, { id: msg.id, cwd: msg.cwd });
          break;
        case "skipSleep":
          this.handlers.sleepSkip?.(msg.toolCallId);
          break;
        case "openToolDiff":
          this.handlers.toolDiff?.(msg.toolCallId);
          break;
        case "openFile":
          this.handlers.openFile?.(msg.path, msg.line);
          break;
        case "openExternalResource":
          this._openExternalResource(msg.uri).catch(() => {});
          break;
        case "webviewReady":
          if (this.webviewReady) {
            this.clearMessages();
            this.replayTranscript(rt.transcript.messages);
            this.setComposer(this.owner.composerDraft);
            if (this.lastState) this.setState(this.lastState);
            if (this.lastApproval) this.setApprovalDialogState(this.lastApproval);
            if (this.lastAskUser) this.setAskUserDialogState(this.lastAskUser);
          }
          this.webviewReady = true;
          this.readyMessages.markReady();
          recordDebugEvent("WebviewReady", "startup state synchronized");
          break;
        case "frontendDebugEvent":
          recordDebugEvent(msg.kind, msg.detail);
          break;
        case "webviewError":
          this.appendDebugEvent("WebviewError", msg.message);
          logError(`Webview error: ${formatWebviewError(msg)}`);
          break;
      }
    }, this.owner));
    this.panel.onDidChangeViewState?.(() => {
      if (this.panel.active) focusRuntime(this.owner);
    });
    this.panel.webview.html = this._getHtml(context);
    this.replayTranscript(rt.transcript.messages);

    if (this.owner.composerDraft) this.setComposer(this.owner.composerDraft);
    if (this.owner.pendingApproval) this.setApprovalDialogState(this.owner.pendingApproval);
    if (this.owner.pendingQuestion) this.setAskUserDialogState(this.owner.pendingQuestion);
    this.panel.onDidDispose(bindRuntime(() => {
      // Detach before cancelling dialogs: their cleanup can post to this panel.
      this.disposed = true;
      if (this.textFlushTimer) clearTimeout(this.textFlushTimer);
      this.textFlushTimer = null;
      this.pendingText.clear();
      if (rt.chatPanel === this) {
        rt.chatPanel = null;
        rt.closeInlineDialog();
        // A view closing is not an approval decision or a task cancellation.
        scheduleIdleRuntimeRelease(this.owner);
      }
      this.handlers = {};
    }, this.owner));
  }

  // ── Events from host to register ───────────

  onSendMessage(handler: SendHandler): void {
    this.handlers.send = handler;
  }

  onCancel(handler: CancelHandler): void {
    this.handlers.cancel = handler;
  }

  onCommand(handler: CommandHandler): void {
    this.handlers.command = handler;
  }

  onToolDiff(handler: ToolDiffHandler): void {
    this.handlers.toolDiff = handler;
  }

  onOpenFile(handler: OpenFileHandler): void {
    this.handlers.openFile = handler;
  }

  onModelDialogRefresh(handler: ModelDialogRefreshHandler): void {
    this.handlers.modelDialogRefresh = handler;
  }

  onModelDialogSave(handler: ModelDialogSaveHandler): void {
    this.handlers.modelDialogSave = handler;
  }

  onModelDialogDelete(handler: ModelDialogDeleteHandler): void {
    this.handlers.modelDialogDelete = handler;
  }

  onModelDialogSetActive(handler: ModelDialogSetActiveHandler): void {
    this.handlers.modelDialogSetActive = handler;
  }

  onAgentDialogRefresh(handler: AgentDialogRefreshHandler): void {
    this.handlers.agentDialogRefresh = handler;
  }

  onAgentDialogSave(handler: AgentDialogSaveHandler): void {
    this.handlers.agentDialogSave = handler;
  }

  onAgentDialogDelete(handler: AgentDialogDeleteHandler): void {
    this.handlers.agentDialogDelete = handler;
  }

  onAgentDialogSetActive(handler: AgentDialogSetActiveHandler): void {
    this.handlers.agentDialogSetActive = handler;
  }

  onInlineDialogAction(handler: InlineDialogActionHandler): void {
    this.handlers.inlineDialogAction = handler;
  }

  onInlineDialogClosed(handler: InlineDialogClosedHandler): void {
    this.handlers.inlineDialogClosed = handler;
  }

  onApprovalDialogDecision(handler: ApprovalDialogDecisionHandler): void {
    this.handlers.approvalDialogDecision = handler;
  }

  onAskUserDialogResponse(handler: AskUserDialogResponseHandler): void {
    this.handlers.askUserDialogResponse = handler;
  }

  onApprovalModeSelect(handler: ApprovalModeSelectHandler): void {
    this.handlers.approvalModeSelect = handler;
  }

  onSleepSkip(handler: SleepSkipHandler): void {
    this.handlers.sleepSkip = handler;
  }

  onSessionsSidebarRequest(handler: SessionsSidebarRequestHandler): void {
    this.handlers.sessionsSidebarRequest = handler;
  }

  // ── Push messages to webview ───────────────

  appendMessage(message: ChatMessage): void {
    this._post({ type: "appendMessage", message });
  }

  /** Sends a restored transcript as one message so the webview renders it in one pass. */
  replayTranscript(messages: readonly ChatMessage[]): void {
    if (messages.length) this._post({ type: "appendMessages", messages: [...messages] });
  }

  updateMessage(messageId: string, patch: Partial<ChatMessage>): void {
    this._post({ type: "updateMessage", messageId, patch });
  }

  /**
   * Streaming chunks each carry the full accumulated text. Coalesce them so the webview
   * re-renders a growing message a bounded number of times per second instead of once
   * per token. Any other message flushes pending text first to preserve ordering.
   */
  updateMessageTextOnly(messageId: string, text: string): void {
    if (this.disposed) return;
    this.pendingText.set(messageId, text);
    this.textFlushTimer ??= setTimeout(() => {
      this.textFlushTimer = null;
      this._flushPendingText();
    }, STREAM_FLUSH_MS);
  }

  private _flushPendingText(): void {
    if (this.textFlushTimer) {
      clearTimeout(this.textFlushTimer);
      this.textFlushTimer = null;
    }
    if (!this.pendingText.size || this.disposed) {
      this.pendingText.clear();
      return;
    }
    const updates = [...this.pendingText];
    this.pendingText.clear();
    for (const [messageId, text] of updates) this.readyMessages.send({ type: "updateMessageTextOnly", messageId, text });
  }

  removeMessage(messageId: string): void {
    this.pendingText.delete(messageId);
    this._post({ type: "removeMessage", messageId });
  }

  clearMessages(): void {
    // Cleared or rehydrated transcripts are re-sent in full; queued text is obsolete.
    this.pendingText.clear();
    this._post({ type: "clearMessages" });
  }

  setState(state: ChatPanelState): void {
    this.lastState = state;
    this.updateTitle();
    const companion = state.companion ? { ...state.companion, assetBaseUri: state.companion.assetBaseUri || this.companionAssetBaseUri } : state.companion;
    this._post({ type: "setState", state: { ...state, companion } });
  }

  addTextAttachment(attachment: TextAttachment): void {
    this._post({type:"addTextAttachment",attachment});
  }

  setComposer(text: string, options?: { restore: boolean }): void {
    if (this.disposed) return;
    // The webview arbitrates again because a new draft may be in flight to the host.
    if (!options?.restore || !this.owner.composerDraft) this.owner.composerDraft = text;
    this._post({ type: "setComposer", text, ...(options?.restore ? { restore: true } : {}) });
  }

  showReconnectNotice(): void {
    this._post({ type: "reconnectNotice" });
  }

  appendDebugEvent(kind: string, detail = ""): void {
    recordDebugEvent(kind, detail);
    this._post({ type: "debugEvent", kind, detail });
  }

  setModelDialogState(state: ChatModelDialogState): void {
    this._post({ type: "modelDialogState", state });
  }

  setModelDialogBusy(busy: boolean): void {
    this._post({ type: "modelDialogBusy", busy });
  }

  modelDialogNotice(level: "info" | "warning" | "error", text: string): void {
    this._post({ type: "modelDialogNotice", level, text });
  }

  setAgentDialogState(state: ChatAgentDialogState): void {
    this._post({ type: "agentDialogState", state });
  }

  setAgentDialogBusy(busy: boolean): void {
    this._post({ type: "agentDialogBusy", busy });
  }

  agentDialogNotice(level: "info" | "warning" | "error", text: string): void {
    this._post({ type: "agentDialogNotice", level, text });
  }

  applyTheme(theme: string): void {
    this._post({ type: "applyTheme", theme });
  }

  setAskUserDialogState(state: ChatAskUserDialogState | null): void {
    this.owner.pendingQuestion = state;
    this.lastAskUser = state;
    this.updateTitle();
    this._post({ type: "askUserDialogState", state });
  }

  setSessionsSidebarState(state: ChatSessionsSidebarState): void {
    this._post({ type: "sessionsSidebarState", state });
  }

  private async _openApprovalPreviewDiff(label: string, before: string, after: string): Promise<void> {
    const safeId = encodeURIComponent(`${this.owner.tabId}:approval:${Date.now()}:${label}`);
    const left = vscode.Uri.parse(`chrys-diff:/${safeId}/before/${encodeURIComponent(label)}`);
    const right = vscode.Uri.parse(`chrys-diff:/${safeId}/after/${encodeURIComponent(label)}`);
    rt.diffDocuments.set(left.path, before);
    rt.diffDocuments.set(right.path, after);
    await vscode.commands.executeCommand("vscode.diff", left, right, `iCode Approval Preview: ${label}`);
  }

  private async _openExternalResource(value: string): Promise<void> {
    const uri = vscode.Uri.parse(value, true);
    if (uri.scheme !== "https" && uri.scheme !== "http") {
      vscode.window.showWarningMessage(panelText(
        `iCode blocked an unsupported resource URI: ${uri.scheme || "unknown"}`,
        `iCode 已阻止不支持的资源 URI：${uri.scheme || "未知"}`,
      ));
      return;
    }
    await vscode.env.openExternal(uri);
  }

  setInlineDialogState(state: ChatInlineDialogState): void {
    this._post({ type: "inlineDialogState", state });
  }

  setInlineDialogBusy(busy: boolean): void {
    this._post({ type: "inlineDialogBusy", busy });
  }

  inlineDialogNotice(level: "info" | "warning" | "error", text: string): void {
    this._post({ type: "inlineDialogNotice", level, text });
  }

  showNotifications(): void {
    this.reveal();
    this._post({ type: "localCommand", command: "notifications" });
  }

  setApprovalDialogState(state: ChatApprovalDialogState | null): void {
    this.owner.pendingApproval = state;
    this.lastApproval = state;
    this.updateTitle();
    this._post({ type: "approvalDialogState", state });
  }

  private updateTitle(): void {
    if (this.disposed) return;
    const state = this.lastState;
    const label = state?.sessionTitle || state?.sessionId?.slice(0, 8) || panelText("New session", "新会话");
    const status = this.owner.pendingApproval ? panelText("Approval", "待审批")
      : this.owner.pendingQuestion ? panelText("Question", "待回答")
      : state?.connectionState === "error" || state?.connectionState === "disconnected" ? panelText("Disconnected", "未连接")
      : state?.sessionState === "running" ? panelText("Running", "运行中")
      : state?.sessionState === "cancelling" ? panelText("Stopping", "停止中")
      : this.owner.activeTurnErrorReceived ? panelText("Failed", "失败")
      : this.owner.transcript.size ? panelText("Done", "已完成") : "";
    this.panel.title = `${status ? `[${status}] ` : ""}${label} — iCode`;
  }

  requestAttention(): void {
    if (this.disposed || this.panel.active) return;
    const open = panelText("Open session", "打开会话");
    void vscode.window.showInformationMessage(
      panelText(`iCode needs your response: ${this.panel.title}`, `iCode 等待你的回应：${this.panel.title}`), open,
    )?.then(choice => { if (choice === open) this.reveal(); });
  }

  // ── Lifecycle ──────────────────────────────

  reveal(): void {
    if (this.disposed) return;
    focusRuntime(this.owner);
    this.panel.reveal();
  }

  dispose(): void {
    if (this.disposed) return;
    this.panel.dispose();
  }

  // ── Private ────────────────────────────────

  private _post(msg: HostMessage): void {
    if (this.disposed) return;
    this._flushPendingText();
    this.readyMessages.send(msg);
  }

  private _getHtml(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js")).with({ query: WEBVIEW_ASSET_VERSION });
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "theme.css")).with({ query: WEBVIEW_ASSET_VERSION });
    const diagramUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "diagrams.js")).with({ query: WEBVIEW_ASSET_VERSION });
    const nonce = randomBytes(16).toString("base64");
    const language = hostUiLanguage();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp};">
  <link rel="stylesheet" href="${styleUri}">
  <title>iCode Chat</title>
</head>
<body>
  <div id="app" data-ui-language="${language}" data-diagram-script="${diagramUri}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}


function formatWebviewError(error: { message: string; source?: string; lineno?: number; colno?: number; stack?: string }): string {
  const location = error.source ? ` (${error.source}:${error.lineno ?? 0}:${error.colno ?? 0})` : "";
  return `${error.message}${location}${error.stack ? `\n${error.stack}` : ""}`;
}
