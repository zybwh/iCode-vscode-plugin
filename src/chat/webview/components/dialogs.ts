import { objectValue, stringField, numberField, boolField } from "../../../common/utils";
import { PROVIDERS } from "../../../common/providers";
import { buildAgentProfileSave, cloneAgentProfile } from "../../agentProfileEdit";
import { agentConfigurationFields, applyAgentConfiguration } from "./agentConfiguration";
import { askUserAnswerFromDraft, createAskUserDraft, toggleAskUserDraftOption, updateAskUserDraftText } from "../../askUserDraft";
import { state } from "../state";
import { el, formatJson, shortSessionId, baseName } from "../helpers";
import type { ChatAgentDialogState, ChatApprovalDialogState, ChatAskUserDialogState, ChatInlineDialogState, ChatModelDialogState, RuntimeDetailsTab, LogTab } from "../../panel";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

function dialogText(en: string, zh: string): string {
  return state.uiLanguage === "zh-CN" ? zh : en;
}

function dialogTimeAgo(value?: string): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (state.uiLanguage !== "zh-CN") {
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "1 day ago";
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months === 1) return "1 month ago";
    if (months < 12) return `${months} months ago`;
    const years = Math.floor(days / 365);
    return years === 1 ? "1 year ago" : `${years} years ago`;
  }
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  const years = Math.floor(days / 365);
  return `${years} 年前`;
}

const dialogReturnFocus = new WeakMap<HTMLElement, HTMLElement>();
function openEditableDialog(dialog: HTMLElement, close: () => void): void {
  const opening = dialog.classList.contains("hidden");
  if (opening && document.activeElement instanceof HTMLElement) dialogReturnFocus.set(dialog, document.activeElement);
  dialog.classList.remove("hidden");
  if (opening) (dialog.querySelector<HTMLElement>(".profile-search") ?? dialog.querySelector<HTMLElement>("button,input"))?.focus();
  dialog.onkeydown = (event) => {
    if (event.key === "Escape" && !dialog.classList.contains("busy")) {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll<HTMLElement>("button,input,select,textarea,summary,[tabindex='0']")].filter((item) => {
      if (item.matches(":disabled") || item.closest("[hidden],.hidden")) return false;
      const closed = item.closest("details:not([open])");
      return !closed || closed.querySelector("summary") === item;
    });
    const first = controls[0]; const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
}
function closeEditableDialog(dialog: HTMLElement): void {
  if (dialog.classList.contains("busy")) return;
  dialog.classList.add("hidden"); dialog.onkeydown = null;
  dialogReturnFocus.get(dialog)?.focus(); dialogReturnFocus.delete(dialog);
}

// Preserve intrinsic disabled states (for example the already-active profile).
const disabledControls = new WeakMap<HTMLElement, boolean>();
function setProfileBusy(dialog: HTMLElement, busy: boolean): void {
  dialog.classList.toggle("busy", busy);
  dialog.setAttribute("aria-busy", String(busy));
  dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>("button,input,select,textarea").forEach((control) => {
    if (busy) {
      if (!disabledControls.has(control)) disabledControls.set(control, control.disabled);
      control.disabled = true;
    } else if (disabledControls.has(control)) {
      control.disabled = disabledControls.get(control)!;
      disabledControls.delete(control);
    }
  });
}

function addListSearch(container: HTMLElement, selector: string, label: string, initial = ""): void {
  const input = el("input", { type: "search", class: "profile-search", placeholder: label, "aria-label": label, value: initial }) as HTMLInputElement;
  const count = el("span", { class: "profile-search-count", role: "status" });
  const empty = el("div", { class: "profile-search-empty", hidden: "" }, dialogText("No matching profiles", "没有匹配的配置"));
  const filter = () => {
    const query = input.value.trim().toLocaleLowerCase();
    const items = [...container.querySelectorAll<HTMLElement>(selector)];
    let visible = 0;
    for (const item of items) {
      item.hidden = !(item.textContent || "").toLocaleLowerCase().includes(query);
      if (!item.hidden) visible += 1;
    }
    count.textContent = `${visible} / ${items.length}`;
    empty.hidden = visible > 0 || items.length === 0;
  };
  input.addEventListener("input", filter);
  container.prepend(el("div", { class: "profile-search-bar" }, input, count));
  container.append(empty);
  filter();
}

// ──────────────────────────────────────────────
// Model dialog
// ──────────────────────────────────────────────

export function openModelDialog(modelDialog: HTMLElement): void {
  openEditableDialog(modelDialog, () => closeModelDialog(modelDialog));
}

export function closeModelDialog(modelDialog: HTMLElement): void {
  closeEditableDialog(modelDialog);
}

export function setModelDialogBusy(modelDialog: HTMLElement, busy: boolean): void {
  setProfileBusy(modelDialog, busy);
}

export function showModelDialogNotice(modelDialog: HTMLElement, level: "info" | "warning" | "error", text: string): void {
  const notice = modelDialog.querySelector<HTMLElement>(".modal-notice")!;
  notice.textContent = text;
  notice.className = `modal-notice ${level}`;
  setTimeout(() => {
    notice.className = "modal-notice hidden";
  }, 3500);
}

export function providerSelect(value: string): HTMLElement {
  const select = el("select", { name: "provider" });
  for (const provider of PROVIDERS) {
    const option = el("option", { value: provider }, provider) as HTMLOptionElement;
    option.selected = provider === value;
    select.appendChild(option);
  }
  return select;
}

export function apiStyleSelect(value: string): HTMLElement {
  const select = el("select", { name: "api_style" });
  for (const apiStyle of ["chat_completions", "responses"]) {
    const option = el("option", { value: apiStyle }, apiStyle) as HTMLOptionElement;
    option.selected = apiStyle === value;
    select.appendChild(option);
  }
  return select;
}

export function checkboxField(name: string, label: string, checked: boolean): HTMLElement {
  const input = el("input", { name, type: "checkbox" }) as HTMLInputElement;
  input.checked = checked;
  return el("label", { class: "modal-check" }, input, label);
}

function jsonStringField(profile: Record<string, unknown> | null, field: string): string {
  const value = profile?.[field];
  if (value === undefined || value === null || value === "") return "";
  return formatJson(value);
}

function modalTextArea(name: string, label: string, value: string, placeholder = ""): HTMLElement {
  return el("label", {}, label, el("textarea", {
    name,
    placeholder,
    rows: "4",
    spellcheck: "false",
  }, value));
}

function parseNumberFormField(
  formData: FormData,
  name: string,
  label: string,
  showNotice: (level: "info" | "warning" | "error", text: string) => void,
): number | undefined | null {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    showNotice("warning", dialogText(`${label} must be a non-negative number.`, `${label} 必须是非负数字。`));
    return null;
  }
  return value;
}

function parseJsonObjectFormField(
  formData: FormData,
  name: string,
  label: string,
  showNotice: (level: "info" | "warning" | "error", text: string) => void,
): string | undefined | null {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      showNotice("warning", dialogText(`${label} must be a JSON object.`, `${label} 必须是 JSON 对象。`));
      return null;
    }
    return JSON.stringify(parsed);
  } catch {
    showNotice("warning", dialogText(`${label} is not valid JSON.`, `${label} 不是合法 JSON。`));
    return null;
  }
}

