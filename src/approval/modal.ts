import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { RequestPermissionRequest, PermissionOption, AllowedOutcome, DeniedOutcome } from "../acp/types";
import type { ChatPanel } from "../chat/panel";
import { resolveUiLanguage, type UiLanguage } from "../common/i18n";
import { boolField, objectValue, stringField } from "../common/utils";
import { rt } from "../state/runtime";

export class ApprovalHandler {
  private chatPanelProvider: () => ChatPanel | null;
  private cwdProvider: () => string | null;
  private pendingResolve: ((decision: { optionId?: string; reason?: string }) => void) | null = null;

  constructor(chatPanelProvider: () => ChatPanel | null, cwdProvider: () => string | null) {
    this.chatPanelProvider = chatPanelProvider;
    this.cwdProvider = cwdProvider;
  }

  /** Present the user with a permission prompt. Returns the selected outcome. */
  async requestPermission(req: RequestPermissionRequest): Promise<AllowedOutcome | DeniedOutcome> {
    const panel = this.chatPanelProvider();
    if (!panel) return { outcome: "cancelled" };
    if (this.pendingResolve) {
      // A previous approval prompt is already active — reject the new one
      panel.appendDebugEvent("ApprovalRequestBlocked", req.toolCall.title ?? req.toolCall.toolCallId);
      return { outcome: "cancelled" };
    }
    panel.appendDebugEvent("ApprovalRequest", `${req.toolCall.title ?? req.toolCall.toolCallId}${req.toolCall.kind ? ` [${req.toolCall.kind}]` : ""}`);
    const language = resolveUiLanguage(
      vscode.workspace.getConfiguration("chrys").get<string>("ui.language"),
      vscode.env.language,
    );
    const labels = approvalLabels(language);
    const preview = approvalPreview(req, this.cwdProvider(), labels);
    rt.activeApprovalRequest = {
      requestId: req.toolCall.toolCallId,
      title: req.toolCall.title ?? req.toolCall.toolCallId,
      kind: req.toolCall.kind ?? "",
    };
    const decision = await new Promise<{ optionId?: string; reason?: string }>((resolve) => {
      this.pendingResolve = (value) => {
        this.pendingResolve = null;
        resolve(value);
      };

      panel.setApprovalDialogState({
        requestId: req.toolCall.toolCallId,
        title: labels.title,
        subtitle: req.toolCall.title ?? req.toolCall.toolCallId,
        detail: approvalDetail(req, preview !== undefined, labels),
        preview,
        options: localizedOptions(orderedOptions(req.options), labels),
        reasonEnabled: true,
      });
      panel.requestAttention?.();
    }).finally(() => {
      rt.activeApprovalRequest = null;
      rt.pendingApproval = null;
      rt.chatPanel?.setApprovalDialogState(null);
    });

    if (!decision.optionId) {
      // Dismiss → reject
      panel.appendDebugEvent("ApprovalDecision", "cancelled");
      return { outcome: "cancelled" };
    }

    const selected = req.options.find((option) => option.optionId === decision.optionId);
    if (!selected) return { outcome: "cancelled" };
    const kind = selected.kind;
    panel.appendDebugEvent("ApprovalDecision", `${kind}${decision.reason ? " (reason noted)" : ""}`);
    if (kind === "allow_once" || kind === "allow_always") {
      return {
        outcome: "selected",
        optionId: selected.optionId,
        ...(decision.reason ? { _meta: { reason: decision.reason } } : {}),
      };
    }

    return {
      outcome: "cancelled",
      ...(decision.reason ? { _meta: { reason: decision.reason } } : {}),
    };
  }

  resolve(optionId?: string, reason?: string): void {
    this.pendingResolve?.({ optionId, reason: reason?.trim() || undefined });
  }
}

