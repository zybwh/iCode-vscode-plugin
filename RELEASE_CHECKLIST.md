# VSIX Release Checklist

Use this checklist to decide whether the VS Code frontend is ready to ship. Keep it focused on release-blocking UX, coding-agent capability, and parity diagnostics. Do not use it as a reason to keep re-auditing broad areas that already passed.

## Scope

- Only validate and fix the VSIX frontend in this repository.
- Do not modify the iCode backend for VSIX release polish.
- ACP protocol gaps that do not block normal coding-agent workflows are not release blockers.
- Prefer VS Code-native surfaces when they are clearly better than recreating the TUI literally.
- Treat [VSIX Design Decisions](./DESIGN_DECISIONS.md) as the source of truth for accepted VSIX/TUI differences.

## Required Automated Gates

Run from the repository root:

```bash
npm run lint
npm test
npm run build
npm run package
npm run package -- --target linux-x64 --binary /path/to/chrys
```

Lint covers both extension-host and webview TypeScript. Unit tests include webview startup, prompt preservation, sessions, activity updates, responsive navigation, and ACP transport shutdown.

The lint, unit test, build, universal package, and at least one platform package smoke must pass before a release candidate is handed to manual QA.

Universal VSIX packages must not include `extension/bin/` or `extension/runtime/`. Platform VSIX packages include a prepared target runtime under `extension/runtime/`, or a target-matching release-built binary under `extension/bin/` with notices. Their `extension.vsixmanifest` must set `TargetPlatform`.

### iCode CLI Compatibility Smoke

- Run `npm test -- src/__tests__/acp-client-v022.test.ts src/__tests__/session-v022.test.ts src/__tests__/acp-client-v016.test.ts src/__tests__/session-v016.test.ts src/__tests__/notifications-v016.test.ts src/__tests__/rollback-provenance.test.ts src/__tests__/release-manifest.test.ts`.
- If a local iCode CLI is available, run `npm run test:integration` and verify `_chrys/session_runtime` and `_settings/options` route successfully.
- For the model-backed release smoke, run `CHRYS_ASK_USER_CALLBACK_SMOKE=1 npm run test:integration` and confirm the real iCode process sends and accepts one two-question `_chrys/request_input` callback.
- Confirm chat chrome shows the connected backend version from `initialize.agentInfo.version`, not the VSIX package version.
- Confirm plan updates, session title updates, rollback provenance, usage-source identity, context pressure, compaction notifications, and batched AskUser prompts do not crash the webview when emitted by iCode `v0.22.5`.

## GitHub Release

The CD workflow is manual-only. Creating a GitHub release or tag must not automatically start CD, because release tags such as `v0.0.23-icode-v0.27.1` are VSIX tags, not iCode CLI runtime tags.

When using CD to publish platform VSIX packages, pass both:

- `vsix_release_tag`: the VSIX release tag to create.
- `icode_release_tag`: the iCode CLI release tag that already contains platform binaries.

CD downloads public offline release assets from `openJiuwen-ai/iCode` using the standard GitHub Actions token. No private backend release token is required.

## Manual Smoke Matrix

### Launching Extension Host On macOS

Prefer the VS Code app launch path when the `code` CLI is broken by local Electron signing or `libffmpeg.dylib` policy issues:

```bash
open -na "Visual Studio Code" --args --extensionDevelopmentPath=/path/to/icode-vscode-plugin /path/to/workspace
```

For this workspace:

```bash
open -na "Visual Studio Code" --args --extensionDevelopmentPath=/Users/yubo/openubmc/studio/icode-vscode-plugin /Users/yubo/openubmc/studio/chrys
```

### openUBMC Studio App Smoke

When testing inside openUBMC Studio, verify the extension is loaded from the intended app extension store:

```bash
ls -la ~/.bmc-studio/extensions
rg -n "chrys\\.icode-vscode-plugin" ~/.bmc-studio/extensions/extensions.json
```

For development smoke tests, `~/.bmc-studio/extensions/chrys.icode-vscode-plugin` may be a symlink to this repository root. If versioned copies such as `chrys.icode-vscode-plugin-0.0.16` also exist, treat `extensions.json` as the source of truth for which copy openUBMC Studio is loading.

