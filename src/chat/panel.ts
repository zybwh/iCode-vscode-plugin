import type { CompanionViewState } from "../companion/types";
import * as vscode from "vscode";
import type { ChatMessage } from "./provider";
import type { ContentBlock, ModelSummary, PermissionOption, PlanEntry, ProfileSummary, RequestInputAnswer, RequestInputQuestion, SessionInfo } from "../acp/types";
import { rt, bindRuntime, currentRuntime, focusRuntime } from "../state/runtime";
import { resolveUiLanguage, type UiLanguage } from "../common/i18n";
import type { UiBrand } from "../common/uiBrand";
import type { UiTheme } from "../common/uiTheme";
import { logError, recordDebugEvent } from "../common/logging";
import { runtimeVisionEnabled } from "../common/runtimeUtils";
import { ReadyMessageQueue } from "./readyMessageQueue";
import type { ChatConnectionState } from "./webview/connectionPresentation";

export interface ChatModelDialogState {
  models: ModelSummary[];
  profiles: Record<string, Record<string, unknown>>;
  activeModelProfileId: string;
  selectedModelId?: string;
}

export interface ChatAgentDialogState {
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
  | { type: "updateMessage"; messageId: string; patch: Partial<ChatMessage> }
  | { type: "updateMessageTextOnly"; messageId: string; text: string }
  | { type: "removeMessage"; messageId: string }
  | { type: "clearMessages" }
  | { type: "setState"; state: ChatPanelState }
  | { type: "setComposer"; text: string }
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
  | { type: "sendMessage"; text: string; images?: Array<{ data: string; mimeType: string; uri?: string; _meta?: Record<string, unknown> }> }
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

export class ChatPanel {
  private panel: vscode.WebviewPanel;
  private disposed = false;
  private webviewReady = false;
  private lastState: ChatPanelState | undefined;
  private lastApproval: ChatApprovalDialogState | null = null;
  private lastAskUser: ChatAskUserDialogState | null = null;
  private companionAssetBaseUri: string;
  private readonly readyMessages: ReadyMessageQueue<HostMessage>;
  private _sendHandler: SendHandler | null = null;
  private _cancelHandler: CancelHandler | null = null;
  private _commandHandler: CommandHandler | null = null;
  private _toolDiffHandler: ToolDiffHandler | null = null;
  private _openFileHandler: OpenFileHandler | null = null;
  private _modelDialogRefreshHandler: ModelDialogRefreshHandler | null = null;
  private _modelDialogSaveHandler: ModelDialogSaveHandler | null = null;
  private _modelDialogDeleteHandler: ModelDialogDeleteHandler | null = null;
  private _modelDialogSetActiveHandler: ModelDialogSetActiveHandler | null = null;
  private _agentDialogRefreshHandler: AgentDialogRefreshHandler | null = null;
  private _agentDialogSaveHandler: AgentDialogSaveHandler | null = null;
  private _agentDialogDeleteHandler: AgentDialogDeleteHandler | null = null;
  private _agentDialogSetActiveHandler: AgentDialogSetActiveHandler | null = null;
  private _inlineDialogActionHandler: InlineDialogActionHandler | null = null;
  private _inlineDialogClosedHandler: InlineDialogClosedHandler | null = null;
  private _approvalDialogDecisionHandler: ApprovalDialogDecisionHandler | null = null;
  private _askUserDialogResponseHandler: AskUserDialogResponseHandler | null = null;
  private _approvalModeSelectHandler: ApprovalModeSelectHandler | null = null;
  private _sleepSkipHandler: SleepSkipHandler | null = null;
  private _sessionsSidebarRequestHandler: SessionsSidebarRequestHandler | null = null;

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
          this._sendHandler?.(msg.text, [
            { type: "text", text: msg.text },
            ...(msg.images ?? []).map((image) => ({ type: "image" as const, ...image })),
          ]);
          break;
        case "cancel":
          this._cancelHandler?.();
          break;
        case "command":
          this._commandHandler?.(msg.command, msg.arg);
          break;
        case "modelDialogRefresh":
          this._modelDialogRefreshHandler?.();
          break;
        case "modelDialogSave":
          this._modelDialogSaveHandler?.(msg.model);
          break;
        case "modelDialogDelete":
          this._modelDialogDeleteHandler?.(msg.id);
          break;
        case "modelDialogSetActive":
          this._modelDialogSetActiveHandler?.(msg.id);
          break;
        case "agentDialogRefresh":
          this._agentDialogRefreshHandler?.();
          break;
        case "agentDialogSave":
          this._agentDialogSaveHandler?.(msg.agent);
          break;
        case "agentDialogDelete":
          this._agentDialogDeleteHandler?.(msg.name);
          break;
        case "agentDialogSetActive":
          this._agentDialogSetActiveHandler?.(msg.name);
          break;
        case "inlineDialogAction":
          this._inlineDialogActionHandler?.(msg.action, { id: msg.id, cwd: msg.cwd, name: msg.name });
          break;
        case "inlineDialogClosed":
          rt.closeInlineDialog();
          this._inlineDialogClosedHandler?.();
          break;
        case "approvalDialogDecision":
          this._approvalDialogDecisionHandler?.(msg.optionId, msg.reason);
          break;
        case "askUserDialogResponse":
          this._askUserDialogResponseHandler?.(msg.requestId, msg.answers, msg.cancelled, msg.source);
          break;
        case "openApprovalPreviewDiff":
          this._openApprovalPreviewDiff(msg.label, msg.before, msg.after).catch(() => {});
          break;
        case "setApprovalMode":
          this._approvalModeSelectHandler?.(msg.mode);
          break;
        case "sessionsSidebarRefresh":
          this._sessionsSidebarRequestHandler?.("refresh");
          break;
        case "sessionsSidebarAction":
          this._sessionsSidebarRequestHandler?.(msg.action, { id: msg.id, cwd: msg.cwd });
          break;
        case "skipSleep":
          this._sleepSkipHandler?.(msg.toolCallId);
          break;
        case "openToolDiff":
          this._toolDiffHandler?.(msg.toolCallId);
          break;
        case "openFile":
          this._openFileHandler?.(msg.path, msg.line);
          break;
        case "openExternalResource":
          this._openExternalResource(msg.uri).catch(() => {});
          break;
        case "webviewReady":
          if (this.webviewReady) {
            this.clearMessages();
            for (const message of rt.transcript.messages) this.appendMessage(message);
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
    for (const message of rt.transcript.messages) this.appendMessage(message);

    if (this.owner.composerDraft) this.setComposer(this.owner.composerDraft);
    if (this.owner.pendingApproval) this.setApprovalDialogState(this.owner.pendingApproval);
    if (this.owner.pendingQuestion) this.setAskUserDialogState(this.owner.pendingQuestion);
    this.panel.onDidDispose(bindRuntime(() => {
      // Detach before cancelling dialogs: their cleanup can post to this panel.
      this.disposed = true;
      if (rt.chatPanel === this) {
        rt.chatPanel = null;
        rt.closeInlineDialog();
        // A view closing is not an approval decision or a task cancellation.
      }
      this._sendHandler = null;
      this._cancelHandler = null;
      this._commandHandler = null;
      this._toolDiffHandler = null;
      this._openFileHandler = null;
      this._modelDialogRefreshHandler = null;
      this._modelDialogSaveHandler = null;
      this._modelDialogDeleteHandler = null;
      this._modelDialogSetActiveHandler = null;
      this._agentDialogRefreshHandler = null;
      this._agentDialogSaveHandler = null;
      this._agentDialogDeleteHandler = null;
      this._agentDialogSetActiveHandler = null;
      this._inlineDialogActionHandler = null;
      this._inlineDialogClosedHandler = null;
      this._approvalDialogDecisionHandler = null;
      this._askUserDialogResponseHandler = null;
      this._approvalModeSelectHandler = null;
      this._sleepSkipHandler = null;
      this._sessionsSidebarRequestHandler = null;
    }, this.owner));
  }

