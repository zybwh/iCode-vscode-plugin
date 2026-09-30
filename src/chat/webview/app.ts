import type { TextAttachment } from "../../context/attachments";
// iCode Chat Webview — frontend script
// Bundled with esbuild (IIFE, browser target). Communicates with VS Code host via postMessage.

import { formatCount, COMPANION_ENABLED } from "../../common/utils";
import { convertPastedImagePathsToMentions, sanitizePromptPaste } from "../../common/promptPaste";
import { toolRendererCoverage } from "../../common/toolRendering";
import { SUPPORTED_UI_THEME_IDS } from "../../common/uiTheme";
import type { ChatMessage } from "../provider";
import type { ChatCommand, ChatPanelState, ChatSessionsSidebarState, HostMessage } from "../panel";
import { el, formatDurationMs, formatClock, tokenValueOrDash, formatJson, shortSessionId, imageDataUri } from "./helpers";
import { isInsideUntrustedMarkup, renderMarkdown } from "./renderer";
import { mentionsMermaid } from "./diagrams";
import { onDiagramEngineReady } from "./diagramLoader";
import { shellCommandFromPrompt } from "./shellPrompt";
import { processThinkTags } from "./thinkTags";
import {
  state,
  recordPromptHistory, shouldNavigatePromptHistory, navigatePromptHistory,
} from "./state";
import type { DebugEvent } from "./state";
import { isToolMessage, renderMessage, finishActiveToolGroup, updateToolGroup, appendToolMessage, shouldFollowMessages, forceFollowMessages as forceFollowMsgs, consumeForceFollowNextMessage, isMessageAreaAtBottom, scheduleMessageAnchorSync } from "./components/messages";
import { renderCompanionSidebar } from "./components/companionPanel";
import {
  updateStatusBar,
} from "./components/statusBar";
import { brandDisplay } from "./branding";
import { UI_BRANDS, resolveUiBrand } from "../../common/uiBrand";
import { connectionPresentation, type ChatConnectionState } from "./connectionPresentation";
import {
  normalizeSidebarPreference,
  sidebarOpenForViewport,
  SIDEBAR_DRAWER_BREAKPOINT,
  type SidebarPreference,
} from "./sidebarLayout";
import { closeModelDialog, setModelDialogBusy, showModelDialogNotice, setModelDialogState, closeAgentDialog, setAgentDialogBusy, showAgentDialogNotice, setAgentDialogState, closeInlineDialog as closeInlineDialogFn, setInlineDialogBusy, showInlineDialogNotice, setInlineDialogState, setApprovalDialogState, setAskUserDialogState } from "./components/dialogs";
import { SLASH_ZH, countLabel, t } from "./uiText";
import { BUSY_DISABLED_HOST_COMMANDS, HOST_COMMANDS, SLASH_DEFINITIONS, SlashArgSuggestion, SlashCommand, SlashDefinition, SlashSuggestion, TUI_SHORTCUT_HELP } from "./slashCommands";
import { applyTheme } from "./themes";

declare function acquireVsCodeApi(): VsCodeApi;

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

const vscode = acquireVsCodeApi();

window.addEventListener("error", (event) => {
  reportWebviewError({
    message: event.message || "Unknown webview error",
    source: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  reportWebviewError(errorPayloadFromReason(event.reason));
});

function reportWebviewError(error: { message: string; source?: string; lineno?: number; colno?: number; stack?: string }): void {
  try {
    vscode.postMessage({ type: "webviewError", ...error });
  } catch {
    // Last-resort guard: diagnostics should never create a second failure path.
  }
}

function errorPayloadFromReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message || reason.name, stack: reason.stack };
  }
  if (typeof reason === "string") return { message: reason };
  return { message: safeJson(reason) || String(reason) };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

// ──────────────────────────────────────────────
// Local constants (not moved to modules)
// ──────────────────────────────────────────────

let welcomeTimer: number | undefined;

type PendingImage = {
  data: string;
  mimeType: string;
  name: string;
  originalBytes: number;
  bytes: number;
  compressed: boolean;
};

type ImagePreparationPhase = "reading" | "compressing";

type ImagePreparationItem = {
  id: number;
  name: string;
  originalBytes: number;
  phase: ImagePreparationPhase;
  index: number;
  total: number;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
let pendingImages: PendingImage[] = [];
let pendingAttachments: TextAttachment[] = [];
let preparingImageCount = 0;
let imagePreparationItems: ImagePreparationItem[] = [];
let nextImagePreparationId = 1;
let imagePreparationGeneration = 0;
let lastImageInputStateEvent = "";

// Initialize prompt history from webview state
// ──────────────────────────────────────────────

type PersistedWebviewState = {
  promptHistory?: string[];
  attachments?: TextAttachment[];
  debugEvents?: DebugEvent[];
  sidebarPreference?: SidebarPreference;
  activeSideTab?: string;
};

const persistedWebviewState = (vscode.getState() ?? {}) as PersistedWebviewState;
pendingAttachments = (persistedWebviewState.attachments ?? []).slice(0,20);
let sidebarPreference = normalizeSidebarPreference(persistedWebviewState.sidebarPreference);
let sessionsSidebarState: ChatSessionsSidebarState = { status: "idle", sessions: [] };
let lastSessionsRequestAt = 0;
let lastObservedSessionId = "";
let agentReadyHideTimer: number | undefined;
let visibleAgentLifecycleUpdate = 0;
const loadedHistory: string[] = Array.isArray(persistedWebviewState.promptHistory)
  ? persistedWebviewState.promptHistory.filter((entry): entry is string => typeof entry === "string").slice(-100)
  : [];
for (const entry of loadedHistory) {
  state.promptHistory.push(entry);
}
state.promptHistoryIndex = state.promptHistory.length;
if (Array.isArray(persistedWebviewState.debugEvents)) {
  state.debugEvents.push(...persistedWebviewState.debugEvents
    .filter((entry): entry is DebugEvent => entry
      && typeof entry.time === "number"
      && typeof entry.kind === "string"
      && typeof entry.detail === "string")
    .slice(-200));
}

// ──────────────────────────────────────────────
// DOM Elements
// ──────────────────────────────────────────────

const app = document.getElementById("app")!;
const initialUiLanguage = app.dataset.uiLanguage === "zh-CN" ? "zh-CN" : "en";
state.uiLanguage = initialUiLanguage;
document.documentElement.lang = initialUiLanguage;

const sidebarToggleButton = el("button", {
  class: "sidebar-toggle",
  "data-local-command": "toggleSidebar",
  "aria-controls": "chrys-auxiliary-panel",
},
  el("span", { class: "sidebar-toggle-glyph", "aria-hidden": "true" }, "▥"),
  el("span", { class: "sidebar-toggle-label" }, t("sidebar")),
);

const topBar = el("div", { class: "tui-header" },
  el("div", { class: "tui-header-tools" }, sidebarToggleButton),
  el("span", { class: "tui-title" }, "iCode"),
  el("div", { class: "approval-control" },
    el("button", { class: "approval-badge" }, "APPROVAL MODE: AUTO"),
    el("div", { class: "approval-menu hidden" },
      el("button", { class: "approval-menu-item", "data-approval-mode": "manual" }, "manual"),
      el("button", { class: "approval-menu-item", "data-approval-mode": "auto" }, "auto"),
      el("button", { class: "approval-menu-item", "data-approval-mode": "bypass" }, "bypass"),
    ),
  ),
);

function createWelcomeElement(): HTMLElement {
  const brand = UI_BRANDS[resolveUiBrand(state.latestState?.uiBrand)];
  const brandLabel = state.uiLanguage === "zh-CN" ? "选择品牌标识" : "Choose brand mark";
  const brandButton = el("button", { type: "button", class: "welcome-brand", title: brandLabel, "aria-label": `${brand.name} · ${brandLabel}`, "aria-haspopup": "dialog" },
    el("span", { class: "welcome-mark", "aria-hidden": "true" }, brand.mark),
    el("span", { class: "welcome-brand-copy" },
      el("span", { class: "welcome-logo", "aria-hidden": "true" }, brand.name),
      el("span", { class: "welcome-eyebrow" }, t("welcomeEyebrow")),
    ),
  );
  brandButton.addEventListener("click", () => vscode.postMessage({ type: "command", command: "pickBrand" }));
  return el("div", { class: "welcome" },
    el("div", { class: "welcome-panel" },
      brandButton,
      el("div", { class: "welcome-title" }, t("welcomeTitle")),
      el("div", { class: "welcome-subtitle" }, t("welcomeSubtitle")),
      el("div", { class: "welcome-copy" },
        el("div", { class: "welcome-context-row welcome-profile" },
          el("span", { class: "welcome-context-label welcome-profile-label" }, t("profile")),
          el("span", { class: "welcome-context-value agent-name" }, "Code Agent"),
        ),
        el("div", { class: "welcome-context-row" },
          el("span", { class: "welcome-context-label welcome-workspace-label" }, t("workingDirectory")),
          el("span", { class: "welcome-context-value workspace-path" }, ""),
        ),
      ),
    ),
  );
}

const messageArea = el("div", { class: "message-area" },
  createWelcomeElement(),
);

const sessionRunIndicator = el("div", {
  class: "session-run-indicator startup",
  role: "status",
  "aria-live": "polite",
},
  el("span", { class: "session-run-spinner", "aria-hidden": "true" }, ""),
  el("span", { class: "session-run-label" }, state.uiLanguage === "zh-CN" ? "正在启动 iCode" : "Starting iCode"),
  el("span", { class: "session-run-progress" }, ""),
  el("span", { class: "session-run-elapsed" }, ""),
);

const sessionFrame = el("section", { class: "session-frame" },
  el("button", { class: "session-label hidden", title: t("copySessionId") }, `${t("session")}:`),
  sessionRunIndicator,
  messageArea,
  el("button", { class: "session-cwd", "data-command": "changeWorkspace", title: t("changeWorkspace") },
    el("span", { class: "session-cwd-prefix" }, "CWD"),
    el("span", { class: "session-cwd-value" }, ""),
  ),
);

const sidebarTabs = el("div", { class: "sidebar-tabs", role: "tablist" },
  el("button", { class: "sidebar-tab active", "data-side-tab": "messages", role: "tab", "aria-selected": "true" }, t("messages")),
  el("button", { class: "sidebar-tab", "data-side-tab": "sessions", role: "tab", "aria-selected": "false" }, t("sessions")),
  el("button", { class: "sidebar-tab", "data-side-tab": "context", role: "tab", "aria-selected": "false" }, t("context")),
  el("button", { class: "sidebar-tab", "data-side-tab": "debug", role: "tab", "aria-selected": "false" }, t("debug")),
  ...(COMPANION_ENABLED ? [el("button", { class: "sidebar-tab", "data-side-tab": "companion", role: "tab", "aria-selected": "false" }, t("companion"))] : []),
);

const sidebarContent = el("div", { class: "sidebar-content" },
  el("div", { class: "sidebar-empty" }, t("emptyConversation")),
);

const sidebarCloseButton = el("button", {
  class: "sidebar-close",
  "data-local-command": "toggleSidebar",
  title: t("closeSidebar"),
  "aria-label": t("closeSidebar"),
}, "×");
const sidebarHeader = el("div", { class: "sidebar-header" }, sidebarTabs, sidebarCloseButton);
const initialSidebarOpen = sidebarOpenForViewport(window.innerWidth, sidebarPreference);
const sidebar = el("aside", {
  class: `sidebar-panel${initialSidebarOpen ? "" : " hidden"}`,
  id: "chrys-auxiliary-panel",
  "aria-label": t("sidebar"),
}, sidebarHeader, sidebarContent);
const sidebarScrim = el("button", {
  class: `sidebar-scrim${initialSidebarOpen ? "" : " hidden"}`,
  title: t("closeSidebar"),
  "aria-label": t("closeSidebar"),
}, "");
const workbench = el("div", { class: "tui-workbench" }, sessionFrame, sidebarScrim, sidebar);

const slashHelp = el("div", { class: "slash-help hidden" });

const inputBar = el("div", { class: "input-bar" },
  slashHelp,
  el("button", { class: "prompt-chip active", "data-command": "switchAgent", title: t("agentsHint"), disabled: "true" }, "Code Agent"),
  el("span", { class: "input-prompt", "aria-hidden": "true" }, ">"),
  el("div", { class: "composer-wrap" },
    el("div", { class: "attachment-tray hidden" }),
    el("textarea", { class: "input-field", placeholder: t("startingPlaceholder"), "aria-label": t("typeMessage"), rows: "1", disabled: "true" }),
    el("div", { class: "input-hints" },
      el("button", { class: "input-hint", "data-command": "switchAgent" }, t("agentsHint")),
      el("button", { class: "input-hint", "data-command": "setModelProfile" }, t("modelsHint")),
      el("button", { class: "input-hint", "data-command": "openShell" }, t("shellHint")),
      el("button", { class: "input-hint", "data-local-command": "startSlashCommand" }, t("commandsHint")),
      el("button", { class: "input-hint", "data-command": "insertFileMention" }, t("filesHint")),
    ),
  ),
  el("button", { class: "send-btn", disabled: "true" }, t("send")),
  el("button", { class: "new-btn", "data-command": "clearChat", disabled: "true" }, t("new")),
);

const thinkingIndicator = el("div", { class: "thinking-indicator hidden" },
  el("span", { class: "thinking-dot" }, ""),
  el("span", { class: "thinking-label" }, t("thinking")),
  el("span", { class: "thinking-elapsed" }, ""),
);

const sessionMeta = el("div", { class: "session-meta" },
  thinkingIndicator,
  el("span", { class: "session-meta-spacer" }, ""),
  el("button", { class: "meta-link profile-meta", "data-command": "setModelProfile" }, t("profile")),
  el("span", { class: "meta-separator" }, "•"),
  el("button", { class: "meta-link tools-meta", "data-command": "runtimeTools" }, countLabel(0, "toolsMeta", "tool")),
  el("span", { class: "meta-separator" }, "•"),
  el("button", { class: "meta-link files-meta", "data-command": "runtimeFiles" }, countLabel(0, "filesMeta", "file")),
);

const statusBar = el("div", { class: "footer-bar" },
  el("span", { class: "footer-spacer" }, ""),
  el("span", { class: "status-run hidden" },
    el("span", { class: "status-state" }, ""),
    el("span", { class: "status-trail" }, ""),
  ),
  el("span", { class: "status-tokens hidden" }, ""),
);

const reconnectNotice = el("div", { class: "reconnect-notice hidden" }, t("reconnecting"));

const modelDialog = el("div", { class: "modal-backdrop hidden", "data-modal": "models" },
  el("section", { class: "tui-modal model-dialog", role: "dialog", "aria-modal": "true", "aria-label": t("models") },
    el("header", { class: "tui-modal-header" },
      el("div", {},
        el("div", { class: "tui-modal-title" }, t("models")),
        el("div", { class: "tui-modal-subtitle" }, t("modelDialogSubtitle")),
      ),
      el("div", { class: "tui-modal-actions" },
        el("button", { class: "modal-button secondary", "data-model-refresh": "true" }, t("refresh")),
        el("button", { class: "modal-button secondary", "data-model-close": "true" }, t("close")),
      ),
    ),
    el("div", { class: "modal-notice hidden" }, ""),
    el("div", { class: "model-dialog-body" },
      el("aside", { class: "model-list" }),
      el("main", { class: "model-detail" }),
    ),
  ),
);

const agentDialog = el("div", { class: "modal-backdrop hidden", "data-modal": "agents" },
  el("section", { class: "tui-modal model-dialog", role: "dialog", "aria-modal": "true", "aria-label": t("agents") },
    el("header", { class: "tui-modal-header" },
      el("div", {},
        el("div", { class: "tui-modal-title" }, t("agents")),
        el("div", { class: "tui-modal-subtitle" }, t("agentDialogSubtitle")),
      ),
      el("div", { class: "tui-modal-actions" },
        el("button", { class: "modal-button secondary", "data-agent-refresh": "true" }, t("refresh")),
        el("button", { class: "modal-button secondary", "data-agent-close": "true" }, t("close")),
      ),
    ),
    el("div", { class: "modal-notice hidden" }, ""),
    el("div", { class: "model-dialog-body" },
      el("aside", { class: "model-list" }),
      el("main", { class: "model-detail" }),
    ),
  ),
);

const inlineDialog = el("div", { class: "modal-backdrop hidden", "data-modal": "inline" },
  el("section", { class: "tui-modal inline-dialog", role: "dialog", "aria-modal": "true", "aria-label": t("runningCommand") },
    el("header", { class: "tui-modal-header" },
      el("div", {},
        el("div", { class: "tui-modal-title" }, ""),
        el("div", { class: "tui-modal-subtitle" }, ""),
      ),
      el("div", { class: "tui-modal-actions" },
        el("button", { class: "modal-button secondary", "data-inline-close": "true" }, "Close"),
      ),
    ),
    el("div", { class: "inline-notice hidden" }, ""),
    el("div", { class: "inline-dialog-body" }),
    el("div", { class: "inline-dialog-footer hidden" }),
  ),
);

const approvalDialog = el("div", { class: "modal-backdrop hidden", "data-modal": "approval" },
  el("section", { class: "tui-modal approval-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Approval Required" },
    el("header", { class: "tui-modal-header" },
      el("div", {},
        el("div", { class: "tui-modal-title" }, "Approval Required"),
        el("div", { class: "tui-modal-subtitle" }, ""),
      ),
    ),
    el("div", { class: "approval-dialog-body" }),
    el("div", { class: "approval-dialog-actions" }),
  ),
);

const askUserDialog = el("div", { class: "modal-backdrop hidden", "data-modal": "ask-user" },
  el("section", { class: "tui-modal askuser-dialog", role: "dialog", "aria-modal": "true", "aria-label": t("agentQuestion") },
    el("header", { class: "tui-modal-header" },
      el("div", {},
        el("div", { class: "tui-modal-title" }, t("agentQuestion")),
        el("div", { class: "tui-modal-subtitle" }, ""),
      ),
    ),
    el("div", { class: "askuser-dialog-body" },
      el("div", { class: "askuser-tabs", role: "tablist" }),
      el("div", { class: "askuser-question" }, ""),
      el("div", { class: "askuser-options" }),
    ),
    el("div", { class: "askuser-dialog-footer" },
      el("textarea", { class: "askuser-response", rows: "4" }),
      el("div", { class: "askuser-dialog-actions" },
        el("span", { class: "askuser-hint" }, "Ctrl/⌘+Enter"),
        el("button", { class: "modal-button secondary askuser-cancel" }, t("cancel")),
        el("button", { class: "modal-button secondary askuser-previous" }, "Previous"),
        el("button", { class: "modal-button secondary askuser-next" }, "Next"),
        el("button", { class: "modal-button askuser-submit" }, t("submit")),
      ),
    ),
  ),
);

app.append(topBar, workbench, reconnectNotice, sessionMeta, inputBar, statusBar, modelDialog, agentDialog, inlineDialog, approvalDialog, askUserDialog);
startWelcomeAnimation();

const inputField = inputBar.querySelector(".input-field") as HTMLTextAreaElement;
const attachmentTray = inputBar.querySelector(".attachment-tray") as HTMLElement;
const sendBtn = inputBar.querySelector(".send-btn") as HTMLButtonElement;
const newBtn = inputBar.querySelector(".new-btn") as HTMLButtonElement;
refreshChromeText();
restoreActiveSideTab();
syncSidebarPresentation();

// ──────────────────────────────────────────────
// Send / Cancel
// ──────────────────────────────────────────────

function sendMessage(): void {
  if (inputField.disabled || state.queuedInjectionPending || (state.localSubmitPending && state.currentSessionState === "idle")) return;
  const text = inputField.value.trim();
  if (preparingImageCount > 0) {
    showLocalNotice(t("preparingImages"));
    return;
  }
  if (!text && !pendingImages.length && !pendingAttachments.length) return;
  slashHelp.classList.add("hidden");
  if (text) {
    const command = slashCommand(text);
    if (command?.kind === "host") {
      if (isSlashDisabledWhileRunning(text)) {
        showSlashDisabledWhileRunning(text);
        updateSlashHelp();
        return;
      }
      clearComposer();
      showLocalNotice(commandNotice(command.command, command.arg));
      vscode.postMessage({ type: "command", command: command.command, arg: command.arg });
      if (command.command === "companionCommand") renderSideTab("companion");
      return;
    }
    if (command?.kind === "local") {
      if (isSlashDisabledWhileRunning(text)) {
        showSlashDisabledWhileRunning(text);
        updateSlashHelp();
        return;
      }
      clearComposer();
      runLocalCommand(command.command, command.arg);
      return;
    }
    if (isSlashCommandText(text) && !isRuntimeSkillPrompt(text)) {
      showLocalNotice(`${t("unknownCommand")} ${text.split(/\s+/, 1)[0]}. ${t("typeHelp")}`);
      updateSlashHelp();
      return;
    }
    const agentSwitch = agentSwitchFromPrompt(text);
    if (agentSwitch !== null) {
      if (isAgentBusy()) {
        showAgentSwitchDisabledWhileRunning();
        return;
      }
      clearComposer();
      vscode.postMessage({ type: "command", command: "switchAgent", arg: agentSwitch });
      return;
    }
    const shellCommand = shellCommandFromPrompt(text);
    if (shellCommand !== null) {
      if (isAgentBusy()) {
        showShellDisabledWhileRunning();
        return;
      }
      clearComposer();
      showLocalNotice(t("openingShell"));
      addDebugEvent("ShellPromptSubmitted", shellCommand ? `command (${shellCommand.length} chars)` : "open terminal");
      vscode.postMessage({ type: "command", command: "openShell", arg: shellCommand });
      return;
    }
  }
  if (pendingImages.length && state.currentSessionState !== "idle") {
    showLocalNotice(t("imageWhileRunning"));
    return;
  }
  if (pendingImages.length && state.latestState?.imageInputEnabled !== true) {
    addDebugEvent("ImageBlocked", "active model profile does not support image input");
    showImageUnsupportedDialog();
    return;
  }
  if (pendingAttachments.length && state.currentSessionState !== "idle") {
    showLocalNotice(state.uiLanguage === "zh-CN" ? "附件请在当前任务结束后发送。" : "Wait for the task to finish before sending attachments.");return;
  }
  const attachments = pendingAttachments;
  pendingAttachments = [];
  const imagesToSend = pendingImages;
  pendingImages = [];
  if (state.currentSessionState === "idle") {
    recordAndPersistPromptHistory(text);
    state.localSubmitPending = true;
    sendBtn.disabled = true;
    forceFollowMsgs();
    clearComposer();
  } else {
    recordAndPersistPromptHistory(text);
    lockComposerForQueuedInjection();
  }
  const images = imagesToSend.map((image) => ({
    data: image.data,
    mimeType: image.mimeType,
    _meta: {
      name: image.name,
      source: "vscode-webview",
      originalBytes: image.originalBytes,
      bytes: image.bytes,
      compressed: image.compressed,
    },
  }));
  vscode.postMessage({ type: "sendMessage", text, images, attachments });
}

function handleSendButtonClick(): void {
  if (isAgentBusy() && !inputField.value.trim() && !pendingImages.length) {
    vscode.postMessage({ type: "cancel" });
    return;
  }
  sendMessage();
}

function handleSingleCharacterTrigger(): void {
  if (state.inputTriggerPending || state.isComposingText) return;
  const rawValue = inputField.value;
  const value = rawValue.trim();
  if (value === "$" || value === "＄") {
    if (isAgentBusy()) return;
    state.inputTriggerPending = true;
    clearComposer();
    vscode.postMessage({ type: "command", command: "setModelProfile" });
    window.setTimeout(() => { state.inputTriggerPending = false; }, 500);
    return;
  }
  if (value === "!" || value === "！") {
    if (isAgentBusy()) {
      showShellDisabledWhileRunning();
      return;
    }
    state.inputTriggerPending = true;
    clearComposer();
    showLocalNotice(t("openingShell"));
    vscode.postMessage({ type: "command", command: "openShell" });
    window.setTimeout(() => {
      state.inputTriggerPending = false;
    }, 500);
    return;
  }
  if (isFileMentionTriggerText(rawValue)) {
    state.inputTriggerPending = true;
    const base = rawValue.slice(0, -1).trimEnd();
    inputField.value = base;
    autoResizeInput();
    updateComposerState();
    vscode.postMessage({ type: "command", command: "insertFileMention", arg: base });
    window.setTimeout(() => {
      state.inputTriggerPending = false;
    }, 500);
    return;
  }
  if (value !== "#" && value !== "＃") return;
  if (isAgentBusy()) {
    showAgentSwitchDisabledWhileRunning();
    return;
  }
  state.inputTriggerPending = true;
  clearComposer();
  vscode.postMessage({ type: "command", command: "switchAgent" });
  window.setTimeout(() => {
    state.inputTriggerPending = false;
  }, 500);
}

function isFileMentionTriggerText(text: string): boolean {
  if (!text.endsWith("@") && !text.endsWith("＠")) return false;
  const previous = text[text.length - 2] ?? "";
  return !previous || /\s/.test(previous) || isCjkBoundaryChar(previous);
}

function isCjkBoundaryChar(char: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(char);
}

function agentSwitchFromPrompt(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "#" || trimmed === "＃") return null;
  const match = /^[#＃]\s*(.+)$/s.exec(trimmed);
  return match ? match[1].trim() : null;
}

function persistPromptHistory(): void {
  const current = (vscode.getState() ?? {}) as Record<string, unknown>;
  vscode.setState({ ...current, promptHistory: state.promptHistory });
}

function recordAndPersistPromptHistory(text: string): void {
  recordPromptHistory(text);
  persistPromptHistory();
}

// ──────────────────────────────────────────────
// Input event listeners
// ──────────────────────────────────────────────

inputField.addEventListener("keydown", (e) => {
  if ((e.key === "Escape" || e.key === "Esc") && dismissSlashHelp()) {
    e.preventDefault(); e.stopPropagation(); return;
  }
  if (state.isComposingText || e.isComposing || e.keyCode === 229) {
    return;
  }
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "r") {
    e.preventDefault();
    if (!inputField.disabled && !state.queuedInjectionPending) postCommand("showPromptHistory");
    return;
  }
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "b" && (state.currentSessionState === "running" || state.currentSessionState === "cancelling")) {
    e.preventDefault();
    vscode.postMessage({ type: "cancel" });
    return;
  }
  if ((e.key === "Escape" || e.key === "Esc") && (state.currentSessionState === "running" || state.currentSessionState === "cancelling")) {
    e.preventDefault();
    vscode.postMessage({ type: "cancel" });
    return;
  }
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "j") {
    e.preventDefault();
    replaceComposerSelection("\n");
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
    return;
  }
  if (e.key === "ArrowUp" && shouldNavigatePromptHistory(-1, inputField)) {
    e.preventDefault();
    navigatePromptHistory(-1, inputField);
    autoResizeInput();
    updateComposerState();
    const cursor = inputField.value.length;
    inputField.setSelectionRange(cursor, cursor);
    return;
  }
  if (e.key === "ArrowDown" && shouldNavigatePromptHistory(1, inputField)) {
    e.preventDefault();
    navigatePromptHistory(1, inputField);
    autoResizeInput();
    updateComposerState();
    const cursor = inputField.value.length;
    inputField.setSelectionRange(cursor, cursor);
    return;
  }
  if (e.key === "@" && inputField.value.trim() === "") {
    e.preventDefault();
    postCommand("insertFileMention", inputField.value);
    return;
  }
  if (e.key === "#" && inputField.value.trim() === "") {
    e.preventDefault();
    if (isAgentBusy()) {
      showAgentSwitchDisabledWhileRunning();
      return;
    }
    postCommand("switchAgent");
    return;
  }
});
inputField.addEventListener("compositionstart", () => {
  state.isComposingText = true;
});
inputField.addEventListener("compositionend", () => {
  state.isComposingText = false;
});
inputField.addEventListener("input", () => {
  // updateComposerState() below posts the composer draft.
  state.promptHistoryIndex = state.promptHistory.length;
  state.promptHistoryDraft = "";
  autoResizeInput();
  updateComposerState();
  updateSlashHelp();
  handleSingleCharacterTrigger();
});
inputField.addEventListener("paste", (event) => {
  const files = imageFilesFromDataTransfer(event.clipboardData);
  if (files.length) {
    event.preventDefault();
    void attachImageFiles(files);
    return;
  }
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!text) return;
  if (handleComposerTextPaste(text)) event.preventDefault();
});
inputField.addEventListener("dragover", (event) => {
  if (imageFilesFromDataTransfer(event.dataTransfer).length || imagePathMentionTextFromDataTransfer(event.dataTransfer)) event.preventDefault();
});
inputField.addEventListener("drop", (event) => {
  const files = imageFilesFromDataTransfer(event.dataTransfer);
  if (files.length) {
    event.preventDefault();
    void attachImageFiles(files);
    return;
  }
  const text = imagePathMentionTextFromDataTransfer(event.dataTransfer);
  if (!text) return;
  event.preventDefault();
  handleComposerTextPaste(text);
});
document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (target instanceof Node && !slashHelp.contains(target) && !inputField.contains(target)) dismissSlashHelp();
});

