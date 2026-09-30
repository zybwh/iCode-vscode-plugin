import * as vscode from "vscode";
import { rt } from "../../state/runtime";
import { formatCount } from "../../common/utils";
import { logInfo, logWarn, logError } from "../../common/logging";
import { chatPanelState } from "../../common/chatPanelState";
import { apiStyleLabel, providerLabel } from "../../common/runtimeUtils";
import { findSessionJsonPath } from "../../common/sessionFiles";
import { refreshRuntimeSnapshot } from "../../handlers/notifications";
import { agentProfileMutation } from "../../chat/agentProfileEdit";
import { rememberPreferredAgent, rememberPreferredConfigOption, persistPreferredModel } from "../../session/defaults";
import type { ProfileSummary, ModelSummary } from "../../acp/types";
import { localized as nativeText } from "../../common/hostI18n";
import { showJsonDocument, startingNotice } from "./common";
import { selectNextSessionAgent } from "./sessions";

// ──────────────────────────────────────────────
// Agent switching
// ──────────────────────────────────────────────

export async function switchActiveAgent(targetName?: string): Promise<void> {
  if (!rt.sessionManager) return;
  if (rt.sessionManager.state !== "idle") {
    vscode.window.showInformationMessage(nativeText(
      "iCode cannot switch agents while the current task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能切换 iCode 智能体。请先中断或等待任务完成。",
    ));
    rt.chatPanel?.appendDebugEvent("AgentSwitchBlocked", rt.sessionManager.state);
    return;
  }
  const agents = await rt.sessionManager.listAgentProfiles();
  const directTarget = targetName?.trim();
  if (directTarget) {
    const matched = agents.find((agent) => (
      !agent.subAgentOnly
      && (agent.name.toLowerCase() === directTarget.toLowerCase()
        || (agent.displayName || "").toLowerCase() === directTarget.toLowerCase())
    ));
    if (!matched) {
      vscode.window.showWarningMessage(nativeText(
        `No main iCode agent profile matches "${directTarget}".`,
        `没有匹配 “${directTarget}” 的主 iCode 智能体配置。`,
      ));
      rt.chatPanel?.appendDebugEvent("AgentSwitchFailed", directTarget);
      return;
    }
    if (matched.name === rt.activeAgentName) return;
    if (await selectNextSessionAgent(matched.name)) return;
    await rt.sessionManager.switchAgent(matched.name);
    rememberPreferredAgent(matched.name);
    await refreshRuntimeSnapshot();
    rt.chatPanel?.setState(chatPanelState());
    vscode.window.showInformationMessage(nativeText(
      `Switched iCode agent to ${matched.displayName || matched.name}.`,
      `已切换 iCode 智能体为 ${matched.displayName || matched.name}。`,
    ));
    rt.chatPanel?.appendDebugEvent("AgentSwitch", matched.name);
    return;
  }
  const selected = await vscode.window.showQuickPick(
    agents
      .filter((agent: ProfileSummary) => !agent.subAgentOnly)
      .map((agent: ProfileSummary) => agentQuickPickItem(agent, { activeAgentName: rt.activeAgentName })),
    { placeHolder: nativeText("Switch active iCode agent", "切换当前 iCode 智能体") },
  );
  if (!selected || selected.profileName === rt.activeAgentName) return;
  if (await selectNextSessionAgent(selected.profileName)) return;
  await rt.sessionManager.switchAgent(selected.profileName);
  rememberPreferredAgent(selected.profileName);
  await refreshRuntimeSnapshot();
  rt.chatPanel?.setState(chatPanelState());
  vscode.window.showInformationMessage(nativeText(
    `Switched iCode agent to ${selected.label.replace(/^\$\(circle-filled\)\s*/, "")}.`,
    `已切换 iCode 智能体为 ${selected.label.replace(/^\$\(circle-filled\)\s*/, "")}。`,
  ));
  rt.chatPanel?.appendDebugEvent("AgentSwitch", selected.profileName);
}

