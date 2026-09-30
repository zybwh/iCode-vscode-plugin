# ACP integration tests

Both suites use the extension's production `ProcessManager` and `ChrysAcpClient`.
Every test owns a temporary workspace and backend configuration home, stops all
children, restores its environment and removes its files. Tests are serial within
a worker because process startup snapshots that worker's environment. Failures
print the production manager's bounded recent stdout/stderr diagnostics.

## Official runtime compatibility

```sh
ICODE_BINARY_PATH=/absolute/path/to/icode ICODE_EXPECTED_VERSION=0.28.0 npm run test:integration
```

Use an already-installed official release. CI downloads and checksum-verifies the
pinned public release separately. Tests do not download, build or patch a backend.
The suite verifies inventories and routes, a real streamed mock turn and saved
transcript replay, independent processes, and persisted additional directories.
Each case can run independently with Vitest `-t`; no prior sessions are required.
All prompt cases explicitly select the built-in `mock` provider, with no API key or
model service required. The mock has no scripted responses configured through ACP;
these tests do not claim to exercise model-generated tools or approvals.

`npm run test:runtime` selects only the packaged-runtime startup smoke used by CD.

## Upstream fault scenarios

Obtain the source revision in `tests/support/icode-upstream.json` and create a
fixture-only Python environment (the current iCode source targets Python 3.14):

```sh
uv venv --python 3.14 /absolute/path/to/acp-fixture-venv
uv pip install --python /absolute/path/to/acp-fixture-venv/bin/python agent-client-protocol==0.10.1
ICODE_SOURCE_PATH=/absolute/path/to/iCode ICODE_TEST_PYTHON=/absolute/path/to/acp-fixture-venv/bin/python npm run test:acp-stub
```

On Windows use the environment's `Scripts/python.exe`. The suite starts iCode's
original `tests/support/acp_stub_agent.py` directly, choosing existing scenarios via
`CHRYS_ACP_STUB_SCENARIO`. Only the ACP SDK is needed; iCode is not installed or
rebuilt. CI checks out the pinned source separately from the VSIX checkout.
Missing setup fails with instructions rather than silently skipping coverage.
The fixture's SHA-256 and installed SDK version must match the pin before any case
runs. Updating the pin means reviewing upstream scenario semantics, updating the
hash and SDK version together, and rerunning both suites.

Coverage includes permission and AskUser round trips (including cancellation,
rejection, missing handlers and handler failures), session closure while a dialog
is pending, cancelling a stalled stream, truncated handshake and mid-prompt crashes,
a bounded wedged handshake with stdout diagnostics, structured errors with usage,
and heavy stderr without protocol starvation. Response/error immediately followed
by EOF must retain the original outcome. Foreign-session notifications, reordered
tool events and explicit message boundaries go through the production session
handler and are asserted against its host-owned transcript. This proves client behavior against controlled upstream fixtures;
it does not replace compatibility testing against the official binary.

The upstream fixture is an internal test asset, not a supported backend API.
It stays outside the shipped VSIX. No private ACP hooks or runtime patches are
introduced. Unit tests (`npm test`) remain independent of both external fixtures.

## Tool-card presentation regression tests

`src/__tests__/tool-replay-semantic.test.ts` mounts the real webview app and compares
semantic content from live ACP handler updates, serialized transcript rehydration,
and equivalent history replay events. Cases cover a shell streaming tail, a failed
result, file diff inputs, and hosted images/resource links. Collapse/expand must
preserve content, and removing the payload must change the comparison. These are
synthetic frontend fixtures, not proof of backend tool execution or browser layout.
`backend-restart.test.ts` also verifies pending approval and AskUser settlement
before handler replacement. Both files run with `npm test`.

## TUI-derived interaction and layout regressions

These cases adapt behavior from iCode revision
`bb45692104bc1d26882729e90fc145e3a114e066`, under `tests/app/tui/`:

| Upstream reference | VSIX regression |
| --- | --- |
| `widgets/test_input_bar.py` | Delayed restoration cannot overwrite a new draft, including whitespace; preserve caret and IME submission behavior. |
| `widgets/test_tool_group_coalescing.py` | Late/out-of-order results stay in their owning group; user turns keep live/replay groups separate. |
| `behaviors/test_main_screen_copy.py` | Copy original markup, whitespace and image-message text; selected text wins. VSIX retains its existing role prefix. |
| `widgets/chat/test_streamed_answer_burst.py` | A burst parses once per animation frame while copy reads the latest source; final patches and transcript replacement defeat stale work. |
| `widgets/chat/test_running_card_ticks.py` | Timer ticks retain card nodes, folded output stays current, and transcript clearing retires timers. |
| `widgets/test_chat_panel_scroll.py` | User scrolling and sidebar navigation win over pending auto-follow callbacks; returning to the bottom resumes following. |

`src/__tests__/webview-tui-regressions.test.ts` runs in the normal `npm test`
suite with the actual webview app, synthetic host messages, clipboard assertions,
and controlled animation frames. Host lifecycle tests cover restored draft storage.
They do not rely on Python, the upstream checkout, or a model.

For real layout, install the pinned test browser once, then run:

```sh
uv run tests/webview/browser.py --install
npm run test:webview
```

On Linux CI, installation also uses `--with-deps`. The Python script declares its
own Playwright version and Python range. This command builds the production
webview JS/CSS, then uses headless Chromium with only `acquireVsCodeApi` mocked.
Each case owns an isolated browser context. It verifies scrolling during streaming
and composer resizing, sidebar navigation against queued bottom corrections,
real caret/focus, and English/Chinese narrow-screen composer/drawer behavior.
Waits use observable state and browser animation frames rather than fixed sleeps.
CI runs this as a separate browser job. Missing browser setup fails explicitly.

This is browser rendering coverage, not a VS Code extension-host or backend E2E
suite. Textual internals, terminal cell geometry, and TUI-specific presentation
policies are not ported. Link edge cases, expanded pseudo-locales, configuration
validation matrices and incremental history loading remain separate follow-ups.