  // ── Events from host to register ───────────

  onSendMessage(handler: SendHandler): void {
    this._sendHandler = handler;
  }

  onCancel(handler: CancelHandler): void {
    this._cancelHandler = handler;
  }

  onCommand(handler: CommandHandler): void {
    this._commandHandler = handler;
  }

  onToolDiff(handler: ToolDiffHandler): void {
    this._toolDiffHandler = handler;
  }

  onOpenFile(handler: OpenFileHandler): void {
    this._openFileHandler = handler;
  }

  onModelDialogRefresh(handler: ModelDialogRefreshHandler): void {
    this._modelDialogRefreshHandler = handler;
  }

  onModelDialogSave(handler: ModelDialogSaveHandler): void {
    this._modelDialogSaveHandler = handler;
  }

  onModelDialogDelete(handler: ModelDialogDeleteHandler): void {
    this._modelDialogDeleteHandler = handler;
  }

  onModelDialogSetActive(handler: ModelDialogSetActiveHandler): void {
    this._modelDialogSetActiveHandler = handler;
  }

  onAgentDialogRefresh(handler: AgentDialogRefreshHandler): void {
    this._agentDialogRefreshHandler = handler;
  }

  onAgentDialogSave(handler: AgentDialogSaveHandler): void {
    this._agentDialogSaveHandler = handler;
  }