export async function showAgentProfiles(): Promise<void> {
  if (!rt.sessionManager) {
    vscode.window.showInformationMessage(nativeText("iCode is still starting. Try again in a moment.", "iCode 仍在启动，请稍后再试。"));
    return;
  }
  const agents = await rt.sessionManager.listAgentProfiles();
  const selected = await vscode.window.showQuickPick(
    agents.map((agent: ProfileSummary) => agentQuickPickItem(agent, { activeAgentName: rt.activeAgentName, includeSubAgentOnly: true })),
    { placeHolder: nativeText("Select an agent profile to inspect", "选择要查看的智能体配置") },
  );
  if (!selected) return;
  const profile = await rt.sessionManager.readAgentProfile(selected.profileName);
  await showJsonDocument(`iCode Agent Profile: ${selected.profileName}`, profile);
}

export type AgentQuickPickItem = vscode.QuickPickItem & {
  profileName: string;
};

export function agentQuickPickItem(
  agent: ProfileSummary,
  options: { activeAgentName?: string; includeSubAgentOnly?: boolean } = {},
): AgentQuickPickItem {
  const isActive = Boolean(options.activeAgentName && agent.name === options.activeAgentName);
  const role = agent.subAgentOnly
    ? nativeText("sub-agent only", "仅子智能体")
    : nativeText("main agent", "主智能体");
  const description = [
    isActive ? nativeText("current", "当前") : "",
    role,
    agent.name,
  ].filter(Boolean).join("  ");
  const detail = [
    agent.description || nativeText("No description.", "暂无描述。"),
    options.includeSubAgentOnly
      ? nativeText(
        `Profile id: ${agent.id || agent.name}; usable as main agent: ${agent.subAgentOnly ? "no" : "yes"}`,
        `配置 ID：${agent.id || agent.name}；可作为主智能体：${agent.subAgentOnly ? "否" : "是"}`,
      )
      : nativeText(`Profile id: ${agent.id || agent.name}`, `配置 ID：${agent.id || agent.name}`),
  ].join("\n");
  return {
    label: `${isActive ? "$(circle-filled) " : ""}${agent.displayName || agent.name}`,
    description,
    detail,
    profileName: agent.name,
  };
}

export async function showModelProfiles(): Promise<void> {
  if (!rt.sessionManager) {
    vscode.window.showInformationMessage(nativeText("iCode is still starting. Try again in a moment.", "iCode 仍在启动，请稍后再试。"));
    return;
  }
  const models = await rt.sessionManager.listModelProfiles();
  if (!models.length) {
    vscode.window.showInformationMessage(nativeText("No iCode model profiles are configured.", "尚未配置 iCode 模型配置。"));
    return;
  }
  const selected = await vscode.window.showQuickPick(
    models.map((model: ModelSummary) => modelQuickPickItem(model, { activeModelProfileId: rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "" })),
    { placeHolder: nativeText("Select a model profile to inspect", "选择要查看的模型配置") },
  );
  if (!selected) return;
  const profile = await rt.sessionManager.readModelProfile(selected.id);
  await showJsonDocument(`iCode Model Profile: ${selected.label}`, profile);
}

export type ModelQuickPickItem = vscode.QuickPickItem & {
  id: string;
};

export function modelQuickPickItem(
  model: ModelSummary,
  options: { activeModelProfileId?: string } = {},
): ModelQuickPickItem {
  const isActive = Boolean(options.activeModelProfileId && model.id === options.activeModelProfileId);
  const provider = model.provider ? providerLabel(model.provider) : nativeText("provider unknown", "供应商未知");
  const apiStyle = model.apiStyle ? apiStyleLabel(String(model.apiStyle)) : nativeText("API style unknown", "API 样式未知");
  const modelId = model.modelId || nativeText("model id unknown", "模型 ID 未知");
  const context = model.maxContextTokens ? formatCount(model.maxContextTokens) : nativeText("context unknown", "上下文未知");
  const capabilities = [
    model.stream === false ? nativeText("stream off", "非流式") : nativeText("stream", "流式"),
    model.vision ? nativeText("vision", "视觉") : nativeText("text only", "仅文本"),
  ].join(" · ");
  return {
    label: `${isActive ? "$(circle-filled) " : ""}${model.name || model.id}`,
    description: [
      isActive ? nativeText("current", "当前") : "",
      model.id,
      capabilities,
    ].filter(Boolean).join("  "),
    detail: [
      nativeText(`Provider: ${provider}; API: ${apiStyle}; Model: ${modelId}`, `供应商：${provider}；API：${apiStyle}；模型：${modelId}`),
      nativeText(`Context: ${context}; Image input: ${model.vision ? "yes" : "no"}`, `上下文：${context}；图片输入：${model.vision ? "是" : "否"}`),
    ].join("\n"),
    id: model.id,
  };
}

