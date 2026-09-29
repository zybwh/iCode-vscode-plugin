import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { appraiseCompanion, isValidCompanionCard } from "../companion/appraisal";
import { summonWindow, canSummon } from "../companion/summon";
import { applyCompanionGrowthEvent, defaultCompanionGrowth, experienceForLevel, levelFromExperience } from "../companion/growth";
import {
  awardCompanionExperience,
  addressCompanion,
  loadCompanionViewState,
  petCompanion,
  renameActiveCompanion,
  setCompanionMuted,
  summonCompanion,
} from "../companion/store";
import { directCompanionAddressResponse, fallbackCompanionResponse } from "../companion/responses";
import { companionCollectionText } from "../companion/summary";
import { STARTER_COMPANION_PACK } from "../companion/starterPack";
import type { CompanionCard } from "../companion/types";

const drawIndex = vi.hoisted(() => vi.fn<(max: number) => number | undefined>());
vi.mock("node:crypto", async (importOriginal) => {
  const crypto = await importOriginal<typeof import("node:crypto")>();
  return { ...crypto, randomInt: (max: number) => drawIndex(max) ?? crypto.randomInt(max) };
});

const originalCompanionRootDir = process.env.CHRYS_COMPANION_ROOT_DIR;

afterEach(() => {
  drawIndex.mockReset();
  if (originalCompanionRootDir === undefined) {
    delete process.env.CHRYS_COMPANION_ROOT_DIR;
  } else {
    process.env.CHRYS_COMPANION_ROOT_DIR = originalCompanionRootDir;
  }
});

function validCard(overrides: Partial<CompanionCard> = {}): CompanionCard {
  return {
    id: "baize-reviewer",
    name: "白泽守则",
    title: "Runtime Guardian",
    description: "A calm reviewer companion that watches diffs and runtime state.",
    personality: "calm, observant, concise",
    avatar: {
      kind: "builtin",
      animatedWebp: "companions/baize-gba-idle.webp",
      thumbnailPng: "companions/baize-gba-thumb.webp",
    },
    statusLines: {
      idle: "I am watching the workspace.",
      running: "The run is moving.",
      approval_waiting: "A decision is waiting.",
      error: "Something needs attention.",
      done: "The turn is complete.",
    },
    workflowBias: ["diff", "tests", "approval"],
    quickActions: ["diff", "logs", "doctor"],
    ...overrides,
  };
}

function withTempCompanionRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chrys-companions-"));
  process.env.CHRYS_COMPANION_ROOT_DIR = root;
  return root;
}

describe("companion appraisal", () => {
  it("computes stable rarity instead of trusting declared rarity fields", () => {
    const card = {
      ...validCard(),
      rarity: "Ultra Rare",
      level: 100,
      appraisalScore: 100,
    } as CompanionCard & Record<string, unknown>;

    const first = appraiseCompanion(card, { packId: "starter" });
    const second = appraiseCompanion(card, { packId: "starter" });

    expect(first).toEqual(second);
    expect(["rare", "super_rare", "ultra_rare"]).toContain(first.rarity);
    expect(first.rarityLabel).toMatch(/^(Rare|Super Rare|Ultra Rare)$/);
    expect(first.rarityLabel).not.toBe(String(card.rarity));
  });

  it("keeps appraisal stable when only avatar asset paths change", () => {
    const first = appraiseCompanion(validCard(), { packId: "starter" });
    const second = appraiseCompanion(
      validCard({
        avatar: {
          kind: "builtin",
          animatedWebp: "companions/baize-v2-idle.webp",
          thumbnailPng: "companions/baize-v2-thumb.webp",
          animations: {
            idle: "companions/baize-v2-idle.webp",
            running: "companions/baize-v2-tail.webp",
            pet: "companions/baize-v2-rest.webp",
          },
        },
      }),
      { packId: "starter" },
    );

    expect(second).toEqual(first);
  });

  it("rejects cards missing essential safe rendering fields", () => {
    expect(isValidCompanionCard(validCard())).toBe(true);
    expect(isValidCompanionCard(validCard({ name: "" }))).toBe(false);
    expect(isValidCompanionCard(validCard({ statusLines: { idle: "only one" } }))).toBe(false);
    expect(isValidCompanionCard(validCard({ avatar: { kind: "remote", url: "https://example.com/a.webp" } as never }))).toBe(false);
  });
});

