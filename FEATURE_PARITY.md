# iCode frontend capability plan

Baseline: public iCode v0.28.0 and upstream main `bb45692` (2026-09-30).
Compare product workflows first; ACP coverage alone is not feature parity.

## Delivered in this update / 本次已落地

- Composer New clears only the current view through the existing Clear Display handler; tooltip explains retained context, and running tasks disable the button. `/new` and Sessions New retain independent-tab behavior.
- Agent advanced JSON sections cover model, tools/MCP/web, approval, sub-agents, skills, memory, compaction and external ACP configuration. Unknown values and masked secrets round-trip; invalid JSON blocks saving. Guided section tabs, repeated MCP/sub-agent entries, shell/web options and approval overrides are implemented.
- `$` and `＄` open the existing model picker while idle.
- Closed Mermaid fences automatically render as compact themed Unicode diagrams. Source is collapsed below; incomplete, unsupported, oversized and right-to-left flowcharts retain source. Chinese labels use two display cells. Supported families are flowchart, state, sequence, class, ER and XY charts.
- Usage: separate current context, cumulative session spend and latest main-agent readings; preserve reported zero and unknown values. Child usage updates cumulative spend without replacing the parent context gauge.
- Trajectory rendering follows TUI dashboard tabs, compact framed Overview cards and coloured hierarchical timelines; missing CLI wall slices and Skill/MCP summaries are explicit.
- Trajectory interactions: in-place Refresh, retained tab selection, expandable operation details and terminal dependency graph from exported edges.
- Diff/Rollback: TUI-style change list and unified/split previews, period selection and guarded rollback.
- Historical Trajectory: supported CLI export, current/saved session selection, JSONL source, precision-aware usage/timing and per-turn/Workflow timelines; JSON/CSV/Perfetto/findings export. Live streaming and model attribution absent from the export remain pending.
- Workflow CLI integration: discovery, source review, input/timeout, explicit BYPASS/trust confirmation, isolated execution, cancellation, JSON results and bounded local result history. Verified CLI contract on upstream v0.28.0 (`5344293`). Live DAGs and interactive approvals remain pending.
- README, design decisions and release checks explicitly distinguish incomplete Workflow and snapshot-based Trajectory from existing chat features; README links the full bilingual user guide.

The remaining rows below are the full roadmap, not a claim that this update implements every capability.

## Capability status / 能力状态

| Priority | Capability | Required outcome | Boundary |
| --- | --- | --- | --- |
| P1 | Workflow / 工作流 | Discovery and selection; source preview and trust; input; start/cancel; live node graph; node inputs, outputs, model, tools and usage; multiple runs and saved-run recovery. | Partial: supported CLI list/run JSON commands now provide native selection and execution. ACP still has no lifecycle API; live node graph/details, interactive approvals and saved-run recovery require backend contracts. Local result history is not backend run recovery. |
| P1 | Trajectory / 执行轨迹 | Session overview; per-turn model/tool/wait time; tokens and cache; parallelism; model/hook/tool timeline and historical queries. | Historical analysis delivered via the supported CLI trajectory export contract. Snapshot refresh is explicit; live streaming and missing model/invocation attribution still need a supported contract. Frontend receipt times are never backend execution time. |
| P1 | Agent configuration / 智能体配置 | Edit model binding, built-in tools, approval, MCP, skills, sub-agents, memory, compaction and external ACP profiles; preserve unknown fields and masked secrets. | Existing profile read/write APIs. Delivered: guided fields and repeatable entries, including MCP headers/environment/loading options, inline Skills/resources/scripts, typed ACP options and web-provider controls. Arbitrary HTTP request templates and unknown future fields retain JSON editing. |
| P1 | In-view New / 当前窗口 New | Clear the current webview without opening another editor tab. Explicitly distinguish display clearing from a fresh backend session. | Keep independent-session creation available outside the in-view button. Guard an active run. |
| P1 | Multi-root workspace / 多目录工作区 | Explicit additional-root selection, new/load propagation, visible roots and consistent saved-session handling. | Delivered via `/roots`; chosen roots persist and new/load propagate them. Other saved sessions retain backend roots. |
| P1 | Compatibility CI / 兼容性验证 | Pin a public target binary; validate startup, history, approvals, AskUser, sub-agents, profiles and independent sessions. | Delivered: CI pins public v0.28.0, verifies SHA256SUMS and runs integration separately from universal packaging. |
| P2 | Editor context / 编辑器上下文 | Visible removable file/selection attachments with paths and line numbers; explicit Problems attachment. | Delivered: removable composer chips for files/selections/Problems; no invisible active-editor injection. |
| P2 | Rich chat / 富内容 | Offline Mermaid diagrams with safe rendering and readable source/error fallback. | Frontend only; no remote rendering service. |
| P2 | Model trigger / 模型入口 | `$` and `＄` open model selection, alongside `/model`. | Existing session/model operations. |
| P2 | Rollback syntax / 回滚命令 | Distinguish last N turns from “to N”, show the target and retain preview/confirmation. | Delivered: `/rollback last N` versus `/rollback to N`, cumulative reverse preview, selected files, cancellation and confirmation guards. |
| P2 | User guide / 用户指南 | Link the complete upstream guide, including workflow authoring and agent configuration. | Existing command help is not a complete product guide. |
| P2 | Session fork and shared titles / 会话分叉与共享标题 | Independent persisted fork; rename visible across clients. | Backend mutation contracts required; copying transcript text is not a fork. |

