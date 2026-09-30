import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomInt } from "node:crypto";

import { appraiseCompanion, isValidCompanionCard } from "./appraisal";
import { applyCompanionGrowthEvent, defaultCompanionGrowth, normalizeCompanionGrowth } from "./growth";
import { directCompanionAddressResponse, fallbackCompanionResponse } from "./responses";
import { STARTER_COMPANION_PACK } from "./starterPack";
import { canSummon, summonWindow } from "./summon";
import type {
  CompanionCard,
  CompanionCollectionFile,
  CompanionCollectionItem,
  CompanionGrowthEvent,
  CompanionLoadOptions,
  CompanionPack,
  CompanionPoolCard,
  CompanionViewState,
} from "./types";

const COLLECTION_SCHEMA_VERSION = 1;

function chrysConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "chrys");
  }
  return path.join(os.homedir(), ".chrys");
}

function companionRootDir(options: CompanionLoadOptions): string {
  return options.companionRootDir || process.env.CHRYS_COMPANION_ROOT_DIR || path.join(chrysConfigDir(), "companions");
}

function collectionPath(options: CompanionLoadOptions): string {
  return path.join(companionRootDir(options), "collection.json");
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The companion view state is rebuilt for every chat state push, and usage XP is awarded
 * on every tool call. Reading and appraising the collection and packs from disk each time
 * blocked the extension host, so both are cached briefly and XP writes are batched.
 * The short TTL still picks up edits made by another window or by hand.
 */
const COLLECTION_CACHE_TTL_MS = 2000;
const POOL_CACHE_TTL_MS = 10_000;
/** Usage XP is flushed at most this often; explicit companion actions write immediately. */
export const COMPANION_WRITE_DEBOUNCE_MS = 5000;

interface CachedCollection {
  collection: CompanionCollectionFile;
  readAt: number;
  options: CompanionLoadOptions;
  dirty: boolean;
}

const collectionCache = new Map<string, CachedCollection>();
const poolCache = new Map<string, { pool: CompanionPoolCard[]; readAt: number }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function cloneCollection(collection: CompanionCollectionFile): CompanionCollectionFile {
  return structuredClone(collection);
}

function readCollection(options: CompanionLoadOptions): CompanionCollectionFile {
  const key = collectionPath(options);
  const cached = collectionCache.get(key);
  if (cached && (cached.dirty || Date.now() - cached.readAt < COLLECTION_CACHE_TTL_MS)) {
    return cloneCollection(cached.collection);
  }
  const collection = readCollectionFromDisk(options);
  collectionCache.set(key, { collection: cloneCollection(collection), readAt: Date.now(), options, dirty: false });
  return collection;
}

function readCollectionFromDisk(options: CompanionLoadOptions): CompanionCollectionFile {
  const data = readJsonFile(collectionPath(options)) as Partial<CompanionCollectionFile> | undefined;
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    activeFingerprint: typeof data?.activeFingerprint === "string" ? data.activeFingerprint : undefined,
    lastSummonedAt: typeof data?.lastSummonedAt === "string" ? data.lastSummonedAt : undefined,
    muted: data?.muted === true,
    lastResponse: normalizeCompanionResponse(data?.lastResponse),
    cards: Array.isArray(data?.cards) ? data.cards.map(normalizeCollectionItem).filter((item) => item !== null) : [],
  };
}

