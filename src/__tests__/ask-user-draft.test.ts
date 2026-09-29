import { describe, expect, it } from "vitest";

import {
  askUserAnswerFromDraft,
  createAskUserDraft,
  toggleAskUserDraftOption,
  updateAskUserDraftText,
} from "../chat/askUserDraft";

describe("AskUser dialog drafts", () => {
  it("does not reinterpret free text as a note when an option is selected", () => {
    const draft = createAskUserDraft();
    updateAskUserDraftText(draft, "custom answer");
    toggleAskUserDraftOption(draft, "A", false);

    expect(askUserAnswerFromDraft(draft)).toEqual({ values: ["A"], note: "" });

    updateAskUserDraftText(draft, "option note");
    toggleAskUserDraftOption(draft, "A", false);
    expect(askUserAnswerFromDraft(draft)).toEqual({ values: ["custom answer"], note: "" });
    expect(draft.note).toBe("option note");
  });
});
