# Chrys VSIX Companion Design

Date: 2026-06-24

## Summary

Companion is a VSIX-owned workflow pet for the Chrys editor frontend. It replaces the disabled Buddy placeholder with a local, safe, user-customizable companion system that makes the coding workflow feel more alive without depending on backend Buddy APIs.

Companion has two jobs:

- Show a lightweight electronic-pet presence that reacts to the current coding session.
- Help users understand and act on the current workflow state through short status lines and quick actions.

This feature must not call unsupported private ACP methods such as `_buddy/*` or `_chrys/buddy`. Chrys backend Buddy is no longer a dependency for this work.

## Goals

- Add a Companion surface to the chat webview.
- Keep the Companion useful for coding flow, not just decorative.
- Let users create their own Companion cards and card packs with Chrys agents.
- Add a simple daily summon mechanic with collection support.
- Compute rarity locally in the VSIX and grow levels from real Chrys usage.
- Keep all user-created Companion content safe to render.
- Preserve the standalone VSIX boundary: Chrys CLI remains the backend runtime; this repo owns the editor UI.

## Non-Goals

- No backend Buddy protocol.
- No private ACP extensions.
- No independent Companion chat bot until ACP exposes a supported contract for separate Companion model calls.
- No paid mechanics, remote events, or network services.
- No ten-pull summon, pity, or complex gacha economy.
- No feeding, battle system, or complex economy in the first version.
- No user-visible score, appraisal reason, or rarity explanation.

## Product Model

Companion is a local card-based system.

A Companion card describes:

- Name and title.
- Short description.
- Personality and tone.
- Safe avatar data.
- Status lines for workflow states.
- Workflow preferences.
- Optional preferred quick actions.

The VSIX loads Companion packs from user and workspace locations, validates them, computes static rarity, and makes eligible cards available for daily summon. Level is stored in the user's collection and grows only from real Chrys usage and active session time.

## Naming

User-facing English name: `Companion`

User-facing Chinese name: `伙伴`

The existing `Buddy` wording should be replaced in user-facing surfaces as part of implementation. Internal code can migrate incrementally, but new code should use `companion` names.

## User Experience

The chat webview should expose a Companion tab or rail.

The Companion surface shows:

- Avatar or small animated presence.
- Companion name and title.
- Rarity: `Rare`, `Super Rare`, or `Ultra Rare`.
- Level: `Lv.X`.
- Current workflow mood.
- One short status line.
- Pet/mute/rename/info controls.
- Direct-address short responses when the user starts a message with the active Companion display name.
- A small set of context-aware quick actions.
- Daily summon entry point.
- Collection entry point.

Example card header:

```text
Patch Lantern
Ultra Rare
Lv. 91
```

The surface should feel playful, but it must stay compact and useful inside an editor.

## Workflow Reactions

Companion mood is derived from existing VSIX state. It should not require new backend protocol.
The VSIX may map its already-visible session, tool, approval, ask-user, error, and completion events into local Companion state, but it must not require users to configure Chrys hooks or call backend Buddy hook APIs.

Initial workflow states:

- `idle`: session idle or no active run.
- `running`: agent turn in progress.
- `tool_running`: one or more tool cards are active.
- `approval_waiting`: an approval request is pending.
- `ask_user_waiting`: an ask-user prompt is pending.
- `error`: recent visible frontend/runtime error.
- `done`: latest turn completed.
- `context_high`: context usage is above a local threshold.
- `disconnected`: ACP runtime is unavailable.

The UI may show a different avatar pose, small animation, or status line for each state.

## Quick Actions

Companion quick actions should reuse existing VSIX commands and local UI capabilities.

Useful first-version actions:

- Show Diff.
- Show Logs.
- Open Doctor.
- Copy Support Bundle.
- Open Runtime Details.
- Show Approval controls when approval is relevant.
- Open Collection.
- Summon Companion when the daily summon is available.

Quick actions must not mutate the prompt text sent to Chrys unless the user explicitly asks for that action.

## User-Created Companions

Users can create Companion cards and packs with normal Chrys agent file edits.

Example prompts:

