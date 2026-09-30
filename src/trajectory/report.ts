import { renderTerminalDiagram } from "../chat/webview/diagrams";
// The host renders trajectory graphs synchronously, so it bundles the diagram engine eagerly.
import "../chat/webview/diagramEngine";
// Render the public chrys.trajectory.export/1 contract, never receipt-time estimates.
type Row = Record<string, unknown>;
function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function items(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function escape(value: unknown): string { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!)); }
function numeric(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
export function parseTrajectory(text: string): Row {
  const data = row(JSON.parse(text));
  if (data.schema !== "chrys.trajectory.export/1") throw new Error("Unsupported trajectory export schema");
  if (row(data.session).availability !== "available") throw new Error("Trajectory data is unavailable");
  if (!Array.isArray(data.turns)) throw new Error("Invalid trajectory turns");
  return data;
}
export function metricText(value: unknown, unit: "tokens" | "ns" | "ratio", zh: boolean): string {
  const metric = row(value);
  const precision = metric.precision;
  const labels: Record<string, string> = zh
    ? { exact: "精确", estimated: "估算", missing: "缺失", unresolved: "未确定" }
    : { exact: "exact", estimated: "estimated", missing: "missing", unresolved: "unresolved" };
  const known = precision === "exact" || precision === "estimated";
  const formatted = known && numeric(metric.value)
    ? unit === "ns" ? `${(metric.value / 1e9).toFixed(3)} s` : unit === "ratio" ? metric.value.toFixed(2) : metric.value.toLocaleString("en-US")
    : "—";
  return `${formatted} · ${labels[String(precision)] ?? (zh ? "未上报" : "not reported")}${metric.reason ? ` (${String(metric.reason)})` : ""}`;
}

function known(value: unknown): number | undefined {
  const m = row(value);
  return ["exact", "estimated"].includes(String(m.precision)) && numeric(m.value) && m.value >= 0 ? m.value : undefined;
}
function duration(ns: number): string {
  const seconds = ns / 1e9;
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 0)} s`;
  return `${Math.floor(Math.round(seconds) / 60)}m ${String(Math.round(seconds) % 60).padStart(2, "0")}s`;
}
function category(family: unknown): string {
  const name = String(family).toLowerCase();
  if (name.startsWith("workflow.")) return "workflow";
  if (name === "sub_agent") return "agent";
  if (name.startsWith("compaction")) return "compaction";
  if (name === "approval") return "approval";
  if (name === "retry") return "retry";
  if (name.startsWith("prepar")) return "prepare";
  if (name.includes("hook")) return "hook";
  if (name.includes("wait") || name === "continuation.poll" || name === "turn.suspension") return "wait";
  if (name.includes("tool")) return "tools";
  if (name.includes("model")) return "model";
  return "other";
}
export function trajectoryHtml(data: Row, label: string, zh: boolean, nonce: string): string {
  const t = (en: string, cn: string) => zh ? cn : en;
  const symbols: Record<string, string> = { exact: "✓", estimated: "~", missing: "−", unresolved: "✗" };
  const badge = (value: unknown) => {
    const m = row(value), precision = String(m.precision ?? "missing");
    return `<span class="precision ${symbols[precision] ? precision : "missing"}">${symbols[precision] ?? "−"}</span>`;
  };
  const metric = (value: unknown, unit: "tokens" | "ns" | "ratio" | "percent" = "tokens") => {
    const n = known(value);
    const formatted = n === undefined ? "—" : unit === "ns" ? duration(n) : unit === "ratio" ? `${n.toFixed(2)}×` : unit === "percent" ? `${n.toFixed(1)}%` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    return `<span class="metric" title="${escape(metricText(value, unit === "percent" ? "ratio" : unit, zh))}">${formatted} ${badge(value)}</span>`;
  };
  const line = (name: string, value: unknown, unit: "tokens" | "ns" | "ratio" | "percent" = "tokens") => `<div class="metric-row"><span>${escape(name)}</span>${metric(value, unit)}</div>`;
  const missing = `<p class="muted">${t("Not included in CLI export", "CLI 导出未提供此数据")} −</p>`;
  const box = (name: string, content: string, extra = "") => `<fieldset class="${extra}"><legend>${escape(name)}</legend>${content}</fieldset>`;
  const ruler = (span: number) => `<div class="ruler">${Array.from({ length: 5 }, (_, i) => `<span>${duration(span * i / 4)}</span>`).join("")}</div>`;
  const bar = (start: number, end: number, origin: number, span: number, kind: string, title = "") => {
    const left = Math.max(0, Math.min(100, (start - origin) / span * 100));
    const width = Math.max(0, Math.min(100 - left, (end - start) / span * 100));
    return `<i class="block ${kind}" title="${escape(title)}" style="left:${left.toFixed(4)}%;width:${width.toFixed(4)}%"></i>`;
  };
  const overview = row(data.overview), wall = row(overview.wall_time_ns), utilization = row(overview.utilization);
  const elapsed = known(overview.elapsed_ns);
  const meter = (name: string, value: unknown, denom?: number, scale = 100) => {
    const n = known(value), percentage = n === undefined || !denom ? undefined : n / denom * scale;
    return `<div class="meter-row ${name}"><span>${escape(name)}</span><span class="meter">${percentage === undefined ? "−" : `<b style="width:${Math.min(100, percentage).toFixed(3)}%"></b>`}</span><span>${percentage === undefined ? "—" : `${percentage.toFixed(1)}%`} ${badge(value)}</span></div>`;
  };
  const timeCard = box(t("Time & usage", "时间与用量"),
    line(t("total time", "总耗时"), overview.elapsed_ns, "ns") + line(t("actual work time", "实际工作时间"), overview.exclusive_work_ns, "ns") +
    line(t("bottleneck (response)", "瓶颈（响应）"), overview.response_cp_ns, "ns") + line(t("bottleneck (compute)", "瓶颈（计算）"), overview.compute_cp_ns, "ns") + line(t("total token usage", "累计 Token 用量"), overview.usage_tokens));
  const splitCard = box(t("Where time went", "时间花在哪里"), ["model", "tools", "wait", "idle"].map(key => meter(key, wall[key], elapsed)).join(""));
  const busyCard = box(t("Parallelism & busy", "并行度与忙碌占比"), line(t("parallelism", "并行度"), overview.parallelism, "ratio") + line(t("parallel time saved", "并行节省时间"), overview.overlap_gain_ns, "ns") + `<p class="muted">${t("Busy share (independent; >100% = parallel work)", "忙碌占比独立计算；>100% 表示并行工作")}</p>` + ["model", "tools"].map(key => meter(key, utilization[key], 1)).join(""));
  const turns = items(data.turns).map(row), runs = items(data.workflow_runs).map(row);
  // The public export lacks TUI wall slices. Use the recorded operation ranges,
  // explicitly labelled as overlapping activity, never fabricated wall partitions.
  const visibleTurns = turns.slice(0, 200);
  const spans = visibleTurns.map(turn => numeric(turn.axis_start_ns) && numeric(turn.axis_end_ns) ? Math.max(0, turn.axis_end_ns - turn.axis_start_ns) : 0);
  const totalSpan = spans.reduce((a, b) => a + b, 0);
  const activity = ["model", "tools", "wait", "hook"].map(kind => {
    let offset = 0;
    const marks = visibleTurns.map((turn, index) => {
      const origin = numeric(turn.axis_start_ns) ? turn.axis_start_ns : 0;
      const ops = items(turn.operations).map(row).filter(op => category(op.family) === kind && numeric(op.start_ns) && numeric(op.end_ns) && op.end_ns >= op.start_ns && ["exact", "estimated"].includes(String(op.precision)));
      const marks = ops.slice(0, 300).map(op => bar(offset + Math.max(0, (op.start_ns as number) - origin), offset + Math.min(spans[index], (op.end_ns as number) - origin), 0, totalSpan || 1, kind, `${t("Turn", "轮次")} ${turn.turn_number} · ${op.identity ?? op.family}`)).join("");
      const boundary = `<i class="boundary" style="left:${(offset / (totalSpan || 1) * 100).toFixed(4)}%"></i>`;
      offset += spans[index]; return boundary + marks;
    }).join("");
    return `<div class="activity-row"><span class="${kind}">${kind}</span><div class="axis">${marks || "—"}</div></div>`;
  }).join("");
  const activityCard = box(t("Per-turn activity", "逐轮活动"), totalSpan ? activity + `<div class="activity-row"><span class="muted">${t("time", "时间")}</span>${ruler(totalSpan)}</div><div class="muted note">${t("Recorded operations can overlap; CLI export does not include TUI exclusive wall-time slices.", "记录的操作允许重叠；CLI 导出不含 TUI 的互斥耗时切片。")}</div>` : missing, "full");
  const usage = row(data.token_usage);
  const input = known(usage.input), cache = known(usage.cache_read);
  const cacheRate = input !== undefined && input > 0 && cache !== undefined && cache <= input ? { value: cache / input * 100, precision: row(usage.input).precision === "exact" && row(usage.cache_read).precision === "exact" ? "exact" : "estimated" } : undefined;
  const tokenCard = box(t("Token usage", "Token 用量"), [["input", t("input", "输入")], ["output", t("output", "输出")], ["reasoning", t("reasoning", "推理")], ["cache_read", t("cache read", "缓存读取")], ["cache_creation", t("cache write", "缓存写入")]].map(([key, name]) => line(name, usage[key])).join("") + line(t("cache hit", "缓存命中率"), cacheRate, "percent"));
  const validation = row(data.validation), funnel = row(validation.funnel), changes = row(data.change_verification);
  const actionCard = box(t("Action breakdown", "操作分解"), ["search", "read", "edit", "verify"].map(key => line(key, funnel[key])).join(""));
  const recoveryCard = box(t("Failure recovery", "失败恢复"), line(t("tool failures", "工具失败"), validation.tool_failure_count) + line(t("median recovery", "恢复耗时中位数"), validation.failure_recovery_median_ns, "ns") + line(t("retry overhead", "重试额外 Token"), validation.retry_amplification_tokens));
  const changeCard = box(t("Change verification", "变更验证"), line(t("files touched", "涉及文件"), changes.files_touched) + line(t("created", "新增"), changes.created) + line(t("modified", "修改"), changes.modified) + line(t("deleted", "删除"), changes.deleted) + items(changes.rows).slice(0, 6).map(value => `<div class="change-row" title="${escape(row(value).path)}">${escape(row(value).path)} · ${escape(row(value).state)}</div>`).join(""));
  const timeline = (value: Row) => {
    const operations = items(value.operations).map(row);
    const placed = operations.filter(op => numeric(op.start_ns) && numeric(op.end_ns) && op.end_ns >= op.start_ns && ["exact", "estimated"].includes(String(op.precision)));
    const origin = numeric(value.axis_start_ns) ? value.axis_start_ns : placed.reduce((min, op) => Math.min(min, op.start_ns as number), Infinity);
    const end = numeric(value.axis_end_ns) ? value.axis_end_ns : placed.reduce((max, op) => Math.max(max, op.end_ns as number), -Infinity);
    const span = Number.isFinite(end - origin) ? Math.max(1, end - origin) : 1;
    const positioned = new Set(placed);
    const categories: Record<string, string> = { model: "Model", tools: "Tool", wait: "Wait", prepare: "Prepare", hook: "Hook", workflow: "Workflow", agent: "Agent", compaction: "Compact", approval: "Approval", retry: "Retry", other: "Operation" };
    const operationDetails = (op: Row) => box(t("Operation details", "操作详情"), `<dl class="operation-fields">${[
      [t("Family","类型"),op.family], [t("Identity","标识"),op.identity ?? op.operation_id],
      [t("Start","开始"),numeric(op.start_ns)?duration(op.start_ns):"—"],
      [t("End","结束"),numeric(op.end_ns)?duration(op.end_ns):"—"],
      [t("Precision","精度"),op.precision], [t("Reason","原因"),op.reason || "—"],
      ...(op.hook_id ? [["Hook",op.hook_id]] : []),
    ].map(([key,v])=>`<dt>${escape(key)}</dt><dd>${escape(v)}</dd>`).join("")}</dl><details><summary>${t("Raw export fields","原始导出字段")}</summary><pre>${escape(JSON.stringify(op,null,2))}</pre></details>`);
    const flow = row(value.flow);
    const edges = [...items(flow.parent_edges), ...items(flow.causal_edges)].filter((e): e is number[] => Array.isArray(e) && e.length===2 && e.every(n=>Number.isInteger(n) && n>=0 && n<operations.length));
    const graphSource = "graph TD\n" + operations.slice(0,50).map((op,i)=>`n${i}["${i+1} ${String(op.family).replace(/[^a-zA-Z0-9_. -]/g,"")}"]`).join("\n") + "\n" + edges.filter(e=>e.every(n=>n<50)).slice(0,80).map(e=>`n${e[0]} --> n${e[1]}`).join("\n");
    const graph = edges.length ? renderTerminalDiagram(graphSource) : null;
    const flowView = `<details class="flow-view"><summary>${t("Dependency graph", "依赖图")}</summary><pre>${graph ?? escape(t("No renderable dependency graph in this export.","此导出没有可渲染的依赖图。"))}</pre>${operations.length>50 || edges.length>80?`<p class="muted">${t("Graph: at most 50 operations and 80 edges.","依赖图：最多 50 个操作、80 条边。")}</p>`:""}</details>`;
    return flowView + `<div class="timeline-scroll"><div class="timeline-canvas"><div class="timeline-row time-row"><span class="muted">${t("time", "时间")}</span><span></span>${ruler(span)}<span></span></div>` + operations.slice(0, 300).map((op, opIndex) => {
      const kind = category(op.family), valid = positioned.has(op), depth = numeric(op.depth) ? Math.min(12, Math.max(0, Math.floor(op.depth))) : 0;
      return `<details class="operation"><summary class="timeline-row" title="${escape(`${op.family} · ${op.identity ?? op.operation_id} · ${op.reason ?? ""}`)}"><span class="category ${kind}">${categories[kind]}</span><span class="identity"><span class="tree">${"│ ".repeat(depth)}</span>${opIndex+1} ${escape(op.identity || op.operation_id)}</span><div class="axis">${valid ? bar(op.start_ns as number, op.end_ns as number, origin, span, kind + (String(op.family).endsWith(".run") ? " run" : "")) : `<span class="unplaced">${badge(op)} ${escape(op.reason || t("timing unavailable", "时间缺失"))}</span>`}</div><span class="duration">${valid ? duration((op.end_ns as number) - (op.start_ns as number)) : badge(op)}</span></summary>${operationDetails(op)}</details>`;
    }).join("") + `</div></div>${operations.length > 300 ? `<p class="muted">${t("First 300 operations shown. Export for the complete timeline.", "仅显示前 300 项操作，完整时间线请导出。")}</p>` : ""}`;
  };
  const timelines = [...visibleTurns.map(turn => ({ value: turn, title: `${t("Turn", "轮次")} ${turn.turn_number ?? "—"}`, elapsed: row(turn.metrics).elapsed_ns })), ...runs.slice(0, 100).map(run => ({ value: run, title: String(run.workflow_id ?? "Workflow"), elapsed: run.elapsed_ns }))];
  const selectionCss = timelines.map((_, index) => `#turn-${index}:checked ~ .turn-panels > #turn-panel-${index}{display:block}#turn-${index}:checked + label{background:var(--selected);color:var(--fg);border-color:var(--accent)}`).join("\n");
  const timelinePage = timelines.length ? `<div class="turn-selector">${timelines.map((entry, index) => `<input class="control" type="radio" name="turn" id="turn-${index}" ${index === timelines.length - 1 ? "checked" : ""}><label class="tab" for="turn-${index}">${escape(entry.title)}</label>`).join("")}<div class="turn-panels">${timelines.map((entry, index) => `<section class="turn-panel" id="turn-panel-${index}"><div class="turn-heading"><strong>${escape(entry.title)}</strong> ${metric(entry.elapsed, "ns")}</div>${timeline(entry.value)}</section>`).join("")}</div></div>` : `<p class="muted">${t("No recorded turns or workflow runs.", "没有已记录的轮次或工作流运行。")}</p>`;
  const findings = items(data.findings).map(row);
  const insights = findings.length ? findings.slice(0, 300).map(finding => box(String(finding.rule_id ?? "Finding"), `<p class="${finding.severity === "error" ? "unresolved" : "estimated"}">${escape(finding.severity)} · ${t("Turn", "轮次")} ${escape(finding.turn_number ?? "—")} ${badge(finding)}</p><pre>${escape(JSON.stringify(finding.detail_args, null, 2))}</pre>`)).join("") : `<p class="muted">${t("No findings in this export.", "本次导出没有分析发现。")}</p>`;
  const mainTabs = [["overview", t("Overview", "概览")], ["timeline", t("Timeline", "时间线")], ["insights", t("Insights", "洞察")], ["session", t("Session data", "会话数据")]];
  const limits = turns.length > 200 || runs.length > 100 ? `<p class="muted">${t("Showing the first 200 turns / 100 workflow runs; export contains all records.", "最多显示前 200 轮 / 100 次工作流运行；导出包含全部记录。")}</p>` : "";
  return `<!doctype html><html lang="${zh ? "zh-CN" : "en"}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${escape(nonce)}'; script-src 'nonce-${escape(nonce)}'; style-src-attr 'unsafe-inline';"><title>iCode Trajectory</title><style nonce="${escape(nonce)}">
:root{--fg:var(--vscode-foreground,#ddd);--bg:var(--vscode-editor-background,#1e1e1e);--accent:#b58aff;--selected:#463957;--line:color-mix(in srgb,var(--accent) 38%,var(--bg));--muted:var(--vscode-descriptionForeground,#999);--model:#b58aff;--tools:#ffb45b;--wait:#e38dd2;--hook:#60d6e9;--good:#68ef97}body.vscode-light{--accent:#7544b6;--selected:#e6daf5;--model:#8051b9;--tools:#995400;--wait:#a14889;--hook:#007c90;--good:#168343}body.vscode-high-contrast,body.vscode-high-contrast-light{--line:var(--vscode-contrastBorder,var(--fg));--accent:var(--vscode-focusBorder,#b58aff)}*{box-sizing:border-box}body{margin:0;padding:10px;background:var(--bg);color:var(--fg);font:13px/1.4 var(--vscode-editor-font-family,'SFMono-Regular',Consolas,monospace)}.dashboard{border:1px solid var(--vscode-panel-border,#444);padding:0 12px 32px;min-height:calc(100vh - 20px);position:relative}h1{font-size:14px;font-weight:400;color:var(--wait);margin:0;position:relative;top:-.7em;background:var(--bg);width:max-content;padding:0 5px;height:12px}.tabs{display:flex;flex-wrap:wrap;align-items:start}.control{position:absolute;width:1px;height:1px;opacity:0}.tab{display:inline-block;color:var(--muted);padding:2px 9px 5px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}.control:focus-visible + label{outline:1px solid var(--accent);outline-offset:-1px}.panels,.turn-panels{width:100%;border-top:1px solid var(--vscode-panel-border,#444);margin-top:3px;padding-top:12px}.page,.turn-panel{display:none}#overview:checked ~ .panels #overview-page,#timeline:checked ~ .panels #timeline-page,#insights:checked ~ .panels #insights-page,#session:checked ~ .panels #session-page{display:block}.control:checked + .tab{color:var(--fg);background:var(--selected);border-color:var(--accent)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}fieldset{border:1px solid var(--line);padding:4px 12px 10px;margin:0;min-width:0}legend{color:var(--accent);font-weight:600;padding:0 7px}.full{grid-column:1/-1}.metric-row{display:flex;justify-content:space-between;gap:8px;min-height:19px}.metric-row>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.metric{white-space:nowrap}.precision{display:inline-block;min-width:1ch}.exact{color:var(--good)}.estimated,.change-row{color:var(--tools)}.missing{color:var(--wait)}.unresolved{color:#ff6588}.muted,.identity,.duration,.ruler{color:var(--muted)}p{margin:0 0 6px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.note{font-size:11px;margin-top:7px}.meter-row{display:grid;grid-template-columns:6ch 1fr 10ch;gap:6px;min-height:19px}.meter{height:15px;align-self:center;background:color-mix(in srgb,var(--fg) 15%,var(--bg));border-left:1px solid var(--fg);position:relative}.meter b{height:100%;display:block;background:currentColor}.model{color:var(--model)}.tools,.prepare{color:var(--tools)}.wait,.approval,.retry{color:var(--wait)}.agent,.compaction{color:var(--accent)}.workflow{color:var(--hook)}.hook{color:var(--hook)}.idle,.other{color:var(--muted)}.activity-row{display:grid;grid-template-columns:7ch 1fr;min-height:18px}.axis{position:relative;min-width:0;overflow:hidden}.block{position:absolute;top:2px;height:14px;min-width:2px;background:currentColor;background-image:repeating-linear-gradient(90deg,transparent 0,transparent calc(1ch - 1px),var(--bg) calc(1ch - 1px),var(--bg) 1ch)}.block.run{color:var(--wait)}.block.tools{height:7px;top:6px}.block.prepare{background:repeating-linear-gradient(135deg,currentColor 0,currentColor 1px,transparent 1px,transparent 3px);border:1px solid currentColor}.timeline-row .block.tools{height:14px;top:2px;background:repeating-linear-gradient(135deg,currentColor 0,currentColor 1px,transparent 1px,transparent 3px);border:1px solid currentColor}.block.wait,.block.approval,.block.retry{height:7px;top:6px;background:transparent;border:1px solid currentColor}.block.hook{width:6px!important;height:6px;top:6px;transform:rotate(45deg);background:currentColor}.boundary{position:absolute;top:0;bottom:0;border-left:1px dotted var(--muted)}.ruler{display:flex;justify-content:space-between;font-size:12px}.turn-selector{display:flex;flex-wrap:wrap}.turn-heading{margin:0 0 6px;display:flex;gap:14px}.turn-heading strong{color:var(--accent);font-weight:600}.timeline-scroll{overflow:auto}.timeline-canvas{min-width:760px}.timeline-row{display:grid;grid-template-columns:8ch 30ch minmax(170px,1fr) 10ch;gap:1ch;min-height:19px}.timeline-row:nth-child(odd):not(.time-row){background:color-mix(in srgb,var(--fg) 5%,var(--bg))}.timeline-row:focus,.timeline-row:hover{outline:none;background:color-mix(in srgb,var(--accent) 14%,var(--bg))}.identity{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tree{color:var(--muted)}.duration{text-align:right;white-space:nowrap}.unplaced{white-space:nowrap;color:var(--muted)}.footer{position:fixed;bottom:0;left:11px;right:11px;padding:5px 12px;background:var(--bg);border-top:1px solid var(--vscode-panel-border,#444);display:flex;gap:16px;font-size:12px}.session-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto}.change-row{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.session-heading{color:var(--accent)}@media(max-width:850px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.grid>fieldset:nth-child(3){grid-column:1/-1}.footer{gap:8px}.session-label{max-width:20%}}@media(max-width:540px){.grid{grid-template-columns:1fr}.grid>fieldset{grid-column:1}.footer .session-label{display:none}}
.operation-fields{display:grid;grid-template-columns:12ch 1fr;gap:4px;margin:3px 0}.operation-fields dt{color:var(--muted)}.operation-fields dd{margin:0;overflow-wrap:anywhere}.operation fieldset{margin:8px 0}summary{cursor:pointer}.operation pre{border:1px solid var(--line);padding:8px}.flow-view pre{white-space:pre;overflow:auto}.refresh{float:right;background:var(--bg);color:var(--fg);border:1px solid var(--line);font:inherit;cursor:pointer}.operation summary::-webkit-details-marker{display:none}
${selectionCss}
</style></head><body><main class="dashboard"><h1>Trajectory</h1><button class="refresh" id="refresh">${t("Refresh", "刷新")}</button><span id="refresh-status" role="status"></span><div class="tabs">${mainTabs.map(([id, title], index) => `<input class="control" type="radio" name="page" id="${id}" ${index === 0 ? "checked" : ""}><label class="tab" for="${id}">${title}</label>`).join("")}<div class="panels"><section class="page" id="overview-page"><div class="grid">${timeCard}${splitCard}${busyCard}${activityCard}${tokenCard}${box(t("Skill usage", "Skill 使用"), missing)}${box(t("MCP usage", "MCP 使用"), missing)}${actionCard}${recoveryCard}${changeCard}</div>${limits}</section><section class="page" id="timeline-page">${timelinePage}${limits}</section><section class="page" id="insights-page">${insights}</section><section class="page" id="session-page"><p class="session-heading">${escape(label)}</p><p class="muted">${t("CLI historical snapshot · use Refresh to update. Full session storage metadata is not included in this export.", "CLI 历史快照 · 点击刷新更新。此导出不包含完整会话存储信息。")}</p><pre>${escape(JSON.stringify({ session: data.session, diagnostics: data.diagnostics }, null, 2))}</pre></section></div></div></main><footer class="footer"><span class="exact">✓ ${t("exact", "精确")}</span><span class="estimated">~ ${t("estimated", "估算")}</span><span class="missing">− ${t("missing", "缺失")}</span><span class="unresolved">✗ ${t("unresolved", "未确定")}</span><span class="session-label" title="${escape(label)}">${escape(label)} · ${t("snapshot", "快照")}</span></footer><script nonce="${escape(nonce)}">const api=acquireVsCodeApi();const save=()=>api.setState({page:document.querySelector('input[name=page]:checked')?.id,turn:document.querySelector('input[name=turn]:checked')?.id});document.querySelectorAll('input.control').forEach(x=>x.onchange=save);const previous=api.getState();if(previous)for(const id of [previous.page,previous.turn]){const input=document.getElementById(id);if(input)input.checked=true;}document.getElementById('refresh').onclick=()=>{save();api.postMessage({type:'refresh'});};window.addEventListener('message',e=>{if(e.data.type==='status'){document.getElementById('refresh').disabled=e.data.busy;document.getElementById('refresh-status').textContent=e.data.error||'';}});</script></body></html>`;
}
