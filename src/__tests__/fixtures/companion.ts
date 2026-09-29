import { STARTER_COMPANION_PACK } from "../../companion/starterPack";
import { appraiseCompanion } from "../../companion/appraisal";
import { defaultCompanionGrowth } from "../../companion/growth";
import type { CompanionViewState } from "../../companion/types";

export function companionFixture(): CompanionViewState {
  const card = STARTER_COMPANION_PACK.cards[0];
  const appraisal = appraiseCompanion(card, { packId: STARTER_COMPANION_PACK.id });
  const activeCard = {
    card, appraisal, fingerprint: appraisal.fingerprint, packId: STARTER_COMPANION_PACK.id,
    growth: { ...defaultCompanionGrowth(), experience: 580, level: 3, completedTurns: 18, toolRuns: 42 },
    copies: 1, firstSummonedAt: "2026-09-01T01:00:00Z", lastSummonedAt: "2026-09-01T01:00:00Z",
  };
  return {
    activeCard, collection: [activeCard], pool: [], muted: false,
    summon: { available: false, windowStart: "2026-09-11T01:00:00Z", nextResetAt: "2026-09-12T01:00:00Z" },
    assetBaseUri: "/dist/assets",
  };
}
