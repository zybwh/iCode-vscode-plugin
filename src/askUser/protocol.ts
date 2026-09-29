import type {
  BatchRequestInputRequest,
  LegacyRequestInputRequest,
  RequestInputAnswer,
  RequestInputQuestion,
  RequestInputRequest,
  RequestInputResponse,
} from "../acp/types";

export function isBatchRequestInput(request: RequestInputRequest): request is BatchRequestInputRequest {
  return "questions" in request;
}

export function requestInputQuestions(request: RequestInputRequest): RequestInputQuestion[] {
  if (isBatchRequestInput(request)) return request.questions;
  return [{
    question: request.question,
    header: "",
    multiSelect: false,
    options: (request.options ?? []).map((label) => ({ label, description: "" })),
  }];
}

export function completedInputResponse(
  request: RequestInputRequest,
  answers: RequestInputAnswer[],
): RequestInputResponse {
  if (isBatchRequestInput(request)) {
    return { answers: normalizedAnswers(request.questions.length, answers), cancelled: false };
  }
  return { text: legacyAnswerText(request, answers[0]) };
}

export function cancelledInputResponse(request: RequestInputRequest): RequestInputResponse {
  return isBatchRequestInput(request) ? { cancelled: true } : { text: "" };
}

export function validatedInputResponse(
  request: RequestInputRequest,
  response: RequestInputResponse,
): RequestInputResponse {
  if (!isBatchRequestInput(request)) {
    return "text" in response ? { text: response.text.trim() } : { text: "" };
  }
  if ("text" in response || response.cancelled || !response.answers) {
    return { cancelled: true };
  }
  if (response.answers.length !== request.questions.length) {
    return { cancelled: true };
  }
  const answers: RequestInputAnswer[] = [];
  for (let index = 0; index < request.questions.length; index += 1) {
    const question = request.questions[index];
    const raw = response.answers[index];
    const values = raw.values.map((value) => value.trim());
    const note = raw.note.trim();
    const labels = new Set((question.options ?? []).map((option) => option.label));
    const invalid = values.some((value) => !value)
      || new Set(values).size !== values.length
      || (question.multiSelect !== true && values.length > 1)
      || (values.length > 1 && values.some((value) => !labels.has(value)))
      || Boolean(note && (values.length === 0 || values.some((value) => !labels.has(value))));
    if (invalid) return { cancelled: true };
    answers.push({ values, note });
  }
  return { answers, cancelled: false };
}

export function normalizedAnswers(count: number, answers: RequestInputAnswer[]): RequestInputAnswer[] {
  return Array.from({ length: count }, (_, index) => {
    const answer = answers[index];
    return {
      values: uniqueTrimmed(answer?.values ?? []),
      note: answer?.note.trim() ?? "",
    };
  });
}

function legacyAnswerText(
  _request: LegacyRequestInputRequest,
  answer: RequestInputAnswer | undefined,
): string {
  return answer?.values[0]?.trim() || answer?.note.trim() || "";
}

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
