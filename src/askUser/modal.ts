import * as vscode from "vscode";
import type {
  RequestInputAnswer,
  RequestInputQuestion,
  RequestInputRequest,
  RequestInputResponse,
} from "../acp/types";
import type { ChatPanel } from "../chat/panel";
import { resolveUiLanguage, type UiLanguage } from "../common/i18n";
import { rt } from "../state/runtime";
import {
  cancelledInputResponse,
  completedInputResponse,
  requestInputQuestions,
} from "./protocol";

type PendingResponse = {
  answers: RequestInputAnswer[];
  cancelled: boolean;
  source?: string;
};

export class AskUserHandler {
  private pending: { requestId: string; resolve: (response: PendingResponse) => void } | null = null;
  private readonly fallbackCancellations = new Set<vscode.CancellationTokenSource>();

  constructor(private chatPanelProvider: () => ChatPanel | null = () => null) {}

  async requestInput(req: RequestInputRequest): Promise<RequestInputResponse> {
    const panel = this.chatPanelProvider();
    const questions = requestInputQuestions(req);
    const preview = questions.map((question) => question.question).join(" | ");
    panel?.appendDebugEvent("AskUserRequest", req.callerName ? `${req.callerName}: ${preview}` : preview);
    if (!panel || this.pending) {
      panel?.appendDebugEvent("AskUserFallback", this.pending ? "another question is already active" : "chat panel missing");
      const cancellation = new vscode.CancellationTokenSource();
      this.fallbackCancellations.add(cancellation);
      const result = await this.fallbackInput(req, questions, cancellation.token).finally(() => {
        this.fallbackCancellations.delete(cancellation);
        cancellation.dispose();
      });
      panel?.appendDebugEvent(
        "AskUserResponse",
        result.cancelled ? "fallback cancelled" : `fallback (${result.answers.length} answers)`,
      );
      return result.cancelled
        ? cancelledInputResponse(req)
        : completedInputResponse(req, result.answers);
    }

    const labels = askUserLabels(currentLanguage(), req.callerName);
    rt.activeAskUserRequest = {
      requestId: req.requestId,
      callerName: req.callerName ?? "",
      questions: questions.map((question) => question.question),
    };
    const result = await new Promise<PendingResponse>((resolve) => {
      this.pending = { requestId: req.requestId, resolve };

      panel.setAskUserDialogState({
        requestId: req.requestId,
        title: labels.title,
        subtitle: req.callerName ?? "",
        questions,
        responsePlaceholder: labels.responsePlaceholder,
        notePlaceholder: labels.notePlaceholder,
        reviewLabel: labels.reviewLabel,
        reviewTitle: labels.reviewTitle,
        editLabel: labels.editLabel,
        unansweredLabel: labels.unansweredLabel,
        submitLabel: labels.submitLabel,
        previousLabel: labels.previousLabel,
        nextLabel: labels.nextLabel,
        skipLabel: labels.skipLabel,
      });
      panel.requestAttention?.();
    }).finally(() => {
      rt.activeAskUserRequest = null;
      rt.pendingQuestion = null;
      rt.chatPanel?.setAskUserDialogState(null);
    });
    panel.appendDebugEvent(
      "AskUserResponse",
      result.cancelled ? `${result.source ?? "dialog"} cancelled` : `${result.source ?? "dialog"} (${result.answers.length} answers)`,
    );
    return result.cancelled
      ? cancelledInputResponse(req)
      : completedInputResponse(req, result.answers);
  }

  resolve(
    requestId: string,
    answers: RequestInputAnswer[],
    cancelled: boolean,
    source?: string,
  ): void {
    if (!this.pending || this.pending.requestId !== requestId) return;
    const resolve = this.pending.resolve;
    this.pending = null;
    resolve({ answers, cancelled, source });
  }

  cancelActive(source = "cancelled"): void {
    rt.activeAskUserRequest = null;
    rt.pendingQuestion = null;
    rt.chatPanel?.setAskUserDialogState(null);
    for (const cancellation of this.fallbackCancellations) {
      cancellation.cancel();
    }
    if (!this.pending) return;
    const resolve = this.pending.resolve;
    this.pending = null;
    resolve({ answers: [], cancelled: true, source });
  }

  private async fallbackInput(
    req: RequestInputRequest,
    questions: RequestInputQuestion[],
    token: vscode.CancellationToken,
  ): Promise<PendingResponse> {
    const labels = askUserLabels(currentLanguage(), req.callerName);
    const answers: RequestInputAnswer[] = [];
    for (const question of questions) {
      if (token.isCancellationRequested) return { answers: [], cancelled: true, source: "fallback" };
      const answer = await this.fallbackQuestion(question, labels, token);
      if (answer === null) return { answers: [], cancelled: true, source: "fallback" };
      answers.push(answer);
    }
    return { answers, cancelled: false, source: "fallback" };
  }