export function renderModelForm(model: ChatModelDialogState["models"][number] | undefined): HTMLElement {
  const isNew = state.selectedModelId === "__new__";
  const isActive = !isNew && model?.id === state.modelDialogState.activeModelProfileId;
  const profile = isNew ? {} : objectValue(state.modelDialogState.profiles[model?.id ?? ""] ?? null);
  const name = isNew ? "" : stringField(profile, "name") || model?.name || model?.id || "";
  const provider = isNew ? "openai" : stringField(profile, "provider") || model?.provider || "openai";
  const apiStyle = isNew ? "chat_completions" : stringField(profile, "api_style") || String(model?.apiStyle || "") || "chat_completions";
  const modelId = isNew ? "gpt-4.1" : stringField(profile, "model_id") || model?.modelId || "";
  const maxContext = isNew ? "100000" : String(numberField(profile, "max_context_tokens") ?? model?.maxContextTokens ?? 100000);
  const baseUrl = isNew ? "" : stringField(profile, "base_url") || "";
  const apiKey = isNew ? "" : stringField(profile, "api_key") || "";
  const connectTimeout = isNew ? "10" : String(numberField(profile, "http_connect_timeout") ?? 10);
  const readTimeout = isNew ? "300" : String(numberField(profile, "http_read_timeout") ?? 300);
  const maxRetries = isNew ? "2" : String(numberField(profile, "http_max_retries") ?? 2);
  const verifySsl = isNew ? true : boolField(profile, "verify_ssl") ?? true;
  const bypassProxy = isNew ? false : boolField(profile, "bypass_proxy") ?? false;
  const httpHeaders = isNew ? "" : jsonStringField(profile, "http_headers");
  const chatOptions = isNew ? "" : jsonStringField(profile, "chat_options");
  const stream = isNew ? true : boolField(profile, "stream") ?? (model?.stream !== false);
  const vision = isNew ? false : boolField(profile, "vision") ?? (model?.vision === true);

  return el("form", { class: "model-form" },
    el("h3", {}, isNew ? dialogText("Create Model Profile", "创建模型配置") : dialogText("Edit Model Profile", "编辑模型配置")),
    isNew ? el("span", { class: "hidden" }, "") : el("input", { name: "id", type: "hidden", value: model?.id || "" }),
    el("label", {}, dialogText("Name", "名称"), el("input", { name: "name", value: name, placeholder: dialogText("Profile name", "配置名称") })),
    el("div", { class: "modal-grid" },
      el("label", {}, dialogText("Provider", "供应商"), providerSelect(provider)),
      el("label", {}, dialogText("API Style", "API 样式"), apiStyleSelect(apiStyle)),
    ),
    el("div", { class: "modal-grid" },
  el("label", {}, dialogText("Model ID", "模型 ID"), el("input", { name: "model_id", value: modelId, placeholder: "gpt-4.1" })),
      el("label", {}, dialogText("Max Context Tokens", "最大上下文 Token"), el("input", { name: "max_context_tokens", type: "number", value: maxContext })),
    ),
    el("label", {}, dialogText("Base URL", "接口地址（Base URL）"), el("input", { name: "base_url", value: baseUrl })),
    el("label", {}, dialogText("API Key", "API Key"), el("input", {
      name: "api_key",
      type: "password",
      value: apiKey === "***" ? "" : apiKey,
      placeholder: apiKey === "***" ? dialogText("Leave blank to keep existing key", "留空以保留现有 key") : "",
    })),
    el("div", { class: "modal-checks" },
      checkboxField("stream", dialogText("Stream responses", "流式响应"), stream),
      checkboxField("vision", dialogText("Vision capable", "支持视觉"), vision),
    ),
    el("details", { class: "modal-advanced" },
      el("summary", {}, dialogText("Advanced Connection", "高级连接")),
      el("div", { class: "modal-grid" },
        el("label", {}, dialogText("Connect Timeout (s)", "连接超时（秒）"), el("input", { name: "http_connect_timeout", type: "number", min: "0", step: "0.1", value: connectTimeout })),
        el("label", {}, dialogText("Read Timeout (s)", "读取超时（秒）"), el("input", { name: "http_read_timeout", type: "number", min: "0", step: "0.1", value: readTimeout })),
        el("label", {}, dialogText("Max Retries", "最大重试次数"), el("input", { name: "http_max_retries", type: "number", min: "0", step: "1", value: maxRetries })),
      ),
      el("div", { class: "modal-checks" },
        checkboxField("verify_ssl", dialogText("Verify TLS certificates", "校验 TLS 证书"), verifySsl),
        checkboxField("bypass_proxy", dialogText("Bypass proxy", "绕过代理"), bypassProxy),
      ),
      modalTextArea("http_headers", "HTTP Headers", httpHeaders, "{\"X-Example\":\"value\"}"),
      modalTextArea("chat_options", "Chat Options", chatOptions, "{\"temperature\":0.2}"),
    ),
    el("div", { class: "modal-row profile-form-actions" },
      el("button", { class: "modal-button", type: "submit" }, isNew ? dialogText("Create Model", "创建模型") : dialogText("Save Model", "保存模型")),
      isNew ? el("span", { class: "modal-spacer" }, "") : el("button", {
        class: "modal-button secondary",
        type: "button",
        disabled: isActive ? "" : undefined,
        "data-set-active-model": model?.id || "",
      }, isActive ? dialogText("Active", "当前") : dialogText("Set Active", "设为当前")),
      isNew ? el("span", { class: "modal-spacer" }, "") : el("button", { class: "modal-button danger", type: "button", "data-delete-model": model?.id || "" }, dialogText("Delete", "删除")),
    ),
  );
}

export function wireModelDetailActions(modelDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  const showNotice = (level: "info" | "warning" | "error", text: string) => showModelDialogNotice(modelDialog, level, text);

  modelDialog.querySelector<HTMLFormElement>(".model-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    const modelIdVal = String(formData.get("model_id") || "").trim();
    const providerVal = String(formData.get("provider") || "openai");
    const maxContextTokens = Number(formData.get("max_context_tokens") || 0);
    if (!name || !modelIdVal) {
      showNotice("warning", dialogText("Name and Model ID are required.", "需要填写名称和模型 ID。"));
      return;
    }
    const baseUrl = String(formData.get("base_url") || "").trim();
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      showNotice("warning", dialogText("Base URL must start with http:// or https://.", "Base URL 必须以 http:// 或 https:// 开头。"));
      return;
    }
    const connectTimeout = parseNumberFormField(formData, "http_connect_timeout", "Connect Timeout", showNotice);
    const readTimeout = parseNumberFormField(formData, "http_read_timeout", "Read Timeout", showNotice);
    const maxRetries = parseNumberFormField(formData, "http_max_retries", "Max Retries", showNotice);
    const httpHeaders = parseJsonObjectFormField(formData, "http_headers", "HTTP Headers", showNotice);
    const chatOptions = parseJsonObjectFormField(formData, "chat_options", "Chat Options", showNotice);
    if (
      connectTimeout === null
      || readTimeout === null
      || maxRetries === null
      || httpHeaders === null
      || chatOptions === null
    ) {
      return;
    }
    const payload: Record<string, unknown> = {
      name,
      provider: providerVal,
      api_style: String(formData.get("api_style") || "chat_completions"),
      model_id: modelIdVal,
      stream: formData.get("stream") === "on",
      vision: formData.get("vision") === "on",
      verify_ssl: formData.get("verify_ssl") === "on",
      bypass_proxy: formData.get("bypass_proxy") === "on",
      base_url: baseUrl,
      http_headers: httpHeaders ?? "",
      chat_options: chatOptions ?? "",
    };
    const id = String(formData.get("id") || "").trim();
    if (id) payload.id = id;
    if (maxContextTokens > 0) payload.max_context_tokens = maxContextTokens;
    if (connectTimeout !== undefined) payload.http_connect_timeout = connectTimeout;
    if (readTimeout !== undefined) payload.http_read_timeout = readTimeout;
    if (maxRetries !== undefined) payload.http_max_retries = Math.floor(maxRetries);
    const apiKey = String(formData.get("api_key") || "").trim();
    if (apiKey) payload.api_key = apiKey;
    vscode.postMessage({ type: "modelDialogSave", model: payload });
  });
  modelDialog.querySelectorAll<HTMLElement>("[data-set-active-model]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.setActiveModel;
      if (id === undefined) return;
      vscode.postMessage({ type: "modelDialogSetActive", id });
    });
  });
  modelDialog.querySelectorAll<HTMLElement>("[data-delete-model]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deleteModel;
      if (!id) return;
      const confirmed = window.confirm(dialogText(`Delete model profile ${id}?`, `删除模型配置 ${id}？`));
      if (!confirmed) return;
      vscode.postMessage({ type: "modelDialogDelete", id });
    });
  });
}