  onAgentDialogDelete(handler: AgentDialogDeleteHandler): void {
    this._agentDialogDeleteHandler = handler;
  }

  onAgentDialogSetActive(handler: AgentDialogSetActiveHandler): void {
    this._agentDialogSetActiveHandler = handler;
  }

  onInlineDialogAction(handler: InlineDialogActionHandler): void {
    this._inlineDialogActionHandler = handler;
  }

  onInlineDialogClosed(handler: InlineDialogClosedHandler): void {
    this._inlineDialogClosedHandler = handler;
  }

  onApprovalDialogDecision(handler: ApprovalDialogDecisionHandler): void {
    this._approvalDialogDecisionHandler = handler;
  }

  onAskUserDialogResponse(handler: AskUserDialogResponseHandler): void {
    this._askUserDialogResponseHandler = handler;
  }

  onApprovalModeSelect(handler: ApprovalModeSelectHandler): void {
    this._approvalModeSelectHandler = handler;
  }

  onSleepSkip(handler: SleepSkipHandler): void {
    this._sleepSkipHandler = handler;
  }

  onSessionsSidebarRequest(handler: SessionsSidebarRequestHandler): void {
    this._sessionsSidebarRequestHandler = handler;
  }

  // ── Push messages to webview ───────────────

  appendMessage(message: ChatMessage): void {
    this._post({ type: "appendMessage", message });
  }

  updateMessage(messageId: string, patch: Partial<ChatMessage>): void {
    this._post({ type: "updateMessage", messageId, patch });
  }

  updateMessageTextOnly(messageId: string, text: string): void {
    this._post({ type: "updateMessageTextOnly", messageId, text });
  }

  removeMessage(messageId: string): void {
    this._post({ type: "removeMessage", messageId });
  }

  clearMessages(): void {
    this._post({ type: "clearMessages" });
  }

  setState(state: ChatPanelState): void {
    this.lastState = state;
    this.updateTitle();
    const companion = state.companion ? { ...state.companion, assetBaseUri: state.companion.assetBaseUri || this.companionAssetBaseUri } : state.companion;
    this._post({ type: "setState", state: { ...state, companion } });
  }

  setComposer(text: string): void {
    if (this.disposed) return;
    this.owner.composerDraft = text;
    this._post({ type: "setComposer", text });
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
      : this.owner.transcript.messages.length ? panelText("Done", "已完成") : "";
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
    this.readyMessages.send(msg);
  }

  private _getHtml(context: vscode.ExtensionContext): string {
    const webviewUri = vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js");
    const styleUri = vscode.Uri.joinPath(context.extensionUri, "dist", "theme.css");
    const cacheBust = Date.now().toString();
    const language = resolveUiLanguage(vscode.workspace.getConfiguration("chrys").get<string>("ui.language"), vscode.env.language);

    return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; script-src ${this.panel.webview.cspSource}; img-src ${this.panel.webview.cspSource} data:;">
  <link rel="stylesheet" href="${this.panel.webview.asWebviewUri(styleUri).with({ query: cacheBust })}">
  <title>iCode Chat</title>
</head>
<body>
  <div id="app" data-ui-language="${language}"></div>
  <script src="${this.panel.webview.asWebviewUri(webviewUri)}"></script>
</body>
</html>`;
  }
}

function panelText(en: string, zh: string): string {
  const language = resolveUiLanguage(vscode.workspace.getConfiguration("chrys").get<string>("ui.language"), vscode.env.language);
  return language === "zh-CN" ? zh : en;
}

function formatWebviewError(error: { message: string; source?: string; lineno?: number; colno?: number; stack?: string }): string {
  const location = error.source ? ` (${error.source}:${error.lineno ?? 0}:${error.colno ?? 0})` : "";
  return `${error.message}${location}${error.stack ? `\n${error.stack}` : ""}`;
}
