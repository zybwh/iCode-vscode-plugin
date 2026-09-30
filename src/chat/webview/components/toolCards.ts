import type { ContentBlock } from "../../../acp/types";
import type { ChatMessage } from "../../provider";
import { objectValue, stringField, numberField } from "../../../common/utils";
import { normalizeToolKind } from "../../../common/toolRendering";
import { state } from "../state";
import { el, formatJson, imageDataUri } from "../helpers";
import { renderMarkdown } from "../renderer";

export { normalizeToolKind } from "../../../common/toolRendering";

export function effectiveToolStatus(message: ChatMessage): string {
  const status = message.toolStatus ?? "pending";
  if ((status === "pending" || status === "in_progress") && message.toolOutput) {
    return "completed";
  }
  return status;
}

export function toolStatusIcon(status: string): string {
  if (status === "completed") return "✓";
  if (status === "failed") return "✗";
  if (status === "in_progress") return "…";
  return "•";
}

type LocalizedLabel = {
  en: string;
  zh: string;
};

const TOOL_KIND_LABELS: Record<string, LocalizedLabel> = {
  read: { en: "Read", zh: "读取" },
  edit: { en: "Edit", zh: "编辑" },
  delete: { en: "Delete", zh: "删除" },
  move: { en: "Move", zh: "移动" },
  search: { en: "Search", zh: "搜索" },
  execute: { en: "Shell", zh: "终端" },
  think: { en: "Think", zh: "思考" },
  fetch: { en: "Fetch", zh: "抓取" },
  sleep: { en: "Sleep", zh: "等待" },
  ask_user: { en: "Ask", zh: "询问" },
  mcp: { en: "MCP", zh: "MCP" },
  doc_converter: { en: "Document", zh: "文档" },
  sub_agent: { en: "Sub-agent", zh: "子智能体" },
  skill: { en: "Skill", zh: "技能" },
};

const TOOL_STATUS_LABELS_ZH: Record<string, string> = {
  pending: "等待中",
  in_progress: "进行中",
  completed: "已完成",
  failed: "失败",
  skipped: "已跳过",
  interrupted: "已中断",
};

export function toolKindLabel(kind: string, toolName = ""): string {
  const normalizedKind = normalizeToolKind(kind, toolName);
  const label = TOOL_KIND_LABELS[normalizedKind];
  return state.uiLanguage === "zh-CN" ? (label?.zh ?? "工具") : (label?.en ?? "Tool");
}

function toolText(en: string, zh: string): string {
  return state.uiLanguage === "zh-CN" ? zh : en;
}

function toolStatusLabel(status: string): string {
  if (state.uiLanguage !== "zh-CN") return status;
  return TOOL_STATUS_LABELS_ZH[status] ?? status;
}

function toolStatusValueClass(status: string): string {
  switch (status) {
    case "completed":
      return "status-ok";
    case "failed":
      return "status-failed";
    default:
      return "";
  }
}

export function isSleepTool(msg: ChatMessage): boolean {
  return normalizeToolKind(msg.toolKind, msg.toolName) === "sleep";
}

export function formatSleepSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return String(seconds);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

export function outputSummary(output: string): string {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0).length;
  if (state.uiLanguage === "zh-CN") {
    return `${output.length} 字符${lines ? ` · ${lines} 行` : ""}`;
  }
  return `${output.length} chars${lines ? ` · ${lines} line${lines === 1 ? "" : "s"}` : ""}`;
}

export function toolSummaryRow(label: string, value: string, valueClass = "", action?: "open-file"): HTMLElement {
  return el("div", { class: "tool-card-summary-row" },
    el("span", { class: "tool-card-summary-label" }, label),
    action === "open-file"
      ? el("button", {
        class: `tool-card-summary-value link ${valueClass}`.trim(),
        "data-file-path": value,
        title: state.uiLanguage === "zh-CN" ? `打开 ${value}` : `Open ${value}`,
        "aria-label": state.uiLanguage === "zh-CN" ? `打开文件 ${value}` : `Open file ${value}`,
      }, value)
      : el("span", { class: `tool-card-summary-value ${valueClass}`.trim() }, value),
  );
}

export function toolSummaryElements(msg: ChatMessage): HTMLElement[] {
  const input = objectValue(msg.toolInput);
  const rows: HTMLElement[] = [];
  const command = stringField(input, "command") ?? stringField(input, "cmd");
  const shell = stringField(input, "shell") ?? stringField(input, "executable");
  const description = stringField(input, "description");
  const path = stringField(input, "path")
    ?? stringField(input, "file_path")
    ?? stringField(input, "filepath")
    ?? stringField(input, "target_file");
  const oldPath = stringField(input, "old_path") ?? stringField(input, "source");
  const newPath = stringField(input, "new_path") ?? stringField(input, "destination");
  const query = stringField(input, "query") ?? stringField(input, "pattern") ?? stringField(input, "search");
  const approval = stringField(input, "approval") ?? stringField(input, "approval_status");
  const invocationId = stringField(input, "invocationId") ?? stringField(input, "invocation_id");
  const subAgentName = stringField(input, "agentName") ?? stringField(input, "agent_name");

  const status = effectiveToolStatus(msg);
  rows.push(toolSummaryRow(
    toolText("Status", "状态"),
    `${toolStatusIcon(status)} ${toolStatusLabel(status)}`,
    toolStatusValueClass(status),
  ));
  if (path) {
    rows.push(toolSummaryRow(toolText("File", "文件"), path, "", "open-file"));
  }
  if (oldPath || newPath) {
    rows.push(toolSummaryRow(toolText("Move", "移动"), `${oldPath ?? "?"} → ${newPath ?? "?"}`, "code"));
  }
  if (description) {
    rows.push(toolSummaryRow(toolText("Task", "任务"), description));
  }
  if (shell) {
    rows.push(toolSummaryRow(toolText("Shell", "终端"), shell, "code"));
  }
  if (command) {
    rows.push(toolSummaryRow(toolText("Command", "命令"), command, "code"));
  }
  if (query) {
    rows.push(toolSummaryRow(toolText("Query", "查询"), query, "code"));
  }
  if (approval) {
    rows.push(toolSummaryRow(toolText("Approval", "审批"), approval));
  }
  if (invocationId) {
    rows.push(toolSummaryRow(toolText("Sub-agent", "子智能体"), subAgentName ? `${subAgentName} · ${invocationId}` : invocationId, "code"));
  }
  if (msg.toolOutput) {
    rows.push(toolSummaryRow(toolText("Output", "输出"), outputSummary(msg.toolOutput)));
  }
  return rows.length ? [el("div", { class: "tool-card-summary-grid" }, ...rows)] : [];
}