export function renderModelDialog(modelDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  const list = modelDialog.querySelector(".model-list")!;
  const detail = modelDialog.querySelector(".model-detail")!;
  const filterText = list.querySelector<HTMLInputElement>(".profile-search")?.value || "";
  list.innerHTML = "";
  detail.innerHTML = "";

  const activeModelProfileId = state.modelDialogState.activeModelProfileId || "";
  list.append(
    ...state.modelDialogState.models.map((model) => el("button", {
      class: `model-list-item ${model.id === state.selectedModelId ? "active" : ""}`,
      "data-model-id": model.id,
      "aria-pressed": String(model.id === state.selectedModelId),
    },
    el("span", { class: "model-list-name" }, model.name || model.id,
      ...(model.id === activeModelProfileId ? [el("span", { class: "profile-active-badge" }, dialogText("In use", "使用中"))] : [])),
    el("span", { class: "model-list-meta" }, [
      [model.provider, model.apiStyle, model.modelId].filter(Boolean).join(" ") || model.id,
    ].filter(Boolean).join(" · ")))),
    el("button", { class: "model-list-item create", "data-model-id": "__new__" }, dialogText("+ New model profile", "+ 新建模型配置")),
  );

  addListSearch(list as HTMLElement, ".model-list-item:not(.create)", dialogText("Search models", "搜索模型"), filterText);

  list.querySelectorAll<HTMLElement>("[data-model-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedModelId = button.dataset.modelId || "";
      renderModelDialog(modelDialog, vscode);
    });
  });

  const selected = state.modelDialogState.models.find((model) => model.id === state.selectedModelId);
  if (state.selectedModelId === "" && state.modelDialogState.models.length > 0) {
    state.selectedModelId = activeModelProfileId || state.modelDialogState.models[0]?.id || "";
    renderModelDialog(modelDialog, vscode);
    return;
  }
  if (state.selectedModelId === "" && state.modelDialogState.models.length === 0) {
    detail.append(
      el("h3", {}, dialogText("Model Profiles", "模型配置")),
      el("p", { class: "modal-muted" }, dialogText("No model profiles are configured yet.", "尚未配置模型配置。")),
    );
  } else {
    detail.append(renderModelForm(selected));
  }
  wireModelDetailActions(modelDialog, vscode);
}

export function setModelDialogState(dialogState: ChatModelDialogState, modelDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  state.modelDialogState.models = dialogState.models;
  state.modelDialogState.profiles = dialogState.profiles;
  state.modelDialogState.activeModelProfileId = dialogState.activeModelProfileId;
  if (dialogState.selectedModelId !== undefined) {
    state.selectedModelId = dialogState.selectedModelId;
  } else if (!state.selectedModelId || (state.selectedModelId !== "__new__" && !dialogState.models.some((model) => model.id === state.selectedModelId))) {
    state.selectedModelId = dialogState.activeModelProfileId || dialogState.models[0]?.id || "";
  }
  renderModelDialog(modelDialog, vscode);
  openModelDialog(modelDialog);
}

// ──────────────────────────────────────────────
// Agent dialog
// ──────────────────────────────────────────────

export function openAgentDialog(agentDialog: HTMLElement): void {
  openEditableDialog(agentDialog, () => closeAgentDialog(agentDialog));
}

export function closeAgentDialog(agentDialog: HTMLElement): void {
  closeEditableDialog(agentDialog);
}

export function setAgentDialogBusy(agentDialog: HTMLElement, busy: boolean): void {
  setProfileBusy(agentDialog, busy);
}

export function showAgentDialogNotice(agentDialog: HTMLElement, level: "info" | "warning" | "error", text: string): void {
  const notice = agentDialog.querySelector<HTMLElement>(".modal-notice")!;
  notice.textContent = text;
  notice.className = `modal-notice ${level}`;
  setTimeout(() => {
    notice.className = "modal-notice hidden";
  }, 3500);
}

type AgentDraft = { form: HTMLElement; source: Record<string, unknown>; dirty: boolean; seed?: Record<string, unknown> };
const agentDrafts = new WeakMap<HTMLElement, Map<string, AgentDraft>>();
function draftsFor(dialog: HTMLElement): Map<string, AgentDraft> {
  let drafts = agentDrafts.get(dialog);
  if (!drafts) { drafts = new Map(); agentDrafts.set(dialog, drafts); }
  return drafts;
}
function draftChangedRemotely(name: string, draft: AgentDraft): boolean {
  return name !== "__new__" && JSON.stringify(draft.source) !== JSON.stringify(state.agentDialogState.profiles[name]);
}
function markAgentDraft(dialog: HTMLElement, name: string): void {
  const draft = draftsFor(dialog).get(name);
  if (!draft) return;
  draft.dirty = true;
  dialog.querySelectorAll<HTMLElement>("[data-agent-name]").forEach(button => {
    if (button.dataset.agentName === name && !button.querySelector(".agent-draft-badge")) {
      button.append(el("span", {class:"agent-draft-badge"}, dialogText("Unsaved", "未保存")));
    }
  });
}

function renderAgentForm(agent: ChatAgentDialogState["agents"][number] | undefined, seed?: Record<string, unknown>): HTMLElement {
  const isNew = state.selectedAgentName === "__new__";
  const isActive = !isNew && agent?.name === state.agentDialogState.activeAgentName;
  const isBuiltIn = !isNew && agent?.builtin === true;
  const profile = isNew ? seed ?? {} : objectValue(state.agentDialogState.profiles[agent?.name ?? ""] ?? null);
  const name = stringField(profile, "name") || agent?.name || "";
  const displayName = stringField(profile, "display_name") || agent?.displayName || "";
  const description = stringField(profile, "description") || agent?.description || "";
  const instructions = stringField(profile, "instructions") || stringField(profile, "system_prompt") || "";

  const basicFields = el("div", {class:"agent-guided-fields agent-basic-fields"},
    el("label", {}, dialogText("Name", "名称"), el("input", {
      name: "name",
      value: name,
      placeholder: "my-agent",
      readOnly: isNew ? undefined : "true",
      title: isNew ? undefined : dialogText(
        "Existing profile names cannot be changed safely through iCode ACP v0.22.5.",
        "iCode ACP v0.22.5 无法安全修改已有配置的名称。",
      ),
    })),
    el("label", {}, dialogText("Display Name", "显示名称"), el("input", { name: "display_name", value: displayName, placeholder: "My Agent" })),
    el("label", {}, dialogText("Description", "描述"), el("input", { name: "description", value: description })),
    el("label", {}, dialogText("Instructions", "指令"), el("textarea", { name: "instructions", style: "min-height:120px;resize:vertical;font-family:var(--chrys-font-mono)" }, instructions)),
  );

  return el("form", { class: "model-form" },
    el("h3", {}, isNew ? dialogText("Create Agent Profile", "创建智能体配置") : dialogText("Edit Agent Profile", "编辑智能体配置")),
    isNew ? el("span", { class: "hidden" }, "") : el("input", { name: "original_name", type: "hidden", value: agent?.name || "" }),
    agentConfigurationFields(profile ?? {}, state.uiLanguage === "zh-CN", basicFields),
    el("div", { class: "modal-row profile-form-actions" },
      el("button", { class: "modal-button", type: "submit" }, isNew ? dialogText("Create Agent", "创建智能体") : dialogText("Save Agent", "保存智能体")),
      isNew ? el("span", { class: "modal-spacer" }, "") : el("button", {
        class: "modal-button secondary",
        type: "button",
        disabled: isActive ? "" : undefined,
        "data-set-active-agent": agent?.name || "",
      }, isActive ? dialogText("Active", "当前") : dialogText("Set Active", "设为当前")),
      el("button", {class:"modal-button secondary",type:"button","data-discard-agent-draft":"true"}, dialogText("Discard edits", "放弃修改")),
      ...(!isNew ? [el("button", {class:"modal-button secondary",type:"button","data-clone-agent":"true"}, dialogText("Clone", "复制配置"))] : []),
      isNew ? el("span", { class: "modal-spacer" }, "") : el("button", {
        class: "modal-button danger",
        type: "button",
        title: isBuiltIn ? dialogText(
          "Remove a user override and restore the iCode built-in profile.",
          "移除用户覆盖并恢复 iCode 内置配置。",
        ) : undefined,
        "data-delete-agent": agent?.name || "",
      }, isBuiltIn ? dialogText("Restore Built-in", "恢复内置配置") : dialogText("Delete", "删除")),
    ),
  );
}

