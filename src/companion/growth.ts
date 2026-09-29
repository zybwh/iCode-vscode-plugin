import type { CompanionGrowth, CompanionGrowthEvent } from "./types";

const MAX_LEVEL = 100;
const XP_PER_LEVEL_SQUARED = 100;

export function experienceForLevel(level: number): number {
  const normalized = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return (normalized - 1) * (normalized - 1) * XP_PER_LEVEL_SQUARED;
}

export function levelFromExperience(experience: number): number {
  const safeExperience = Math.max(0, Math.floor(experience));
  return Math.max(1, Math.min(MAX_LEVEL, Math.floor(Math.sqrt(safeExperience / XP_PER_LEVEL_SQUARED)) + 1));
}

export function defaultCompanionGrowth(): CompanionGrowth {
  return {
    experience: 0,
    level: 1,
    activeMinutes: 0,
    completedTurns: 0,
    toolRuns: 0,
    interactionCount: 0,
    petCount: 0,
    approvalEvents: 0,
    errorEvents: 0,
  };
}

export function normalizeCompanionGrowth(value: unknown): CompanionGrowth {
  const source = value && typeof value === "object" ? value as Partial<CompanionGrowth> : {};
  const experience = nonNegativeInteger(source.experience);
  return {
    experience,
    level: levelFromExperience(experience),
    activeMinutes: nonNegativeInteger(source.activeMinutes),
    completedTurns: nonNegativeInteger(source.completedTurns),
    toolRuns: nonNegativeInteger(source.toolRuns),
    interactionCount: nonNegativeInteger(source.interactionCount),
    petCount: nonNegativeInteger(source.petCount),
    approvalEvents: nonNegativeInteger(source.approvalEvents),
    errorEvents: nonNegativeInteger(source.errorEvents),
    lastExperienceAt: typeof source.lastExperienceAt === "string" ? source.lastExperienceAt : undefined,
  };
}

export function applyCompanionGrowthEvent(growth: CompanionGrowth, event: CompanionGrowthEvent, now: Date): CompanionGrowth {
  const next = normalizeCompanionGrowth(growth);
  const experience = nonNegativeInteger(event.experience);
  next.experience += experience;
  next.level = levelFromExperience(next.experience);
  if (event.kind === "turn_completed") next.completedTurns += 1;
  if (event.kind === "tool_completed") next.toolRuns += 1;
  if (event.kind === "tool_failed") {
    next.toolRuns += 1;
    next.errorEvents += 1;
  }
  if (event.kind === "direct_address") next.interactionCount += 1;
  if (event.kind === "pet") {
    next.interactionCount += 1;
    next.petCount += 1;
  }
  if (event.kind === "approval_waiting") next.approvalEvents += 1;
  if (event.kind === "active_minute") next.activeMinutes += nonNegativeInteger(event.activeMinutes);
  if (experience > 0 || event.activeMinutes) next.lastExperienceAt = now.toISOString();
  return next;
}

function nonNegativeInteger(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 0;
}