```text
帮我创建一个冷静的 reviewer 伙伴。
帮我做一个赛博风 companion，提醒我跑测试。
把我的伙伴改得少卖萌一点，多提醒风险。
```

The VSIX should provide entry points such as:

- Create Companion.
- Edit Current Companion.
- Create Pack.
- Open Pack Folder.

These entry points can insert a prompt into the composer or open the relevant local file. Chrys agent remains the authoring tool; VSIX remains the safe loader and renderer.

## Storage

Recommended paths:

- User collection: `~/.chrys/companions/collection.json`
- User packs: `~/.chrys/companions/packs/*.json`
- Workspace packs: `.chrys/companions/packs/*.json`

Workspace packs can ship project-specific Companion cards. Summoned cards are added to the user's collection, not written back into the workspace pack.

The active Companion selection can be stored in VS Code global/workspace state or settings, depending on implementation ergonomics. The selected value should reference a collection card id, not raw card content.

## Data Safety

Companion data is declarative. It must never execute code.

Disallowed in card and pack data:

- JavaScript.
- HTML.
- Inline CSS.
- External CSS.
- Remote images.
- Arbitrary SVG.
- Scriptable or active content.

Allowed:

- Plain text.
- Safe enum values.
- VSIX-controlled color tokens.
- VSIX-controlled avatar parts.
- Workflow state text.
- Quick action ids from an allowlist.

All card text must be rendered as text, not markup.

Invalid packs or cards should be excluded from the summon pool. The UI can show a simple invalid-pack notice with an action to open the file or ask Chrys to fix it.

## Rarity And Growth Level

Cards do not declare rarity or level. If pack data includes rarity-like or level-like fields, the VSIX ignores them or treats them as invalid according to the final schema.

The VSIX computes:

- `rarity`: `rare`, `super_rare`, or `ultra_rare`.
- `fingerprint`: stable hash used for dedupe and deterministic appraisal.

The VSIX stores collection growth:

- `experience`: integer, starts at `0` when summoned.
- `level`: integer, displayed as `Lv.X`, derived from experience.
- `activeMinutes`, `completedTurns`, `toolRuns`, `approvalEvents`, and `errorEvents`: lightweight counters from real Chrys usage.

Summoning or receiving a duplicate card must not grant experience. Experience comes from using Chrys: completed turns, completed/failed tool calls, approval waits, and active session minutes.

User-facing rarity labels:

- `Rare`
- `Super Rare`
- `Ultra Rare`

The UI must not show:

- Score.
- Appraisal reasons.
- Algorithm details.
- "Computed by VSIX" style explanatory copy.

The result should feel like a card property, not a report.

## Rarity Algorithm

Keep the first-version algorithm simple and more random than evaluative.

Suggested approach:

1. Validate required fields.
2. Normalize the card JSON.
3. Compute a stable hash from normalized card content, pack id, and schema version.
4. Convert the hash into a roll value.
5. Apply a small completeness adjustment.
6. Map the final score to rarity.

Suggested weighting:

- Hash roll: dominant factor.
- Completeness: light gate or small adjustment.

Suggested mapping:

- `Rare`: lower score range.
- `Super Rare`: middle score range.
- `Ultra Rare`: top score range.

Exact thresholds can be tuned during implementation, but the behavior should stay simple, deterministic, and easy to test.

Minimum gate:

- Cards missing essential fields such as name, avatar, or status lines should not enter the summon pool.
- A very minimal valid card may be capped below `Ultra Rare`.

No user-visible explanation is needed.

## Daily Summon

Summon is intentionally lightweight.

Rules:

- One summon per user per day.
- Each summon returns one Companion card.
- No ten-pull.
- No pity.
- No paid currency.
- No network dependency.
- Reset happens at local time `09:00`.

Cooldown is user-level, not workspace-level. Workspace packs can contribute cards, but switching workspaces should not grant extra daily summons.

Reset behavior:

- If the user summoned after today's local 09:00, the next summon is tomorrow at 09:00.
- If the user has not summoned since the current summon window opened, summon is available.
- Before 09:00, the current window is the previous day's 09:00 to today's 09:00.

The UI can show concise copy such as:

- `Summon available`
- `Next summon: tomorrow 09:00`
- `Available at 09:00`

## Collection

