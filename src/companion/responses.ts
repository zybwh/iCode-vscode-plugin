import type { CompanionCollectionItem, CompanionResponse, CompanionViewState } from "./types";

export function companionDisplayName(item: CompanionCollectionItem): string {
  return item.displayName?.trim() || item.card.name;
}

export function directCompanionAddressResponse(
  state: CompanionViewState,
  text: string,
  now = new Date(),
): CompanionResponse | null {
  if (state.muted || !state.activeCard) return null;
  const name = companionDisplayName(state.activeCard).toLowerCase();
  const normalized = text.trim().toLowerCase();
  if (!name || !normalized.startsWith(name)) return null;
  const rest = normalized.slice(name.length);
  if (rest && !",，:：!！?？ ".includes(rest[0])) return null;
  return {
    kind: "direct_address",
    text: compactResponse(`${companionDisplayName(state.activeCard)}听见了。先把当前 iCode 回合稳稳收住。`),
    createdAt: now.toISOString(),
  };
}

export function fallbackCompanionResponse(
  state: CompanionViewState,
  kind: CompanionResponse["kind"],
  now = new Date(),
): CompanionResponse | null {
  if (state.muted || !state.activeCard) return null;
  const name = companionDisplayName(state.activeCard);
  const text = kind === "pet"
    ? `${name}靠近了一点。继续用 iCode，它会慢慢长大。`
    : `${name}在旁边看着。`;
  return {
    kind,
    text: compactResponse(text),
    createdAt: now.toISOString(),
  };
}

function compactResponse(text: string): string {
  return text.length <= 80 ? text : text.slice(0, 77).trimEnd() + "...";
}