describe("companion daily summon window", () => {
  it("resets at local 09:00 rather than after a strict 24 hours", () => {
    const morningBeforeReset = new Date(2026, 5, 24, 8, 30, 0);
    const morningAfterReset = new Date(2026, 5, 24, 9, 30, 0);
    const previousDaySummon = new Date(2026, 5, 23, 10, 0, 0).toISOString();
    const currentWindowSummon = new Date(2026, 5, 24, 9, 5, 0).toISOString();

    expect(summonWindow(morningBeforeReset).windowStart).toBe(new Date(2026, 5, 23, 9, 0, 0).toISOString());
    expect(summonWindow(morningBeforeReset).nextReset).toBe(new Date(2026, 5, 24, 9, 0, 0).toISOString());
    expect(summonWindow(morningAfterReset).windowStart).toBe(new Date(2026, 5, 24, 9, 0, 0).toISOString());
    expect(summonWindow(morningAfterReset).nextReset).toBe(new Date(2026, 5, 25, 9, 0, 0).toISOString());
    expect(canSummon(previousDaySummon, morningAfterReset)).toBe(true);
    expect(canSummon(currentWindowSummon, morningAfterReset)).toBe(false);
  });
});

describe("companion growth", () => {
  it("counts active iCode minutes as real usage experience", () => {
    const growth = applyCompanionGrowthEvent(
      defaultCompanionGrowth(),
      { kind: "active_minute", activeMinutes: 3, experience: 6 },
      new Date(2026, 5, 24, 10, 3, 0),
    );

    expect(growth.experience).toBe(6);
    expect(growth.activeMinutes).toBe(3);
    expect(growth.level).toBe(1);
    expect(growth.lastExperienceAt).toBe(new Date(2026, 5, 24, 10, 3, 0).toISOString());
  });
});

