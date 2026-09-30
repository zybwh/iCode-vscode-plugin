import { restartBackendConnection } from "../../extension";
import { workspaceSelectionTarget } from "../../session/selectionTarget";
import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import { rt } from "../../state/runtime";
import { pickWorkspaceDirectory, pickAdditionalDirectories } from "../workspacePicker";
import { chatPanelState } from "../../common/chatPanelState";
import { refreshRuntimeSnapshot } from "../../handlers/notifications";
import { localized as nativeText } from "../../common/hostI18n";


// ──────────────────────────────────────────────
// Settings / workspace
// ──────────────────────────────────────────────

export async function reloadChrysSettings(): Promise<void> {
  if (!rt.sessionManager) return;
  if (rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText(
      "iCode cannot reload settings while the current task is running. Interrupt or wait for it to finish.",
      "当前任务运行时不能重新加载 iCode 设置。请先中断或等待任务完成。",
    ));
    rt.chatPanel?.appendDebugEvent("SettingsReloadBlocked", rt.sessionManager.state);
    return;
  }
  await rt.sessionManager.reloadSettings();
  rt.chatPanel?.setState(chatPanelState());
  vscode.window.showInformationMessage(nativeText("iCode settings reloaded.", "iCode 设置已重新加载。"));
  rt.chatPanel?.appendDebugEvent("SettingsReloaded", "manual");
}

export async function changeWorkspace(targetPath?: string): Promise<void> {
  if (rt.connectionInitialization) await rt.connectionInitialization;
  if (!rt.sessionManager) return;
  if (rt.sessionManager.state !== "idle") {
    vscode.window.showWarningMessage(nativeText("Cannot change directory while iCode is busy.", "iCode 忙碌时不能切换目录。"));
    rt.chatPanel?.appendDebugEvent("WorkspaceChangeBlocked", rt.sessionManager.state);
    return;
  }
  if (targetPath?.trim() === "roots") {
    if(!rt.supportsAdditionalDirectories){
      vscode.window.showWarningMessage(nativeText("This iCode CLI does not advertise additional-directory support.","当前 iCode CLI 未声明支持额外工作目录。"));return;
    }
    if (!rt.currentCwd) return;
    const roots = await pickAdditionalDirectories(rt.currentCwd, rt.additionalDirectories ?? []);
    if (!roots || rt.sessionManager.state !== "idle") return;
    const previous = rt.additionalDirectories;
    rt.additionalDirectories = roots;
    if (rt.currentSessionId && rt.extensionContext) {
      const empty = (await rt.sessionManager.history()).messages.length === 0;
      if (empty) { rt.clearPersistedSession(); rt.currentSessionId=null; rt.skipRestoreOnce=true; }
      else rt.persistCurrentSession();
      if (!(await restartBackendConnection(rt.extensionContext, rt.currentBinaryPath ?? undefined))) {
        rt.additionalDirectories = previous;
        return;
      }
      if(empty) {
        rt.currentSessionId=await rt.sessionManager.newSession(rt.currentCwd, roots);
        await refreshRuntimeSnapshot();rt.persistCurrentSession();
      }
    }
    rt.chatPanel?.setState(chatPanelState());
    return;
  }
  const expandedTarget = expandWorkspacePath(targetPath);
  if (expandedTarget) {
    const uri = vscode.Uri.file(expandedTarget);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.Directory) {
        vscode.window.showWarningMessage(nativeText(`Not a directory: ${expandedTarget}`, `不是目录：${expandedTarget}`));
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showWarningMessage(nativeText(`Cannot access workspace directory: ${message}`, `无法访问工作区目录：${message}`));
      return;
    }
    await applyWorkspaceChange(expandedTarget);
    return;
  }
  const directory = await pickWorkspaceDirectory(rt.currentCwd ?? undefined);
  if (!directory) return;
  await applyWorkspaceChange(directory);
}

export async function applyWorkspaceChange(targetPath: string): Promise<void> {
  const normalizedTarget = path.resolve(targetPath);
  if (rt.currentCwd && path.resolve(rt.currentCwd) === normalizedTarget) return;
  rt.chatPanel?.appendDebugEvent("WorkspaceChangeRequested", normalizedTarget);
  if (workspaceSelectionTarget(Boolean(rt.currentSessionId)) === "restart-backend") {
    if (!rt.extensionContext) return;
    rt.currentCwd = normalizedTarget;
    rt.skipRestoreOnce = true;
    if (!(await restartBackendConnection(rt.extensionContext))) return;
  } else {
    const result = await rt.sessionManager!.setWorkspace(normalizedTarget);
    rt.currentCwd = result.primaryCwd ?? normalizedTarget;
    if(result.workingDirs)rt.additionalDirectories=result.workingDirs.filter(p=>p!==rt.currentCwd);
  }
  rt.persistCurrentSession();
  rt.chatPanel?.setState(chatPanelState());
  rt.sessionTreeProvider?.refresh();
  const displayCwd = rt.currentCwd;
  vscode.window.setStatusBarMessage(nativeText(
    `iCode workspace changed: ${displayCwd}`,
    `iCode 工作区已切换：${displayCwd}`,
  ), 4000);
  rt.chatPanel?.appendDebugEvent("WorkspaceChanged", displayCwd);
}

export function expandWorkspacePath(targetPath?: string): string | undefined {
  const trimmed = targetPath?.trim();
  if (!trimmed) return undefined;
  const withoutQuotes = trimmed.replace(/^["']|["']$/g, "");
  if (withoutQuotes === "~") return os.homedir();
  if (withoutQuotes.startsWith("~/")) return path.join(os.homedir(), withoutQuotes.slice(2));
  return path.isAbsolute(withoutQuotes)
    ? withoutQuotes
    : path.resolve(rt.currentCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(), withoutQuotes);
}

export function managementTabFromArg(arg?: string): "agents" | "models" | "config" | "mcp" {
  const value = arg?.trim().toLowerCase();
  if (value === "models" || value === "model") return "models";
  if (value === "config" || value === "settings") return "config";
  if (value === "mcp") return "mcp";
  return "agents";
}
