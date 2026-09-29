# Chrys 最新代码的 VSIX 适配审计

> 实施状态（2026-09-11）：本报告列出的 P0、P1 与两项 P2 回归已在 VSIX `0.0.9` 落地；发布前仍需以 Chrys CLI `v0.22.5` 完成自动化门禁与人工 smoke。下文保留实施前快照与证据，便于追溯判断来源。

## 结论先行

对 Chrys 后端 `c0bbe403bebd9026ce1796f0d1c41e0e372da73b..2055369021513a2bbb82287cba786e17fbe5b178` 的 37 个提交与当前 VSIX `af8b628985d2f87fbc046aab271c2a5422f4a818` 逐项对照后，结论如下：

1. **本区间唯一新增的硬兼容断点是 `chrys/request_input` v2。** Chrys 已删除单题 wire 形状，改为一次请求整批问题、一次响应整批答案；当前 VSIX 仍实现 v1，因此 `ask_user` 在新 Chrys 上不能正常完成。这一项必须适配。
2. **当前 VSIX 还有两个已存在、并非这 37 个提交新引入的确定缺口：**“恢复内置 Agent”仍误调 delete 而非 reset；标准 ACP tool `content` 中的 hosted image/resource/text 未进入 VSIX 状态和渲染。若本轮目标是对齐当前 Chrys，而不只是修复本次新增断点，这两项也应纳入。
3. **建议补两类回归：**历史回放现在给普通工具返回准确 `kind`；Agent Profile 写/删/reset 新增了 fail-closed 文件 owner 校验，插件应把错误展示出来且不能在失败后乐观刷新成成功。
4. **其余不需要照搬。** `Invocation*`、approval hooks、trajectory recorder、engine 拆分、TUI themes/Mermaid/快捷键/Buddy 动画等都没有形成新的 VSIX wire contract。settings/model/session/sub-agent 的 RPC 与 notification 名集合没有变化。

建议本轮的执行优先级是：

| 优先级 | 项目 | 性质 |
|---|---|---|
| P0 | `chrys/request_input` v2 + 新 `ask_user` 工具卡 | 本区间新增、会直接导致功能失败 |
| P1 | `profiles/agents/reset` 接线 | 当前 VSIX 既存确定缺口 |
| P1 | 标准 ACP tool `content` / hosted 资源渲染 | 当前 VSIX 既存确定缺口 |
| P1 | v0.22.5 release baseline、文档和兼容测试更新 | 发布门禁仍停在 v0.16.1 |
| P2 | 历史 tool kind、Profile fail-closed 错误路径回归 | 后端行为增强，主协议未变 |

## 审计边界与证据规则

- 后端仓库：`/Users/yubo/openubmc/studio/chrys`
- 后端范围：`c0bbe403..20553690`，共 37 个提交
- VSIX 仓库：`/Users/yubo/openubmc/studio/chrys-vscode`
- VSIX 快照：`af8b628`，`package.json` 版本为 `0.0.8`
- 当前后端工作树 `pyproject.toml:3` 为 `0.22.5`；远端发布 tag `v0.22.5` 指向 `d586402e`。当前 HEAD 比该 tag 多 3 个提交：`095eae44`、`8bd778c1`、`20553690`。
- 结论只使用上述两个仓库的一手源码、测试、git log/diff 和 `git ls-remote --tags origin`；未使用二手说明。
- 行号以 Chrys `20553690` 和 VSIX `af8b628` 为准。

对 `server.py` 两端所有 `"chrys|session|sub_agent|profiles|settings|mcp|skills/*"` 字符串集合做排序比较，结果为空 diff。换言之，本区间没有新增或删除 RPC/notification 名；真正的破坏性变化发生在既有 `chrys/request_input` 的 payload 内。

## P0：必须适配 `chrys/request_input` v2

### 后端已经把 v1 完整替换掉

变更来自 commit `214b03a0`（`feat(ask_user): multi-question prompts with a tabbed TUI and ACP request_input v2`）。当前 contract 是：

- 请求：`sessionId`、`requestId`、`callerName`、`questions[]`。
- 每题：`question`、`header`、`multiSelect`、`options[{label, description}]`。
- 响应：与题数等长、按位置对应的 `answers[{values[], note}]`，外加 `cancelled`。
- free text 放在 `values`，不是 `note`；未答题用空 `values`。
- 不做 capability negotiation，也不把单题投影回旧格式。

一手证据：