describe("companion store", () => {
  it("ships the approved twenty numbered starter companions with original names", () => {
    const expectedNames = [
      "白泽",
      "毕方",
      "青鸟",
      "玄龟",
      "乘黄",
      "鹿蜀",
      "讹兽",
      "烛龙",
      "九尾狐",
      "应龙",
      "夔",
      "狌狌",
      "朱厌",
      "文鳐鱼",
      "重明鸟",
      "当康",
      "飞廉",
      "句芒",
      "九天玄女",
      "河伯",
    ];

    expect(STARTER_COMPANION_PACK.cards).toHaveLength(20);
    expect(STARTER_COMPANION_PACK.cards.map((card) => card.name)).toEqual(expectedNames);
    expect(STARTER_COMPANION_PACK.cards.map((card) => card.id)).toEqual([
      "c001-baize",
      "c002-bifang",
      "c003-qingniao",
      "c004-xuangui",
      "c005-chenghuang",
      "c006-lushu",
      "c007-eshou",
      "c008-zhulong",
      "c009-jiuweihu",
      "c010-yinglong",
      "c011-kui",
      "c012-xingxing",
      "c013-zhuyan",
      "c014-wenyaoyu",
      "c015-chongmingniao",
      "c016-dangkang",
      "c017-feilian",
      "c018-jumang",
      "c019-jiutianxuannv",
      "c020-hebo",
    ]);
    expect(STARTER_COMPANION_PACK.cards.every(isValidCompanionCard)).toBe(true);
    const customArtIds = new Set([
      "c002-bifang",
      "c003-qingniao",
      "c004-xuangui",
      "c005-chenghuang",
      "c006-lushu",
      "c007-eshou",
      "c008-zhulong",
      "c009-jiuweihu",
      "c010-yinglong",
      "c011-kui",
      "c012-xingxing",
      "c013-zhuyan",
      "c014-wenyaoyu",
      "c015-chongmingniao",
      "c016-dangkang",
      "c017-feilian",
      "c018-jumang",
      "c019-jiutianxuannv",
      "c020-hebo",
    ]);
    const defaultArtCards = STARTER_COMPANION_PACK.cards.filter((card) => !customArtIds.has(card.id));
    expect(defaultArtCards.every((card) => card.avatar.animatedWebp === "companions/baize-gba-idle.webp")).toBe(true);
    expect(defaultArtCards.every((card) => card.avatar.animations?.idle === "companions/baize-gba-idle.webp")).toBe(true);
    expect(defaultArtCards.every((card) => card.avatar.animations?.running === "companions/baize-gba-tail.webp")).toBe(true);
    expect(defaultArtCards.every((card) => card.avatar.animations?.error === "companions/baize-gba-tail.webp")).toBe(true);
    expect(defaultArtCards.every((card) => card.avatar.animations?.pet === "companions/baize-gba-rest.webp")).toBe(true);
    expect(STARTER_COMPANION_PACK.cards.some((card) => "previewAnimations" in card.avatar)).toBe(false);
  });

  it("assigns distinct starter artwork to the first visual companion batch", () => {
    const cardsById = new Map(STARTER_COMPANION_PACK.cards.map((card) => [card.id, card]));

    expect(cardsById.get("c002-bifang")?.avatar.animatedWebp).toBe("companions/bifang-gba-idle.webp");
    expect(cardsById.get("c002-bifang")?.avatar.animations?.running).toBe("companions/bifang-gba-tail.webp");
    expect(cardsById.get("c002-bifang")?.avatar.animations?.pet).toBe("companions/bifang-gba-rest.webp");
    expect(cardsById.get("c002-bifang")?.avatar.thumbnailPng).toBe("companions/bifang-gba-thumb.webp");

    expect(cardsById.get("c003-qingniao")?.avatar.animatedWebp).toBe("companions/qingniao-gba-idle.webp");
    expect(cardsById.get("c003-qingniao")?.avatar.animations?.running).toBe("companions/qingniao-gba-tail.webp");
    expect(cardsById.get("c003-qingniao")?.avatar.animations?.pet).toBe("companions/qingniao-gba-rest.webp");
    expect(cardsById.get("c003-qingniao")?.avatar.thumbnailPng).toBe("companions/qingniao-gba-thumb.webp");

    expect(cardsById.get("c004-xuangui")?.avatar.animatedWebp).toBe("companions/xuangui-gba-idle.webp");
    expect(cardsById.get("c004-xuangui")?.avatar.animations?.running).toBe("companions/xuangui-gba-tail.webp");
    expect(cardsById.get("c004-xuangui")?.avatar.animations?.pet).toBe("companions/xuangui-gba-rest.webp");
    expect(cardsById.get("c004-xuangui")?.avatar.thumbnailPng).toBe("companions/xuangui-gba-thumb.webp");

    expect(cardsById.get("c005-chenghuang")?.avatar.animatedWebp).toBe("companions/chenghuang-gba-idle.webp");
    expect(cardsById.get("c005-chenghuang")?.avatar.animations?.running).toBe("companions/chenghuang-gba-tail.webp");
    expect(cardsById.get("c005-chenghuang")?.avatar.animations?.pet).toBe("companions/chenghuang-gba-rest.webp");
    expect(cardsById.get("c005-chenghuang")?.avatar.thumbnailPng).toBe("companions/chenghuang-gba-thumb.webp");

    expect(cardsById.get("c006-lushu")?.avatar.animatedWebp).toBe("companions/lushu-gba-idle.webp");
    expect(cardsById.get("c006-lushu")?.avatar.animations?.running).toBe("companions/lushu-gba-tail.webp");
    expect(cardsById.get("c006-lushu")?.avatar.animations?.pet).toBe("companions/lushu-gba-rest.webp");
    expect(cardsById.get("c006-lushu")?.avatar.thumbnailPng).toBe("companions/lushu-gba-thumb.webp");

    expect(cardsById.get("c007-eshou")?.avatar.animatedWebp).toBe("companions/eshou-gba-idle.webp");
    expect(cardsById.get("c007-eshou")?.avatar.animations?.running).toBe("companions/eshou-gba-tail.webp");
    expect(cardsById.get("c007-eshou")?.avatar.animations?.pet).toBe("companions/eshou-gba-rest.webp");
    expect(cardsById.get("c007-eshou")?.avatar.thumbnailPng).toBe("companions/eshou-gba-thumb.webp");

    expect(cardsById.get("c008-zhulong")?.avatar.animatedWebp).toBe("companions/zhulong-gba-idle.webp");
    expect(cardsById.get("c008-zhulong")?.avatar.animations?.running).toBe("companions/zhulong-gba-tail.webp");
    expect(cardsById.get("c008-zhulong")?.avatar.animations?.pet).toBe("companions/zhulong-gba-rest.webp");
    expect(cardsById.get("c008-zhulong")?.avatar.thumbnailPng).toBe("companions/zhulong-gba-thumb.webp");

    expect(cardsById.get("c009-jiuweihu")?.avatar.animatedWebp).toBe("companions/jiuweihu-gba-idle.webp");
    expect(cardsById.get("c009-jiuweihu")?.avatar.animations?.running).toBe("companions/jiuweihu-gba-tail.webp");
    expect(cardsById.get("c009-jiuweihu")?.avatar.animations?.pet).toBe("companions/jiuweihu-gba-rest.webp");
    expect(cardsById.get("c009-jiuweihu")?.avatar.thumbnailPng).toBe("companions/jiuweihu-gba-thumb.webp");

    expect(cardsById.get("c010-yinglong")?.avatar.animatedWebp).toBe("companions/yinglong-gba-idle.webp");
    expect(cardsById.get("c010-yinglong")?.avatar.animations?.running).toBe("companions/yinglong-gba-tail.webp");
    expect(cardsById.get("c010-yinglong")?.avatar.animations?.pet).toBe("companions/yinglong-gba-rest.webp");
    expect(cardsById.get("c010-yinglong")?.avatar.thumbnailPng).toBe("companions/yinglong-gba-thumb.webp");

    expect(cardsById.get("c011-kui")?.avatar.animatedWebp).toBe("companions/kui-gba-idle.webp");
    expect(cardsById.get("c011-kui")?.avatar.animations?.running).toBe("companions/kui-gba-tail.webp");
    expect(cardsById.get("c011-kui")?.avatar.animations?.pet).toBe("companions/kui-gba-rest.webp");
    expect(cardsById.get("c011-kui")?.avatar.thumbnailPng).toBe("companions/kui-gba-thumb.webp");

    expect(cardsById.get("c012-xingxing")?.avatar.animatedWebp).toBe("companions/xingxing-gba-idle.webp");
    expect(cardsById.get("c012-xingxing")?.avatar.animations?.running).toBe("companions/xingxing-gba-tail.webp");
    expect(cardsById.get("c012-xingxing")?.avatar.animations?.pet).toBe("companions/xingxing-gba-rest.webp");
    expect(cardsById.get("c012-xingxing")?.avatar.thumbnailPng).toBe("companions/xingxing-gba-thumb.webp");

    expect(cardsById.get("c013-zhuyan")?.avatar.animatedWebp).toBe("companions/zhuyan-gba-idle.webp");
    expect(cardsById.get("c013-zhuyan")?.avatar.animations?.running).toBe("companions/zhuyan-gba-tail.webp");
    expect(cardsById.get("c013-zhuyan")?.avatar.animations?.pet).toBe("companions/zhuyan-gba-rest.webp");
    expect(cardsById.get("c013-zhuyan")?.avatar.thumbnailPng).toBe("companions/zhuyan-gba-thumb.webp");

    expect(cardsById.get("c014-wenyaoyu")?.avatar.animatedWebp).toBe("companions/wenyaoyu-gba-idle.webp");
    expect(cardsById.get("c014-wenyaoyu")?.avatar.animations?.running).toBe("companions/wenyaoyu-gba-tail.webp");
    expect(cardsById.get("c014-wenyaoyu")?.avatar.animations?.pet).toBe("companions/wenyaoyu-gba-rest.webp");
    expect(cardsById.get("c014-wenyaoyu")?.avatar.thumbnailPng).toBe("companions/wenyaoyu-gba-thumb.webp");

    expect(cardsById.get("c015-chongmingniao")?.avatar.animatedWebp).toBe("companions/chongmingniao-gba-idle.webp");
    expect(cardsById.get("c015-chongmingniao")?.avatar.animations?.running).toBe("companions/chongmingniao-gba-tail.webp");
    expect(cardsById.get("c015-chongmingniao")?.avatar.animations?.pet).toBe("companions/chongmingniao-gba-rest.webp");
    expect(cardsById.get("c015-chongmingniao")?.avatar.thumbnailPng).toBe("companions/chongmingniao-gba-thumb.webp");

    expect(cardsById.get("c016-dangkang")?.avatar.animatedWebp).toBe("companions/dangkang-gba-idle.webp");
    expect(cardsById.get("c016-dangkang")?.avatar.animations?.running).toBe("companions/dangkang-gba-tail.webp");
    expect(cardsById.get("c016-dangkang")?.avatar.animations?.pet).toBe("companions/dangkang-gba-rest.webp");
    expect(cardsById.get("c016-dangkang")?.avatar.thumbnailPng).toBe("companions/dangkang-gba-thumb.webp");

    expect(cardsById.get("c017-feilian")?.avatar.animatedWebp).toBe("companions/feilian-gba-idle.webp");
    expect(cardsById.get("c017-feilian")?.avatar.animations?.running).toBe("companions/feilian-gba-tail.webp");
    expect(cardsById.get("c017-feilian")?.avatar.animations?.pet).toBe("companions/feilian-gba-rest.webp");
    expect(cardsById.get("c017-feilian")?.avatar.thumbnailPng).toBe("companions/feilian-gba-thumb.webp");

    expect(cardsById.get("c018-jumang")?.avatar.animatedWebp).toBe("companions/jumang-gba-idle.webp");
    expect(cardsById.get("c018-jumang")?.avatar.animations?.running).toBe("companions/jumang-gba-tail.webp");
    expect(cardsById.get("c018-jumang")?.avatar.animations?.pet).toBe("companions/jumang-gba-rest.webp");
    expect(cardsById.get("c018-jumang")?.avatar.thumbnailPng).toBe("companions/jumang-gba-thumb.webp");

    expect(cardsById.get("c019-jiutianxuannv")?.avatar.animatedWebp).toBe("companions/jiutianxuannv-gba-idle.webp");
    expect(cardsById.get("c019-jiutianxuannv")?.avatar.animations?.running).toBe("companions/jiutianxuannv-gba-tail.webp");
    expect(cardsById.get("c019-jiutianxuannv")?.avatar.animations?.pet).toBe("companions/jiutianxuannv-gba-rest.webp");
    expect(cardsById.get("c019-jiutianxuannv")?.avatar.thumbnailPng).toBe("companions/jiutianxuannv-gba-thumb.webp");

    expect(cardsById.get("c020-hebo")?.avatar.animatedWebp).toBe("companions/hebo-gba-idle.webp");
    expect(cardsById.get("c020-hebo")?.avatar.animations?.running).toBe("companions/hebo-gba-tail.webp");
    expect(cardsById.get("c020-hebo")?.avatar.animations?.pet).toBe("companions/hebo-gba-rest.webp");
    expect(cardsById.get("c020-hebo")?.avatar.thumbnailPng).toBe("companions/hebo-gba-thumb.webp");
  });

  it("summons one card into the user collection and counts duplicates", () => {
    drawIndex.mockReturnValue(0);
    const root = withTempCompanionRoot();
    const now = new Date(2026, 5, 24, 10, 0, 0);

    const first = summonCompanion({ companionRootDir: root, workspaceDir: undefined }, now);
    expect(first.collection).toHaveLength(1);
    expect(first.activeCard?.card.name).toBeTruthy();
    expect(first.activeCard?.growth.experience).toBe(0);
    expect(first.activeCard?.growth.level).toBe(1);
    expect(first.summon.available).toBe(false);
    expect(first.summon.nextResetAt).toBe(new Date(2026, 5, 25, 9, 0, 0).toISOString());

    const forcedNextWindow = new Date(2026, 5, 25, 10, 0, 0);
    const second = summonCompanion({ companionRootDir: root, workspaceDir: undefined }, forcedNextWindow);
    const copies = second.collection.reduce((total, item) => total + item.copies, 0);
    expect(copies).toBe(2);
    expect(second.collection).toHaveLength(1);
    expect(second.activeCard?.copies).toBe(2);
  });

  it("draws independently within the same daily window and does not reroll during cooldown", () => {
    const firstRoot = withTempCompanionRoot();
    const secondRoot = withTempCompanionRoot();
    const now = new Date(2026, 5, 24, 10, 0, 0);
    const poolSize = loadCompanionViewState({ companionRootDir: firstRoot }, now).pool.length;
    drawIndex.mockReturnValueOnce(0).mockReturnValueOnce(poolSize - 1).mockReturnValueOnce(1);

    const first = summonCompanion({ companionRootDir: firstRoot }, now);
    const independent = summonCompanion({ companionRootDir: secondRoot }, now);
    expect(first.activeCard?.card.id).toBe(first.pool[0].id);
    expect(independent.activeCard?.card.id).toBe(independent.pool[poolSize - 1].id);
    expect(drawIndex).toHaveBeenNthCalledWith(1, poolSize);

    const blocked = summonCompanion({ companionRootDir: firstRoot }, now);
    expect(blocked.activeCard?.fingerprint).toBe(first.activeCard?.fingerprint);
    expect(blocked.activeCard?.copies).toBe(1);
    expect(drawIndex).toHaveBeenCalledTimes(2);

    const nextDay = summonCompanion({ companionRootDir: firstRoot }, new Date(2026, 5, 25, 9, 0, 0));
    expect(nextDay.activeCard?.card.id).toBe(nextDay.pool[1].id);
    expect(nextDay.collection).toHaveLength(2);
    expect(drawIndex).toHaveBeenCalledTimes(3);
  });

  it("formats the collection as a quiet command response instead of a sidebar panel", () => {
    const root = withTempCompanionRoot();
    const first = summonCompanion({ companionRootDir: root, workspaceDir: undefined }, new Date(2026, 5, 24, 10, 0, 0));
    const second = summonCompanion({ companionRootDir: root, workspaceDir: undefined }, new Date(2026, 5, 25, 10, 0, 0));

    expect(companionCollectionText(loadCompanionViewState({ companionRootDir: withTempCompanionRoot(), workspaceDir: undefined })))
      .toBe("No companions collected yet. Use /companion summon to summon one.");

    const text = companionCollectionText(second);

    expect(first.collection).toHaveLength(1);
    expect(text).toContain("Companion collection");
    expect(text).toContain("* ");
    expect(text).toContain("Lv.");
    expect(text).toMatch(/ · (R|SR|SSR) · Lv\./);
    expect(text).not.toContain("Rare");
    expect(text).not.toContain("data-command");
    expect(text).not.toContain("button");
  });

  it("levels companions only from real iCode usage experience", () => {
    const root = withTempCompanionRoot();
    const now = new Date(2026, 5, 24, 10, 0, 0);

    const summoned = summonCompanion({ companionRootDir: root, workspaceDir: undefined }, now);
    expect(summoned.activeCard?.growth.experience).toBe(0);
    expect(summoned.activeCard?.growth.level).toBe(1);

    const almostLevelTwo = awardCompanionExperience(
      { companionRootDir: root, workspaceDir: undefined },
      { kind: "turn_completed", experience: experienceForLevel(2) - 1 },
      new Date(2026, 5, 24, 10, 5, 0),
    );
    expect(almostLevelTwo.activeCard?.growth.level).toBe(1);

    const levelTwo = awardCompanionExperience(
      { companionRootDir: root, workspaceDir: undefined },
      { kind: "tool_completed", experience: 1 },
      new Date(2026, 5, 24, 10, 6, 0),
    );
    expect(levelTwo.activeCard?.growth.experience).toBe(experienceForLevel(2));
    expect(levelTwo.activeCard?.growth.level).toBe(2);
    expect(levelFromExperience(levelTwo.activeCard?.growth.experience ?? 0)).toBe(2);
    expect(levelTwo.activeCard?.growth.completedTurns).toBe(1);
    expect(levelTwo.activeCard?.growth.toolRuns).toBe(1);
  });

  it("pets the active companion without depending on summon rewards", () => {
    const root = withTempCompanionRoot();
    const now = new Date(2026, 5, 24, 10, 0, 0);
    summonCompanion({ companionRootDir: root, workspaceDir: undefined }, now);

    const petted = petCompanion({ companionRootDir: root, workspaceDir: undefined }, new Date(2026, 5, 24, 10, 1, 0));

    expect(petted.activeCard?.growth.petCount).toBe(1);
    expect(petted.activeCard?.growth.experience).toBeGreaterThan(0);
    expect(petted.lastResponse?.kind).toBe("pet");
    expect(petted.lastResponse?.text).toContain(petted.activeCard?.card.name ?? "");
  });

  it("renames and mutes the active companion in the user collection", () => {
    const root = withTempCompanionRoot();
    summonCompanion({ companionRootDir: root, workspaceDir: undefined }, new Date(2026, 5, 24, 10, 0, 0));

    const renamed = renameActiveCompanion({ companionRootDir: root, workspaceDir: undefined }, "小白");
    expect(renamed.activeCard?.displayName).toBe("小白");
    expect(renamed.activeCard?.card.name).not.toBe("小白");

    const muted = setCompanionMuted({ companionRootDir: root, workspaceDir: undefined }, true);
    expect(muted.muted).toBe(true);

    const reloaded = loadCompanionViewState({ companionRootDir: root, workspaceDir: undefined });
    expect(reloaded.activeCard?.displayName).toBe("小白");
    expect(reloaded.muted).toBe(true);
  });

  it("detects direct address by companion display name and returns a short local response", () => {
    const root = withTempCompanionRoot();
    summonCompanion({ companionRootDir: root, workspaceDir: undefined }, new Date(2026, 5, 24, 10, 0, 0));
    renameActiveCompanion({ companionRootDir: root, workspaceDir: undefined }, "小白");

    const state = loadCompanionViewState({ companionRootDir: root, workspaceDir: undefined });
    const response = directCompanionAddressResponse(state, "小白，今天要跑测试吗？");
    const spacedResponse = directCompanionAddressResponse(state, "小白 hello");

    expect(response?.kind).toBe("direct_address");
    expect(spacedResponse?.kind).toBe("direct_address");
    expect(response?.text.length).toBeGreaterThan(0);
    expect(response?.text.length).toBeLessThanOrEqual(80);

    const addressed = addressCompanion({ companionRootDir: root, workspaceDir: undefined }, "小白，今天要跑测试吗？");
    expect(addressed.activeCard?.growth.interactionCount).toBe(1);
    expect(addressed.lastResponse?.kind).toBe("direct_address");
  });

  it("does not produce companion speech while muted", () => {
    const root = withTempCompanionRoot();
    summonCompanion({ companionRootDir: root, workspaceDir: undefined }, new Date(2026, 5, 24, 10, 0, 0));
    setCompanionMuted({ companionRootDir: root, workspaceDir: undefined }, true);

    const state = loadCompanionViewState({ companionRootDir: root, workspaceDir: undefined });
    expect(directCompanionAddressResponse(state, `${state.activeCard?.card.name} hello`)).toBeNull();
    expect(fallbackCompanionResponse(state, "pet")).toBeNull();
  });

  it("loads valid workspace pack cards and ignores invalid cards", () => {
    const root = withTempCompanionRoot();
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "chrys-companion-workspace-"));
    const packDir = path.join(workspace, ".chrys", "companions", "packs");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "local.json"), JSON.stringify({
      id: "workspace-pack",
      name: "Workspace Pack",
      cards: [
        validCard({ id: "workspace-baize", name: "Workspace 白泽" }),
        validCard({ id: "invalid-no-name", name: "" }),
      ],
    }), "utf8");

    const state = loadCompanionViewState({ companionRootDir: root, workspaceDir: workspace }, new Date(2026, 5, 24, 10, 0, 0));

    expect(state.pool.map((card) => card.name)).toContain("Workspace 白泽");
    expect(state.pool.map((card) => card.id)).not.toContain("invalid-no-name");
    fs.rmSync(workspace, { recursive: true, force: true });
  });
});