## Backend contract acceptance criteria / 后端契约验收

- Workflow: capability advertisement, stable workflow/run/node identities, discovery without implicitly trusting source, trust validation, lifecycle requests, replayable state/events, approval/AskUser ownership and cancellation, session history.
- Trajectory: versioned overview and per-turn query results, pagination, timing and token provenance, live updates, unavailable/estimated/exact distinctions.
- Session mutations: supported fork/title operations and ownership/active-session guards.
- Approval argument editing and interrupted-run replay remain deferred until supported contracts exist.

## Already available / 已有能力

Streaming chat, thinking, tool cards, approvals, AskUser, context/usage indicators, sub-agent control, independent session tabs, saved chat sessions, model profile management, native diffs and rollback, runtime inventory, diagnostics and local Companion.

VS Code integrated terminal, native file navigation and absence of TUI F-key footer buttons remain accepted differences. These do not replace Workflow or Trajectory.

Workflow ACP lifecycle follow-up: [upstream #2](https://github.com/openJiuwen-ai/iCode/issues/2).

Backend-only follow-up: [upstream #4](https://github.com/openJiuwen-ai/iCode/issues/4) tracks missing Trajectory details and an authoritative rollback-preview plan. The frontend exposes conservative recorded-diff rollback; it does not claim parity for backend-only safety-plan details or omitted binary/large content.

Validation (2026-09-30): public v0.28.0 macOS archive checksum verified; ACP integration includes explicit multi-root new/close/load/clear persistence. Upstream bb45692 CLI/ACP suites: 534 passed. Browser rendering checks cover changes file selection, split preview, Agent section tabs, Trajectory details and graph. Studio installation succeeds; native Studio interaction remains unverified because the host Mac is locked. Remote CI has been added but has not run in this unpushed checkout.

Follow-up (2026-09-30): advanced Agent forms expanded with MCP, inline Skill, typed external ACP and web-provider controls. Removed non-persistent compaction enable control. Session fork/shared titles, approval argument edits and interrupted recovery remain blocked by public contracts, tracked in [upstream #5](https://github.com/openJiuwen-ai/iCode/issues/5); these are not marked delivered.

Frontend-only follow-up: Agent profile clone drafts, per-profile unsaved draft retention, discard controls and stale-profile save guards; searchable keyboard-accessible sessions with refresh-stable selection; pending approval/AskUser input retained for identical repeated snapshots. These do not add session fork, shared titles or interrupted execution replay. Agent drafts live only in the current webview.
