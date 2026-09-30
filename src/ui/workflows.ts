import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { runIcodeCli, parseWorkflowList, workflowRunArgs, type WorkflowSource } from "../workflow/cli";
import { localized as t } from "../common/hostI18n";

const active = new Map<string, AbortController>();
interface RunRecord { workflow: string; cwd: string; time: string; result: string }
const historyKey = "chrys.workflowRuns";
async function showResult(result: string): Promise<void> {
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "json", content: result }), { preview: false });
}
async function sourceHash(source: WorkflowSource): Promise<string> {
  return createHash("sha256").update(await fs.readFile(source.path)).digest("hex");
}
export function disposeWorkflowRuns(): void { for (const controller of active.values()) controller.abort(); }

export async function openWorkflows(context: vscode.ExtensionContext, binary: string | null, cwd: string | null): Promise<void> {
  if (!vscode.workspace.isTrusted) return;
  const choice = await vscode.window.showQuickPick([
    { label: t("Choose workflow", "选择工作流"), action: "list" },
    { label: t("Recent results", "最近运行结果"), action: "history" },
    { label: t("Cancel running workflow", "取消正在运行的工作流"), action: "cancel" },
  ], { title: "iCode Workflow" });
  if (!choice) return;
  if (choice.action === "history") {
    const history = context.workspaceState.get<RunRecord[]>(historyKey, []);
    const item = await vscode.window.showQuickPick(history.map(record => ({ label: record.workflow, description: record.time, detail: record.cwd, record })), {
      title: t("Recent workflow results (local)", "最近工作流结果（本地）"), placeHolder: t("Up to 10 small results; this does not resume a run", "最多保留 10 次小型结果，不恢复运行"),
    });
    if (item) await showResult(item.record.result);
    return;
  }
  if (choice.action === "cancel") {
    const item = await vscode.window.showQuickPick([...active.keys()], { title: t("Cancel workflow in workspace", "取消工作区中的工作流") });
    if (item) active.get(item)?.abort();
    return;
  }
  if (!binary || !cwd) throw new Error(t("Connect iCode and select a workspace first.", "请先连接 iCode 并选择工作区。"));
  if (active.has(cwd)) { await vscode.window.showInformationMessage(t("A workflow is already running in this workspace.", "此工作区已有工作流正在运行。")); return; }
  const controller = new AbortController();
  active.set(cwd, controller);
  try {
    const listed = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t("Discovering workflows", "正在发现工作流"), cancellable: true }, async (_, token) => {
      const subscription = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      try { return await runIcodeCli(binary, ["workflow", "list", "--json"], cwd, controller.signal, 60000); }
      finally { subscription.dispose(); }
    });
    if (listed.cancelled) return;
    if (listed.code !== 0) throw new Error(listed.stderr || t("This iCode CLI does not support workflow list --json.", "当前 iCode CLI 不支持 workflow list --json。"));
    const sources = parseWorkflowList(listed.stdout);
    if (listed.stderr.trim()) await showResult(JSON.stringify({ discoveryWarnings: listed.stderr }, null, 2));
    if (!sources.length) { await vscode.window.showInformationMessage(t("No workflows found.", "未发现工作流。")); return; }
    const picked = await vscode.window.showQuickPick(sources.map(source => ({ label: source.title || source.id, description: `${source.id} · ${source.source}`, detail: source.path, source })), { title: t("Select workflow", "选择工作流") });
    if (!picked || controller.signal.aborted) return;
    const source = picked.source;
    const hash = source.source === "builtin" ? "" : await sourceHash(source);
    if (source.source !== "builtin") {
      // Opening source as text does not import or execute the Python workflow.
      await vscode.window.showTextDocument(vscode.Uri.file(source.path), { preview: true });
    }
    const input = await vscode.window.showInputBox({ title: t("Workflow input", "工作流输入"), prompt: t("Text passed unchanged to the start node (empty is allowed)", "原样传入开始节点的文本（可以为空）"), ignoreFocusOut: true });
    if (input === undefined) return;
    const timeoutText = await vscode.window.showInputBox({ title: t("Run timeout (seconds)", "运行超时（秒）"), value: "600", validateInput: value => Number.isFinite(Number(value)) && Number(value) >= 1 && Number(value) <= 86400 ? undefined : t("Enter 1–86400 seconds", "请输入 1–86400 秒") });
    if (timeoutText === undefined) return;
    const runLabel = t("Run without tool approvals", "免逐项工具审批运行");
    const confirmed = await vscode.window.showWarningMessage(t(
      `Run ${source.id} in ${cwd}? The headless CLI uses its configured default agent and BYPASS approval mode. Tools may modify files and execute commands without asking. ${hash ? `This also trusts the current Python workflow source, topology and environment: ${source.path}` : ""} Results are separate from your chat session.`,
      `在 ${cwd} 运行 ${source.id}？无头 CLI 使用其配置的默认智能体及 BYPASS 审批模式，工具可直接修改文件、执行命令。${hash ? `此次运行还将信任当前 Python 工作流源码、拓扑及环境：${source.path}。` : ""}结果独立于聊天会话。`,
    ), { modal: true }, runLabel);
    if (confirmed !== runLabel || controller.signal.aborted) return;
    if (hash && hash !== await sourceHash(source)) throw new Error(t("Workflow source changed; select and review it again.", "工作流源码已变化，请重新选择并检查。"));
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `iCode Workflow · ${source.id}`, cancellable: true }, async (progress, token) => {
      progress.report({ message: t("Running; the CLI returns structured results on completion", "运行中；CLI 完成后返回结构化结果") });
      const subscription = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      try { return await runIcodeCli(binary, workflowRunArgs(source, input, Number(timeoutText)), cwd, controller.signal, Number(timeoutText) * 1000 + 15000); }
      finally { subscription.dispose(); }
    });
    let output: unknown = null;
    if (result.stdout.trim()) {
      try { output = JSON.parse(result.stdout); } catch { output = { rawOutput: result.stdout }; }
    }
    const report = JSON.stringify({ workflow: source.id, cwd, exitCode: result.code, cancelled: result.cancelled, result: output, diagnostics: result.stderr }, null, 2);
    await showResult(report);
    // Bound local storage. Large outputs remain in the opened document for Save As.
    if (Buffer.byteLength(report) <= 256 * 1024) {
      const history = context.workspaceState.get<RunRecord[]>(historyKey, []);
      await context.workspaceState.update(historyKey, [{ workflow: source.id, cwd, time: new Date().toISOString(), result: report }, ...history].slice(0, 10));
    }
    await vscode.window.showInformationMessage(result.cancelled ? t("Workflow interrupted.", "工作流已中断。") : result.code === 0 ? t("Workflow completed.", "工作流已完成。") : t("Workflow failed; see the result document.", "工作流失败，请查看结果文档。"));
  } finally { active.delete(cwd); }
}