// ──────────────────────────────────────────────
// History / model profiles
// ──────────────────────────────────────────────

export async function showStructuredHistory(): Promise<void> {
  if (!rt.sessionManager) return;
  const history = await rt.sessionManager.history();
  await showJsonDocument("iCode Structured History", history);
  rt.chatPanel?.appendDebugEvent("SessionHistoryOpened", history.sessionId);

  const sourcePath = findSessionJsonPath(history.sessionId);
  const openSessionJson = nativeText("Open local session.json", "打开本地 session.json");
  const copyPath = nativeText("Copy path", "复制路径");
  const copyJson = nativeText("Copy JSON", "复制 JSON");
  const actions = [
    ...(sourcePath ? [openSessionJson, copyPath] : []),
    copyJson,
  ];
  const action = await vscode.window.showInformationMessage(
    sourcePath
      ? nativeText(`Opened ACP structured history. Local session.json: ${sourcePath}`, `已打开 ACP 结构化历史。本地 session.json：${sourcePath}`)
      : nativeText("Opened ACP structured history. Local session.json was not found on this host.", "已打开 ACP 结构化历史。当前主机未找到本地 session.json。"),
    ...actions,
  );
  if (action === openSessionJson && sourcePath) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath));
    await vscode.window.showTextDocument(doc, { preview: false });
    rt.chatPanel?.appendDebugEvent("SessionJsonOpened", sourcePath);
  } else if (action === copyPath && sourcePath) {
    await vscode.env.clipboard.writeText(sourcePath);
    vscode.window.showInformationMessage(nativeText("Session path copied.", "会话路径已复制。"));
  } else if (action === copyJson) {
    await vscode.env.clipboard.writeText(JSON.stringify(history, null, 2));
    vscode.window.showInformationMessage(nativeText("Structured session JSON copied.", "结构化会话 JSON 已复制。"));
  }
}

export async function setModelProfile(): Promise<void> {
  if (!rt.sessionManager) return;
  if (rt.sessionManager.state !== "idle") {
    vscode.window.showInformationMessage(nativeText(
      "iCode cannot switch model profiles while the current task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能切换 iCode 模型配置。请先中断或等待任务完成。",
    ));
    rt.chatPanel?.appendDebugEvent("ModelSwitchBlocked", rt.sessionManager.state);
    return;
  }
  const models = await rt.sessionManager.listModelProfiles();
  const activeModelProfileId = rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "";
  const selected = await vscode.window.showQuickPick(
    models.map((model: ModelSummary) => modelQuickPickItem(model, { activeModelProfileId })),
    {
      title: nativeText("iCode Model Profile", "iCode 模型配置"),
      placeHolder: nativeText("Select the active model profile and default for new VSIX sessions", "选择当前模型配置，并作为新 VSIX 会话默认值"),
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!selected) return;
  if (rt.currentSessionId) await rt.sessionManager.setModel(selected.id);
  await persistPreferredModel(selected.id);
  await refreshRuntimeSnapshot();
  rt.chatPanel?.setState(chatPanelState());
  vscode.window.showInformationMessage(nativeText(
    `iCode model profile set to ${selected.id} and saved as the VSIX default.`,
    `iCode 模型配置已切换到 ${selected.id}，并保存为 VSIX 默认值。`,
  ));
  rt.chatPanel?.appendDebugEvent("ModelSwitch", selected.id);
}

// ──────────────────────────────────────────────
// Model dialog (inline)
// ──────────────────────────────────────────────

export async function openModelDialog(selectedModelId?: string): Promise<void> {
  if (!rt.chatPanel) return;
  logInfo("Opening inline Models dialog.");
  rt.chatPanel?.reveal();
  rt.chatPanel?.setModelDialogState({
    models: [],
    profiles: {},
    activeModelProfileId: rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "",
    selectedModelId,
  });
  rt.chatPanel?.modelDialogNotice("info", nativeText("Loading model profiles...", "正在加载模型配置..."));
  await refreshModelDialog();
}

export async function refreshModelDialog(panel = rt.chatPanel): Promise<void> {
  const sessionManager = rt.sessionManager;
  if (panel !== rt.chatPanel) return;
  if (!sessionManager || !panel) {
    modelDialogUnavailable("ModelDialogRefreshUnavailable");
    return;
  }
  panel.setModelDialogBusy(true);
  try {
    logInfo("Refreshing inline Models dialog state.");
    const models = await sessionManager.listModelProfiles();
    const profileEntries = await Promise.all(
      models.map(async (model: ModelSummary) => [model.id, await sessionManager.readModelProfile(model.id)] as const),
    );
    if (panel !== rt.chatPanel || sessionManager !== rt.sessionManager) return;
    logInfo(`Loaded ${models.length} model profile(s).`);
    const state = {
      models,
      profiles: Object.fromEntries(profileEntries),
      activeModelProfileId: rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "",
    };
    panel.setModelDialogState(state);
  } catch (error) {
    modelDialogError(error, panel);
  } finally {
    panel.setModelDialogBusy(false);
  }
}

export async function saveModelFromDialog(model: Record<string, unknown>): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    modelDialogUnavailable("ModelDialogSaveUnavailable");
    return;
  }
  panel.setModelDialogBusy(true);
  try {
    await sessionManager.writeModelProfile(model);
    panel.modelDialogNotice("info", nativeText("Model profile saved.", "模型配置已保存。"));
    await refreshModelDialog(panel);
  } finally {
    panel.setModelDialogBusy(false);
  }
}

