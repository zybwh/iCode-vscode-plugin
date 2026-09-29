import { companionRarityLabel } from "../companion/presentation";
import { chatPanelState } from "../common/chatPanelState";
import { nextMessageId } from "../chat/provider";
import { rt } from "../state/runtime";
import {
  addressCompanion,
  awardCompanionExperience,
  loadCompanionViewState,
  petCompanion,
  renameActiveCompanion,
  setCompanionMuted,
  summonCompanion,
} from "../companion/store";
import { companionDisplayName } from "../companion/responses";
import { companionCollectionText } from "../companion/summary";
import type { CompanionGrowthEvent, CompanionGrowthEventKind, CompanionViewState } from "../companion/types";

const EXPERIENCE_BY_EVENT: Record<CompanionGrowthEventKind, number> = {
  turn_completed: 24,
  tool_completed: 8,
  tool_failed: 4,
  approval_waiting: 6,
  direct_address: 4,
  pet: 12,
  active_minute: 2,
};

function companionOptions() {
  return { workspaceDir: rt.currentCwd ?? undefined };
}

function refreshCompanion(state?: CompanionViewState): CompanionViewState {
  rt.currentCompanion = state ?? loadCompanionViewState(companionOptions());
  rt.chatPanel?.setState(chatPanelState({ companion: rt.currentCompanion }));
  return rt.currentCompanion;
}

function appendCompanionMessage(text: string): void {
  if (!rt.currentSessionId) return;
  rt.transcript.appendMessage({
    id: nextMessageId(),
    kind: "system",
    text,
    timestamp: Date.now(),
  });
}

export function awardCompanionUsage(event: CompanionGrowthEvent, now = new Date()): void {
  refreshCompanion(awardCompanionExperience(companionOptions(), event, now));
}

export function awardCompanionUsageEvent(kind: CompanionGrowthEventKind, now = new Date()): void {
  awardCompanionUsage({ kind, experience: EXPERIENCE_BY_EVENT[kind] }, now);
}

export function awardCompanionActiveMinutes(startedAtMs: number, endedAtMs = Date.now()): void {
  const activeMinutes = Math.floor(Math.max(0, endedAtMs - startedAtMs) / 60000);
  if (activeMinutes <= 0) return;
  awardCompanionUsage({
    kind: "active_minute",
    activeMinutes,
    experience: activeMinutes * EXPERIENCE_BY_EVENT.active_minute,
  }, new Date(endedAtMs));
}

export async function handleCompanionCommand(arg?: string): Promise<void> {
  const raw = (arg ?? "").trim();
  const [verbRaw, ...rest] = raw.split(/\s+/);
  const verb = (verbRaw || "open").toLowerCase();
  const textArg = rest.join(" ").trim();

  if (verb === "pet") {
    const state = refreshCompanion(petCompanion(companionOptions()));
    if (state.lastResponse?.text) appendCompanionMessage(state.lastResponse.text);
    return;
  }

  if (verb === "mute") {
    const current = refreshCompanion();
    const nextMuted = textArg === "off" ? false : textArg === "on" ? true : !current.muted;
    const state = refreshCompanion(setCompanionMuted(companionOptions(), nextMuted));
    appendCompanionMessage(state.muted ? "Companion muted." : "Companion unmuted.");
    return;
  }

  if (verb === "name" || verb === "rename") {
    if (!textArg) {
      appendCompanionMessage("Usage: /companion name <name>");
      return;
    }
    const state = refreshCompanion(renameActiveCompanion(companionOptions(), textArg));
    const active = state.activeCard;
    appendCompanionMessage(active ? `Companion renamed to ${companionDisplayName(active)}.` : "No active companion yet.");
    return;
  }

  if (verb === "info") {
    appendCompanionMessage(companionInfoText(refreshCompanion()));
    return;
  }

  if (verb === "collection" || verb === "list") {
    appendCompanionMessage(companionCollectionText(refreshCompanion()));
    return;
  }

  if (verb === "summon") {
    const before = refreshCompanion();
    const state = refreshCompanion(summonCompanion(companionOptions()));
    if (state.activeCard && state.summon.lastSummonedAt !== before.summon.lastSummonedAt) {
      appendCompanionMessage(`Summoned ${companionDisplayName(state.activeCard)}.`);
    } else if (state.activeCard) {
      appendCompanionMessage("No new companion summon is available yet.");
    } else {
      appendCompanionMessage("No companion cards are available to summon.");
    }
    return;
  }

  refreshCompanion();
}

export function handleCompanionDirectAddress(text: string): boolean {
  const state = addressCompanion(companionOptions(), text);
  if (!state.lastResponse || state.lastResponse.kind !== "direct_address") {
    refreshCompanion(state);
    return false;
  }
  refreshCompanion(state);
  appendCompanionMessage(state.lastResponse.text);
  return true;
}

function companionInfoText(state: CompanionViewState): string {
  const active = state.activeCard;
  if (!active) return "No active companion yet.";
  return [
    `${companionDisplayName(active)} · ${companionRarityLabel(active.appraisal.rarity)} · Lv.${active.growth.level}`,
    `Personality: ${active.card.personality}`,
    `Growth: ${active.growth.experience} XP, ${active.growth.completedTurns} turns, ${active.growth.toolRuns} tools, ${active.growth.petCount} pets`,
    state.muted ? "Muted: yes" : "Muted: no",
  ].join("\n");
}
