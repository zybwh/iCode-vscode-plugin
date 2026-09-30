import { AsyncLocalStorage } from "node:async_hooks";
import type { ChatAgentLifecycleState } from "../chat/panel";
import type { ChatConnectionState } from "../chat/webview/connectionPresentation";
import type { ProcessManager } from "../process/manager";
import type { SessionManager } from "../session/manager";
import type { ChatPanel, ChatInlineDialogState } from "../chat/panel";
import type { ManagementPanel } from "../manage/panel";
import type { ApprovalHandler } from "../approval/modal";
import type { AskUserHandler } from "../askUser/modal";
import type { SessionTreeProvider } from "../views/sessionTree";
import type { RuntimeSnapshot, UsageUpdateNotification, SubAgentNotification, PromptCapabilities, PlanEntry, CompactionNotification, ToolCallContent } from "../acp/types";
import type { UiTheme } from "../common/uiTheme";
import type { CompanionViewState } from "../companion/types";
import * as vscode from "vscode";
import { ChatTranscript } from "../chat/transcript";

export interface ToolSnapshot {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolCallContent[];
  metadata?: Record<string, unknown>;
}

export interface FrontendDebugEvent {
  time: number;
  kind: string;
  detail: string;
}

export interface ApprovalJudgeReview {
  time: number;
  requestId: string;
  status: "judging" | "approved" | "flagged";
  toolName?: string;
  toolKind?: string;
  intentSummary?: string;
  reason?: string;
}

export interface ActiveApprovalRequest {
  requestId: string;
  title: string;
  kind: string;
}

export interface ActiveAskUserRequest {
  requestId: string;
  callerName: string;
  questions: string[];
}

let runtimeSequence = 0;

export class ExtensionRuntime {
  readonly tabId = `chat-${++runtimeSequence}`;
  restoreSession: { sessionId: string; cwd: string; additionalDirectories?: string[] } | null = null;
  tabInitialization: Promise<boolean> | null = null;
  composerDraft = "";
  pendingApproval: import("../chat/panel").ChatApprovalDialogState | null = null;
  pendingQuestion: import("../chat/panel").ChatAskUserDialogState | null = null;
  shuttingDown = false;

  // services
  processManager!: ProcessManager;
  sessionManager!: SessionManager;
  sessionInitialization: Promise<void> | null = null;
  chatPanel: ChatPanel | null = null;
  readonly transcript = new ChatTranscript(() => this.chatPanel);
  managementPanel: ManagementPanel | null = null;
  approvalHandler!: ApprovalHandler;
  askUserHandler!: AskUserHandler;
  sessionTreeProvider: SessionTreeProvider | null = null;
  extensionContext: vscode.ExtensionContext | null = null;
  outputChannel!: vscode.OutputChannel;
  workspaceTerminal: vscode.Terminal | null = null;
  workspaceTerminalCwd: string | null = null;

  // session identity
  currentSessionId: string | null = null;
  currentCwd: string | null = null;
  additionalDirectories: string[] | undefined = [];
  currentSessionTitle = "";
  currentBinaryPath: string | null = null;
  activeAgentName = "Code";
  currentRuntime: RuntimeSnapshot | null = null;
  currentPromptCapabilities: PromptCapabilities | null = null;
  supportsAdditionalDirectories = false;
  chrysCliVersion = "";
  currentApprovalMode = "auto";
  preferredAgentName = "Code";
  preferredModelProfileId = "";
  preferredApprovalMode = "auto";
  skipRestoreOnce = false;
  restartAttempts = 0;

  // dialog tracking
  activeInlineDialogKind: ChatInlineDialogState["kind"] | null = null;
  activeApprovalRequest: ActiveApprovalRequest | null = null;
  activeAskUserRequest: ActiveAskUserRequest | null = null;
  sessionsDialogRefreshPending = false;
  logsRefreshTimer: ReturnType<typeof setInterval> | null = null;

  closeInlineDialog(): void {
    this.activeInlineDialogKind = null;
    if (this.logsRefreshTimer) clearInterval(this.logsRefreshTimer);
    this.logsRefreshTimer = null;
  }

