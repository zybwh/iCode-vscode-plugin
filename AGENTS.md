# AGENTS.md

Guidance for coding agents working in the standalone iCode VS Code / openUBMC Studio extension.

## Project

This directory is the editor frontend for iCode. It is a standalone VSIX that connects to iCode CLI through `icode acp` (with legacy `chrys acp` compatibility).

The universal VSIX must not download, bundle, rebuild, or patch iCode. Platform-specific VSIX packages may bundle a release-built PyApp iCode binary for their target platform, but the packer must only consume an already-built binary. Treat iCode CLI as the backend runtime and this package as the VS Code/openUBMC Studio UI surface.

`package.json` is the source of truth for VSIX metadata, scripts, contributed commands, views, settings, and package version. The iCode CLI/backend version comes from the connected `chrys acp` runtime, not from this VSIX package version.

## Commands

Run from the repository root unless noted:

```bash
npm run lint
npm test
npm test -- src/__tests__/release-manifest.test.ts
npm run test:integration
npm run build
npm run package
npm run deploy
```

Run from the repository root when working interactively:

```bash
npm run lint
npm test
npm run build
npm run package
npm run deploy
```

`npm run package` uses `uv run python scripts/pack.py` and writes an ignored `icode-vscode-plugin-<version>.vsix` file in this directory. Platform builds pass `--target <target> --binary <path>` and write ignored `icode-vscode-plugin-<version>-<target>.vsix` files.
`npm run deploy` packages the universal VSIX and installs it into the local macOS openUBMC Studio app for dogfooding.

## Key Documents

- `README.md`: marketplace/plugin-page product description. Explain both the full iCode product and what the VSIX frontend adds.
- `DESIGN_DECISIONS.md`: accepted VSIX/TUI differences. Update this before reopening settled parity questions.
- `RELEASE_CHECKLIST.md`: release gates and manual smoke matrix.
- `AGENTS.md`: this file. Keep it aligned with the current release boundaries.
- `package.json`: extension manifest, version, commands, menus, settings, scripts, and contribution declarations.
- `package.nls.json` / `package.nls.zh-cn.json`: localized package strings.
- `scripts/pack.py`: custom VSIX packer and packaged-document allowlist.
- `src/__tests__/release-manifest.test.ts`: guardrail test for release policy, docs, manifest, unsupported ACP extensions, and packaging expectations.

## Architecture

- `src/extension.ts`: VS Code activation, ACP process startup, command registration, notification wiring, and session initialization.
- `src/acp/`: JSON-RPC/ACP client and TypeScript protocol types. Keep this compatible with the installed iCode CLI, not private local backend patches.
- `src/session/`: frontend session manager and state transitions.
- `src/handlers/`: command and notification handlers.
- `src/chat/`: chat panel, webview state, renderer, composer, tool cards, dialogs, and styles.
- `src/ui/`: QuickPick/dialog/report surfaces for logs, Doctor, runtime details, settings, profiles, diffs, rollback, and support bundles.
- `src/views/`: VS Code TreeView surfaces, especially saved sessions.
- `src/common/`: shared runtime state formatting, localization, theme resolution, prompt paste/image helpers, logging, and package/protocol constants.
- `tests/integration/`: integration tests that exercise the local iCode binary/ACP startup.

## Hard Boundaries

- Do not patch the iCode backend for VSIX polish. Backend/ACP gaps should be filed or documented, not vendored into this repository.
- Do not add VSIX scripts that build, download, or auto-update the iCode CLI. Platform packaging may bundle an explicit release-built `chrys` / `chrys.exe` binary passed to `scripts/pack.py`.
- Do not add explicit `activationEvents` for contributed commands or views. VS Code/openUBMC Studio generate them from `contributes`.
- Do not expose the VSIX package version in product UI, diagnostics, support bundles, or chat chrome. UI should show the connected backend as `iCode CLI vX.Y.Z` from ACP `initialize.agentInfo.version`.
- Keep VSIX package version independent from iCode CLI. For this release line it starts at `0.0.1` and increments with VSIX branch commits.
- Do not rely on unsupported private ACP hooks such as `_buddy/*`, `_chrys/buddy`, or `_chrys/session_history_status`.
- Do not implement approval argument editing or restored interrupted-session replay in the VSIX until iCode ACP exposes a supported contract. Track those gaps in issue #394.
- Companion is a VSIX-owned local workflow pet. It must not call backend Buddy methods or private Buddy ACP hooks.
- Keep `*.vsix` ignored. Build artifacts can exist locally but should not be committed unless the release process explicitly changes.

## ACP Rules

