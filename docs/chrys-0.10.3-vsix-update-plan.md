# Chrys 0.10.3 VSIX Update Plan

## Scope

This plan is for the standalone `chrys-vscode` repository only.

Do not modify the Chrys backend repository. The backend source under `../chrys`
is used only as compatibility evidence for the VSIX frontend.

The comparison target is Chrys `v0.9.8` to `v0.10.3`. Code inspection found no
new callable Chrys ACP extension RPC names and no new Chrys ACP notification
names. The useful VSIX updates are therefore compatibility polish, payload
coverage, local file-path handling, and release guard updates.

## Evidence From Chrys Code

- `ChrysAcpServer.ext_method()` exposes the same method names in `v0.9.8` and
  `v0.10.3`.
- The Chrys extension notification name set is unchanged between those versions.
- `chrys/context_compressed` now includes a `turnRange` payload field.
- `session/load` and `session/history` can read recovery sidecar data when a
  session is recovered after an interrupted run.
- Chrys backend ACP source paths moved from `src/chrys/acp/*` to
  `src/chrys/app/acp/*`.
- Chrys supports `CHRYS_SESSION_ROOT_DIR`, so local session-file lookup should
  not assume `~/.chrys/sessions` only.

## Plan

Implementation status in this VSIX repo:

- Items 1-4 have been implemented in the frontend code, docs guardrails, and
  unit/release tests.
- Item 5 has integration smoke coverage added to `tests/integration`, but it
  still requires a local Chrys binary at the integration test's configured path
  before `npm run test:integration` can exercise it.

### 1. Accept `context_compressed.turnRange`

Files:

- `src/acp/types.ts`
- `src/handlers/notifications.ts`
- relevant unit or manifest tests under `src/__tests__/`

Work:

- Add `turnRange?: number[]` to `ContextCompressedNotification`.
- Include the range in debug/separator copy when present.
- Keep existing behavior when older Chrys versions omit the field.

Validation:

- Add or update a focused test for the optional field.
- Run `npm test -- src/__tests__/release-manifest.test.ts` or a narrower test if
  one exists after implementation.

### 2. Make Local Session File Lookup Honor `CHRYS_SESSION_ROOT_DIR`

Files:

- `src/common/sessionFiles.ts`
- tests covering session file path resolution

Work:

- Resolve the session root from `process.env.CHRYS_SESSION_ROOT_DIR` when set.
- Fall back to the existing Chrys user config session path when unset.
- Keep the current best-effort behavior for hosts where `session.json` is not
  present locally.

Validation:

- Add path resolution tests for default and custom root cases.
- Ensure support bundle and Sessions tree copy/open flows still tolerate missing
  local files.

### 3. Clarify ACP History Versus Local `session.json`

Files:

- `src/ui/dialogs.ts`
- `src/views/sessionTree.ts`
- support bundle or diagnostics tests, as applicable

Work:

- Treat `session/history` as the authoritative ACP persisted-history read.
- Treat local `session.json` as a best-effort file path for inspection.
- Adjust user-facing wording where it implies that `session.json` is always the
  exact source for displayed structured history.

Validation:

- Existing structured-history tests should still pass.
- Add a small assertion if wording is protected by manifest tests.

### 4. Update Backend Source Path References In VSIX Docs And Guards

Files:

- `AGENTS.md`
- `README.md`, `RELEASE_CHECKLIST.md`, or `DESIGN_DECISIONS.md` if they mention
  old backend paths
- `src/__tests__/release-manifest.test.ts`

Work:

- Replace references to `src/chrys/acp/server.py` with
  `src/chrys/app/acp/server.py`.
- Replace references to `src/chrys/acp/session_manager.py` with
  `src/chrys/app/acp/session_manager.py`.
- Keep the rule meaning unchanged: VSIX agents verify backend contracts in
  Chrys, but do not patch Chrys backend code for VSIX polish.

Validation:

- Run `npm test -- src/__tests__/release-manifest.test.ts`.

### 5. Add 0.10.3 ACP Compatibility Smoke Coverage

Files:

- `tests/integration/chrys-binary.test.ts` or a focused integration helper

Work:

- Keep the raw JSON-RPC method names that VSIX uses today:
  `_chrys/session_runtime`, `_session/mutations`, `session/set_mode`, and
  `session/set_model`.
- Add a smoke assertion that these names route against a 0.10.3 Chrys binary.
- Do not switch the VSIX client to raw `chrys/session_runtime` or
  `session/mutations`; those are internal extension names, not raw JSON-RPC
  method names for this client.

Validation:

- Run `npm run test:integration` with a Chrys 0.10.3 binary available.
- If local proxy settings block session creation, record that as an environment
  issue and keep unit coverage for the client method names.

## Explicit Non-Goals

- Do not implement session fork/resume in the VSIX yet. Chrys 0.10.3 TUI has
  fork behavior, but the ACP server does not expose a callable fork/resume
  contract.
- Do not add image-compression ACP event handling. Chrys code does not emit a
  VSIX-facing `chrys/image_attachment_compression_*` notification.
- Do not add Buddy backend calls. Buddy remains a disabled frontend placeholder
  until a supported ACP contract exists.
- Do not patch, vendor, rebuild, or otherwise change Chrys backend code from this
  repository.
