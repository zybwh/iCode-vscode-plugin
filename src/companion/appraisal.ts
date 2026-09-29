import { createHash } from "node:crypto";

import type { CompanionAppraisal, CompanionCard, CompanionRarity, CompanionRarityLabel } from "./types";

const IGNORED_AUTHOR_FIELDS = new Set(["avatar", "rarity", "level", "score", "appraisalScore", "computedRarity", "fingerprint"]);
const REQUIRED_STATUS_COUNT = 3;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (IGNORED_AUTHOR_FIELDS.has(key)) continue;
    result[key] = stableValue((value as Record<string, unknown>)[key]);
  }
  return result;
}

export function normalizeCompanionCard(card: CompanionCard): string {
  return JSON.stringify(stableValue(card));
}

function hashInt(input: string): number {
  const digest = createHash("sha256").update(input).digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeRelativeAsset(value: string): boolean {
  return !value.includes("://") && !value.startsWith("/") && !value.includes("..") && /^[\w./-]+$/.test(value);
}

export function isValidCompanionCard(card: unknown): card is CompanionCard {
  if (!card || typeof card !== "object") return false;
  const candidate = card as CompanionCard;
  if (!nonEmpty(candidate.id) || !nonEmpty(candidate.name) || !nonEmpty(candidate.title)) return false;
  if (!nonEmpty(candidate.description) || !nonEmpty(candidate.personality)) return false;
  if (!candidate.avatar || candidate.avatar.kind !== "builtin") return false;
  if (!nonEmpty(candidate.avatar.animatedWebp) || !safeRelativeAsset(candidate.avatar.animatedWebp)) return false;
  if (!nonEmpty(candidate.avatar.thumbnailPng) || !safeRelativeAsset(candidate.avatar.thumbnailPng)) return false;
  if (candidate.avatar.animations) {
    if (typeof candidate.avatar.animations !== "object") return false;
    for (const value of Object.values(candidate.avatar.animations)) {
      if (value !== undefined && (!nonEmpty(value) || !safeRelativeAsset(value))) return false;
    }
  }
  const statusLines = Object.values(candidate.statusLines ?? {}).filter(nonEmpty);
  if (statusLines.length < REQUIRED_STATUS_COUNT) return false;
  if (!Array.isArray(candidate.workflowBias) || candidate.workflowBias.filter(nonEmpty).length < 1) return false;
  if (candidate.quickActions && !Array.isArray(candidate.quickActions)) return false;
  return true;
}

function completenessBonus(card: CompanionCard): number {
  let bonus = 0;
  const statusCount = Object.values(card.statusLines).filter(nonEmpty).length;
  bonus += Math.min(8, statusCount);
  bonus += Math.min(5, card.workflowBias.filter(nonEmpty).length);
  bonus += Math.min(5, (card.quickActions ?? []).filter(nonEmpty).length);
  bonus += card.description.trim().length >= 24 ? 4 : 0;
  bonus += card.personality.trim().length >= 12 ? 3 : 0;
  return Math.min(20, bonus);
}

function rarityForScore(score: number): { rarity: CompanionRarity; rarityLabel: CompanionRarityLabel } {
  if (score >= 90) return { rarity: "ultra_rare", rarityLabel: "Ultra Rare" };
  if (score >= 70) return { rarity: "super_rare", rarityLabel: "Super Rare" };
  return { rarity: "rare", rarityLabel: "Rare" };
}

export function appraiseCompanion(
  card: CompanionCard,
  context: { packId: string; schemaVersion?: number },
): CompanionAppraisal {
  const schemaVersion = context.schemaVersion ?? 1;
  const normalized = normalizeCompanionCard(card);
  const fingerprint = createHash("sha256")
    .update(`${schemaVersion}:${context.packId}:${normalized}`)
    .digest("hex")
    .slice(0, 16);
  const roll = (hashInt(fingerprint) % 100) + 1;
  const score = Math.max(1, Math.min(100, Math.round((roll * 0.82) + completenessBonus(card))));
  return {
    fingerprint,
    ...rarityForScore(score),
  };
}
