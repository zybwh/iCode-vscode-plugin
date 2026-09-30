import { attachment, editorAttachment, problemsAttachment } from "../../context/attachments";
import * as vscode from "vscode";
import * as path from "node:path";
import { rt } from "../../state/runtime";
import { logError } from "../../common/logging";
import { diffFromSnapshot } from "../../handlers/session";
import { localized as nativeText } from "../../common/hostI18n";
import { languageFromPath, showInlineNotice } from "./common";
import { changeWorkspace } from "./settings";

// ──────────────────────────────────────────────
// File composer helpers
// ──────────────────────────────────────────────

export async function attachFileToComposer(arg?: string): Promise<void> {
  const panel = rt.chatPanel;
  if (!panel) return;
  if (rt.sessionManager && rt.sessionManager.state !== "idle") {
    vscode.window.showInformationMessage(nativeText(
      "Full file attach is available after the current turn finishes. Use @file mention for queued follow-up text.",
      "完整文件附加请在当前轮次结束后使用。排队追加文本可以先使用 @file 引用。",
    ));
    panel.appendDebugEvent("FileAttachBlocked", rt.sessionManager.state);
    return;
  }
  const kind = arg?.trim() || (await vscode.window.showQuickPick([
    {label:nativeText("File", "文件"),sourceKind:"file"},
    {label:nativeText("Editor selection / cursor context", "编辑器选区 / 光标上下文"),sourceKind:"selection"},
    {label:nativeText("Problems", "问题诊断"),sourceKind:"problems"},
  ], {title:nativeText("Attach context", "附加上下文")}))?.sourceKind;
  if (!kind) return;
  if (kind === "selection") {
    const item=editorAttachment();
    if(item)panel.addTextAttachment(item);
    else vscode.window.showInformationMessage(nativeText("Select a text editor first.","请先选择文本编辑器。"));
    return;
  }
  if (kind === "problems") {panel.addTextAttachment(problemsAttachment());return;}
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    defaultUri: rt.currentCwd ? vscode.Uri.file(rt.currentCwd) : undefined,
    title: nativeText("Attach file to iCode prompt", "附加文件到 iCode 输入框"),
  });
  const uri = selected?.[0];
  if (!uri) return;

  const bytes = await vscode.workspace.fs.readFile(uri);
  const maxBytes = 120_000;
  const truncated = bytes.byteLength > maxBytes;
  const text = new TextDecoder("utf-8").decode(truncated ? bytes.slice(0, maxBytes) : bytes);
  const relativePath = vscode.workspace.asRelativePath(uri);
  const language = languageFromPath(relativePath);
  const suffix = truncated
    ? nativeText(`\n\n[File truncated to ${maxBytes} bytes before sending.]`, `\n\n[发送前已将文件截断到 ${maxBytes} bytes。]`)
    : "";
  panel.addTextAttachment(attachment(relativePath + ":1-" + text.split("\n").length + (truncated ? " …" : ""), "@file " + relativePath + ":1-" + text.split("\n").length + "\n```" + language + "\n" + text + "\n```" + suffix));
  panel.appendDebugEvent(
    "FileAttached",
    `${relativePath} (${Math.min(bytes.byteLength, maxBytes)}/${bytes.byteLength} bytes${truncated ? ", truncated" : ""})`,
  );
}

export async function insertFileMention(existingText?: string): Promise<void> {
  const panel = rt.chatPanel;
  if (!panel) return;
  const uri = await pickWorkspaceFile();
  if (!uri) return;
  const relativePath = rt.currentCwd ? path.relative(rt.currentCwd, uri.fsPath) : vscode.workspace.asRelativePath(uri);
  const mention = `@file ${relativePath}`;
  const base = existingText?.trimEnd() ?? "";
  panel.setComposer(base ? `${base} ${mention} ` : `${mention} `);
  panel.appendDebugEvent("FileMentionInserted", relativePath);
}

export type WorkspaceSearchItem = vscode.QuickPickItem & {
  itemType: "match" | "searchView" | "copyResults" | "insertComposer";
  uri?: vscode.Uri;
  line?: number;
  preview?: string;
};