function wireAgentDetailActions(agentDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  const showNotice = (level: "info" | "warning" | "error", text: string) => showAgentDialogNotice(agentDialog, level, text);

  const draftName = state.selectedAgentName;
  const form = agentDialog.querySelector<HTMLFormElement>(".model-form");
  form?.addEventListener("input", () => markAgentDraft(agentDialog, draftName));
  form?.addEventListener("change", () => markAgentDraft(agentDialog, draftName));
  form?.addEventListener("agent-section-updated", () => markAgentDraft(agentDialog, draftName));
  form?.querySelector("[data-discard-agent-draft]")?.addEventListener("click", () => {
    if (draftsFor(agentDialog).get(draftName)?.dirty && !window.confirm(dialogText("Discard this profile's unsaved edits?", "放弃此配置尚未保存的修改？"))) return;
    draftsFor(agentDialog).delete(draftName);
    renderAgentDialog(agentDialog, vscode);
  });
  form?.querySelector("[data-clone-agent]")?.addEventListener("click", () => {
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const draft = draftsFor(agentDialog).get(draftName);
    if (!draft) return;
    try {
      if (!state.agentDialogState.profiles[draftName]) throw new Error(dialogText("The complete profile has not loaded. Refresh before cloning.", "完整配置尚未加载，请刷新后再复制。"));
      const data = new FormData(form);
      const source = applyAgentConfiguration({...draft.source, name:draftName, display_name:String(data.get("display_name") ?? ""), description:String(data.get("description") ?? ""), instructions:String(data.get("instructions") ?? "")}, draft.source, data, state.uiLanguage === "zh-CN");
      if (draftsFor(agentDialog).get("__new__")?.dirty && !window.confirm(dialogText("Replace the unsaved new-profile draft with this clone?", "用此副本替换尚未保存的新配置草稿？"))) return;
      const clone = cloneAgentProfile(source, state.agentDialogState.agents.map(agent => agent.name));
      state.selectedAgentName = "__new__";
      const clonedForm = renderAgentForm(undefined, clone.profile);
      clonedForm.prepend(el("p",{class:"agent-clone-notice"},clone.omittedSecrets
        ? dialogText("Clone draft: masked credentials were omitted. Re-enter them before saving.", "复制草稿：已省略脱敏凭据，请在保存前重新填写。")
        : dialogText("Clone draft: edit the name and save to create an independent profile.", "复制草稿：编辑名称并保存，才会创建独立配置。")));
      draftsFor(agentDialog).set("__new__",{form:clonedForm,source:clone.profile,seed:clone.profile,dirty:true});
      renderAgentDialog(agentDialog, vscode);
    } catch (error) { showNotice("error", error instanceof Error ? error.message : String(error)); }
  });

  // Native submit validation runs before the submit event, including hidden tabs.
  agentDialog.querySelector("form")?.addEventListener("invalid", (event) => {
    const control = event.target;
    if (!(control instanceof HTMLElement)) return;
    const section = control.closest<HTMLElement>("[data-section]");
    if (section) agentDialog.querySelector<HTMLButtonElement>(`[data-section-tab="${section.dataset.section}"]`)?.click();
    const details = control.closest("details");
    if (details) details.open = true;
  }, true);

  agentDialog.querySelector<HTMLFormElement>(".model-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.checkValidity()) {
      const invalid = form.querySelector<HTMLElement>(":invalid");
      const section = invalid?.closest<HTMLElement>("[data-section]");
      if (section) agentDialog.querySelector<HTMLButtonElement>(`[data-section-tab="${section.dataset.section}"]`)?.click();
      const details = invalid?.closest("details");
      if (details) details.open = true;
      form.reportValidity();
      return;
    }
    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    if (!name) {
      showNotice("warning", dialogText("Agent name is required.", "需要填写智能体名称。"));
      return;
    }
    const fields = {
      name,
      display_name: String(formData.get("display_name") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      instructions: String(formData.get("instructions") || "").trim(),
    };
    const originalName = String(formData.get("original_name") || "").trim();
    const draft = draftsFor(agentDialog).get(draftName);
    if (draft && draftChangedRemotely(draftName, draft)) {
      showNotice("warning", dialogText("This profile changed outside this editor. Discard the draft to load the latest version before saving.", "此配置已在编辑器外发生变化。请放弃草稿并加载最新版本后再保存。"));
      return;
    }
    if (!originalName && state.agentDialogState.agents.some(agent => agent.name === name)) {
      showNotice("warning", dialogText("That profile name already exists. Choose another name.", "该配置名称已存在，请使用其他名称。"));
      return;
    }
    const existing = originalName ? draft?.source ?? state.agentDialogState.profiles[originalName] : draft?.seed;
    let payload: Record<string, unknown>;
    try {
      payload = buildAgentProfileSave(existing, fields, originalName || undefined);
      if (!originalName) payload.name = name;
    } catch {
      showNotice(
        "error",
        dialogText(
          "The complete agent profile could not be loaded. Refresh the dialog before saving.",
          "未能加载完整的智能体配置。请刷新对话框后再保存。",
        ),
      );
      return;
    }
    try {
      payload = applyAgentConfiguration(payload, existing ?? {}, formData, state.uiLanguage === "zh-CN");
    } catch (error) {
      showNotice("error", error instanceof Error ? error.message : String(error));
      return;
    }
    vscode.postMessage({ type: "agentDialogSave", agent: payload });
  });
  agentDialog.querySelectorAll<HTMLElement>("[data-set-active-agent]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.setActiveAgent;
      if (name === undefined) return;
      vscode.postMessage({ type: "agentDialogSetActive", name });
    });
  });
  agentDialog.querySelectorAll<HTMLElement>("[data-delete-agent]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.deleteAgent;
      if (!name) return;
      const profile = state.agentDialogState.agents.find((agent) => agent.name === name);
      const confirmed = window.confirm(profile?.builtin === true
        ? dialogText(
          `Remove the user override for ${name} and restore the iCode built-in profile?`,
          `移除 ${name} 的用户覆盖并恢复 iCode 内置配置？`,
        )
        : dialogText(`Delete agent profile ${name}?`, `删除智能体配置 ${name}？`));
      if (!confirmed) return;
      vscode.postMessage({ type: "agentDialogDelete", name });
    });
  });
}

