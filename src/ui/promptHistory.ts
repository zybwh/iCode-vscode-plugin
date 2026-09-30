import * as vscode from "vscode";
import { rt } from "../state/runtime";
import { promptHistory } from "../session/promptHistory";
import { hostUiLanguage } from "../common/hostI18n";

export async function showPromptHistory(): Promise<void> {
  const storage = rt.extensionContext?.workspaceState;
  const panel = rt.chatPanel;
  if (!storage || !panel || !rt.currentCwd) return;
  const zh = hostUiLanguage() === "zh-CN";
  const history = promptHistory(storage, rt.currentCwd);
  if (!history.length) {
    void vscode.window.showInformationMessage(zh ? "此工作目录暂无历史输入。发送提示词后可在这里检索。" : "No prompt history for this directory yet. Sent prompts will appear here.");
    return;
  }
  const selected = await vscode.window.showQuickPick(history.map(text => ({
    label: text.replace(/\s+/g, " ").slice(0, 120).replace(/\$\(/g, "\\$("),
    detail: text,
    text,
  })), {
    title: zh ? "历史输入" : "Prompt History",
    placeHolder: zh ? "搜索提示词；选择后填回输入框，不自动发送" : "Search prompts; selecting fills the composer without sending",
    matchOnDetail: true,
  });
  if (selected && rt.chatPanel === panel) panel.setComposer(selected.text);
}