export function renderToolCall(msg: ChatMessage): HTMLElement {
  let card: HTMLElement;
  if (isSleepTool(msg)) {
    card = renderSleepToolCall(msg);
  } else if (msg.innerToolCalls || msg.subAgentPaused || normalizeToolKind(msg.toolKind, msg.toolName) === "sub_agent") {
    card = renderSubAgentToolCall(msg);
  } else {
    const toolKind = normalizeToolKind(msg.toolKind, msg.toolName);
    if (toolKind === "execute") card = renderShellToolCall(msg);
    else if (toolKind === "search") card = renderSearchToolCall(msg);
    else if (toolKind === "read") card = renderReadToolCall(msg);
    else if (toolKind === "skill") card = renderSkillToolCall(msg);
    else if (toolKind === "ask_user") card = renderAskUserToolCall(msg);
    else if (toolKind === "doc_converter") card = renderDocumentToolCall(msg);
    else if (toolKind === "mcp") card = renderMcpToolCall(msg);
    else if (toolKind === "edit" || toolKind === "delete" || toolKind === "write" || toolKind === "move") card = renderEditToolCall(msg);
    else card = renderGenericToolCall(msg);
  }
  const structuredContent = structuredToolContentForDisplay(msg.toolContent ?? [], msg.toolOutput);
  if (structuredContent.length) card.append(renderStructuredToolContent(structuredContent));
  return card;
}

export function structuredToolContentForDisplay(blocks: ContentBlock[], rawOutput?: string): ContentBlock[] {
  const output = rawOutput?.trim();
  if (!output) return blocks;
  const truncatedPrefix = output.replace(/\n\.\.\. \(truncated, \d+ total chars\)$/, "");
  return blocks.filter((block) => {
    if (block.type !== "text") return true;
    const text = block.text.trim();
    return !(
      containsCompleteTextSegment(output, text)
      || containsCompleteTextSegment(text, output)
      || (truncatedPrefix !== output && text.startsWith(truncatedPrefix))
    );
  });
}

function containsCompleteTextSegment(container: string, candidate: string): boolean {
  if (!candidate) return false;
  return container === candidate
    || container.startsWith(`${candidate}\n`)
    || container.endsWith(`\n${candidate}`)
    || container.includes(`\n${candidate}\n`);
}

export function renderStructuredToolContent(blocks: ContentBlock[]): HTMLElement {
  return el("section", { class: "tool-structured-content" },
    el("div", { class: "tool-structured-title" }, toolText("Content", "结构化内容")),
    ...blocks.map((block) => {
      if (block.type === "text") {
        return el("div", { class: "tool-structured-text", innerHTML: renderMarkdown(block.text) });
      }
      if (block.type === "image") {
        return el("img", {
          class: "tool-structured-image",
          src: imageDataUri(block.mimeType, block.data),
          alt: toolText("Tool image", "工具图片"),
        });
      }
      if (block.type === "resource_link") {
        return el("button", {
          class: "tool-resource-link",
          "data-resource-uri": block.uri,
          title: block.description ?? block.uri,
        }, block.title || block.name || block.uri);
      }
      if (block.type === "resource") {
        const resource = block.resource;
        return "text" in resource
          ? el("div", { class: "tool-structured-resource" },
            el("div", { class: "tool-structured-resource-uri" }, resource.uri),
            el("pre", { class: "tool-card-output" }, resource.text),
          )
          : el("div", { class: "tool-structured-resource" }, `${resource.uri} · ${resource.mimeType ?? toolText("binary resource", "二进制资源")}`);
      }
      return el("div", { class: "tool-structured-resource" }, toolText(`Audio (${block.mimeType})`, `音频（${block.mimeType}）`));
    }),
  );
}

function renderGenericToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const toolKind = normalizeToolKind(msg.toolKind, msg.toolName);
  const toolLabel = toolKindLabel(toolKind);
  const input = formatJson(msg.toolInput);
  const output = msg.toolOutput ?? "";
  const summary = toolSummaryElements(msg);
  const isActive = statusClass === "pending" || statusClass === "in_progress";
  return el("div", { class: `tool-card ${statusClass}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolLabel),
      el("span", { class: "tool-card-name" }, msg.toolName ?? msg.toolCallId ?? ""),
      msg.canDiff && msg.toolCallId ? el("button", { class: "tool-card-action", "data-tool-call-id": msg.toolCallId }, toolText("Diff", "差异")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(statusClass)} ${toolStatusLabel(statusClass)}`),
    ),
    ...summary,
    el("details", { class: "tool-card-body", open: isActive ? "" : undefined },
      el("summary", { class: "tool-card-summary" }, output ? toolText("Output", "输出") : toolText("Details", "详情")),
      input ? el("pre", { class: "tool-card-input" }, input) : "",
      output ? renderToolOutput(output) : "",
    ),
  );
}

export function isToolErrorMessage(output: string): boolean {
  return output.trimStart().startsWith("Error:");
}

function renderToolOutput(output: string, className = ""): HTMLElement {
  if (isToolErrorMessage(output)) {
    return el("div", { class: "tool-error-message" }, output.trimEnd());
  }
  return el("pre", { class: `tool-card-output ${className}`.trim() }, output);
}

const ASK_USER_RESPONSE_PREFIX = "User response:";

type AskUserOutputParts = {
  question: string;
  answer: string;
  options: string[];
  questions: AskUserQuestionParts[];
  isError: boolean;
  answered: boolean;
};

type AskUserQuestionParts = {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string }>;
  answers: string[];
  note: string;
  unanswered: boolean;
};