function renderAgentDialog(agentDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  const list = agentDialog.querySelector(".model-list")!;
  const detail = agentDialog.querySelector(".model-detail")!;
  const filterText = list.querySelector<HTMLInputElement>(".profile-search")?.value || "";
  list.innerHTML = "";
  detail.innerHTML = "";

  list.append(
    ...state.agentDialogState.agents.map((agent) => el("button", {
      class: `model-list-item ${agent.name === state.selectedAgentName ? "active" : ""}`,
      "data-agent-name": agent.name,
      "aria-pressed": String(agent.name === state.selectedAgentName),
    },
    el("span", { class: "model-list-name" }, agent.displayName || agent.name,
      ...(agent.name === state.agentDialogState.activeAgentName ? [el("span", { class: "profile-active-badge" }, dialogText("In use", "使用中"))] : [])),
    el("span", { class: "model-list-meta" }, agent.description || agent.name))),
    el("button", { class: "model-list-item create", "data-agent-name": "__new__" }, dialogText("+ New agent profile", "+ 新建智能体配置")),
  );

  addListSearch(list as HTMLElement, ".model-list-item:not(.create)", dialogText("Search agents", "搜索智能体"), filterText);

  list.querySelectorAll<HTMLElement>("[data-agent-name]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAgentName = button.dataset.agentName || "";
      renderAgentDialog(agentDialog, vscode);
    });
  });

  const selected = state.agentDialogState.agents.find((agent) => agent.name === state.selectedAgentName);
  if (state.selectedAgentName === "") {
    detail.append(
      el("h3", {}, dialogText("Select an agent profile", "选择智能体配置")),
      el("p", { class: "modal-muted" }, dialogText("Choose an agent from the list or create a new one.", "从列表选择一个智能体，或新建一个配置。")),
    );
  } else {
    const drafts = draftsFor(agentDialog);
    let draft = drafts.get(state.selectedAgentName);
    if (!draft) {
      draft = {form:renderAgentForm(selected), source:state.agentDialogState.profiles[state.selectedAgentName] ?? {}, dirty:false};
      drafts.set(state.selectedAgentName, draft);
    }
    detail.append(draft.form);
    const activeButton = draft.form.querySelector<HTMLButtonElement>("[data-set-active-agent]");
    if (activeButton) {
      const active = state.selectedAgentName === state.agentDialogState.activeAgentName;
      activeButton.textContent = active ? dialogText("Active", "当前") : dialogText("Set Active", "设为当前");
      if (disabledControls.has(activeButton)) disabledControls.set(activeButton, active);
      else activeButton.disabled = active;
    }
    if (!draft.form.dataset.actionsWired) {
      wireAgentDetailActions(agentDialog, vscode);
      draft.form.dataset.actionsWired = "true";
    }
    if (draft.dirty && draftChangedRemotely(state.selectedAgentName, draft)) showAgentDialogNotice(agentDialog,"warning",dialogText("The saved profile changed. Your draft is retained; discard it to load the latest version.", "已保存配置发生变化，当前草稿仍保留；放弃修改可加载最新版本。"));
  }
  for (const [name, draft] of draftsFor(agentDialog)) if (draft.dirty) markAgentDraft(agentDialog, name);
}

export function setAgentDialogState(dialogState: ChatAgentDialogState, agentDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  const drafts = draftsFor(agentDialog);
  if (dialogState.updatedAgentName) {
    drafts.delete(dialogState.updatedAgentName);
    const newDraft = drafts.get("__new__");
    if (newDraft?.form.querySelector<HTMLInputElement>('[name="name"]')?.value.trim() === dialogState.updatedAgentName) drafts.delete("__new__");
    if (dialogState.agents.some(agent => agent.name === dialogState.updatedAgentName)) state.selectedAgentName = dialogState.updatedAgentName;
  }
  for (const [name, draft] of drafts) {
    if (name !== "__new__" && (!draft.dirty || !dialogState.profiles[name])) drafts.delete(name);
  }
  state.agentDialogState.agents = dialogState.agents;
  state.agentDialogState.profiles = dialogState.profiles;
  state.agentDialogState.activeAgentName = dialogState.activeAgentName;
  if (!state.selectedAgentName || (state.selectedAgentName !== "__new__" && !dialogState.agents.some((agent) => agent.name === state.selectedAgentName))) {
    state.selectedAgentName = dialogState.activeAgentName || dialogState.agents[0]?.name || "";
  }
  renderAgentDialog(agentDialog, vscode);
  openAgentDialog(agentDialog);
}

// ──────────────────────────────────────────────
// Inline dialog
// ──────────────────────────────────────────────

export function closeInlineDialog(inlineDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  if (inlineDialog.classList.contains("hidden") || inlineDialog.classList.contains("busy")) return;
  closeEditableDialog(inlineDialog);
  state.inlineDialogState = null;
  vscode.postMessage({ type: "inlineDialogClosed" });
}

export function setInlineDialogBusy(inlineDialog: HTMLElement, busy: boolean): void {
  setProfileBusy(inlineDialog, busy);
}

export function showInlineDialogNotice(inlineDialog: HTMLElement, level: "info" | "warning" | "error", text: string): void {
  const notice = inlineDialog.querySelector<HTMLElement>(".inline-notice")!;
  notice.textContent = text;
  notice.className = `inline-notice ${level}`;
  setTimeout(() => {
    notice.className = "inline-notice hidden";
  }, 3500);
}

export function wireInlineActions(inlineDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  inlineDialog.querySelectorAll<HTMLElement>("[data-inline-action]").forEach((el) => {
    el.addEventListener("click", (event) => {
      // If a nested element has its own data-inline-action, let that one fire instead
      if (event.target instanceof HTMLElement && event.target.closest("[data-inline-action]") !== el) {
        return;
      }
      vscode.postMessage({
        type: "inlineDialogAction",
        action: el.dataset.inlineAction,
        id: el.dataset.inlineId,
        cwd: el.dataset.inlineCwd,
        name: el.dataset.inlineName,
      });
    });
  });
}

export function renderRuntimeDetailsDialog(body: HTMLElement, tabs: RuntimeDetailsTab[], activeTabId?: string): void {
  if (!tabs.length) {
    body.appendChild(el("div", { class: "inline-empty" }, dialogText("No runtime details available.", "暂无运行时详情。")));
    return;
  }
  const tabList = el("div", { class: "runtime-tabs" });
  const content = el("div", { class: "runtime-tab-content" });
  const renderTab = (activeId: string) => {
    tabList.querySelectorAll<HTMLElement>(".runtime-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.runtimeTab === activeId);
    });
    content.innerHTML = "";
    const selected = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
    for (const section of selected.sections) {
      const lines = section.lines.length ? section.lines : [section.empty || dialogText("No entries.", "暂无条目。")];
      content.appendChild(el("section", { class: "runtime-detail-section" },
        el("div", { class: "runtime-detail-title" }, section.title),
        el("pre", { class: "runtime-detail-lines" }, lines.join("\n")),
      ));
    }
  };
  const initialId = activeTabId && tabs.some((candidate) => candidate.id === activeTabId) ? activeTabId : tabs[0]?.id;
  tabList.append(...tabs.map((tab) => {
    const button = el("button", { class: `runtime-tab ${tab.id === initialId ? "active" : ""}`, "data-runtime-tab": tab.id }, tab.label);
    button.addEventListener("click", () => renderTab(tab.id));
    return button;
  }));
  body.append(tabList, content);
  renderTab(initialId || "");
}

export function renderLogsDialog(body: HTMLElement, logTabs: LogTab[]): void {
  if (!logTabs.length) {
    body.appendChild(el("div", { class: "inline-empty" }, dialogText("No logs captured yet.", "尚未捕获日志。")));
    return;
  }
  const tabList = el("div", { class: "runtime-tabs" });
  const content = el("div", { class: "runtime-tab-content" });
  const renderTab = (activeId: string) => {
    tabList.querySelectorAll<HTMLElement>(".runtime-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.logTab === activeId);
    });
    content.innerHTML = "";
    const selected = logTabs.find((tab) => tab.id === activeId) ?? logTabs[0];
    content.appendChild(el("pre", { class: "runtime-detail-lines log-content" }, selected.text || dialogText("No logs.", "暂无日志。")));
  };
  const initialId = logTabs[0]?.id;
  tabList.append(...logTabs.map((tab) => {
    const button = el("button", { class: `runtime-tab ${tab.id === initialId ? "active" : ""}`, "data-log-tab": tab.id }, tab.label);
    button.addEventListener("click", () => renderTab(tab.id));
    return button;
  }));
  body.append(tabList, content);
  renderTab(initialId || "");
}

