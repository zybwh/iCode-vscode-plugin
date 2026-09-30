import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { resolveUiLanguage } from "../common/i18n";
import { runIcodeCli } from "../workflow/cli";
import { parseTrajectory, trajectoryHtml } from "../trajectory/report";
import type { ListSessionsResponse } from "../acp/types";

type Source = { kind: "session" | "events"; value: string; cwd: string; label: string };
export type TrajectoryFormat = "json" | "csv" | "perfetto" | "findings-csv";
export function trajectoryArgs(source: Pick<Source, "kind" | "value">, format: TrajectoryFormat, out: string): string[] {
  return ["trajectory", "export", `--${source.kind}=${source.value}`, "--format", format, "--out", out];
}
const controllers = new Set<AbortController>();
export function disposeTrajectory(): void { for (const controller of controllers) controller.abort(); }

export async function openTrajectory(context: vscode.ExtensionContext, binary: string | null, cwd: string | null, sessionId: string | null,
  listSessions?: (cwd: string, cursor?: string) => Promise<ListSessionsResponse>): Promise<void> {
  const zh = resolveUiLanguage(vscode.workspace.getConfiguration("chrys").get<string>("ui.language"), vscode.env.language) === "zh-CN";
  const t = (en: string, cn: string) => zh ? cn : en;
  if (!vscode.workspace.isTrusted) return;
  if (!binary || !cwd) throw new Error(t("Connect iCode and select a workspace first.", "请先连接 iCode 并选择工作区。"));
  const choice = await vscode.window.showQuickPick([
    ...(sessionId ? [{ label: t("Current session", "当前会话"), value: "current" }] : []),
    ...(listSessions ? [{ label: t("Saved sessions", "已保存会话"), value: "saved" }] : []),
    { label: t("Enter session ID (including Workflow)", "输入会话 ID（含工作流）"), value: "id" },
    { label: t("Choose trajectory events file", "选择轨迹事件文件"), value: "events" },
  ], { title: "iCode · Usage & Trajectory" });
  if (!choice) return;
  let source: Source;
  if (choice.value === "current") source = { kind: "session", value: sessionId!, cwd, label: sessionId! };
  else if (choice.value === "saved") {
    let cursor: string | undefined;
    let selected: Source | undefined;
    const seenCursors = new Set<string>();
    for (;;) {
      const page = await listSessions!(cwd, cursor);
      const more = page.nextCursor && !seenCursors.has(page.nextCursor) ? page.nextCursor : undefined;
      const entries = page.sessions.map(session => ({ label: session.title || session.sessionId, description: session.updatedAt, detail: session.cwd, source: { kind: "session" as const, value: session.sessionId, cwd: session.cwd || cwd, label: session.title || session.sessionId } }));
      const picked = await vscode.window.showQuickPick([...entries, ...(more ? [{ label: t("Next page", "下一页"), description: "", detail: "", source: undefined }] : [])], { title: t("Select recorded session", "选择历史会话") });
      if (!picked) return;
      if (picked.source) { selected = picked.source; break; }
      if (!more) return;
      seenCursors.add(more); cursor = more;
    }
    source = selected;
  } else if (choice.value === "events") {
    const files = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, filters: { "Trajectory events": ["jsonl"] } });
    if (!files?.[0]) return;
    source = { kind: "events", value: files[0].fsPath, cwd, label: files[0].fsPath };
  } else {
    const id = await vscode.window.showInputBox({ title: t("Session ID or unique prefix", "会话 ID 或唯一前缀"), validateInput: value => value.trim() ? undefined : t("Enter a session ID", "请输入会话 ID") });
    if (!id) return;
    source = { kind: "session", value: id.trim(), cwd, label: id.trim() };
  }
  const action = await vscode.window.showQuickPick([
    { label: t("View usage and timeline", "查看用量和时间线"), format: "view" },
    { label: "JSON", format: "json" }, { label: "CSV", format: "csv" },
    { label: "Perfetto", format: "perfetto" }, { label: t("Findings CSV", "分析发现 CSV"), format: "findings-csv" },
  ], { title: t("Trajectory analysis / export", "轨迹分析 / 导出") });
  if (!action) return;
  const format = action.format === "view" ? "json" : action.format as TrajectoryFormat;
  const destination = action.format === "view" ? undefined : await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(cwd, `trajectory.${format === "csv" || format === "findings-csv" ? "csv" : format === "perfetto" ? "perfetto.json" : "json"}`)),
    title: t("Save trajectory export (paths redacted)", "保存轨迹导出（路径脱敏）"),
  });
  if (action.format !== "view" && !destination) return;
  if (destination && destination.scheme !== "file") throw new Error(t("Choose a local file destination.", "请选择本地文件路径。"));
  if (destination && /\.jsonl$/i.test(destination.fsPath)) throw new Error(t("Choose a JSON or CSV export file, not an events JSONL file.", "请选择 JSON 或 CSV 导出文件，不能写入事件 JSONL 文件。"));
  if (destination && source.kind === "events") {
    const targetPath = await fs.realpath(destination.fsPath).catch(() => path.resolve(destination.fsPath));
    if (targetPath === await fs.realpath(source.value)) throw new Error(t("Do not overwrite the source events file.", "不能覆盖原始轨迹文件。"));
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "icode-trajectory-"));
  const output = path.join(directory, "export");
  const controller = new AbortController(); controllers.add(controller);
  try {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("Analyzing trajectory", "正在分析轨迹"), cancellable: true }, async (_, token) => {
      const subscription = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      try { return await runIcodeCli(binary, trajectoryArgs(source, format, output), source.cwd, controller.signal, 120000); }
      finally { subscription.dispose(); }
    });
    if (result.cancelled) return;
    if (result.code !== 0) throw new Error(result.stderr || t("Trajectory export failed; this CLI may not support it or the session has no recorded trajectory.", "轨迹导出失败：当前 CLI 可能不支持此命令，或会话没有轨迹记录。"));
    if (destination) {
      await fs.copyFile(output, destination.fsPath);
      await vscode.window.showTextDocument(destination, { preview: false });
    } else {
      if ((await fs.stat(output)).size > 32 * 1024 * 1024) throw new Error(t("Report exceeds 32 MiB. Use JSON or Perfetto export instead.", "报告超过 32 MiB，请使用 JSON 或 Perfetto 导出。"));
      const data = parseTrajectory(await fs.readFile(output, "utf8"));
      const panel = vscode.window.createWebviewPanel("chrys.trajectory", t("iCode · Usage & Trajectory", "iCode · 用量与执行轨迹"), vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
      panel.webview.html = trajectoryHtml(data, source.label, zh, randomBytes(16).toString("hex"));
      let refreshing = false, disposed = false;
      let activeRefresh: AbortController | undefined;
      panel.onDidDispose(() => { disposed = true; activeRefresh?.abort(); });
      panel.webview.onDidReceiveMessage(async (message: {type?: string}) => {
        if(message.type !== "refresh" || refreshing || disposed || !vscode.workspace.isTrusted) return;
        refreshing = true;
        await panel.webview.postMessage({type:"status",busy:true});
        const refreshController = new AbortController();activeRefresh=refreshController;controllers.add(refreshController);
        let scratch: string | undefined;
        let refreshError = "";
        try {
          scratch = await fs.mkdtemp(path.join(os.tmpdir(), "icode-trajectory-"));
          const target = path.join(scratch,"export.json");
          const updated = await runIcodeCli(binary,trajectoryArgs(source,"json",target),source.cwd,refreshController.signal,120000);
          if(disposed || updated.cancelled)return;
          if(updated.code!==0)throw new Error(updated.stderr || t("Refresh failed","刷新失败"));
          if((await fs.stat(target)).size>32*1024*1024)throw new Error(t("Report exceeds 32 MiB. Export JSON instead.","报告超过 32 MiB，请导出 JSON。"));
          const next=parseTrajectory(await fs.readFile(target,"utf8"));
          if(!disposed)panel.webview.html=trajectoryHtml(next,source.label,zh,randomBytes(16).toString("hex"));
        } catch(error) {refreshError=String(error);}
        finally {refreshing=false;controllers.delete(refreshController);activeRefresh=undefined;if(scratch)await fs.rm(scratch,{recursive:true,force:true});if(!disposed)await panel.webview.postMessage({type:"status",busy:false,error:refreshError});}
      });
      context.subscriptions.push(panel);
    }
    if (result.stderr.trim()) await vscode.window.showWarningMessage(result.stderr.trim());
  } finally {
    controllers.delete(controller);
    await fs.rm(directory, { recursive: true, force: true });
  }
}