attachmentTray.addEventListener("click", (event) => {
  const context = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-remove-context]") : null;
  if(context){pendingAttachments.splice(Number(context.dataset.removeContext),1);renderPendingImages();updateComposerState();return;}

  const button = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-remove-image-index]") : null;
  if (!button) return;
  const index = Number.parseInt(button.dataset.removeImageIndex || "", 10);
  if (!Number.isFinite(index)) return;
  pendingImages.splice(index, 1);
  renderPendingImages();
  updateComposerState();
  addDebugEvent("ImageRemoved", String(index));
});

topBar.querySelectorAll<HTMLElement>("[data-command]").forEach((button) => {
  button.addEventListener("click", () => postCommand(button.dataset.command));
});
topBar.querySelectorAll<HTMLElement>("[data-local-command]").forEach((button) => {
  button.addEventListener("click", () => runLocalCommand(button.dataset.localCommand));
});
topBar.querySelector<HTMLElement>(".approval-badge")?.addEventListener("click", () => {
  topBar.querySelector<HTMLElement>(".approval-menu")?.classList.toggle("hidden");
});
topBar.querySelectorAll<HTMLElement>("[data-approval-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    topBar.querySelector<HTMLElement>(".approval-menu")?.classList.add("hidden");
    vscode.postMessage({ type: "setApprovalMode", mode: button.dataset.approvalMode });
  });
});
statusBar.querySelectorAll<HTMLElement>("[data-command]").forEach((button) => {
  button.addEventListener("click", () => postCommand(button.dataset.command));
});
sessionFrame.querySelectorAll<HTMLElement>("[data-command]").forEach((button) => {
  button.addEventListener("click", () => postCommand(button.dataset.command));
});
sessionMeta.querySelectorAll<HTMLElement>("[data-command]").forEach((button) => {
  button.addEventListener("click", () => postCommand(button.dataset.command));
});
statusBar.querySelectorAll<HTMLElement>("[data-local-command]").forEach((button) => {
  button.addEventListener("click", () => runLocalCommand(button.dataset.localCommand));
});
inputBar.querySelectorAll<HTMLElement>("[data-command]").forEach((button) => {
  button.addEventListener("click", () => postCommand(button.dataset.command));
});
inputBar.querySelectorAll<HTMLElement>("[data-local-command]").forEach((button) => {
  button.addEventListener("click", () => runLocalCommand(button.dataset.localCommand));
});
sendBtn.addEventListener("click", () => handleSendButtonClick());
sessionFrame.querySelector<HTMLElement>(".session-label")?.addEventListener("click", () => {
  copyCurrentSessionId();
});
modelDialog.querySelector<HTMLElement>("[data-model-refresh]")?.addEventListener("click", () => {
  vscode.postMessage({ type: "modelDialogRefresh" });
});
modelDialog.querySelector<HTMLElement>("[data-model-close]")?.addEventListener("click", () => closeModelDialog(modelDialog));
modelDialog.addEventListener("click", (event) => {
  if (event.target === modelDialog) closeModelDialog(modelDialog);
});
// Agent dialog refresh
agentDialog.querySelector<HTMLElement>("[data-agent-refresh]")?.addEventListener("click", () => {
  vscode.postMessage({ type: "agentDialogRefresh" });
});
// Agent dialog close
agentDialog.querySelector<HTMLElement>("[data-agent-close]")?.addEventListener("click", () => {
  closeAgentDialog(agentDialog);
});
inlineDialog.querySelector<HTMLElement>("[data-inline-close]")?.addEventListener("click", () => closeInlineDialogFn(inlineDialog, vscode));
inlineDialog.addEventListener("click", (event) => {
  if (event.target === inlineDialog) closeInlineDialogFn(inlineDialog, vscode);
});
sidebarTabs.querySelectorAll<HTMLElement>("[data-side-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    sidebarTabs.querySelectorAll<HTMLElement>(".sidebar-tab").forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    const tab = button.dataset.sideTab || "messages";
    persistWebviewDiagnosticsState(tab);
    renderSideTab(tab);
    if (tab === "sessions") requestSessionsSidebar();
  });
});
sidebarCloseButton.addEventListener("click", () => toggleSidebar());
sidebarScrim.addEventListener("click", () => setSidebarOpen(false, "closed"));
sidebarContent.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.tagName === "BUTTON") return;
  const command = target.closest<HTMLElement>("[data-command]");
  if (!command) return;
  event.preventDefault();
  command.click();
});

sidebarContent.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  // Jump to a message from the Messages tab (delegated; the list is rebuilt often).
  const messageLink = target.closest<HTMLElement>(".sidebar-message-list [data-message-id]");
  if (messageLink?.dataset.messageId) {
    const jumpTarget = state.messageMap.get(messageLink.dataset.messageId);
    if (jumpTarget) {
      state.messageScrollAnchored = false;
      state.forceFollowNextMessage = false;
      jumpTarget.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      jumpTarget.classList.add("flash-highlight");
      setTimeout(() => jumpTarget.classList.remove("flash-highlight"), 1500);
    }
    return;
  }
  const sessionsAction = target.closest<HTMLElement>("[data-sessions-action]");
  if (sessionsAction) {
    const action = sessionsAction.dataset.sessionsAction;
    const id = sessionsAction.dataset.sessionId;
    if ((action === "resumeSession" || action === "deleteSession") && id) {
      sessionsSidebarState = { ...sessionsSidebarState, status: "loading" };
      renderSideTab("sessions");
      vscode.postMessage({
        type: "sessionsSidebarAction",
        action,
        id,
        cwd: sessionsAction.dataset.sessionCwd,
      });
    }
    return;
  }
  if (target.closest("[data-sessions-refresh]")) {
    requestSessionsSidebar(true);
    return;
  }
  const hostCommand = target.closest<HTMLElement>("[data-command]");
  if (hostCommand) {
    postCommand(hostCommand.dataset.command);
    return;
  }
  const localCommand = target.closest<HTMLElement>("[data-local-command]");
  if (localCommand) {
    runLocalCommand(localCommand.dataset.localCommand);
    return;
  }

});
slashHelp.addEventListener("click", (event) => {
  const button = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".slash-item") : null;
  if (!button) return;
  const commandText = button.dataset.commandText || "";
  const insertText = button.dataset.insertText;
  const action = commandText ? slashCommand(commandText) : null;
  if (insertText) {
    inputField.value = insertText;
    updateComposerState();
    inputField.focus();
    autoResizeInput();
    updateSlashHelp();
    return;
  }
  slashHelp.classList.add("hidden");
  if (isSlashDisabledWhileRunning(commandText)) {
    showSlashDisabledWhileRunning(commandText);
    updateSlashHelp();
    return;
  }
  if (action?.kind === "host") {
    clearComposer();
    vscode.postMessage({ type: "command", command: action.command, arg: action.arg });
  } else if (action?.kind === "local") {
    clearComposer();
    runLocalCommand(action.command, action.arg);
  }
});

// ──────────────────────────────────────────────
// Message area event listeners
// ──────────────────────────────────────────────

