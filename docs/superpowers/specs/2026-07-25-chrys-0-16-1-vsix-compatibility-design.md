# Chrys 0.16.1 VSIX Compatibility Design

## Goal

Release Chrys VSIX `0.0.8` against the published Chrys CLI `v0.16.1` contract.
The update must repair platform runtime startup, preserve complete agent
profiles during editor saves, stop stale user shadows of built-in agents, and
handle the usage and compaction events published by `v0.16.1`.

Changes present only after the `v0.16.1` tag, including external ACP
sub-agents, are explicitly out of scope.

## Considered approaches

### 1. Minimal compatibility patch — selected

Keep the current editor workflow and ACP surface, but repair the broken
boundaries and add focused event handling. Existing agent fields that the form
does not expose remain intact through read/merge/write.

This minimizes release risk and keeps the work tied to the published backend.

### 2. Full agent configuration UI

Expose every agent, MCP, model, memory, compaction, and sub-agent field as a
dedicated form. This would improve discoverability, but it is substantially
larger than a compatibility release and would need independent product design.

### 3. Raw YAML/JSON profile editor

Open complete profiles in an expert editor. This naturally preserves fields,
but exposes masked secrets and backend serialization details and makes simple
profile edits less safe. It is not needed to fix the current destructive save.

## Design

### Platform runtime launcher

Both generated launchers and their validation command use the published module
path `chrys.app.cli.app`. The release guard must reject the obsolete
`chrys.cli.app` path.

The platform package smoke must exercise the generated launcher, not only the
embedded Python interpreter.

### Lossless agent profile editing

The webview keeps the complete profile returned by `read_agent_profile`.
Editing an existing agent clones that object, overlays only the four fields
owned by the current form (`name`, `display_name`, `description`,
`instructions`), and sends the merged object to `write_agent_profile`.

The original stable `id`, `name`, and every unexposed or unknown nested field
are preserved. Existing profile names are read-only because the `v0.16.1` ACP
write method has no atomic rename contract and resolves masked MCP secrets by
the submitted name. New profiles continue to submit the form-owned fields and
let the backend apply defaults and allocate an id.

### Built-in agent ownership

The VSIX stops materializing a backend built-in profile into the user profile
directory during activation. A missing user YAML means “use the backend
built-in,” allowing later Chrys releases to update that profile.

Existing user profiles are not deleted or rewritten automatically. They may be
intentional customizations, so cleanup remains an explicit user action. The
Agent dialog offers **Restore Built-in** for the five `v0.16.1` built-ins; it
calls the backend delete contract to remove only a user override and then
reloads the backend built-in profile.

### Usage identity

`UsageUpdateNotification` gains the published `agentProfile` and
`usageSourceId` fields. The main context gauge accepts an update only when its
source is absent (backward compatibility) or equals the current session id.

Sub-agent usage updates do not overwrite the main gauge. They may update the
matching sub-agent card when an invocation is already known; no new persistent
usage subsystem is introduced.

`SubAgentProgressNotification` also gains `totalUsageTokens`, and the sub-agent
summary distinguishes current context tokens from cumulative usage.

### Compaction lifecycle

The ACP client routes these `v0.16.1` notifications:

- `chrys/context_pressure`
- `chrys/sub_agent_compaction_committed`

Finished compaction payloads gain `formatViolation` and `failureReason`.
Failures are shown as visible error/warning messages, with `failureReason`
preferred over duration. Context pressure is shown as a bounded warning and
debug event.

A sub-agent compaction is considered durable only after its committed event.
The existing active-compaction lifecycle still clears on `finished`; committed
is tracked separately for card/debug presentation.

### Release metadata and documentation

The VSIX package version becomes `0.0.8` in every package-owned version source.
Compatibility test names and release documentation move from Chrys `0.13.1`
to `v0.16.1`. VSIX release tags remain separate from Chrys runtime tags.

## Error handling

- Unknown notification fields remain tolerated.
- Notifications for another session are ignored.
- Missing `usageSourceId` retains compatibility with older runtimes.
- Missing profile objects prevent destructive overwrite and surface the
  existing save error path.
- Existing user-shadow profiles are left untouched rather than guessed to be
  stale.

## Test strategy

Each behavior is introduced test-first:

1. Launcher tests fail on the obsolete module path.
2. Agent-dialog tests prove nested fields and stable ids survive edits.
3. Bootstrap tests prove activation does not write built-in profiles.
4. Usage tests prove sub-agent sources cannot replace the main gauge.
5. Compaction tests prove new events are routed and failure details surfaced.
6. Version and release-manifest tests target `0.0.8` / Chrys `v0.16.1`.

Final gates:

```bash
npm run lint
npm test
npm run build
npm run package
CHRYS_BINARY_PATH=../chrys/.venv/bin/chrys npm run test:integration
```

Platform release validation must additionally prepare and execute target
launchers for the supported platform matrix.
