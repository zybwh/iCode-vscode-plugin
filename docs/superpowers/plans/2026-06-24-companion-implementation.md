# Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disabled Buddy placeholder with a VSIX-owned animated Companion MVP.

**Architecture:** The extension host owns pack discovery, rarity appraisal, usage-based growth levels, daily summon cooldown, collection persistence, pet/mute/rename/info/direct-address interactions, and safe state passed to the webview. The webview renders the active animated WebP companion, summon action, collection list, local interaction controls, and quick actions without calling backend Buddy APIs.

**Tech Stack:** TypeScript, Vitest, VS Code webview, animated WebP plus PNG thumbnail fallback, local JSON files under `~/.chrys/companions`.

## Global Constraints

- Do not call `_buddy/*`, `_chrys/buddy`, or any unsupported backend Buddy ACP API.
- User-facing labels use `Companion` / `伙伴`.
- Rarity labels are exactly `Rare`, `Super Rare`, and `Ultra Rare`.
- UI shows rarity and `Lv.X`; rarity is static appraisal, while `Lv.X` comes from real Chrys usage/time experience. It does not show score, appraisal reasons, or algorithm explanations.
- Daily summon is one card per user window, resetting at local time `09:00`.
- Pet, mute, rename, info, and direct-address responses are local VSIX interactions; they must not require Chrys hook configuration.
- Companion image assets are local files only; no remote URLs, HTML, JS, CSS, SVG, or active content in pack data.
- Animated WebP is the primary runtime format; PNG is the fallback/thumbnail format.
- VSIX owns particles, glow, card chrome, and status overlays separately from character art.

---

### Task 1: Companion Core Model

**Files:**
- Create: `src/companion/types.ts`
- Create: `src/companion/appraisal.ts`
- Create: `src/companion/summon.ts`
- Test: `src/__tests__/companion.test.ts`

**Interfaces:**
- Produces: `normalizeCompanionCard(card: CompanionCard): string`
- Produces: `appraiseCompanion(card: CompanionCard, context: { packId: string; schemaVersion?: number }): CompanionAppraisal`
- Produces: `summonWindow(now: Date): { windowStart: string; nextReset: string }`
- Produces: `canSummon(lastSummonedAt: string | undefined, now: Date): boolean`

- [ ] Write failing tests for deterministic rarity, zero-XP summon, usage-based growth levels, ignoring declared rarity fields, rejecting incomplete cards, and 09:00 reset windows.
- [ ] Run `npm test -- src/__tests__/companion.test.ts` and confirm the tests fail because the modules do not exist.
- [ ] Implement the minimal core model.
- [ ] Re-run `npm test -- src/__tests__/companion.test.ts` and confirm it passes.

### Task 2: Companion Store And Starter Pack

**Files:**
- Create: `src/companion/starterPack.ts`
- Create: `src/companion/store.ts`
- Modify: `src/common/chatPanelState.ts`
- Modify: `src/state/runtime.ts`
- Test: `src/__tests__/companion.test.ts`

**Interfaces:**
- Consumes: Task 1 appraisal and cooldown helpers.
- Produces: `loadCompanionViewState(options: CompanionLoadOptions): CompanionViewState`
- Produces: `summonCompanion(options: CompanionLoadOptions, now?: Date): CompanionViewState`

- [ ] Add tests for empty collection, daily summon adding one card, duplicate copies, active card selection, and workspace pack discovery ignoring invalid cards.
- [ ] Run `npm test -- src/__tests__/companion.test.ts` and confirm the new tests fail.
- [ ] Implement starter pack and JSON-backed collection store.
- [ ] Wire `chatPanelState()` to include `companion`.
- [ ] Re-run the companion tests.

### Task 3: Webview Companion Surface

**Files:**
- Rename/replace: `src/chat/webview/components/buddyPanel.ts` -> `src/chat/webview/components/companionPanel.ts`
- Modify: `src/chat/webview/app.ts`
- Modify: `src/chat/webview/state.ts`
- Modify: `src/chat/webview/styles/theme.css`
- Modify: `src/chat/panel.ts`
- Modify: `src/handlers/actions.ts`
- Test: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Consumes: `ChatPanelState.companion`.
- Produces: Companion sidebar tab, `/companion` slash command, summon command, collection rendering, and action buttons mapped to existing host commands.

- [ ] Update release guard tests to expect Companion wording and no backend Buddy APIs.
- [ ] Run `npm test -- src/__tests__/release-manifest.test.ts` and confirm failures against current Buddy placeholder.
- [ ] Replace user-facing Buddy UI with Companion.
- [ ] Add `companionCommand` handling for `summon`, `collection`, `diff`, `logs`, `doctor`, `runtime`.
- [ ] Re-run release-manifest tests.

### Task 4: Animated Asset Pipeline

**Files:**
- Create: `src/chat/webview/assets/companions/baize-gba-idle.webp`
- Create: `src/chat/webview/assets/companions/baize-gba-thumb.png`
- Modify: `esbuild.config.mjs`
- Modify: `scripts/pack.py`
- Test: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Produces: copied `dist/assets/companions/*` files for webview runtime and VSIX packaging.

- [ ] Add guard tests that the packer includes `dist/assets/companions` and webview asset URI state exists.
- [ ] Run release-manifest tests and confirm failure.
- [ ] Copy webview companion assets during build.
- [ ] Add assets to package allowlist.
- [ ] Re-run release-manifest tests.

### Task 5: Docs And Verification

**Files:**
- Modify: `README.md`
- Modify: `DESIGN_DECISIONS.md`
- Modify: `RELEASE_CHECKLIST.md`
- Modify: `AGENTS.md`
- Test: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Produces: release guidance aligned with Companion as VSIX-owned, local, animated, and backend-independent.

- [ ] Update docs from Buddy WIP to Companion MVP.
- [ ] Run focused tests: `npm test -- src/__tests__/companion.test.ts src/__tests__/release-manifest.test.ts`.
- [ ] Run `npm run build`.
- [ ] Run `npm run package`.

## Self-Review

- Spec coverage: model, storage, daily summon, rarity, animated WebP, collection, docs, and no backend Buddy APIs are covered.
- Placeholder scan: no TBD/TODO placeholders.
- Scope check: this is one MVP; richer asset generation UX and multiple action animations are deferred.