export async function searchWorkspace(initialQuery?: string): Promise<void> {
  const cwd = rt.currentCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    showInlineNotice("warning", nativeText("No workspace directory selected.", "尚未选择工作区目录。"));
    return;
  }

  const query = (initialQuery?.trim() || await vscode.window.showInputBox({
    title: nativeText("Search iCode workspace", "搜索 iCode 工作区"),
    prompt: nativeText("Open VS Code Search scoped to the current iCode workspace.", "打开限定在当前 iCode 工作区的 VS Code 搜索。"),
    placeHolder: nativeText("Text to search", "要搜索的文本"),
  }) || "").trim();
  if (!query) return;

  await openVsCodeSearchView(query, cwd);
}

export async function grepWorkspace(initialQuery?: string): Promise<void> {
  const cwd = rt.currentCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) {
    showInlineNotice("warning", nativeText("No workspace directory selected.", "尚未选择工作区目录。"));
    return;
  }

  const query = (initialQuery?.trim() || await vscode.window.showInputBox({
    title: nativeText("Grep iCode workspace", "检索 iCode 工作区"),
    prompt: nativeText("Show matching lines from the current workspace.", "从当前工作区中列出匹配行。"),
    placeHolder: nativeText("Text to search", "要搜索的文本"),
  }) || "").trim();
  if (!query) return;

  const results: WorkspaceSearchItem[] = [];
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(cwd, "**/*"),
    "**/{.git,node_modules,dist,out,build,coverage,.venv,venv,__pycache__}/**",
    3000,
  );
  const needle = query.toLowerCase();
  const maxBytes = 1_000_000;
  let skippedLarge = 0;
  let skippedBinary = 0;
  let failedReads = 0;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: nativeText(`Searching iCode workspace: ${query}`, `正在检索 iCode 工作区：${query}`),
    cancellable: true,
  }, async (progress, token) => {
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      if (token.isCancellationRequested || results.length >= 80) break;
      const uri = files[fileIndex];
      if (fileIndex % 50 === 0) {
        progress.report({
          message: nativeText(
            `${fileIndex}/${files.length} files, ${results.length} matches`,
            `${fileIndex}/${files.length} 个文件，${results.length} 个匹配`,
          ),
        });
      }
      let bytes: Uint8Array;
      try {
        bytes = await vscode.workspace.fs.readFile(uri);
      } catch (err) {
        failedReads += 1;
        logError(`Workspace search could not read ${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (bytes.byteLength > maxBytes) {
        skippedLarge += 1;
        continue;
      }
      if (bytes.includes(0)) {
        skippedBinary += 1;
        continue;
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length && results.length < 80; index += 1) {
        const lineText = lines[index];
        if (!lineText.toLowerCase().includes(needle)) continue;
        const line = index + 1;
        const relativePath = path.relative(cwd, uri.fsPath);
        const preview = lineText.trim().slice(0, 220);
        results.push({
          itemType: "match",
          label: `${relativePath}:${line}`,
          description: preview,
          detail: uri.fsPath,
          uri,
          line,
          preview,
        });
      }
    }
  });

  const skipped = skippedLarge + skippedBinary;
  const searchStats = nativeText(
    `${results.length} result(s), ${files.length} file(s), ${skipped} skipped, ${failedReads} failed`,
    `${results.length} 个结果，${files.length} 个文件，跳过 ${skipped} 个，失败 ${failedReads} 个`,
  );
  rt.chatPanel?.appendDebugEvent("WorkspaceGrep", `${query} (${searchStats})`);
  if (!results.length) {
    const openSearch = nativeText("Open Search View", "打开搜索视图");
    const selected = await vscode.window.showInformationMessage(nativeText(
      `No results for "${query}". Scanned ${files.length} file(s); skipped ${skipped}; failed ${failedReads}.`,
      `没有找到 “${query}”。已扫描 ${files.length} 个文件；跳过 ${skipped} 个；失败 ${failedReads} 个。`,
    ), openSearch);
    if (selected === openSearch) {
      await openVsCodeSearchView(query, cwd);
    }
    return;
  }
  if (failedReads > 0) {
    vscode.window.showWarningMessage(nativeText(
      `Search found ${results.length} result(s), but ${failedReads} file(s) could not be read.`,
      `搜索找到 ${results.length} 个结果，但有 ${failedReads} 个文件无法读取。`,
    ));
  }

  const resultText = formatWorkspaceSearchResults(query, cwd, results, searchStats);
  const picked = await vscode.window.showQuickPick([
    {
      itemType: "searchView" as const,
      label: nativeText("$(search) Open all results in VS Code Search", "$(search) 在 VS Code 搜索中打开全部结果"),
      description: nativeText("Use the native Search view for full results, filters, and replace.", "使用原生搜索视图查看完整结果、过滤和替换。"),
      detail: query,
    },
    {
      itemType: "copyResults" as const,
      label: nativeText("$(copy) Copy matches", "$(copy) 复制匹配结果"),
      description: nativeText("Copy the shown grep results as text.", "将当前检索结果复制为文本。"),
      detail: searchStats,
    },
    {
      itemType: "insertComposer" as const,
      label: nativeText("$(edit) Insert matches into composer", "$(edit) 插入匹配结果到输入框"),
      description: nativeText("Use these matches as context for the next agent prompt.", "把这些匹配结果作为下一条 agent 提示的上下文。"),
      detail: searchStats,
    },
    ...results,
  ], {
    title: nativeText(`Search: ${query}`, `搜索：${query}`),
    placeHolder: nativeText(`${searchStats}. Select one to open, or open Search view.`, `${searchStats}。选择一个打开，或进入搜索视图。`),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;
  if (picked.itemType === "searchView") {
    await openVsCodeSearchView(query, cwd);
    return;
  }
  if (picked.itemType === "copyResults") {
    await vscode.env.clipboard.writeText(resultText);
    vscode.window.showInformationMessage(nativeText("Search results copied.", "搜索结果已复制。"));
    rt.chatPanel?.appendDebugEvent("WorkspaceGrepCopied", `${query} (${results.length})`);
    return;
  }
  if (picked.itemType === "insertComposer") {
    rt.chatPanel?.setComposer(resultText);
    rt.chatPanel?.appendDebugEvent("WorkspaceGrepInserted", `${query} (${results.length})`);
    return;
  }
  if (!picked.uri || picked.line === undefined) return;
  const doc = await vscode.workspace.openTextDocument(picked.uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  const position = new vscode.Position(Math.max(0, picked.line - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function formatWorkspaceSearchResults(query: string, cwd: string, results: WorkspaceSearchItem[], searchStats: string): string {
  const lines = [
    nativeText(`Search results for "${query}"`, `“${query}” 的搜索结果`),
    nativeText(`Workspace: ${cwd}`, `工作区：${cwd}`),
    searchStats,
    "",
    ...results
      .filter((item) => item.itemType === "match")
      .map((item) => `- ${item.label}${item.preview ? `: ${item.preview}` : ""}`),
  ];
  return lines.join("\n").trimEnd();
}

export async function openVsCodeSearchView(query: string, cwd: string): Promise<void> {
  try {
    const args: Record<string, unknown> = {
      query,
      triggerSearch: true,
      isRegex: false,
      isCaseSensitive: false,
      matchWholeWord: false,
    };
    const includePattern = searchIncludePattern(cwd);
    if (includePattern) {
      args.filesToInclude = includePattern;
    }
    await vscode.commands.executeCommand("workbench.action.findInFiles", args);
    rt.chatPanel?.appendDebugEvent("WorkspaceSearchView", query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Failed to open VS Code Search view: ${message}`);
    vscode.window.showWarningMessage(nativeText(`Could not open VS Code Search view: ${message}`, `无法打开 VS Code 搜索视图：${message}`));
  }
}

