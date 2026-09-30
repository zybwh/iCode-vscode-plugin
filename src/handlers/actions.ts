import { rememberPrompt } from "../session/promptHistory";
import { showPromptHistory } from "../ui/promptHistory";
import * as vscode from "vscode";
import { rt } from "../state/runtime";
import { nextMessageId } from "../chat/provider";
import { logInfo, logWarn, logError } from "../common/logging";
import { chatPanelState } from "../common/chatPanelState";
import { applyPreferredDefaultsToNewSession } from "../session/defaults";
import { awardCompanionActiveMinutes, awardCompanionUsageEvent, handleCompanionCommand, handleCompanionDirectAddress } from "./companion";
import { resolveUiLanguage } from "../common/i18n";
import {
  openSessionsDialog,
  openAgentsDialog,
  openRuntimeDialog,
  openLogsDialog,
  searchWorkspace,
  grepWorkspace,
  findWorkspaceFile,
  showSessionDiff,
  rollbackSession,
  retryPausedSubAgent,
  abortPausedSubAgent,
  setApprovalMode,
  showModelProfiles,
  reloadChrysSettings,
  changeWorkspace,
  showStructuredHistory,
  openModelDialog,
  openAgentDialog,
  createModelProfile,
  deleteModelProfile,
  deleteAgentProfile,
  testMcpServer,
  setConfigOption,
  attachFileToComposer,
  insertFileMention,
  openWorkspaceShell,
  resumeLastSession,
  switchActiveAgent,
  managementTabFromArg,
  showDiagnosticsReport,
  copySupportBundle,
  runDoctor,
} from "../ui/dialogs";
import { showManagementPanel } from "../ui/management";
import type { ContentBlock } from "../acp/types";
import type { ChatCommand } from "../chat/panel";

// ──────────────────────────────────────────────
// Send message
// ──────────────────────────────────────────────

export async function handleSendMessage(text: string, blocks: ContentBlock[]): Promise<void> {
  if (rt.tabInitialization) await rt.tabInitialization;
  if (rt.connectionInitialization) await rt.connectionInitialization;
  if (!text.trim().startsWith("/") && !blocks.some((block) => block.type === "image") && handleCompanionDirectAddress(text)) {
    return;
  }
  if (!rt.sessionManager || !rt.chatPanel) {
    const message = uiText(
      "iCode runtime is not connected yet. Open Doctor to check the binary, workspace, and ACP process.",
      "iCode 运行时尚未连接。请打开健康检查，确认可执行文件、工作区和 ACP 进程状态。",
    );
    rt.chatPanel?.setComposer(text);
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "error",
      text: `Error: ${message}`,
      timestamp: Date.now(),
    });
    rt.chatPanel?.setState(chatPanelState());
    await showActionUnavailable("PromptUnavailable", "sendMessage", message);
    return;
  }
  logInfo(`Sending prompt (${text.length} chars) in state ${rt.sessionManager.state}.`);
  const sessionManager = rt.sessionManager;

  if (!(await ensureActiveSessionForPrompt(text)) || rt.sessionManager !== sessionManager) {
    return;
  }
  if (rt.extensionContext?.workspaceState && rt.currentCwd) {
    void rememberPrompt(rt.extensionContext.workspaceState, rt.currentCwd, text).catch(error => logWarn(`Could not save prompt history: ${String(error)}`));
  }
  const sessionId = rt.currentSessionId;
  let promptTurn: number | null = null;
  const ownsTurn = () => rt.sessionManager === sessionManager
    && rt.currentSessionId === sessionId
    && (promptTurn === null || sessionManager.turn === promptTurn);

  if (rt.sessionManager.state === "running" || rt.sessionManager.state === "cancelling") {
    logInfo("Queueing prompt as a mid-run injection.");
    try {
      await sessionManager.inject(text);
    } catch (err) {
      if (!ownsTurn()) return;
      const msg = err instanceof Error ? err.message : String(err);
      logError(`Injection failed: ${msg}`);
      rt.chatPanel?.setComposer(text);
      rt.transcript.appendMessage({
        id: nextMessageId(),
        kind: "error",
        text: `Error: failed to queue message\n${msg}`,
        timestamp: Date.now(),
      });
    }
    if (ownsTurn()) rt.chatPanel?.setState(chatPanelState());
    return;
  }

  rt.resetRenderState();
  rt.activeTurnErrorReceived = false;
  rt.pendingUserEchoText = text;
  rt.pendingUserEchoMessageId = nextMessageId();

  const messageBlocks = blocks;
  rt.transcript.appendMessage({
    id: rt.pendingUserEchoMessageId,
    kind: "user",
    text,
    imageAttachments: imageAttachmentsFromBlocks(blocks),
    timestamp: Date.now(),
  });

  rt.chatPanel?.setState({ ...chatPanelState(), sessionState: "running" });
  rt.notifySessionState('running');
  const turnStartedAtMs = Date.now();

  try {
    const prompt = sessionManager.sendPrompt(messageBlocks);
    promptTurn = sessionManager.turn;
    await prompt;
    if (ownsTurn()) awardCompanionUsageEvent("turn_completed");
    logInfo("Prompt request completed.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`Prompt request failed: ${msg}`);
    if (!ownsTurn()) return;
    if (rt.pendingUserEchoMessageId) {
      rt.transcript.removeMessage(rt.pendingUserEchoMessageId);
    }
    if (!rt.activeTurnErrorReceived) {
      rt.transcript.appendMessage({
        id: nextMessageId(),
        kind: "error",
        text: `Error: ${msg}`,
        timestamp: Date.now(),
      });
    }
    rt.activeTurnErrorReceived = true;
  } finally {
    if (ownsTurn()) {
      awardCompanionActiveMinutes(turnStartedAtMs);
      rt.pendingUserEchoText = null;
      rt.pendingUserEchoMessageId = null;
      rt.chatPanel?.setState({ ...chatPanelState(), sessionState: "idle" });
      rt.notifySessionState('idle');
    }
  }
}

