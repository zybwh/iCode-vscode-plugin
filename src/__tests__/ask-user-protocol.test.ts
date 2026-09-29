import { describe, expect, it } from "vitest";

import {
  cancelledInputResponse,
  completedInputResponse,
  requestInputQuestions,
  validatedInputResponse,
} from "../askUser/protocol";

describe("AskUser protocol compatibility", () => {
  it("projects legacy requests and responses without mixing v2 fields", () => {
    const request = {
      sessionId: "s1",
      requestId: "legacy-1",
      question: "Continue?",
      options: ["Yes", "No"],
    };

    expect(requestInputQuestions(request)[0].options).toEqual([
      { label: "Yes", description: "" },
      { label: "No", description: "" },
    ]);
    expect(completedInputResponse(request, [{ values: ["Yes"], note: "" }])).toEqual({ text: "Yes" });
    expect(cancelledInputResponse(request)).toEqual({ text: "" });
  });

  it("normalizes a valid v2 response while preserving positional unanswered entries", () => {
    const request = {
      sessionId: "s1",
      requestId: "batch-1",
      questions: [
        { question: "Targets?", multiSelect: true, options: [{ label: "TUI" }, { label: "ACP" }] },
        { question: "Notes?", multiSelect: false, options: [] },
      ],
    };

    expect(validatedInputResponse(request, {
      answers: [
        { values: [" TUI ", "ACP"], note: " both " },
        { values: [], note: "" },
      ],
      cancelled: false,
    })).toEqual({
      answers: [
        { values: ["TUI", "ACP"], note: "both" },
        { values: [], note: "" },
      ],
      cancelled: false,
    });
  });

  it("cancels invalid v2 notes and duplicate answers", () => {
    const request = {
      sessionId: "s1",
      requestId: "batch-2",
      questions: [{ question: "Pick", multiSelect: true, options: [{ label: "A" }, { label: "B" }] }],
    };

    expect(validatedInputResponse(request, {
      answers: [{ values: ["A", "A"], note: "" }],
      cancelled: false,
    })).toEqual({ cancelled: true });
    expect(validatedInputResponse(request, {
      answers: [{ values: ["custom"], note: "not allowed for free text" }],
      cancelled: false,
    })).toEqual({ cancelled: true });
  });

  it("cancels invalid v2 answer counts and blank values", () => {
    const request = {
      sessionId: "s1",
      requestId: "batch-3",
      questions: [
        { question: "First?", options: [] },
        { question: "Second?", options: [] },
      ],
    };

    expect(validatedInputResponse(request, {
      answers: [{ values: ["one"], note: "" }],
      cancelled: false,
    })).toEqual({ cancelled: true });
    expect(validatedInputResponse(request, {
      answers: [
        { values: ["   "], note: "" },
        { values: [], note: "" },
      ],
      cancelled: false,
    })).toEqual({ cancelled: true });
  });
});
