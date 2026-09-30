// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { state } from "../chat/webview/state";
import { setModelDialogState, setModelDialogBusy, setAgentDialogState, setInlineDialogState } from "../chat/webview/components/dialogs";
import type { ChatModelDialogState } from "../chat/panel";

let dialog: HTMLElement;
const host = { postMessage: vi.fn() };
const models: ChatModelDialogState = {
  activeModelProfileId: "daily", models: [
    { id: "daily", name: "Daily", provider: "openai", modelId: "code", apiStyle: "responses" },
    { id: "review", name: "Review", provider: "openai", modelId: "review" },
  ], profiles: {
    daily: { name: "Daily", model_id: "code", provider: "openai", api_style: "responses", api_key: "***", http_headers: { "X-Client": "iCode" }, chat_options: { temperature: 0.2 } },
    review: { name: "Review", model_id: "review" },
  },
};
beforeEach(() => {
  state.uiLanguage = "zh-CN"; state.selectedModelId = ""; state.selectedAgentName = "";
  host.postMessage.mockClear();
  document.body.innerHTML = '<button id="opener">Open</button><div class="modal-backdrop hidden"><section role="dialog"><header><div class="tui-modal-title"></div><div class="tui-modal-subtitle"></div><div class="tui-modal-actions"><button>Close</button></div></header><div class="modal-notice hidden"></div><div class="model-dialog-body"><aside class="model-list"></aside><main class="model-detail"></main></div><div class="inline-dialog-body"></div><div class="inline-dialog-footer hidden"></div></section></div>';
  dialog = document.querySelector(".modal-backdrop")!;
});