  // rendering state
  activeAgentMessageId: string | null = null;
  activeAgentText = "";
  activeThoughtMessageId: string | null = null;
  activeThoughtText = "";
  pendingUserEchoText: string | null = null;
  pendingUserEchoMessageId: string | null = null;
  pendingUserEchoConsumed = false;
  activeTurnErrorReceived = false;
  restoredInterruptedText: string | null = null;

  // usage
  currentUsageText = "";
  currentUsageUpdate: UsageUpdateNotification | null = null;
  currentContextUsedTokens: number | undefined;
  currentContextMaxTokens: number | undefined;
  currentContextPct: number | undefined;

  // companion
  currentCompanion: CompanionViewState | null = null;
  companionAwardedToolCalls = new Set<string>();

  // theme
  currentTheme: UiTheme = "chrys";

  // collections
  compressedMessages: string[] = [];
  currentPlanEntries: PlanEntry[] = [];
  toolMessageIds = new Map<string, string>();
  toolSnapshots = new Map<string, ToolSnapshot>();
  subAgentMessageIds = new Map<string, string>();
  subAgentInnerToolCalls = new Map<string, Array<{ toolName: string; status: "running" | "complete" | "error"; durationMs?: number; result?: string }>>();
  pausedSubAgents = new Map<string, SubAgentNotification>();
  activeCompactions = new Map<string, CompactionNotification>();
  committedCompactions = new Set<string>();
  diffDocuments = new Map<string, string>();
  logLines: string[] = [];
  debugEvents: FrontendDebugEvent[] = [];
  approvalJudgeReviews: ApprovalJudgeReview[] = [];

  resetRenderState(resetCounter = false): void {
    this.activeAgentMessageId = null;
    this.activeAgentText = "";
    this.activeThoughtMessageId = null;
    this.activeThoughtText = "";
    this.activePlanMessageId = null;
    this.agentLifecycle = null;
    this.activityMessageIds.clear();
    this.subAgentInvocationByParentCallId.clear();
    this.subAgentCommittedCompactions.clear();
    this.pendingUserEchoText = null;
    this.pendingUserEchoMessageId = null;
    this.pendingUserEchoConsumed = false;
    this.activeTurnErrorReceived = false;
    this.activeApprovalRequest = null;
    this.compressedMessages.length = 0;
    this.currentPlanEntries = [];
    this.toolMessageIds.clear();
    this.toolSnapshots.clear();
    this.companionAwardedToolCalls.clear();
    this.subAgentMessageIds.clear();
    this.subAgentInnerToolCalls.clear();
    this.pausedSubAgents.clear();
    this.activeCompactions.clear();
    this.committedCompactions.clear();
    this.diffDocuments.clear();
    this.approvalJudgeReviews.length = 0;
    if (resetCounter) {
      this.currentSessionTitle = "";
      this.currentSessionUpdatedAt = "";
      this.currentUsageText = "";
      this.currentUsageUpdate = null;
      this.currentContextUsedTokens = undefined;
      this.currentContextMaxTokens = undefined;
      this.currentContextPct = undefined;
      this.currentRuntime = null;
    }
  }

  persistCurrentSession(): void {
    if (this.extensionContext && this.currentSessionId && this.currentCwd && this.sessionManager?.sessionId === this.currentSessionId) {
      this.restoreSession = { sessionId: this.currentSessionId, cwd: this.currentCwd, additionalDirectories: this.additionalDirectories && [...this.additionalDirectories] };
      if (this !== activeRuntime) return;
      this.extensionContext.workspaceState.update("chrys.session", {
        sessionId: this.currentSessionId,
        cwd: this.currentCwd,
        additionalDirectories: this.additionalDirectories && [...this.additionalDirectories],
      });
    }
  }

  clearPersistedSession(): void {
    this.restoreSession = null;
    if (this === activeRuntime) this.extensionContext?.workspaceState.update("chrys.session", undefined);
  }