export function renderInlineDialog(inlineDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  if (!state.inlineDialogState) return;
  inlineDialog.querySelector<HTMLElement>(".tui-modal-title")!.textContent = state.inlineDialogState.title;
  inlineDialog.querySelector<HTMLElement>(".tui-modal-subtitle")!.textContent = state.inlineDialogState.subtitle;
  inlineDialog.querySelector<HTMLElement>("[role=dialog]")?.setAttribute("aria-label", state.inlineDialogState.title);
  inlineDialog.dataset.dialogKind = state.inlineDialogState.kind;
  const body = inlineDialog.querySelector<HTMLElement>(".inline-dialog-body")!;
  body.innerHTML = "";

  if (state.inlineDialogState.kind === "sessions") {
    const headerActions = inlineDialog.querySelector<HTMLElement>(".tui-modal-actions")!;
    const footer = inlineDialog.querySelector<HTMLElement>(".inline-dialog-footer")!;
    const bodyEl = body; // alias for clarity

    // Hide header Close, show footer action bar for sessions
    headerActions.classList.add("hidden");
    footer.classList.remove("hidden");

    const sessionState = state.inlineDialogState;
    let selectedId: string | null = sessionState.sessions.some(session => session.sessionId === inlineDialog.dataset.selectedSessionId)
      ? inlineDialog.dataset.selectedSessionId! : null;

    const updateFooter = () => {
      const hasSelection = selectedId !== null;
      footer.innerHTML = "";
      footer.appendChild(el("div", { class: "inline-action-row" },
        el("button", {
          class: "modal-button primary",
          disabled: hasSelection ? undefined : "",
          "data-inline-footer-action": "resume",
        }, dialogText("Resume", "恢复")),
        el("button", {
          class: "modal-button danger",
          disabled: hasSelection ? undefined : "",
          "data-inline-footer-action": "delete",
        }, dialogText("Delete", "删除")),
        el("button", { class: "modal-button secondary", "data-inline-close": "true" }, dialogText("Close", "关闭")),
      ));
      // Wire footer buttons
      footer.querySelectorAll<HTMLElement>("[data-inline-footer-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const action = btn.dataset.inlineFooterAction;
          const row = bodyEl.querySelector<HTMLElement>(`tr.selected`);
          if (action === "resume" && row) {
            vscode.postMessage({
              type: "inlineDialogAction",
              action: "resumeSession",
              id: row.dataset.inlineId,
              cwd: row.dataset.inlineCwd,
              name: undefined,
            });
          } else if (action === "delete" && row) {
            vscode.postMessage({
              type: "inlineDialogAction",
              action: "deleteSession",
              id: row.dataset.inlineId,
              cwd: row.dataset.inlineCwd,
              name: undefined,
            });
          }
        });
      });
      // Re-wire the Close button in footer
      footer.querySelector<HTMLElement>("[data-inline-close]")?.addEventListener("click", () => {
        closeInlineDialog(inlineDialog, vscode);
      });
    };

    if (!state.inlineDialogState.sessions.length) {
      bodyEl.appendChild(el("div", { class: "inline-empty" }, dialogText("No saved sessions.", "没有已保存会话。")));
      updateFooter();
    } else {
      const table = el("table", { class: "inline-session-table" },
        el("thead", {},
          el("tr", {},
            el("th", {}, dialogText("Session ID", "会话 ID")),
            el("th", {}, dialogText("Profile", "配置")),
            el("th", {}, dialogText("Title", "标题")),
            el("th", {}, dialogText("Last Active", "最近活动")),
            el("th", {}, dialogText("Directory", "目录")),
            el("th", {}, dialogText("Size", "大小")),
          ),
        ),
        el("tbody", {}, ...state.inlineDialogState.sessions.map((session) => {
          const sid = shortSessionId(session.sessionId);
          const profile = String(session._meta?.agentDisplayName || session._meta?.agentProfile || "");
          const title = session.title || sid;
          const lastActive = dialogTimeAgo(session.updatedAt);
          const dir = baseName(session.cwd);
          const size = String(session._meta?.sessionSizeHuman || "");
          return el("tr", {
            class: `inline-session-row-clickable${session.sessionId === selectedId ? " selected" : ""}`,
            tabindex: "0",
            "aria-selected": String(session.sessionId === selectedId),
            "data-session-search": `${session.sessionId} ${title} ${profile} ${session.cwd}`.toLocaleLowerCase(),
            "data-inline-id": session.sessionId,
            "data-inline-cwd": session.cwd,
          },
            el("td", { class: "col-id", title:session.sessionId }, sid),
            el("td", { class: "col-profile" }, profile),
            el("td", { class: "col-title" }, title),
            el("td", { class: "col-time" }, lastActive),
            el("td", { class: "col-dir", title:session.cwd }, dir),
            el("td", { class: "col-size" }, size),
          );
        })),
      );
      const search=el("input",{type:"search",class:"profile-search","aria-label":dialogText("Search sessions","搜索会话"),placeholder:dialogText("Search title, ID, profile or directory","搜索标题、ID、配置或目录")}) as HTMLInputElement;
      search.value=inlineDialog.dataset.sessionFilter ?? "";
      const empty=el("p",{class:"inline-empty"},dialogText("No matching sessions.","没有匹配的会话。"));
      const filter=()=>{
        inlineDialog.dataset.sessionFilter=search.value;
        const query=search.value.trim().toLocaleLowerCase();let visible=0;
        table.querySelectorAll<HTMLElement>("[data-inline-id]").forEach(row=>{
          row.hidden=!row.dataset.sessionSearch?.includes(query);
          if(!row.hidden)visible++;
          if(row.hidden && row.dataset.inlineId===selectedId){selectedId=null;row.classList.remove("selected");row.setAttribute("aria-selected","false");}
        });
        inlineDialog.dataset.selectedSessionId=selectedId ?? "";
        empty.hidden=visible>0;updateFooter();
      };
      search.addEventListener("input",filter);
      bodyEl.append(search,table,empty);filter();

      // Row click to select
      bodyEl.querySelectorAll<HTMLElement>(".inline-session-row-clickable").forEach((row) => {
        row.addEventListener("click", () => {
          bodyEl.querySelectorAll<HTMLElement>(".inline-session-row-clickable").forEach((r) => {r.classList.remove("selected");r.setAttribute("aria-selected","false");});
          if (selectedId === row.dataset.inlineId) {
            selectedId = null;
          } else {
            row.classList.add("selected");row.setAttribute("aria-selected","true");
            selectedId = row.dataset.inlineId || null;
          }
          inlineDialog.dataset.selectedSessionId=selectedId ?? "";
          updateFooter();
        });
        row.addEventListener("keydown",event=>{
          if(event.key===" "){event.preventDefault();row.click();}
          if(event.key==="Enter"){event.preventDefault();row.dispatchEvent(new MouseEvent("dblclick"));}
          if(event.key==="ArrowDown"||event.key==="ArrowUp"){
            event.preventDefault();const rows=Array.from(bodyEl.querySelectorAll<HTMLElement>("[data-inline-id]")).filter(item=>!item.hidden);
            rows[Math.max(0,Math.min(rows.length-1,rows.indexOf(row)+(event.key==="ArrowDown"?1:-1)))]?.focus();
          }
        });
        // Double-click: resume
        row.addEventListener("dblclick", () => {
          vscode.postMessage({
            type: "inlineDialogAction",
            action: "resumeSession",
            id: row.dataset.inlineId,
            cwd: row.dataset.inlineCwd,
            name: undefined,
          });
        });
      });
      updateFooter();
    }

    return;
  }

  // Restore header Close for non-sessions dialogs
  inlineDialog.querySelector<HTMLElement>(".tui-modal-actions")!.classList.remove("hidden");
  inlineDialog.querySelector<HTMLElement>(".inline-dialog-footer")!.classList.add("hidden");

  if (state.inlineDialogState.kind === "agents") {
    const activeAgentName = state.inlineDialogState.activeAgentName;
    if (!state.inlineDialogState.agents.length) {
      body.appendChild(el("div", { class: "inline-empty" }, dialogText("No agent profiles are configured.", "尚未配置智能体。")));
    } else {
      body.append(...state.inlineDialogState.agents.map((agent) => el("button", {
        class: `inline-list-item ${agent.name === activeAgentName ? "active" : ""}`,
        "data-inline-action": "switchAgent",
        "data-inline-name": agent.name,
        "aria-current": agent.name === activeAgentName ? "true" : undefined,
      },
      el("span", { class: "inline-list-title" }, agent.displayName || agent.name,
        ...(agent.name === activeAgentName ? [el("span", { class: "profile-active-badge" }, dialogText("In use", "使用中"))] : [])),
      el("span", { class: "inline-list-meta" }, agent.description || agent.name))));
    }
    addListSearch(body, ".inline-list-item", dialogText("Search agents", "搜索智能体"));
    wireInlineActions(inlineDialog, vscode);
    return;
  }

  if (state.inlineDialogState.kind === "runtimeDetails") {
    renderRuntimeDetailsDialog(body, state.inlineDialogState.tabs, state.inlineDialogState.activeTabId);
    return;
  }

  if (state.inlineDialogState.kind === "logs") {
    renderLogsDialog(body, state.inlineDialogState.logTabs);
    return;
  }

  const pre = el("pre", { class: "inline-pre" }, state.inlineDialogState.body || "");
  body.appendChild(pre);
}

