import { bindRuntime } from "../state/runtime";
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { ModelSummary, ProfileSummary } from "../acp/types";
import type { UiLanguage } from "../common/i18n";

type ConfigOption = {
  key: string;
  envKey: string;
  value: string;
};

export interface ManagementState {
  agents: ProfileSummary[];
  models: ModelSummary[];
  configOptions: ConfigOption[];
  activeAgentName: string;
  activeModelProfileId: string;
}

type HostMessage =
  | { type: "state"; state: ManagementState }
  | { type: "busy"; busy: boolean }
  | { type: "notice"; level: "info" | "warning" | "error"; text: string }
  | { type: "activeTab"; tab: ManagementTab };

type ManagementTab = "agents" | "models" | "config" | "mcp";

type WebviewMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "saveAgent"; agent: Record<string, unknown> }
  | { type: "deleteAgent"; name: string }
  | { type: "setActiveAgent"; name: string }
  | { type: "saveModel"; model: Record<string, unknown> }
  | { type: "deleteModel"; id: string }
  | { type: "setActiveModel"; id: string }
  | { type: "openAgentDialog" }
  | { type: "openModelDialog" }
  | { type: "setConfig"; key: string; value: string }
  | { type: "testMcp"; server: Record<string, unknown> };

function managementLabels(language: UiLanguage): Record<string, string> {
  if (language === "zh-CN") {
    return {
      active: "当前",
      activeAgent: "当前智能体",
      activeModel: "当前模型",
      agentNameRequired: "需要填写智能体名称。",
      agentProfile: "智能体配置",
      agentProfiles: "智能体配置",
      agents: "智能体",
      apiKey: "API Key",
      apiStyle: "API 样式",
      applyActiveAgent: "应用当前智能体",
      applyActiveModel: "应用当前模型",
      baseUrl: "接口地址（Base URL）",
      cancel: "取消",
      config: "设置",
      configHelp: "这些设置写入 iCode 用户配置（~/.chrys/.env），会被 TUI 和 ACP 共享；VS Code 扩展设置仍在 Settings 中管理。",
      createAgent: "创建智能体",
      createModelProfile: "创建模型配置",
      defaultModel: "默认",
      delete: "删除",
      deleteAgentConfirm: "删除智能体配置",
      deleteModelConfirm: "删除模型配置",
      description: "描述",
      displayName: "显示名称",
      edit: "编辑",
      editAgent: "编辑智能体",
      instructions: "指令",
      invalidJson: "JSON 无效",
      maxContextTokens: "最大上下文 Token",
      mcpHelp: "粘贴单个 HTTP MCP 服务器配置。ACP 只支持测试 HTTP MCP；stdio 会执行客户端本地程序，因此不会在这里运行。",
      mcpHttpOnly: "MCP 测试只支持 transport: \"http\"。",
      mcpTest: "MCP 测试",
      modelId: "模型 ID",
      modelProfile: "模型配置",
      modelProfiles: "模型配置",
      modelRequired: "需要填写名称和模型 ID。",
      models: "模型",
      name: "名称",
      noAgents: "未找到智能体。",
      noConfig: "暂无可用设置项。",
      noModels: "未配置模型。",
      oneShotMcp: "一次性 MCP 测试",
      openAgentEditor: "打开智能体编辑器",
      openModelEditor: "打开模型编辑器",
      agentEditorHelp: "完整创建、编辑和删除智能体请使用聊天内编辑器；这里保留运行时当前项选择，避免旧表单覆盖完整 profile。",
      modelEditorHelp: "完整创建、编辑和删除模型请使用聊天内编辑器；它支持 TUI 对齐的连接、TLS、代理、请求头和 Chat Options。",
      panelTitle: "iCode 管理",
      provider: "供应商",
      refresh: "刷新",
      save: "保存",
      saveChrysConfig: "保存 iCode 配置",
      saveAgent: "保存智能体",
      saveModel: "保存模型",
      serverJson: "服务器 JSON",
      streamResponses: "流式响应",
      subtitle: "管理 iCode 的运行设置。",
      searchSettings: "搜索设置名称或环境变量",
      noMatchingSettings: "没有匹配的设置",
      supportedConfig: "支持的设置项",
      testConnection: "测试连接",
    };
  }
  return {
    active: "active",
    activeAgent: "Active Agent",
    activeModel: "Active Model",
    agentNameRequired: "Agent name is required.",
    agentProfile: "Agent Profile",
    agentProfiles: "Agent Profiles",
    agents: "Agents",
    apiKey: "API Key",
    apiStyle: "API Style",
    applyActiveAgent: "Apply Active Agent",
    applyActiveModel: "Apply Active Model",
    baseUrl: "Base URL",
    cancel: "Cancel",
    config: "Config",
    configHelp: "These settings write to the iCode user config (~/.chrys/.env) shared by TUI and ACP. VS Code extension settings are still managed in Settings.",
    createAgent: "Create Agent",
    createModelProfile: "Create Model Profile",
    defaultModel: "default",
    delete: "Delete",
    deleteAgentConfirm: "Delete agent profile",
    deleteModelConfirm: "Delete model profile",
    description: "Description",
    displayName: "Display Name",
    edit: "Edit",
    editAgent: "Edit Agent",
    instructions: "Instructions",
    invalidJson: "Invalid JSON",
    maxContextTokens: "Max Context Tokens",
    mcpHelp: "Paste a single HTTP MCP server config. ACP tests HTTP MCP only; stdio would execute client-local programs and is not run here.",
    mcpHttpOnly: "MCP test supports transport: \"http\" only.",
    mcpTest: "MCP Test",
    modelId: "Model ID",
    modelProfile: "Model Profile",
    modelProfiles: "Model Profiles",
    modelRequired: "Name and model ID are required.",
    models: "Models",
    name: "Name",
    noAgents: "No agents found.",
    noConfig: "No config options available.",
    noModels: "No model profiles configured.",
    oneShotMcp: "One-shot MCP Test",
    openAgentEditor: "Open Agent Editor",
    openModelEditor: "Open Model Editor",
    agentEditorHelp: "Use the in-chat editor for full agent create/edit/delete. This page only keeps runtime selection to avoid overwriting full profiles with partial forms.",
    modelEditorHelp: "Use the in-chat editor for full model create/edit/delete. It supports TUI-aligned connection, TLS, proxy, headers, and chat options.",
    panelTitle: "iCode Management",
    provider: "Provider",
    refresh: "Refresh",
    save: "Save",
    saveChrysConfig: "Save iCode Config",
    saveAgent: "Save Agent",
    saveModel: "Save Model",
    serverJson: "Server JSON",
    streamResponses: "Stream responses",
    subtitle: "Manage iCode runtime settings.",
    searchSettings: "Search settings or environment variables",
    noMatchingSettings: "No matching settings",
    supportedConfig: "Supported Config Options",
    testConnection: "Test Connection",
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch] ?? ch);
}