  dropSession(): Promise<void> {
    if (!this.sessionManager) return Promise.resolve();
    this.askUserHandler?.cancelActive("session-closed");
    return Promise.all([
      this.sessionManager.cancel().catch(() => {}),
      this.sessionManager.close().catch(() => {}),
    ]).then(() => {});
  }

  readonly onDidChangeSessionState = sessionEvents.event;

  notifySessionState(sessionState: 'idle' | 'running' | 'cancelling'): void {
    sessionEvents.fire({
      sessionState,
      sessionId: this.currentSessionId ?? '',
    });
  }

connectionInitialization: Promise<boolean> | null = null;
currentSessionUpdatedAt = "";
connectionState: ChatConnectionState = "resolving-workspace";
connectionDetail = "";
connectionStartedAt = Date.now();
connectionDurationMs: number | null = null;
sessionsSidebarRefreshPending = false;
activePlanMessageId: string | null = null;
agentLifecycle: ChatAgentLifecycleState | null = null;


subAgentInvocationByParentCallId = new Map<string, string>();
subAgentCommittedCompactions = new Map<string, Set<string>>();
activityMessageIds = new Map<string, string>();
}

const sessionEvents = new vscode.EventEmitter<{
  sessionState: "idle" | "running" | "cancelling";
  sessionId: string;
}>();
const runtimeScope = new AsyncLocalStorage<ExtensionRuntime>();
const initialRuntime = new ExtensionRuntime();
let activeRuntime = initialRuntime;
export const sessionRuntimes = new Set<ExtensionRuntime>([initialRuntime]);

export function currentRuntime(): ExtensionRuntime {
  return runtimeScope.getStore() ?? activeRuntime;
}

/** Bind the entire async operation, not merely its synchronous prefix. */
export function withRuntime<T>(owner: ExtensionRuntime, action: () => T): T {
  return runtimeScope.run(owner, action);
}

export function bindRuntime<A extends unknown[], R>(handler: (...args: A) => R, owner = currentRuntime()): (...args: A) => R {
  return (...args) => withRuntime(owner, () => handler(...args));
}

export function focusRuntime(owner: ExtensionRuntime): void {
  activeRuntime = owner;
  owner.persistCurrentSession();
  owner.sessionTreeProvider?.refresh();
}

export function findSessionRuntime(sessionId: string): ExtensionRuntime | undefined {
  return [...sessionRuntimes].find(owner => owner.currentSessionId === sessionId || owner.restoreSession?.sessionId === sessionId);
}

export function createSessionRuntime(cwd: string): ExtensionRuntime {
  const parent = currentRuntime();
  const owner = new ExtensionRuntime();
  owner.extensionContext = parent.extensionContext;
  owner.outputChannel = parent.outputChannel;
  owner.sessionTreeProvider = parent.sessionTreeProvider;
  owner.currentCwd = cwd;
  owner.additionalDirectories = cwd === parent.currentCwd ? parent.additionalDirectories && [...parent.additionalDirectories] : [];
  owner.currentTheme = parent.currentTheme;
  owner.currentBinaryPath = parent.currentBinaryPath;
  owner.preferredAgentName = parent.preferredAgentName;
  owner.preferredModelProfileId = parent.preferredModelProfileId;
  owner.preferredApprovalMode = parent.preferredApprovalMode;
  owner.activeAgentName = owner.preferredAgentName;
  owner.currentApprovalMode = owner.preferredApprovalMode;
  owner.skipRestoreOnce = true;
  sessionRuntimes.add(owner);
  return owner;
}

/** Compatibility facade for session services. Entry points MUST bind their owner:
 * webview events, ACP callbacks, process events and IDE commands. AsyncLocalStorage
 * keeps delayed responses attached to their initiating tab after focus changes.
 * A plain mutable global "current session" is never used for in-flight work.
 */
export const rt: ExtensionRuntime = new Proxy(initialRuntime, {
  get(_target, property) {
    const owner = currentRuntime();
    const value = Reflect.get(owner, property);
    return typeof value === "function" ? value.bind(owner) : value;
  },
  set(_target, property, value) { return Reflect.set(currentRuntime(), property, value); },
});