export function setInlineDialogState(dialogState: ChatInlineDialogState, inlineDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  state.inlineDialogState = dialogState;
  renderInlineDialog(inlineDialog, vscode);
  openEditableDialog(inlineDialog, () => closeInlineDialog(inlineDialog, vscode));
}

// ──────────────────────────────────────────────
// Approval dialog
// ──────────────────────────────────────────────

// Repeated snapshots of the same pending request must not erase the user's work.
const pendingDialogSnapshots = new WeakMap<HTMLElement, string>();
function retainPendingDialog(dialog: HTMLElement, snapshot: unknown): boolean {
  const signature = JSON.stringify(snapshot);
  if (pendingDialogSnapshots.get(dialog) === signature) {
    dialog.classList.remove("hidden");
    return true;
  }
  pendingDialogSnapshots.set(dialog, signature);
  return false;
}

export function setApprovalDialogState(dialogState: ChatApprovalDialogState | null, approvalDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  if (!dialogState) {
    pendingDialogSnapshots.delete(approvalDialog);
    approvalDialog.classList.add("hidden");
    approvalDialog.onkeydown = null;
    return;
  }
  if (retainPendingDialog(approvalDialog, dialogState)) return;
  approvalDialog.querySelector<HTMLElement>(".tui-modal-title")!.textContent = dialogState.title;
  approvalDialog.querySelector<HTMLElement>(".tui-modal-subtitle")!.textContent = dialogState.subtitle;
  const body = approvalDialog.querySelector<HTMLElement>(".approval-dialog-body")!;
  const actions = approvalDialog.querySelector<HTMLElement>(".approval-dialog-actions")!;
  body.innerHTML = "";
  actions.innerHTML = "";
  let responded = false;
  approvalDialog.tabIndex = -1;
  vscode.postMessage({
    type: "frontendDebugEvent",
    kind: "ApprovalDialogShown",
    detail: `${dialogState.requestId}; options=${dialogState.options.length}; preview=${dialogState.preview ? "yes" : "no"}`,
  });
  if (dialogState.preview) {
    body.appendChild(renderApprovalPreview(dialogState.preview, vscode));
  }
  body.appendChild(el("pre", { class: "approval-detail" }, dialogState.detail));
  if (dialogState.reasonEnabled) {
    body.appendChild(el("textarea", { class: "approval-reason", placeholder: approvalDialogText().reasonPlaceholder }));
  }
  actions.append(...dialogState.options.map((option) => el("button", {
    class: `modal-button ${option.kind.startsWith("reject") ? "danger" : ""}`,
    "data-approval-option-id": option.optionId,
    "data-approval-option-kind": option.kind,
  }, option.name)));
  actions.appendChild(el("button", { class: "modal-button secondary", "data-approval-cancel": "true" }, dialogText("Cancel", "取消")));
  const primaryOptionId = dialogState.options.find((option) => option.kind === "allow_once")?.optionId ?? dialogState.options[0]?.optionId;
  const respond = (optionId?: string, source = "button"): void => {
    if (responded) return;
    responded = true;
    actions.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = true;
    });
    const reasonEl = approvalDialog.querySelector<HTMLTextAreaElement>(".approval-reason");
    if (reasonEl) reasonEl.disabled = true;
    vscode.postMessage({
      type: "frontendDebugEvent",
      kind: "ApprovalDialogSubmitted",
      detail: optionId ? `${source}: ${optionId}` : `${source}: cancelled`,
    });
    vscode.postMessage({ type: "approvalDialogDecision", optionId, reason: reasonEl?.value || undefined });
    setApprovalDialogState(null, approvalDialog, vscode);
  };
  actions.querySelectorAll<HTMLElement>("[data-approval-option-id]").forEach((button) => {
    button.addEventListener("click", () => {
      respond(button.dataset.approvalOptionId, "button");
    });
  });
  actions.querySelector<HTMLElement>("[data-approval-cancel]")?.addEventListener("click", () => {
    respond(undefined, "cancel");
  });
  approvalDialog.onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      respond(undefined, "escape");
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && primaryOptionId) {
      event.preventDefault();
      respond(primaryOptionId, "keyboard");
    }
  };
  approvalDialog.classList.remove("hidden");
  window.setTimeout(() => {
    actions.querySelector<HTMLButtonElement>("[data-approval-option-id]")?.focus();
  }, 0);
}