### First Run And Setup

- Fresh VS Code window with iCode not on PATH shows a clear install/configure prompt.
- `chrys.binary.path` points to a user-installed iCode CLI and starts ACP successfully.
- In a universal VSIX, a missing or broken binary leads to Doctor, not a silent empty chat.
- In a full platform VSIX, the bundled runtime starts by default even when PATH or a managed runtime exists.
- Priority: explicit `chrys.binary.path`, bundled runtime, managed installation, then PATH (`icode`, `chrys`).
- Default agent, model profile, and approval mode apply to new VSIX sessions without passing unsupported ACP startup flags.

### Chat Layout And Connection Lifecycle

- The chat appears immediately with localized startup stages and elapsed time; sending stays disabled until ACP initialization finishes.
- Reloading the webview retains the initial state and messages, with no missing first message or invalid turn number.
- Close and reopen chat during a streaming response: prior messages, hidden-period updates, and completed tool cards remain visible; completion while closed does not throw or reset a replacement session.
- Reload the webview with a pending approval or AskUser request: its dialog is restored and can still be answered.
- Close chat while logs or profile/session refreshes are active: timers stop and late responses do not reopen dialogs in a replacement panel. Close management during refresh/save without disposed-webview errors.
- The dashboard can be opened and closed at wide and narrow widths; Escape dismisses the narrow drawer, and a 390px editor group has no horizontal overflow.
- Messages, Sessions, Context, Debug, and the local Companion tabs remain accessible in English and Chinese.
- Context inventories show available memory files, MCP tools/failures, skills, and sub-agent tools without replacing the parent session usage with sub-agent usage.
- Compaction updates modify one expandable activity card; failures retain diagnostic details, and rollback retains exclusions and warnings.
- Changing the configured binary or workspace reconnects using the current process/session manager; stopping the backend settles pending requests and questions.

### Multiple Session Tabs

- Start A, then create B while A streams: independent tab titles, messages, tools, usage, input drafts, and stop controls; switching focus must not redirect delayed events.
- Open the same saved session repeatedly during startup: one runtime and one tab. Close and reopen A while it streams without a second ACP load.
- Pending approvals and AskUser requests in A and B remain independent even with identical request/tool IDs. Closing A preserves its request; reopening restores and can answer it. Background requests notify without taking focus from B.
- Open A's Diff, switch to B, and open the same filename/tool ID: the documents retain their own session content.
- From B, try deleting running A; the target is protected. Recheck after confirmation if an idle target starts running meanwhile.
- Restart A through Doctor: B keeps running; A restores its own saved session. Closing a tab keeps its process; extension shutdown stops every process.
- Reload the IDE: restore the last active saved session; open other saved sessions from the tree.

### Session Names, Prompt History And Clear Display

- Set a local name through `/rename`, the editor toolbar and Sessions tree; every session list and the matching Tab updates. A backend automatic-title notification must not overwrite the local name. Reload and verify persistence; clear the name to restore the backend title. UI explains that TUI titles are unaffected.
- Rename two different sessions concurrently and verify neither change is lost; cancellation and failed storage writes leave the old displayed name intact.
- Send multiline text in A, search it with Ctrl+R or `/prompts` in B using the same directory, and select it: exact text fills B without sending. Cancel with an existing draft, switch focus during selection, or close the original Tab: no unrelated draft changes.
- Different working directories do not mix history. Reopen the editor and verify the latest 100 distinct prompts remain searchable. `/history` still shows Session JSON.
- `/clear` is labeled Clear Display / 清空显示 and explains retained context. It preserves backend session identity, usage and plan; `/new` creates a fresh context. Clearing a running task is rejected.

### TUI-Parity Muscle Memory

- Composer hints and typed triggers both work:
  - `#` opens agent selection.
  - `!` opens/runs the workspace terminal.
  - `/` opens slash command search.
  - `@` inserts a file mention.
- Composer-only shortcuts work with chat input focused: `Enter` sends, `Ctrl+J` inserts newline, and `Ctrl+B` interrupts a running turn.
- TUI F-key/footer shortcut buttons are intentionally absent; use slash commands, TreeView, Command Palette, and VS Code-native surfaces instead.
- Fullwidth Chinese triggers work: `／`, `＠`, `＃`, `！`.
- User messages preserve the TUI-like visual numbering without mutating message text.
- Theme `chrys` visually matches the TUI enough for the composer, status area, sidebar, and approval badge to feel familiar.

