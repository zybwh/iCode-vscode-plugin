# Chrys 0.16.1 VSIX Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Chrys VSIX `0.0.8` against the published Chrys CLI `v0.16.1` contract without including post-tag external ACP sub-agent work.

**Architecture:** Keep the current UI and ACP request surface. Add small pure helpers where data must be transformed, route the additional published notifications through the existing client, and keep session-owned usage separate from invocation-owned usage.

**Tech Stack:** TypeScript, VS Code extension APIs, Vitest, esbuild, Python runtime packer.

## Global Constraints

- Target VSIX version is exactly `0.0.8`.
- Target backend release is exactly Chrys CLI `v0.16.1`.
- Do not implement external ACP sub-agent profile support from commits after `v0.16.1`.
- Do not patch or modify `../chrys`.
- Do not delete or rewrite existing user agent profiles.
- Do not commit or push without an explicit user request.

---

### Task 1: Correct the platform runtime launcher

**Files:**
- Modify: `scripts/prepare_runtime.py`
- Modify: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Consumes: a prepared PyApp runtime tree.
- Produces: POSIX and Windows launchers that run `python -m chrys.app.cli.app`.

- [x] **Step 1: Change the release guard to require the published module**

Update the runtime preparation test to require `chrys.app.cli.app` and reject
`chrys.cli.app`.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/__tests__/release-manifest.test.ts
```

Expected: failure because `scripts/prepare_runtime.py` still contains
`chrys.cli.app`.

- [x] **Step 3: Update both generated launchers and Windows validation**

Replace each runtime module argument with `chrys.app.cli.app`.

- [x] **Step 4: Run the focused test and direct module smoke**

```bash
npm test -- src/__tests__/release-manifest.test.ts
../chrys/.venv/bin/python -m chrys.app.cli.app --version
```

Expected: test passes and the runtime prints `0.16.1`.

### Task 2: Preserve complete agent profiles during edits

**Files:**
- Create: `src/chat/agentProfileEdit.ts`
- Create: `src/__tests__/agent-profile-edit.test.ts`
- Modify: `src/chat/webview/components/dialogs.ts`

**Interfaces:**
- Produces:

```ts
export function buildAgentProfileSave(
  existing: Record<string, unknown> | undefined,
  fields: {
    name: string;
    display_name: string;
    description: string;
    instructions: string;
  },
): Record<string, unknown>
```

- [x] **Step 1: Write failing tests for edit and create payloads**

The edit fixture must contain a stable `id` plus nested `tools`, `mcp_servers`,
`memory`, `compaction`, and an unknown future field. Assert exact preservation
after changing the four form-owned fields. Assert a new profile contains only
the form-owned fields and no fabricated `id`.

- [x] **Step 2: Run the focused test and verify RED**

```bash
npm test -- src/__tests__/agent-profile-edit.test.ts
```

Expected: module/function missing.

- [x] **Step 3: Implement the pure merge helper**

For new profiles return the structured form fields. For existing profiles,
return `{ ...existing, ...fields, name: existing.name }`. Do not derive or
overwrite `id`, and do not rename an existing profile because `v0.16.1` restores
masked MCP secrets by submitted name.

- [x] **Step 4: Route webview saves through the helper**

Make the name input read-only for an existing profile. Resolve the original profile from
`state.agentDialogState.profiles[originalName]`, pass it with the edited fields,
and post the merged result. New profiles pass `undefined`.

- [x] **Step 5: Run focused tests and typecheck**

```bash
npm test -- src/__tests__/agent-profile-edit.test.ts
npm run lint
```

Expected: both succeed.

### Task 3: Stop shadowing backend built-in agents

**Files:**
- Delete: `src/session/agentBootstrap.ts`
- Delete: `src/__tests__/agent-bootstrap.test.ts`
- Modify: `src/extension.ts`
- Modify: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Produces: activation that reads built-ins from the connected Chrys runtime
  and never writes them to the user profile directory.

- [x] **Step 1: Change the release guard to forbid activation materialization**

Replace the existing materialization assertions with assertions that
`extension.ts` does not import or call `ensureDefaultAgentProfileYaml`.

- [x] **Step 2: Run the release test and verify RED**

```bash
npm test -- src/__tests__/release-manifest.test.ts
```

Expected: failure while activation still imports and calls the bootstrap.

- [x] **Step 3: Remove activation call and obsolete helper/tests**

Remove the import and call before session restore. Delete the unused helper and
its behavior tests. Do not touch any file under `~/.chrys/agents`.

- [x] **Step 4: Run focused tests and typecheck**

```bash
npm test -- src/__tests__/release-manifest.test.ts
npm run lint
```

Expected: both succeed.

### Task 4: Separate parent and sub-agent usage

**Files:**
- Modify: `src/acp/types.ts`
- Modify: `src/handlers/notifications.ts`
- Create: `src/__tests__/notifications-v016.test.ts`

**Interfaces:**
- `UsageUpdateNotification` adds `agentProfile?: string` and
  `usageSourceId?: string`.
- `SubAgentProgressNotification` adds `totalUsageTokens?: number`.
- Produces:

```ts
export function isParentUsageUpdate(
  update: UsageUpdateNotification,
  sessionId: string | null,
): boolean
```

- [x] **Step 1: Write failing tests for usage ownership**

Assert that an absent source is accepted, a source equal to the current session
is accepted, and an invocation id is rejected. Through
`handleRichUsageUpdate`, assert a rejected update cannot alter the current
gauge.

- [x] **Step 2: Run the focused test and verify RED**

```bash
npm test -- src/__tests__/notifications-v016.test.ts
```

Expected: helper missing or sub-agent usage overwrites runtime state.

- [x] **Step 3: Add fields and guard parent gauge updates**

Return early from the parent gauge handler when `usageSourceId` identifies a
sub-agent invocation. Keep missing-source compatibility.

- [x] **Step 4: Distinguish context and cumulative sub-agent tokens**

For progress events render:

```text
N tool call(s), X context token(s), Y cumulative token(s).
```

Omit the cumulative clause when the backend does not provide it.

- [x] **Step 5: Run focused tests and typecheck**

```bash
npm test -- src/__tests__/notifications-v016.test.ts
npm run lint
```

Expected: both succeed.

### Task 5: Handle the v0.16.1 compaction lifecycle

**Files:**
- Modify: `src/acp/types.ts`
- Modify: `src/acp/client.ts`
- Modify: `src/handlers/notifications.ts`
- Modify: `src/extension.ts`
- Modify: `src/state/runtime.ts`
- Modify: `src/__tests__/acp-client-v016.test.ts`
- Modify: `src/__tests__/notifications-v016.test.ts`

**Interfaces:**
- Add `ContextPressureNotification`.
- Add `SubAgentCompactionCommittedNotification`.
- Finished compaction types add `formatViolation?: string` and
  `failureReason?: string`.
- `ChrysAcpClient` adds `onContextPressure(handler)`.
- Committed events route through the existing compaction handler.

- [x] **Step 1: Extend client tests and verify RED**

Rename the compatibility suite to v0.16.1. Feed `_chrys/context_pressure`,
`_chrys/compaction_finished`, and
`_chrys/sub_agent_compaction_committed`; assert each registered handler receives
the literal payload.

- [x] **Step 2: Add handler behavior tests and verify RED**

Assert context pressure appends a visible warning. Assert failed compaction
uses `failureReason`, format violations are recorded, and committed events are
kept separately from active compactions.

- [x] **Step 3: Add types, routes, runtime state, and activation wiring**

Register context pressure independently. Route committed through the
compaction handler. Add a set of committed compaction ids to runtime state and
clear it during render-state reset.

- [x] **Step 4: Surface failure and pressure details**

Use warning/separator UI for pressure and malformed accepted summaries; use an
error message for failed compactions. Keep debug events for all outcomes.

- [x] **Step 5: Run focused suites and typecheck**

```bash
npm test -- src/__tests__/acp-client-v016.test.ts src/__tests__/notifications-v016.test.ts
npm run lint
```

Expected: both succeed.

### Task 6: Version, documentation, and release gates

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/common/version.ts`
- Modify: `README.md`
- Modify: `DESIGN_DECISIONS.md`
- Modify: `RELEASE_CHECKLIST.md`
- Modify: `.github/workflows/cd.yml`
- Modify: compatibility test descriptions under `src/__tests__/` and
  `tests/integration/`
- Modify: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Produces a VSIX package versioned `0.0.8` with release documentation targeting
  Chrys CLI `v0.16.1`.

- [x] **Step 1: Change release expectations and verify RED**

Require package/version constants `0.0.8`, compatibility references
`v0.16.1`, and VSIX release examples that pair the two independent versions.

- [x] **Step 2: Apply the package version bump and documentation refresh**

Run:

```bash
npm version 0.0.8 --no-git-tag-version
```

Update `src/common/version.ts`, README, release checklist, design decisions,
workflow examples, and test suite names. Preserve the rule that the VSIX version
does not appear in product UI.

- [x] **Step 3: Run complete local release gates**

```bash
npm run lint
npm test
npm run build
npm run package
CHRYS_BINARY_PATH=../chrys/.venv/bin/chrys npm run test:integration
```

Expected: every command exits zero; unit and integration outputs contain no
failures.

- [x] **Step 4: Inspect release contents and final diff**

Verify the generated universal VSIX contains release documents and no Chrys
binary. Run `git diff --check` and review only the intended files. Leave the
ignored VSIX artifact uncommitted.