- Chrys frontend contract：`../chrys/src/chrys/app/acp/doc/frontend-api.md:168-225`。
- 服务端实际发送 `questions` 并验证结构化响应：`../chrys/src/chrys/app/acp/server.py:1331-1401`。
- 严格响应校验：题数必须一致，单选不可多值，多选值必须来自 options，`note` 只能附着在合法 option 选择上；任一非法项使整批取消：`../chrys/src/chrys/foundation/models/ask_user.py:382-437`。
- 请求/题目上限及字段集合：`../chrys/src/chrys/foundation/models/ask_user.py:13-29,323-379`。
- live 工具本身也只接受 `questions`，支持一到五题、open-ended、option description 与 multi-select：`../chrys/src/chrys/service/tools/builtins/ask_user.py:221-300`。

### 当前 VSIX 仍是 v1

当前插件的完整路径都绑定在单个 `question/options/text` 上：

- 类型仍是 `{question, options?: string[]}` / `{text}`：`src/acp/types.ts:976-988`。
- ACP client 在无 handler 或异常时也回 `{text: ""}`：`src/acp/client.ts:485-497`。
- handler 只维护一个问题字符串，只能选一个 string option 或输一段文本，最终回 `{text}`：`src/askUser/modal.ts:7-92`。
- runtime 诊断状态只保存一个 `question`：`src/state/runtime.ts:44-48`。
- host/webview message 与 dialog state 只允许单题单文本：`src/chat/panel.ts:39-47,133-159,262-285,366-370`。
- webview 只渲染一组按钮和一个 textarea，点击 option 会立刻提交：`src/chat/webview/components/dialogs.ts:887-952`。
- 已完成的 `ask_user` 工具卡只解析旧 `{question, options: string[]}` 与 `User response:`：`src/chat/webview/components/toolCards.ts:241-317`；对应测试也只覆盖旧形状：`src/__tests__/tool-card-parsers.test.ts:84-95`。

实际失败链是确定的：新后端发 `questions`，旧 VSIX 读取不到 `req.question` / `req.options`；即使用户输入了内容，VSIX 回的仍是 `{text}`。后端 validator 在没有 `answers` 时按 cancelled 处理，并向模型产生可重试的 `ask_user_no_response` 错误（`../chrys/src/chrys/app/acp/doc/frontend-api.md:217-225`）。这不是仅仅“多题 UI 不够好”，而是单题场景也会失败。

### 适配应覆盖的 VSIX 面

1. `src/acp/types.ts`
   - 建模 `RequestInputQuestion`、`RequestInputOption`、`RequestInputAnswer`。
   - v2 request 使用 `questions[]`；v2 response 使用 `answers[]` / `cancelled`。
   - 如果仍需兼容旧 Chrys，可在接收端按 `questions` 与 `question` 判别，并针对收到的版本返回对应的单一合法形状；不能把 v1/v2 字段混在一个响应里，因为 v2 拒绝未知字段。
2. `src/acp/client.ts`
   - 无 handler、异常、用户取消时回 `{cancelled: true}`，不再回 `{text: ""}`。
   - 正常响应必须保持与问题数相同的 answers 长度。
3. `src/askUser/modal.ts`、`src/state/runtime.ts`
   - pending state 改为整批问题与整批草稿。
   - fallback 也必须遍历全部问题，而不是只弹一个 QuickPick/InputBox。
4. `src/chat/panel.ts`、`src/chat/webview/components/dialogs.ts` 及 dialog 样式
   - 支持逐题导航或 tabs、option description、multi-select、open text、选项后的 note、跳过/未回答、提交前 review、整批取消。
   - 不要求像素级复制 TUI，但必须满足同一数据 contract。
5. `src/chat/webview/components/toolCards.ts`
   - live 与 history 工具卡都要解析 `questions[]`。
   - 单题单值的后端结果仍可能是 `User response: X`；多题结果是包含 `responses[]` 的 JSON（`../chrys/src/chrys/foundation/models/ask_user.py:222-241`），两种都要正确展示。
6. 测试
   - 单题 option、单题 free text、多题混合、multi-select、option note、unanswered、cancel、handler 异常。
   - 拒绝错误 answers 长度、重复/空白 values、单选多值、非法 note。
   - 对真实 Chrys v0.22.5 做一次 callback integration；当前 `tests/integration/chrys-binary.test.ts` 没有触发/响应 `chrys/request_input`。

ACP 模式下后端默认不设 ask-user timeout，仍由 client 维护交互生命周期（`../chrys/src/chrys/app/acp/doc/frontend-api.md:227-237`）。因此不要给 VSIX 硬拷贝 TUI/CLI 从 10 分钟改成 15 分钟的超时；用户 cancel 或 session cancel/close 才是正确收口。

## 当前 VSIX 的既存确定缺口

这些问题在 `c0bbe403` 时就已存在于后端 contract，不能记成这 37 个提交的新增回归；但如果本轮目标是“适配最新 Chrys”，它们应被明确处理。

