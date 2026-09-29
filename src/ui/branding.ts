import * as vscode from "vscode";
import { UI_BRANDS, resolveUiBrand, type UiBrand } from "../common/uiBrand";
import { resolveUiLanguage } from "../common/i18n";
import { chatPanelState } from "../common/chatPanelState";
import { rt } from "../state/runtime";

export async function pickUiBrand(): Promise<void> {
  const config = vscode.workspace.getConfiguration("chrys");
  const current = resolveUiBrand(config.get<string>("ui.brand"));
  const zh = resolveUiLanguage(config.get<string>("ui.language"), vscode.env.language) === "zh-CN";
  const selected = await vscode.window.showQuickPick(
    (Object.keys(UI_BRANDS) as UiBrand[]).map((id) => ({
      id, label: UI_BRANDS[id].name,
      description: id === current ? (zh ? "当前" : "Current") : undefined,
      picked: id === current,
    })),
    { title: zh ? "品牌标识" : "Brand mark", placeHolder: zh ? "选择欢迎页标识" : "Choose the welcome brand" },
  );
  if (!selected || selected.id === current) return;
  const scope = config.inspect<string>("ui.brand");
  const target = scope?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await config.update("ui.brand", selected.id, target);
  rt.chatPanel?.setState(chatPanelState());
}