messageArea.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  // Action attributes are only honoured on extension-rendered controls.
  if (isInsideUntrustedMarkup(target)) return;
  const sleepSkipId = target.dataset.sleepSkipId;
  if (sleepSkipId) {
    vscode.postMessage({ type: "skipSleep", toolCallId: sleepSkipId });
    return;
  }
  const copyCommand = target.dataset.copyCommand;
  if (copyCommand) {
    navigator.clipboard?.writeText(copyCommand).then(
      () => {
        const original = target.textContent;
        target.textContent = t("copied");
        target.classList.add("copied-flash");
        setTimeout(() => {
          target.textContent = original;
          target.classList.remove("copied-flash");
        }, 2000);
      },
      () => showLocalNotice(t("copyFailed")),
    );
    return;
  }
  const copyToolId = target.dataset.copyToolId;
  if (copyToolId) {
    copyToolExecution(copyToolId);
    return;
  }
  const viewToolId = target.dataset.viewToolId;
  if (viewToolId) {
    openToolView(viewToolId);
    return;
  }
  const subAgentAction = target.dataset.subAgentAction;
  if (subAgentAction === "retry" || subAgentAction === "abort") {
    vscode.postMessage({
      type: "command",
      command: subAgentAction === "retry" ? "retrySubAgent" : "abortSubAgent",
    });
    return;
  }
  const toolCallId = target.dataset.toolCallId;
  if (toolCallId) {
    vscode.postMessage({ type: "openToolDiff", toolCallId });
    return;
  }
  const fileTarget = target.closest<HTMLElement>("[data-file-path]");
  const filePath = fileTarget?.dataset.filePath;
  if (filePath) {
    const parsedLine = Number.parseInt(fileTarget?.dataset.fileLine || "", 10);
    const location = `${filePath}${Number.isFinite(parsedLine) ? `:${parsedLine}` : ""}`;
    showLocalNotice(state.uiLanguage === "zh-CN" ? `正在打开 ${location}` : `Opening ${location}`);
    addDebugEvent("OpenFileFromToolCard", location);
    vscode.postMessage({
      type: "openFile",
      path: filePath,
      line: Number.isFinite(parsedLine) ? parsedLine : undefined,
    });
    return;
  }
  const resourceTarget = target.closest<HTMLElement>("[data-resource-uri]");
  const resourceUri = resourceTarget?.dataset.resourceUri;
  if (resourceUri) {
    vscode.postMessage({ type: "openExternalResource", uri: resourceUri });
    return;
  }
});
messageArea.addEventListener("contextmenu", (event) => {
  const selection = window.getSelection()?.toString();
  if (selection?.trim()) {
    event.preventDefault();
    navigator.clipboard?.writeText(selection).then(
      () => {
        window.getSelection()?.removeAllRanges();
        showLocalNotice(t("copied"));
        addDebugEvent("RightClickCopy", `${selection.length} chars`);
      },
      () => showLocalNotice(t("copyFailed")),
    );
    return;
  }
  const messageElement = event.target instanceof HTMLElement
    ? event.target.closest<HTMLElement>("[data-copy-message-id]")
    : null;
  const messageId = messageElement?.dataset.copyMessageId;
  if (!messageId) return;
  event.preventDefault();
  copyMessageById(messageId);
});
let lastMessageScrollTop = 0;
messageArea.addEventListener("scroll", () => {
  // A programmatic scroll event may arrive after more content grew. Being away
  // from the new bottom alone is not evidence that the user scrolled upwards.
  if (isMessageAreaAtBottom(messageArea)) state.messageScrollAnchored = true;
  else if (messageArea.scrollTop < lastMessageScrollTop) state.messageScrollAnchored = false;
  lastMessageScrollTop = messageArea.scrollTop;
}, { passive: true });
// content-visibility can replace estimated heights after scrolling without a DOM
// mutation or container resize. Re-anchor when those deferred layouts become real.
messageArea.addEventListener("contentvisibilityautostatechange", () => {
  scheduleMessageAnchorSync(state.messageScrollAnchored, messageArea);
}, { capture: true });
new MutationObserver(() => {
  scheduleMessageAnchorSync(state.messageScrollAnchored, messageArea);
}).observe(messageArea, { childList: true, subtree: true, characterData: true });
new ResizeObserver(() => {
  scheduleMessageAnchorSync(state.messageScrollAnchored, messageArea);
}).observe(messageArea);
new ResizeObserver(() => {
  scheduleMessageAnchorSync(state.messageScrollAnchored, messageArea);
}).observe(inputBar);
window.addEventListener("resize", () => {
  scheduleMessageAnchorSync(state.messageScrollAnchored, messageArea);
  if (sidebarPreference === "auto") {
    setSidebarOpen(sidebarOpenForViewport(window.innerWidth, sidebarPreference));
  } else {
    syncSidebarPresentation();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || window.innerWidth > SIDEBAR_DRAWER_BREAKPOINT || sidebar.classList.contains("hidden")) return;
  const modalOpen = [modelDialog, agentDialog, inlineDialog, approvalDialog, askUserDialog]
    .some((dialog) => !dialog.classList.contains("hidden"));
  if (modalOpen) return;
  event.preventDefault();
  setSidebarOpen(false, "closed");
});

// ──────────────────────────────────────────────
// Host → Webview message handler
// ──────────────────────────────────────────────

window.addEventListener("message", (e) => {
  const msg = e.data as HostMessage;
  switch (msg.type) {
    case "appendMessage":
      appendMessage(msg.message);
      break;
    case "appendMessages":
      appendMessages(msg.messages);
      break;
    case "updateMessage":
      updateMessage(msg.messageId, msg.patch);
      break;
    case "updateMessageTextOnly":
      updateMessageTextOnly(msg.messageId, msg.text);
      break;
    case "removeMessage":
      removeMessage(msg.messageId);
      break;
    case "clearMessages":
      clearMessages();
      break;
    case "setState":
      setState(msg.state);
      break;
    case "addTextAttachment":
      if(pendingAttachments.length < 20) pendingAttachments.push(msg.attachment);
      renderPendingImages(); updateComposerState();
      break;
    case "setComposer":
      setComposer(msg.text, msg.restore);
      break;
    case "reconnectNotice":
      showReconnect();
      break;
    case "debugEvent":
      addDebugEvent(msg.kind, msg.detail, false);
      break;
    case "localCommand":
      runLocalCommand(msg.command);
      break;
    case "modelDialogState":
      setModelDialogState(msg.state, modelDialog, vscode);
      break;
    case "modelDialogBusy":
      setModelDialogBusy(modelDialog, msg.busy);
      break;
    case "modelDialogNotice":
      showModelDialogNotice(modelDialog, msg.level, msg.text);
      break;
    case "agentDialogState":
      setAgentDialogState(msg.state, agentDialog, vscode);
      break;
    case "agentDialogBusy":
      setAgentDialogBusy(agentDialog, msg.busy);
      break;
    case "agentDialogNotice":
      showAgentDialogNotice(agentDialog, msg.level, msg.text);
      break;
    case "applyTheme":
      applyTheme(msg.theme);
      break;
    case "inlineDialogState":
      setInlineDialogState(msg.state, inlineDialog, vscode);
      break;
    case "inlineDialogBusy":
      setInlineDialogBusy(inlineDialog, msg.busy);
      break;
    case "inlineDialogNotice":
      showInlineDialogNotice(inlineDialog, msg.level, msg.text);
      break;
    case "approvalDialogState":
      setApprovalDialogState(msg.state, approvalDialog, vscode);
      break;
    case "askUserDialogState":
      setAskUserDialogState(msg.state, askUserDialog, vscode);
      break;
    case "sessionsSidebarState":
      sessionsSidebarState = msg.state;
      if (activeSideTab() === "sessions") renderSideTab("sessions");
      break;
  }
});

// ──────────────────────────────────────────────
// Message orchestration (glue layer)
// ──────────────────────────────────────────────

let userTurnCount = 0;
const pendingTextRenders = new Set<string>();
let textRenderScheduled = false;

// Mermaid fences render as source until the lazily loaded engine arrives; then redraw them.
onDiagramEngineReady(() => {
  for (const message of state.messages) {
    if (mentionsMermaid(message.text) || (message.activityDetail && mentionsMermaid(message.activityDetail))
      || message.toolContent?.some((block) => block.type === "text" && mentionsMermaid(block.text))) {
      updateMessage(message.id, {});
    }
  }
});

/** True while a restored transcript is replayed; per-message side effects run once at the end. */
let replayingTranscript = false;

function appendMessage(msg: ChatMessage): void {
  hideWelcome();
  const shouldFollow = consumeForceFollowNextMessage() || shouldFollowMessages(messageArea);
  if (msg.kind === "user" && !msg.isInjection) {
    msg.turnNumber = ++userTurnCount;
  }
  state.messages.push(msg);
  state.messageById.set(msg.id, msg);
  if (!replayingTranscript) addMessageDebugEvent(msg, "start");
  if (isToolMessage(msg)) {
    appendToolMessage(msg, messageArea, statusBar);
    const toolElement = state.messageMap.get(msg.id);
    if (toolElement) markCopyableMessageElement(msg, toolElement);
    refreshSideTabAfterMessage(msg);
    scheduleMessageAnchorSync(shouldFollow, messageArea);
    return;
  }
  finishActiveToolGroup(msg.kind === "agent", statusBar);
  const element = renderMessage(msg);
  markCopyableMessageElement(msg, element);
  state.messageMap.set(msg.id, element);
  messageArea.appendChild(element);
  refreshSideTabAfterMessage(msg);
  scheduleMessageAnchorSync(shouldFollow, messageArea);
}

/** Replays a restored transcript without per-message sidebar renders or debug relays. */
function appendMessages(messages: ChatMessage[]): void {
  replayingTranscript = true;
  try {
    for (const message of messages) appendMessage(message);
  } finally {
    replayingTranscript = false;
  }
  renderSideTab(activeSideTab());
}

/**
 * The Messages tab lists user turns only, so tool and agent traffic does not need to
 * rebuild it; other tabs keep refreshing on every message change.
 */
function refreshSideTabAfterMessage(msg: ChatMessage): void {
  if (replayingTranscript) return;
  const tab = activeSideTab();
  if (tab === "messages" && msg.kind !== "user") return;
  renderSideTab(tab);
}

function updateMessage(msgId: string, patch: Partial<ChatMessage>): void {
  pendingTextRenders.delete(msgId);
  const message = state.messageById.get(msgId);
  if (!message) return;
  // The scroll listener keeps the anchor current; avoid a forced layout read per update.
  const shouldFollow = state.messageScrollAnchored;
  Object.assign(message, patch);
  addMessageDebugEvent(message, "update");
  const existing = state.messageMap.get(msgId);
  if (!existing) return;
  const newEl = renderMessage(message);
  markCopyableMessageElement(message, newEl);
  existing.replaceWith(newEl);
  state.messageMap.set(msgId, newEl);
  const toolGroup = state.toolGroupByMessageId.get(msgId);
  if (toolGroup) updateToolGroup(toolGroup, statusBar);
  refreshSideTabAfterMessage(message);
  scheduleMessageAnchorSync(shouldFollow, messageArea);
}

function markCopyableMessageElement(msg: ChatMessage, element: HTMLElement): void {
  element.dataset.copyMessageId = msg.id;
  element.classList.add("copyable-message");
}

function updateMessageTextOnly(msgId: string, text: string): void {
  const message = state.messageById.get(msgId);
  if (!message || message.text === text) return;
  // Keep the model current for copying even while browser painting is deferred.
  message.text = text;
  pendingTextRenders.add(msgId);
  if (textRenderScheduled) return;
  textRenderScheduled = true;
  requestAnimationFrame(() => {
    textRenderScheduled = false;
    const shouldFollow = state.messageScrollAnchored;
    for (const id of pendingTextRenders) {
      const message = state.messageById.get(id);
      const content = state.messageMap.get(id)?.querySelector<HTMLElement>(".bubble-content");
      if (message && content) renderMessageTextUpdate(message, content);
    }
    pendingTextRenders.clear();
    scheduleMessageAnchorSync(shouldFollow, messageArea);
  });
}

function renderMessageTextUpdate(message: ChatMessage, bubbleContent: HTMLElement): void {
  if (message.kind === "user") {
    const userText = bubbleContent.querySelector<HTMLElement>(".user-message-text");
    if (userText) {
      userText.textContent = message.text;
    } else {
      bubbleContent.textContent = message.text;
    }
    return;
  }
  const text = message.kind === "agent"
    ? processThinkTags(message.text, Boolean(message.isIntermediate))
    : message.text;
  bubbleContent.innerHTML = renderMarkdown(text);
}

function removeMessage(msgId: string): void {
  pendingTextRenders.delete(msgId);
  const idx = state.messages.findIndex((message) => message.id === msgId);
  if (idx >= 0) state.messages.splice(idx, 1);
  state.messageById.delete(msgId);
  const existing = state.messageMap.get(msgId);
  if (existing) {
    const group = state.toolGroupByMessageId.get(msgId);
    existing.remove();
    state.messageMap.delete(msgId);
    state.toolGroupByMessageId.delete(msgId);
    if (group) {
      group.ids = group.ids.filter((id) => id !== msgId);
      updateToolGroup(group, statusBar);
    }
  }
  renderSideTab(activeSideTab());
}

function clearMessages(): void {
  pendingTextRenders.clear();
  for (const group of new Set(state.toolGroupByMessageId.values())) {
    if (group.timer !== undefined) window.clearInterval(group.timer);
    group.timer = undefined;
  }
  state.messages.length = 0;
  state.messageById.clear();
  state.messageMap.clear();
  state.toolGroupByMessageId.clear();
  state.activeToolGroup = null;
  userTurnCount = 0;
  lastMessageScrollTop = 0;
  messageArea.innerHTML = "";
  messageArea.appendChild(createWelcomeElement());
  state.messageScrollAnchored = true;
  startWelcomeAnimation();
  renderSideTab("messages");
  refreshChromeText();
}

// ──────────────────────────────────────────────
// State display
// ──────────────────────────────────────────────

function refreshChromeText(): void {
  sidebarTabs.querySelector<HTMLElement>("[data-side-tab='messages']")!.textContent = t("messages");
  sidebarTabs.querySelector<HTMLElement>("[data-side-tab='sessions']")!.textContent = t("sessions");
  sidebarTabs.querySelector<HTMLElement>("[data-side-tab='context']")!.textContent = t("context");
  sidebarTabs.querySelector<HTMLElement>("[data-side-tab='debug']")!.textContent = t("debug");
  const buddyTab = sidebarTabs.querySelector<HTMLElement>("[data-side-tab='companion']");
  if (buddyTab) buddyTab.textContent = t("companion");
  const sidebarEmpty = sidebarContent.querySelector<HTMLElement>(".sidebar-empty");
  if (sidebarEmpty) sidebarEmpty.textContent = t("emptyConversation");
  messageArea.querySelectorAll<HTMLElement>(".welcome-profile-label").forEach((label) => {
    label.textContent = t("profile");
  });
  messageArea.querySelectorAll<HTMLElement>(".welcome-workspace-label").forEach((label) => {
    label.textContent = t("workingDirectory");
  });
  messageArea.querySelectorAll<HTMLElement>(".welcome-eyebrow").forEach((label) => {
    label.textContent = t("welcomeEyebrow");
  });
  messageArea.querySelectorAll<HTMLElement>(".welcome-title").forEach((label) => {
    label.textContent = t("welcomeTitle");
  });
  messageArea.querySelectorAll<HTMLElement>(".welcome-subtitle").forEach((label) => {
    label.textContent = t("welcomeSubtitle");
  });
  inputBar.querySelector<HTMLElement>("[data-command='switchAgent'].input-hint")!.textContent = t("agentsHint");
  inputBar.querySelector<HTMLElement>("[data-command='setModelProfile'].input-hint")!.textContent = t("modelsHint");
  inputBar.querySelector<HTMLElement>("[data-command='openShell'].input-hint")!.textContent = t("shellHint");
  inputBar.querySelector<HTMLElement>("[data-local-command='startSlashCommand'].input-hint")!.textContent = t("commandsHint");
  inputBar.querySelector<HTMLElement>("[data-command='insertFileMention'].input-hint")!.textContent = t("filesHint");
  newBtn.textContent = t("new");
  newBtn.title = state.uiLanguage === "zh-CN"
    ? "清空当前窗口显示，保留会话上下文；用 /new 打开独立新会话"
    : "Clear this view; keep session context. Use /new for a separate new session.";
  const sessionLabel = sessionFrame.querySelector<HTMLElement>(".session-label");
  if (sessionLabel) sessionLabel.title = t("copySessionId");
  const sessionCwd = sessionFrame.querySelector<HTMLElement>(".session-cwd");
  if (sessionCwd) sessionCwd.title = state.latestState?.workspacePath || t("changeWorkspace");
  inputField.placeholder = connectionReady(state.latestState) ? t("typeMessage") : t("startingPlaceholder");
  refreshFoldedLabels();
  const thinkingText = thinkingIndicator.querySelectorAll<HTMLElement>("span")[1];
  if (thinkingText) thinkingText.textContent = t("thinking");
  sidebarCloseButton.title = t("closeSidebar");
  sidebarCloseButton.setAttribute("aria-label", t("closeSidebar"));
  sidebar.setAttribute("aria-label", t("sidebar"));
  syncSidebarPresentation();
  modelDialog.querySelector<HTMLElement>(".tui-modal-title")!.textContent = t("models");
  modelDialog.querySelector<HTMLElement>(".tui-modal-subtitle")!.textContent = t("modelDialogSubtitle");
  modelDialog.querySelector<HTMLElement>("[data-model-refresh]")!.textContent = t("refresh");
  modelDialog.querySelector<HTMLElement>("[data-model-close]")!.textContent = t("close");
  agentDialog.querySelector<HTMLElement>(".tui-modal-title")!.textContent = t("agents");
  agentDialog.querySelector<HTMLElement>(".tui-modal-subtitle")!.textContent = t("agentDialogSubtitle");
  agentDialog.querySelector<HTMLElement>("[data-agent-refresh]")!.textContent = t("refresh");
  agentDialog.querySelector<HTMLElement>("[data-agent-close]")!.textContent = t("close");
  inlineDialog.querySelector<HTMLElement>("[data-inline-close]")!.textContent = t("close");
  topBar.querySelectorAll<HTMLElement>("[data-approval-mode]").forEach((button) => {
    const mode = button.dataset.approvalMode || "auto";
    button.textContent = approvalModeLabel(mode);
  });
  updateApprovalBadge(state.latestState?.approvalMode || "auto");
  if (reconnectNotice.classList.contains("hidden")) reconnectNotice.textContent = t("reconnecting");
  updateStatusBar(statusBar, state.latestState);
}

function refreshFoldedLabels(): void {
  const label = state.uiLanguage === "zh-CN" ? "已折叠" : "folded";
  messageArea.querySelectorAll<HTMLElement>(".bubble.agent .bubble-header").forEach((header) => {
    header.dataset.foldedLabel = label;
  });
}