Summoned cards are stored in the user collection.

Collection should support:

- List all owned Companion cards.
- Filter or group by `Rare`, `Super Rare`, `Ultra Rare`.
- Highlight active Companion.
- Switch active Companion.
- Show duplicate count.
- Rename or edit through a controlled entry point.
- Ask Chrys to modify a card.

Duplicate cards should increment `copies` instead of creating visually identical rows by default.

## Pack Loading

Pack sources:

1. Built-in starter pack.
2. User packs.
3. Workspace packs.

Load order should be deterministic. Duplicate card fingerprints should be de-duplicated for summon eligibility.

If there are no valid cards in user/workspace packs, the built-in starter pack should keep the feature usable.

## Suggested Schema Shape

Exact field names can change during implementation, but the schema should stay small.

```json
{
  "schemaVersion": 1,
  "packId": "example-pack",
  "displayName": "Example Pack",
  "cards": [
    {
      "id": "patch-lantern",
      "name": "Patch Lantern",
      "title": "Quiet reviewer",
      "description": "A calm companion that notices risky diffs.",
      "personality": "calm",
      "tone": "concise",
      "avatar": {
        "kind": "pixel",
        "body": "lantern",
        "palette": "cyan"
      },
      "statusLines": {
        "idle": ["Ready when you are."],
        "running": ["Watching the turn."],
        "approval_waiting": ["Approval is waiting."],
        "error": ["Something needs attention."],
        "done": ["Turn complete."]
      },
      "workflowPreferences": ["diff", "tests", "context"],
      "quickActions": ["showDiff", "showLogs", "doctor"]
    }
  ]
}
```

The schema should avoid user-supplied layout, HTML, script, or arbitrary CSS.

## Architecture

Host side:

- Companion pack discovery.
- Schema validation.
- Collection persistence.
- Daily summon cooldown.
- Active Companion selection.
- Rarity appraisal and growth-level persistence.
- Pet/mute/rename/info persistence.
- Local direct-address/fallback response generation.
- Passing safe Companion state to the chat webview.

Webview side:

- Companion tab or rail rendering.
- Avatar rendering from safe schema.
- Mood/state selection from `ChatPanelState`.
- Summon and collection UI.
- Posting allowed commands back to the host.

Shared:

- Companion types.
- Rarity labels.
- Allowed quick action ids.
- Hash/appraisal helpers where tests can exercise them.
- Growth helpers where tests can exercise experience and level behavior.

The feature should reuse existing webview command plumbing where possible.

## Testing

Focused tests should cover:

- Pack schema validation accepts valid cards and rejects unsafe content.
- Rarity is deterministic for the same card.
- Level starts at `Lv.1` with zero experience and grows only from real Chrys usage/time.
- User-supplied rarity fields cannot control displayed rarity.
- Daily summon resets at local 09:00.
- Pet, mute, rename, info, and direct-address behavior stays local to the VSIX.
- Summon cooldown is user-level.
- Collection handles duplicates via `copies`.
- Workspace packs contribute to the pool without receiving collection writes.
- Webview never calls private Buddy ACP methods.
- Companion UI labels use `Rare`, `Super Rare`, and `Ultra Rare`.

Release-manifest guardrails should be updated so future changes do not reintroduce backend Buddy calls.

## Rollout Plan

First version:

1. Rename user-facing Buddy surfaces to Companion.
2. Add Companion state/types and pack loader.
3. Add built-in starter pack.
4. Add local rarity appraisal and usage-based growth levels.
5. Add collection persistence.
6. Add daily 09:00 summon cooldown.
7. Render Companion tab with current active card.
8. Add pet/mute/rename/info/direct-address interactions.
9. Add collection and summon UI.
10. Add authoring entry points for Chrys agent prompts.
11. Update docs and release-manifest guardrails.

Future versions can add richer avatar animation, more card packs, optional workspace-specific presentation, and deeper Companion preferences.

## Open Decisions

- Exact schema field names.
- Exact level thresholds.
- Whether active Companion selection is stored globally, per workspace, or both.
- Whether workspace packs can be disabled by user preference.
- Final avatar renderer primitives.

These can be decided during implementation without changing the core product model.
