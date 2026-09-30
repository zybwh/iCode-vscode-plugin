import * as vscode from "vscode";
import { rt, sessionRuntimes, withRuntime, findSessionRuntime } from "../state/runtime";
import { localSessionName, setLocalSessionName, validateSessionName } from "../session/localNames";
import { chatPanelState } from "../common/chatPanelState";
import { refreshOpenSessionsDialog, refreshSessionsSidebar } from "./dialogs";
import { hostUiLanguage } from "../common/hostI18n";

/** Editor-local label, never a write to iCode session files or a private ACP method. */
export async function renameSessionLocally(sessionId = rt.currentSessionId, title?: string, originalTitle?: string): Promise<void> {
  const context = rt.extensionContext;
  if (!context) return;
  const zh = hostUiLanguage() === "zh-CN";
  if (!sessionId) {
    void vscode.window.showInformationMessage(zh ? "请先创建或打开一个会话。" : "Create or open a session first.");
    return;
  }
  const storage = context.workspaceState;
  const invalid = zh ? "名称最多 120 个字符，不能包含换行或控制字符。" : "Use at most 120 characters, without line breaks or control characters.";
  const selected = title ?? await vscode.window.showInputBox({
    title: zh ? "会话本地名称" : "Local Session Name",
    value: localSessionName(storage, sessionId) ?? findSessionRuntime(sessionId)?.currentSessionTitle ?? originalTitle ?? "",
    prompt: zh ? "仅保存在此 VS Code 工作区，不修改 TUI 标题。留空恢复自动标题。" : "Saved only in this VS Code workspace; does not change the TUI title. Leave blank to restore the automatic title.",
    validateInput: value => validateSessionName(value) ? undefined : invalid,
  });
  if (selected === undefined) return;
  if (!validateSessionName(selected)) {
    void vscode.window.showWarningMessage(invalid);
    return;
  }
  await setLocalSessionName(storage, sessionId, selected);
  rt.sessionTreeProvider?.refresh();
  await Promise.all([...sessionRuntimes].filter(owner => owner.extensionContext === context).map(owner => withRuntime(owner, async () => {
    owner.chatPanel?.setState(chatPanelState());
    if (owner.chatPanel) {
      refreshOpenSessionsDialog();
      await refreshSessionsSidebar();
    }
  })));
}