export async function deleteModelFromDialog(id: string): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    modelDialogUnavailable("ModelDialogDeleteUnavailable");
    return;
  }
  if (isActiveModelProfile(id) && sessionManager.state !== "idle") {
    panel.modelDialogNotice("warning", nativeText(
      "iCode cannot delete the active model profile while the current task is running.",
      "当前任务运行时不能删除正在使用的 iCode 模型配置。",
    ));
    panel.appendDebugEvent("ModelDeleteBlocked", id);
    return;
  }
  panel.setModelDialogBusy(true);
  try {
    await sessionManager.deleteModelProfile(id);
    panel.appendDebugEvent("ModelDeleted", id);
    panel.modelDialogNotice("info", nativeText(`Model profile ${id} deleted.`, `模型配置 ${id} 已删除。`));
    await refreshModelDialog(panel);
  } finally {
    panel.setModelDialogBusy(false);
  }
}

export async function setActiveModelFromDialog(id: string): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    modelDialogUnavailable("ModelDialogSetActiveUnavailable");
    return;
  }
  if (sessionManager.state !== "idle") {
    panel.modelDialogNotice("warning", nativeText(
      "iCode cannot switch model profiles while the current task is running.",
      "当前任务运行时不能切换 iCode 模型配置。",
    ));
    panel.appendDebugEvent("ModelSwitchBlocked", sessionManager.state);
    return;
  }
  panel.setModelDialogBusy(true);
  try {
    if (rt.currentSessionId) await sessionManager.setModel(id);
    await persistPreferredModel(id);
    await refreshRuntimeSnapshot();
    panel.setState(chatPanelState());
    panel.modelDialogNotice(
      "info",
      id
        ? nativeText("Active model profile updated and saved as the VSIX default.", "当前模型配置已更新，并保存为 VSIX 默认值。")
        : nativeText("Active model profile reset to default and saved as the VSIX default.", "当前模型配置已恢复默认，并保存为 VSIX 默认值。"),
    );
    panel.appendDebugEvent("ModelSwitch", id || "(default)");
    await refreshModelDialog(panel);
  } finally {
    panel.setModelDialogBusy(false);
  }
}

export function modelDialogError(error: unknown, panel = rt.chatPanel): void {
  if (panel !== rt.chatPanel) return;
  const message = error instanceof Error ? error.message : String(error);
  logError(`Model dialog failed: ${message}`);
  rt.chatPanel?.setModelDialogBusy(false);
  rt.chatPanel?.modelDialogNotice("error", message);
}

export function modelDialogUnavailable(eventName: string): void {
  const message = startingNotice();
  logWarn(`${eventName}: ${message}`);
  rt.chatPanel?.appendDebugEvent(eventName, "session manager missing");
  rt.chatPanel?.setModelDialogBusy(false);
  rt.chatPanel?.modelDialogNotice("warning", message);
}

export function isActiveModelProfile(id: string): boolean {
  const active = rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "";
  return Boolean(id && active && id === active);
}

// ──────────────────────────────────────────────
// Agent dialog (inline)
// ──────────────────────────────────────────────