export function searchIncludePattern(cwd: string): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cwd));
  if (!folder) return cwd;
  const relative = path.relative(folder.uri.fsPath, cwd).replaceAll(path.sep, "/");
  if (!relative || relative === ".") return undefined;
  return `${relative}/**`;
}

export async function findWorkspaceFile(initialQuery?: string): Promise<void> {
  const uri = await pickWorkspaceFile(initialQuery?.trim());
  if (!uri) return;
  await vscode.window.showTextDocument(uri, { preview: true });
  const relativePath = rt.currentCwd ? path.relative(rt.currentCwd, uri.fsPath) : vscode.workspace.asRelativePath(uri);
  rt.chatPanel?.appendDebugEvent("WorkspaceFileOpen", relativePath);
}

export async function pickWorkspaceFile(initialQuery?: string): Promise<vscode.Uri | undefined> {
  if (!rt.currentCwd) {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: nativeText("Select file to mention", "选择要引用的文件"),
    });
    return selected?.[0];
  }

  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(rt.currentCwd, "**/*"),
    "**/{.git,node_modules,dist,out,build,coverage,.venv,venv,__pycache__}/**",
    3000,
  );
  const openItems = openEditorFileItems();
  const openPaths = new Set(openItems.map((item) => item.uri.fsPath));
  const query = initialQuery?.trim().toLowerCase() || "";
  const items = [
    ...openItems,
    ...files
      .filter((uri: vscode.Uri) => !openPaths.has(uri.fsPath))
      .map((uri: vscode.Uri) => {
        const relativePath = path.relative(rt.currentCwd!, uri.fsPath);
        return { label: relativePath, description: path.dirname(relativePath), detail: nativeText("Workspace file", "工作区文件"), uri };
      }),
  ]
    .filter((item) => !query || `${item.label} ${item.description} ${item.detail}`.toLowerCase().includes(query))
    .sort((left, right) => {
      const leftOpen = left.detail?.startsWith("Open") ? 0 : 1;
      const rightOpen = right.detail?.startsWith("Open") ? 0 : 1;
      return leftOpen - rightOpen || left.label.localeCompare(right.label);
    });
  if (!items.length) {
    if (query) {
      vscode.window.showInformationMessage(nativeText(`No workspace files match "${initialQuery}".`, `没有匹配 “${initialQuery}” 的工作区文件。`));
      return undefined;
    }
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(rt.currentCwd),
      title: nativeText("Select file to mention", "选择要引用的文件"),
    });
    return selected?.[0];
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: initialQuery
      ? nativeText(`Open or mention a file matching "${initialQuery}"`, `打开或引用匹配 “${initialQuery}” 的文件`)
      : nativeText("Mention an open or workspace file", "引用已打开文件或工作区文件"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.uri;
}