### Coding-Agent Core Flow

- Send a normal coding prompt and confirm streamed thinking, tool calls, final text, and token/context sidebar update.
- Tool cards expose readable summaries, View, Copy, and Diff where applicable.
- File-changing tool cards can open the edited file from the visible path.
- Read/search result paths open the target file and line.
- Shell mode opens a VS Code integrated terminal in the active workspace and logs `ShellOpened` or `ShellCommand`.
- Open a multi-root `.code-workspace`: startup uses the active editor's workspace folder (or the first root); clicking CWD or running `/cd` offers current folder names/full paths and browsing elsewhere. Select the second root and confirm CWD/session state updates; cancel without changing directory. Startup remains automatic when a workspace is available. With no session, switching restarts the backend in the chosen directory; with a session, it uses the existing ACP workspace update.
- Approval requests show localized labels, optional diff preview, reason capture, and double-submit protection.
- Ask-user requests support one-to-five-question batches, tabs/navigation, option descriptions, multi-select, option notes, unanswered questions, whole-batch cancel, and sequential Quick Pick/Input Box fallback.
- Hosted tool results render standard ACP text, image, embedded resource, and resource-link content; terminal updates replace prior structured content instead of appending duplicates, matching raw text is shown once, and hosted provider metadata remains available to diagnostics.
- Image paste/drop shows preparation/compression progress and blocks clearly when the active model profile lacks vision support.

### Sessions And TreeView

- Sessions tree is registered on activation.
- Current session appears in a distinct group.
- Saved sessions are grouped by recency.
- Right-click copy produces a parity-debug summary.
- Session JSON opens from Command Palette, TreeView menus, or slash commands and points at the expected saved session.
- Loading/deleting sessions is blocked with clear feedback while a turn is running.

### Settings And Management

- Extension settings are clearly separated from iCode user config in `~/.chrys/.env`.
- Model and agent management dialogs can create/edit/delete user profiles; restoring a built-in agent uses the dedicated ACP reset route and preserves backend errors in the dialog.
- Settings reload is blocked or deferred while a turn is running.
- `workspace.path` and binary auto-download/update settings are not exposed.

- Search models, agents and settings; a missing match has a clear empty state and searching does not reset form edits.
- An in-use model remains disabled after save/refresh; the stored API key is preserved when its masked field is left blank.
- Advanced connection fields remain saved when collapsed; an existing agent name stays read-only.
- Escape closes profile editors and restores focus; controls remain usable at 390px without horizontal overflow.

### Diagnostics And Long-Term Watch

- Doctor summarizes binary, workspace, ACP process, session manager, active session, model, approval mode, recent errors, and restart attempts.
- Support bundle redacts secrets and includes:
  - VSIX/TUI mismatch checklist.
  - session lifecycle events.
  - operation guard events.
  - input/shortcut parity events.
  - approval judge reviews.
  - tool renderer coverage.
  - recent frontend logs/events.
- Webview errors are relayed into frontend debug events.
- Common blocked actions leave a visible notice and a debug event.

### Differentiators

- `chrys.ui.language=zh-CN` localizes the chat shell, dialogs, notices, slash commands, management surfaces, Doctor, and diagnostics enough for daily use.
- Chinese slash aliases cover high-frequency actions such as sessions, models, agents, search, grep, diagnostics, support, doctor, shell, and help.
- VS Code-native extras work: `/search`, `/grep`, clickable file paths, editor diffs, integrated terminal, and copyable support bundle.

### Buddy UI

- Clicking the character sends exactly one pet command; keyboard activation works and reduced-motion users see the static thumbnail.
- The options menu exposes collection, cooldown-aware summon, mute and rename; Escape and outside clicks dismiss it.
- Runtime updates retain a partially edited name and keyboard focus; unrelated updates do not restart the sprite animation.
- Growth uses the shared XP thresholds, including the maximum level; loading, empty and muted states remain readable in English and Chinese.

## Not Release Blockers