export async function ensureActiveSessionForPrompt(text: string): Promise<boolean> {
  if (!rt.sessionManager || !rt.chatPanel) return false;
  const sessionManager = rt.sessionManager;
  if (rt.sessionManager.sessionId) {
    if (!rt.currentSessionId) {
      rt.currentSessionId = rt.sessionManager.sessionId;
      rt.persistCurrentSession();
      rt.chatPanel?.setState(chatPanelState());
    }
    return true;
  }
  if (rt.sessionInitialization) {
    try {
      logInfo("Waiting for session initialization before sending prompt.");
      rt.chatPanel?.appendDebugEvent("SessionInitializationWait", "prompt send");
      await rt.sessionInitialization;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`Session initialization failed before prompt: ${message}`);
      rt.chatPanel?.appendDebugEvent("SessionInitializationFailed", message);
    }
    if (rt.sessionManager !== sessionManager) return false;
    if (rt.sessionManager.sessionId) {
      if (!rt.currentSessionId) rt.currentSessionId = rt.sessionManager.sessionId;
      rt.chatPanel?.appendDebugEvent("SessionInitializationReady", rt.currentSessionId ?? rt.sessionManager.sessionId);
      return true;
    }
  }
  if (rt.sessionManager.state !== "idle") {
    rt.chatPanel?.setComposer(text);
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "separator",
      text: "iCode is still starting. Please send again once the session is ready.",
      timestamp: Date.now(),
    });
    rt.chatPanel?.setState(chatPanelState());
    return false;
  }
  if (!rt.currentCwd) {
    rt.chatPanel?.setComposer(text);
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "error",
      text: "Error: No workspace directory is available for a new iCode session.",
      timestamp: Date.now(),
    });
    return false;
  }
  try {
    logInfo("Creating a new session before sending prompt.");
    rt.chatPanel?.appendDebugEvent("SessionNewStarted", `lazy prompt @ ${rt.currentCwd}`);
    const sessionId = await sessionManager.newSession(rt.currentCwd, rt.additionalDirectories);
    if (rt.sessionManager !== sessionManager) return false;
    rt.currentSessionId = sessionId;
    await applyPreferredDefaultsToNewSession();
    rt.persistCurrentSession();
    rt.chatPanel?.setState(chatPanelState());
    rt.chatPanel?.appendDebugEvent("SessionNewSucceeded", rt.currentSessionId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Failed to create session before prompt: ${message}`);
    rt.chatPanel?.appendDebugEvent("SessionNewFailed", message);
    rt.chatPanel?.setComposer(text);
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "error",
      text: `Error: failed to create session\n${message}`,
      timestamp: Date.now(),
    });
    rt.chatPanel?.setState(chatPanelState());
    return false;
  }
}

function imageAttachmentsFromBlocks(blocks: ContentBlock[]): NonNullable<import("../chat/provider").ChatMessage["imageAttachments"]> {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: "image" }> => block.type === "image")
    .map((block, index) => {
      const meta = block._meta && typeof block._meta === "object" ? block._meta : {};
      const name = typeof meta.name === "string" && meta.name ? meta.name : `image-${index + 1}`;
      const bytes = typeof meta.bytes === "number" ? meta.bytes : undefined;
      const originalBytes = typeof meta.originalBytes === "number" ? meta.originalBytes : undefined;
      const compressed = typeof meta.compressed === "boolean" ? meta.compressed : undefined;
      return {
        name,
        mimeType: block.mimeType,
        data: block.data,
        bytes,
        originalBytes,
        compressed,
      };
    });
}

// ──────────────────────────────────────────────
// Cancel / Retry
// ──────────────────────────────────────────────

export async function handleCancel(): Promise<void> {
  if (!rt.sessionManager || !rt.chatPanel) {
    await showActionUnavailable(
      "CancelUnavailable",
      "cancel",
      uiText("iCode cannot cancel until the ACP runtime is connected.", "需要连接 iCode ACP 运行时后才能取消。"),
    );
    return;
  }
  rt.askUserHandler?.cancelActive("session-cancelled");
  rt.chatPanel?.setState({ ...chatPanelState(), sessionState: "cancelling" });
  await rt.sessionManager.cancel();
  markRunningToolsCancelled();
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "interrupted",
    text: "Execution interrupted.",
    timestamp: Date.now(),
  });
  rt.chatPanel?.setState(chatPanelState());
  rt.notifySessionState('idle');
}

export function markRunningToolsCancelled(): void {
  for (const [toolCallId, messageId] of rt.toolMessageIds.entries()) {
    const snapshot = rt.toolSnapshots.get(toolCallId);
    if (!snapshot || snapshot.status === "completed" || snapshot.status === "failed") continue;
    snapshot.status = "failed";
    rt.transcript.updateMessage(messageId, {
      toolStatus: "failed",
      toolOutput: "cancelled",
    });
  }
}

// ──────────────────────────────────────────────
// Webview command dispatch
// ──────────────────────────────────────────────

export async function handleWebviewCommand(command: ChatCommand, arg?: string): Promise<void> {
  rt.chatPanel?.appendDebugEvent("CommandRequested", commandDebugLabel(command, arg));
  try {
    await dispatchWebviewCommand(command, arg);
  } catch (err) {
    await showCommandFailure(command, err);
  }
}

async function dispatchWebviewCommand(command: ChatCommand, arg?: string): Promise<void> {
  switch (command) {
    case "newSession":
      await vscode.commands.executeCommand("chrys.newSession");
      break;
    case "resumeLastSession":
      await resumeLastSession();
      break;
    case "showSessions":
      await openSessionsDialog();
      break;
    case "renameSession": {
      const { renameSessionLocally } = await import("../ui/sessionName");
      await renameSessionLocally(rt.currentSessionId, arg);
      break;
    }
    case "showPromptHistory":
      await showPromptHistory();
      break;
    case "clearChat":
      if (rt.sessionManager?.state && rt.sessionManager.state !== "idle") {
        vscode.window.showInformationMessage(uiText("Wait for the current task to finish before clearing the display.", "请等待当前任务结束后再清空显示。"));
        return;
      }
      rt.transcript.clearMessages();
      rt.transcript.appendMessage({
        id: nextMessageId(), kind: "separator", timestamp: Date.now(),
        text: uiText("Display cleared. Session context and saved history are unchanged. Use /new to start with a fresh context.", "显示已清空，会话上下文和保存的历史仍保留。若要从新上下文开始，请使用 /new。"),
      });
      rt.chatPanel?.appendDebugEvent("ChatCleared", "visible chat");
      rt.chatPanel?.setState(chatPanelState());
      break;
    case "closeChat":
      rt.chatPanel?.appendDebugEvent("ChatPanelClosed", "slash command");
      rt.chatPanel?.dispose();
      break;
    case "attachFile":
      await attachFileToComposer(arg);
      break;
    case "insertFileMention":
      await insertFileMention(arg);
      break;
    case "trajectory":
      await vscode.commands.executeCommand("chrys.trajectory");
      break;
    case "workflows":
      await vscode.commands.executeCommand("chrys.workflows");
      break;
    case "openShell":
      openWorkspaceShell(arg);
      break;
    case "runtimeFiles":
      await openRuntimeDialog("files");
      break;
    case "searchWorkspace":
      await searchWorkspace(arg);
      break;
    case "grepWorkspace":
      await grepWorkspace(arg);
      break;
    case "findWorkspaceFile":
      await findWorkspaceFile(arg);
      break;
    case "showLogs":
      openLogsDialog();
      break;
    case "runtimeDetails":
      await openRuntimeDialog();
      break;
    case "runtimeTools":
      await openRuntimeDialog("tools");
      break;
    case "selectAgent":
      await openAgentsDialog();
      break;
    case "showDiff":
      await showSessionDiff();
      break;
    case "rollback":
      await rollbackSession(arg);
      break;
    case "retrySubAgent":
      await retryPausedSubAgent();
      break;
    case "abortSubAgent":
      await abortPausedSubAgent();
      break;
    case "setApprovalMode":
      await setApprovalMode(arg);
      break;
    case "switchAgent":
      await switchActiveAgent(arg);
      break;
    case "showAgentProfiles":
      await openAgentsDialog();
      break;
    case "showModelProfiles":
      await showModelProfiles();
      break;
    case "reloadSettings":
      await reloadChrysSettings();
      break;
    case "changeWorkspace":
      await changeWorkspace(arg);
      break;
    case "showStructuredHistory":
      await showStructuredHistory();
      break;
    case "setModelProfile":
      await openModelDialog();
      break;
    case "createModelProfile":
      await createModelProfile();
      break;
    case "deleteModelProfile":
      await deleteModelProfile();
      break;
    case "deleteAgentProfile":
      await deleteAgentProfile();
      break;
    case "testMcpServer":
      await testMcpServer();
      break;
    case "setConfigOption":
      await setConfigOption();
      break;
    case "manage":
      await showManagementPanel(managementTabFromArg(arg));
      break;
    case "manageModels":
      await openModelDialog();
      break;
    case "manageAgents":
      await openAgentDialog();
      break;
    case "diagnostics":
      await showDiagnosticsReport();
      break;
    case "copySupportBundle":
      await copySupportBundle();
      break;
    case "doctor":
      await runDoctor();
      break;
    case "companionCommand":
      rt.chatPanel?.appendDebugEvent("Companion", arg || "open");
      await handleCompanionCommand(arg);
      break;
    case "summonCompanion": {
      const { summonCompanion } = await import("../companion/store");
      rt.currentCompanion = summonCompanion({ workspaceDir: rt.currentCwd ?? undefined });
      rt.chatPanel?.appendDebugEvent("CompanionSummon", rt.currentCompanion.activeCard?.card.name ?? "none");
      rt.chatPanel?.setState(chatPanelState({ companion: rt.currentCompanion }));
      break;
    }
    case "pickBrand": {
      const { pickUiBrand } = await import("../ui/branding");
      await pickUiBrand();
      break;
    }
    case "pickTheme": {
      const { pickThemeFromList } = await import("../ui/dialogs");
      await pickThemeFromList(arg);
      break;
    }
  }
}

// ──────────────────────────────────────────────
// Sleep skip
// ──────────────────────────────────────────────

export async function handleSleepSkip(toolCallId: string): Promise<void> {
  if (!toolCallId) return;
  if (!rt.sessionManager && rt.connectionInitialization) await rt.connectionInitialization;
  if (!rt.sessionManager) {
    await showActionUnavailable(
      "SleepSkipUnavailable",
      "skipSleep",
      uiText("iCode cannot skip sleep until the ACP runtime is connected.", "需要连接 iCode ACP 运行时后才能跳过等待。"),
    );
    return;
  }
  await rt.sessionManager.skipSleep(toolCallId);
  rt.chatPanel?.appendDebugEvent("SleepSkip", toolCallId);
}

function uiText(en: string, zh: string): string {
  const language = resolveUiLanguage(vscode.workspace.getConfiguration("chrys").get<string>("ui.language"), vscode.env.language);
  return language === "zh-CN" ? zh : en;
}

async function showActionUnavailable(eventName: string, actionName: string, message: string): Promise<void> {
  rt.chatPanel?.appendDebugEvent(eventName, actionName);
  logWarn(`${actionName} unavailable: ${message}`);
  const openDoctor = uiText("Open Doctor", "打开健康检查");
  const selected = await vscode.window.showWarningMessage(message, openDoctor);
  if (selected === openDoctor) {
    await vscode.commands.executeCommand("chrys.doctor");
  }
}

async function showCommandFailure(command: ChatCommand, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const label = commandDebugLabel(command);
  rt.chatPanel?.appendDebugEvent("CommandFailed", `${label}: ${message}`);
  logError(`Command ${label} failed: ${message}`);
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "error",
    text: `Error: ${label} failed\n${message}`,
    timestamp: Date.now(),
  });
  const openDoctor = uiText("Open Doctor", "打开健康检查");
  const selected = await vscode.window.showErrorMessage(
    uiText(`iCode command ${label} failed: ${message}`, `iCode 命令 ${label} 执行失败：${message}`),
    openDoctor,
  );
  if (selected === openDoctor) {
    await vscode.commands.executeCommand("chrys.doctor");
  }
}

function commandDebugLabel(command: ChatCommand, arg?: string): string {
  const suffix = arg?.trim() ? ` ${arg.trim().slice(0, 120)}` : "";
  return `${command}${suffix}`;
}