export function openEditorFileItems(): Array<{ label: string; description: string; detail: string; uri: vscode.Uri }> {
  const byPath = new Map<string, vscode.Uri>();
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri?.scheme === "file") {
    byPath.set(activeUri.fsPath, activeUri);
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.scheme === "file") {
      byPath.set(editor.document.uri.fsPath, editor.document.uri);
    }
  }
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.scheme === "file") {
        byPath.set(input.uri.fsPath, input.uri);
      }
    }
  }
  return [...byPath.values()]
    .map((uri) => {
      const relativePath = rt.currentCwd ? path.relative(rt.currentCwd, uri.fsPath) : vscode.workspace.asRelativePath(uri);
      return {
        label: relativePath,
        description: path.dirname(relativePath),
        detail: uri.fsPath === activeUri?.fsPath
          ? nativeText("Open file - active editor", "已打开文件 - 当前编辑器")
          : nativeText("Open file", "已打开文件"),
        uri,
      };
    });
}

// ──────────────────────────────────────────────
// Terminal / file navigation
// ──────────────────────────────────────────────

export function openWorkspaceShell(command?: string): void {
  const cwd = rt.currentCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const normalizedCwd = cwd ? path.resolve(cwd) : undefined;
  const terminalCwdChanged = normalizedCwd && rt.workspaceTerminalCwd && path.resolve(rt.workspaceTerminalCwd) !== normalizedCwd;
  if (terminalCwdChanged && rt.workspaceTerminal && !rt.workspaceTerminal.exitStatus) {
    rt.workspaceTerminal.dispose();
    rt.chatPanel?.appendDebugEvent("ShellRecreated", `${rt.workspaceTerminalCwd} -> ${normalizedCwd}`);
    rt.workspaceTerminal = null;
    rt.workspaceTerminalCwd = null;
  }
  if (!rt.workspaceTerminal || rt.workspaceTerminal.exitStatus) {
    rt.workspaceTerminal = vscode.window.createTerminal({
      name: "iCode Shell",
      cwd: normalizedCwd,
    });
    rt.workspaceTerminalCwd = normalizedCwd ?? null;
  }
  const terminal = rt.workspaceTerminal;
  terminal.show();
  const trimmedCommand = command?.trim();
  if (trimmedCommand) {
    terminal.sendText(trimmedCommand, true);
    vscode.window.setStatusBarMessage(nativeText(
      `iCode Shell: running ${trimmedCommand.slice(0, 80)}`,
      `iCode 终端：正在运行 ${trimmedCommand.slice(0, 80)}`,
    ), 3500);
    rt.chatPanel?.appendDebugEvent("ShellCommand", `${normalizedCwd ?? "(default cwd)"} :: ${trimmedCommand.slice(0, 120)}`);
  } else {
    vscode.window.setStatusBarMessage(nativeText(
      `iCode Shell opened in ${normalizedCwd ?? "default terminal cwd"}`,
      `iCode 终端已打开：${normalizedCwd ?? "默认终端目录"}`,
    ), 3500);
    rt.chatPanel?.appendDebugEvent("ShellOpened", normalizedCwd ?? "(default cwd)");
  }
}