function stringArrayField(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

export function parseAskUserToolOutput(input: Record<string, unknown>, output: string): AskUserOutputParts {
  const questions = parseAskUserQuestions(input);
  const first = questions[0] ?? emptyAskUserQuestion();
  if (!output) {
    return {
      question: first.question,
      answer: "",
      options: first.options.map((option) => option.label),
      questions,
      isError: false,
      answered: false,
    };
  }
  const isError = output.startsWith("Error:");
  const answer = output.startsWith(ASK_USER_RESPONSE_PREFIX)
    ? output.slice(ASK_USER_RESPONSE_PREFIX.length).replace(/^\s+/, "")
    : output;
  return {
    question: first.question,
    answer,
    options: first.options.map((option) => option.label),
    questions: isError ? questions : applyAskUserResponses(questions, answer, output.startsWith(ASK_USER_RESPONSE_PREFIX)),
    isError,
    answered: !isError,
  };
}

function parseAskUserQuestions(input: Record<string, unknown>): AskUserQuestionParts[] {
  const batch = Array.isArray(input.questions) ? input.questions : [];
  if (batch.length) {
    return batch.flatMap((value) => {
      const item = objectValue(value);
      if (!item) return [];
      const options = Array.isArray(item.options) ? item.options.flatMap((option) => {
        if (typeof option === "string" && option.trim()) return [{ label: option, description: "" }];
        const parsed = objectValue(option);
        const label = stringField(parsed, "label") ?? "";
        return label ? [{ label, description: stringField(parsed, "description") ?? "" }] : [];
      }) : [];
      return [{
        question: stringField(item, "question") ?? "",
        header: stringField(item, "header") ?? "",
        multiSelect: item.multiSelect === true || item.multi_select === true,
        options,
        answers: [],
        note: "",
        unanswered: false,
      }];
    });
  }
  const question = skillArgValue(input, "question");
  const options = stringArrayField(input, "options").map((label) => ({ label, description: "" }));
  return [{ question, header: "", multiSelect: false, options, answers: [], note: "", unanswered: false }];
}

function applyAskUserResponses(
  questions: AskUserQuestionParts[],
  output: string,
  legacyPrefix: boolean,
): AskUserQuestionParts[] {
  if (legacyPrefix) {
    return questions.map((question, index) => index === 0
      ? { ...question, answers: output ? [output] : [], unanswered: !output }
      : question);
  }
  try {
    const parsed = JSON.parse(output) as { responses?: unknown[] };
    if (!Array.isArray(parsed.responses)) throw new Error("missing responses");
    return questions.map((question, index) => {
      const response = objectValue(parsed.responses?.[index]);
      const answers = Array.isArray(response?.answers)
        ? response.answers.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
      const note = stringField(response, "note") ?? "";
      return {
        ...question,
        answers,
        note,
        unanswered: response?.unanswered === true || (answers.length === 0 && !note),
      };
    });
  } catch {
    return questions.map((question, index) => index === 0
      ? { ...question, answers: output ? [output] : [], unanswered: !output }
      : question);
  }
}

function emptyAskUserQuestion(): AskUserQuestionParts {
  return { question: "", header: "", multiSelect: false, options: [], answers: [], note: "", unanswered: false };
}

function renderAskUserToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const input = objectValue(msg.toolInput) ?? {};
  const output = msg.toolOutput ?? "";
  const parsed = parseAskUserToolOutput(input, output);
  const displayStatus = parsed.isError ? "failed" : statusClass;
  return el("div", { class: `tool-card ask-user-card ${displayStatus}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolText("Ask", "询问")),
      el("span", { class: "tool-card-name" }, msg.toolName ?? msg.toolCallId ?? ""),
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(displayStatus)} ${askUserStatusLabel(parsed, statusClass)}`),
    ),
    ...parsed.questions.map((item, index) => renderAskUserQuestion(item, index, parsed)),
  );
}

function renderAskUserQuestion(item: AskUserQuestionParts, index: number, parsed: AskUserOutputParts): HTMLElement {
  const answer = [item.answers.join(", "), item.note].filter(Boolean).join(" — ");
  return el("section", { class: "ask-user-entry" },
    el("div", { class: "ask-user-panel ask-user-question" },
      el("div", { class: "ask-user-panel-title" }, item.header || `${toolText("Question", "问题")} ${index + 1}`),
      el("div", { class: "ask-user-question-body", innerHTML: renderMarkdown(item.question || toolText("(empty question)", "（空问题）")) }),
      item.options.length ? el("div", { class: "ask-user-options" },
        ...item.options.map((option) => el("span", { class: "ask-user-option", title: option.description }, option.label)),
      ) : "",
    ),
    el("div", { class: askUserAnswerClass(parsed) },
      el("div", { class: "ask-user-panel-title" }, toolText("Answer", "回答")),
      parsed.answered
        ? el("pre", { class: "ask-user-answer-body" }, item.unanswered ? toolText("(unanswered)", "（未回答）") : answer || toolText("(empty)", "（空）"))
        : parsed.isError
          ? renderToolOutput(parsed.answer)
          : el("div", { class: "ask-user-waiting" }, toolText("Waiting for the user response...", "等待用户回答...")),
    ),
  );
}

function askUserStatusLabel(parsed: AskUserOutputParts, status: string): string {
  if (parsed.isError) {
    return toolText("failed", "失败");
  }
  if (parsed.answered) {
    return toolText("answered", "已回答");
  }
  if (status === "pending" || status === "in_progress") {
    return toolText("waiting", "等待中");
  }
  return toolStatusLabel(status);
}

function askUserAnswerClass(parsed: AskUserOutputParts): string {
  if (parsed.isError) {
    return "ask-user-panel ask-user-answer failed";
  }
  if (parsed.answered) {
    return "ask-user-panel ask-user-answer answered";
  }
  return "ask-user-panel ask-user-answer";
}

const DOC_HEADER_RE = /^File:\s+(.+?)\s+\((\d+)\s+lines?,\s+(\d+)\s+chars?,\s+~?(\d+)\s+tokens?\)/;
const DOC_SAVED_RE = /Saved Markdown to:\s*(.+)|-\s*Saved to:\s*(.+)/;

type DocumentOutputParts = {
  filePath: string;
  savedPath: string;
  lineCount: number | null;
  charCount: number | null;
  tokenCount: number | null;
  preview: string;
  isError: boolean;
  isLarge: boolean;
};

export function parseDocumentToolOutput(input: Record<string, unknown>, output: string): DocumentOutputParts {
  const inputPath = skillArgValue(input, "path");
  if (!output) {
    return { filePath: inputPath, savedPath: "", lineCount: null, charCount: null, tokenCount: null, preview: "", isError: false, isLarge: false };
  }
  if (output.startsWith("Error:")) {
    return { filePath: inputPath, savedPath: "", lineCount: null, charCount: null, tokenCount: null, preview: output, isError: true, isLarge: false };
  }
  const lines = output.split(/\r?\n/);
  const header = DOC_HEADER_RE.exec(lines[0] || "");
  const saved = DOC_SAVED_RE.exec(output);
  const body = header ? lines.slice(1).join("\n").trim() : output;
  return {
    filePath: header?.[1] ?? inputPath,
    savedPath: saved?.[1]?.trim() || saved?.[2]?.trim() || "",
    lineCount: header ? Number.parseInt(header[2], 10) : null,
    charCount: header ? Number.parseInt(header[3], 10) : null,
    tokenCount: header ? Number.parseInt(header[4], 10) : null,
    preview: previewSkillText(body),
    isError: false,
    isLarge: Boolean(saved),
  };
}

