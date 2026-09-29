import * as vscode from "vscode";
import { rt } from "../state/runtime";
import { refreshRuntimeSnapshot } from "../handlers/notifications";
import { rememberPreferredAgent, rememberPreferredConfigOption, persistPreferredModel } from "../session/defaults";
import { ManagementPanel, type ManagementState } from "../manage/panel";
import { resolveUiLanguage, type UiLanguage } from "../common/i18n";
import { logError, logWarn } from "../common/logging";
import { openAgentDialog, openModelDialog } from "./dialogs";

function uiLanguage(): UiLanguage {
  return resolveUiLanguage(
    vscode.workspace.getConfiguration("chrys").get<string>("ui.language"),
    vscode.env.language,
  );
}

function zh(): boolean {
  return uiLanguage() === "zh-CN";
}

function text(en: string, zhText: string): string {
  return zh() ? zhText : en;
}

function isActiveAgentProfile(name: string): boolean {
  const active = rt.activeAgentName || process.env.CHRYS_DEFAULT_AGENT || "";
  return Boolean(name && active && name === active);
}

function isActiveModelProfile(id: string): boolean {
  const active = rt.currentRuntime?.modelProfileId || process.env.CHRYS_MODEL_PROFILE || "";
  return Boolean(id && active && id === active);
}