function writeCollectionToDisk(options: CompanionLoadOptions, collection: CompanionCollectionFile): void {
  const target = collectionPath(options);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(collection, null, 2)}\n`, "utf8");
}

function writeCollection(options: CompanionLoadOptions, collection: CompanionCollectionFile, deferred = false): void {
  const key = collectionPath(options);
  const entry: CachedCollection = { collection: cloneCollection(collection), readAt: Date.now(), options, dirty: deferred };
  collectionCache.set(key, entry);
  if (!deferred) {
    writeCollectionToDisk(options, collection);
    return;
  }
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    flushCompanionWrites();
  }, COMPANION_WRITE_DEBOUNCE_MS);
  flushTimer.unref?.();
}

/** Persist batched usage XP. Call on shutdown so no progress is lost. */
export function flushCompanionWrites(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const entry of collectionCache.values()) {
    if (!entry.dirty) continue;
    entry.dirty = false;
    entry.readAt = Date.now();
    try {
      writeCollectionToDisk(entry.options, entry.collection);
    } catch {
      // Companion progress is best-effort local state.
    }
  }
}

function normalizeCollectionItem(value: unknown): CompanionCollectionItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as CompanionCollectionItem;
  if (
    typeof item.fingerprint !== "string"
    || !isValidCompanionCard(item.card)
    || item.appraisal?.fingerprint !== item.fingerprint
    || !Number.isInteger(item.copies)
    || item.copies <= 0
    || typeof item.packId !== "string"
    || typeof item.firstSummonedAt !== "string"
    || typeof item.lastSummonedAt !== "string"
  ) {
    return null;
  }
  return {
    ...item,
    displayName: typeof item.displayName === "string" && item.displayName.trim() ? item.displayName.trim() : undefined,
    growth: normalizeCompanionGrowth(item.growth),
  };
}

function normalizeCompanionResponse(value: unknown): CompanionCollectionFile["lastResponse"] {
  if (!value || typeof value !== "object") return undefined;
  const response = value as CompanionCollectionFile["lastResponse"];
  if (!response || typeof response.text !== "string" || typeof response.createdAt !== "string") return undefined;
  if (response.kind !== "pet" && response.kind !== "direct_address" && response.kind !== "info") return undefined;
  return response;
}

function readPack(filePath: string): CompanionPack | null {
  const data = readJsonFile(filePath) as Partial<CompanionPack> | undefined;
  if (!data || typeof data.id !== "string" || typeof data.name !== "string" || !Array.isArray(data.cards)) {
    return null;
  }
  return {
    id: data.id,
    name: data.name,
    cards: data.cards.filter(isValidCompanionCard),
  };
}

function packFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => path.join(dir, entry))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function loadPacks(options: CompanionLoadOptions): CompanionPack[] {
  const packs = [STARTER_COMPANION_PACK];
  const userPackDir = path.join(companionRootDir(options), "packs");
  for (const file of packFiles(userPackDir)) {
    const pack = readPack(file);
    if (pack) packs.push(pack);
  }
  if (options.workspaceDir) {
    const workspacePackDir = path.join(options.workspaceDir, ".chrys", "companions", "packs");
    for (const file of packFiles(workspacePackDir)) {
      const pack = readPack(file);
      if (pack) packs.push(pack);
    }
  }
  return packs;
}

function companionPool(options: CompanionLoadOptions): CompanionPoolCard[] {
  const key = `${companionRootDir(options)}\0${options.workspaceDir ?? ""}`;
  const cached = poolCache.get(key);
  if (cached && Date.now() - cached.readAt < POOL_CACHE_TTL_MS) return cached.pool;
  const pool = loadPacks(options).flatMap((pack) => pack.cards.map((card) => ({
    ...card,
    packId: pack.id,
    appraisal: appraiseCompanion(card, { packId: pack.id }),
  })));
  poolCache.set(key, { pool, readAt: Date.now() });
  return pool;
}

function activeCard(collection: CompanionCollectionFile): CompanionCollectionItem | null {
  if (!collection.cards.length) return null;
  return collection.cards.find((item) => item.fingerprint === collection.activeFingerprint) ?? collection.cards[0];
}

export function loadCompanionViewState(options: CompanionLoadOptions, now = new Date()): CompanionViewState {
  const collection = readCollection(options);
  const window = summonWindow(now);
  return {
    activeCard: activeCard(collection),
    collection: collection.cards,
    pool: companionPool(options),
    summon: {
      available: canSummon(collection.lastSummonedAt, now),
      windowStart: window.windowStart,
      nextResetAt: window.nextReset,
      lastSummonedAt: collection.lastSummonedAt,
    },
    muted: collection.muted === true,
    lastResponse: collection.lastResponse,
    assetBaseUri: options.assetBaseUri,
  };
}

function collectionItemFromPoolCard(card: CompanionPoolCard, now: Date): CompanionCollectionItem {
  return {
    fingerprint: card.appraisal.fingerprint,
    card: stripPoolFields(card),
    packId: card.packId,
    appraisal: card.appraisal,
    growth: defaultCompanionGrowth(),
    copies: 1,
    firstSummonedAt: now.toISOString(),
    lastSummonedAt: now.toISOString(),
  };
}

function stripPoolFields(card: CompanionPoolCard): CompanionCard {
  const { packId: _packId, appraisal: _appraisal, ...rawCard } = card;
  return rawCard;
}

export function summonCompanion(options: CompanionLoadOptions, now = new Date()): CompanionViewState {
  const collection = readCollection(options);
  const pool = companionPool(options);
  if (!pool.length || !canSummon(collection.lastSummonedAt, now)) {
    return loadCompanionViewState(options, now);
  }

  const summoned = pool[randomInt(pool.length)];
  const existing = collection.cards.find((item) => item.fingerprint === summoned.appraisal.fingerprint);
  if (existing) {
    existing.copies += 1;
    existing.lastSummonedAt = now.toISOString();
  } else {
    collection.cards.push(collectionItemFromPoolCard(summoned, now));
  }
  collection.lastSummonedAt = now.toISOString();
  collection.activeFingerprint = summoned.appraisal.fingerprint;
  writeCollection(options, collection);
  return loadCompanionViewState(options, now);
}

export function renameActiveCompanion(
  options: CompanionLoadOptions,
  displayName: string,
  now = new Date(),
): CompanionViewState {
  const collection = readCollection(options);
  const active = activeCard(collection);
  const nextName = displayName.trim();
  if (!active || !nextName) {
    return loadCompanionViewState(options, now);
  }
  active.displayName = nextName;
  writeCollection(options, collection);
  return loadCompanionViewState(options, now);
}

export function setCompanionMuted(options: CompanionLoadOptions, muted: boolean, now = new Date()): CompanionViewState {
  const collection = readCollection(options);
  collection.muted = muted;
  writeCollection(options, collection);
  return loadCompanionViewState(options, now);
}

export function petCompanion(options: CompanionLoadOptions, now = new Date()): CompanionViewState {
  const collection = readCollection(options);
  const active = activeCard(collection);
  if (!active) {
    return loadCompanionViewState(options, now);
  }
  active.growth = applyCompanionGrowthEvent(active.growth, { kind: "pet", experience: 12 }, now);
  const responseState = {
    ...loadCompanionViewState(options, now),
    activeCard: active,
    muted: collection.muted === true,
  };
  const response = fallbackCompanionResponse(responseState, "pet", now);
  if (response) collection.lastResponse = response;
  writeCollection(options, collection);
  return loadCompanionViewState(options, now);
}

export function addressCompanion(
  options: CompanionLoadOptions,
  text: string,
  now = new Date(),
): CompanionViewState {
  const collection = readCollection(options);
  const active = activeCard(collection);
  if (!active) {
    return loadCompanionViewState(options, now);
  }
  const currentState = {
    ...loadCompanionViewState(options, now),
    activeCard: active,
    muted: collection.muted === true,
  };
  const response = directCompanionAddressResponse(currentState, text, now);
  if (!response) {
    return loadCompanionViewState(options, now);
  }
  active.growth = applyCompanionGrowthEvent(active.growth, { kind: "direct_address", experience: 4 }, now);
  collection.lastResponse = response;
  writeCollection(options, collection);
  return loadCompanionViewState(options, now);
}

export function awardCompanionExperience(
  options: CompanionLoadOptions,
  event: CompanionGrowthEvent,
  now = new Date(),
): CompanionViewState {
  const collection = readCollection(options);
  const active = activeCard(collection);
  if (!active) {
    return loadCompanionViewState(options, now);
  }
  active.growth = applyCompanionGrowthEvent(active.growth, event, now);
  writeCollection(options, collection, true);
  return loadCompanionViewState(options, now);
}