describe("profile configuration dialogs", () => {
  it("edits advanced agent sections while preserving identity, unknown fields and masked secrets", () => {
    setAgentDialogState({ agents: [{ name: "Code" }], activeAgentName: "Code", profiles: { Code: {
      name: "Code", id: "stable", tools: { mcp: [{ name: "private", headers: { Authorization: "***" } }] },
      future_field: { keep: true }, memory: { files: ["old.md"] },
    } } }, dialog, host);
    dialog.querySelector<HTMLTextAreaElement>('[name="agent_section_memory"]')!.value = '{"files":["AGENTS.md"]}';
    dialog.querySelector<HTMLTextAreaElement>('[name="agent_section_acp"]')!.value = '{"command":"reviewer","args":["acp"]}';
    dialog.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(host.postMessage).toHaveBeenCalledWith({ type: "agentDialogSave", agent: expect.objectContaining({
      name: "Code", id: "stable", future_field: { keep: true }, sub_agent_only: true,
      memory: { files: ["AGENTS.md"] }, acp: { command: "reviewer", args: ["acp"] },
      tools: { mcp: [{ name: "private", headers: { Authorization: "***" } }] },
    }) });
  });
  it("rejects malformed sections without sending a partial save and can remove external ACP configuration", () => {
    setAgentDialogState({ agents: [{ name: "External" }], activeAgentName: "", profiles: { External: {
      name: "External", sub_agent_only: true, acp: { command: "external" },
    } } }, dialog, host);
    const field = dialog.querySelector<HTMLTextAreaElement>('[name="agent_section_acp"]')!;
    field.value = '[]';
    dialog.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(host.postMessage).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("必须是有效 JSON 对象");
    field.value = '';
    dialog.querySelector<HTMLInputElement>('[name="sub_agent_only"]')!.checked = false;
    dialog.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(host.postMessage.mock.calls[0][0].agent.acp).toBeUndefined();
    expect(host.postMessage.mock.calls[0][0].agent.sub_agent_only).toBe(false);
  });
  it("edits guided fields while preserving MCP secrets and unknown keys", () => {
    setAgentDialogState({agents:[{name:"Code"}],activeAgentName:"Code",profiles:{Code:{name:"Code",tools:{builtins:["read"],future:true,mcp:[{name:"private",command:"old",headers:{Authorization:"***"}}]}}}},dialog,host);
    const command=dialog.querySelector<HTMLInputElement>('[data-section="mcp"] [data-field="command"]')!;
    command.value="new";command.dispatchEvent(new Event("change"));
    dialog.querySelector("form")!.dispatchEvent(new Event("submit",{cancelable:true}));
    expect(host.postMessage.mock.calls[0][0].agent.tools).toMatchObject({future:true,mcp:[{command:"new",headers:{Authorization:"***"}}]});
  });
  it("blocks saving malformed guided HTTP templates instead of silently sending the old value", () => {
    setAgentDialogState({agents:[{name:"Code"}],activeAgentName:"Code",profiles:{Code:{name:"Code",tools:{web_search:{providers:{local:{type:"custom_http",endpoint:"https://example.test"}}}}}}},dialog,host);
    const field=dialog.querySelector<HTMLTextAreaElement>('[data-provider="local"] [data-field="query_params"]')!;
    field.value="{broken";field.dispatchEvent(new Event("change"));
    dialog.querySelector("form")!.dispatchEvent(new Event("submit",{cancelable:true}));
    expect(host.postMessage).not.toHaveBeenCalled();
    expect(dialog.querySelector<HTMLElement>('[data-section="tools"]')!.hidden).toBe(false);
    field.value='{"q":{"$input":"query"}}';field.dispatchEvent(new Event("change"));
    dialog.querySelector("form")!.dispatchEvent(new Event("submit",{cancelable:true}));
    expect(host.postMessage).toHaveBeenCalledOnce();
  });
  it("retains per-profile drafts across switches and refresh, then clears only the saved draft", () => {
    const snapshot = {agents:[{name:"Code"},{name:"Review"}],activeAgentName:"Code",profiles:{Code:{name:"Code",description:"saved"},Review:{name:"Review"}}};
    setAgentDialogState(snapshot,dialog,host);
    const description=dialog.querySelector<HTMLInputElement>('[name="description"]')!;
    description.value="draft";description.dispatchEvent(new Event("input",{bubbles:true}));
    dialog.querySelector<HTMLButtonElement>('[data-agent-name="Review"]')!.click();
    dialog.querySelector<HTMLButtonElement>('[data-agent-name="Code"]')!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="description"]')!.value).toBe("draft");
    expect(dialog.textContent).toContain("未保存");
    setAgentDialogState(snapshot,dialog,host);
    expect(dialog.querySelector<HTMLInputElement>('[name="description"]')!.value).toBe("draft");
    setAgentDialogState({...snapshot,updatedAgentName:"Code",profiles:{...snapshot.profiles,Code:{name:"Code",description:"normalized"}}},dialog,host);
    expect(dialog.querySelector<HTMLInputElement>('[name="description"]')!.value).toBe("normalized");
  });
  it("blocks overwriting a profile changed outside the draft", () => {
    const snapshot={agents:[{name:"Code"}],activeAgentName:"Code",profiles:{Code:{name:"Code",description:"old"}}};
    setAgentDialogState(snapshot,dialog,host);
    const description=dialog.querySelector<HTMLInputElement>('[name="description"]')!;
    description.value="local";description.dispatchEvent(new Event("input",{bubbles:true}));
    setAgentDialogState({...snapshot,profiles:{Code:{name:"Code",description:"remote"}}},dialog,host);
    dialog.querySelector("form")!.dispatchEvent(new Event("submit",{cancelable:true}));
    expect(host.postMessage).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain("编辑器外发生变化");
  });
  it("clones into an editable unsaved draft with a new identity and no masked credentials", () => {
    setAgentDialogState({agents:[{name:"Code"},{name:"Code-copy"}],activeAgentName:"Code",profiles:{Code:{id:"original",name:"Code",metadata:{keep:true},tools:{mcp:[{name:"private",transport:"http",headers:{Authorization:"***",Accept:"application/json"}}]}},"Code-copy":{name:"Code-copy"}}},dialog,host);
    dialog.querySelector<HTMLButtonElement>('[data-clone-agent]')!.click();
    expect(host.postMessage).not.toHaveBeenCalled();
    const name=dialog.querySelector<HTMLInputElement>('[name="name"]')!;
    expect(name.readOnly).toBe(false);expect(name.value).toBe("Code-copy-2");
    expect(dialog.textContent).toContain("已省略脱敏凭据");
    name.value="Independent";
    dialog.querySelector("form")!.dispatchEvent(new Event("submit",{cancelable:true}));
    const saved=host.postMessage.mock.calls[0][0].agent;
    expect(saved.name).toBe("Independent");expect(saved.id).toBeUndefined();
    expect(saved.metadata).toEqual({keep:true});
    expect(saved.tools.mcp[0].headers).toEqual({Accept:"application/json"});
  });
  it("refuses a clone name that would overwrite an existing profile", () => {
    setAgentDialogState({agents:[{name:"Code"}],activeAgentName:"Code",profiles:{Code:{name:"Code"}}},dialog,host);
    dialog.querySelector<HTMLButtonElement>('[data-clone-agent]')!.click();
    dialog.querySelector<HTMLInputElement>('[name="name"]')!.value="Code";
    dialog.querySelector("form")!.dispatchEvent(new Event("submit",{cancelable:true}));
    expect(host.postMessage).not.toHaveBeenCalled();expect(dialog.textContent).toContain("名称已存在");
  });
  it("discards edits only after confirmation and restores the latest backend profile", () => {
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    setAgentDialogState({agents:[{name:"Code"}],activeAgentName:"Code",profiles:{Code:{name:"Code",description:"saved"}}},dialog,host);
    const description=dialog.querySelector<HTMLInputElement>('[name="description"]')!;
    description.value="draft";description.dispatchEvent(new Event("input",{bubbles:true}));
    dialog.querySelector<HTMLButtonElement>('[data-discard-agent-draft]')!.click();
    expect(description.value).toBe("draft");
    confirm.mockReturnValue(true);
    dialog.querySelector<HTMLButtonElement>('[data-discard-agent-draft]')!.click();
    expect(dialog.querySelector<HTMLInputElement>('[name="description"]')!.value).toBe("saved");
    confirm.mockRestore();
  });
  it("filters navigation without losing a form draft", () => {
    setModelDialogState(models, dialog, host);
    const name = dialog.querySelector<HTMLInputElement>('[name="name"]')!; name.value = "My edits";
    const search = dialog.querySelector<HTMLInputElement>(".profile-search")!;
    search.value = "Review"; search.dispatchEvent(new Event("input"));
    expect(dialog.querySelector<HTMLElement>('[data-model-id="daily"]')!.hidden).toBe(true);
    expect(dialog.querySelector<HTMLElement>('[data-model-id="review"]')!.hidden).toBe(false);
    expect(name.value).toBe("My edits");
    search.value = "missing"; search.dispatchEvent(new Event("input"));
    expect(dialog.querySelector<HTMLElement>(".profile-search-empty")!.hidden).toBe(false);
  });
  it("keeps the current profile disabled after a busy cycle", () => {
    setModelDialogState(models, dialog, host);
    const active = dialog.querySelector<HTMLButtonElement>("[data-set-active-model]")!;
    expect(active.disabled).toBe(true);
    setModelDialogBusy(dialog, true); expect(dialog.querySelector<HTMLInputElement>('[name="name"]')!.disabled).toBe(true);
    setModelDialogBusy(dialog, false); expect(active.disabled).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('[name="name"]')!.disabled).toBe(false);
  });
  it("saves collapsed advanced values and preserves a masked API key", () => {
    setModelDialogState(models, dialog, host);
    expect(dialog.querySelector<HTMLDetailsElement>("details")!.open).toBe(false);
    dialog.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "modelDialogSave", model: expect.objectContaining({ id: "daily", http_headers: '{"X-Client":"iCode"}', chat_options: '{"temperature":0.2}' }) }));
    expect(host.postMessage.mock.calls[0][0].model.api_key).toBeUndefined();
  });
  it("focuses search on open and returns focus with Escape", () => {
    const opener = document.querySelector<HTMLButtonElement>("#opener")!; opener.focus();
    setModelDialogState(models, dialog, host);
    expect(document.activeElement).toBe(dialog.querySelector(".profile-search"));
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dialog.classList.contains("hidden")).toBe(true); expect(document.activeElement).toBe(opener);
  });
  it("keeps agent identity read-only while allowing display-name edits", () => {
    setAgentDialogState({ agents: [{ name: "Code", displayName: "Developer" }], activeAgentName: "Code", profiles: { Code: { name: "Code", tools: ["Read"], instructions: "Keep these instructions" } } }, dialog, host);
    expect(dialog.querySelector<HTMLInputElement>('[name="name"]')!.readOnly).toBe(true);
    expect(dialog.querySelector<HTMLInputElement>('[name="display_name"]')!.readOnly).toBe(false);
  });
  it("searches the agent picker and dispatches the selected profile", () => {
    setInlineDialogState({kind:"agents",title:"选择智能体",subtitle:"",activeAgentName:"Code",agents:[{name:"Code"},{name:"Explore",description:"Read the repository"}]},dialog,host);
    const search=dialog.querySelector<HTMLInputElement>(".profile-search")!;search.value="repository";search.dispatchEvent(new Event("input"));
    expect(dialog.querySelector<HTMLElement>('[data-inline-name="Code"]')!.hidden).toBe(true);
    dialog.querySelector<HTMLButtonElement>('[data-inline-name="Explore"]')!.click();
    expect(host.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type:"inlineDialogAction",action:"switchAgent",name:"Explore" }));
  });
});
