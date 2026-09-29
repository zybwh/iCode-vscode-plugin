import { companionRarityLabel } from "./presentation";
import { companionDisplayName } from "./responses";
import type { CompanionCollectionItem, CompanionViewState } from "./types";

function collectionLine(item: CompanionCollectionItem, activeFingerprint?: string): string {
  const marker = item.fingerprint === activeFingerprint ? "*" : "-";
  const copies = item.copies > 1 ? ` · x${item.copies}` : "";
  return `${marker} ${companionDisplayName(item)} · ${companionRarityLabel(item.appraisal.rarity)} · Lv.${item.growth.level}${copies}`;
}

export function companionCollectionText(state: CompanionViewState): string {
  if (!state.collection.length) {
    return "No companions collected yet. Use /companion summon to summon one.";
  }
  const activeFingerprint = state.activeCard?.fingerprint;
  return [
    `Companion collection (${state.collection.length})`,
    ...state.collection.map((item) => collectionLine(item, activeFingerprint)),
  ].join("\n");
}
