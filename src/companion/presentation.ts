import type { CompanionRarity } from "./types";

export function companionRarityLabel(rarity: CompanionRarity): string {
  return { rare: "R", super_rare: "SR", ultra_rare: "SSR" }[rarity];
}