- Companion animated WebP assets load, the Buddy tab keeps management in a compact options menu, `/companion collection` shows owned cards, pet/mute/rename/info/direct-address interactions work through local commands, the daily summon cooldown is honest, levels grow only from real iCode usage/time, and no backend Buddy hooks are used.
- ACP features that the protocol does not expose can stay VS Code-native if diagnostics explain the mismatch.
- Perfect pixel identity with every TUI theme is not required; `chrys` and `chrys-ansi` must be coherent and usable.

## Release Candidate Rule

A VSIX release candidate is acceptable when:

- All automated gates pass.
- Every item in the manual smoke matrix is either verified or explicitly accepted as non-blocking.
- Any remaining inconsistency has a Doctor/support-bundle path that helps reproduce it.

### Review regression checks

- Composer New clears the originating view without opening a tab or resetting backend context. Verify the tooltip and busy guard; `/new` and Sessions New still open independent sessions.

- Verify advanced agent JSON sections save model/tools/approval/sub-agent/skills/memory/compaction/ACP settings; unchanged masked secrets and unknown fields survive. Invalid JSON must not dispatch a partial save; clearing ACP must remove the external-agent configuration.
- Verify `$` and `＄` open model selection while idle without sending a prompt, and do not switch models during a running turn.
- Verify closed Mermaid flowchart, sequence and entity fences render automatically as themed terminal diagrams. Check CJK alignment, narrow horizontal scrolling, theme changes and source disclosure; incomplete, unsupported, RL and oversized diagrams retain source. Diagram labels and source must remain literal text.
- The packaged capability plan explicitly lists Workflow and Trajectory as pending backend contracts; do not advertise them as implemented.

- Restart ACP from Doctor and switch agents for a new session; both paths complete initialization before accepting prompts.
- Close pending approval and ask-user dialogs when restarting or disconnecting the backend.
- Before the first session, select model/agent defaults and save agent profiles without session-required requests. Existing workspace setting overrides must receive the selected default.
- Keep new connection errors/startup progress visible after an earlier ready indicator expires. Return Buddy to idle five seconds after petting, without requiring another host update.

- Welcome branding defaults to iCode; clicking its mark opens the iCode/iCode picker. Verify switching, cancelling, reopening, and changing `chrys.ui.brand` directly while the backend version remains visible.

## Third-party licenses and artwork