function setState(panelState: ChatPanelState): void {
  const previousSessionState = state.latestState?.sessionState;
  const nextLanguage = panelState.uiLanguage ?? "en";
  if (nextLanguage !== state.uiLanguage) {
    state.uiLanguage = nextLanguage;
    document.documentElement.lang = nextLanguage;
    refreshChromeText();
    updateSlashHelp();
  }
  const nextTheme = panelState.uiTheme ?? "chrys";
  if (nextTheme !== state.currentTheme) {
    state.currentTheme = nextTheme;
    applyTheme(nextTheme);
    addDebugEvent("Theme", nextTheme);
  }
  if (panelState.usageText && panelState.usageText !== state.latestState?.usageText) {
    addDebugEvent("Usage", panelState.usageText);
  }
  const pctForHistory = panelState.contextPct ?? (panelState.contextMaxTokens ? ((panelState.contextUsedTokens ?? 0) / panelState.contextMaxTokens) * 100 : 0);
  if (!state.latestState || pctForHistory !== (state.latestState.contextPct ?? (state.latestState.contextMaxTokens ? ((state.latestState.contextUsedTokens ?? 0) / state.latestState.contextMaxTokens) * 100 : 0))) {
    state.usageHistory.push(pctForHistory);
    if (state.usageHistory.length > 60) state.usageHistory.splice(0, state.usageHistory.length - 60);
  }
  if (panelState.approvalMode && panelState.approvalMode !== state.latestState?.approvalMode) {
    addDebugEvent("ApprovalMode", panelState.approvalMode.toUpperCase());
  }
  state.latestState = panelState;
  renderWelcomeLogo();
  state.currentSessionState = panelState.sessionState;
  const tuiTitle = topBar.querySelector<HTMLElement>(".tui-title")!;
  const sessionLabel = sessionFrame.querySelector<HTMLElement>(".session-label")!;
  const sessionCwd = sessionFrame.querySelector<HTMLElement>(".session-cwd")!;
  const sessionCwdValue = sessionFrame.querySelector<HTMLElement>(".session-cwd-value")!;
  const profileMeta = sessionMeta.querySelector<HTMLElement>(".profile-meta")!;
  const toolsMeta = sessionMeta.querySelector(".tools-meta")!;
  const filesMeta = sessionMeta.querySelector(".files-meta")!;
  const promptAgent = inputBar.querySelector(".prompt-chip.active")!;
  const statusTokens = statusBar.querySelector(".status-tokens")!;

  const displayAgent = panelState.agentName || "Code Agent";
  const displayModel = panelState.modelName || "";
  state.currentAgentName = displayAgent;
  const welcomeAgent = messageArea.querySelector(".agent-name");
  if (welcomeAgent) welcomeAgent.textContent = displayAgent;
  promptAgent.textContent = displayAgent;
  const branding = brandDisplay({
    uiBrand: panelState.uiBrand,
    chrysCliVersion: panelState.chrysCliVersion,
    agentName: displayAgent,
    modelName: displayModel,
    platformLabel: panelState.platformLabel,
    workspacePath: panelState.workspacePath,
  });
  tuiTitle.textContent = branding.header;
  tuiTitle.title = branding.tooltip;
  const profileText = `${t("profile")}: ${displayAgent}${displayModel ? ` · ${displayModel}` : ""}`;
  profileMeta.textContent = profileText;
  profileMeta.title = profileText;
  toolsMeta.textContent = countLabel(panelState.toolCount ?? 0, "toolsMeta", "tool");
  filesMeta.textContent = countLabel(panelState.fileCount ?? 0, "filesMeta", "file");
  const approvalMode = panelState.approvalMode || "auto";
  updateApprovalBadge(approvalMode);
  const sessionShortId = shortSessionId(panelState.sessionId);
  const sessionDisplay = panelState.sessionTitle?.trim() || sessionShortId;
  sessionLabel.textContent = sessionDisplay ? `${t("session")}: ${sessionDisplay}` : "";
  sessionLabel.title = sessionShortId
    ? [panelState.sessionTitle, panelState.sessionId].filter(Boolean).join("\n")
    : "";
  sessionLabel.classList.toggle("hidden", !sessionShortId);
  sessionCwdValue.textContent = (panelState.workspacePath || "") + (panelState.additionalDirectories?.length ? ` (+${panelState.additionalDirectories.length})` : "");
  sessionCwd.title = [panelState.workspacePath, ...(panelState.additionalDirectories ?? [])].filter(Boolean).join("\n");
  const welcomeWorkspace = messageArea.querySelector(".workspace-path");
  if (welcomeWorkspace) {
    welcomeWorkspace.textContent = panelState.workspacePath || "";
    welcomeWorkspace.setAttribute("title", panelState.workspacePath || "");
  }
  statusTokens.textContent = panelState.usageText || "";
  const wasRunning = previousSessionState === "running" || previousSessionState === "cancelling";
  const isRunning = panelState.sessionState === "running" || panelState.sessionState === "cancelling";
  if (isRunning && !wasRunning) {
    state.statusRunStartedAt = Date.now();
    state.lastCompletedElapsed = "";
  } else if (!isRunning && wasRunning) {
    state.lastCompletedElapsed = state.statusRunStartedAt ? formatDurationMs(Date.now() - state.statusRunStartedAt) : "";
    state.statusRunStartedAt = undefined;
  }
  const needsStatusTimer = isRunning || connectionPending(panelState.connectionState);
  if (needsStatusTimer && state.statusTimer === undefined) {
    state.statusTimer = window.setInterval(() => {
      updateStatusBar(statusBar, state.latestState);
      updateSessionRunElapsed();
    }, 1000);
  } else if (!needsStatusTimer && state.statusTimer !== undefined) {
    window.clearInterval(state.statusTimer);
    state.statusTimer = undefined;
  }
  updateStatusBar(statusBar, panelState);
  // Send button morphs: Send → Queue during a run → Interrupt when no injection text is present → Continue.
  if (panelState.sessionState === "idle") {
    state.localSubmitPending = false;
    state.queuedInjectionPending = false;
  }
  const runtimeReady = connectionReady(panelState);
  inputField.disabled = state.queuedInjectionPending || !runtimeReady;
  inputField.placeholder = runtimeReady ? t("typeMessage") : t("startingPlaceholder");
  promptAgent.toggleAttribute("disabled", !runtimeReady);
  inputBar.querySelectorAll<HTMLButtonElement>(".input-hint").forEach((button) => {
    button.disabled = !runtimeReady;
  });
  newBtn.classList.remove("hidden");
  newBtn.disabled = !runtimeReady || isAgentBusy();
  thinkingIndicator.classList.toggle("hidden", panelState.sessionState === "idle");
  const thinkingText = thinkingIndicator.querySelector<HTMLElement>(".thinking-label");
  if (thinkingText) {
    thinkingText.textContent = panelState.sessionState === "cancelling"
      ? (state.uiLanguage === "zh-CN" ? "正在中断" : "Cancelling")
      : t("thinking");
  }
  sessionFrame.classList.toggle("is-running", panelState.sessionState === "running");
  sessionFrame.classList.toggle("is-cancelling", panelState.sessionState === "cancelling");
  sessionFrame.classList.toggle("is-starting", connectionPending(panelState.connectionState));
  updateSessionRunIndicator(panelState);
  updateSessionRunElapsed();
  const sessionChanged = panelState.sessionId !== lastObservedSessionId;
  const sessionsNeedRefresh = sessionChanged
    || sessionsSidebarState.status === "idle"
    || sessionsSidebarState.status === "error";
  if (activeSideTab() === "sessions" && sessionsNeedRefresh) {
    lastObservedSessionId = panelState.sessionId;
    requestSessionsSidebar(sessionChanged);
  } else {
    lastObservedSessionId = panelState.sessionId;
  }
  renderSideTab(activeSideTab());
  updateSendButtonState();
}

function updateSessionRunElapsed(): void {
  const runElapsed = state.statusRunStartedAt ? formatDurationMs(Date.now() - state.statusRunStartedAt) : "";
  const connectionElapsed = connectionPending(state.latestState?.connectionState) && state.latestState?.connectionStartedAt
    ? formatDurationMs(Date.now() - state.latestState.connectionStartedAt)
    : "";
  const thinkingElapsed = thinkingIndicator.querySelector<HTMLElement>(".thinking-elapsed");
  const frameElapsed = sessionRunIndicator.querySelector<HTMLElement>(".session-run-elapsed");
  if (thinkingElapsed) thinkingElapsed.textContent = runElapsed;
  if (frameElapsed) {
    frameElapsed.textContent = connectionElapsed || (state.currentSessionState !== "idle" ? runElapsed : "");
  }
}

function updateSessionRunIndicator(panelState: ChatPanelState): void {
  if (agentReadyHideTimer !== undefined) {
    window.clearTimeout(agentReadyHideTimer);
    agentReadyHideTimer = undefined;
  }
  const lifecycle = panelState.agentLifecycle;
  const connectionState = panelState.connectionState ?? "ready";
  const connectionVisible = connectionState !== "ready";
  const lifecycleIsFresh = lifecycle && Date.now() - lifecycle.updatedAt < 30_000;
  const running = panelState.sessionState === "running" || panelState.sessionState === "cancelling";
  const loadingAgent = Boolean(lifecycleIsFresh && lifecycle?.status === "loading");
  const showLifecycle = Boolean(lifecycleIsFresh && lifecycle?.status !== "ready")
    || Boolean(lifecycleIsFresh && lifecycle?.status === "ready" && lifecycle.updatedAt !== visibleAgentLifecycleUpdate);
  const visible = connectionVisible || running || showLifecycle;
  const label = sessionRunIndicator.querySelector<HTMLElement>(".session-run-label");
  const progress = sessionRunIndicator.querySelector<HTMLElement>(".session-run-progress");
  const spinner = sessionRunIndicator.querySelector<HTMLElement>(".session-run-spinner");

  sessionRunIndicator.classList.toggle("hidden", !visible);
  sessionRunIndicator.classList.toggle("startup", connectionPending(connectionState));
  sessionRunIndicator.classList.toggle("ready", !connectionVisible && lifecycle?.status === "ready" && !running);
  sessionRunIndicator.classList.toggle("failed", connectionState === "error" || connectionState === "disconnected" || (lifecycle?.status === "failed" && !running));
  if (spinner) spinner.classList.toggle("complete", !connectionVisible && lifecycle?.status === "ready" && !running);
  if (!visible || !label || !progress) return;

  if (connectionVisible && !running) {
    const presentation = connectionPresentation(connectionState, panelState.connectionDetail || "", state.uiLanguage);
    label.textContent = presentation.label;
    progress.textContent = presentation.detail;
    return;
  }

  if (loadingAgent) {
    label.textContent = t("loadingAgent");
    progress.textContent = lifecycle?.current !== undefined && lifecycle.total !== undefined
      ? `${lifecycle.current}/${lifecycle.total}`
      : lifecycle?.detail || lifecycle?.label || "";
    return;
  }

  if (running) {
    label.textContent = panelState.sessionState === "cancelling"
      ? (state.uiLanguage === "zh-CN" ? "正在中断" : "Cancelling")
      : t("processing");
    progress.textContent = "";
    return;
  }

  label.textContent = lifecycle?.status === "ready"
    ? `${lifecycle.label || (state.uiLanguage === "zh-CN" ? "智能体" : "Agent")} · ${t("ready")}`
    : lifecycle?.status === "failed"
      ? (state.uiLanguage === "zh-CN" ? "智能体加载失败" : "Agent load failed")
      : t("loadingAgent");
  progress.textContent = lifecycle?.current !== undefined && lifecycle.total !== undefined
    ? `${lifecycle.current}/${lifecycle.total}`
    : lifecycle?.detail || "";

  if (lifecycle?.status === "ready") {
    visibleAgentLifecycleUpdate = lifecycle.updatedAt;
    if (agentReadyHideTimer !== undefined) window.clearTimeout(agentReadyHideTimer);
    agentReadyHideTimer = window.setTimeout(() => {
      if (state.currentSessionState === "idle") sessionRunIndicator.classList.add("hidden");
      agentReadyHideTimer = undefined;
    }, 4_000);
  }
}

function connectionPending(connectionState: ChatConnectionState | undefined): boolean {
  return connectionState === "resolving-workspace"
    || connectionState === "resolving-backend"
    || connectionState === "starting"
    || connectionState === "initializing";
}

function connectionReady(panelState: ChatPanelState | null | undefined): boolean {
  return panelState?.connectionState === "ready";
}

function updateApprovalBadge(mode: string): void {
  const approvalBadge = topBar.querySelector<HTMLElement>(".approval-badge");
  if (!approvalBadge) return;
  approvalBadge.textContent = `${t("approvalMode")}: ${approvalModeLabel(mode)}`;
  approvalBadge.className = `approval-badge approval-${mode}`;
}

function approvalModeLabel(mode: string): string {
  if (state.uiLanguage === "zh-CN") {
    const labels: Record<string, string> = {
      manual: "手动批准",
      auto: "帮我批准",
      bypass: "完全访问",
    };
    return labels[mode] ?? mode;
  }
  const labels: Record<string, string> = { manual: "Manual approval", auto: "Approve for me", bypass: "Full access" };
  return labels[mode] ?? mode;
}

// ──────────────────────────────────────────────
// Sidebar rendering
// ──────────────────────────────────────────────

function activeSideTab(): string {
  return sidebarTabs.querySelector<HTMLElement>(".sidebar-tab.active")?.dataset.sideTab || "messages";
}

