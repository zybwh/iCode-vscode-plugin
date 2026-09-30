// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { agentConfigurationFields, applyAgentConfiguration } from "../chat/webview/components/agentConfiguration";

let profile: Record<string, unknown>;
let form: HTMLFormElement;
function mount(value: Record<string, unknown>) {
  profile = value;
  document.body.replaceChildren();
  form = document.createElement("form");
  form.append(agentConfigurationFields(value, true));
  document.body.append(form);
}
function edit(selector: string, value: string) {
  const input = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector)!;
  expect(input, selector).toBeTruthy();
  input.value = value;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return input;
}
function click(label: string, scope: Element = form) {
  const button = [...scope.querySelectorAll("button")].find(item => item.textContent === label);
  expect(button, label).toBeTruthy();
  button!.click();
}
function save() { return applyAgentConfiguration(profile, profile, new FormData(form), true); }
beforeEach(() => mount({ name: "Code" }));

describe("guided agent configuration", () => {
  it("preserves unchanged sections without materializing defaults", () => {
    const original = { name: "Code", sub_agent_only: false, future: { retain: true }, tools: { mcp: [{ name: "private", transport: "http", url: "https://example.test", headers: { Authorization: "***" }, allowed_tools: [] }] } };
    mount(original);
    expect(save()).toEqual(original);
    expect(form.querySelector('[data-section="compaction"] [data-field="enabled"]')).toBeNull();
  });
  it("edits MCP options without losing masked headers, env, or unknown fields", () => {
    mount({ name: "Code", tools: { mcp: [{ name: "private", transport: "http", headers: { Authorization: "***" }, env: { PRIVATE: "***" }, future: 42 }] } });
    edit('[data-section="mcp"] [data-field="verify_ssl"]', 'false');
    edit('[data-section="mcp"] [data-field="use_progressive_disclosure"]', 'true');
    edit('[data-section="mcp"] [data-field="max_tool_result_tokens"]', '4096');
    expect(save().tools).toMatchObject({ mcp: [{ headers: { Authorization: "***" }, env: { PRIVATE: "***" }, future: 42, verify_ssl: false, use_progressive_disclosure: true, max_tool_result_tokens: 4096 }] });
  });
  it("distinguishes an empty MCP allow-list from inherited tools", () => {
    mount({ name: "Code", tools: { mcp: [{ name: "private", transport: "stdio", command: "server", use_progressive_disclosure: true, allowed_tools: ["read"], always_load: ["read"] }] } });
    click('不暴露工具（空允许列表）');
    expect(save().tools).toMatchObject({ mcp: [{ allowed_tools: [], use_progressive_disclosure: false, always_load: [] }] });
    edit('[data-field="allowed_tools"]', 'read');
    edit('[data-field="allowed_tools"]', '');
    expect((save().tools as { mcp: object[] }).mcp[0]).not.toHaveProperty('allowed_tools');
  });
  it("preserves empty environment strings and distinguishes boolean options from text", () => {
    mount({ name: "External", acp: { command: "agent", env: { EMPTY: "x" }, config_options: { enabled: true, text: "false" } } });
    edit('[data-map="env"] [data-map-value="EMPTY"]', '');
    edit('[data-map="config_options"] [data-map-value="enabled"]', 'false');
    edit('[data-map="config_options"] [data-map-value="text"]', 'true');
    expect(save()).toMatchObject({ sub_agent_only: true, acp: { env: { EMPTY: "" }, config_options: { enabled: false, text: "true" } } });
    const invalid = edit('[data-map="config_options"] [data-map-value="enabled"]', 'maybe');
    expect(invalid.checkValidity()).toBe(false);
  });
  it("rejects duplicate map names and deletes entries explicitly", () => {
    mount({ name: "External", acp: { command: "agent", env: { SECRET: "***" } } });
    const group = form.querySelector('[data-map="env"]')!;
    const name = group.querySelector<HTMLInputElement>('[placeholder="新增键名"]')!;
    name.value = 'SECRET'; click('添加', group);
    expect(name.checkValidity()).toBe(false);
    expect(save().acp).toMatchObject({ env: { SECRET: "***" } });
    click('移除', group);
    expect(save().acp).toMatchObject({ env: {} });
  });
  it("edits inline skills and nested resource/script entries", () => {
    click('添加内联技能');
    edit('[data-section="skills"] [data-field="name"]', 'review');
    edit('[data-section="skills"] [data-field="instructions"]', '第一行\n第二行');
    click('添加资源');
    edit('[data-skill-items="resources"] [data-field="name"]', 'guide');
    edit('[data-skill-items="resources"] [data-field="content"]', '# Reference\nKeep literal [markup]');
    click('添加脚本');
    edit('[data-skill-items="scripts"] [data-field="name"]', 'check');
    edit('[data-skill-items="scripts"] [data-field="path"]', 'check.py');
    expect(save().skills).toMatchObject({ inline: [{ name: 'review', instructions: '第一行\n第二行', resources: [{ name: 'guide', content: '# Reference\nKeep literal [markup]' }], scripts: [{ name: 'check', path: 'check.py' }] }] });
    click('移除', form.querySelector('[data-skill-items="resources"]')!);
    expect(save().skills).toMatchObject({ inline: [{ resources: [], scripts: [{ name: 'check' }] }] });
  });
  it("edits provider templates and response mapping without touching other options", () => {
    mount({ name: 'Code', tools: { web_search: { mode: 'provider', provider: 'local', providers: { local: { type: 'custom_http', endpoint: 'https://example.test', future: 'keep' } } } } });
    edit('[data-provider="local"] [data-field="results_pointer"]', '/results');
    edit('[data-provider="local"] [data-field="url_pointer"]', '/url');
    edit('[data-provider="local"] [data-field="query_params"]', '{"q":{"$input":"query"}}');
    expect(save().tools).toMatchObject({ web_search: { providers: { local: { future: 'keep', response: { results_pointer: '/results', url_pointer: '/url' }, request: { query_params: { q: { $input: 'query' } } } } } } });
    const invalid = edit('[data-provider="local"] [data-field="query_params"]', '{invalid');
    expect(invalid.checkValidity()).toBe(false);
    edit('[data-provider="local"] [data-field="query_params"]', '{}');
    expect(invalid.checkValidity()).toBe(true);
  });
  it("keeps tab drafts and preserves unknown enum options", () => {
    mount({ name: 'External', acp: { command: 'agent', result_mode: 'future-mode' } });
    expect(form.querySelector<HTMLSelectElement>('[data-field="result_mode"]')!.value).toBe('future-mode');
    edit('[data-section="acp"] [data-field="command"]', 'new-agent');
    click('技能'); click('外部 ACP 智能体');
    expect(save().acp).toMatchObject({ command: 'new-agent', result_mode: 'future-mode' });
  });
});
