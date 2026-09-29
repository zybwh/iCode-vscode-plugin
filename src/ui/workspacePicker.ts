import * as vscode from "vscode";
import * as path from "node:path";
import { resolveUiLanguage } from "../common/i18n";

type WorkspaceItem = vscode.QuickPickItem & { directory?: string };

export async function pickWorkspaceDirectory(currentCwd?: string): Promise<string | undefined> {
  const language = resolveUiLanguage(vscode.workspace.getConfiguration("chrys").get<string>("ui.language"), vscode.env.language);
  const text = (en: string, zh: string): string => language === "zh-CN" ? zh : en;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length) {
    const items: WorkspaceItem[] = folders.map(folder => ({
      label: folder.name,
      description: currentCwd && path.resolve(folder.uri.fsPath) === path.resolve(currentCwd)
        ? text("Current directory", "当前目录") : undefined,
      detail: folder.uri.fsPath,
      directory: folder.uri.fsPath,
    }));
    items.push({ label: text("Browse other directory…", "浏览其他目录…") });
    const selected = await vscode.window.showQuickPick(items, {
      title: text("iCode working directory", "iCode 工作目录"),
      placeHolder: text("Select a folder from the VS Code workspace", "选择 VS Code 工作区中的文件夹"),
      matchOnDetail: true,
    });
    if (!selected) return undefined;
    if (selected.directory) return selected.directory;
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: currentCwd ? vscode.Uri.file(currentCwd) : undefined,
    title: text("Select iCode workspace directory", "选择 iCode 工作区目录"),
  });
  return selected?.[0]?.fsPath;
}