function restoreActiveSideTab(): void {
  const requested = ["messages", "sessions", "context", "debug", ...(COMPANION_ENABLED ? ["companion"] : [])]
    .includes(persistedWebviewState.activeSideTab || "")
    ? persistedWebviewState.activeSideTab
    : undefined;
  const available = requested
    ? sidebarTabs.querySelector<HTMLElement>(`[data-side-tab='${requested}']`)
    : null;
  const selected = available ?? sidebarTabs.querySelector<HTMLElement>("[data-side-tab='messages']")!;
  sidebarTabs.querySelectorAll<HTMLElement>(".sidebar-tab").forEach((tab) => {
    const active = tab === selected;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  const tab = selected.dataset.sideTab || "messages";
  renderSideTab(tab);
  if (tab === "sessions") window.setTimeout(() => requestSessionsSidebar(true), 250);
}

function renderSideTab(tab: string): void {
  if (tab === "messages") {
    sidebarContent.innerHTML = "";
    sidebarContent.appendChild(renderConversationOverview());
    const userMessages = state.messages.filter((message) => message.kind === "user");
    sidebarContent.appendChild(el("div", { class: "context-title sidebar-section-title" },
      state.uiLanguage === "zh-CN" ? "最近消息" : "Recent messages",
    ));
    if (!userMessages.length) {
      sidebarContent.appendChild(el("div", { class: "sidebar-empty sidebar-empty-compact" }, t("emptyConversation")));
      return;
    }
    const visibleMessages = userMessages.slice(-20);
    const startIndex = userMessages.length - visibleMessages.length;
    let visibleTurnNumber = userMessages.slice(0, startIndex).filter((message) => !message.isInjection).length;
    sidebarContent.append(el("div", { class: "sidebar-message-list", role: "list" },
      ...visibleMessages.map((message) => {
        if (!message.isInjection) visibleTurnNumber += 1;
        return renderSidebarMessage(message, visibleTurnNumber);
      }),
    ));
    return;
  }
  if (tab === "sessions") {
    sidebarContent.innerHTML = "";
    renderSessionsSidebar();
    return;
  }
  if (tab === "context") {
    sidebarContent.innerHTML = "";
    renderContextSidebar();
    return;
  }
  if (tab === "debug") {
    sidebarContent.innerHTML = "";
    renderDebugSidebar();
    return;
  }
  if (tab === "companion" && COMPANION_ENABLED) {
    renderCompanionSidebar(sidebarContent, (arg) => vscode.postMessage({ type: "command", command: "companionCommand", arg }));
    return;
  }
  // Unknown tab — nothing to render
  sidebarContent.innerHTML = "";
}

function renderConversationOverview(): HTMLElement {
  const panelState = state.latestState;
  const running = panelState?.sessionState === "running";
  const cancelling = panelState?.sessionState === "cancelling";
  const connectionState = panelState?.connectionState ?? "resolving-workspace";
  const connection = connectionPresentation(connectionState, panelState?.connectionDetail || "", state.uiLanguage);
  const waitingForConnection = connectionState !== "ready";
  const statusText = waitingForConnection
    ? connection.label
    : cancelling
    ? (state.uiLanguage === "zh-CN" ? "正在中断" : "Cancelling")
    : running
      ? t("thinking")
      : t("ready");
  const statusClass = waitingForConnection
    ? (connection.tone === "failed" ? "cancelling" : "running")
    : cancelling
      ? "cancelling"
      : running
        ? "running"
        : "ready";
  const planEntries = panelState?.planEntries ?? [];
  const completed = planEntries.filter((entry) => entry.status === "completed").length;

  return el("div", { class: "sidebar-overview" },
    el("div", { class: `overview-status ${statusClass}` },
      el("span", { class: "overview-status-dot", "aria-hidden": "true" }, ""),
      el("span", { class: "overview-status-label" }, statusText),
      el("span", { class: "overview-status-agent" }, panelState?.agentName || "iCode"),
    ),
    planEntries.length
      ? el("section", { class: "sidebar-plan" },
        el("div", { class: "sidebar-plan-head" },
          el("span", {}, t("plan")),
          el("span", { class: "sidebar-plan-count" }, `${completed}/${planEntries.length}`),
        ),
        el("div", { class: "sidebar-plan-list" },
          ...planEntries.map((entry) => el("div", { class: `sidebar-plan-item ${entry.status}` },
            el("span", { class: "sidebar-plan-marker", "aria-hidden": "true" },
              entry.status === "completed" ? "✓" : entry.status === "in_progress" ? "◉" : "○",
            ),
            el("span", { class: "sidebar-plan-text", title: entry.content }, entry.content),
          )),
        ),
      )
      : el("div", { class: "overview-stats" },
        overviewStat(String(panelState?.toolCount ?? 0), state.uiLanguage === "zh-CN" ? "工具" : "tools"),
        overviewStat(String(panelState?.runtimeSkillNames?.length ?? 0), state.uiLanguage === "zh-CN" ? "技能" : "skills"),
        overviewStat(String(panelState?.fileCount ?? 0), state.uiLanguage === "zh-CN" ? "文件" : "files"),
      ),
  );
}

function overviewStat(value: string, label: string): HTMLElement {
  return el("span", { class: "overview-stat" },
    el("strong", {}, value),
    el("span", {}, label),
  );
}

function requestSessionsSidebar(force = false): void {
  const now = Date.now();
  if (!force && sessionsSidebarState.status === "loading") return;
  if (!force && sessionsSidebarState.status === "ready" && now - lastSessionsRequestAt < 10_000) return;
  lastSessionsRequestAt = now;
  sessionsSidebarState = {
    status: "loading",
    sessions: sessionsSidebarState.sessions,
    currentSessionId: state.latestState?.sessionId,
  };
  if (activeSideTab() === "sessions") renderSideTab("sessions");
  vscode.postMessage({ type: "sessionsSidebarRefresh" });
}

function renderSessionsSidebar(): void {
  const busy = sessionsSidebarState.status === "loading";
  const sessions = sessionsSidebarState.sessions;
  sidebarContent.append(
    el("div", { class: "sessions-toolbar" },
      el("div", {},
        el("div", { class: "sessions-toolbar-title" }, t("sessions")),
        el("div", { class: "sessions-toolbar-meta" }, sessionsSidebarState.status === "ready"
          ? (state.uiLanguage === "zh-CN" ? `${sessions.length} 个已保存会话` : `${sessions.length} saved`)
          : state.uiLanguage === "zh-CN" ? "当前工作区" : "Current workspace"),
      ),
      el("div", { class: "sessions-toolbar-actions" },
        el("button", {
          class: "sidebar-icon-button",
          "data-sessions-refresh": "true",
          title: t("refreshSessions"),
          "aria-label": t("refreshSessions"),
        }, "↻"),
        el("button", {
          class: "sidebar-icon-button primary",
          "data-command": "newSession",
          title: t("new"),
          "aria-label": t("new"),
          ...(busy ? { disabled: "true" } : {}),
        }, "+"),
      ),
    ),
  );

  if (sessionsSidebarState.status === "loading" && !sessions.length) {
    sidebarContent.appendChild(el("div", { class: "sidebar-loading", role: "status" },
      el("span", { class: "session-run-spinner", "aria-hidden": "true" }, ""),
      el("span", {}, t("loadingSessions")),
    ));
    return;
  }
  if (sessionsSidebarState.status === "error") {
    sidebarContent.appendChild(el("div", { class: "sidebar-error" }, sessionsSidebarState.error || "Error"));
    return;
  }
  if (!sessions.length) {
    sidebarContent.appendChild(el("div", { class: "sidebar-empty" }, t("noSavedSessions")));
    return;
  }

  const currentSessionId = sessionsSidebarState.currentSessionId || state.latestState?.sessionId;
  sidebarContent.appendChild(el("div", { class: "session-list", role: "list" },
    ...sessions.map((session) => {
      const current = session.sessionId === currentSessionId;
      const meta = sessionMetadata(session._meta);
      const detail = [
        localizedTimeAgo(session.updatedAt),
        meta.agent,
        meta.model,
        meta.messageCount !== undefined
          ? (state.uiLanguage === "zh-CN" ? `${meta.messageCount} 条消息` : `${meta.messageCount} messages`)
          : "",
      ].filter(Boolean).join(" · ");
      return el("article", { class: `session-list-item${current ? " current" : ""}`, role: "listitem" },
        el("button", {
          class: "session-list-main",
          "data-sessions-action": "resumeSession",
          "data-session-id": session.sessionId,
          "data-session-cwd": session.cwd,
          title: current ? t("currentSession") : t("resumeSession"),
          ...(busy || current ? { disabled: "true" } : {}),
        },
          el("span", { class: "session-list-title" }, session.title || shortSessionId(session.sessionId)),
          el("span", { class: "session-list-detail" }, detail || session.cwd),
          el("span", { class: "session-list-id" }, shortSessionId(session.sessionId)),
        ),
        current
          ? el("span", { class: "session-current-badge" }, t("currentSession"))
          : el("button", {
            class: "session-delete-button",
            "data-sessions-action": "deleteSession",
            "data-session-id": session.sessionId,
            "data-session-cwd": session.cwd,
            title: t("deleteSession"),
            "aria-label": t("deleteSession"),
            ...(busy ? { disabled: "true" } : {}),
          }, "×"),
      );
    }),
  ));
}

function sessionMetadata(value: unknown): { agent: string; model: string; messageCount?: number } {
  if (!value || typeof value !== "object") return { agent: "", model: "" };
  const meta = value as Record<string, unknown>;
  return {
    agent: typeof meta.agent_display_name === "string"
      ? meta.agent_display_name
      : typeof meta.agent_profile === "string" ? meta.agent_profile : "",
    model: typeof meta.model_id === "string" ? meta.model_id : "",
    messageCount: typeof meta.message_count === "number" ? meta.message_count : undefined,
  };
}

function localizedTimeAgo(value?: string): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return state.uiLanguage === "zh-CN" ? "刚刚" : "just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return state.uiLanguage === "zh-CN" ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return state.uiLanguage === "zh-CN" ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return state.uiLanguage === "zh-CN" ? `${days} 天前` : `${days}d ago`;
}

function renderContextSidebar(): void {
  const panelState = state.latestState;
  const used = panelState?.contextUsedTokens;
  const max = panelState?.contextMaxTokens ?? 0;
  const pct = panelState?.contextPct ?? (max && used !== undefined ? (used / max) * 100 : undefined);
  const hasUsage = used !== undefined;
  const zh = state.uiLanguage === "zh-CN";
  const contextEmpty = max
    ? zh
      ? `暂无上下文用量（最大 ${formatCount(max)} token）`
      : `No context usage reported yet (max ${formatCount(max)} tokens)`
    : zh
      ? "暂无上下文用量"
      : "No context usage reported yet";
  const branding = brandDisplay({
    uiBrand: panelState?.uiBrand,
    chrysCliVersion: panelState?.chrysCliVersion,
    agentName: panelState?.agentName,
    modelName: panelState?.modelName,
  });
  sidebarContent.append(
    el("div", { class: "context-title" }, zh ? "运行环境" : "Runtime"),
    el("div", { class: "token-grid runtime-grid" },
      el("span", {}, zh ? "产品" : "Product"), el("span", {}, branding.product),
      el("span", {}, zh ? "后端" : "Backend"), el("span", {}, branding.backend),
      el("span", {}, zh ? "智能体" : "Agent"), el("span", {}, panelState?.agentName || "—"),
      el("span", {}, zh ? "模型" : "Model"), el("span", {}, panelState?.modelName || (zh ? "默认" : "Default")),
    ),
    el("div", { class: "context-title" }, zh ? "上下文用量" : "Context Usage"),
    el("div", { class: "context-usage-line" }, hasUsage && max
      ? `${formatCount(used)} / ${formatCount(max)} (${(pct ?? 0).toFixed(1)}%)`
      : hasUsage
        ? `${formatCount(used)} token`
        : contextEmpty),
    el("div", { class: "context-usage-note" }, zh ? "ACP 最新上下文读数，可能包含后端估算；不是会话累计消耗。" : "Latest ACP context reading; may include backend estimates. Not cumulative spend."),
    renderUsageSparkline(),
    renderCompactionStatus(),
    el("div", { class: "context-title token-title" }, zh ? "会话累计消耗（含子智能体）" : "Session spend (including sub-agents)"),
    el("div", { class: "token-grid" },
      el("span", {}, zh ? "✓ 缓存" : "✓ Cached"), el("span", {}, tokenValueOrDash(panelState?.cacheHitTokens)),
      el("span", {}, zh ? "↑ 输入" : "↑ Input"), el("span", {}, tokenValueOrDash(panelState?.inputTokens)),
      el("span", {}, zh ? "↓ 输出" : "↓ Output"), el("span", {}, tokenValueOrDash(panelState?.outputTokens)),
      el("span", {}, zh ? "Σ 总计" : "Σ Total"), el("span", {}, tokenValueOrDash(panelState?.totalTokens)),
    ),
    el("div", { class: "context-title token-title" }, zh ? "主智能体最新读数（非整轮统计）" : "Latest main-agent reading (not a turn total)"),
    el("div", { class: "token-grid" },
      el("span", {}, zh ? "输入" : "Input"), el("span", {}, tokenValueOrDash(panelState?.latestInputTokens)),
      el("span", {}, zh ? "输出" : "Output"), el("span", {}, tokenValueOrDash(panelState?.latestOutputTokens)),
      el("span", {}, zh ? "缓存命中" : "Cache read"), el("span", {}, tokenValueOrDash(panelState?.latestCacheHitTokens)),
      el("span", {}, zh ? "本地估算" : "Local estimate"), el("span", {}, tokenValueOrDash(panelState?.localTokens)),
      el("span", {}, zh ? "校准系数" : "Calibration ratio"), el("span", {}, panelState?.calibrationRatio === undefined ? "—" : String(panelState.calibrationRatio)),
      el("span", {}, zh ? "系统开销估算" : "System overhead estimate"), el("span", {}, tokenValueOrDash(panelState?.systemOverheadTokens)),
    ),
    el("div", { class: "context-usage-note" }, zh ? "— 表示未上报，0 表示已上报零值。推理/缓存写入和逐轮统计请查看轨迹。" : "— means not reported; 0 is a reported zero. See Trajectory for reasoning/cache-write and per-turn usage."),
    el("button", { class: "secondary-btn", "data-command": "trajectory" }, zh ? "查看历史用量与轨迹" : "Historical usage & trajectory"),
    el("div", { class: "context-title capability-title" }, t("capabilities")),
    renderCapabilityDashboard(panelState),
    el("div", { class: "context-title compressed-title" }, zh ? "压缩历史" : "Compressed Messages"),
    el("div", { class: "compressed-box richlog" }, ...(panelState?.compressedMessages?.length
      ? panelState.compressedMessages.slice(-8).map((line, index) => el("div", { class: "richlog-row" },
        el("span", { class: "richlog-marker" }, `${index + 1}`),
        el("span", { class: "richlog-text" }, line),
      ))
      : [el("span", { class: "richlog-empty" }, zh ? "暂无压缩历史。" : "No compressed history yet.")])),
  );
}

function renderCapabilityDashboard(panelState: ChatPanelState | null): HTMLElement {
  const zh = state.uiLanguage === "zh-CN";
  const mcpTools = Object.values(panelState?.mcpTools ?? {}).reduce((count, names) => count + names.length, 0);
  const mcpFailures = Object.entries(panelState?.mcpFailures ?? {});
  const mcpServers = new Set([
    ...Object.keys(panelState?.mcpTools ?? {}),
    ...mcpFailures.map(([name]) => name),
  ]).size;
  const skills = panelState?.runtimeSkillNames ?? [];
  const memories = panelState?.memoryFiles ?? [];
  const subAgents = panelState?.subAgentToolNames ?? [];
  const visionLabel = panelState?.imageInputEnabled
    ? (zh ? "可用" : "available")
    : (zh ? "未启用" : "off");

  return el("div", { class: "capability-dashboard" },
    el("div", { class: "capability-grid" },
      capabilityMetric(String(panelState?.toolCount ?? 0), zh ? "工具" : "Tools"),
      capabilityMetric(String(skills.length), zh ? "技能" : "Skills"),
      capabilityMetric(String(memories.length), zh ? "记忆文件" : "Memory"),
      capabilityMetric(String(subAgents.length), zh ? "子智能体工具" : "Sub-agent tools"),
    ),
    el("div", { class: "capability-row" },
      el("span", { class: "capability-row-label" }, "MCP"),
      el("span", { class: mcpFailures.length ? "capability-warning" : "" },
        zh ? `${mcpServers} 个服务 · ${mcpTools} 个工具` : `${mcpServers} servers · ${mcpTools} tools`,
      ),
    ),
    el("div", { class: "capability-row" },
      el("span", { class: "capability-row-label" }, zh ? "图片输入" : "Images"),
      el("span", {}, visionLabel),
    ),
    ...(mcpFailures.length
      ? [el("div", { class: "capability-failures" },
        ...mcpFailures.map(([name, message]) => el("div", { class: "capability-failure", title: message }, `! ${name}: ${message}`)),
      )]
      : []),
    ...(skills.length
      ? [el("div", { class: "capability-chips" },
        ...skills.slice(0, 8).map((name) => el("span", { class: "capability-chip", title: name }, name)),
        ...(skills.length > 8 ? [el("span", { class: "capability-chip more" }, `+${skills.length - 8}`)] : []),
      )]
      : []),
  );
}

function capabilityMetric(value: string, label: string): HTMLElement {
  return el("div", { class: "capability-metric" },
    el("strong", {}, value),
    el("span", {}, label),
  );
}

function renderUsageSparkline(): HTMLElement {
  const maxPct = Math.max(100, ...state.usageHistory);
  return el("div", { class: "context-sparkline" },
    ...state.usageHistory.map((pct) => {
      const bar = el("span", { class: "context-spark" }, "");
      bar.style.height = `${Math.max(10, Math.min(100, (pct / maxPct) * 100))}%`;
      return bar;
    }),
  );
}

function addMessageDebugEvent(msg: ChatMessage, phase: "start" | "update"): void {
  if (msg.kind === "tool_call" && phase === "start") {
    addDebugEvent("ToolStart", msg.toolName || msg.toolCallId || "tool");
  } else if (msg.kind === "tool_call" && msg.toolStatus && msg.toolStatus !== "pending" && msg.toolStatus !== "in_progress") {
    addDebugEvent("ToolResult", `${msg.toolName || msg.toolCallId || "tool"}${msg.toolOutput ? ` (${msg.toolOutput.length} chars)` : ""}`);
  } else if (msg.kind === "agent" && phase === "start") {
    addDebugEvent("AgentMsg", msg.text ? `(${msg.text.length} chars)` : "(intermediate, 0 chars)");
  } else if (msg.kind === "user" && phase === "start") {
    addDebugEvent("UserMsg", `(${msg.text.length} chars)`);
  }
}

function addDebugEvent(kind: string, detail: string, relayToHost = true): void {
  state.debugEvents.push({ time: Date.now(), kind, detail });
  if (state.debugEvents.length > 200) {
    state.debugEvents.splice(0, state.debugEvents.length - 200);
  }
  scheduleDiagnosticsPersist();
  if (relayToHost) {
    vscode.postMessage({ type: "frontendDebugEvent", kind, detail });
  }
  if (activeSideTab() === "debug") {
    renderSideTab("debug");
  }
}

let diagnosticsPersistTimer: number | undefined;

/** Debug events arrive in bursts; persist them at most every 500 ms. */
function scheduleDiagnosticsPersist(): void {
  if (diagnosticsPersistTimer !== undefined) return;
  diagnosticsPersistTimer = window.setTimeout(() => {
    diagnosticsPersistTimer = undefined;
    persistWebviewDiagnosticsState();
  }, 500);
}

function persistWebviewDiagnosticsState(selectedTab = activeSideTab()): void {
  if (diagnosticsPersistTimer !== undefined) {
    window.clearTimeout(diagnosticsPersistTimer);
    diagnosticsPersistTimer = undefined;
  }
  vscode.setState({
    attachments: pendingAttachments,
    promptHistory: state.promptHistory.slice(-100),
    debugEvents: state.debugEvents.slice(-200),
    sidebarPreference,
    activeSideTab: selectedTab,
  });
}

function renderDebugSidebar(): void {
  const visibleDebugEvents = state.debugEvents.slice(-80);
  const header = el("div", { class: "context-title debug-title" },
    el("span", {}, t("eventStream")),
    el("span", { class: "debug-actions" },
      el("button", { class: "meta-link debug-icon-btn", "data-local-command": "copyDebugSnapshot", title: t("copySnapshot"), "aria-label": t("copySnapshot") },
        el("span", { class: "debug-icon", "aria-hidden": "true" }, "⧉"),
      ),
      el("button", { class: "meta-link debug-icon-btn", "data-command": "copySupportBundle", title: t("copySupportBundle"), "aria-label": t("copySupportBundle") },
        el("span", { class: "debug-icon", "aria-hidden": "true" }, "▤"),
      ),
    ),
  );
  sidebarContent.append(
    header,
    el("div", { class: "event-stream", role: "list", "aria-label": t("eventStream") },
      ...(visibleDebugEvents.length ? visibleDebugEvents.map((entry) => {
        const time = formatClock(entry.time);
        const label = debugEventLabel(entry.kind);
        return el("div", { class: "event-row", role: "listitem", title: `${time} ${label}: ${entry.detail}` },
          el("div", { class: "event-row-head" },
            el("span", { class: "event-time" }, time),
            el("span", { class: `event-kind event-${debugEventClass(entry.kind)}` }, label),
          ),
          el("span", { class: "event-detail" }, entry.detail || " "),
        );
      }) : [el("div", { class: "sidebar-empty" }, t("noEvents"))]),
    ),
  );
}

function debugEventClass(kind: string): string {
  const normalized = kind.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.includes("tool")) return "tool";
  if (normalized.includes("approval")) return "approval";
  if (normalized.includes("usage") || normalized.includes("context")) return "context";
  if (normalized.includes("agent")) return "agent";
  if (normalized.includes("user")) return "user";
  if (normalized.includes("state")) return "state";
  if (COMPANION_ENABLED && normalized.includes("companion")) return "companion";
  return "generic";
}

function debugEventLabel(kind: string): string {
  return kind
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/:/g, " ");
}

