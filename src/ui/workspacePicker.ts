import * as vscode from "vscode";
import * as path from "node:path";
import { hostUiLanguage } from "../common/hostI18n";

type WorkspaceItem = vscode.QuickPickItem & { directory?: string };

export async function pickWorkspaceDirectory(currentCwd?: string): Promise<string | undefined> {
  const language = hostUiLanguage();
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

/** Explicit scope selection; never implicitly grant all editor roots. */
export async function pickAdditionalDirectories(primary: string, current: string[]): Promise<string[] | undefined> {
  const zh=hostUiLanguage()==="zh-CN";
  const t=(en:string,cn:string)=>zh?cn:en;
  const candidates=new Set([...current,...(vscode.workspace.workspaceFolders??[]).map(f=>f.uri.fsPath)]);
  for(;;){
    const choices=[...candidates].filter(p=>path.resolve(p)!==path.resolve(primary)).map(directory=>({label:path.basename(directory),detail:directory,directory,picked:current.includes(directory)}));
    const picked=await vscode.window.showQuickPick([...choices,{label:t("Browse additional folders…","浏览其他文件夹…"),directory:"",picked:false}],{canPickMany:true,title:t("iCode · Workspace scope","iCode · 工作区访问范围"),placeHolder:t(`Primary: ${primary}. Only selected roots are shared.`,`主目录：${primary}。仅共享选中的额外目录。`),matchOnDetail:true});
    if(!picked)return undefined;
    current=picked.filter(v=>v.directory).map(v=>v.directory);
    if(!picked.some(v=>!v.directory))return [...new Set(current.map(p=>path.resolve(p)))];
    const folders=await vscode.window.showOpenDialog({canSelectFiles:false,canSelectFolders:true,canSelectMany:true,title:t("Additional workspace roots","额外工作区目录")});
    for(const folder of folders??[]){candidates.add(folder.fsPath);current.push(folder.fsPath);}
  }
}