- Run `npm run test:packaging` to check missing notices, dependency changes, and all five target layouts.
- Build before packaging; dependency inventories must match `licenses/components.json`.
- Inspect the VSIX for `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `ASSET_PROVENANCE.md`, and the complete `licenses/` files.
- Updating a bundled dependency requires updating its exact version, license text and hash.
- Keep `@vscode/vsce` and its proprietary signing dependency out of this custom packer workflow.
- Platform packages must preserve the iCode dist-info LICENSE/NOTICE and dependency license files on every target. Raw binaries require adjacent upstream LICENSE/NOTICE, packaged under `runtime-licenses/`.
- Record provenance for new or replaced artwork in `ASSET_PROVENANCE.md` before release.

## Workflow CLI smoke

- `/workflow` and Command Palette discover builtin/global/project sources without importing user code.
- User source opens in the editor. Cancelling input or the explicit BYPASS/trust confirmation must never run the workflow. Changed source requires re-review.
- Verify empty/Chinese input, spaces in paths, default CLI agent, timeout, and a separate workflow session.
- Cancel from the progress notification/menu; process and descendants terminate. Repeated execution in the same workspace is guarded.
- Completion/failure/cancellation opens result JSON. Last 10 results up to 256 KiB each survive reopening; larger results stay in the editor for Save As.
- Unsupported CLI and Windows command wrappers fail clearly; no private Workflow ACP method, fake live DAG, or automatic approval bypass.

## Usage and Trajectory smoke

- Restore a session whose cumulative spend exceeds its context window: gauge must use current `totalTokens`, never `totalSessionTokens`. Child events update spend without replacing the main context.
- Zero stays `0`, absent data stays `—`; partial snapshots retain known fields. Latest readings and session cumulative totals have distinct labels.
- `/usage`, `/trajectory`, Context sidebar and Command Palette open current/historical session or JSONL analysis. Saved-session pagination works.
- Report retains exact/estimated/missing/unresolved metrics and backend timing. Malformed labels render as literal text; no script executes.
- JSON/CSV/findings CSV/Perfetto exports preserve default redaction. Cancel, unsupported CLI, absent logs, schema mismatch and oversize previews fail clearly and clean temporary files. Never overwrite source events.
- Report limits are visible and full export is available. Snapshot refresh is explicit, and missing model attribution is not fabricated.

- Compare Trajectory Overview/Timeline against upstream TUI screenshots: three-column cards, monospace type, thin frames, precision badges, turn tabs, shared rulers and coloured hierarchy. Test radio-tab keyboard navigation, overflow at narrow widths and literal labels under CSP. Skill/MCP and wall-slice gaps must remain explicit.

## TUI parity interactions

- Check Diff and Rollback file selection, period changes, unified/split previews, literal markup-like content, and native editor opening. Verify rollback previews exclude the retained turn, reverse the changes, preserve backend exclusions, and cancellation/changed session/busy state never sends a rollback.
- Verify `/rollback last N` and `/rollback to N` with multiple turns; `revert` still opens preview and confirmation.
- Check `/roots` with two directories, reload, new tab, saved session and explicit clear; confirm one tab cannot change another tab's scope.
- Attach/remove a file, editor selection and Problems; verify paths/line ranges and unchanged prompt text. No implicit editor context.
- Edit guided Agent fields and repeated MCP/sub-agent rows; round-trip unknown values and masked secrets; inspect both languages and section navigation.
- Refresh Trajectory without losing the selected tab; expand an operation and dependency graph. Closing during refresh cancels the export. Validate graph precision and absent-data wording.
- CI runtime compatibility pins public iCode v0.28.0 and validates its archive checksum; universal packaging never downloads the runtime.

Current verification: browser fixtures exercise the production renderers; these are synthetic rendering data, not production sessions. Native Studio smoke is still pending while the Mac is locked. Backend-only Trajectory/rollback-plan gaps are tracked in https://github.com/openJiuwen-ai/iCode/issues/4; do not mark those as full parity.


### Advanced Agent form follow-up

- [ ] Studio: add/edit/remove MCP headers/env; preserve `***` and empty strings; distinguish inherited vs empty allowed tools.
- [ ] Studio: edit inline Skill resources/scripts, external ACP typed options and web-provider templates; malformed input must block saving.
- [ ] Studio: check compact section tabs and nested rows at narrow width and in light/high-contrast themes.
- [ ] Do not mark session fork/shared titles, approval edits or interrupted recovery complete before upstream #5 has supported contracts and live integration coverage.

- [ ] Agent: edit A, switch to B, return/reopen/refresh and verify A's draft remains; successful save clears only A; externally changed A refuses stale save; Discard reloads it.
- [ ] Agent: Clone opens an unsaved draft with a new name/identity and an explicit missing-masked-credentials notice. Existing names cannot be overwritten from the new-profile form.
- [ ] Sessions: filter by full path/ID, navigate with arrows/Space/Enter, refresh and retain visible selection; filtered-out selection cannot be deleted or resumed.
- [ ] Approval/AskUser: duplicate pending snapshot retains typed input; a new or completed request resets it.

### Managed runtime installation

- Light VSIX discovers an existing CLI without downloading; missing-runtime setup and Sessions expose the explicit install command in both languages.
- Test successful download, SHA256 mismatch, missing checksum, cancellation, failed ACP/version validation, retry and simultaneous install clicks. Old runtime stays active until a new candidate passes validation.
- Verify isolated global storage and PyApp cache; user CLI, PATH and shared caches remain untouched. Installing during a session must not restart it.
- Test host-based target selection in SSH/WSL and a clear error for unsupported architectures. Validate Windows `tar` extraction and `.cmd` startup on Windows, not on macOS.
- CI tests the same source SHA and selected backend release as CD; every platform runs ACP initialization and session smoke before packaging. No model inference is needed for this smoke.
- `npm run package` rebuilds the frontend. Verify universal and platform archives retain the `icode-vscode-plugin` identity, including raw-binary packages with LICENSE/NOTICE.