function sidebarPreview(message: ChatMessage): string {
  let text = "";
  if (message.text) text = message.text;
  else if (message.toolName) text = message.toolName;
  else text = message.toolCallId || "";
  // Collapse to single line, strip markdown noise
  return text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function sidebarMessageLabel(message: ChatMessage): string {
  const preview = sidebarPreview(message);
  return preview || (state.uiLanguage === "zh-CN" ? "（空消息）" : "(empty message)");
}

function renderSidebarMessage(message: ChatMessage, displayNumber: number): HTMLElement {
  const label = sidebarMessageLabel(message);
  const prefix = message.isInjection ? "└─" : `${message.turnNumber ?? displayNumber}.`;
  const ariaLabel = message.isInjection
    ? `${state.uiLanguage === "zh-CN" ? "注入消息" : "injected message"}: ${label}`
    : `${prefix} ${label}`;
  return el("div", { class: "sidebar-message-item", role: "listitem" },
    el("button", {
      class: `sidebar-message user${message.isInjection ? " injection" : ""}`,
      "data-message-id": message.id,
      "aria-label": ariaLabel,
      title: label,
    },
      el("span", { class: "sidebar-message-prefix", "aria-hidden": "true" }, prefix),
      el("span", { class: "sidebar-message-text" }, label),
    ),
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function showReconnect(): void {
  reconnectNotice.classList.remove("hidden");
  setTimeout(() => reconnectNotice.classList.add("hidden"), 3000);
}

// ──────────────────────────────────────────────
// Welcome animation
// ──────────────────────────────────────────────

function hideWelcome(): void {
  messageArea.querySelector(".welcome")?.remove();
  stopWelcomeAnimation();
}

function startWelcomeAnimation(): void {
  stopWelcomeAnimation();
  renderWelcomeLogo();
  const logo = messageArea.querySelector<HTMLElement>(".welcome-logo");
  if (!logo) return;
  logo.classList.remove("is-revealing");
  void logo.offsetWidth;
  logo.classList.add("is-revealing");
  welcomeTimer = window.setTimeout(() => {
    logo.classList.remove("is-revealing");
    welcomeTimer = undefined;
  }, 260);
}

function stopWelcomeAnimation(): void {
  if (welcomeTimer !== undefined) {
    window.clearTimeout(welcomeTimer);
    welcomeTimer = undefined;
  }
}

function renderWelcomeLogo(): void {
  const logo = messageArea.querySelector<HTMLElement>(".welcome-logo");
  if (!logo) return;
  const brand = UI_BRANDS[resolveUiBrand(state.latestState?.uiBrand)];
  logo.textContent = brand.name;
  const mark = messageArea.querySelector<HTMLElement>(".welcome-mark");
  if (mark) mark.textContent = brand.mark;
  const button = messageArea.querySelector<HTMLElement>(".welcome-brand");
  if (button) {
    const label = state.uiLanguage === "zh-CN" ? "选择品牌标识" : "Choose brand mark";
    button.title = label;
    button.setAttribute("aria-label", `${brand.name} · ${label}`);
  }
}

// ──────────────────────────────────────────────
// Command dispatch
// ──────────────────────────────────────────────

function postCommand(command: string | undefined, arg?: string): void {
  if (isHostCommand(command)) {
    if (isAgentBusy() && BUSY_DISABLED_HOST_COMMANDS.has(command)) {
      showHostCommandDisabledWhileRunning(command);
      return;
    }
    showLocalNotice(commandNotice(command, arg));
    vscode.postMessage({ type: "command", command, arg });
  }
}

function isHostCommand(command: string | undefined): command is ChatCommand {
  return command !== undefined && HOST_COMMANDS.has(command as ChatCommand);
}

function commandNotice(command: string, arg?: string): string {
  const value = arg?.trim();
  switch (command) {
    case "manageModels":
      return t("openingModels");
    case "setModelProfile":
      return t("openingModelPicker");
    case "showAgentProfiles":
    case "switchAgent":
    case "manageAgents":
      return t("openingAgents");
    case "showSessions":
      return t("openingSessions");
    case "showLogs":
      return t("openingLogs");
    case "diagnostics":
      return t("openingDiagnostics");
    case "doctor":
      return t("openingDoctor");
    case "copySupportBundle":
      return t("openingSupportBundle");
    case "showStructuredHistory":
      return t("openingSessionJson");
    case "showDiff":
      return t("openingDiff");
    case "rollback":
      return t("openingRollback");
    case "changeWorkspace":
      return t("openingWorkspace");
    case "reloadSettings":
      return t("openingSettings");
    case "setApprovalMode":
      return t("openingApproval");
    case "runtimeTools":
      return t("openingTools");
    case "runtimeFiles":
    case "insertFileMention":
      return t("openingFiles");
    case "searchWorkspace":
      return state.uiLanguage === "zh-CN"
        ? `正在打开搜索${value ? `：${value}` : "..."}`
        : `Opening search${value ? `: ${value}` : "..."}`;
    case "grepWorkspace":
      return state.uiLanguage === "zh-CN"
        ? `正在检索${value ? `：${value}` : "..."}`
        : `Searching${value ? `: ${value}` : "..."}`;
    case "findWorkspaceFile":
      return state.uiLanguage === "zh-CN"
        ? `正在查找文件${value ? `：${value}` : "..."}`
        : `Finding file${value ? `: ${value}` : "..."}`;
    case "openShell":
      return t("openingShell");
    case "manage":
      return t("openingManagement");
    default:
      return t("runningCommand");
  }
}

function showLocalNotice(text: string): void {
  reconnectNotice.textContent = text;
  reconnectNotice.classList.remove("hidden");
  setTimeout(() => {
    reconnectNotice.classList.add("hidden");
    reconnectNotice.textContent = t("reconnecting");
  }, 1200);
}

function imageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  const files: File[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length) return files;
  return Array.from(dataTransfer.files ?? []).filter((file) => file.type.startsWith("image/"));
}

async function attachImageFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  if (state.latestState?.imageInputEnabled !== true) {
    addDebugEvent("ImageAttachBlocked", "active model profile does not support image input");
    showImageUnsupportedDialog();
    return;
  }
  const generation = imagePreparationGeneration;
  const preparationItems = files.map((file, index) => ({
    id: nextImagePreparationId++,
    name: file.name || "pasted-image",
    originalBytes: file.size,
    phase: "reading" as ImagePreparationPhase,
    index: index + 1,
    total: files.length,
  }));
  imagePreparationItems.push(...preparationItems);
  syncPreparingImageCount();
  renderPendingImages();
  updateComposerState();
  showLocalNotice(t("preparingImages"));
  addDebugEvent("ImagePreparationStarted", `${files.length} image(s)`);
  let attached = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const preparationItem = preparationItems[index];
    try {
      const image = await prepareImageFile(file, (phase) => {
        if (generation !== imagePreparationGeneration) return;
        preparationItem.phase = phase;
        renderPendingImages();
        updateComposerState();
      });
      if (generation !== imagePreparationGeneration) return;
      pendingImages.push(image);
      addDebugEvent("ImageAttached", `${image.name} (${image.bytes}/${image.originalBytes} bytes)`);
      if (image.compressed) {
        addDebugEvent("ImageCompressed", `${image.name} ${formatPendingImageBytes(image.originalBytes)} -> ${formatPendingImageBytes(image.bytes)}`);
      }
      attached += 1;
    } catch (error) {
      if (generation !== imagePreparationGeneration) return;
      const detail = error instanceof Error ? error.message : String(error);
      addDebugEvent("ImageAttachFailed", `${file.name || "image"}: ${detail}`);
      showLocalNotice(`${t("imageTooLarge")} ${file.name || ""}`.trim());
    } finally {
      if (generation === imagePreparationGeneration) {
        imagePreparationItems = imagePreparationItems.filter((item) => item.id !== preparationItem.id);
        syncPreparingImageCount();
        renderPendingImages();
        updateComposerState();
      }
    }
  }
  if (generation === imagePreparationGeneration && attached > 0) {
    showLocalNotice(`${t("imageAttached")} ${attached}`);
    addDebugEvent("ImagePreparationFinished", `${attached}/${files.length} image(s) attached`);
  }
}

function renderPendingImages(): void {
  attachmentTray.innerHTML = "";
  attachmentTray.classList.toggle("hidden", pendingImages.length === 0 && pendingAttachments.length === 0 && preparingImageCount === 0);
  attachmentTray.setAttribute("role", "status");
  attachmentTray.setAttribute("aria-live", "polite");
  attachmentTray.title = attachmentTraySummary();
  for (const item of imagePreparationItems.slice(0, 3)) {
    attachmentTray.append(el("div", { class: `attachment-chip attachment-chip-preparing attachment-chip-${item.phase}`, title: imagePreparationMeta(item) },
      el("span", { class: "attachment-chip-spinner", "aria-hidden": "true" }, ""),
      el("span", { class: "attachment-chip-text" },
        el("span", { class: "attachment-chip-name", title: item.name }, item.name),
        el("span", { class: "attachment-chip-meta" }, imagePreparationMeta(item)),
      ),
    ));
  }
  if (imagePreparationItems.length > 3) {
    attachmentTray.append(el("div", { class: "attachment-chip attachment-chip-preparing attachment-chip-overflow" },
      el("span", { class: "attachment-chip-spinner", "aria-hidden": "true" }, ""),
      el("span", { class: "attachment-chip-text" },
        el("span", { class: "attachment-chip-name" }, t("preparingImages")),
        el("span", { class: "attachment-chip-meta" }, `${t("imagePreparingMeta")} ${imagePreparationItems.length - 3}`),
      ),
    ));
  }
  attachmentTray.append(...pendingAttachments.map((item,index)=>el("div",{class:"attachment-chip",title:item.text.slice(0,2000)},el("span",{class:"attachment-chip-name"},item.label),el("button",{type:"button",class:"attachment-chip-remove","data-remove-context":String(index),"aria-label":`${state.uiLanguage==="zh-CN"?"移除":"Remove"} ${item.label}`},"×"))));
  attachmentTray.append(...pendingImages.map((image, index) => {
    const meta = [image.mimeType, imageSizeMeta(image), image.compressed ? t("imageCompressed") : ""]
      .filter(Boolean)
      .join(" · ");
    return el("div", { class: "attachment-chip", title: `${image.name} · ${meta}` },
      el("img", {
        src: imageDataUri(image.mimeType, image.data),
        alt: image.name,
      }),
      el("span", { class: "attachment-chip-text", title: image.name },
        el("span", { class: "attachment-chip-name" }, image.name),
        el("span", { class: "attachment-chip-meta" }, meta),
      ),
      el("button", {
        class: "attachment-chip-remove",
        "data-remove-image-index": String(index),
        title: t("removeImage"),
      }, "×"),
    );
  }));
  recordImageInputState();
}

function syncPreparingImageCount(): void {
  preparingImageCount = imagePreparationItems.length;
}

function clearPendingImages(): void {
  pendingImages = [];
  imagePreparationItems = [];
  preparingImageCount = 0;
  imagePreparationGeneration += 1;
  renderPendingImages();
  updateComposerState();
}

function recordImageInputState(): void {
  const detail = `pending=${pendingImages.length}; preparing=${preparingImageCount}; enabled=${state.latestState?.imageInputEnabled === true ? "yes" : "no"}; session=${state.currentSessionState}`;
  if (detail === lastImageInputStateEvent) return;
  lastImageInputStateEvent = detail;
  addDebugEvent("ImageInputState", detail);
}

function imagePreparationMeta(item: ImagePreparationItem): string {
  const phase = item.phase === "compressing" ? t("imageCompressingMeta") : t("imageReadingMeta");
  const position = item.total > 1 ? `${item.index}/${item.total} · ` : "";
  return `${position}${phase} · ${formatPendingImageBytes(item.originalBytes)}`;
}

function attachmentTraySummary(): string {
  const parts = [];
  if (preparingImageCount) parts.push(`${t("preparingImages")} ${preparingImageCount}`);
  if (pendingImages.length) parts.push(`${t("imageAttached")} ${pendingImages.length}`);
  return parts.join(" · ");
}

function imageSizeMeta(image: PendingImage): string {
  if (!image.compressed) return formatPendingImageBytes(image.bytes);
  return `${formatPendingImageBytes(image.bytes)} ← ${formatPendingImageBytes(image.originalBytes)}`;
}

function showImageUnsupportedDialog(): void {
  showLocalNotice(t("imageUnsupported"));
  setInlineDialogState({
    kind: "notice",
    title: t("imageUnsupportedTitle"),
    subtitle: "",
    body: t("imageUnsupportedBody"),
  }, inlineDialog, vscode);
}

function formatPendingImageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

async function prepareImageFile(file: File, onPhase?: (phase: ImagePreparationPhase) => void): Promise<PendingImage> {
  onPhase?.("reading");
  if (file.size <= MAX_IMAGE_BYTES) {
    const dataUrl = await readFileAsDataUrl(file);
    const { data, mimeType } = dataUrlToImageBlock(dataUrl);
    return {
      data,
      mimeType,
      name: file.name || "pasted-image",
      originalBytes: file.size,
      bytes: file.size,
      compressed: false,
    };
  }
  onPhase?.("compressing");
  const compressed = await compressImageFile(file);
  if (compressed.bytes > MAX_IMAGE_BYTES) {
    throw new Error(`compressed image still exceeds ${MAX_IMAGE_BYTES} bytes`);
  }
  return compressed;
}

async function compressImageFile(file: File): Promise<PendingImage> {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadHtmlImage(dataUrl);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  let scale = Math.min(1, 2048 / Math.max(1, longestSide));
  let quality = 0.86;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob.size <= MAX_IMAGE_BYTES || attempt === 11) {
      const compressedUrl = await readFileAsDataUrl(blob);
      const { data, mimeType } = dataUrlToImageBlock(compressedUrl);
      return {
        data,
        mimeType,
        name: file.name ? file.name.replace(/\.[^.]+$/, ".jpg") : "pasted-image.jpg",
        originalBytes: file.size,
        bytes: blob.size,
        compressed: true,
      };
    }
    if (quality > 0.52) {
      quality -= 0.1;
    } else {
      scale *= 0.78;
      quality = 0.82;
    }
  }

  throw new Error("compression failed");
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("failed to read image"));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("failed to decode image"));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("failed to encode image"));
    }, mimeType, quality);
  });
}

function dataUrlToImageBlock(dataUrl: string): { data: string; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("invalid image data URL");
  return { mimeType: match[1], data: match[2] };
}

function insertComposerText(text: string): void {
  const current = inputField.value;
  const start = inputField.selectionStart ?? current.length;
  const end = inputField.selectionEnd ?? current.length;
  const insert = start === 0 || /\s/.test(current[start - 1] ?? "") ? text : ` ${text}`;
  inputField.value = `${current.slice(0, start)}${insert}${current.slice(end)}`;
  const next = start + insert.length;
  inputField.setSelectionRange(next, next);
  inputField.focus();
  state.localSubmitPending = false;
  autoResizeInput();
  updateComposerState();
  updateSlashHelp();
}

function replaceComposerSelection(text: string): void {
  const current = inputField.value;
  const start = inputField.selectionStart ?? current.length;
  const end = inputField.selectionEnd ?? current.length;
  inputField.value = `${current.slice(0, start)}${text}${current.slice(end)}`;
  const next = start + text.length;
  inputField.setSelectionRange(next, next);
  inputField.focus();
  state.localSubmitPending = false;
  autoResizeInput();
  updateComposerState();
  updateSlashHelp();
}

function handleComposerTextPaste(text: string): boolean {
  const mentionText = convertPastedImagePathsToMentions(text);
  if (mentionText) {
    insertComposerText(mentionText);
    addDebugEvent("ImagePathMentioned", mentionText.trim());
    showLocalNotice(t("imagePathMentioned"));
    return true;
  }
  const sanitized = sanitizePromptPaste(text);
  if (sanitized.text === text && !text.includes("\r")) return false;
  replaceComposerSelection(sanitized.text);
  if (sanitized.truncated) {
    addDebugEvent("PasteTruncated", `${sanitized.originalEstimatedTokens} -> ${sanitized.maxEstimatedTokens} estimated tokens`);
    showLocalNotice(state.uiLanguage === "zh-CN"
      ? `${t("pasteTruncated")}：约 ${formatCount(sanitized.originalEstimatedTokens)} -> ${formatCount(sanitized.maxEstimatedTokens)} tokens`
      : `${t("pasteTruncated")}: about ${formatCount(sanitized.originalEstimatedTokens)} -> ${formatCount(sanitized.maxEstimatedTokens)} tokens`);
  }
  return true;
}

function imagePathMentionTextFromDataTransfer(data: DataTransfer | null): string {
  const candidates = [
    data?.getData("text/plain") || "",
    data?.getData("text/uri-list") || "",
  ];
  return candidates.find((text) => Boolean(text && convertPastedImagePathsToMentions(text))) || "";
}

function insertTrigger(trigger: string): void {
  if (!trigger) return;
  const current = inputField.value;
  const start = inputField.selectionStart ?? current.length;
  const end = inputField.selectionEnd ?? current.length;
  const prefix = start === 0 || /\s/.test(current[start - 1] ?? "") ? "" : " ";
  const insert = `${prefix}${trigger}`;
  inputField.value = `${current.slice(0, start)}${insert}${current.slice(end)}`;
  const next = start + insert.length;
  inputField.setSelectionRange(next, next);
  inputField.focus();
  autoResizeInput();
  updateSlashHelp();
}

function slashCommand(text: string): SlashCommand | null {
  const match = /^[/／]([^\s/／]+)(?:\s+(.*))?$/.exec(text.trim());
  if (!match) return null;
  const commandName = match[1].toLowerCase();
  const arg = match[2]?.trim();
  const definition = findSlashDefinition(commandName);
  if (!definition) return null;
  return slashAction(definition, arg);
}

function findSlashDefinition(commandName: string): SlashDefinition | undefined {
  return SLASH_DEFINITIONS.find((definition) => slashDefinitionNames(definition).includes(commandName));
}

function slashDefinitionFromText(text: string): SlashDefinition | undefined {
  const match = /^[/／]([^\s/／]+)(?:\s|$)/.exec(text.trim());
  return match ? findSlashDefinition(match[1].toLowerCase()) : undefined;
}

function slashDefinitionNames(definition: SlashDefinition): string[] {
  return [...definition.names, ...(definition.zhNames ?? [])].map((name) => name.toLowerCase());
}

function slashDisplayName(definition: SlashDefinition): string {
  return state.uiLanguage === "zh-CN" ? definition.zhNames?.[0] ?? definition.names[0] : definition.names[0];
}

function slashAliasNames(definition: SlashDefinition): string[] {
  const primary = slashDisplayName(definition).toLowerCase();
  return [...definition.names, ...(definition.zhNames ?? [])].filter((name) => name.toLowerCase() !== primary);
}

function isAgentBusy(): boolean {
  return state.currentSessionState === "running" || state.currentSessionState === "cancelling";
}

function isSlashDisabledWhileRunning(text: string): boolean {
  const definition = slashDefinitionFromText(text);
  return Boolean(definition && isAgentBusy() && !definition.allowWhileRunning);
}

function showSlashDisabledWhileRunning(text: string): void {
  const definition = slashDefinitionFromText(text);
  const name = definition ? `/${definition.names[0]}` : text.split(/\s+/, 1)[0];
  showLocalNotice(state.uiLanguage === "zh-CN"
    ? `${name} 在 agent 运行时不可用。请先中断或等待当前任务完成。`
    : `${name} is not available while the agent is running. Interrupt or wait for the current task to finish.`);
}

function showShellDisabledWhileRunning(): void {
  addDebugEvent("ShellBlocked", state.currentSessionState || "running");
  showLocalNotice(state.uiLanguage === "zh-CN"
    ? "! 终端模式在 agent 运行时不可用。请先中断或等待当前任务完成。"
    : "! shell mode is not available while the agent is running. Interrupt or wait for the current task to finish.");
}

function showAgentSwitchDisabledWhileRunning(): void {
  showLocalNotice(state.uiLanguage === "zh-CN"
    ? "# 智能体切换在 agent 运行时不可用。请先中断或等待当前任务完成。"
    : "# agent switching is not available while the agent is running. Interrupt or wait for the current task to finish.");
}

function showModelSwitchDisabledWhileRunning(): void {
  showLocalNotice(state.uiLanguage === "zh-CN"
    ? "模型切换在 agent 运行时不可用。请先中断或等待当前任务完成。"
    : "Model switching is not available while the agent is running. Interrupt or wait for the current task to finish.");
}