The VSIX may use standard ACP methods and iCode ACP extensions that are implemented by the installed iCode CLI. Before adding a client request or notification handler, verify the backend contract exists in `src/chrys/app/acp/server.py` on `origin/main` or in documented iCode ACP docs.

Current supported extension families include runtime snapshots, session delete/history/inject/mutations/diff/rollback/skip sleep, sub-agent retry/abort notifications, settings/options, profile/model management, workspace updates, MCP test/list, skills list, ask-user, approvals, and load/session notifications.

For top-level JSON-RPC calls from this VSIX, keep using the underscore-prefixed extension routes accepted by the ACP router (`_chrys/*`, `_session/*`, `_settings/*`, `_profiles/*`, `_mcp/*`, `_skills/*`, `_sub_agent/*`). Backend documentation may describe the logical `ext_method` names without the underscore prefix; verify with a live stdio smoke test before changing client route strings.

When a capability is missing from ACP:

1. Prefer a VS Code-native alternative if it does not change what iCode receives.
2. Document the accepted difference in `DESIGN_DECISIONS.md` when user behavior changes.
3. Add or update a GitHub issue when a backend contract is required for parity.
4. Add a release-manifest guard if the missing hook is tempting to reintroduce.

## UI And Product Rules

- Build the actual editor workflow, not a landing page.
- Prefer VS Code-native surfaces where they are clearer than cloning TUI panels: TreeView, Command Palette, QuickPick, webview dialogs, integrated terminal, and document editors.
- Keep TUI-style composer triggers: `/`, `@`, `#`, `!`, plus fullwidth Chinese equivalents.
- Do not render TUI F-key/footer shortcut buttons. Route those capabilities through slash commands, TreeView actions, context menus, or Command Palette.
- Preserve prompt text. Visual turn numbering must not mutate the text sent to iCode.
- Wrap system/profile/model/tool/user-authored strings rendered through rich/textual-like paths as literal text where applicable; malformed markup-like text must not crash UI rendering.
- Keep English and Simplified Chinese user-facing copy aligned when changing package strings or visible UI copy.
- Keep Doctor/support output focused on VSIX/TUI mismatch, ACP startup, binary path, workspace, session state, operation guards, and redacted logs.

## Manifest And Packaging Rules

- `package.json` contributions drive commands, menus, views, settings, and generated activation events.
- NLS placeholders in `package.json` must exist in both `package.nls.json` and `package.nls.zh-cn.json`.
- `README.md`, `RELEASE_CHECKLIST.md`, and `DESIGN_DECISIONS.md` are packaged by `scripts/pack.py`; keep the packer and release-manifest tests in sync.
- The package script should stay cross-platform: use `uv run python scripts/pack.py`, not `python3`.
- The universal VSIX should not include backend binaries, vendored iCode runtime, old implementation notes, or private release scratch docs. Platform VSIXs may include only the target-matching release-built `extension/bin/chrys` or `extension/bin/chrys.exe`.

## Testing Guidance

For doc or manifest-only changes, run:

```bash
npm run lint
npm test -- src/__tests__/release-manifest.test.ts
npm run package
```

For UI, ACP client, command, session, or rendering changes, run:

```bash
npm run lint
npm test
npm run build
npm run package
```

For changes that touch backend compatibility assumptions or restore reverted ACP behavior, run `npm run test:integration` with a target iCode binary available, and test against the target iCode CLI/backend repository separately:

```bash
# In the iCode backend repository:
uv run pytest tests/cli/test_app.py tests/acp
```

## Common Footguns

- Adding a VSIX feature by patching `src/chrys/app/acp/server.py` makes the standalone extension incompatible with users' installed iCode CLI.
- Reading version from `PACKAGE_VERSION` in UI shows the VSIX package version, not iCode. Use `rt.chrysCliVersion` for product runtime display.
- Adding package metadata fields may trigger openUBMC Studio lints even when VS Code accepts them. Keep manifest tests close to openUBMC Studio feedback.
- Reintroducing backend Buddy or restored interrupted-session ACP hooks as private methods will pass TypeScript but fail against unpatched iCode.
- Updating README/design/checklist without updating `release-manifest.test.ts` lets release policy drift.

## iCode naming compatibility

Upstream is `https://github.com/openJiuwen-ai/iCode`. Product copy uses iCode; the extension package is `icode-vscode-plugin`. Keep existing `chrys.*` command/configuration/storage identifiers and `_chrys/*` protocol routes compatible. Upstream still uses the `chrys` Python package and PyApp cache identifiers. PATH lookup prefers `icode`, then `chrys`. CD consumes public `icode-*-offline` release assets; do not require a private backend release token.
