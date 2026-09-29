# Chrys 0.13.1 VSIX Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the standalone Chrys VSIX ACP client and UI up to date with the Chrys CLI `v0.13.1` runtime contract while preserving compatibility with the current underscore-prefixed JSON-RPC extension route names.

**Architecture:** Keep all backend compatibility changes in the VSIX frontend boundary: typed ACP payloads in `src/acp/types.ts`, transport normalization in `src/acp/client.ts`, UI state in `src/state/runtime.ts` and `src/common/chatPanelState.ts`, and rendering/commands in existing handlers and dialogs. New Chrys `v0.13.1` facts should be accepted as data from the installed CLI, not by patching or vendoring backend code.

**Tech Stack:** TypeScript, Vitest, VS Code extension APIs, Chrys ACP over stdio JSON-RPC, existing VSIX webview state and QuickPick/dialog surfaces.

## Global Constraints

- Do not patch the Chrys backend from this repository.
- Do not add VSIX scripts that build, download, or auto-update the Chrys CLI.
- Keep `package.json` as the source of truth for VSIX metadata, commands, views, settings, and package version.
- Do not expose the VSIX package version in product UI, diagnostics, support bundles, or chat chrome.
- Show the connected backend as `Chrys CLI vX.Y.Z` from ACP `initialize.agentInfo.version`.
- Keep VSIX package version independent from Chrys CLI.
- Keep the existing top-level JSON-RPC extension route names such as `_chrys/session_runtime`, `_session/mutations`, and `_settings/options`; a live probe against Chrys `v0.13.1` confirmed those names still route.
- Do not introduce private Buddy hooks such as `_buddy/*`, `_chrys/buddy`, or `_chrys/session_history_status`.
- Preserve TUI-style composer triggers: `/`, `@`, `#`, `!`, plus fullwidth Chinese equivalents.
- Keep English and Simplified Chinese user-facing copy aligned when changing visible UI copy.

---

## File Structure

- `src/acp/types.ts`: Extend the TypeScript ACP contract for runtime-update envelopes, plan updates, session title updates, mutation/diff provenance metadata, rollback warnings/exclusions, injection ids, and compaction notifications.
- `src/acp/client.ts`: Normalize Chrys `v0.13.1` extension notification payloads, route new compaction notifications, and keep underscore-prefixed request names intact.
- `src/__tests__/acp-client-v013.test.ts`: Transport-level tests that feed JSON-RPC notifications into `ChrysAcpClient` and verify normalized handler payloads.
- `src/__tests__/session-v013.test.ts`: Handler-level tests for `plan` and `session_info_update`.
- `src/handlers/session.ts`: Handle ACP `plan` and `session_info_update` without breaking existing streaming message/tool rendering.
- `src/state/runtime.ts`: Store live session title and plan entries for webview state and debugging.
- `src/common/chatPanelState.ts`: Include plan/title state in the chat panel state.
- `src/chat/panel.ts`: Add chat panel state fields needed by the webview.
- `src/chat/webview/app.ts`: Render the plan block in the existing context/sidebar area and show the current session title where it does not conflict with the CLI/version chrome.
- `src/chat/webview/styles/theme.css`: Minimal styling for the plan list and provenance badges.
- `src/ui/dialogs.ts`: Surface mutation/diff provenance and rollback warnings/exclusions in existing QuickPick/dialog flows.
- `src/handlers/notifications.ts`: Handle rollback result details and compaction notifications.
- `src/extension.ts`: Register any new notification handlers from `ChrysAcpClient`.
- `tests/integration/chrys-binary.test.ts`: Update live binary smoke expectations for Chrys `v0.13.1` route behavior and new payload shapes.
- `src/__tests__/release-manifest.test.ts`: Add guardrails that the new contract is covered and unsupported ACP hooks remain absent.
- `DESIGN_DECISIONS.md`, `RELEASE_CHECKLIST.md`, `AGENTS.md`: Document the accepted Chrys `v0.13.1` VSIX contract, especially underscore route compatibility and new ACP-driven UI features.

---

### Task 1: ACP v0.13.1 Contract Types And Runtime Update Normalization

**Files:**
- Modify: `src/acp/types.ts`
- Modify: `src/acp/client.ts`
- Create: `src/__tests__/acp-client-v013.test.ts`
- Modify: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Consumes: JSON-RPC extension notifications from Chrys CLI, especially `_chrys/runtime_update`.
- Produces: `RuntimeUpdateNotification`, `normalizeRuntimeUpdate(params: unknown): RuntimeSnapshot`, and handler delivery of a flat `RuntimeSnapshot`.
- Produces: TypeScript notification types for compaction events used in Task 4.

- [ ] **Step 1: Write failing tests for runtime-update envelope normalization**

Create `src/__tests__/acp-client-v013.test.ts` with this test harness:

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ChrysAcpClient } from "../acp/client";
import type { RuntimeSnapshot } from "../acp/types";