export async function showManagementPanel(initialTab: "agents" | "models" | "config" | "mcp" = "agents"): Promise<void> {
  if (!rt.extensionContext) return;
  if (!rt.sessionManager) {
    await showManagementUnavailable();
    return;
  }
  if (rt.managementPanel) {
    rt.managementPanel.reveal();
    rt.managementPanel.setActiveTab(initialTab);
    await refreshManagementPanel();
    return;
  }
  const panel = rt.managementPanel = new ManagementPanel(rt.extensionContext, initialTab, uiLanguage());
  panel.onDispose(() => {
    if (rt.managementPanel === panel) rt.managementPanel = null;
  });
  panel.onRefresh(() => refreshManagementPanel(panel));
  panel.onSaveAgent(async (agent) => {
    await rt.sessionManager.writeAgentProfile(agent);
    if (rt.sessionManager.state === "idle") {
      await rt.sessionManager.reloadSettings();
      rt.chatPanel?.appendDebugEvent("SettingsReloaded", "agent profile save");
      panel.notice("info", zh() ? "智能体配置已保存。" : "Agent profile saved.");
    } else {
      rt.chatPanel?.appendDebugEvent("SettingsReloadDeferred", "agent profile save");
      panel.notice("warning", text(
        "Agent profile saved. Reload settings after the current task finishes to apply it.",
        "智能体配置已保存。请在当前任务结束后重新加载设置以应用。",
      ));
    }
  });
  panel.onDeleteAgent(async (name) => {
    if (isActiveAgentProfile(name) && rt.sessionManager.state !== "idle") {
      panel.notice("warning", text(
        "iCode cannot delete the active agent profile while the current task is running.",
        "当前任务运行时不能删除正在使用的 iCode 智能体配置。",
      ));
      rt.chatPanel?.appendDebugEvent("AgentDeleteBlocked", name);
      return;
    }
    await rt.sessionManager.deleteAgentProfile(name);
    if (rt.sessionManager.state === "idle") {
      await rt.sessionManager.reloadSettings();
      rt.chatPanel?.appendDebugEvent("SettingsReloaded", "agent profile delete");
    } else {
      rt.chatPanel?.appendDebugEvent("SettingsReloadDeferred", "agent profile delete");
    }
    rt.chatPanel?.appendDebugEvent("AgentDeleted", name);
    panel.notice("info", zh() ? `智能体配置 ${name} 已删除。` : `Agent profile ${name} deleted.`);
  });
  panel.onSetActiveAgent(async (name) => {
    if (rt.sessionManager.state !== "idle") {
      panel.notice(
        "warning",
        text(
          "iCode cannot switch agents while the current task is running.",
          "当前任务运行时不能切换 iCode 智能体。",
        ),
      );
      rt.chatPanel?.appendDebugEvent("AgentSwitchBlocked", rt.sessionManager.state);
      return;
    }
    await rt.sessionManager.switchAgent(name);
    rememberPreferredAgent(name);
    await refreshRuntimeSnapshot();
    panel.notice("info", zh() ? "当前智能体已更新。" : "Active agent profile updated.");
  });
  panel.onSaveModel(async (model) => {
    await rt.sessionManager.writeModelProfile(model);
    panel.notice("info", zh() ? "模型配置已保存。" : "Model profile saved.");
  });
  panel.onDeleteModel(async (id) => {
    if (isActiveModelProfile(id) && rt.sessionManager.state !== "idle") {
      panel.notice("warning", text(
        "iCode cannot delete the active model profile while the current task is running.",
        "当前任务运行时不能删除正在使用的 iCode 模型配置。",
      ));
      rt.chatPanel?.appendDebugEvent("ModelDeleteBlocked", id);
      return;
    }
    await rt.sessionManager.deleteModelProfile(id);
    rt.chatPanel?.appendDebugEvent("ModelDeleted", id);
    panel.notice("info", zh() ? `模型配置 ${id} 已删除。` : `Model profile ${id} deleted.`);
  });
  panel.onSetActiveModel(async (id) => {
    if (rt.sessionManager.state !== "idle") {
      panel.notice(
        "warning",
        text(
          "iCode cannot switch model profiles while the current task is running.",
          "当前任务运行时不能切换 iCode 模型配置。",
        ),
      );
      rt.chatPanel?.appendDebugEvent("ModelSwitchBlocked", rt.sessionManager.state);
      return;
    }
    await rt.sessionManager.setModel(id);
    await persistPreferredModel(id);
    await refreshRuntimeSnapshot();
    panel.notice("info", zh() ? "当前模型已更新，并保存为 VSIX 默认值。" : "Active model profile updated and saved as the VSIX default.");
    rt.chatPanel?.appendDebugEvent("ModelSwitch", id || "(default)");
  });
  panel.onOpenAgentDialog(async () => {
    await openAgentDialog();
  });
  panel.onOpenModelDialog(async () => {
    await openModelDialog();
  });
  panel.onSetConfig(async (key, value) => {
    const result = await rt.sessionManager.setConfigOption(key, value);
    rememberPreferredConfigOption(
      typeof result.key === "string" ? result.key : key,
      typeof result.value === "string" ? result.value : value,
    );
    await refreshRuntimeSnapshot();
    panel.notice("info", zh() ? `${key} 已更新。` : `${key} updated.`);
  });
  panel.onTestMcp(async (server) => {
    const result = await rt.sessionManager.testMcpServer(server);
    const ok = result.ok === true;
    const message = typeof result.message === "string" ? result.message : JSON.stringify(result);
    if (ok) {
      panel.notice("info", zh() ? `MCP 测试通过：${message}` : `MCP test passed: ${message}`);
    } else {
      panel.notice("warning", zh() ? `MCP 测试失败：${message}` : `MCP test failed: ${message}`);
    }
  });
  try {
    await refreshManagementPanel(panel);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Management panel initial refresh failed: ${message}`);
    panel.notice("error", message);
  }
}

export async function refreshManagementPanel(panel = rt.managementPanel): Promise<void> {
  const sessionManager = rt.sessionManager;
  if (!panel || panel !== rt.managementPanel || !sessionManager) return;
  const [agents, models, optionsPayload] = await Promise.all([
    sessionManager.listAgentProfiles(),
    sessionManager.listModelProfiles(),
    sessionManager.configOptions(),
  ]);
  if (rt.managementPanel !== panel || rt.sessionManager !== sessionManager) return;
  const rawOptions = Array.isArray(optionsPayload.options) ? optionsPayload.options : [];
  const configOptions = rawOptions.map((option) => {
    const record = option as Record<string, unknown>;
    return {
      key: String(record.key ?? ""),
      envKey: String(record.envKey ?? ""),
      value: String(record.value ?? ""),
    };
  }).filter((option) => option.key);
  const state: ManagementState = {
    agents,
    models,
    configOptions,
    activeAgentName: rt.activeAgentName,
    activeModelProfileId: rt.currentRuntime?.modelProfileId || process.env.CHRYS_MODEL_PROFILE || "",
  };
  panel.setState(state);
}

async function showManagementUnavailable(): Promise<void> {
  const message = text(
    "iCode management is unavailable until the iCode ACP runtime is connected.",
    "需要连接 iCode ACP 运行时后才能打开管理面板。",
  );
  const openDoctor = text("Open Doctor", "打开健康检查");
  const binarySettings = text("Set Binary Path", "设置可执行文件路径");
  const openChrys = text("Open iCode", "打开 iCode");
  logWarn(`Management unavailable: session manager missing`);
  rt.chatPanel?.appendDebugEvent("ManagementUnavailable", "session manager missing");
  const selected = await vscode.window.showWarningMessage(message, openDoctor, binarySettings, openChrys);
  if (selected === openDoctor) {
    await vscode.commands.executeCommand("chrys.doctor");
  } else if (selected === binarySettings) {
    await vscode.commands.executeCommand("workbench.action.openSettings", "chrys.binary.path");
  } else if (selected === openChrys) {
    await vscode.commands.executeCommand("chrys.focusChat");
  }
}
