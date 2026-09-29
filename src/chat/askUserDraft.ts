import type { RequestInputAnswer } from "../acp/types";

export interface AskUserDraft {
  values: string[];
  note: string;
  text: string;
}

export function createAskUserDraft(): AskUserDraft {
  return { values: [], note: "", text: "" };
}

export function updateAskUserDraftText(draft: AskUserDraft, value: string): void {
  if (draft.values.length) {
    draft.note = value.trim();
  } else {
    draft.text = value.trim();
  }
}

export function toggleAskUserDraftOption(
  draft: AskUserDraft,
  label: string,
  multiSelect: boolean,
): void {
  const selected = draft.values.includes(label);
  draft.values = multiSelect
    ? selected ? draft.values.filter((value) => value !== label) : [...draft.values, label]
    : selected ? [] : [label];
}

export function askUserAnswerFromDraft(draft: AskUserDraft): RequestInputAnswer {
  return {
    values: draft.values.length ? [...draft.values] : draft.text ? [draft.text] : [],
    note: draft.values.length ? draft.note : "",
  };
}