export async function openAgentDialog(): Promise<void> {
  if (!rt.chatPanel) return;
  logInfo("Opening inline Agents dialog.");
  rt.chatPanel?.reveal();
  rt.chatPanel?.agentDialogNotice("info", nativeText("Loading agent profiles...", "正在加载智能体配置..."));
  await refreshAgentDialog();
}

export async function refreshAgentDialog(panel = rt.chatPanel, updatedAgentName?: string): Promise<void> {
  const sessionManager = rt.sessionManager;
  if (panel !== rt.chatPanel) return;
  if (!sessionManager || !panel) {
    agentDialogUnavailable("AgentDialogRefreshUnavailable");
    return;
  }
  panel.setAgentDialogBusy(true);
  try {
    logInfo("Refreshing inline Agents dialog state.");
    const agents = await sessionManager.listAgentProfiles();
    const profileEntries = await Promise.all(
      agents.map(async (agent) => [agent.name, await sessionManager.readAgentProfile(agent.name)] as const),
    );
    if (panel !== rt.chatPanel || sessionManager !== rt.sessionManager) return;
    logInfo(`Loaded ${agents.length} agent profile(s).`);
    const state = {
      agents,
      updatedAgentName,
      profiles: Object.fromEntries(profileEntries),
      activeAgentName: rt.activeAgentName || process.env.CHRYS_DEFAULT_AGENT || "",
    };
    panel.setAgentDialogState(state);
  } catch (error) {
    agentDialogError(error, panel);
  } finally {
    panel.setAgentDialogBusy(false);
  }
}

export async function saveAgentFromDialog(agent: Record<string, unknown>): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    agentDialogUnavailable("AgentDialogSaveUnavailable");
    return;
  }
  panel.setAgentDialogBusy(true);
  try {
    await sessionManager.writeAgentProfile(agent);
    if (sessionManager.state === "idle") {
      if (rt.currentSessionId) await sessionManager.reloadSettings();
      panel.appendDebugEvent("AgentProfileSaved", "agent profile save");
      panel.agentDialogNotice("info", nativeText("Agent profile saved.", "智能体配置已保存。"));
    } else {
      panel.appendDebugEvent("SettingsReloadDeferred", "agent profile save");
      panel.agentDialogNotice("warning", nativeText(
        "Agent profile saved. Reload settings after the current task finishes to apply it.",
        "智能体配置已保存。请在当前任务结束后重新加载设置以应用。",
      ));
    }
    await refreshAgentDialog(panel, String(agent.name));
  } catch (error) {
    agentDialogError(error, panel);
  } finally {
    panel.setAgentDialogBusy(false);
  }
}

export async function deleteAgentFromDialog(name: string): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    agentDialogUnavailable("AgentDialogDeleteUnavailable");
    return;
  }
  if (isActiveAgentProfile(name) && sessionManager.state !== "idle") {
    panel.agentDialogNotice("warning", nativeText(
      "iCode cannot delete the active agent profile while the current task is running.",
      "当前任务运行时不能删除正在使用的 iCode 智能体配置。",
    ));
    panel.appendDebugEvent("AgentDeleteBlocked", name);
    return;
  }
  panel.setAgentDialogBusy(true);
  try {
    const agents = await sessionManager.listAgentProfiles();
    const profile = agents.find((agent) => agent.name === name);
    if (!profile) throw new Error(nativeText(`Agent profile ${name} was not found.`, `未找到智能体配置 ${name}。`));
    const mutation = agentProfileMutation(profile);
    const result = mutation === "reset"
      ? await sessionManager.resetAgentProfile(name)
      : await sessionManager.deleteAgentProfile(name);
    const outcome = mutation === "reset"
      ? (result.changed === true ? "restored_builtin" : "already_builtin")
      : (result.deleted === true ? "deleted" : "not_found");
    if (rt.currentSessionId && sessionManager.state === "idle") {
      await sessionManager.reloadSettings();
      panel.appendDebugEvent("SettingsReloaded", `agent profile ${mutation}`);
    } else {
      panel.appendDebugEvent("SettingsReloadDeferred", `agent profile ${mutation}`);
    }
    panel.appendDebugEvent("AgentDeleteResult", `${name}: ${outcome}`);
    if (outcome === "restored_builtin") {
      panel.agentDialogNotice("info", nativeText(
        `Removed the user override for ${name}; the iCode built-in profile is active again.`,
        `已移除 ${name} 的用户覆盖，并重新启用 iCode 内置配置。`,
      ));
    } else if (outcome === "already_builtin") {
      panel.agentDialogNotice("info", nativeText(
        `${name} is already using the iCode built-in profile.`,
        `${name} 已在使用 iCode 内置配置。`,
      ));
    } else if (outcome === "deleted") {
      panel.agentDialogNotice("info", nativeText(
        `Agent profile ${name} deleted.`,
        `智能体配置 ${name} 已删除。`,
      ));
    } else {
      panel.agentDialogNotice("warning", nativeText(
        `Agent profile ${name} was not found.`,
        `未找到智能体配置 ${name}。`,
      ));
    }
    await refreshAgentDialog(panel, name);
  } catch (error) {
    agentDialogError(error, panel);
  } finally {
    panel.setAgentDialogBusy(false);
  }
}