function documentMetric(parts: DocumentOutputParts): string {
  const entries = [
    parts.lineCount === null ? "" : toolText(`${parts.lineCount} lines`, `${parts.lineCount} 行`),
    parts.charCount === null ? "" : toolText(`${parts.charCount} chars`, `${parts.charCount} 字符`),
    parts.tokenCount === null ? "" : toolText(`~${parts.tokenCount} tokens`, `约 ${parts.tokenCount} tokens`),
  ].filter(Boolean);
  return entries.join(" · ");
}

function renderDocumentToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const input = objectValue(msg.toolInput) ?? {};
  const output = msg.toolOutput ?? "";
  const parsed = parseDocumentToolOutput(input, output);
  const displayStatus = parsed.isError ? "failed" : statusClass;
  const metric = documentMetric(parsed);
  const isActive = statusClass === "pending" || statusClass === "in_progress";
  return el("div", { class: `tool-card document-card ${displayStatus}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolText("Document", "文档")),
      el("span", { class: "tool-card-name" }, msg.toolName ?? msg.toolCallId ?? ""),
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(displayStatus)} ${parsed.isLarge ? toolText("saved", "已保存") : toolStatusLabel(displayStatus)}`),
    ),
    el("div", { class: "document-summary" },
      parsed.filePath ? toolSummaryRow(toolText("File", "文件"), parsed.filePath, "", "open-file") : "",
      parsed.savedPath ? toolSummaryRow(toolText("Markdown", "Markdown"), parsed.savedPath, "", "open-file") : "",
      metric ? toolSummaryRow(toolText("Size", "大小"), metric) : "",
    ),
    el("details", { class: "tool-card-body", open: (isActive || output) ? "" : undefined },
      el("summary", { class: "tool-card-summary" }, parsed.isError ? toolText("Error", "错误") : parsed.isLarge ? toolText("Summary", "摘要") : toolText("Markdown preview", "Markdown 预览")),
      output ? renderToolOutput(parsed.preview || toolText("(empty)", "（空）"), "document-output") : "",
    ),
  );
}

export function mcpServerForTool(toolName: string | undefined, toolsByServer: Record<string, string[]> | undefined): string {
  if (!toolName || !toolsByServer) return "";
  for (const [serverName, toolNames] of Object.entries(toolsByServer)) {
    if (toolNames.includes(toolName)) return serverName;
  }
  const prefixMatch = /^([^_.:\/]+)[_.:\/]/.exec(toolName);
  if (!prefixMatch) return "";
  return Object.keys(toolsByServer).find((serverName) => serverName === prefixMatch[1]) ?? "";
}

function renderMcpToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const output = msg.toolOutput ?? "";
  const input = formatJson(msg.toolInput);
  const serverName = mcpServerForTool(msg.toolName, state.latestState?.mcpTools);
  const isActive = statusClass === "pending" || statusClass === "in_progress";
  const isError = output.startsWith("Error:") || statusClass === "failed";
  const displayStatus = isError ? "failed" : statusClass;
  return el("div", { class: `tool-card mcp-card ${displayStatus}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, "MCP"),
      el("span", { class: "tool-card-name" }, msg.toolName ?? msg.toolCallId ?? ""),
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(displayStatus)} ${toolStatusLabel(displayStatus)}`),
    ),
    el("div", { class: "mcp-summary" },
      serverName ? toolSummaryRow(toolText("Server", "服务器"), serverName, "code") : "",
      msg.toolName ? toolSummaryRow(toolText("Tool", "工具"), msg.toolName, "code") : "",
    ),
    el("details", { class: "tool-card-body", open: (isActive || output) ? "" : undefined },
      el("summary", { class: "tool-card-summary" }, output ? toolText("Result", "结果") : toolText("Arguments", "参数")),
      input ? el("pre", { class: "tool-card-input" }, input) : "",
      output ? renderToolOutput(previewSkillText(output, 12), "mcp-output") : "",
    ),
  );
}

function renderSubAgentToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const input = objectValue(msg.toolInput);
  const invocationId = msg.subAgentInvocationId ?? stringField(input, "invocationId") ?? stringField(input, "invocation_id") ?? msg.toolCallId ?? "";
  const output = msg.toolOutput ?? "";
  const innerTools = msg.innerToolCalls ?? [];
  const running = innerTools.filter((tool) => tool.status === "running").length;
  const failed = innerTools.filter((tool) => tool.status === "error").length;
  const completed = innerTools.filter((tool) => tool.status === "complete").length;
  const statusText = subAgentStatusText(msg.subAgentPaused === true, failed > 0, statusClass);

  return el("div", { class: `tool-card sub-agent-card ${msg.subAgentPaused ? "paused" : statusClass}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolText("Sub-agent", "子智能体")),
      el("span", { class: "tool-card-name" }, msg.toolName ?? invocationId),
      msg.subAgentPaused ? el("button", { class: "tool-card-action", "data-sub-agent-action": "retry" }, toolText("Retry", "重试")) : "",
      msg.subAgentPaused ? el("button", { class: "tool-card-action", "data-sub-agent-action": "abort" }, toolText("Abort", "终止")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(msg.subAgentPaused ? "failed" : statusClass)} ${statusText}`),
    ),
    el("div", { class: "sub-agent-summary" },
      [
        invocationId ? `${toolText("Invocation", "调用")} ${invocationId}` : "",
        innerTools.length ? `${completed}/${innerTools.length} ${toolText("tools", "个工具")}` : "",
        running ? `${running} ${toolText("running", "运行中")}` : "",
        failed ? `${failed} ${toolText("failed", "失败")}` : "",
        msg.subAgentTokens !== undefined ? `${msg.subAgentTokens.toLocaleString()} ${toolText("context tokens", "上下文 token")}` : "",
        msg.subAgentUsageTokens !== undefined ? `${msg.subAgentUsageTokens.toLocaleString()} ${toolText("total tokens", "累计 token")}` : "",
        msg.subAgentCompactions ? `${msg.subAgentCompactions} ${toolText("compactions", "次压缩")}` : "",
      ].filter(Boolean).join(" · "),
    ),
    msg.subAgentLastError ? el("div", { class: "sub-agent-error" }, msg.subAgentLastError) : "",
    innerTools.length ? el("div", { class: "sub-agent-inner-tools" },
      ...innerTools.slice(-8).map((tool) => el("div", { class: `sub-agent-inner-tool ${tool.status}` },
        el("span", { class: "sub-agent-inner-status" }, innerToolStatusIcon(tool.status)),
        el("span", { class: "sub-agent-inner-name" }, tool.toolName),
        tool.durationMs !== undefined ? el("span", { class: "sub-agent-inner-duration" }, formatToolDuration(tool.durationMs)) : "",
      )),
    ) : "",
    output ? el("details", { class: "tool-card-body", open: msg.subAgentPaused ? "" : undefined },
      el("summary", { class: "tool-card-summary" }, msg.subAgentPaused ? toolText("Pause details", "暂停详情") : toolText("Events", "事件")),
      renderToolOutput(output, "sub-agent-output"),
    ) : "",
  );
}