### 1. “恢复内置 Agent”调用了错误的 RPC

后端明确区分：

- `profiles/agents/delete` 只删除用户 profile，内置 profile 会被拒绝。
- `profiles/agents/reset` 才用于恢复内置 profile，同时保留 Skills/MCP/Memory 设置。

证据：`../chrys/src/chrys/app/acp/doc/frontend-api.md:152-166`、`../chrys/src/chrys/app/acp/server.py:667-689`、`../chrys/src/chrys/app/acp/session_manager.py:299-364`。

当前 VSIX 的 `src/acp/client.ts:334-367` 只有 list/read/write/delete，没有 `_profiles/agents/reset`；但内置 Agent 按钮文案却是“Restore Built-in”，随后仍发 delete：`src/chat/webview/components/dialogs.ts:383-425,475-486`、`src/ui/dialogs.ts:1510-1558`。因此这一操作对当前后端会收到明确拒绝，而不是完成恢复。

适配建议：增加 `resetAgentProfile(name)`，让 built-in 分支调用 `_profiles/agents/reset`；普通用户 profile 保持 delete。成功后根据 `changed` 刷新 registry/runtime；错误必须保留当前表单状态并直接展示。

### 2. 标准 ACP tool `content` 已建类型但未消费

Chrys 对 provider-hosted 工具把图片、resource link、artifact fallback text 放在标准 `ToolCallStart/ToolCallProgress.content`，并在 live 与 history replay 两条路径都发送：

- live hosted 内容投影：`../chrys/src/chrys/app/acp/bridge.py:78-178,253-305,359-399`。
- history hosted 内容投影：`../chrys/src/chrys/app/acp/history.py:437-511`。

当前 VSIX 虽声明 `content?: ToolCallContent[]`（`src/acp/types.ts:823-903`），但 `handleToolCallStart` / `handleToolCallProgress` 只保存和渲染 raw input/output，完全忽略 content：`src/handlers/session.ts:210-283`。结果是 image-only hosted result 的 `rawOutput` 可能为空，而实际图片只在 content 中，插件工具卡会完成但看不到产物。

适配建议：把 ACP content wrapper 与内部 `ContentBlock` 类型化，进入 `ToolSnapshot` / `ChatMessage`，按 text、image、resource_link 渲染；终态 update 要遵循 ACP 替换语义，不能把每次 content 无条件 append。`_meta.chrys` 的 hosted family/provider/status 也应保留下来用于状态与诊断。

## 本区间建议适配或补回归的项目

### 历史回放使用准确 tool kind

commit `b343db68` 把普通历史工具的 `ToolCallStart.kind` 从固定 `other` 改为 `acp_tool_kind(kind)`：`../chrys/src/chrys/app/acp/history.py:190-200,370-378`。

VSIX 已把 `update.kind` 写入 tool snapshot/message（`src/handlers/session.ts:218-235,243-263`），渲染器也按 kind 分流，因此没有必改逻辑。建议加一条 load/rollback history 回归，确认 read/edit/execute/search/ask_user 在历史重放后与 live 使用相同图标、详情和动作，而不是测试夹具继续默认 `other`。

### Agent Profile fail-closed 错误路径

commit `cfd14353` 增加磁盘真实 owner 校验，覆盖大小写/Unicode 文件名别名、不可读 owner、缺失父 profile 等情况：`../chrys/src/chrys/app/acp/session_manager.py:230-260,299-364`。RPC 名与成功 payload 没变，所以不是协议硬适配。

但 VSIX 的 inline Agent dialog 在 save/delete promise 失败时由 `src/extension.ts:662-671` 空 catch 吞掉；`saveAgentFromDialog` / `deleteAgentFromDialog` 自身只有 `finally`，没有把异常交给已有 `agentDialogError`（`src/ui/dialogs.ts:1485-1593`）。独立 Management Panel 会在 `src/manage/panel.ts:286-340` 正确展示错误。建议统一两条 UI 路径：失败时显示 backend message、不展示成功 notice、不 reload、不改本地列表，并提供 refresh。

## 无需照搬的后端变化

### `Invocation* + origin` 与 sub-agent

commit `ddd402a4` 把主 Agent、子 Agent、workflow node 的内部事件统一为 `Invocation*`，身份移到 `InvocationOrigin`。这是后端内部所有权重构：

- ACP bridge 仍输出标准 agent message/thought/tool/usage updates，并在内部过滤 workflow node：`../chrys/src/chrys/app/acp/bridge.py:226-429`。
- server 仍发相同 `chrys/sub_agent_*` notification 名与既有字段；只是从 `event.origin.invocation_id` 取 id：`../chrys/src/chrys/app/acp/server.py:1000-1164`。
- VSIX 已按 `invocationId` 接收并维护 paused/retry/abort 状态：`src/acp/client.ts:440-456`、`src/handlers/notifications.ts:423-507`。

