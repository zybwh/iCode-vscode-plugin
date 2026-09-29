// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatPanelState, HostMessage } from "../chat/panel";
import { ChatTranscript } from "../chat/transcript";

import { companionFixture } from "./fixtures/companion";

const sent: Array<Record<string, unknown>> = [];
const readyState: ChatPanelState = {
  agentName: "Code", modelName: "Test model", sessionId: "", sessionState: "idle",
  uiLanguage: "zh-CN", uiTheme: "chrys", chrysCliVersion: "0.22.5",
  connectionState: "ready", workspacePath: "/workspace/project", planEntries: [],
};
function host(message: HostMessage) { window.dispatchEvent(new MessageEvent("message", { data: message })); }
function update(state: Partial<ChatPanelState> = {}) { host({ type: "setState", state: { ...readyState, ...state } }); }
function button(selector: string) { const element = document.querySelector<HTMLButtonElement>(selector); expect(element).not.toBeNull(); return element!; }

describe("chat webview interactions", () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app" data-ui-language="zh-CN"></div>';
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1100 });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("acquireVsCodeApi", () => ({
      getState: () => ({}), setState: vi.fn(),
      postMessage: (message: Record<string, unknown>) => { sent.push(message); if (message.type === "webviewReady") {
        update({ connectionState: "initializing" });
        host({ type: "appendMessage", message: { id: "restored-first", kind: "user", text: "恢复的第一条消息", timestamp: 1 } });
      } },
    }));
    await import("../chat/webview/app");
  });
  beforeEach(() => { expect(document.body.textContent).not.toContain("NaN"); host({ type: "clearMessages" }); update(); sent.length = 0; });
  afterAll(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("defaults to iCode and switches welcome branding without changing backend identity", () => {
    expect(document.querySelector(".welcome-logo")?.textContent).toBe("iCode");
    expect(document.querySelector(".welcome-mark")?.textContent).toBe("iC");
    button(".welcome-brand").click();
    expect(sent).toContainEqual({ type: "command", command: "pickBrand" });
    update({ uiBrand: "chrys" });
    expect(document.querySelector(".welcome-logo")?.textContent).toBe("iCode");
    expect(document.querySelector(".welcome-mark")?.textContent).toBe("C");
    expect(document.querySelector(".tui-title")?.textContent).toBe("iCode CLI v0.22.5");
    host({ type: "clearMessages" });
    expect(document.querySelector(".welcome-logo")?.textContent).toBe("iCode");
  });

  it("shows startup progress and locks sending until ready", () => {
    update({ connectionState: "initializing", connectionDetail: "/workspace/project" });
    expect(document.body.textContent).toContain("正在启动 iCode");
    expect(button(".send-btn").disabled).toBe(true);
    update();
    expect(document.body.textContent).toContain("/workspace/project");
    expect(document.body.textContent).not.toContain("iCode v0.0.9");
  });

  it("renders a restored transcript and continues updating its existing message", () => {
    let visible = true;
    const view = {
      appendMessage: (message: Parameters<ChatTranscript["appendMessage"]>[0]) => host({ type: "appendMessage", message }),
      updateMessage: (messageId: string, patch: Parameters<ChatTranscript["updateMessage"]>[1]) => host({ type: "updateMessage", messageId, patch }),
      updateMessageTextOnly: (messageId: string, text: string) => host({ type: "updateMessageTextOnly", messageId, text }),
      removeMessage: (messageId: string) => host({ type: "removeMessage", messageId }),
      clearMessages: () => host({ type: "clearMessages" }),
    };
    const transcript = new ChatTranscript(() => visible ? view : null);
    transcript.appendMessage({ id: "stream", kind: "agent", text: "关闭之前", timestamp: 1 });
    visible = false;
    view.clearMessages();
    transcript.updateMessageTextOnly("stream", "关闭之后收到的正文");
    transcript.appendMessage({ id: "removed", kind: "user", text: "已撤销的回显", timestamp: 2 });
    transcript.removeMessage("removed");
    visible = true;
    for (const message of transcript.messages) view.appendMessage(message);
    transcript.updateMessageTextOnly("stream", "关闭之后收到的正文，继续生成");
    expect(document.querySelectorAll('[data-copy-message-id="stream"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("关闭之后收到的正文，继续生成");
    expect(document.body.textContent).not.toContain("已撤销的回显");
  });

  it.each(["initializing", "error", "disconnected"] as const)("keeps %s visible after an earlier agent-ready timer expires", (connectionState) => {
    const agentLifecycle = { status: "ready" as const, updatedAt: Date.now() };
    update({ agentLifecycle });
    vi.advanceTimersByTime(1000);
    update({ agentLifecycle, connectionState });
    vi.advanceTimersByTime(4000);
    expect(document.querySelector(".session-run-indicator")!.classList.contains("hidden")).toBe(false);
  });

  it("opens searchable history with Ctrl+R without changing or submitting the draft", () => {
    update();
    const input = document.querySelector<HTMLTextAreaElement>("textarea.input-field")!;
    input.value = "unfinished draft";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(sent).toContainEqual(expect.objectContaining({ type: "command", command: "showPromptHistory" }));
    expect(input.value).toBe("unfinished draft");
    expect(sent.some(message => message.type === "sendMessage")).toBe(false);
  });

  it("routes /rename and /prompts locally without sending them to the model", () => {
    update();
    const input = document.querySelector<HTMLTextAreaElement>("textarea.input-field")!;
    for (const [text, command] of [["/rename Task A", "renameSession"], ["/prompts", "showPromptHistory"]]) {
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(sent).toContainEqual(expect.objectContaining({ type: "command", command }));
    }
    expect(sent.some(message => message.type === "sendMessage")).toBe(false);
  });

  it("sends the original prompt after connection becomes ready", () => {
    update();
    const input = document.querySelector<HTMLTextAreaElement>("textarea.input-field")!;
    input.value = "保留原样：\n第二行 <agent>";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(sent).toContainEqual(expect.objectContaining({ type: "sendMessage", text: "保留原样：\n第二行 <agent>" }));
  });

  it("can create and open other sessions while a turn is running", () => {
    update({ sessionId: "running-session", sessionState: "running" });
    button(".new-btn").click();
    expect(sent).toContainEqual(expect.objectContaining({ type: "command", command: "newSession" }));
    button('[data-side-tab="sessions"]').click();
    host({ type: "sessionsSidebarState", state: { status: "ready", sessions: [{ sessionId: "other-session", cwd: "/workspace", title: "Other" }] } });
    button('[data-sessions-action="resumeSession"]').click();
    expect(sent).toContainEqual(expect.objectContaining({ type: "sessionsSidebarAction", action: "resumeSession", id: "other-session" }));
  });

  it("loads sessions in the dashboard and sends resume actions", () => {
    host({ type: "sessionsSidebarState", state: { status: "idle", sessions: [] } });
    button('[data-side-tab="messages"]').click();
    button('[data-side-tab="sessions"]').click();
    expect(sent).toContainEqual({ type: "sessionsSidebarRefresh" });
    host({ type: "sessionsSidebarState", state: { status: "ready", sessions: [{ sessionId: "saved-1", cwd: "/workspace/project", title: "修复工作区" }] } });
    expect(document.body.textContent).toContain("修复工作区");
    button('[data-sessions-action="resumeSession"]').click();
    expect(sent).toContainEqual(expect.objectContaining({ type: "sessionsSidebarAction", action: "resumeSession", id: "saved-1" }));
  });

  it("opens a narrow-screen drawer and closes it with Escape", () => {
    Object.defineProperty(window, "innerWidth", { value: 600 });
    window.dispatchEvent(new Event("resize"));
    const sidebar = document.querySelector<HTMLElement>(".sidebar-panel")!;
    expect(sidebar.classList.contains("hidden")).toBe(true);
    button(".sidebar-toggle").click();
    expect(sidebar.classList.contains("hidden")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(sidebar.classList.contains("hidden")).toBe(true);
  });

  it("sends a real pet command with its argument from the Buddy tab", () => {
    update({ companion: companionFixture() });
    button('[data-side-tab="companion"]').click();
    button('.companion-stage').click();
    expect(sent.filter((message) => message.type === "command")).toEqual([{ type: "command", command: "companionCommand", arg: "pet" }]);
  });

  it("renders and updates a compaction activity without duplicating it", () => {
    host({ type: "appendMessage", message: { id: "compaction-1", kind: "activity", text: "", timestamp: 1, activityType: "compaction", activityStatus: "running" } });
    host({ type: "updateMessage", messageId: "compaction-1", patch: { activityStatus: "failed", activityDetail: "summary failed" } });
    expect(document.querySelectorAll(".activity-card")).toHaveLength(1);
    expect(document.querySelector(".activity-card")?.textContent).toContain("对话压缩失败");
    expect(document.querySelector(".activity-card details")?.hasAttribute("open")).toBe(true);
  });
});