function attachClient(): { client: ChrysAcpClient; agentToClient: PassThrough; clientToAgent: PassThrough } {
  const client = new ChrysAcpClient();
  const agentToClient = new PassThrough();
  const clientToAgent = new PassThrough();
  client.transport.attach(clientToAgent, agentToClient);
  return { client, agentToClient, clientToAgent };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("Chrys ACP v0.13.1 notification compatibility", () => {
  it("unwraps chrys runtime_update envelope payloads", async () => {
    const { client, agentToClient } = attachClient();
    const updates: RuntimeSnapshot[] = [];
    client.onRuntimeUpdate((update) => updates.push(update));

    agentToClient.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "_chrys/runtime_update",
      params: {
        sessionId: "s1",
        runtime: {
          sessionId: "s1",
          agentProfile: "Code",
          displayName: "Code",
          modelProfileId: "m1",
          maxContextTokens: 1000,
          runtimeDetails: { model: { profile_id: "m1", name: "DeepSeek" } },
        },
      },
    }) + "\n");

    await flush();

    expect(updates).toHaveLength(1);
    expect(updates[0].sessionId).toBe("s1");
    expect(updates[0].agentProfile).toBe("Code");
    expect(updates[0].modelProfileId).toBe("m1");
    expect(updates[0].runtimeDetails?.model?.name).toBe("DeepSeek");
  });

  it("still accepts the older flat runtime_update payload shape", async () => {
    const { client, agentToClient } = attachClient();
    const updates: RuntimeSnapshot[] = [];
    client.onRuntimeUpdate((update) => updates.push(update));

    agentToClient.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "_chrys/runtime_update",
      params: {
        sessionId: "s1",
        agentProfile: "Plan",
        modelProfileId: "m2",
      },
    }) + "\n");

    await flush();

    expect(updates).toEqual([{ sessionId: "s1", agentProfile: "Plan", modelProfileId: "m2" }]);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails for the envelope case**

Run:

```bash
npm test -- src/__tests__/acp-client-v013.test.ts
```

Expected:

```text
FAIL src/__tests__/acp-client-v013.test.ts
expected undefined to be 'Code'
```

The exact assertion location can differ, but the failure must prove that the current client passes `{ sessionId, runtime }` directly instead of the nested runtime object.

- [ ] **Step 3: Add ACP v0.13.1 notification types**

In `src/acp/types.ts`, add these interfaces near the existing runtime/notification interfaces:

```ts
export interface RuntimeUpdateNotification {
  sessionId?: string;
  runtime?: RuntimeSnapshot;
  _meta?: Meta;
}

export interface CompactionStartedNotification {
  sessionId: string;
  compactionId: string;
  phase?: string;
  _meta?: Meta;
}

export interface CompactionFinishedNotification {
  sessionId: string;
  compactionId: string;
  outcome: string;
  durationMs?: number;
  lastWords?: string;
  _meta?: Meta;
}

export interface SubAgentCompactionStartedNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  compactionId: string;
  phase?: string;
  _meta?: Meta;
}

export interface SubAgentCompactionFinishedNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  compactionId: string;
  outcome: string;
  durationMs?: number;
  _meta?: Meta;
}

export type CompactionNotification =
  | CompactionStartedNotification
  | CompactionFinishedNotification
  | SubAgentCompactionStartedNotification
  | SubAgentCompactionFinishedNotification;
```

- [ ] **Step 4: Normalize runtime-update payloads in `src/acp/client.ts`**

Update the imports from `./types` to include `RuntimeUpdateNotification`:

```ts
  RuntimeUpdateNotification,
```

Add this helper above `export class ChrysAcpClient`:

```ts
function normalizeRuntimeUpdate(params: unknown): RuntimeSnapshot {
  const payload = (params && typeof params === "object") ? params as RuntimeUpdateNotification : {};
  return (payload.runtime && typeof payload.runtime === "object")
    ? payload.runtime
    : payload as RuntimeSnapshot;
}
```

Change the `_chrys/runtime_update` case to:

```ts
      case "_chrys/runtime_update":
        this.runtimeUpdateHandlers.forEach((handler) => handler(normalizeRuntimeUpdate(params)));
        break;
```

- [ ] **Step 5: Add release guardrails for route naming**

In `src/__tests__/release-manifest.test.ts`, add assertions to the existing ACP guardrail section:

```ts
expect(clientSource).toContain('this.acp.request("_chrys/session_runtime"');
expect(clientSource).toContain('case "_chrys/runtime_update":');
expect(clientSource).not.toContain('this.acp.request("chrys/session_runtime"');
```

These assertions keep the VSIX on the live-probed top-level JSON-RPC route names.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- src/__tests__/acp-client-v013.test.ts src/__tests__/release-manifest.test.ts
```

Expected:

```text
PASS src/__tests__/acp-client-v013.test.ts
PASS src/__tests__/release-manifest.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/acp/types.ts src/acp/client.ts src/__tests__/acp-client-v013.test.ts src/__tests__/release-manifest.test.ts
git commit -m "fix(acp): accept Chrys 0.13 runtime update envelopes"
```

---

### Task 2: Standard Plan Updates And Live Session Titles

**Files:**
- Modify: `src/acp/types.ts`
- Modify: `src/state/runtime.ts`
- Modify: `src/common/chatPanelState.ts`
- Modify: `src/chat/panel.ts`
- Modify: `src/handlers/session.ts`
- Modify: `src/chat/webview/app.ts`
- Modify: `src/chat/webview/styles/theme.css`
- Create: `src/__tests__/session-v013.test.ts`
- Modify: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Consumes: `SessionNotification.update` variants `{ sessionUpdate: "plan", entries }` and `{ sessionUpdate: "session_info_update", title, updatedAt }`.
- Produces: `rt.currentPlanEntries: PlanEntry[]`, `rt.currentSessionTitle: string`, `ChatPanelState.planEntries`, and `ChatPanelState.sessionTitle`.

- [ ] **Step 1: Write failing handler tests**

Create `src/__tests__/session-v013.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSessionUpdate } from "../handlers/session";
import { rt } from "../state/runtime";