因此不要在 VSIX 暴露或复制后端 `InvocationOrigin`、invoker、lease、shell/policy 类型。客户端只依赖 ACP 投影。

### settings / model / session

本区间没有新增或删除相关 route；`session/new/load/list`、runtime、mutations/diff/rollback、settings/options/reload、model switch、profile/model CRUD、MCP/skills 均保持原方法名。engine 拆分只把 usage 访问从 `engine.make_usage_event` 移到 `engine.usage_publisher.make_usage_event`，wire payload 没变（`../chrys/src/chrys/app/acp/server.py:1229-1254`）。

`DEFAULT_ASK_USER_TIMEOUT_SECONDS` 从 600 变 900 秒只影响 TUI/CLI 默认；ACP 将该值 pin 为无限等待，不能据此给 VSIX 增加 15 分钟超时。

### approval 与 trajectory

commit `095eae44` 新增 `approval_requested` / `approval_resolved` hooks，但它们只是观察实际人工等待，不参与决策，标准 `session/request_permission` 未变：`../chrys/src/chrys/service/agent_middleware/control/approval_hooks.py:18-63`。

commit `bdde37fc` 让 recorder 在 manager 退休后继续等待 hook span 的真实结果并在 close 时收口；没有新增 ACP RPC/notification。VSIX 不需要实现 hook recorder 或 trajectory finalizer。

### hosted tool 本区间变化

`ddd402a4` 在 bridge 中主要是内部事件类名替换；hosted metadata、image/resource/artifact 的 ACP shape 没有新增字段要求。因此没有“因这 37 个提交而新增”的 hosted 适配。前述 VSIX 忽略标准 tool content 是既存缺口，应单独修，不能归因于本次 diff。

### 纯 TUI / Buddy / 平台修复

用户 theme loader、更多 Mermaid 类型、Ctrl/Shift+Insert、Textual overlay/resize/animation 修复、TrueColor Buddy sprites、PTY CRLF 等都不经过 Chrys ACP frontend contract。VSIX 应继续使用 VS Code/webview 原生主题、剪贴板、终端和 Companion 边界，无需复制这些实现。

## Release baseline 与测试门禁

发布基线应选已发布的 Chrys tag，而不是当前未发布 HEAD：远端 `v0.22.5` 指向 `d586402e`，且 ask-user v2 已包含在该 tag 中；HEAD 的 3 个额外提交不新增 VSIX wire contract。

当前 release/test 文本仍锁定 `v0.16.1`：

- `DESIGN_DECISIONS.md:26`
- `RELEASE_CHECKLIST.md:29-38`
- `README.md:67-75`
- `.github/workflows/cd.yml:1-27`
- `tests/integration/chrys-binary.test.ts:235-265`
- `src/__tests__/release-manifest.test.ts:457-551`
- `src/__tests__/acp-client-v016.test.ts:18`
- `src/__tests__/session-v016.test.ts:34`
- `src/__tests__/notifications-v016.test.ts:29`

适配落地时应：

1. 把兼容性声明与 integration target 更新到 Chrys `v0.22.5`，继续保留“VSIX 版本与 Chrys CLI 版本独立”的原则。
2. 新增真实 request-input v2 callback smoke；现有 integration 只证明 route 与普通 prompt 可用，无法发现本次断点。
3. 为 reset 与 structured tool content 增加 contract fixtures。
4. 复跑 `npm run lint`、`npm test`、`npm run build`、`npm run package`；由于涉及后端兼容假设，再跑 `npm run test:integration`，并让目标二进制报告 `0.22.5`。
5. 平台 VSIX 只消费 Chrys `v0.22.5` 已发布的 release-built binary；不要从当前 backend working tree 临时构建后塞进发布包。
6. 实现提交落地时再按独立版本策略从 VSIX `0.0.8` 递增，并同步 `package.json`、`package-lock.json`、`src/common/version.ts` 与 release-manifest guard；本审计不预先指定版本号。

## 最小实施切片

为了把新增风险和既存旧债隔离，建议拆成四个可独立验证的切片：

1. **ask-user v2 contract**：types/client/handler + 纯单元测试。
2. **ask-user v2 UI 与工具卡**：batch dialog/fallback/review + renderer 测试。
3. **既存 ACP 缺口**：Agent reset 与 structured tool content，各自独立测试。
4. **release 对齐**：v0.22.5 integration、文档、版本和 package/release gates。

不建议把 invoker/engine/TUI/Buddy 内部重构并入任何切片；它们既不属于 VSIX contract，也会扩大回归面。
