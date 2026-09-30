import { describe, it, expect } from "vitest";
import { parseTrajectory, metricText, trajectoryHtml } from "../trajectory/report";
import { tokenValueOrDash } from "../chat/webview/helpers";
const exact = (value: number) => ({ value, precision: "exact", reason: "" });
const data = { schema: "chrys.trajectory.export/1", session: { availability: "available" }, overview: { elapsed_ns: exact(2e9), wall_time_ns: { model: exact(1e9) }, usage_tokens: exact(500) }, token_usage: { input: exact(400), output: exact(100), cache_read: exact(0), reasoning: { value: null, precision: "missing" } }, turns: [{ turn_number: 1, metrics: { usage_tokens: exact(500) }, operations: [{ family: "model", identity: "<script>bad()</script>", start_ns: 0, end_ns: 1e9, precision: "exact" }] }] };
describe("usage and trajectory presentation", () => {
  it("distinguishes reported zero, unknown and invalid counts", () => {
    expect(tokenValueOrDash(0)).toBe("0");
    for (const value of [undefined, null, NaN, Infinity, -1]) expect(tokenValueOrDash(value)).toBe("—");
  });
  it("requires the supported schema and an available dataset", () => {
    expect(parseTrajectory(JSON.stringify(data))).toEqual(data);
    expect(() => parseTrajectory('{"schema":"other"}')).toThrow("schema");
    expect(() => parseTrajectory(JSON.stringify({ ...data, session: { availability: "unavailable" } }))).toThrow("unavailable");
  });
  it("does not convert missing or unresolved metric values to exact zero", () => {
    expect(metricText(exact(0), "tokens", true)).toBe("0 · 精确");
    expect(metricText({ value: 0, precision: "missing" }, "tokens", true)).toBe("— · 缺失");
    expect(metricText({ value: 100, precision: "unresolved", reason: "partial" }, "tokens", false)).toBe("— · unresolved (partial)");
    expect(metricText({ value: 2e9, precision: "estimated" }, "ns", true)).toBe("2.000 s · 估算");
  });
  it("renders backend timing and tokens as inert themed markup", () => {
    const html = trajectoryHtml(data, 'test <img src=x>', true, "nonce123");
    expect(html).toContain("2.000 s · 精确");
    expect(html).toContain("0 · 精确");
    expect(html).toContain("— · 缺失");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("var(--vscode-editor-background,#1e1e1e)");
    expect(html).toContain("style-src-attr 'unsafe-inline'");
  });
  it("uses TUI dashboard tabs, compact frames and hierarchical timeline lanes", () => {
    const html = trajectoryHtml(data, "test", false, "nonce");
    for (const name of ["Overview", "Timeline", "Insights", "Session data", "Where time went", "Parallelism &amp; busy", "Skill usage", "MCP usage"]) expect(html).toContain(name);
    expect(html).not.toContain("<table");
    expect(html).toContain('name="turn"');
    expect(html).toContain('class="timeline-row"');
    expect(html).toContain("repeating-linear-gradient");
    expect(html).toContain("Not included in CLI export");
  });
  it("renders dependency edges as terminal glyphs and expands operation details", () => {
    const html=trajectoryHtml({...data,turns:[{operations:[{family:"model.run",identity:"run"},{family:"tool.operation",identity:"read"}],flow:{parent_edges:[[0,1]],causal_edges:[]}}]},"test",true,"nonce");
    expect(html).toContain('class="diagram-line"');
    expect(html).not.toContain('&lt;span class=&quot;diagram-line');
    expect(html).toContain("操作详情");expect(html).toContain("原始导出字段");
  });
  it("bounds visible operations while preserving a clear export notice", () => {
    const html = trajectoryHtml({ ...data, turns: [{ operations: Array.from({ length: 301 }, (_, i) => ({ family: "tool", operation_id: i })) }] }, "test", false, "nonce");
    expect(html).toContain("First 300 operations shown");
  });
});