function subAgentStatusText(paused: boolean, failed: boolean, status: string): string {
  if (paused) return toolText("paused", "已暂停");
  if (failed) return toolText("failed", "失败");
  if (status === "completed") return toolText("completed", "已完成");
  return toolStatusLabel(status);
}

function innerToolStatusIcon(status: "running" | "complete" | "error"): string {
  if (status === "complete") return "✓";
  if (status === "error") return "✗";
  return "…";
}

function formatToolDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

type ShellOutputParts = {
  body: string;
  preview: string;
  exitCode: number | null;
};

const SHELL_EXIT_CODE_RE = /\[exit_code:\s*(-?\d+)\]\s*$/;
const SHELL_PREVIEW_LINES = 5;

export function parseShellOutput(output: string): ShellOutputParts {
  const match = SHELL_EXIT_CODE_RE.exec(output);
  const exitCode = match ? Number.parseInt(match[1], 10) : null;
  const body = match ? output.slice(0, match.index).replace(/\n+$/, "") : output;
  const lines = body.split(/\r?\n/);
  const preview = lines.length > SHELL_PREVIEW_LINES
    ? `${lines.slice(0, SHELL_PREVIEW_LINES).join("\n")}\n...`
    : body;
  return { body, preview, exitCode };
}

function renderShellToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const input = objectValue(msg.toolInput);
  const command = stringField(input, "command") ?? stringField(input, "cmd") ?? "";
  const output = msg.toolOutput ?? "";
  const parsedOutput = parseShellOutput(output);
  const displayStatus = parsedOutput.exitCode !== null && parsedOutput.exitCode !== 0 ? "failed" : statusClass;
  const isActive = statusClass === "pending" || statusClass === "in_progress";
  const summary = toolSummaryElements(msg);
  return el("div", { class: `tool-card shell-card ${displayStatus}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolText("Shell", "终端")),
      el("span", { class: "tool-card-name" }, msg.toolName ?? msg.toolCallId ?? ""),
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(displayStatus)} ${parsedOutput.exitCode !== null ? `exit ${parsedOutput.exitCode}` : toolStatusLabel(statusClass)}`),
    ),
    ...summary,
    command ? el("div", { class: "tool-shell-command-wrap" },
      el("pre", { class: "tool-shell-command" }, command),
      el("button", { class: "tool-shell-copy", "data-copy-command": command }, toolText("Copy command", "复制命令")),
    ) : "",
    parsedOutput.exitCode !== null ? el("div", { class: parsedOutput.exitCode === 0 ? "shell-result-meta ok" : "shell-result-meta failed" },
      parsedOutput.exitCode === 0 ? toolText("Completed", "已完成") : toolText("Errored", "出错"),
    ) : "",
    parsedOutput.preview ? renderToolOutput(parsedOutput.preview, "shell-output") : "",
  );
}

type ReadOutputParts = {
  path: string;
  totalLines: number | null;
  totalChars: number | null;
  lines: Array<{ line: number; text: string }>;
  truncated: boolean;
  isError: boolean;
};

const READ_HEADER_RE = /^File:\s+(.+?)\s+\((\d+)\s+lines?,\s+(\d+)\s+chars?\)/;
const READ_LINE_RE = /^(\d+)\|(.*)$/;
const READ_PREVIEW_LINES = 5;

export function parseReadOutput(output: string): ReadOutputParts {
  if (!output) {
    return { path: "", totalLines: null, totalChars: null, lines: [], truncated: false, isError: false };
  }
  if (output.startsWith("Error:")) {
    return { path: "", totalLines: null, totalChars: null, lines: [], truncated: false, isError: true };
  }

  const rawLines = output.split(/\r?\n/);
  const headerMatch = READ_HEADER_RE.exec(rawLines[0] || "");
  const bodyLines = headerMatch ? rawLines.slice(1) : rawLines;
  const parsedLines: Array<{ line: number; text: string }> = [];
  let truncated = false;

  for (const line of bodyLines) {
    const lineMatch = READ_LINE_RE.exec(line);
    if (lineMatch) {
      parsedLines.push({ line: Number.parseInt(lineMatch[1], 10), text: lineMatch[2] });
      continue;
    }
    if (line.startsWith("[Truncated") || line.startsWith("[Long lines truncated")) {
      truncated = true;
    }
  }

  return {
    path: headerMatch?.[1] ?? "",
    totalLines: headerMatch ? Number.parseInt(headerMatch[2], 10) : null,
    totalChars: headerMatch ? Number.parseInt(headerMatch[3], 10) : null,
    lines: parsedLines,
    truncated,
    isError: false,
  };
}

function readPreviewMeta(parts: ReadOutputParts): string {
  const lineMeta = parts.totalLines === null
    ? ""
    : state.uiLanguage === "zh-CN"
      ? `${parts.totalLines} 行`
      : `${parts.totalLines} line${parts.totalLines === 1 ? "" : "s"}`;
  const charMeta = parts.totalChars === null
    ? ""
    : state.uiLanguage === "zh-CN"
      ? `${parts.totalChars} 字符`
      : `${parts.totalChars} chars`;
  return [lineMeta, charMeta].filter(Boolean).join(" · ");
}

function renderReadToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const input = objectValue(msg.toolInput);
  const inputPath = stringField(input, "path")
    ?? stringField(input, "file_path")
    ?? stringField(input, "filepath")
    ?? "";
  const output = msg.toolOutput ?? "";
  const parts = parseReadOutput(output);
  const path = parts.path || inputPath;
  const previewLines = parts.lines.slice(0, READ_PREVIEW_LINES);
  const displayTruncated = parts.truncated || parts.lines.length > READ_PREVIEW_LINES;
  const isActive = statusClass === "pending" || statusClass === "in_progress";
  const summary = toolSummaryElements(msg);
  const meta = readPreviewMeta(parts);

  return el("div", { class: `tool-card read-card ${parts.isError ? "failed" : statusClass}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolText("Read", "读取")),
      el("span", { class: "tool-card-name" }, msg.toolName ?? msg.toolCallId ?? ""),
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(statusClass)} ${toolStatusLabel(statusClass)}`),
    ),
    ...summary,
    path ? el("button", { class: "read-file-title", "data-file-path": path, title: path }, path.split(/[\\/]/).pop() || path) : "",
    el("details", { class: "tool-card-body", open: (isActive || output) ? "" : undefined },
      el("summary", { class: "tool-card-summary" }, meta || (output ? toolText("Output", "输出") : toolText("Details", "详情"))),
      path && meta ? el("div", { class: "read-output-meta" }, path) : "",
      previewLines.length
        ? el("div", { class: "read-preview" },
          ...previewLines.map((line) => el("div", { class: "read-preview-line" },
            el("button", {
              class: "read-preview-number",
              "data-file-path": path,
              "data-file-line": String(line.line),
              title: path ? `${path}:${line.line}` : String(line.line),
            }, String(line.line)),
            el("code", { class: "read-preview-code" }, line.text || " "),
          )),
          displayTruncated ? el("div", { class: "read-preview-truncated" }, "...") : "",
        )
        : output ? renderToolOutput(output, "read-output") : "",
    ),
  );
}