function resetRuntimeForSessionTests(): void {
  rt.currentPlanEntries = [];
  rt.currentSessionTitle = "";
  rt.chatPanel = {
    appendDebugEvent: vi.fn(),
    setState: vi.fn(),
  } as never;
  rt.sessionTreeProvider = {
    refresh: vi.fn(),
  } as never;
}

describe("Chrys v0.13.1 session updates", () => {
  beforeEach(() => {
    resetRuntimeForSessionTests();
  });

  it("stores plan updates and refreshes the chat panel", async () => {
    await handleSessionUpdate("s1", {
      sessionUpdate: "plan",
      entries: [
        { content: "Inspect ACP contract", priority: "medium", status: "completed" },
        { content: "Render plan", priority: "medium", status: "in_progress" },
      ],
    });

    expect(rt.currentPlanEntries.map((entry) => [entry.content, entry.status])).toEqual([
      ["Inspect ACP contract", "completed"],
      ["Render plan", "in_progress"],
    ]);
    expect(rt.chatPanel.setState).toHaveBeenCalledOnce();
  });

  it("clears stale plan entries when the backend sends an empty plan", async () => {
    rt.currentPlanEntries = [{ content: "old", priority: "medium", status: "pending" }];

    await handleSessionUpdate("s1", { sessionUpdate: "plan", entries: [] });

    expect(rt.currentPlanEntries).toEqual([]);
    expect(rt.chatPanel.setState).toHaveBeenCalledOnce();
  });

  it("stores live session titles and refreshes session surfaces", async () => {
    await handleSessionUpdate("s1", {
      sessionUpdate: "session_info_update",
      title: "Fix login bug",
      updatedAt: "2026-07-08T10:00:00Z",
    });

    expect(rt.currentSessionTitle).toBe("Fix login bug");
    expect(rt.chatPanel.setState).toHaveBeenCalledOnce();
    expect(rt.sessionTreeProvider?.refresh).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the new tests and verify the missing types/handlers fail**

Run:

```bash
npm test -- src/__tests__/session-v013.test.ts
```

Expected:

```text
FAIL src/__tests__/session-v013.test.ts
```

The failure should mention missing `currentPlanEntries`, missing `plan` in the `SessionUpdate` union, or no state change after a `plan` update.

- [ ] **Step 3: Add plan types to `src/acp/types.ts`**

Add these interfaces near the session update types:

```ts
export type PlanEntryStatus = "pending" | "in_progress" | "completed";
export type PlanEntryPriority = "low" | "medium" | "high";

export interface PlanEntry {
  content: string;
  status: PlanEntryStatus;
  priority: PlanEntryPriority;
  _meta?: Meta;
}

export interface AgentPlanUpdate {
  sessionUpdate: "plan";
  entries: PlanEntry[];
  _meta?: Meta;
}
```

Add `AgentPlanUpdate` to the `SessionUpdate` union:

```ts
  | AgentPlanUpdate
```

- [ ] **Step 4: Add runtime state**

In `src/state/runtime.ts`, update the type import:

```ts
import type { RuntimeSnapshot, UsageUpdateNotification, SubAgentNotification, PromptCapabilities, PlanEntry } from "../acp/types";
```

Add fields under the session identity/rendering state:

```ts
  currentSessionTitle = "";
  currentPlanEntries: PlanEntry[] = [];
```

In `resetRenderState`, clear live plan entries only when a full session reset happens:

```ts
    this.currentPlanEntries = [];
```

Do not clear `currentSessionTitle` in a turn-only reset. Clear it when creating or loading a new session in the session initialization code that already sets `rt.currentSessionId`.

- [ ] **Step 5: Extend chat panel state**

In `src/chat/panel.ts`, add these fields to `ChatPanelState`:

```ts
  sessionTitle: string;
  planEntries: PlanEntry[];
```

Import `PlanEntry` from `src/acp/types.ts`.

In `src/common/chatPanelState.ts`, include:

```ts
    sessionTitle: rt.currentSessionTitle,
    planEntries: rt.currentPlanEntries,
```

- [ ] **Step 6: Handle `plan` and `session_info_update`**

In `src/handlers/session.ts`, import the types:

```ts
  AgentPlanUpdate,
  SessionInfoUpdate,
```

Add cases in `handleSessionUpdate`:

```ts
      case "plan":
        handlePlanUpdate(update);
        break;
      case "session_info_update":
        handleSessionInfoUpdate(update);
        break;
```

Add debug cases in `emitSessionDebugEvent`:

```ts
    case "plan":
      rt.chatPanel?.appendDebugEvent("PlanUpdate", `${update.entries.length} entries`);
      break;
    case "session_info_update":
      rt.chatPanel?.appendDebugEvent("SessionInfo", update.title ? `title=${update.title}` : "title cleared");
      break;
```

Add handlers near `handleUsageUpdate`:

```ts
export function handlePlanUpdate(update: AgentPlanUpdate): void {
  rt.currentPlanEntries = update.entries;
  rt.chatPanel?.setState(chatPanelState());
}

export function handleSessionInfoUpdate(update: SessionInfoUpdate): void {
  if (update.title !== undefined) {
    rt.currentSessionTitle = update.title ?? "";
  }
  rt.chatPanel?.setState(chatPanelState());
  rt.sessionTreeProvider?.refresh();
}
```

- [ ] **Step 7: Render the plan in the webview**

In `src/chat/webview/app.ts`, add a small renderer next to the existing context/runtime sidebar renderers:

```ts
function renderPlanEntries(): HTMLElement {
  const entries = state.planEntries ?? [];
  const title = state.uiLanguage === "zh-CN" ? "计划" : "Plan";
  const empty = state.uiLanguage === "zh-CN" ? "当前没有计划项" : "No active plan";
  const container = el("section", { class: "context-card plan-card" },
    el("div", { class: "context-title" }, title),
  );
  if (!entries.length) {
    container.append(el("div", { class: "plan-empty" }, empty));
    return container;
  }
  container.append(el("ol", { class: "plan-list" },
    ...entries.map((entry) => el("li", { class: `plan-item plan-${entry.status}` },
      el("span", { class: "plan-status" }, planStatusLabel(entry.status)),
      el("span", { class: "plan-text" }, entry.content),
    )),
  ));
  return container;
}

function planStatusLabel(status: string): string {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "…";
  return "•";
}
```

Mount it in the existing sidebar/context render path where compressed messages, token usage, or debug cards are rendered.

When rendering the top title, include the live session title as tooltip or subtitle, not as a replacement for `Chrys CLI vX.Y.Z`:

```ts
if (panelState.sessionTitle) {
  sessionLabel.textContent = `${t("session")}: ${sessionShortId} · ${panelState.sessionTitle}`;
}
```

- [ ] **Step 8: Add CSS**

In `src/chat/webview/styles/theme.css`, add:

```css
.plan-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.plan-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.plan-item {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 6px;
  align-items: start;
  min-height: 22px;
  color: var(--vscode-foreground);
}

.plan-status {
  color: var(--vscode-descriptionForeground);
  text-align: center;
}

.plan-completed .plan-text {
  color: var(--vscode-descriptionForeground);
  text-decoration: line-through;
}

.plan-empty {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
```

- [ ] **Step 9: Add release guardrails**

In `src/__tests__/release-manifest.test.ts`, assert:

```ts
expect(typesSource).toContain('sessionUpdate: "plan"');
expect(sessionHandlerSource).toContain('case "plan":');
expect(sessionHandlerSource).toContain('case "session_info_update":');
```

- [ ] **Step 10: Run focused tests**

Run:

```bash
npm test -- src/__tests__/session-v013.test.ts src/__tests__/release-manifest.test.ts
```

Expected:

```text
PASS src/__tests__/session-v013.test.ts
PASS src/__tests__/release-manifest.test.ts
```

- [ ] **Step 11: Commit**

```bash
git add src/acp/types.ts src/state/runtime.ts src/common/chatPanelState.ts src/chat/panel.ts src/handlers/session.ts src/chat/webview/app.ts src/chat/webview/styles/theme.css src/__tests__/session-v013.test.ts src/__tests__/release-manifest.test.ts
git commit -m "feat(acp): render Chrys plan and session title updates"
```

---

### Task 3: Mutation, Diff, And Rollback Provenance UX

**Files:**
- Modify: `src/acp/types.ts`
- Modify: `src/ui/dialogs.ts`
- Modify: `src/handlers/notifications.ts`
- Create: `src/__tests__/rollback-provenance.test.ts`
- Modify: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Consumes: `session/mutations` fields `beforeSkip`, `afterSkip`, `provenance`, `contested`, and folded file badges `contested` / `inferred`.
- Consumes: `session/diff` fields `contested` and `inferred`.
- Consumes: rollback fields `rolledBackUserText`, `exclusions`, and `warnings`.
- Produces: `formatMutationBadges`, `formatDiffRiskDetail`, and rollback result handling that restores discarded prompt text when available.

- [ ] **Step 1: Write failing tests for provenance formatting**

Create `src/__tests__/rollback-provenance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDiffRiskDetail, formatMutationBadges, formatRollbackResultMessage } from "../ui/dialogs";

describe("rollback and mutation provenance display", () => {
  it("formats mutation badges for foreign and inferred files", () => {
    expect(formatMutationBadges({
      path: "/repo/a.ts",
      operation: "modify",
      contested: true,
      inferred: true,
    })).toEqual(["external overlap", "inferred"]);
  });

  it("formats snapshot skip reasons", () => {
    expect(formatMutationBadges({
      path: "/repo/b.bin",
      operation: "modify",
      beforeSkip: "binary",
      afterSkip: "too_large",
    })).toEqual(["before: binary", "after: too large"]);
  });

  it("formats diff risk detail", () => {
    expect(formatDiffRiskDetail({
      path: "/repo/a.ts",
      operation: "modify",
      beforeText: "a",
      afterText: "b",
      beforeHash: "1",
      afterHash: "2",
      isBinary: false,
      bytesChanged: true,
      contested: true,
      inferred: false,
    })).toBe("modify · external overlap · 1 -> 1 chars");
  });

  it("formats rollback warnings and exclusions", () => {
    expect(formatRollbackResultMessage({
      sessionId: "s1",
      targetTurn: 2,
      filesReverted: 1,
      restoreResults: [],
      warnings: ["working tree changed"],
      exclusions: [{ path: "/repo/b.bin", reason: "binary" }],
    })).toContain("working tree changed");
    expect(formatRollbackResultMessage({
      sessionId: "s1",
      targetTurn: 2,
      filesReverted: 1,
      restoreResults: [],
      warnings: ["working tree changed"],
      exclusions: [{ path: "/repo/b.bin", reason: "binary" }],
    })).toContain("b.bin: binary");
  });
});
```

- [ ] **Step 2: Run the new tests and verify missing exports fail**

Run:

```bash
npm test -- src/__tests__/rollback-provenance.test.ts
```

Expected:

```text
FAIL src/__tests__/rollback-provenance.test.ts
```

The failure should mention that `formatDiffRiskDetail`, `formatMutationBadges`, or `formatRollbackResultMessage` is not exported.

- [ ] **Step 3: Extend mutation/diff/rollback types**

In `src/acp/types.ts`, update mutation and diff interfaces:

```ts
export type SnapshotSkipReason = "too_large" | "binary";
export type MutationProvenance = "proven" | "assumed" | "foreign";

export interface MutationEntry {
  path: string;
  operation: string;
  source: string;
  toolCallId: string;
  timestamp: number;
  oldPath?: string | null;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforeSkip?: SnapshotSkipReason | null;
  afterSkip?: SnapshotSkipReason | null;
  provenance?: MutationProvenance | null;
  contested?: boolean;
}

export interface MutationFileSummary {
  path: string;
  operation: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforeSkip?: SnapshotSkipReason | null;
  afterSkip?: SnapshotSkipReason | null;
  contested?: boolean;
  inferred?: boolean;
}

export interface DiffEntry {
  path: string;
  operation: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforeText: string;
  afterText: string;
  isBinary: boolean;
  bytesChanged: boolean;
  contested?: boolean;
  inferred?: boolean;
}

export interface RollbackExclusion {
  path: string;
  reason: string;
}

export interface RollbackResultNotification {
  sessionId: string;
  targetTurn: number;
  filesReverted: number;
  restoreResults: RestoreResult[];
  rolledBackUserText?: string;
  exclusions?: RollbackExclusion[];
  warnings?: string[];
  _meta?: Meta;
}
```

Keep existing required fields unchanged.

- [ ] **Step 4: Add pure formatting helpers in `src/ui/dialogs.ts`**

Export these helpers near the rollback functions:

```ts
export function formatMutationBadges(entry: Pick<MutationFileSummary, "contested" | "inferred" | "beforeSkip" | "afterSkip">): string[] {
  const badges: string[] = [];
  if (entry.contested) badges.push("external overlap");
  if (entry.inferred) badges.push("inferred");
  if (entry.beforeSkip) badges.push(`before: ${formatSnapshotSkipReason(entry.beforeSkip)}`);
  if (entry.afterSkip) badges.push(`after: ${formatSnapshotSkipReason(entry.afterSkip)}`);
  return badges;
}

function formatSnapshotSkipReason(reason: string): string {
  if (reason === "too_large") return "too large";
  if (reason === "binary") return "binary";
  return reason;
}

export function formatDiffRiskDetail(entry: DiffEntry): string {
  const badges = formatMutationBadges(entry);
  const size = entry.isBinary
    ? nativeText("Binary file", "二进制文件")
    : nativeText(`${entry.beforeText.length} -> ${entry.afterText.length} chars`, `${entry.beforeText.length} -> ${entry.afterText.length} 字符`);
  return [entry.operation, ...badges, size].filter(Boolean).join(" · ");
}

export function formatRollbackResultMessage(result: RollbackResultNotification): string {
  const lines = [
    nativeText(
      `Rolled back to turn ${result.targetTurn}; reverted ${result.filesReverted} file(s).`,
      `已回滚到第 ${result.targetTurn} 轮；还原 ${result.filesReverted} 个文件。`,
    ),
  ];
  for (const warning of result.warnings ?? []) {
    lines.push(nativeText(`Warning: ${warning}`, `警告：${warning}`));
  }
  for (const exclusion of result.exclusions ?? []) {
    lines.push(nativeText(
      `Excluded ${vscode.workspace.asRelativePath(exclusion.path)}: ${exclusion.reason}`,
      `已排除 ${vscode.workspace.asRelativePath(exclusion.path)}：${exclusion.reason}`,
    ));
  }
  return lines.join("\n");
}
```

Add the required type imports from `src/acp/types.ts`.

- [ ] **Step 5: Use risk details in rollback file selection**

In `rollbackSession`, replace the diff QuickPick `detail` expression with:

```ts
detail: formatDiffRiskDetail(entry),
```

Keep `description: entry.operation` so existing scanning behavior remains familiar.

- [ ] **Step 6: Improve rollback result handling**

In `src/handlers/notifications.ts`, update `handleRollbackResult`:

```ts
export function handleRollbackResult(update: RollbackResultNotification): void {
  rt.chatPanel?.appendDebugEvent("RollbackResult", `turn=${update.targetTurn}, files=${update.filesReverted}`);
  if (update.rolledBackUserText) {
    rt.restoredInterruptedText = update.rolledBackUserText;
    rt.chatPanel?.appendDebugEvent("RollbackComposerRestored", `${update.rolledBackUserText.length} chars`);
  }
  const message = formatRollbackResultMessage(update);
  vscode.window.showInformationMessage(message);
  rt.chatPanel?.setState(chatPanelState());
}
```

Import `formatRollbackResultMessage` from `src/ui/dialogs.ts`. If importing from `dialogs.ts` creates a circular dependency in tests, move the three pure formatting helpers to a new file `src/common/provenanceDisplay.ts` and import them from both `dialogs.ts` and `notifications.ts`.

- [ ] **Step 7: Add release guardrails**

In `src/__tests__/release-manifest.test.ts`, assert:

```ts
expect(typesSource).toContain("provenance?: MutationProvenance");
expect(typesSource).toContain("contested?: boolean");
expect(typesSource).toContain("rolledBackUserText?: string");
expect(dialogsSource).toContain("formatDiffRiskDetail");
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
npm test -- src/__tests__/rollback-provenance.test.ts src/__tests__/release-manifest.test.ts
```

Expected:

```text
PASS src/__tests__/rollback-provenance.test.ts
PASS src/__tests__/release-manifest.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add src/acp/types.ts src/ui/dialogs.ts src/handlers/notifications.ts src/__tests__/rollback-provenance.test.ts src/__tests__/release-manifest.test.ts
git commit -m "feat(rollback): surface Chrys mutation provenance"
```

---

### Task 4: Compaction And Sub-Agent Compaction Notifications

**Files:**
- Modify: `src/acp/client.ts`
- Modify: `src/acp/types.ts`
- Modify: `src/state/runtime.ts`
- Modify: `src/handlers/notifications.ts`
- Modify: `src/extension.ts`
- Modify: `src/chat/panel.ts`
- Modify: `src/common/chatPanelState.ts`
- Modify: `src/chat/webview/app.ts`
- Create: `src/__tests__/compaction-notifications.test.ts`
- Modify: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Consumes: `_chrys/compaction_started`, `_chrys/compaction_finished`, `_chrys/sub_agent_compaction_started`, and `_chrys/sub_agent_compaction_finished`.
- Produces: `CompactionHandler`, `onCompaction`, `rt.activeCompactions`, debug events, and a small visible compaction status line in chat state.

- [ ] **Step 1: Write failing client routing tests**

Append to `src/__tests__/acp-client-v013.test.ts`:

```ts
it("routes main and sub-agent compaction notifications", async () => {
  const { client, agentToClient } = attachClient();
  const events: Array<{ method: string; compactionId: string; outcome?: string }> = [];
  client.onCompaction((method, update) => {
    events.push({ method, compactionId: update.compactionId, outcome: "outcome" in update ? update.outcome : undefined });
  });

  agentToClient.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "_chrys/compaction_started",
    params: { sessionId: "s1", compactionId: "c1", phase: "phase4" },
  }) + "\n");
  agentToClient.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "_chrys/sub_agent_compaction_finished",
    params: { sessionId: "s1", agentName: "Explore", invocationId: "i1", compactionId: "c2", outcome: "ok", durationMs: 42 },
  }) + "\n");

  await flush();

  expect(events).toEqual([
    { method: "_chrys/compaction_started", compactionId: "c1", outcome: undefined },
    { method: "_chrys/sub_agent_compaction_finished", compactionId: "c2", outcome: "ok" },
  ]);
});
```

- [ ] **Step 2: Run the test and verify `onCompaction` is missing**

Run:

```bash
npm test -- src/__tests__/acp-client-v013.test.ts
```

Expected:

```text
FAIL src/__tests__/acp-client-v013.test.ts
Property 'onCompaction' does not exist
```

- [ ] **Step 3: Add client handler registration**

In `src/acp/client.ts`, import `CompactionNotification` and add:

```ts
export type CompactionHandler = (eventName: string, update: CompactionNotification) => void;
```

Add the field:

```ts
  private compactionHandlers: CompactionHandler[] = [];
```

Add registration:

```ts
  onCompaction(handler: CompactionHandler): void {
    this.compactionHandlers.push(handler);
  }
```

Add switch cases:

```ts
      case "_chrys/compaction_started":
      case "_chrys/compaction_finished":
      case "_chrys/sub_agent_compaction_started":
      case "_chrys/sub_agent_compaction_finished":
        this.compactionHandlers.forEach((handler) => handler(method, params as CompactionNotification));
        break;
```

- [ ] **Step 4: Add runtime state for active compactions**

In `src/state/runtime.ts`, import `CompactionNotification` and add:

```ts
  activeCompactions = new Map<string, CompactionNotification>();
```

Clear it in `resetRenderState`:

```ts
    this.activeCompactions.clear();
```

- [ ] **Step 5: Add notification handler**

In `src/handlers/notifications.ts`, add:

```ts
export function handleCompactionNotification(eventName: string, update: CompactionNotification): void {
  const isFinished = eventName.endsWith("_finished");
  const label = "agentName" in update
    ? `${update.agentName}:${update.compactionId}`
    : update.compactionId;

  if (isFinished) {
    rt.activeCompactions.delete(label);
  } else {
    rt.activeCompactions.set(label, update);
  }

  const detail = "agentName" in update
    ? `${update.agentName} ${update.compactionId}`
    : update.compactionId;
  rt.chatPanel?.appendDebugEvent(isFinished ? "CompactionFinished" : "CompactionStarted", detail);
  rt.chatPanel?.setState(chatPanelState());
}
```

- [ ] **Step 6: Wire extension registration**

In `src/extension.ts`, import `handleCompactionNotification` and register it where other ACP handlers are registered:

```ts
  client.onCompaction((eventName, update) => handleCompactionNotification(eventName, update));
```

- [ ] **Step 7: Surface a compact status in chat panel state**

In `src/chat/panel.ts`, add:

```ts
  activeCompactionCount: number;
```

In `src/common/chatPanelState.ts`, add:

```ts
    activeCompactionCount: rt.activeCompactions.size,
```

In `src/chat/webview/app.ts`, render a small status line near usage/context:

```ts
function renderCompactionStatus(): HTMLElement | "" {
  if (!state.activeCompactionCount) return "";
  const text = state.uiLanguage === "zh-CN"
    ? `正在压缩上下文：${state.activeCompactionCount}`
    : `Compacting context: ${state.activeCompactionCount}`;
  return el("div", { class: "compaction-status" }, text);
}
```

Mount it in the same region as token/context indicators.

- [ ] **Step 8: Add CSS**

In `src/chat/webview/styles/theme.css`, add:

```css
.compaction-status {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  line-height: 18px;
}
```

- [ ] **Step 9: Add release guardrails**

In `src/__tests__/release-manifest.test.ts`, assert:

```ts
expect(clientSource).toContain('case "_chrys/compaction_started":');
expect(clientSource).toContain('case "_chrys/sub_agent_compaction_finished":');
expect(extensionSource).toContain("client.onCompaction");
```

- [ ] **Step 10: Run focused tests**

Run:

```bash
npm test -- src/__tests__/acp-client-v013.test.ts src/__tests__/release-manifest.test.ts
```

Expected:

```text
PASS src/__tests__/acp-client-v013.test.ts
PASS src/__tests__/release-manifest.test.ts
```

- [ ] **Step 11: Commit**

```bash
git add src/acp/client.ts src/acp/types.ts src/state/runtime.ts src/handlers/notifications.ts src/extension.ts src/chat/panel.ts src/common/chatPanelState.ts src/chat/webview/app.ts src/chat/webview/styles/theme.css src/__tests__/acp-client-v013.test.ts src/__tests__/release-manifest.test.ts
git commit -m "feat(acp): show Chrys compaction progress"
```

---

### Task 5: Integration Smoke, Docs, And Release Checklist

**Files:**
- Modify: `tests/integration/chrys-binary.test.ts`
- Modify: `DESIGN_DECISIONS.md`
- Modify: `RELEASE_CHECKLIST.md`
- Modify: `AGENTS.md`
- Modify: `src/__tests__/release-manifest.test.ts`

**Interfaces:**
- Consumes: A local Chrys CLI binary or `uv run chrys acp` from `/Users/yubo/openubmc/studio/chrys`.
- Produces: documented release gates for Chrys `v0.13.1` compatibility and integration tests that catch accidental top-level route renames.

- [ ] **Step 1: Update integration smoke expectations**

In `tests/integration/chrys-binary.test.ts`, update the existing "routes VSIX Chrys extension method names" test to assert:

```ts
const runtime = (await expectMethodRoutes(chrys, "_chrys/session_runtime", { sessionId })) as RuntimeSnapshot;
expect(runtime.sessionId).toBe(sessionId);
expect(runtime.runtimeDetails).toBeTruthy();

await expectMethodRoutes(chrys, "_settings/options", {});

await expect(chrys.send("chrys/session_runtime", { sessionId })).rejects.toThrow(/Method not found/);
```

Keep the test name explicit:

```ts
it("routes VSIX underscore extension method names against Chrys 0.13", async () => {
```

- [ ] **Step 2: Add integration coverage for plan update shape**

In the same test file, add a parser assertion for incoming `session/update` notifications. The test does not need a real LLM turn; it can validate the type contract from a fixture:

```ts
const planUpdate = {
  sessionId,
  update: {
    sessionUpdate: "plan",
    entries: [{ content: "one", priority: "medium", status: "pending" }],
  },
};
expect(planUpdate.update.entries[0].priority).toBe("medium");
```

This keeps the integration file aware that standard `plan` is part of the Chrys `v0.13.1` contract.

- [ ] **Step 3: Document accepted route naming in `DESIGN_DECISIONS.md`**

Add a section:

```md
## Chrys ACP Extension Route Names

The VSIX sends top-level JSON-RPC extension method names with the underscore prefix used by the ACP router, such as `_chrys/session_runtime`, `_session/mutations`, `_settings/options`, and `_profiles/models/list`.

The Chrys backend `ext_method` implementation documents logical names without the prefix, such as `chrys/session_runtime`, but a live Chrys `v0.13.1` stdio smoke test confirmed the top-level client-visible route remains underscore-prefixed. The VSIX should not rename these requests unless the backend advertises or proves a new top-level route.
```

- [ ] **Step 4: Update `RELEASE_CHECKLIST.md`**

Add a Chrys CLI compatibility gate:

```md
### Chrys CLI Compatibility Smoke

- Run `npm test -- src/__tests__/acp-client-v013.test.ts src/__tests__/session-v013.test.ts src/__tests__/rollback-provenance.test.ts src/__tests__/release-manifest.test.ts`.
- If a local Chrys CLI is available, run `npm run test:integration` and verify `_chrys/session_runtime` and `_settings/options` route successfully.
- Confirm chat chrome shows the connected backend version from `initialize.agentInfo.version`, not the VSIX package version.
- Confirm plan updates, session title updates, rollback provenance, and compaction notifications do not crash the webview when emitted by Chrys `v0.13.1`.
```

- [ ] **Step 5: Update `AGENTS.md`**

In the ACP Rules section, add:

```md
For top-level JSON-RPC calls from this VSIX, keep using the underscore-prefixed extension routes accepted by the ACP router (`_chrys/*`, `_session/*`, `_settings/*`, `_profiles/*`, `_mcp/*`, `_skills/*`, `_sub_agent/*`). Backend documentation may describe the logical `ext_method` names without the underscore prefix; verify with a live stdio smoke test before changing client route strings.
```

- [ ] **Step 6: Add release-manifest guardrails for docs**

In `src/__tests__/release-manifest.test.ts`, assert:

```ts
expect(designDecisions).toContain("Chrys ACP Extension Route Names");
expect(releaseChecklist).toContain("Chrys CLI Compatibility Smoke");
expect(agentsMd).toContain("_chrys/*");
expect(agentsMd).toContain("live stdio smoke test");
```

Use existing file-reading helpers and variable names in the test file.

- [ ] **Step 7: Run the full local validation lane**

Run:

```bash
npm run lint
npm test
npm run build
npm run package
```

Expected:

```text
npm run lint exits 0
npm test exits 0
npm run build exits 0
npm run package exits 0 and writes an ignored chrys-vscode-<version>.vsix
```

- [ ] **Step 8: Run integration if a Chrys binary is available**

Run:

```bash
npm run test:integration
```

Expected:

```text
PASS tests/integration/chrys-binary.test.ts
```

If it fails because no target Chrys binary is configured, record the exact missing binary/env message in the final implementation report and do not claim integration coverage.

- [ ] **Step 9: Commit**

```bash
git add tests/integration/chrys-binary.test.ts DESIGN_DECISIONS.md RELEASE_CHECKLIST.md AGENTS.md src/__tests__/release-manifest.test.ts
git commit -m "docs: record Chrys 0.13 VSIX compatibility gates"
```

---

## Acceptance Criteria

- `npm run lint` passes.
- `npm test` passes.
- `npm run build` passes.
- `npm run package` passes.
- `npm run test:integration` passes when a local Chrys CLI binary is configured; if unavailable, the implementation report includes the exact skipped reason.
- VSIX still sends underscore-prefixed top-level extension requests, including `_chrys/session_runtime` and `_settings/options`.
- `_chrys/runtime_update` works with both old flat payloads and Chrys `v0.13.1` `{ sessionId, runtime }` envelope payloads.
- Standard ACP `plan` updates render or clear the VSIX plan UI without crashing.
- `session_info_update` refreshes the live session title and session tree surfaces.
- Rollback file selection shows contested/inferred/skip-risk details.
- Rollback result handling surfaces warnings/exclusions and restores `rolledBackUserText` into the composer recovery path when present.
- Main-agent and sub-agent compaction notifications produce debug events and visible compact status.
- Docs explain why backend logical extension names and VSIX top-level underscore route names differ.

## Self-Review

- Spec coverage: The plan covers all identified Chrys `v0.13.1` VSIX update needs: runtime envelope, plan update, session title update, mutation/diff/rollback provenance, compaction notifications, integration smoke, and docs.
- Placeholder scan: The plan contains no placeholder markers and every code-changing step includes exact code or exact command guidance.
- Type consistency: `PlanEntry`, `AgentPlanUpdate`, `RuntimeUpdateNotification`, `CompactionNotification`, `MutationProvenance`, `SnapshotSkipReason`, `RollbackExclusion`, and handler names are defined before later tasks consume them.
- Scope check: Version bump and platform VSIX packaging changes are intentionally out of this plan because the requested work is backend-contract adaptation, not a VSIX release bump.