export async function setActiveAgentFromDialog(name: string): Promise<void> {
  const panel = rt.chatPanel;
  const sessionManager = rt.sessionManager;
  if (!sessionManager || !panel) {
    agentDialogUnavailable("AgentDialogSetActiveUnavailable");
    return;
  }
  if (sessionManager.state !== "idle") {
    panel.agentDialogNotice("warning", nativeText(
      "iCode cannot switch agents while the current task is running.",
      "当前任务运行时不能切换 iCode 智能体。",
    ));
    panel.appendDebugEvent("AgentSwitchBlocked", sessionManager.state);
    return;
  }
  panel.setAgentDialogBusy(true);
  try {
    if (!(await selectNextSessionAgent(name))) {
      await sessionManager.switchAgent(name);
      rememberPreferredAgent(name);
      await refreshRuntimeSnapshot();
    }
    panel.setState(chatPanelState());
    panel.agentDialogNotice("info", nativeText("Active agent profile updated.", "当前智能体配置已更新。"));
    panel.appendDebugEvent("AgentSwitch", name);
    await refreshAgentDialog(panel);
  } finally {
    panel.setAgentDialogBusy(false);
  }
}

export function agentDialogError(error: unknown, panel = rt.chatPanel): void {
  if (panel !== rt.chatPanel) return;
  const message = error instanceof Error ? error.message : String(error);
  logError(`Agent dialog failed: ${message}`);
  rt.chatPanel?.setAgentDialogBusy(false);
  rt.chatPanel?.agentDialogNotice("error", message);
}

export function agentDialogUnavailable(eventName: string): void {
  const message = startingNotice();
  logWarn(`${eventName}: ${message}`);
  rt.chatPanel?.appendDebugEvent(eventName, "session manager missing");
  rt.chatPanel?.setAgentDialogBusy(false);
  rt.chatPanel?.agentDialogNotice("warning", message);
}

export function isActiveAgentProfile(name: string): boolean {
  const active = rt.activeAgentName || process.env.CHRYS_DEFAULT_AGENT || "";
  return Boolean(name && active && name === active);
}

// ──────────────────────────────────────────────
// Management commands (model/agent CRUD)
// ──────────────────────────────────────────────

export async function createModelProfile(): Promise<void> {
  await openModelDialog("__new__");
}

export async function deleteModelProfile(): Promise<void> {
  if (!rt.sessionManager) return;
  const models = await rt.sessionManager.listModelProfiles();
  const activeModelProfileId = rt.currentRuntime?.modelProfileId || rt.preferredModelProfileId || process.env.CHRYS_MODEL_PROFILE || "";
  const selected = await vscode.window.showQuickPick(
    models.map((model: ModelSummary) => modelQuickPickItem(model, { activeModelProfileId })),
    { placeHolder: nativeText("Delete which model profile?", "删除哪个模型配置？") },
  );
  if (!selected) return;
  if (isActiveModelProfile(selected.id) && rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText(
      "iCode cannot delete the active model profile while the current task is running.",
      "当前任务运行时不能删除正在使用的 iCode 模型配置。",
    ));
    rt.chatPanel?.appendDebugEvent("ModelDeleteBlocked", selected.id);
    return;
  }
  const deleteLabel = nativeText("Delete", "删除");
  const confirmed = await vscode.window.showWarningMessage(
    nativeText(`Delete model profile ${selected.id}?`, `删除模型配置 ${selected.id}？`),
    { modal: true },
    deleteLabel,
  );
  if (confirmed !== deleteLabel) return;
  await rt.sessionManager.deleteModelProfile(selected.id);
  rt.chatPanel?.appendDebugEvent("ModelDeleted", selected.id);
}