export async function openToolDiff(toolCallId: string): Promise<void> {
  const snapshot = rt.toolSnapshots.get(toolCallId);
  const diff = snapshot ? diffFromSnapshot(snapshot) : null;
  if (!diff) {
    vscode.window.showInformationMessage(nativeText("No diff is available for this tool call.", "这个工具调用没有可用差异。"));
    return;
  }

  const safeId = encodeURIComponent(`${rt.tabId}:${toolCallId}`);
  const left = vscode.Uri.parse(`chrys-diff:/${safeId}/before/${encodeURIComponent(diff.label)}`);
  const right = vscode.Uri.parse(`chrys-diff:/${safeId}/after/${encodeURIComponent(diff.label)}`);
  rt.diffDocuments.set(left.path, diff.before);
  rt.diffDocuments.set(right.path, diff.after);
  await vscode.commands.executeCommand("vscode.diff", left, right, `iCode Diff: ${diff.label}`);
}

export async function openWorkspaceFile(filePath: string, line?: number): Promise<void> {
  if (!rt.currentCwd) {
    const change = nativeText("Change Workspace", "切换工作区");
    rt.chatPanel?.appendDebugEvent("WorkspaceFileOpenFailed", `${filePath}: no workspace`);
    const selected = await vscode.window.showWarningMessage(
      nativeText(
        `Cannot open ${filePath} because no iCode workspace is selected.`,
        `无法打开 ${filePath}，因为尚未选择 iCode 工作区。`,
      ),
      change,
    );
    if (selected === change) {
      await changeWorkspace();
    }
    return;
  }
  const uri = vscode.Uri.file(requirePathJoin(rt.currentCwd, filePath));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    if (line !== undefined && Number.isFinite(line) && line > 0) {
      const position = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    rt.chatPanel?.appendDebugEvent("WorkspaceFileOpen", `${filePath}${line ? `:${line}` : ""}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rt.chatPanel?.appendDebugEvent("WorkspaceFileOpenFailed", `${filePath}: ${message}`);
    const openSearch = nativeText("Open Search", "打开搜索");
    const selected = await vscode.window.showWarningMessage(
      nativeText(`Unable to open ${filePath}: ${message}`, `无法打开 ${filePath}：${message}`),
      openSearch,
    );
    if (selected === openSearch) {
      await searchWorkspace(path.basename(filePath));
    }
  }
}

export function requirePathJoin(base: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(base, target);
}