function showHostCommandDisabledWhileRunning(command: ChatCommand): void {
  if (command === "switchAgent" || command === "selectAgent") {
    showAgentSwitchDisabledWhileRunning();
    return;
  }
  if (command === "setModelProfile") {
    showModelSwitchDisabledWhileRunning();
    return;
  }
  if (command === "openShell") {
    showShellDisabledWhileRunning();
    return;
  }
  const definition = SLASH_DEFINITIONS.find((entry) => entry.action.kind === "host" && entry.action.command === command);
  const label = definition ? `/${definition.names[0]}` : command;
  showLocalNotice(state.uiLanguage === "zh-CN"
    ? `${label} 在 agent 运行时不可用。请先中断或等待当前任务完成。`
    : `${label} is not available while the agent is running. Interrupt or wait for the current task to finish.`);
}

function runtimeSkillNames(): string[] {
  const names = state.latestState?.runtimeSkillNames ?? [];
  return names.filter((name) => name && !findSlashDefinition(name.toLowerCase()));
}

function runtimeSkillNameFromPrompt(text: string): string | null {
  const match = /^[/／]([^\s/／]+)(?:\s|$)/.exec(text.trim());
  return match ? match[1] : null;
}

function isRuntimeSkillPrompt(text: string): boolean {
  const name = runtimeSkillNameFromPrompt(text);
  if (!name) return false;
  return runtimeSkillNames().some((skillName) => skillName.toLowerCase() === name.toLowerCase());
}

function slashAction(definition: SlashDefinition, arg?: string): SlashCommand {
  if (definition.action.kind === "host" && definition.action.command === "setApprovalMode" && !arg) {
    return { kind: "host", command: "setApprovalMode", arg: "__cycle" };
  }
  if (definition.action.kind === "host") {
    return { kind: "host", command: definition.action.command, arg: definition.action.arg ?? (arg || undefined) };
  }
  return { kind: "local", command: definition.action.command, arg: arg || undefined };
}

function isSlashCommandText(text: string): boolean {
  return /^[/／]/.test(text.trimStart());
}

function updateSlashHelp(): void {
  const value = inputField.value.trimStart();
  if (!isSlashCommandText(value)) {
    slashHelp.classList.add("hidden");
    return;
  }
  const suggestions = slashSuggestions(value);
  slashHelp.innerHTML = "";
  slashHelp.append(...suggestions.map(renderSlashSuggestion));
  slashHelp.classList.remove("hidden");
}

function slashSuggestions(value: string): SlashSuggestion[] {
  const parsed = /^[/／]([^\s/／]*)(?:\s+(.*))?$/.exec(value);
  const namePart = (parsed?.[1] || "").toLowerCase();
  const argPart = parsed?.[2]?.trim().toLowerCase();
  const exact = namePart ? findSlashDefinition(namePart) : undefined;
  const argSuggestions = exact ? slashArgSuggestions(exact) : undefined;
  if (exact && argSuggestions && value.includes(" ")) {
    const displayName = slashDisplayName(exact);
    const matches = argSuggestions
      .filter((suggestion) => {
        if (!argPart) return true;
        const haystack = [
          suggestion.value,
          suggestion.label,
          suggestion.description,
          localizedArgLabel(suggestion),
          localizedArgDescription(suggestion),
        ].join(" ").toLowerCase();
        return haystack.includes(argPart);
      })
      .slice(0, 8);
    return matches.map((suggestion) => ({
      label: `/${displayName} ${localizedArgLabel(suggestion)}`,
      description: localizedArgDescription(suggestion),
      commandText: `/${displayName} ${suggestion.value}`,
      disabled: isAgentBusy() && !exact.allowWhileRunning,
    }));
  }

  const searchable = namePart;
  const matches = SLASH_DEFINITIONS
    .filter((definition) => {
      if (!searchable) return true;
      const haystack = `${slashDefinitionNames(definition).join(" ")} ${slashTitle(definition)} ${slashDescription(definition)}`.toLowerCase();
      return haystack.includes(searchable);
    })
    .slice(0, 12);
  const commandMatches = matches.map((definition) => {
      const primary = slashDisplayName(definition);
      const suffix = definition.argHint ? ` ${definition.argHint}` : "";
      const commandText = `/${primary}`;
      return {
        label: `/${primary}${suffix}`,
        description: slashDescription(definition),
        commandText,
        action: definition.action,
        insertText: definition.argHint && !slashArgSuggestions(definition) ? `${commandText} ` : undefined,
        disabled: isAgentBusy() && !definition.allowWhileRunning,
      };
    });
  const skillMatches = runtimeSkillNames()
    .filter((name) => !searchable || name.toLowerCase().includes(searchable))
    .slice(0, Math.max(0, 12 - commandMatches.length))
    .map((name) => ({
      label: `/${name}`,
      description: state.uiLanguage === "zh-CN" ? "运行时技能" : "Runtime skill",
      commandText: `/${name}`,
      insertText: `/${name} `,
    }));
  if (commandMatches.length || skillMatches.length) {
    return [...commandMatches, ...skillMatches];
  }
  return [{
    label: state.uiLanguage === "zh-CN" ? "没有匹配的 iCode 命令" : "No matching iCode command",
    description: state.uiLanguage === "zh-CN" ? "输入 /帮助 浏览全部命令" : "Type /help to browse all commands",
    commandText: state.uiLanguage === "zh-CN" ? "/帮助" : "/help",
    insertText: state.uiLanguage === "zh-CN" ? "/帮助" : "/help",
  }];
}

function slashArgSuggestions(definition: SlashDefinition): SlashArgSuggestion[] | undefined {
  if (definition.names.includes("man") || definition.names.includes("help")) {
    return commandHelpArgSuggestions();
  }
  return definition.argSuggestions;
}

function commandHelpArgSuggestions(): SlashArgSuggestion[] {
  return SLASH_DEFINITIONS.map((definition) => {
    const primary = slashDisplayName(definition);
    return {
      value: primary,
      label: primary,
      description: slashDescription(definition),
    };
  });
}

function slashTitle(definition: SlashDefinition): string {
  return state.uiLanguage === "zh-CN"
    ? (SLASH_ZH[definition.names[0]]?.title ?? definition.title)
    : definition.title;
}

function slashDescription(definition: SlashDefinition): string {
  return state.uiLanguage === "zh-CN"
    ? (SLASH_ZH[definition.names[0]]?.description ?? definition.description)
    : definition.description;
}

function localizedArgDescription(suggestion: SlashArgSuggestion): string {
  if (state.uiLanguage !== "zh-CN") return suggestion.description;
  if (suggestion.value === "auto" && suggestion.description.includes("CHRYS_THEME")) {
    return "跟随支持的 CHRYS_THEME；否则使用 iCode 深色主题";
  }
  if ((SUPPORTED_UI_THEME_IDS as readonly string[]).includes(suggestion.value)) {
    return suggestion.value.startsWith("chrys") ? "iCode TUI 主题" : "Textual TUI 主题";
  }
  const labels: Record<string, string> = {
    manual: "需要权限的工具由我手动批准",
    auto: "由 iCode 帮我判断并批准工具调用",
    bypass: "允许工具调用，不再提示批准",
    models: "模型配置",
    agents: "智能体配置",
    tools: "工具配置",
    skills: "技能目录",
    mcp: "MCP 服务器",
    memory: "记忆设置",
    compaction: "上下文压缩",
    chrys: "iCode 深色主题",
    "chrys-ansi": "iCode ANSI 主题",
    dracula: "Textual Dracula 主题",
    monokai: "Textual Monokai 主题",
    "tokyo-night": "Textual Tokyo Night 主题",
    nord: "Textual Nord 主题",
    "textual-dark": "Textual 深色主题",
    "textual-light": "Textual 浅色主题",
  };
  return labels[suggestion.value] ?? suggestion.description;
}

function localizedArgLabel(suggestion: SlashArgSuggestion): string {
  if (state.uiLanguage !== "zh-CN") return suggestion.label;
  if (suggestion.value === "auto" && suggestion.description.includes("CHRYS_THEME")) return "自动";
  const labels: Record<string, string> = {
    manual: "手动批准",
    auto: "帮我批准",
    bypass: "完全访问",
  };
  return labels[suggestion.value] ?? suggestion.label;
}

function renderSlashSuggestion(suggestion: SlashSuggestion): HTMLElement {
  const button = el("button", {
    class: `slash-item ${suggestion.disabled ? "disabled" : ""}`,
    "data-command-text": suggestion.commandText,
    ...(suggestion.disabled ? { disabled: "true", title: state.uiLanguage === "zh-CN" ? "agent 运行时不可用" : "Unavailable while the agent is running" } : {}),
    ...(suggestion.insertText ? { "data-insert-text": suggestion.insertText } : {}),
  },
    el("span", { class: "slash-command" }, suggestion.label),
    el("span", { class: "slash-description" }, suggestion.description),
  );
  return button;
}

// ──────────────────────────────────────────────
// Composer state
// ──────────────────────────────────────────────

function setComposer(text: string, restore = false): void {
  // A queued injection still owns its disabled draft; an editable new draft belongs to the user.
  const emptyDraft = inputField.value.length === 0 && !state.isComposingText
    && !pendingImages.length && !pendingAttachments.length && !preparingImageCount;
  const mayReplace = !restore || state.queuedInjectionPending || emptyDraft;
  state.localSubmitPending = false;
  state.queuedInjectionPending = false;
  inputField.disabled = false;
  if (mayReplace) {
    clearPendingImages();
    if (inputField.value !== text) inputField.value = text;
  }
  updateComposerState();
  if (mayReplace) inputField.focus();
  autoResizeInput();
}

function lockComposerForQueuedInjection(): void {
  state.queuedInjectionPending = true;
  inputField.disabled = true;
  updateComposerState();
}

// ──────────────────────────────────────────────
// Local commands
// ──────────────────────────────────────────────

function runLocalCommand(command: string | undefined, arg?: string): void {
  switch (command) {
    case "copyLast":
      copyConversation(arg);
      break;
    case "copyDebugSnapshot":
      copyDebugSnapshot();
      break;
    case "foldTools":
      toggleToolDetails();
      break;
    case "toggleSidebar":
      toggleSidebar();
      break;
    case "pickTheme":
      openThemeDialog(arg);
      break;
    case "notifications":
      openNotificationsNotice();
      break;
    case "startSlashCommand":
      startSlashCommand();
      break;
    case "showHelp":
      openCommandHelp(arg);
      break;
    case "companionWip":
      openBuddyWipNotice();
      break;
  }
}

function startSlashCommand(): void {
  addDebugEvent("ComposerHint", "/ Commands");
  setComposer("/");
  updateSlashHelp();
}

function openBuddyWipNotice(): void {
  addDebugEvent("BuddyWip", "Buddy surface is disabled in this VSIX build");
  setInlineDialogState({
    kind: "notice",
    title: "Buddy",
    subtitle: state.uiLanguage === "zh-CN" ? "伴侣界面暂未启用" : "Companion surface is not enabled yet",
    body: state.uiLanguage === "zh-CN"
      ? "VSIX 仅保留 Buddy 的禁用前端占位；当前发布先聚焦 coding-agent 主工作流，等待 iCode ACP 提供受支持的 Buddy API 后再恢复。"
      : "The VSIX keeps only a disabled Buddy frontend placeholder; this release is focused on the coding-agent workflow until iCode ACP exposes a supported Buddy API.",
  }, inlineDialog, vscode);
}

function openThemeDialog(arg?: string): void {
  showLocalNotice(t("openingTheme"));
  vscode.postMessage({ type: "command", command: "pickTheme", arg });
}

function openNotificationsNotice(): void {
  const events = state.debugEvents.slice(-20);
  const body = events.length
    ? events.map((e) => `[${e.kind}] ${e.detail}`).join("\n")
    : t("noEventsBody");
  setInlineDialogState({
    kind: "notice",
    title: t("notificationsTitle"),
    subtitle: t("notificationsSubtitle"),
    body,
  }, inlineDialog, vscode);
}

function copyDebugSnapshot(): void {
  const panelState = state.latestState;
  const toolMessages = state.messages.filter((message) => message.kind === "tool_call" || message.kind === "tool_result");
  const snapshot = {
    generatedAt: new Date().toISOString(),
    uiLanguage: state.uiLanguage,
    session: {
      id: panelState?.sessionId || "",
      state: state.currentSessionState,
      workspacePath: panelState?.workspacePath || "",
      agentName: panelState?.agentName || state.currentAgentName,
      modelName: panelState?.modelName || "",
      approvalMode: panelState?.approvalMode || "",
    },
    context: {
      usageText: panelState?.usageText || "",
      usedTokens: panelState?.contextUsedTokens,
      maxTokens: panelState?.contextMaxTokens,
      pct: panelState?.contextPct,
      inputTokens: panelState?.inputTokens,
      outputTokens: panelState?.outputTokens,
      totalTokens: panelState?.totalTokens,
    },
    frontend: {
      messages: state.messages.length,
      toolMessages: toolMessages.length,
      pendingImages: pendingImages.length,
      preparingImages: preparingImageCount,
      imagePreparationItems: imagePreparationItems.map((item) => ({
        name: item.name,
        phase: item.phase,
        originalBytes: item.originalBytes,
        index: item.index,
        total: item.total,
      })),
      queuedInjectionPending: state.queuedInjectionPending,
      activeToolGroupSize: state.activeToolGroup?.ids.length ?? 0,
    },
    toolRendererCoverage: toolRendererCoverage(toolMessages.map((message) => ({
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      kind: message.toolKind,
      status: message.toolStatus,
      hasInput: message.toolInput !== undefined,
      hasOutput: Boolean(message.toolOutput),
    }))),
    recentMessages: state.messages.slice(-12).map((message) => ({
      kind: message.kind,
      id: message.id,
      turnNumber: message.turnNumber,
      toolName: message.toolName,
      toolKind: message.toolKind,
      toolStatus: message.toolStatus,
      textLength: message.text?.length ?? 0,
      hasOutput: Boolean(message.toolOutput),
      imageAttachments: message.imageAttachments?.length ?? 0,
    })),
    debugEvents: state.debugEvents.slice(-120),
  };
  navigator.clipboard?.writeText(JSON.stringify(snapshot, null, 2)).then(
    () => showLocalNotice(t("debugSnapshotCopied")),
    () => showLocalNotice(t("copyFailed")),
  );
}

function copyCurrentSessionId(): void {
  const sessionId = state.latestState?.sessionId || "";
  if (!sessionId) {
    showLocalNotice(t("nothingToCopy"));
    return;
  }
  const write = navigator.clipboard?.writeText(sessionId);
  if (write === undefined) {
    showLocalNotice(t("copyFailed"));
    return;
  }
  write.then(
    () => {
      showLocalNotice(t("sessionCopied"));
      addDebugEvent("SessionIdCopied", shortSessionId(sessionId));
    },
    () => showLocalNotice(t("copyFailed")),
  );
}

function openCommandHelp(arg?: string): void {
  const command = arg?.trim().replace(/^[/／]/, "");
  const definition = command ? findSlashDefinition(command.toLowerCase()) : undefined;
  setInlineDialogState({
    kind: "notice",
    title: command ? commandHelpDialogTitle(command) : t("commandHelpTitle"),
    subtitle: t("commandHelpSubtitle"),
    body: command
      ? (definition
        ? commandHelpBody(definition)
        : `${t("noHelpEntry")} /${command}.`)
      : commandListHelpBody(),
  }, inlineDialog, vscode);
}

function commandHelpDialogTitle(command: string): string {
  return state.uiLanguage === "zh-CN" ? `帮助：/${command}` : `Help: /${command}`;
}

function commandManualTitle(): string {
  return state.uiLanguage === "zh-CN" ? "iCode 命令手册" : "iCode Commands Manual";
}

function commandListHelpBody(): string {
  const heading = state.uiLanguage === "zh-CN" ? "可用命令" : "Available Commands";
  const workflowHeading = state.uiLanguage === "zh-CN" ? "Coding Workflow 速查" : "Coding Workflow Quickstart";
  const shortcutsHeading = state.uiLanguage === "zh-CN" ? "快捷键" : "Keyboard Shortcuts";
  const seeAlso = state.uiLanguage === "zh-CN"
    ? "另见\n    /帮助 <command>  查看某个命令的详细帮助"
    : "See Also\n    /man <command>  Show detailed help for a specific command";
  const lines = SLASH_DEFINITIONS.map((definition) => {
    const primaryName = slashDisplayName(definition);
    const primary = `/${primaryName}${definition.argHint ? ` ${definition.argHint}` : ""}`;
    const aliases = slashAliasNames(definition);
    const aliasText = aliases.length ? ` (${state.uiLanguage === "zh-CN" ? "别名" : "aliases"}: ${aliases.map((name) => `/${name}`).join(", ")})` : "";
    return `    ${primary.padEnd(34)} ${slashDescription(definition)}${aliasText}`;
  });
  return [commandManualTitle(), "", workflowHeading, ...codingWorkflowHelpLines(), "", heading, ...lines, "", shortcutsHeading, ...shortcutHelpLines(), "", seeAlso].join("\n");
}

function codingWorkflowHelpLines(): string[] {
  return state.uiLanguage === "zh-CN"
    ? [
        "    /搜索 <query>        在 VS Code Search 中搜索当前工作区",
        "    /检索 <query>        查看匹配行，支持复制或插入输入框",
        "    /打开 <file>         按文件名打开工作区文件",
        "    @ 文件               从输入框引用文件",
        "    ! 命令 或 /终端       打开工作区终端或运行命令",
        "    /差异 /回滚          查看或回滚会话文件变更",
        "    /复制 tools          复制工具执行摘要",
        "    /支持                复制 VSIX/TUI 不一致排查快照",
      ]
    : [
        "    /search <query>      Search the current workspace in VS Code Search",
        "    /grep <query>        Show matching lines; copy or insert them into the composer",
        "    /open <file>         Open a workspace file by name",
        "    @ file               Mention a file from the composer",
        "    ! cmd or /shell      Open the workspace terminal or run a command",
        "    /diff /rollback      Inspect or roll back session file changes",
        "    /copy tools          Copy tool execution summaries",
        "    /support             Copy a VSIX/TUI mismatch support bundle",
      ];
}

function shortcutHelpLines(): string[] {
  return TUI_SHORTCUT_HELP.map((shortcut) => {
    const description = state.uiLanguage === "zh-CN" ? shortcut.zh : shortcut.en;
    return `    ${shortcut.key.padEnd(10)} ${description}`;
  });
}