export function setAskUserDialogState(dialogState: ChatAskUserDialogState | null, askUserDialog: HTMLElement, vscode: { postMessage(msg: unknown): void }): void {
  if (!dialogState) {
    pendingDialogSnapshots.delete(askUserDialog);
    askUserDialog.classList.add("hidden");
    askUserDialog.onkeydown = null;
    return;
  }
  if (retainPendingDialog(askUserDialog, dialogState)) return;
  askUserDialog.querySelector<HTMLElement>(".tui-modal-title")!.textContent = dialogState.title;
  askUserDialog.querySelector<HTMLElement>(".tui-modal-subtitle")!.textContent = dialogState.subtitle;
  const tabs = askUserDialog.querySelector<HTMLElement>(".askuser-tabs")!;
  const question = askUserDialog.querySelector<HTMLElement>(".askuser-question")!;
  const options = askUserDialog.querySelector<HTMLElement>(".askuser-options")!;
  const textarea = askUserDialog.querySelector<HTMLTextAreaElement>(".askuser-response")!;
  const submit = askUserDialog.querySelector<HTMLButtonElement>(".askuser-submit")!;
  const cancel = askUserDialog.querySelector<HTMLButtonElement>(".askuser-cancel")!;
  const previous = askUserDialog.querySelector<HTMLButtonElement>(".askuser-previous")!;
  const next = askUserDialog.querySelector<HTMLButtonElement>(".askuser-next")!;
  const drafts = dialogState.questions.map(() => createAskUserDraft());
  let activeIndex = 0;
  let reviewing = false;
  textarea.value = "";
  textarea.disabled = false;
  submit.textContent = dialogState.reviewLabel;
  cancel.textContent = dialogText("Cancel", "取消");
  previous.textContent = dialogState.previousLabel;
  next.textContent = dialogState.nextLabel;
  submit.disabled = false;
  cancel.disabled = false;
  let responded = false;
  vscode.postMessage({ type: "frontendDebugEvent", kind: "AskUserDialogShown", detail: dialogState.requestId });

  const saveText = (): void => {
    const draft = drafts[activeIndex];
    updateAskUserDraftText(draft, textarea.value);
  };

  const answers = () => drafts.map(askUserAnswerFromDraft);

  const respond = (cancelled: boolean, source: "dialog" | "cancel" | "keyboard"): void => {
    if (responded) return;
    saveText();
    responded = true;
    submit.disabled = true;
    cancel.disabled = true;
    previous.disabled = true;
    next.disabled = true;
    textarea.disabled = true;
    options.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = true;
    });
    vscode.postMessage({
      type: "askUserDialogResponse",
      requestId: dialogState.requestId,
      answers: cancelled ? [] : answers(),
      cancelled,
      source,
    });
    setAskUserDialogState(null, askUserDialog, vscode);
  };

  const showQuestion = (index: number, saveCurrent = true): void => {
    if (saveCurrent) saveText();
    reviewing = false;
    activeIndex = Math.max(0, Math.min(index, dialogState.questions.length - 1));
    const current = dialogState.questions[activeIndex];
    const draft = drafts[activeIndex];
    const currentOptions = (current.options ?? []).filter((option) => option.label.trim());
    question.replaceChildren(
      current.header ? el("div", { class: "askuser-header" }, current.header) : "",
      el("div", { class: "askuser-question-text" }, current.question),
      current.multiSelect ? el("div", { class: "askuser-mode" }, dialogText("Select one or more", "可多选")) : "",
    );
    options.replaceChildren(...currentOptions.map((option) => {
      const selected = draft.values.includes(option.label);
      const button = el("button", {
        class: `askuser-option ${selected ? "selected" : ""}`,
        "aria-pressed": selected ? "true" : "false",
      },
      el("span", { class: "askuser-option-label" }, option.label),
      option.description ? el("span", { class: "askuser-option-description" }, option.description) : "",
      );
      button.addEventListener("click", () => {
        saveText();
        toggleAskUserDraftOption(draft, option.label, current.multiSelect === true);
        showQuestion(activeIndex, false);
      });
      return button;
    }));
    options.classList.remove("hidden");
    textarea.classList.remove("hidden");
    textarea.value = draft.values.length ? draft.note : draft.text;
    textarea.placeholder = draft.values.length ? dialogState.notePlaceholder : dialogState.responsePlaceholder;
    tabs.classList.toggle("hidden", dialogState.questions.length <= 1);
    tabs.querySelectorAll<HTMLButtonElement>("button").forEach((button, tabIndex) => {
      button.classList.toggle("active", tabIndex === activeIndex);
      button.setAttribute("aria-selected", tabIndex === activeIndex ? "true" : "false");
    });
    previous.disabled = activeIndex === 0;
    next.disabled = activeIndex === dialogState.questions.length - 1;
    previous.textContent = dialogState.previousLabel;
    submit.textContent = dialogState.reviewLabel;
    next.classList.toggle("hidden", dialogState.questions.length <= 1);
    previous.classList.toggle("hidden", dialogState.questions.length <= 1);
  };

  const showReview = (): void => {
    saveText();
    reviewing = true;
    tabs.classList.add("hidden");
    options.replaceChildren();
    options.classList.add("hidden");
    textarea.classList.add("hidden");
    question.replaceChildren(
      el("div", { class: "askuser-review-title" }, dialogState.reviewTitle),
      el("div", { class: "askuser-review" }, ...dialogState.questions.map((item, index) => {
        const answer = askUserAnswerFromDraft(drafts[index]);
        const answerText = answer.values.length ? answer.values.join(", ") : dialogState.unansweredLabel;
        return el("section", { class: "askuser-review-item" },
          el("div", { class: "askuser-review-header" }, item.header || `${index + 1}`),
          el("div", { class: "askuser-review-question" }, item.question),
          el("div", { class: `askuser-review-answer ${answer.values.length ? "" : "unanswered"}` }, answerText),
          answer.note ? el("div", { class: "askuser-review-note" }, answer.note) : "",
        );
      })),
    );
    previous.disabled = false;
    previous.classList.remove("hidden");
    previous.textContent = dialogState.editLabel;
    next.classList.add("hidden");
    submit.textContent = dialogState.submitLabel;
    submit.focus();
  };

  tabs.replaceChildren(...dialogState.questions.map((item, index) => {
    const label = item.header || `${index + 1}`;
    const button = el("button", {
      class: "askuser-tab",
      role: "tab",
      title: item.question,
    }, label);
    button.addEventListener("click", () => showQuestion(index));
    return button;
  }));
  tabs.classList.toggle("hidden", dialogState.questions.length <= 1);
  textarea.oninput = () => {
    saveText();
  };
  textarea.onkeydown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      showReview();
    }
  };
  submit.onclick = () => reviewing ? respond(false, "dialog") : showReview();
  cancel.onclick = () => respond(true, "cancel");
  previous.onclick = () => showQuestion(reviewing ? activeIndex : activeIndex - 1);
  next.onclick = () => showQuestion(activeIndex + 1);
  askUserDialog.onkeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      respond(true, "cancel");
      return;
    }
    if (reviewing && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      respond(false, "keyboard");
    }
  };

  showQuestion(0, false);

  askUserDialog.classList.remove("hidden");
  window.setTimeout(() => {
    if ((dialogState.questions[0]?.options?.length ?? 0) > 0) {
      askUserDialog.querySelector<HTMLButtonElement>(".askuser-option")?.focus();
    } else {
      textarea.focus();
    }
  }, 0);
}

function renderApprovalPreview(
  preview: NonNullable<ChatApprovalDialogState["preview"]>,
  vscode: { postMessage(msg: unknown): void },
): HTMLElement {
  const copy = approvalDialogText();
  const button = el("button", { class: "modal-button secondary approval-preview-open" }, copy.openDiff);
  button.addEventListener("click", () => {
    vscode.postMessage({ type: "frontendDebugEvent", kind: "ApprovalPreviewOpened", detail: preview.label });
    vscode.postMessage({
      type: "openApprovalPreviewDiff",
      label: preview.label,
      before: preview.before,
      after: preview.after,
    });
  });
  return el("section", { class: "approval-preview" },
    el("div", { class: "approval-preview-header" },
      el("div", { class: "approval-preview-heading" },
        el("div", { class: "approval-preview-title" }, preview.label),
        button,
      ),
      preview.subtitle ? el("div", { class: "approval-preview-subtitle" }, preview.subtitle) : "",
    ),
    el("div", { class: "approval-preview-grid" },
      el("div", { class: "approval-preview-pane" },
        el("div", { class: "approval-preview-pane-title" }, copy.before),
        el("pre", { class: "approval-preview-code before" }, boundedPreviewText(preview.before)),
      ),
      el("div", { class: "approval-preview-pane" },
        el("div", { class: "approval-preview-pane-title" }, copy.after),
        el("pre", { class: "approval-preview-code after" }, boundedPreviewText(preview.after)),
      ),
    ),
  );
}

function approvalDialogText(): { openDiff: string; before: string; after: string; reasonPlaceholder: string } {
  return state.uiLanguage === "zh-CN"
    ? {
        openDiff: "打开差异",
        before: "修改前",
        after: "修改后",
        reasonPlaceholder: "审批理由（可选，会进入诊断信息）...",
      }
    : {
        openDiff: "Open Diff",
        before: "Before",
        after: "After",
        reasonPlaceholder: "Reason (optional, included in diagnostics)...",
      };
}

function boundedPreviewText(text: string): string {
  const max = 12_000;
  return text.length > max ? `${text.slice(0, max)}\n... (${text.length} total chars)` : text;
}
