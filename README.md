# iCode for VS Code

[English](#english) | [简体中文](#中文说明)

[Plugin repository / 插件仓库](https://github.com/zybwh/iCode-vscode-plugin) · [iCode CLI / 上游运行时](https://github.com/openJiuwen-ai/iCode) · [Issues / 问题反馈](https://github.com/zybwh/iCode-vscode-plugin/issues)

## English

iCode is an extensible coding-agent platform built around the iCode CLI, profile-driven agents, tool execution, approval gating, context management, saved sessions, rollback, MCP tools, skills, and sub-agents. The VS Code extension is the editor-native frontend for the iCode coding agent: it connects to your local iCode CLI over ACP and brings the daily coding workflow into VS Code.

The extension does not replace the iCode CLI or TUI. It keeps iCode as the backend runtime and uses VS Code for the surfaces that are better in an editor: chat, workspace files, integrated terminal, diffs, session tree, model/agent management, diagnostics, and support snapshots.

## What You Get

- Responsive chat with a collapsible dashboard for Messages, Sessions, Context, Debug, and the local Companion.
- Visible backend startup stages, connection timing, and agent loading progress.
- Agent chat in a VS Code webview, backed by `icode acp` (with legacy `chrys acp` compatibility) from your configured, PATH, or bundled iCode runtime.
- Streaming assistant text, thinking, tool progress, approval requests, ask-user prompts, token/context status, and sub-agent activity.
- Workspace-aware file references, pasted/dropped image preparation, quick grep/search, and integrated terminal launch.
- Tool cards with readable summaries, open/copy/diff actions, rollback, and mutation inspection.
- Independent session tabs: create or open another session while a task runs. Reopening the same session focuses its existing tab; titles show running, waiting for approval/answers, and completion. Closing a tab keeps its task and pending questions; reopening restores its transcript and text draft.
- Set a local session name with `/rename`, the chat editor toolbar, or the Sessions tree context menu. Names persist in this VS Code workspace and do not modify the TUI/backend title; leave the name blank to restore the automatic title.
- Search sent text prompts with `Ctrl+R`, `/prompts`, or **iCode: Search Prompt History**. The latest 100 distinct prompts are retained in this workspace and filtered to the current directory. Selecting only fills the composer; it never sends automatically. `/history` still opens Session JSON.
- `/clear` means **Clear Display**: conversation context, saved history, usage and plan state remain. Use `/new` for a fresh context.
- The input area's **New** button runs Clear Display in the current webview, without opening a tab. Its tooltip explains that context is retained; it is disabled during a running task. `/new` and the Sessions New action still create independent sessions.
- Saved session loading, deletion, session JSON access, and session summaries from the iCode Sessions TreeView.
- Searchable agent and model profile editors, with separate in-use indicators, collapsible advanced options, and keyboard navigation.
- Searchable iCode settings and MCP connection testing in the management page.
- Doctor, logs, runtime details, diagnostics, and redacted support bundles for troubleshooting VSIX/TUI mismatch.

## Installation

Requires VS Code 1.95 or newer, or a compatible openUBMC Studio build.

1. Choose the light VSIX with optional one-click runtime installation, or the full platform VSIX. You may also install the CLI following the [upstream iCode instructions](https://github.com/openJiuwen-ai/iCode#how-to-run), or obtain a matching binary from [iCode releases](https://github.com/openJiuwen-ai/iCode/releases).
2. Build the plugin with the development commands below, or use a VSIX if available on [plugin releases](https://github.com/zybwh/iCode-vscode-plugin/releases). In VS Code, run **Extensions: Install from VSIX...**.
3. Open a workspace. If the CLI is not on PATH, set `chrys.binary.path` to its absolute executable path. Configure a model profile in iCode, then run **iCode: Open iCode**.

Disable the old Chrys extension before enabling this extension. The new extension ID does not automatically migrate extension-scoped saved state.

## How It Connects

Choose one of two packages:

- **Light (universal) VSIX:** frontend only. It detects an existing iCode installation. If none is available, choose **Download and install iCode** in the setup prompt, Sessions view, or Command Palette.
- **Full (platform) VSIX:** includes the matching prepared runtime and uses it by default. No separate CLI installation is required.

Runtime priority is **explicit `chrys.binary.path` → bundled runtime → managed installation → PATH (`icode`, then `chrys`)**. Prepared packages use `extension/runtime/`; legacy raw-binary packages use `extension/bin/chrys` or `extension/bin/chrys.exe`.

Downloads require an explicit user action. The installer uses the official pinned iCode v0.28.0 offline release, verifies SHA256, and checks the version and ACP startup before activation. It supports macOS/Linux x64 and arm64, and Windows x64; selection follows the extension host, including Remote SSH/WSL. Installation goes into extension global storage with an isolated PyApp cache. It does not change PATH, replace your CLI, or automatically update iCode. Downloads need access to GitHub release assets; extraction requires the host's `tar` command (included in supported modern Windows). Failed or cancelled installs retain the previous managed runtime. Installation never interrupts an existing session; the next connection uses the selection order above.

The chat header shows the connected backend as `iCode CLI vX.Y.Z`. The VSIX package version is independent and is only part of the extension package metadata shown by VS Code or openUBMC Studio.

Configure model profiles with iCode itself, then use `iCode: Open Model Management` or `/model` to select the profile for new VSIX sessions.

## Main Workflows

- Open the chat with `iCode: Open iCode`.
- Send prompts directly, or use composer triggers:
  - `/` for searchable commands
  - `@` for file references
  - `#` for agent switching
  - `!` for VS Code integrated terminal mode
- Use `/sessions`, `/model`, `/approval`, `/logs`, `/diagnostics`, `/doctor`, `/history`, `/diff`, and `/theme` for common actions.
- Use `/help <command>` or `/帮助 <command>` for command-specific examples such as `/help grep`, `/help search`, and `/help copy`.
- Use the chat Sessions tab to refresh, resume, create, or delete saved sessions without leaving the conversation.
- Open Context for memory files, MCP tools and failures, skills, sub-agent tools, and compaction status; the dashboard becomes a drawer in narrow editor groups.
- Use the iCode Sessions TreeView for loading sessions, opening `session.json`, copying session ids, and copying support-friendly summaries.

## Settings

- `chrys.binary.path`: Optional absolute path to a local `icode` (or legacy `chrys`) binary. This overrides bundled, managed, and PATH runtimes.
- `chrys.agent.default`: Default agent for new VSIX sessions.
- `chrys.model.profile`: Default model profile applied to new VSIX sessions after ACP starts. Empty leaves iCode model resolution unchanged.
- `chrys.approval.mode`: Initial approval mode: `manual`, `auto`, or `bypass`.
- `chrys.ui.language`: Extension display language: `auto`, `en`, or `zh-CN`.
- `chrys.ui.theme`: Extension theme: `auto` or any supported TUI theme such as `chrys`, `chrys-ansi`, `dracula`, `monokai`, `nord`, or `tokyo-night`. Auto follows `CHRYS_THEME` only when it maps to a supported VSIX theme.

## VSIX and TUI parity

This extension intentionally uses VS Code surfaces where they fit the IDE better than recreating every TUI panel:

- Terminal mode opens the VS Code integrated terminal instead of embedding a TUI PTY panel.
- Session JSON, session IDs, and support summaries are available from the Sessions tree context menu.
- Logs and Doctor actions focus on debugging VSIX/TUI mismatch issues, ACP startup, model selection, image handling, and operation guards.
- `/search` opens VS Code Search; `/grep` provides a quick line picker for simple workspace matches, plus copy/insert actions so matches can become the next agent prompt.
- Image paste/drop shows preparation and compression progress in the composer. Image input still depends on the active iCode model profile advertising vision support.
- Companion is a VSIX-owned workflow pet: a quiet local animated WebP Buddy tab with an unframed pixel character, click-to-pet interaction, XP progress, and a compact options menu, daily 09:00 summon and collection state behind `/companion summon` and `/companion collection`, real iCode-usage growth levels, pet/mute/rename/info interactions, and direct-address short responses without backend Buddy APIs.

Accepted VSIX/TUI differences are tracked in [VSIX Design Decisions](./DESIGN_DECISIONS.md). Use that table before reopening parity questions.

For release gating, use [VSIX Release Checklist](./RELEASE_CHECKLIST.md). It is the source of truth for remaining manual parity, UX, coding-agent, diagnostics, and localization smoke checks.

`npm run lint` type-checks both the extension host and browser webview. `npm test` runs the unit, webview interaction, and manifest tests under `src/__tests__`. The integration smoke test is available as `npm run test:integration` and requires a local iCode binary compatible with the test path.

`npm run deploy` packages the universal VSIX and installs it into the local macOS openUBMC Studio app for dogfooding. It does not publish a marketplace or GitHub release.

Release builds are manual. The CD workflow publishes a VSIX tag such as `v0.0.28-icode-v0.27.1` from a selected ref and downloads offline runtime binaries from the public [iCode releases](https://github.com/openJiuwen-ai/iCode/releases). It uses the standard GitHub Actions token; no private backend repository token is required.

## Current Status

### Product capability gaps / 产品能力缺口

**Workflow is available through `/workflow` or iCode: Workflows.** Select a discovered workflow, review user Python source, enter input and timeout, then explicitly confirm execution. This uses the installed CLI's headless command with its default agent and **BYPASS tool approvals**, in a separate session. Cancel from the progress notification or Workflow menu. Results open as JSON; the last 10 results up to 256 KiB each are kept locally in workspace state. Larger results can be saved from the editor. Requires a CLI that supports `workflow list/run --json`; Windows requires a native executable. Live node graphs, interactive approvals and saved-run recovery remain pending. Historical Usage & Trajectory is available through `/usage`, `/trajectory`, the Context sidebar, and the Command Palette. See the [capability plan](./FEATURE_PARITY.md).

**通过 `/workflow` 或命令面板「iCode: 工作流」使用 Workflow。** 选择工作流、检查用户 Python 源码、填写输入和超时，再明确确认运行。此入口使用 CLI 默认智能体，**绕过逐项工具审批**，创建独立于聊天的会话。可在进度通知或工作流菜单中取消。结果以 JSON 打开，本地工作区保留最近 10 次、每次不超过 256 KiB 的结果，大型结果可在编辑器另存。需要支持 `workflow list/run --json` 的 CLI，Windows 需要原生可执行文件。实时节点图、交互审批和运行恢复仍待补齐。历史用量和执行轨迹已接入 `/usage`、`/trajectory`、上下文侧栏及命令面板。

Agent editing now includes collapsible JSON sections for model binding, tools/MCP/web, approvals, sub-agents, skills, memory, compaction and external ACP agents. Existing identity, unknown fields and masked secrets are retained. These are advanced configuration editors; guided forms remain follow-up work. `$` and `＄` open model selection. Closed Mermaid code blocks render automatically as compact terminal-style diagrams in the chat theme, with collapsible source. Flowchart, state, sequence, class, ER and XY diagrams are supported; unsupported syntax (including right-to-left flowcharts), incomplete or oversized blocks retain readable source.

智能体编辑器新增可折叠的高级 JSON 分区，覆盖模型绑定、工具/MCP/网络、审批、子智能体、技能、记忆、压缩和外部 ACP 智能体；保留已有身份、未知字段和脱敏密钥。引导式表单仍待补齐。输入 `$` 或 `＄` 可选择模型；Mermaid 代码块闭合后自动显示为随聊天主题配色的紧凑字符图，源码折叠保留。支持流程、状态、时序、类、实体关系和 XY 图；暂不支持的语法（包括从右向左的流程图）、未完成或过大的图保留源码。

The complete [iCode user guide](https://github.com/openJiuwen-ai/iCode/blob/main/docs/en/start/what-is-icode.md) and [中文用户指南](https://github.com/openJiuwen-ai/iCode/blob/main/docs/zh-Hans/start/what-is-icode.md) cover workflow authoring and configuration beyond the extension's command help.

This VSIX is a standalone frontend release. The universal package does not include iCode. Platform packages may include release-built PyApp binaries for the matching OS/architecture, but they must not depend on private ACP patches. Backend protocol gaps that do not block normal coding-agent workflows are tracked separately and are not release blockers by default.

Known deferred areas:

- Cross-client session-title changes, approval argument editing and restored interrupted-session replay need supported ACP contracts before the VSIX can implement them safely.
- Companion is local to the VSIX. It uses safe local card/pack data, grows from real iCode usage/time, keeps the Buddy tab compact, supports collection/summon/pet/mute/rename/info/direct-address responses through local commands, and never calls private backend Buddy APIs or depends on iCode hook configuration.
- Some TUI-only screens intentionally map to VS Code TreeView, Command Palette, QuickPick, webview dialogs, or integrated terminal surfaces instead of direct visual clones.

## 中文说明

### 安装

需要 VS Code 1.95 或更新版本，或兼容的 openUBMC Studio。

1. 选择轻量版并按需一键安装运行时，或直接使用完整平台版。也可按照 [iCode 上游说明](https://github.com/openJiuwen-ai/iCode#how-to-run)安装 CLI，或从 [iCode Releases](https://github.com/openJiuwen-ai/iCode/releases) 获取对应平台的运行时。
2. 使用下方开发命令构建插件，或在[插件 Releases](https://github.com/zybwh/iCode-vscode-plugin/releases) 有可用版本时下载 VSIX。在 VS Code 中运行 **Extensions: Install from VSIX...** 安装。
3. 打开工作区。如果 CLI 不在 PATH 中，将 `chrys.binary.path` 设置为可执行文件的绝对路径。在 iCode 中配置模型后，运行 **iCode: 打开 iCode**。

启用本扩展前请禁用旧 Chrys 扩展；新扩展 ID 不会自动迁移旧扩展的专属状态。

### 功能与连接方式

iCode 是一个完整的 coding-agent 平台，由 iCode CLI 承载运行时，支持配置驱动的智能体、工具调用、审批门控、上下文管理、会话持久化、回滚、MCP、技能和子智能体。iCode VS Code 扩展是这个平台的编辑器前端，通过 ACP 连接用户配置、PATH 或平台 VSIX 内置的 iCode CLI，把聊天、工具进度、审批、差异查看、回滚、会话、模型/智能体管理和工作区文件操作带进 VS Code。

插件分为两种：**轻量通用版**只带前端，自动查找已有 iCode，缺失时可在提示框、会话视图或命令面板点击“下载并安装 iCode”；**完整平台版**带有对应平台的预备运行时，默认直接使用。

运行时优先级为：**显式 `chrys.binary.path` → 内置运行时 → 插件托管安装 → PATH（先 `icode`，后 `chrys`）**。完整包使用 `extension/runtime/`，兼容旧包的 `extension/bin/chrys` 或 `chrys.exe`。

下载必须由用户主动触发，固定使用官方 iCode v0.28.0 离线版本，校验 SHA256 并验证版本及 ACP 启动后才启用。支持 macOS/Linux 的 x64、arm64，以及 Windows x64；按扩展宿主选择平台，包括 Remote SSH/WSL。安装位置为扩展全局存储，使用独立 PyApp 缓存，不修改 PATH、不覆盖用户 CLI、不自动更新。下载需要能访问 GitHub Release 资源；解压使用宿主的 `tar` 命令（现代 Windows 自带）。失败或取消保留原托管运行时；安装不会中断当前会话，下次连接按上述优先级选择。

界面中显示的运行时版本来自后端，会写成 `iCode CLI vX.Y.Z`。VSIX 自己的包版本是独立的，只作为 VS Code 或 openUBMC Studio 插件页里的扩展元数据。

中文体验：

- 模型和智能体编辑器支持搜索，区分正在编辑的配置与当前使用的配置；高级连接参数默认收起。设置页支持按名称和环境变量搜索。

- 聊天采用可折叠侧栏：消息、会话、上下文、调试和本地伙伴；窄编辑器中侧栏自动切换为抽屉。
- 启动时显示工作区解析、后端启动和 ACP 初始化进度；会话页支持刷新、恢复、新建、删除，上下文页集中显示记忆文件、MCP 工具与失败、技能、子智能体工具和压缩状态。
- 压缩与回滚以可展开的活动卡片呈现，子智能体工具卡汇总内部调用和用量。
- `chrys.ui.language` 设为 `zh-CN` 可强制使用中文界面；设为 `auto` 会跟随 VS Code 显示语言。
- `/rename`、聊天编辑器工具栏和会话树右键菜单可设置会话本地名称，保存在当前 VS Code 工作区，不修改 TUI／后端标题；留空恢复自动标题。
- `Ctrl+R`、`/prompts` 或“iCode: 搜索历史输入”可检索当前目录的历史提示词。此工作区最多保留最近 100 条不同的已发送文本，跨 Tab 可用；选择后只填回输入框，不自动发送。`/history` 仍用于查看会话 JSON。
- `/clear` 明确表示“清空显示”，保留会话上下文、保存的历史、用量和计划；需要新上下文时使用 `/new`。
- 输入区的“新建”按钮在当前 webview 清空显示，不再打开新标签；提示文字注明保留上下文，任务运行时禁用。`/new` 和会话列表的新建入口仍创建独立会话。
- 每个会话独立占用一个编辑器 Tab，可在任务运行时新建或打开其他会话。重复打开会话会定位到已有 Tab；标题显示运行中、待审批、待回答和已完成。关闭 Tab 保留后台任务与待处理问题，重新打开恢复对话和文本草稿。
- 聊天输入支持 TUI 风格触发：`/` 命令、`@` 文件、`#` 智能体、`!` 终端，并支持全角 `／`、`＠`、`＃`、`！`。
- VSIX 不复刻 TUI 的 F-key/footer 快捷按钮；会话、模型、日志、主题等入口使用 slash 命令、Command Palette、TreeView 和 VS Code 原生界面。
- VSIX 终端模式会打开 VS Code 集成终端；Session JSON、会话 ID 和会话摘要通过 Sessions tree 右键菜单提供；伙伴功能由 VSIX 本地承载，Buddy tab 采用无框像素角色展示，支持点击角色互动、成长进度和紧凑的选项菜单；支持动画 WebP、通过 `/companion summon` 每日 09:00 召唤、通过 `/companion collection` 查看收藏状态、抚摸、重命名、静音、详情、直接叫名字的本地短回应，以及基于 iCode 使用/时间的成长等级。
- 如果发现 VSIX 和 TUI 行为不一致，可运行 `iCode: Diagnostics Report` 或 `/support` 复制支持快照；其中包含输入触发、工具渲染和操作 guard 的排查信息。

## Notes

The VS Code extension uses iCode ACP for backend communication and keeps the first release focused on editor-native workflows. File mentions, file attachments, terminal launch, structured session JSON, logs, and copy actions use VS Code surfaces where that is a better fit than recreating every TUI panel directly.

### Welcome brand / 欢迎页标识

The welcome page defaults to **iCode**. Click its mark to choose the **iC** or **C** icon, or change `chrys.ui.brand` in editor settings. The selection is saved automatically.

欢迎页默认显示 **iCode**。点击标识可选择 **iC** 或 **C** 图标，也可在编辑器设置中修改 `chrys.ui.brand`；选择会自动保存。

Each live session uses a separate iCode ACP process, so multiple sessions consume additional memory. Closing a tab keeps that runtime until the IDE extension shuts down. Reloading the IDE restores the last active saved session; reopen others from Sessions. Sessions in the same workspace share files.

每个活跃会话使用独立的 iCode ACP 进程，多会话会增加内存占用。关闭 Tab 后运行时保留至扩展退出；重新加载 IDE 会恢复最后活跃的已保存会话，其他会话可从列表重新打开。同一工作区的会话共享文件。

## iCode naming and compatibility

The upstream runtime is [openJiuwen-ai/iCode](https://github.com/openJiuwen-ai/iCode). This extension uses the iCode product name and the `icode-vscode-plugin` package name. Existing `chrys.*` commands/settings, theme identifiers, storage keys, bundled launcher names and `_chrys/*` ACP routes remain compatibility identifiers. A renamed extension has a new extension ID; extension-scoped saved state is not automatically migrated from the old extension. Disable the old Chrys extension before enabling this one to avoid duplicate command registrations.

上游运行时已迁至 [openJiuwen-ai/iCode](https://github.com/openJiuwen-ai/iCode)。本扩展使用 iCode 品牌，包名为 `icode-vscode-plugin`。现有 `chrys.*` 命令、设置、主题、存储键、内置启动器名称和 `_chrys/*` ACP 路由作为兼容标识保留。扩展 ID 改变后，旧扩展的专属状态不会自动迁移；启用本扩展前请禁用旧 Chrys 扩展，避免重复注册命令。

## Development / 开发

```bash
npm ci
npm run lint
npm test
npm run build
npm run package
```

The package command requires [uv](https://github.com/astral-sh/uv) and writes `icode-vscode-plugin-0.0.28.vsix`. The universal VSIX does not bundle the CLI. `npm run deploy` installs it into the local macOS openUBMC Studio application.

打包需要 [uv](https://github.com/astral-sh/uv)，输出 `icode-vscode-plugin-0.0.28.vsix`。通用包不包含 CLI；`npm run deploy` 会安装到本机 macOS 的 openUBMC Studio。

For integration tests, set `ICODE_BINARY_PATH` to the iCode executable and run `npm run test:integration`. The default expected CLI version is 0.27.1; override it with `ICODE_EXPECTED_VERSION` when testing another release. Model-backed tests require a configured model profile.

集成测试通过 `ICODE_BINARY_PATH` 指定 iCode 可执行文件，然后运行 `npm run test:integration`。默认期望 CLI 版本为 0.27.1，测试其他版本时可设置 `ICODE_EXPECTED_VERSION`；调用模型的测试需要可用的模型配置。

### 中文设置与发布说明

- `chrys.agent.default`：新会话默认智能体。
- `chrys.model.profile`：新会话的模型配置；留空沿用后端默认选择。
- `chrys.approval.mode`：初始审批模式，支持 `manual`、`auto`、`bypass`。
- `chrys.ui.theme`：主题；`auto` 跟随受支持的 `CHRYS_THEME`，也可选择 `chrys`、`chrys-ansi`、`dracula`、`monokai`、`nord`、`tokyo-night` 等。

发布检查参见 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)，VSIX 与 TUI 的已接受差异参见 [DESIGN_DECISIONS.md](./DESIGN_DECISIONS.md)。CD 仅手动触发，从公开的 iCode Releases 获取离线运行时，不需要旧私有仓库令牌。审批参数编辑、跨客户端会话改名和中断会话重放仍需后端提供相应 ACP 契约。

## License / 许可证

This project uses the [Apache License 2.0](./LICENSE), the same license as [upstream iCode](https://github.com/openJiuwen-ai/iCode/blob/main/LICENSE). The original extension copyright and MIT permission notice are preserved in [NOTICE](./NOTICE). Third-party dependencies and assets retain their own applicable licenses.

本项目采用与 [上游 iCode](https://github.com/openJiuwen-ai/iCode/blob/main/LICENSE) 一致的 [Apache License 2.0](./LICENSE)。原扩展的版权声明和 MIT 许可文本保留在 [NOTICE](./NOTICE) 中。第三方依赖和素材仍适用各自的许可证。

Third-party frontend licenses ship in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
and [licenses/](./licenses/). Companion ownership is recorded in
[ASSET_PROVENANCE.md](./ASSET_PROVENANCE.md). Platform packaging retains upstream
runtime license files; raw `--binary` inputs require adjacent upstream `LICENSE`
and `NOTICE` files. Run `npm run build` before packaging to refresh the dependency
inventory checked by the packer.

前端依赖的完整许可随包提供，见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)
和 [licenses/](./licenses/)；伙伴素材来源见 [ASSET_PROVENANCE.md](./ASSET_PROVENANCE.md)。
平台包保留后端许可文件；使用 `--binary` 打包时，二进制旁必须提供上游 `LICENSE`
和 `NOTICE`。打包前运行 `npm run build`，以更新打包器校验的依赖清单。

### Usage & Trajectory / 用量与执行轨迹

The Context sidebar separates the latest main-agent context reading, cumulative session spend (including sub-agents), and the main agent's latest input/output/cache readings. Latest readings are not full-turn totals. A reported zero stays `0`; missing data is `—`. Local token counts and system overhead are labelled as estimates. ACP does not identify every provider estimate, so these live readings are not labelled exact.

`/usage` or `/trajectory` opens historical analysis for the current session, paged saved sessions, a session ID, or an events JSONL file. The installed CLI's public `trajectory export` command supplies timing, parallelism, input/output/reasoning/cache-read/cache-write metrics and expandable per-turn and Workflow timelines. Exact, estimated, missing and unresolved metrics retain their backend precision and reasons. These are snapshots: reopen to refresh. Export JSON, CSV, findings CSV or Perfetto; default backend path redaction remains enabled. Large reports can be exported in full; the view shows at most 200 turns, 100 Workflow runs and 300 operations per timeline. Provider/model attribution is not inferred when absent from the export.

上下文侧栏分别展示主智能体最新上下文读数、会话累计消耗（含子智能体），以及主智能体最新输入/输出/缓存读数；最新读数不是整轮统计。已上报的零显示 `0`，缺失显示 `—`，本地 Token 和系统开销标明估算。

`/usage` 或 `/trajectory` 可分析当前会话、分页选择的历史会话、指定会话 ID 或事件 JSONL 文件。通过 CLI 正式导出接口显示耗时、并行度、输入/输出/推理/缓存读写用量，以及可展开的逐轮和 Workflow 时间线，保留精确、估算、缺失、未确定及其原因。报告是历史快照，重新打开可刷新。支持 JSON、CSV、分析发现 CSV 和 Perfetto 导出，保持后端默认路径脱敏。视图最多显示 200 轮、100 次 Workflow 运行、每条时间线 300 项操作，完整数据仍可导出；没有后端归属信息时不推断模型分类。

Trajectory uses the TUI dashboard layout: Overview / Timeline / Insights / Session data tabs, compact monospace section frames, per-turn selection and coloured hierarchical timeline lanes. Overview activity uses recorded, possibly overlapping operations: the CLI export does not supply the TUI's exclusive wall-time slices. Skill/MCP rollups and complete session storage metadata remain unavailable in this export.

轨迹界面按 TUI 仪表盘布局展示：概览 / 时间线 / 洞察 / 会话数据标签、等宽字体细线分区、轮次切换和彩色层级时间线。概览活动条显示允许重叠的已记录操作；CLI 未导出 TUI 的互斥耗时切片、Skill/MCP 汇总及完整会话存储信息，相关位置明确标为缺失。

### Changes, scope and explicit context / 变更、范围与显式上下文

- `/diff` opens the TUI-style change browser: whole session or one turn, file list, line numbers, unified/split previews and native editor opening. `/rollback last 2` discards two turns; `/rollback to 2` keeps two. Both show a cumulative reverse preview and require confirmation; adding `revert` cannot bypass it. Files without ACP content or with unsafe provenance are excluded from selection.
- `/roots` selects extra directories explicitly; the workspace indicator shows their count and full paths. Choices persist through new/load. Updating an existing idle session reloads only that tab's ACP process.
- `/attach`, `/selection`, `/problems` create removable composer chips. File/selection paths include line ranges. The plugin no longer silently sends the active editor with every prompt.
- Agent configuration has TUI-style section tabs and guided fields, repeatable MCP/sub-agent entries, plus advanced JSON. `/trajectory` supports in-place refresh, operation details and a terminal dependency graph when exported edges are available.

- `/diff` 打开与 TUI 对齐的变更浏览器：按会话或轮次筛选、文件列表、行号、合并/分栏预览，也可在编辑器打开。`/rollback last 2` 丢弃最近两轮；`/rollback to 2` 保留前两轮。回滚展示累计反向差异并要求确认，`revert` 不能跳过确认；缺少内容或归属不安全的文件不进入还原选择。
- `/roots` 显式选择额外目录，工作区指示器显示数量与完整路径；新建和恢复会话保留选择。修改已有空闲会话的范围只重载该标签页的 ACP 进程。
- `/attach`、`/selection`、`/problems` 添加可移除的附件标签，文件和选区带行号范围；不再隐式发送活动编辑器内容。
- 智能体配置提供 TUI 风格分区标签、常用字段表单、MCP/子智能体增删以及高级 JSON。轨迹页可原地刷新、展开操作详情，并在导出提供依赖边时显示终端风格依赖图。

Advanced Agent configuration includes MCP headers/environment and loading limits, inline Skills with resources/scripts, typed external ACP options and search-provider mappings. Arbitrary HTTP request templates retain JSON editing. Persisted session fork, cross-client titles, approval argument editing and interrupted-run recovery still require [public ACP contracts](https://github.com/openJiuwen-ai/iCode/issues/5).

智能体高级配置现已支持 MCP 请求头/环境变量与加载限制、内联技能及其资源/脚本、外部 ACP 类型化选项和搜索提供商映射；任意 HTTP 请求模板保留 JSON 编辑。持久化会话分叉、跨客户端标题、审批参数编辑和中断执行恢复仍需要[公开 ACP 接口](https://github.com/openJiuwen-ai/iCode/issues/5)。

Agent editing now retains per-profile drafts within the current webview, offers Clone and Discard, and prevents a stale draft from overwriting a refreshed profile. Clone creates a new profile only on Save; masked credentials must be re-entered. Session search supports full IDs, titles, profiles and directories. Repeated pending approval/AskUser updates retain typed input.

智能体编辑支持当前 webview 内的逐配置草稿保留、复制配置和放弃修改，并阻止旧草稿覆盖刷新后的配置。复制后须保存才会创建新配置，脱敏凭据需重新填写。会话支持按完整 ID、标题、配置和目录搜索；同一待处理审批/AskUser 请求重复刷新时保留输入。

`npm run package` rebuilds the frontend before packaging, so local packaging and deployment include current sources.

`npm run package` 会先重新构建前端，保证本地打包与部署包含当前代码。