function orderedOptions(options: PermissionOption[]): PermissionOption[] {
  const rank: Record<PermissionOption["kind"], number> = {
    allow_once: 0,
    allow_always: 1,
    reject_once: 2,
    reject_always: 3,
  };
  return [...options].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

type ApprovalPreview = NonNullable<import("../chat/panel").ChatApprovalDialogState["preview"]>;

type ApprovalLabels = ReturnType<typeof approvalLabels>;

function approvalLabels(language: UiLanguage) {
  return language === "zh-CN"
    ? {
        title: "需要审批",
        tool: "工具",
        kind: "类型",
        review: "审查",
        input: "输入",
        shownInPreview: "已在计划预览中显示",
        newFileContent: "新文件内容",
        plannedOverwrite: "计划覆盖",
        unreadableSnippet: "本地文件不可读，显示替换片段",
        plannedReplacements: (count: number) => `${count} 处计划替换`,
        oldStringMissing: "本地文件预览中未找到 old_string",
        optionNames: {
          allow_once: "允许一次",
          allow_always: "始终允许",
          reject_once: "拒绝一次",
          reject_always: "始终拒绝",
        } as Record<PermissionOption["kind"], string>,
      }
    : {
        title: "Approval Required",
        tool: "Tool",
        kind: "Kind",
        review: "Review",
        input: "Input",
        shownInPreview: "shown in planned preview",
        newFileContent: "New file content",
        plannedOverwrite: "Planned overwrite",
        unreadableSnippet: "File was not readable locally; showing replacement snippet",
        plannedReplacements: (count: number) => `${count} planned replacement(s)`,
        oldStringMissing: "Old string not found in local file preview",
        optionNames: {
          allow_once: "Allow once",
          allow_always: "Always allow",
          reject_once: "Reject once",
          reject_always: "Always reject",
        } as Record<PermissionOption["kind"], string>,
      };
}

function localizedOptions(options: PermissionOption[], labels: ApprovalLabels): PermissionOption[] {
  return options.map((option) => ({
    ...option,
    name: labels.optionNames[option.kind] ?? option.name,
  }));
}

function approvalDetail(req: RequestPermissionRequest, hasPreview: boolean, labels: ApprovalLabels): string {
  const parts = [
    `${labels.tool}: ${req.toolCall.title ?? req.toolCall.toolCallId}`,
    req.toolCall.kind ? `${labels.kind}: ${req.toolCall.kind}` : "",
    req.toolCall.rawOutput !== undefined ? `${labels.review}:\n${formatApprovalValue(req.toolCall.rawOutput)}` : "",
    req.toolCall.rawInput !== undefined ? `${labels.input}:\n${formatApprovalValue(sanitizeApprovalInput(req.toolCall.rawInput, hasPreview, labels))}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}

function sanitizeApprovalInput(value: unknown, hasPreview: boolean, labels: ApprovalLabels): unknown {
  const record = objectValue(value);
  if (!hasPreview || !record) return value;
  const copy: Record<string, unknown> = { ...record };
  for (const key of ["content", "old_string", "new_string"]) {
    if (typeof copy[key] === "string") {
      copy[key] = `(${labels.shownInPreview})`;
    }
  }
  return copy;
}

function approvalPreview(req: RequestPermissionRequest, cwd: string | null, labels: ApprovalLabels): ApprovalPreview | undefined {
  const input = objectValue(req.toolCall.rawInput);
  if (!input) return undefined;
  const filePath = stringField(input, "path") ?? stringField(input, "file_path") ?? stringField(input, "filepath");
  if (!filePath) return undefined;
  const resolvedPath = resolveWorkspacePath(filePath, cwd);
  const before = readTextFilePreview(resolvedPath);

  const content = stringField(input, "content");
  if (content !== undefined) {
    return {
      label: filePath,
      subtitle: before === undefined ? labels.newFileContent : labels.plannedOverwrite,
      before: before ?? "",
      after: content,
    };
  }

  const oldString = stringField(input, "old_string");
  const newString = stringField(input, "new_string");
  if (oldString === undefined || newString === undefined) return undefined;

  if (before === undefined) {
    return {
      label: filePath,
      subtitle: labels.unreadableSnippet,
      before: oldString,
      after: newString,
    };
  }
  const replaceAll = boolField(input, "replace_all") === true;
  const replacements = countOccurrences(before, oldString);
  const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
  return {
    label: filePath,
    subtitle: replacements > 0 ? labels.plannedReplacements(replaceAll ? replacements : Math.min(replacements, 1)) : labels.oldStringMissing,
    before,
    after,
  };
}

function resolveWorkspacePath(filePath: string, cwd: string | null): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd || process.cwd(), filePath);
}

function readTextFilePreview(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 1_000_000) return undefined;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function countOccurrences(text: string, needle: string): number {
  return needle ? text.split(needle).length - 1 : 0;
}

function formatApprovalValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  const max = 4000;
  return text.length > max ? `${text.slice(0, max)}\n... (${text.length} total chars)` : text;
}