export class ManagementPanel {
  private panel: vscode.WebviewPanel;
  private disposed = false;
  private state: ManagementState | null = null;
  private onRefreshHandler: (() => Promise<void>) | null = null;
  private onSaveAgentHandler: ((agent: Record<string, unknown>) => Promise<void>) | null = null;
  private onDeleteAgentHandler: ((name: string) => Promise<void>) | null = null;
  private onSetActiveAgentHandler: ((name: string) => Promise<void>) | null = null;
  private onSaveModelHandler: ((model: Record<string, unknown>) => Promise<void>) | null = null;
  private onDeleteModelHandler: ((id: string) => Promise<void>) | null = null;
  private onSetActiveModelHandler: ((id: string) => Promise<void>) | null = null;
  private onOpenAgentDialogHandler: (() => Promise<void>) | null = null;
  private onOpenModelDialogHandler: (() => Promise<void>) | null = null;
  private onSetConfigHandler: ((key: string, value: string) => Promise<void>) | null = null;
  private onTestMcpHandler: ((server: Record<string, unknown>) => Promise<void>) | null = null;
  private onDisposeHandler: (() => void) | null = null;

  constructor(context: vscode.ExtensionContext, initialTab: ManagementTab = "agents", language: UiLanguage = "en") {
    const labels = managementLabels(language);
    this.panel = vscode.window.createWebviewPanel("chrys.management", labels.panelTitle, vscode.ViewColumn.Two, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    this.panel.webview.html = this.html(this.panel.webview, initialTab, language);
    this.panel.webview.onDidReceiveMessage(bindRuntime((message: WebviewMessage) => {
      void this.handleMessage(message);
    }));
    this.panel.onDidDispose(bindRuntime(() => {
      this.disposed = true;
      this.onRefreshHandler = null;
      this.onSaveAgentHandler = null;
      this.onDeleteAgentHandler = null;
      this.onSetActiveAgentHandler = null;
      this.onSaveModelHandler = null;
      this.onDeleteModelHandler = null;
      this.onSetActiveModelHandler = null;
      this.onOpenAgentDialogHandler = null;
      this.onOpenModelDialogHandler = null;
      this.onSetConfigHandler = null;
      this.onTestMcpHandler = null;
      this.onDisposeHandler?.();
    }));
    context.subscriptions.push(this.panel);
  }

  dispose(): void {
    if (!this.disposed) this.panel.dispose();
  }

  reveal(): void {
    if (this.disposed) return;
    this.panel.reveal();
  }

  setState(state: ManagementState): void {
    this.state = state;
    this.post({ type: "state", state });
  }

  notice(level: "info" | "warning" | "error", text: string): void {
    this.post({ type: "notice", level, text });
  }

  setBusy(busy: boolean): void {
    this.post({ type: "busy", busy });
  }

  setActiveTab(tab: ManagementTab): void {
    this.post({ type: "activeTab", tab });
  }

  onRefresh(handler: () => Promise<void>): void {
    this.onRefreshHandler = handler;
  }

  onSaveAgent(handler: (agent: Record<string, unknown>) => Promise<void>): void {
    this.onSaveAgentHandler = handler;
  }

  onDeleteAgent(handler: (name: string) => Promise<void>): void {
    this.onDeleteAgentHandler = handler;
  }

  onSetActiveAgent(handler: (name: string) => Promise<void>): void {
    this.onSetActiveAgentHandler = handler;
  }

  onSaveModel(handler: (model: Record<string, unknown>) => Promise<void>): void {
    this.onSaveModelHandler = handler;
  }

  onDeleteModel(handler: (id: string) => Promise<void>): void {
    this.onDeleteModelHandler = handler;
  }

  onSetActiveModel(handler: (id: string) => Promise<void>): void {
    this.onSetActiveModelHandler = handler;
  }

  onOpenAgentDialog(handler: () => Promise<void>): void {
    this.onOpenAgentDialogHandler = handler;
  }

  onOpenModelDialog(handler: () => Promise<void>): void {
    this.onOpenModelDialogHandler = handler;
  }

  onSetConfig(handler: (key: string, value: string) => Promise<void>): void {
    this.onSetConfigHandler = handler;
  }

  onTestMcp(handler: (server: Record<string, unknown>) => Promise<void>): void {
    this.onTestMcpHandler = handler;
  }

  onDispose(handler: () => void): void {
    this.onDisposeHandler = handler;
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (this.disposed) return;
    try {
      this.setBusy(true);
      switch (message.type) {
        case "ready":
          if (this.state) this.setState(this.state);
          await this.onRefreshHandler?.();
          break;
        case "refresh":
          await this.onRefreshHandler?.();
          break;
        case "saveAgent":
          await this.onSaveAgentHandler?.(message.agent);
          await this.onRefreshHandler?.();
          break;
        case "deleteAgent":
          await this.onDeleteAgentHandler?.(message.name);
          await this.onRefreshHandler?.();
          break;
        case "setActiveAgent":
          await this.onSetActiveAgentHandler?.(message.name);
          await this.onRefreshHandler?.();
          break;
        case "saveModel":
          await this.onSaveModelHandler?.(message.model);
          await this.onRefreshHandler?.();
          break;
        case "deleteModel":
          await this.onDeleteModelHandler?.(message.id);
          await this.onRefreshHandler?.();
          break;
        case "setActiveModel":
          await this.onSetActiveModelHandler?.(message.id);
          await this.onRefreshHandler?.();
          break;
        case "openAgentDialog":
          await this.onOpenAgentDialogHandler?.();
          break;
        case "openModelDialog":
          await this.onOpenModelDialogHandler?.();
          break;
        case "setConfig":
          await this.onSetConfigHandler?.(message.key, message.value);
          await this.onRefreshHandler?.();
          break;
        case "testMcp":
          await this.onTestMcpHandler?.(message.server);
          break;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.notice("error", text);
    } finally {
      this.setBusy(false);
    }
  }

  private post(message: HostMessage): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(message);
  }

  private html(webview: vscode.Webview, initialTab: ManagementTab, language: UiLanguage): string {
    const nonce = randomBytes(16).toString("base64");
    const initialTabJson = JSON.stringify(initialTab);
    const labels = managementLabels(language);
    const labelsJson = JSON.stringify(labels);
    return `<!DOCTYPE html>
<html lang="${language === "zh-CN" ? "zh-CN" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none';">
  <title>${escapeHtml(labels.panelTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-foreground, #d4d4d4); background: var(--vscode-editor-background, #1e1e1e); font: 13px var(--vscode-font-family, system-ui); line-height: 1.55; }
    .shell { display: grid; grid-template-columns: 184px minmax(0, 1fr); min-height: 100vh; }
    nav { position: sticky; top: 0; height: 100vh; border-right: 1px solid var(--vscode-panel-border, #333); padding: 28px 12px; background: var(--vscode-sideBar-background, #232323); }
    nav h1 { font-size: 18px; font-weight: 650; margin: 0 12px 25px; }
    .tab { display: block; width: 100%; text-align: left; border: 1px solid transparent; color: inherit; background: transparent; padding: 10px 12px; margin-bottom: 5px; border-radius: 5px; cursor: pointer; }
    .tab:hover { background: var(--vscode-list-hoverBackground, #ffffff08); }
    .tab.active { border-color: var(--vscode-focusBorder, #af87ff); background: var(--vscode-list-inactiveSelectionBackground, #ffffff10); }
    main { min-width: 0; padding: 30px 32px 44px; max-width: 1020px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 25px; padding-bottom: 20px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
    h2 { margin: 0 0 6px; font-size: 23px; font-weight: 650; }
    h3 { margin: 24px 0 9px; font-size: 15px; font-weight: 600; }
    button { color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #675397); border: 1px solid transparent; border-radius: 4px; padding: 7px 12px; cursor: pointer; font: inherit; }
    button.secondary, header button { color: inherit; background: transparent; border-color: var(--vscode-panel-border, #444); }
    button.danger { color: var(--vscode-errorForeground, #f88); background: transparent; border-color: currentColor; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    input, textarea, select { width: 100%; min-width: 0; color: var(--vscode-input-foreground, #ddd); background: var(--vscode-input-background, #303030); border: 1px solid var(--vscode-input-border, #444); padding: 9px 10px; border-radius: 4px; font: inherit; }
    textarea { min-height: 180px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); }
    label { display: grid; gap: 7px; margin: 12px 0; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .card { border: 0; border-bottom: 1px solid var(--vscode-panel-border, #333); padding: 14px 0; margin: 0; background: transparent; overflow-wrap: anywhere; }
    .muted { color: var(--vscode-descriptionForeground, #aaa); font-size: 12px; line-height: 1.6; }
    .config-search { margin: 16px 0 8px; }
    .config-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 12px; }
    .config-row label { margin: 0; }
    .config-row button { margin-bottom: 1px; }
    .config-row .muted { display: block; font-size: 11px; }
    .notice { display: none; padding: 10px 12px; margin-bottom: 15px; border-left: 3px solid var(--vscode-focusBorder, #af87ff); }
    .notice.info { display: block; background: var(--vscode-inputValidation-infoBackground, #294052); }
    .notice.warning { display: block; background: var(--vscode-inputValidation-warningBackground, #493d28); }
    .notice.error { display: block; background: var(--vscode-inputValidation-errorBackground, #492828); }
    .hidden, [hidden] { display: none !important; }
    pre { white-space: pre-wrap; background: var(--vscode-textCodeBlock-background, #252525); padding: 12px; border-radius: 4px; }
    :is(button,input,select,textarea):focus-visible { outline: 2px solid var(--vscode-focusBorder, #af87ff); outline-offset: 2px; }
    @media(max-width: 600px) {
      .shell { display: block; }
      nav { position: static; display: flex; flex-wrap: wrap; gap: 4px; height: auto; padding: 14px 12px; border-right: 0; border-bottom: 1px solid var(--vscode-panel-border, #333); }
      nav h1 { flex-basis: 100%; margin: 0 6px 10px; font-size: 16px; }
      .tab { flex: 1; width: auto; text-align: center; padding: 7px 5px; margin: 0; }
      main { padding: 20px 16px; }
      h2 { font-size: 20px; }
      .config-row { grid-template-columns: minmax(0,1fr); gap: 8px; }
      .config-row button { justify-self: end; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <nav>
      <h1>iCode</h1>
      <button class="tab active" data-tab="agents">${escapeHtml(labels.agents)}</button>
      <button class="tab" data-tab="models">${escapeHtml(labels.models)}</button>
      <button class="tab" data-tab="config">${escapeHtml(labels.config)}</button>
      <button class="tab" data-tab="mcp">${escapeHtml(labels.mcpTest)}</button>
    </nav>
    <main>
      <header>
        <div>
          <h2 id="title">${escapeHtml(labels.agents)}</h2>
          <div class="muted" id="subtitle">${escapeHtml(labels.subtitle)}</div>
        </div>
        <button id="refresh">${escapeHtml(labels.refresh)}</button>
      </header>
      <div id="notice" class="notice"></div>
      <section id="content"></section>
    </main>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const labels = ${labelsJson};
    let state = { agents: [], models: [], configOptions: [], activeAgentName: "", activeModelProfileId: "" };
    let activeTab = ${initialTabJson};
    const content = document.getElementById("content");
    const notice = document.getElementById("notice");
    const title = document.getElementById("title");
    const subtitle = document.getElementById("subtitle");
    document.getElementById("refresh").addEventListener("click", () => post({ type: "refresh" }));
    document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
      render();
    }));
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "state") { state = message.state; render(); }
      if (message.type === "notice") showNotice(message.level, message.text);
      if (message.type === "busy") document.body.style.cursor = message.busy ? "progress" : "";
      if (message.type === "activeTab") { activeTab = message.tab; render(); }
    });
    post({ type: "ready" });
    function post(message) { vscode.postMessage(message); }
    function showNotice(level, text) {
      notice.className = "notice " + level;
      notice.textContent = text;
      clearTimeout(showNotice.timer);
      showNotice.timer = setTimeout(() => { notice.className = "notice"; notice.textContent = ""; }, 5000);
    }
    function render() {
      document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === activeTab));
      title.textContent = tabTitle(activeTab);
      subtitle.textContent = labels.subtitle;
      if (activeTab === "agents") renderAgents();
      if (activeTab === "models") renderModels();
      if (activeTab === "config") renderConfig();
      if (activeTab === "mcp") renderMcp();
    }
    function text(key) { return labels[key] || key; }
    function tabTitle(tab) {
      if (tab === "agents") return labels.agents;
      if (tab === "models") return labels.models;
      if (tab === "config") return labels.config;
      if (tab === "mcp") return labels.mcpTest;
      return tab;
    }
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
    function renderAgents() {
      content.innerHTML = \`
        <h3>\${text("activeAgent")}</h3>
        <label>\${text("agentProfile")}<select id="active-agent">\${state.agents.map((agent) => \`<option value="\${escapeHtml(agent.name)}" \${agent.name === state.activeAgentName ? "selected" : ""}>\${escapeHtml(agent.displayName || agent.name)}</option>\`).join("")}</select></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="set-agent">\${text("applyActiveAgent")}</button>
          <button id="open-agent-editor" class="secondary">\${text("openAgentEditor")}</button>
        </div>
        <p class="muted">\${text("agentEditorHelp")}</p>
        <h3>\${text("agentProfiles")}</h3>
        \${state.agents.map((agent) => \`
          <div class="card">
            <div class="row">
              <div><strong>\${escapeHtml(agent.displayName || agent.name)}</strong> \${agent.name === state.activeAgentName ? \`<span class="muted">(\${text("active")})</span>\` : ''}<br><span class="muted">\${escapeHtml(agent.description || agent.name)}</span></div>
            </div>
          </div>\`).join("") || \`<p class="muted">\${text("noAgents")}</p>\`}\`;
      document.getElementById("set-agent").onclick = () => {
        const name = value("active-agent");
        if (name) post({ type: "setActiveAgent", name });
      };
      document.getElementById("open-agent-editor").onclick = () => post({ type: "openAgentDialog" });
    }
    function renderModels() {
      content.innerHTML = \`
        <h3>\${text("activeModel")}</h3>
        <label>\${text("modelProfile")}<select id="active-model"><option value="">\${text("defaultModel")}</option>\${state.models.map((model) => \`<option value="\${escapeHtml(model.id)}" \${model.id === state.activeModelProfileId ? "selected" : ""}>\${escapeHtml(model.name || model.id)} — \${escapeHtml(model.modelId || "")}</option>\`).join("")}</select></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="set-model">\${text("applyActiveModel")}</button>
          <button id="open-model-editor" class="secondary">\${text("openModelEditor")}</button>
        </div>
        <p class="muted">\${text("modelEditorHelp")}</p>
        <h3>\${text("modelProfiles")}</h3>
        \${state.models.map((model) => \`
          <div class="card row">
            <div><strong>\${escapeHtml(model.name || model.id)}</strong><br><span class="muted">\${escapeHtml(model.provider || "")} \${escapeHtml(model.apiStyle || "")} \${escapeHtml(model.modelId || "")}</span></div>
          </div>\`).join("") || \`<p class="muted">\${text("noModels")}</p>\`}\`;
      document.getElementById("set-model").onclick = () => post({ type: "setActiveModel", id: value("active-model") });
      document.getElementById("open-model-editor").onclick = () => post({ type: "openModelDialog" });
    }
    function renderConfig() {
      content.innerHTML = \`
        <h3>\${text("supportedConfig")}</h3>
        <p class="muted">\${text("configHelp")}</p>
        <input class="config-search" type="search" aria-label="\${text("searchSettings")}" placeholder="\${text("searchSettings")}">
        <p class="muted config-no-match" hidden>\${text("noMatchingSettings")}</p>
        \${state.configOptions.map((option) => \`
          <div class="card config-row">
            <label>\${escapeHtml(option.key)} <span class="muted">\${escapeHtml(option.envKey)}</span><input data-config-key="\${escapeHtml(option.key)}" value="\${escapeHtml(option.value || "")}"></label>
            <button data-save-config="\${escapeHtml(option.key)}">\${text("saveChrysConfig")}</button>
          </div>\`).join("") || \`<p class="muted">\${text("noConfig")}</p>\`}\`;
      content.querySelector(".config-search").addEventListener("input", (event) => {
        const query = event.target.value.trim().toLocaleLowerCase();
        const rows = Array.from(content.querySelectorAll(".config-row"));
        rows.forEach((row) => { row.hidden = !row.querySelector("label").textContent.toLocaleLowerCase().includes(query); });
        content.querySelector(".config-no-match").hidden = rows.some((row) => !row.hidden) || rows.length === 0;
      });
      content.querySelectorAll("[data-save-config]").forEach((button) => button.onclick = () => {
        const key = button.dataset.saveConfig;
        const input = content.querySelector(\`[data-config-key="\${CSS.escape(key)}"]\`);
        post({ type: "setConfig", key, value: input.value });
      });
    }
    function renderMcp() {
      content.innerHTML = \`
        <h3>\${text("oneShotMcp")}</h3>
        <p class="muted">\${text("mcpHelp")}</p>
        <label>\${text("serverJson")}<textarea id="mcp-json">{
  "name": "example",
  "transport": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer token"
  }
}</textarea></label>
        <button id="test-mcp">\${text("testConnection")}</button>\`;
      document.getElementById("test-mcp").onclick = () => {
        try {
          const server = JSON.parse(value("mcp-json"));
          if (!server || typeof server !== "object" || Array.isArray(server) || server.transport !== "http") {
            return showNotice("warning", text("mcpHttpOnly"));
          }
          post({ type: "testMcp", server });
        }
        catch (error) { showNotice("error", text("invalidJson") + ": " + error.message); }
      };
    }
    function value(id) { return document.getElementById(id).value.trim(); }
  </script>
</body>
</html>`;
  }
}