const SKILL_PREVIEW_LINES = 8;
const SKILL_PREVIEW_CHARS = 220;
const SKILL_EXIT_CODE_RE = /\[exit_code:\s*(-?\d+)\]\s*$/;
const SKILL_FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n?/;
const SKILL_INSTRUCTIONS_RE = /<instructions>\s*([\s\S]*?)\s*<\/instructions>/i;
const SKILL_DIR_RE = /<skill_dir>\s*([\s\S]*?)\s*<\/skill_dir>/gi;
const SKILL_RESOURCE_RE = /<resource\b[^>]*\bname=(['"])(.*?)\1[^>]*\/?>/gi;
const SKILL_SCRIPT_RE = /<script\b[^>]*\bname=(['"])(.*?)\1[^>]*\/?>/gi;

type SkillOutputParts = {
  title: string;
  subtitle: string;
  preview: string;
  isError: boolean;
  exitCode: number | null;
  skillDir: string;
  resources: string[];
  scripts: string[];
};

function skillArgValue(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function lastRegexMatch(pattern: RegExp, text: string): RegExpExecArray | null {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  for (;;) {
    const candidate = pattern.exec(text);
    if (!candidate) break;
    match = candidate;
  }
  return match;
}

function extractSkillNames(pattern: RegExp, text: string): string[] {
  pattern.lastIndex = 0;
  const names: string[] = [];
  for (;;) {
    const match = pattern.exec(text);
    if (!match) break;
    names.push(decodeHtmlAttribute(match[2] || ""));
  }
  return names;
}

function formatSkillList(items: string[]): string {
  if (items.length <= 4) return items.join(", ");
  return `${items.slice(0, 4).join(", ")}, +${items.length - 4} more`;
}

function previewSkillText(text: string, maxLines = SKILL_PREVIEW_LINES): string {
  if (!text) return toolText("(empty)", "（空）");
  const lines: string[] = [];
  let truncated = false;
  for (const rawLine of text.split(/\r?\n/)) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    const line = rawLine.length > SKILL_PREVIEW_CHARS ? `${rawLine.slice(0, SKILL_PREVIEW_CHARS)}...` : rawLine;
    if (line.length !== rawLine.length) truncated = true;
    lines.push(line);
  }
  return `${lines.join("\n")}${truncated ? "\n..." : ""}`;
}

function stripSkillMetadata(output: string): string {
  const instructions = SKILL_INSTRUCTIONS_RE.exec(output);
  if (instructions) return instructions[1].trim();
  const skillDir = lastRegexMatch(SKILL_DIR_RE, output);
  const body = skillDir ? output.slice(0, skillDir.index) : output;
  return body.replace(SKILL_FRONTMATTER_RE, "").trim();
}

function loadSkillMetadataSource(output: string): string {
  const skillDir = lastRegexMatch(SKILL_DIR_RE, output);
  if (skillDir) return output.slice(skillDir.index + skillDir[0].length);
  const instructions = SKILL_INSTRUCTIONS_RE.exec(output);
  if (instructions) return output.slice(instructions.index + instructions[0].length);
  return output;
}

function lineCharSummary(text: string): string {
  if (!text) return toolText("empty", "空");
  const lines = text.endsWith("\n") ? text.split(/\r?\n/).length - 1 : text.split(/\r?\n/).length;
  if (state.uiLanguage === "zh-CN") return `${lines} 行，${text.length} 字符`;
  return `${lines} line${lines === 1 ? "" : "s"}, ${text.length} char${text.length === 1 ? "" : "s"}`;
}

export function parseSkillToolOutput(toolName: string | undefined, input: Record<string, unknown>, output: string): SkillOutputParts {
  const name = (toolName || "").toLowerCase();
  const skillName = skillArgValue(input, "skill_name");
  const resourceName = skillArgValue(input, "resource_name");
  const scriptName = skillArgValue(input, "script_name");
  const title = name === "read_skill_resource"
    ? resourceName || skillName || toolText("resource", "资源")
    : name === "run_skill_script"
      ? scriptName || skillName || toolText("script", "脚本")
      : skillName || toolText("skill", "技能");
  if (output.startsWith("Error:")) {
    return { title, subtitle: toolText("error", "错误"), preview: output, isError: true, exitCode: null, skillDir: "", resources: [], scripts: [] };
  }
  if (name === "load_skill") {
    const skillDir = decodeHtmlAttribute(lastRegexMatch(SKILL_DIR_RE, output)?.[1]?.trim() || "");
    const metadata = loadSkillMetadataSource(output);
    const resources = extractSkillNames(SKILL_RESOURCE_RE, metadata);
    const scripts = extractSkillNames(SKILL_SCRIPT_RE, metadata);
    const previewParts = [
      skillDir ? `${toolText("dir", "目录")}: ${skillDir}` : "",
      resources.length ? `${toolText("resources", "资源")}: ${formatSkillList(resources)}` : "",
      scripts.length ? `${toolText("scripts", "脚本")}: ${formatSkillList(scripts)}` : "",
      previewSkillText(stripSkillMetadata(output)),
    ].filter(Boolean);
    const subtitle = [
      resources.length ? `${resources.length} ${toolText(resources.length === 1 ? "resource" : "resources", "个资源")}` : "",
      scripts.length ? `${scripts.length} ${toolText(scripts.length === 1 ? "script" : "scripts", "个脚本")}` : "",
    ].filter(Boolean).join(", ") || toolText("loaded", "已加载");
    return { title, subtitle, preview: previewParts.join("\n\n"), isError: false, exitCode: null, skillDir, resources, scripts };
  }
  if (name === "run_skill_script") {
    const exitMatch = SKILL_EXIT_CODE_RE.exec(output.trim());
    const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : null;
    const body = output.replace(SKILL_EXIT_CODE_RE, "").trimEnd();
    return {
      title,
      subtitle: exitCode === null ? toolText("completed", "已完成") : `exit ${exitCode}`,
      preview: previewSkillText(body),
      isError: exitCode !== null && exitCode !== 0,
      exitCode,
      skillDir: "",
      resources: [],
      scripts: [],
    };
  }
  return { title, subtitle: lineCharSummary(output), preview: previewSkillText(output), isError: false, exitCode: null, skillDir: "", resources: [], scripts: [] };
}

function renderSkillToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const input = objectValue(msg.toolInput) ?? {};
  const output = msg.toolOutput ?? "";
  const parsed = parseSkillToolOutput(msg.toolName, input, output);
  const isActive = statusClass === "pending" || statusClass === "in_progress";
  const displayStatus = parsed.isError ? "failed" : statusClass;
  const summary = toolSummaryElements(msg);
  return el("div", { class: `tool-card skill-card ${displayStatus}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolText("Skill", "技能")),
      el("span", { class: "tool-card-name" }, msg.toolName ?? msg.toolCallId ?? ""),
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(displayStatus)} ${parsed.subtitle || toolStatusLabel(statusClass)}`),
    ),
    ...summary,
    el("details", { class: "tool-card-body", open: (isActive || output) ? "" : undefined },
      el("summary", { class: "tool-card-summary" }, parsed.title),
      output ? renderToolOutput(parsed.preview, "skill-output") : el("div", { class: "tool-summary" }, toolText("Preparing skill tool call...", "正在准备技能工具调用...")),
    ),
  );
}

type SearchOutputParts = {
  header: string;
  subtitle: string;
  body: string;
  isError: boolean;
};

const SEARCH_HEADER_RE = /^Found \d+ (?:match|file)\S* /;
const SEARCH_HEADER_PARTS_RE = /^(Found \d+ \S+).* in (.+?)( \(limited to \d+\))?$/;

function parseSearchOutput(toolName: string | undefined, output: string): SearchOutputParts {
  if (!output) return { header: "", subtitle: "", body: "", isError: false };
  const isError = output.startsWith("Error:") || output.startsWith("No ");
  if (isError) return { header: "", subtitle: "", body: output, isError: true };

  const lines = output.split(/\r?\n/);
  let header = "";
  let subtitle = "";
  let bodyLines = lines;
  if (lines[0] && SEARCH_HEADER_RE.test(lines[0])) {
    const match = SEARCH_HEADER_PARTS_RE.exec(lines[0]);
    if (match) {
      header = match[1] + (match[3] || "");
      subtitle = match[2];
    } else {
      header = lines[0];
    }
    bodyLines = lines.slice(1);
  }
  while (bodyLines.length && !bodyLines[0].trim()) {
    bodyLines = bodyLines.slice(1);
  }

  if ((toolName || "").toLowerCase() === "glob") {
    const truncated = bodyLines.length > 3;
    const body = bodyLines.slice(0, 3).join("\n") + (truncated ? "\n  ..." : "");
    return { header, subtitle, body, isError: false };
  }

  const blocks: string[][] = [];
  let currentBlock: string[] = [];
  let truncated = false;
  for (const line of bodyLines) {
    if (!line.trim() && currentBlock.length) {
      blocks.push(currentBlock);
      currentBlock = [];
      if (blocks.length >= 1) {
        truncated = true;
        break;
      }
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length && blocks.length < 1) {
    blocks.push(currentBlock);
  }
  const body = blocks.map((block) => block.join("\n")).join("\n\n") + (truncated ? "\n..." : "");
  return { header, subtitle, body, isError: false };
}

function appendSearchOutputLine(outputEl: HTMLElement, line: string): void {
  const match = line.match(/^(.+?):(\d+):/);
  if (!match) {
    outputEl.appendChild(document.createTextNode(line + "\n"));
    return;
  }
  outputEl.appendChild(el("button", {
    class: "search-result-link",
    "data-file-path": match[1],
    "data-file-line": match[2],
    title: state.uiLanguage === "zh-CN" ? `打开 ${match[1]}:${match[2]}` : `Open ${match[1]}:${match[2]}`,
    "aria-label": state.uiLanguage === "zh-CN" ? `打开 ${match[1]} 第 ${match[2]} 行` : `Open ${match[1]} line ${match[2]}`,
  },
    el("span", { class: "search-result-file" }, match[1]),
    document.createTextNode(":"),
    el("span", { class: "search-result-line" }, match[2]),
  ));
  outputEl.appendChild(document.createTextNode(":"));
  outputEl.appendChild(document.createTextNode(`${line.slice(match[0].length)}\n`));
}

function renderSearchToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const output = msg.toolOutput ?? "";
  const parsed = parseSearchOutput(msg.toolName, output);
  const summary = toolSummaryElements(msg);
  const isActive = statusClass === "pending" || statusClass === "in_progress";
  const outputEl = parsed.body
    ? isToolErrorMessage(parsed.body)
      ? renderToolOutput(parsed.body, "search-output")
      : el("pre", { class: "tool-card-output search-output" })
    : null;
  if (outputEl && parsed.body && !isToolErrorMessage(parsed.body)) {
    parsed.body.split("\n").forEach((line) => appendSearchOutputLine(outputEl, line));
  }
  return el("div", { class: `tool-card search-card ${statusClass}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolText("Search", "搜索")),
      el("span", { class: "tool-card-name" }, msg.toolName ?? msg.toolCallId ?? ""),
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(statusClass)} ${toolStatusLabel(statusClass)}`),
    ),
    ...summary,
    el("details", { class: "tool-card-body", open: (isActive || output) ? "" : undefined },
      el("summary", { class: "tool-card-summary" }, parsed.header || (output ? toolText("Output", "输出") : toolText("Details", "详情"))),
      parsed.subtitle ? el("div", { class: "search-output-meta" }, parsed.subtitle) : "",
      outputEl ?? "",
    ),
  );
}

const EDIT_PREVIEW_LINES = 12;
const EDIT_PREVIEW_LINE_CHARS = 160;

function truncatePreviewLine(line: string, maxChars = EDIT_PREVIEW_LINE_CHARS): string {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, Math.max(1, maxChars - 3))}...`;
}

function previewTextLines(text: string, maxLines: number): { lines: string[]; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  const truncated = lines.length > maxLines;
  return {
    lines: lines.slice(0, maxLines).map((line) => truncatePreviewLine(line)),
    truncated,
  };
}

export function lineChangeSummary(before: string, after: string): { additions: number; removals: number } {
  const beforeLines = before ? before.split(/\r?\n/) : [];
  const afterLines = after ? after.split(/\r?\n/) : [];
  const max = Math.max(beforeLines.length, afterLines.length);
  let additions = 0;
  let removals = 0;
  for (let index = 0; index < max; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) continue;
    if (beforeLine !== undefined) removals += 1;
    if (afterLine !== undefined) additions += 1;
  }
  return { additions, removals };
}

function renderEditPreviewColumn(kind: "before" | "after", text: string, emptyText: string): HTMLElement {
  const preview = previewTextLines(text, EDIT_PREVIEW_LINES);
  return el("div", { class: kind === "before" ? "edit-diff-before" : "edit-diff-after" },
    el("div", { class: "edit-diff-label" }, kind === "before" ? toolText("Before", "修改前") : toolText("After", "修改后")),
    el("pre", { class: "edit-diff-text" }, preview.lines.length ? preview.lines.join("\n") : emptyText),
    preview.truncated ? el("div", { class: "edit-diff-truncated" }, "...") : "",
  );
}

function renderEditToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const input = objectValue(msg.toolInput);
  const path = stringField(input, "path")
    ?? stringField(input, "file_path")
    ?? stringField(input, "filepath")
    ?? stringField(input, "target_file") ?? "";
  const oldText = stringField(input, "old_string") ?? stringField(input, "old_text") ?? stringField(input, "before") ?? "";
  const newText = stringField(input, "new_string") ?? stringField(input, "new_text") ?? stringField(input, "after") ?? stringField(input, "content") ?? "";
  const output = msg.toolOutput ?? "";
  const summary = toolSummaryElements(msg);
  const isActive = statusClass === "pending" || statusClass === "in_progress";
  const toolLabel = toolKindLabel(msg.toolKind ?? "edit", msg.toolName);
  const hasDiff = oldText !== "" || newText !== "";
  const changeSummary = hasDiff ? lineChangeSummary(oldText, newText) : null;
  return el("div", { class: `tool-card edit-card ${statusClass}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolLabel),
      el("span", { class: "tool-card-name" }, msg.toolName ?? msg.toolCallId ?? ""),
      msg.canDiff && msg.toolCallId ? el("button", { class: "tool-card-action", "data-tool-call-id": msg.toolCallId }, toolText("Diff", "差异")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(statusClass)} ${toolStatusLabel(statusClass)}`),
    ),
    ...summary,
    path ? el("button", {
      class: "edit-path",
      "data-file-path": path,
      title: state.uiLanguage === "zh-CN" ? `打开 ${path}` : `Open ${path}`,
      "aria-label": state.uiLanguage === "zh-CN" ? `打开文件 ${path}` : `Open file ${path}`,
    }, path) : "",
    changeSummary ? el("div", { class: "edit-change-summary" }, `+${changeSummary.additions}, -${changeSummary.removals}`) : "",
    hasDiff ? el("div", { class: "edit-diff-preview" },
      renderEditPreviewColumn("before", oldText, toolText("(empty)", "（空）")),
      renderEditPreviewColumn("after", newText, toolText("(empty)", "（空）")),
    ) : "",
    output ? renderToolOutput(output, "edit-output") : "",
  );
}

export function renderSleepToolCall(msg: ChatMessage): HTMLElement {
  const statusClass = effectiveToolStatus(msg);
  const input = objectValue(msg.toolInput);
  const seconds = numberField(input, "seconds");
  const reason = stringField(input, "reason");
  const output = msg.toolOutput ?? "";
  const isActive = statusClass === "pending" || statusClass === "in_progress";
  const skipped = output.toLowerCase().includes("sleep skipped");
  const interrupted = output.toLowerCase().includes("sleep interrupted");
  const resultLabel = sleepResultLabel(skipped, interrupted, statusClass);
  return el("div", { class: `tool-card sleep-card ${statusClass}` },
    el("div", { class: "tool-card-header" },
      el("span", { class: "tool-card-kind" }, toolText("Sleep", "等待")),
      el("span", { class: "tool-card-name" }, seconds === undefined ? toolText("Sleep", "等待") : `${toolText("Sleep", "等待")} ${formatSleepSeconds(seconds)}`),
      isActive && msg.toolCallId ? el("button", { class: "tool-card-action", "data-sleep-skip-id": msg.toolCallId }, toolText("Skip", "跳过")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-view-tool-id": msg.toolCallId }, toolText("View", "查看")) : "",
      msg.toolCallId ? el("button", { class: "tool-card-action", "data-copy-tool-id": msg.toolCallId }, toolText("Copy", "复制")) : "",
      el("span", { class: "tool-card-status" }, `${toolStatusIcon(statusClass)} ${toolStatusLabel(resultLabel)}`),
    ),
    reason ? el("div", { class: "tool-summary" }, reason) : "",
    isActive && seconds !== undefined ? el("div", { class: "sleep-countdown" }, `${toolText("Requested duration", "请求等待时长")}: ${formatSleepSeconds(seconds)}`) : "",
    output ? renderToolOutput(output, "sleep-output") : "",
  );
}

function sleepResultLabel(skipped: boolean, interrupted: boolean, status: string): string {
  if (skipped) return "skipped";
  if (interrupted) return "interrupted";
  return status;
}