export async function deleteAgentProfile(): Promise<void> {
  if (!rt.sessionManager) return;
  const agents = await rt.sessionManager.listAgentProfiles();
  const selected = await vscode.window.showQuickPick(
    agents
      .filter((agent: ProfileSummary) => agent.builtin !== true)
      .map((agent: ProfileSummary) => ({
        ...agentQuickPickItem(agent, { activeAgentName: rt.activeAgentName, includeSubAgentOnly: true }),
        name: agent.name,
      })),
    { placeHolder: nativeText("Delete which user agent profile?", "删除哪个用户智能体配置？") },
  );
  if (!selected) return;
  if (isActiveAgentProfile(selected.name) && rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText(
      "iCode cannot delete the active agent profile while the current task is running.",
      "当前任务运行时不能删除正在使用的 iCode 智能体配置。",
    ));
    rt.chatPanel?.appendDebugEvent("AgentDeleteBlocked", selected.name);
    return;
  }
  const deleteLabel = nativeText("Delete", "删除");
  const confirmed = await vscode.window.showWarningMessage(
    nativeText(`Delete agent profile ${selected.name}?`, `删除智能体配置 ${selected.name}？`),
    { modal: true },
    deleteLabel,
  );
  if (confirmed !== deleteLabel) return;
  await rt.sessionManager.deleteAgentProfile(selected.name);
  if (rt.sessionManager.state === "idle") {
    await rt.sessionManager.reloadSettings();
    rt.chatPanel?.appendDebugEvent("SettingsReloaded", "agent profile delete");
  } else {
    rt.chatPanel?.appendDebugEvent("SettingsReloadDeferred", "agent profile delete");
  }
  rt.chatPanel?.appendDebugEvent("AgentDeleted", selected.name);
}

export async function testMcpServer(): Promise<void> {
  if (!rt.sessionManager) return;
  const raw = await vscode.window.showInputBox({
    prompt: nativeText("HTTP MCP server JSON config", "HTTP MCP server JSON 配置"),
    placeHolder: "{\"name\":\"server\",\"transport\":\"http\",\"url\":\"https://example.com/mcp\"}",
  });
  if (!raw) return;
  let server: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object");
    server = parsed as Record<string, unknown>;
  } catch (err) {
    vscode.window.showErrorMessage(`Invalid MCP JSON: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (server.transport !== "http") {
    vscode.window.showWarningMessage(nativeText(
      "MCP test supports HTTP MCP servers only. Client-supplied stdio is not run from the VS Code extension.",
      "MCP 测试只支持 HTTP MCP server。VS Code 扩展不会运行客户端提供的 stdio MCP。",
    ));
    return;
  }
  const result = await rt.sessionManager.testMcpServer(server);
  const ok = result.ok === true;
  const message = typeof result.message === "string" ? result.message : JSON.stringify(result);
  if (ok) {
    vscode.window.showInformationMessage(`MCP test passed: ${message}`);
  } else {
    vscode.window.showWarningMessage(`MCP test failed: ${message}`);
  }
}

export async function setConfigOption(): Promise<void> {
  if (!rt.sessionManager) return;
  const optionsPayload = await rt.sessionManager.configOptions();
  const options = Array.isArray(optionsPayload.options) ? optionsPayload.options : [];
  const selected = await vscode.window.showQuickPick(
    options.map((option: Record<string, unknown>) => ({
      label: String(option.key ?? option.envKey ?? ""),
      description: String(option.envKey ?? ""),
      detail: String(option.value ?? ""),
    })).filter((item: { label: string }) => item.label),
    { placeHolder: "Select iCode config option" },
  );
  if (!selected) return;
  const value = await vscode.window.showInputBox({
    prompt: `Set ${selected.label}`,
    value: selected.detail,
  });
  if (value === undefined) return;
  const result = await rt.sessionManager.setConfigOption(selected.label, value);
  rememberPreferredConfigOption(
    typeof result.key === "string" ? result.key : selected.label,
    typeof result.value === "string" ? result.value : value,
  );
  rt.chatPanel?.setState(chatPanelState());
  vscode.window.showInformationMessage(nativeText(`Updated iCode config ${selected.label}.`, `iCode 配置 ${selected.label} 已更新。`));
}