function commandHelpBody(definition: SlashDefinition): string {
  const labels = state.uiLanguage === "zh-CN"
    ? {
        name: "名称",
        synopsis: "用法",
        description: "说明",
        aliases: "别名",
        options: "选项",
        none: "无",
        noOptions: "此命令没有额外选项。",
        examples: "示例",
        noExamples: "此命令没有示例。",
      }
    : {
        name: "Name",
        synopsis: "Synopsis",
        description: "Description",
        aliases: "Aliases",
        options: "Options",
        none: "none",
        noOptions: "This command does not take additional options.",
        examples: "Examples",
        noExamples: "This command does not have examples.",
      };
  const primaryName = slashDisplayName(definition);
  const synopsis = `/${primaryName}${definition.argHint ? ` ${definition.argHint}` : ""}`;
  const aliases = slashAliasNames(definition);
  const aliasText = aliases.length ? aliases.map((name) => `/${name}`).join(", ") : labels.none;
  const argSuggestions = slashArgSuggestions(definition);
  const options = argSuggestions?.length
    ? argSuggestions.map((suggestion) => {
      const label = state.uiLanguage === "zh-CN"
        ? `${localizedArgLabel(suggestion)} (${suggestion.value})`
        : localizedArgLabel(suggestion);
      return `    ${label.padEnd(16)} ${localizedArgDescription(suggestion)}`;
    }).join("\n")
    : `    ${labels.noOptions}`;
  const examples = state.uiLanguage === "zh-CN"
    ? definition.zhExamples ?? definition.examples ?? []
    : definition.examples ?? [];
  const exampleText = examples.length
    ? examples.map((example) => `    ${example}`).join("\n")
    : `    ${labels.noExamples}`;
  return [
    commandManualTitle(),
    "",
    labels.name,
    `    /${primaryName} - ${slashDescription(definition)}`,
    "",
    labels.synopsis,
    `    ${synopsis}`,
    "",
    labels.description,
    `    ${slashDescription(definition)}`,
    "",
    labels.aliases,
    `    ${aliasText}`,
    "",
    labels.options,
    options,
    "",
    labels.examples,
    exampleText,
  ].join("\n");
}

function copyConversation(arg?: string): void {
  const selection = copySelection(arg);
  if (!selection) {
    showLocalNotice(t("nothingToCopy"));
    return;
  }
  navigator.clipboard?.writeText(selection).then(
    () => showLocalNotice(t("copied")),
    () => showLocalNotice(t("copyFailed")),
  );
}

function copyMessageById(messageId: string): void {
  const message = state.messages.find((candidate) => candidate.id === messageId);
  if (!message) {
    showLocalNotice(t("nothingToCopy"));
    return;
  }
  if (isToolMessage(message) && message.toolCallId) {
    copyToolExecution(message.toolCallId);
    addDebugEvent("RightClickCopyMessage", `${message.kind}:${message.toolName || message.toolCallId}`);
    return;
  }
  const transcript = formatCopyMessage(message);
  if (!transcript.trim()) {
    showLocalNotice(t("nothingToCopy"));
    return;
  }
  navigator.clipboard?.writeText(transcript).then(
    () => {
      showLocalNotice(t("copied"));
      addDebugEvent("RightClickCopyMessage", `${message.kind}:${transcript.length} chars`);
    },
    () => showLocalNotice(t("copyFailed")),
  );
}

function copySelection(arg?: string): string | null {
  const parsed = parseCopyArguments(arg || "");
  if (!parsed) return null;
  const entries = state.messages
    .filter((message) => copyTargetMatches(message, parsed.target))
    .map(formatCopyEntry)
    .filter((entry): entry is string => Boolean(entry?.trim()));
  if (!entries.length) return null;
  const selected = parsed.count === undefined ? entries : entries.slice(-Math.min(parsed.count, entries.length));
  return selected.join("\n\n") || null;
}

type CopyTarget = "agent" | "user" | "tools" | "thoughts" | "errors" | "all";

function parseCopyArguments(arg: string): { target: CopyTarget; count?: number } | null {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { target: "agent", count: 1 };
  const parseCount = (value: string): number | null => {
    if (!/^\d+$/.test(value)) return null;
    const count = Number.parseInt(value, 10);
    return count > 0 ? count : null;
  };
  const normalizeTarget = (value: string): CopyTarget | null => {
    const normalized = value.toLowerCase();
    if (normalized === "agent" || normalized === "assistant") return "agent";
    if (normalized === "user" || normalized === "you") return "user";
    if (normalized === "tool" || normalized === "tools") return "tools";
    if (normalized === "thought" || normalized === "thoughts") return "thoughts";
    if (normalized === "error" || normalized === "errors") return "errors";
    if (normalized === "all") return "all";
    return null;
  };
  const first = parts[0].toLowerCase();
  if (first === "all") return parts.length === 1 ? { target: "all" } : null;
  const target = normalizeTarget(first);
  if (target) {
    if (parts.length === 1) return { target, count: target === "all" ? undefined : 1 };
    if (parts.length !== 2) return null;
    const second = parts[1].toLowerCase();
    if (second === "all") return { target };
    const count = parseCount(second);
    return count === null ? null : { target, count };
  }
  if (parts.length === 1) {
    const count = parseCount(first);
    return count === null ? null : { target: "agent", count };
  }
  return null;
}

function copyTargetMatches(message: ChatMessage, target: CopyTarget): boolean {
  if (target === "all") return message.kind !== "separator" && Boolean(formatCopyEntry(message)?.trim());
  if (target === "tools") return isToolMessage(message) && Boolean(message.toolCallId);
  if (target === "thoughts") return message.kind === "thought" && Boolean(message.text.trim());
  if (target === "errors") return (message.kind === "error" || message.kind === "interrupted") && Boolean(message.text.trim());
  return message.kind === target && Boolean(message.text.trim());
}

function formatCopyEntry(message: ChatMessage): string | null {
  if (isToolMessage(message)) {
    return message.toolCallId ? formatToolExecution(message.toolCallId) : null;
  }
  if (!message.text.trim()) return null;
  return formatCopyMessage(message);
}

function formatCopyMessage(message: ChatMessage): string {
  const role = copyMessageRole(message);
  return `[${role}]\n${message.text}`;
}

function copyMessageRole(message: ChatMessage): string {
  if (message.kind === "user") return state.uiLanguage === "zh-CN" ? "你" : "You";
  if (message.kind === "agent") return state.currentAgentName || "Agent";
  if (message.kind === "thought") return state.uiLanguage === "zh-CN" ? "思考" : "Thought";
  if (message.kind === "error") return state.uiLanguage === "zh-CN" ? "错误" : "Error";
  if (message.kind === "interrupted") return state.uiLanguage === "zh-CN" ? "中断" : "Interrupted";
  if (message.kind === "system") return "System";
  if (message.kind === "separator") return state.uiLanguage === "zh-CN" ? "分隔" : "Separator";
  return state.uiLanguage === "zh-CN" ? "消息" : "Message";
}

function copyToolExecution(toolCallId: string): void {
  const message = [...state.messages].reverse().find((candidate) => candidate.toolCallId === toolCallId);
  const transcript = formatToolExecution(toolCallId);
  if (!message || !transcript) {
    showLocalNotice(t("toolNotFound"));
    return;
  }
  const toolName = message.toolName || toolCallId;
  navigator.clipboard?.writeText(transcript).then(
    () => {
      showLocalNotice(t("copied"));
      addDebugEvent("ToolCopied", `${toolName}:${transcript.length} chars`);
      const button = messageArea.querySelector<HTMLElement>(`[data-copy-tool-id="${toolCallId}"]`);
      if (button) {
        const original = button.textContent;
        button.textContent = t("copied");
        button.classList.add("copied-flash");
        setTimeout(() => {
          button.textContent = original;
          button.classList.remove("copied-flash");
        }, 2000);
      }
    },
    () => showLocalNotice(t("copyFailed")),
  );
}

function formatToolExecution(toolCallId: string): string | null {
  const message = [...state.messages].reverse().find((candidate) => candidate.toolCallId === toolCallId);
  if (!message) {
    return null;
  }
  const toolName = message.toolName || toolCallId;
  const toolKind = message.toolKind || "unknown";
  const toolStatus = message.toolStatus || "unknown";
  const toolInput = formatJson(message.toolInput) || "{}";
  const toolOutput = message.toolOutput || t("noToolOutput");
  const panelState = state.latestState;
  const lines = [
    `# ${toolName}`,
    "",
    `- **Status:** \`${toolStatus}\``,
    `- **Kind:** \`${toolKind}\``,
    `- **Call ID:** \`${toolCallId}\``,
    `- **Message ID:** \`${message.id}\``,
    `- **Timestamp:** \`${new Date(message.timestamp).toISOString()}\``,
    `- **Agent:** ${panelState?.agentName || state.currentAgentName || "(unknown)"}`,
    `- **Model:** ${panelState?.modelName || "(unknown)"}`,
    `- **Session:** ${panelState?.sessionId || "(none)"}`,
    `- **Workspace:** ${panelState?.workspacePath || "(unknown)"}`,
    `- **UI language:** ${state.uiLanguage}`,
  ];
  if (message.subAgentPaused) lines.push("- **Sub-agent paused:** `true`");
  if (message.subAgentRetryAttempts !== undefined) {
    lines.push(`- **Sub-agent retry attempts:** \`${message.subAgentRetryAttempts}\``);
  }
  if (message.subAgentLastError) {
    lines.push(`- **Sub-agent last error:** ${message.subAgentLastError}`);
  }
  lines.push("", "## Input", fencedBlock("json", toolInput), "", "## Output", fencedBlock("text", toolOutput));
  if (message.innerToolCalls?.length) {
    lines.push("", "## Inner Tools");
    for (const tool of message.innerToolCalls) {
      const duration = tool.durationMs === undefined ? "" : ` · ${formatDurationMs(tool.durationMs)}`;
      lines.push(`- \`${tool.status}\` ${tool.toolName}${duration}`);
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

function fencedBlock(language: string, text: string): string {
  const ticks = text.includes("```") ? "````" : "```";
  return `${ticks}${language}\n${text || t("noToolOutput")}\n${ticks}`;
}

function openToolView(toolCallId: string): void {
  const message = [...state.messages].reverse().find((candidate) => candidate.toolCallId === toolCallId);
  if (!message) {
    showLocalNotice(t("toolNotFound"));
    return;
  }
  const toolName = message.toolName || toolCallId;
  const toolKind = message.toolKind || "unknown";
  const toolStatus = message.toolStatus || "unknown";
  const input = formatJson(message.toolInput) || "{}";
  const output = message.toolOutput || t("noToolOutput");
  const innerTools = message.innerToolCalls ?? [];
  const panelState = state.latestState;
  const innerToolLines = innerTools.map((tool) => [
    tool.status,
    tool.toolName,
    tool.durationMs === undefined ? "" : formatDurationMs(tool.durationMs),
  ].filter(Boolean).join(" · "));
  const metaLines = [
    `Tool: ${toolName}`,
    `Kind: ${toolKind}`,
    `Status: ${toolStatus}`,
    `Call ID: ${toolCallId}`,
    `Message ID: ${message.id}`,
    `Timestamp: ${formatClock(message.timestamp)}`,
    `Agent: ${panelState?.agentName || state.currentAgentName || "(unknown)"}`,
    `Model: ${panelState?.modelName || "(unknown)"}`,
    `Session: ${panelState?.sessionId || "(none)"}`,
    `Workspace: ${panelState?.workspacePath || "(unknown)"}`,
    `UI language: ${state.uiLanguage}`,
    message.subAgentPaused ? `Sub-agent paused: true` : "",
    message.subAgentLastError ? `Sub-agent last error: ${message.subAgentLastError}` : "",
    message.subAgentRetryAttempts !== undefined ? `Sub-agent retry attempts: ${message.subAgentRetryAttempts}` : "",
  ].filter(Boolean);
  setInlineDialogState({
    kind: "runtimeDetails",
    title: state.uiLanguage === "zh-CN" ? "工具详情" : "Tool Details",
    subtitle: toolName,
    tabs: [
      {
        id: "input",
        label: state.uiLanguage === "zh-CN" ? "输入" : "Input",
        sections: [{ title: state.uiLanguage === "zh-CN" ? "输入" : "Input", lines: [input] }],
      },
      {
        id: "output",
        label: state.uiLanguage === "zh-CN" ? "输出" : "Output",
        sections: [{ title: state.uiLanguage === "zh-CN" ? "输出" : "Output", lines: [output] }],
      },
      {
        id: "meta",
        label: state.uiLanguage === "zh-CN" ? "元数据" : "Meta",
        sections: [
          { title: state.uiLanguage === "zh-CN" ? "工具" : "Tool", lines: metaLines },
          ...(innerToolLines.length
            ? [{ title: state.uiLanguage === "zh-CN" ? "内部工具" : "Inner Tools", lines: innerToolLines }]
            : []),
        ],
      },
    ],
  }, inlineDialog, vscode);
  addDebugEvent("ToolViewed", `${toolName}:${toolCallId}`);
}

function toggleToolDetails(): void {
  const details = [...messageArea.querySelectorAll<HTMLDetailsElement>(".tool-card-body, .tool-group")];
  const agentBubbles = [...messageArea.querySelectorAll<HTMLElement>(".bubble.agent")];
  const hasExpandedTools = details.some((detail) => detail.open);
  const hasExpandedAgent = agentBubbles.some((bubble) => !bubble.classList.contains("agent-folded"));
  const shouldCollapse = hasExpandedTools || hasExpandedAgent;
  for (const detail of details) {
    detail.open = !shouldCollapse;
  }
  for (const bubble of agentBubbles) {
    bubble.classList.toggle("agent-folded", shouldCollapse);
  }
  refreshFoldedLabels();
  addDebugEvent("Fold", shouldCollapse ? "Folded" : "Unfolded");
}

function toggleSidebar(): void {
  const nextOpen = sidebar.classList.contains("hidden");
  setSidebarOpen(nextOpen, nextOpen ? "open" : "closed");
  addDebugEvent("Sidebar", nextOpen ? "visible" : "hidden");
}

function setSidebarOpen(open: boolean, preference?: SidebarPreference): void {
  if (preference) sidebarPreference = preference;
  sidebar.classList.toggle("hidden", !open);
  syncSidebarPresentation();
  if (preference) persistWebviewDiagnosticsState();
}

function syncSidebarPresentation(): void {
  const open = !sidebar.classList.contains("hidden");
  const drawer = window.innerWidth <= SIDEBAR_DRAWER_BREAKPOINT;
  sidebarScrim.classList.toggle("hidden", !open || !drawer);
  workbench.classList.toggle("sidebar-open", open);
  workbench.classList.toggle("sidebar-drawer", drawer);
  sidebarToggleButton.classList.toggle("active", open);
  sidebar.setAttribute("aria-hidden", open ? "false" : "true");
  sidebarToggleButton.setAttribute("aria-expanded", open ? "true" : "false");
  sidebarToggleButton.title = open ? t("hideSidebar") : t("showSidebar");
  sidebarToggleButton.setAttribute("aria-label", open ? t("hideSidebar") : t("showSidebar"));
  const label = sidebarToggleButton.querySelector<HTMLElement>(".sidebar-toggle-label");
  if (label) label.textContent = open ? t("hideSidebar") : t("sidebar");
  if (!open && sidebar.contains(document.activeElement)) sidebarToggleButton.focus();
}

function autoResizeInput(): void {
  inputField.style.height = "auto";
  inputField.style.height = `${Math.min(inputField.scrollHeight, 140)}px`;
}

function clearComposer(): void {
  clearPendingImages();
  inputField.value = "";
  updateComposerState();
  autoResizeInput();
}

/** Attachments are persisted only when they change, not on every keystroke. */
let persistedAttachmentsRef: unknown = null;
let persistedAttachmentsLength = -1;

function updateComposerState(): void {
  if (pendingAttachments !== persistedAttachmentsRef || pendingAttachments.length !== persistedAttachmentsLength) {
    persistedAttachmentsRef = pendingAttachments;
    persistedAttachmentsLength = pendingAttachments.length;
    const saved = (vscode.getState() ?? {}) as Record<string,unknown>;
    vscode.setState({...saved,attachments:pendingAttachments});
  }
  vscode.postMessage({ type: "composerDraft", text: inputField.value });
  inputBar.classList.toggle("has-text", inputField.value.length > 0 || pendingImages.length > 0 || pendingAttachments.length > 0 || preparingImageCount > 0);
  updateSendButtonState();
}

function updateSendButtonState(): void {
  const hasText = inputField.value.trim().length > 0 || pendingImages.length > 0 || pendingAttachments.length > 0;
  const isBusy = state.currentSessionState !== "idle";
  const runtimeReady = connectionReady(state.latestState);
  sendBtn.disabled = !runtimeReady || preparingImageCount > 0 || state.queuedInjectionPending || (!hasText && !isBusy);
  sendBtn.textContent = runningSendButtonLabel(hasText);
  sendBtn.classList.toggle("stop-btn", isBusy && !hasText);
  sendBtn.classList.toggle("queued-btn", state.queuedInjectionPending);
  inputBar.classList.toggle("is-busy", isBusy);
  inputBar.classList.toggle("is-queued", state.queuedInjectionPending);
  inputBar.classList.toggle("is-cancelling", state.currentSessionState === "cancelling");
}

function runningSendButtonLabel(hasText: boolean): string {
  if (state.queuedInjectionPending) return t("queued");
  if (state.currentSessionState === "idle") return t("send");
  if (hasText) return t("queueMessage");
  if (state.currentSessionState === "cancelling") return t("continue");
  return t("interrupt");
}

// ──────────────────────────────────────────────
// Webview → host message types
// ──────────────────────────────────────────────


function renderCompactionStatus(): HTMLElement | "" {
  const active = state.latestState?.activeCompactionCount ?? 0;
  const committed = state.latestState?.committedCompactionCount ?? 0;
  if (!active && !committed) return "";
  const parts = state.uiLanguage === "zh-CN"
    ? [
        active ? `正在压缩上下文：${active}` : "",
        committed ? `已提交的子智能体压缩：${committed}` : "",
      ]
    : [
        active ? `Compacting context: ${active}` : "",
        committed ? `Committed sub-agent compactions: ${committed}` : "",
      ];
  const text = parts.filter(Boolean).join(" · ");
  return el("div", { class: "compaction-status" }, text);
}

function dismissSlashHelp(): boolean {
  const wasVisible = !slashHelp.classList.contains("hidden");
  slashHelp.classList.add("hidden");
  return wasVisible;
}

// Announce readiness only after all module state has been initialized.
vscode.postMessage({ type: "webviewReady" });
