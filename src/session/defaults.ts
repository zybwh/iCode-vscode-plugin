import * as vscode from "vscode";
import { rt } from "../state/runtime";
import { chatPanelState } from "../common/chatPanelState";
import { logInfo, logWarn } from "../common/logging";
import { refreshRuntimeSnapshot } from "../handlers/notifications";

export function initializePreferredDefaults(): void {
  refreshPreferredDefaultsFromSettings();
}

export function refreshPreferredDefaultsFromSettings(): void {
  const config = vscode.workspace.getConfiguration("chrys");
  rt.preferredAgentName = config.get<string>("agent.default") || process.env.CHRYS_DEFAULT_AGENT || "Code";
  rt.preferredModelProfileId = config.get<string>("model.profile")?.trim() || process.env.CHRYS_MODEL_PROFILE || "";
  rt.preferredApprovalMode = normalizeApprovalMode(config.get<string>("approval.mode") || "auto");
}

export function rememberPreferredAgent(name: string): void {
  if (name.trim()) rt.preferredAgentName = name.trim();
}

export function rememberPreferredModel(profileId: string): void {
  rt.preferredModelProfileId = profileId.trim();
}

export async function persistPreferredModel(profileId: string): Promise<void> {
  const normalized = profileId.trim();
  rememberPreferredModel(normalized);
  const config = vscode.workspace.getConfiguration("chrys");
  if ((config.get<string>("model.profile")?.trim() || "") === normalized) return;
  await config.update("model.profile", normalized, preferredSettingTarget(config, "model.profile"));
  logInfo(`Persisted VSIX model default: ${normalized || "(default)"}`);
}

export function rememberPreferredApprovalMode(mode: string): void {
  rt.preferredApprovalMode = normalizeApprovalMode(mode);
}

export function rememberPreferredConfigOption(key: string, value: string): void {
  if (key === "default_agent" || key === "CHRYS_DEFAULT_AGENT") {
    rt.preferredAgentName = value.trim() || "Code";
  } else if (key === "model_profile" || key === "CHRYS_MODEL_PROFILE") {
    rt.preferredModelProfileId = value.trim();
  } else if (key === "default_approval_mode" || key === "CHRYS_DEFAULT_APPROVAL_MODE") {
    rt.preferredApprovalMode = normalizeApprovalMode(value.trim());
  }
}

/** Applies VSIX defaults and leaves rt.currentRuntime refreshed; callers need no extra snapshot. */
export async function applyPreferredDefaultsToNewSession(): Promise<void> {
  if (!rt.sessionManager || !rt.currentSessionId) return;

  await refreshRuntimeSnapshot();

  const desiredAgent = rt.preferredAgentName || "Code";
  if (desiredAgent && desiredAgent !== (rt.currentRuntime?.agentProfile || rt.activeAgentName)) {
    try {
      logInfo(`Applying preferred agent to new session: ${desiredAgent}`);
      await rt.sessionManager.switchAgent(desiredAgent);
      rt.activeAgentName = desiredAgent;
      rt.chatPanel?.appendDebugEvent("NewSessionDefault", `agent=${desiredAgent}`);
      await refreshRuntimeSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Failed to apply preferred agent ${desiredAgent}: ${message}`);
      rt.chatPanel?.appendDebugEvent("NewSessionDefaultFailed", `agent=${desiredAgent}: ${message}`);
    }
  }

  let modelChanged = false;
  const desiredModel = rt.preferredModelProfileId;
  const currentModel = rt.currentRuntime?.modelProfileId || "";
  if (desiredModel && desiredModel !== currentModel) {
    try {
      logInfo(`Applying preferred model to new session: ${desiredModel}`);
      await rt.sessionManager.setModel(desiredModel);
      rt.chatPanel?.appendDebugEvent("NewSessionDefault", `model=${desiredModel}`);
      modelChanged = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Failed to apply preferred model ${desiredModel}: ${message}`);
      rt.chatPanel?.appendDebugEvent("NewSessionDefaultFailed", `model=${desiredModel}: ${message}`);
    }
  }

  const desiredApproval = normalizeApprovalMode(rt.preferredApprovalMode);
  if (desiredApproval !== rt.currentApprovalMode) {
    try {
      logInfo(`Applying preferred approval mode to new session: ${desiredApproval}`);
      await rt.sessionManager.setApprovalMode(desiredApproval);
      rt.currentApprovalMode = desiredApproval;
      rt.chatPanel?.appendDebugEvent("NewSessionDefault", `approval=${desiredApproval}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarn(`Failed to apply preferred approval mode ${desiredApproval}: ${message}`);
      rt.chatPanel?.appendDebugEvent("NewSessionDefaultFailed", `approval=${desiredApproval}: ${message}`);
    }
  }

  if (modelChanged) await refreshRuntimeSnapshot();
  rt.chatPanel?.setState(chatPanelState());
}

function normalizeApprovalMode(mode: string): "manual" | "auto" | "bypass" {
  if (mode === "manual" || mode === "auto" || mode === "bypass") return mode;
  if (mode === "skip") return "bypass";
  return "auto";
}

export async function persistPreferredAgent(name: string): Promise<void> {
  rememberPreferredAgent(name);
  const config = vscode.workspace.getConfiguration("chrys");
  if (config.get<string>("agent.default") === name) return;
  await config.update("agent.default", name, preferredSettingTarget(config, "agent.default"));
}

function preferredSettingTarget(config: vscode.WorkspaceConfiguration, key: string): vscode.ConfigurationTarget {
  const scope = config.inspect<string>(key);
  if (scope?.workspaceFolderValue !== undefined) return vscode.ConfigurationTarget.WorkspaceFolder;
  if (scope?.workspaceValue !== undefined) return vscode.ConfigurationTarget.Workspace;
  return vscode.ConfigurationTarget.Global;
}