  private async fallbackQuestion(
    question: RequestInputQuestion,
    labels: AskUserLabels,
    token: vscode.CancellationToken,
  ): Promise<RequestInputAnswer | null> {
    const options = (question.options ?? []).filter((option) => option.label.trim());
    if (options.length === 0) {
      const text = await vscode.window.showInputBox({
        title: labels.windowTitle,
        prompt: question.question,
        placeHolder: labels.responsePlaceholder,
        ignoreFocusOut: true,
      }, token);
      return text === undefined ? null : { values: text.trim() ? [text.trim()] : [], note: "" };
    }

    type InputChoice = vscode.QuickPickItem & { responseKind: "option" | "custom" | "skip" };
    const items: InputChoice[] = [
      ...options.map((option) => ({ label: option.label, description: option.description, responseKind: "option" as const })),
      { label: labels.customResponse, description: labels.customResponseDescription, responseKind: "custom" },
      { label: labels.skipLabel, description: labels.skipDescription, responseKind: "skip" },
    ];
    const quickPickOptions = {
      title: labels.windowTitle,
      placeHolder: question.question,
      ignoreFocusOut: true,
    };
    const picked = question.multiSelect === true
      ? await vscode.window.showQuickPick(items, { ...quickPickOptions, canPickMany: true }, token)
      : await vscode.window.showQuickPick(items, quickPickOptions, token);
    if (picked === undefined) return null;
    const selected = Array.isArray(picked) ? picked : [picked];
    if (selected.some((item) => item.responseKind === "skip")) return { values: [], note: "" };
    if (selected.some((item) => item.responseKind === "custom") || selected.length === 0) {
      const text = await vscode.window.showInputBox({
        title: labels.windowTitle,
        prompt: question.question,
        placeHolder: labels.responsePlaceholder,
        ignoreFocusOut: true,
      }, token);
      return text === undefined ? null : { values: text.trim() ? [text.trim()] : [], note: "" };
    }
    const values = selected.filter((item) => item.responseKind === "option").map((item) => item.label);
    const note = await vscode.window.showInputBox({
      title: labels.windowTitle,
      prompt: labels.notePrompt,
      placeHolder: labels.notePlaceholder,
      ignoreFocusOut: true,
    }, token);
    return note === undefined ? null : { values, note: note.trim() };
  }
}

type AskUserLabels = ReturnType<typeof askUserLabels>;

function currentLanguage(): UiLanguage {
  return resolveUiLanguage(
    vscode.workspace.getConfiguration("chrys").get<string>("ui.language"),
    vscode.env.language,
  );
}

function askUserLabels(language: UiLanguage, callerName?: string) {
  if (language === "zh-CN") {
    return {
      title: "智能体提问",
      windowTitle: callerName ? `来自 ${callerName} 的 iCode 提问` : "iCode 提问",
      responsePlaceholder: "输入回答；选择选项后这里可填写补充说明…",
      notePlaceholder: "可选：补充说明…",
      notePrompt: "为已选答案添加补充说明（可留空）",
      reviewLabel: "复核回答",
      reviewTitle: "提交前请复核全部回答",
      editLabel: "返回修改",
      unansweredLabel: "未回答",
      submitLabel: "提交全部回答",
      previousLabel: "上一题",
      nextLabel: "下一题",
      skipLabel: "不回答本题",
      skipDescription: "将本题留空并继续",
      customResponse: "自定义回答…",
      customResponseDescription: "输入选项之外的回答",
    };
  }
  return {
    title: "Agent Questions",
    windowTitle: callerName ? `iCode question from ${callerName}` : "iCode question",
    responsePlaceholder: "Type an answer, or add a note after selecting options…",
    notePlaceholder: "Optional note…",
    notePrompt: "Add an optional note for the selected answer",
    reviewLabel: "Review answers",
    reviewTitle: "Review all answers before submitting",
    editLabel: "Back to edit",
    unansweredLabel: "Unanswered",
    submitLabel: "Submit all answers",
    previousLabel: "Previous",
    nextLabel: "Next",
    skipLabel: "Leave unanswered",
    skipDescription: "Continue without answering this question",
    customResponse: "Custom response…",
    customResponseDescription: "Enter an answer not listed above",
  };
}
