// @vitest-environment jsdom
// Behavior cases adapted from iCode bb45692 tests/app/tui (see tests/README.md).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostMessage, ChatPanelState } from "../chat/panel";
import type { ChatMessage } from "../chat/provider";
import { renderMarkdown } from "../chat/webview/renderer";

vi.mock("../chat/webview/renderer", async importOriginal => {
  const actual = await importOriginal<typeof import("../chat/webview/renderer")>();
  return { ...actual, renderMarkdown: vi.fn(actual.renderMarkdown) };
});
const sent: Record<string, unknown>[] = [];
const clipboard = vi.fn(async (_text: string) => {});
const frames: FrameRequestCallback[] = [];
const ready: ChatPanelState = {
  agentName: "Code", modelName: "Fixture", sessionId: "s1", sessionState: "idle",
  uiLanguage: "en", uiTheme: "chrys", connectionState: "ready", workspacePath: "/workspace", planEntries: [],
};
function host(message: HostMessage) { window.dispatchEvent(new MessageEvent("message", { data: message })); }
function input() { return document.querySelector<HTMLTextAreaElement>("textarea")!; }
function type(text: string) { input().value = text; input().dispatchEvent(new Event("input", { bubbles: true })); }
function append(id: string, kind: ChatMessage["kind"], text = "", extra: Partial<ChatMessage> = {}) {
  host({ type: "appendMessage", message: { id, kind, text, timestamp: 1000, ...extra } });
}
function tool(id: string) {
  append(id, "tool_call", "", { toolCallId: id, toolName: "bash", toolKind: "execute", toolStatus: "in_progress", toolInput: { command: `echo ${id}` } });
}
function card(id: string) { return document.querySelector<HTMLElement>(`[data-copy-message-id="${id}"]`)!; }
function copy(id: string) { card(id).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); }
function flushFrame() { const batch = frames.splice(0); for (const callback of batch) callback(0); }
function groups() { return [...document.querySelectorAll(".tool-group")].map(group => [...group.querySelectorAll<HTMLElement>("[data-copy-message-id]")].map(card => card.dataset.copyMessageId)); }

describe("TUI-derived webview behavior", () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
    vi.stubGlobal("acquireVsCodeApi", () => ({ getState: () => ({}), setState: vi.fn(), postMessage: (message: Record<string, unknown>) => sent.push(message) }));
    await import("../chat/webview/app");
  });
  beforeEach(() => {
    host({ type: "clearMessages" }); host({ type: "setState", state: ready }); host({ type: "setComposer", text: "" });
    flushFrame(); flushFrame(); clipboard.mockClear(); vi.mocked(renderMarkdown).mockClear(); sent.length = 0;
    window.getSelection()?.removeAllRanges();
  });
  afterAll(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each(["下一条消息", "  \n ", "rejected prompt"])("a delayed restore preserves the newer draft %j and its caret", text => {
    type(text); input().setSelectionRange(1, 1);
    host({ type: "setComposer", text: "rejected prompt", restore: true });
    expect(input().value).toBe(text); expect(input().selectionStart).toBe(1);
    expect(sent.at(-1)).toEqual({ type: "composerDraft", text });
  });
  it("restores into an empty composer and unlocks a rejected queued injection", () => {
    host({ type: "setComposer", text: "rejected", restore: true }); expect(input().value).toBe("rejected");
    host({ type: "setState", state: { ...ready, sessionState: "running" } });
    document.querySelector<HTMLButtonElement>(".send-btn")!.click(); expect(input().disabled).toBe(true);
    host({ type: "setComposer", text: "rejected", restore: true });
    expect(input().disabled).toBe(false); expect(input().value).toBe("rejected");
  });
  it("restoration leaves an empty IME composition and attachment draft untouched", () => {
    input().dispatchEvent(new CompositionEvent("compositionstart"));
    host({ type: "setComposer", text: "old prompt", restore: true });
    expect(input().value).toBe("");
    input().dispatchEvent(new CompositionEvent("compositionend"));
    host({ type: "addTextAttachment", attachment: { id: "selection", label: "Selected code", text: "source" } });
    host({ type: "setComposer", text: "old prompt", restore: true });
    expect(input().value).toBe("");
    expect(document.querySelector('[data-remove-context="0"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-remove-context="0"]')!.click();
  });
  it("same-text composer updates preserve selection and IME Enter does not submit", () => {
    type("你好"); input().setSelectionRange(0, 1);
    host({ type: "setComposer", text: "你好" }); expect(input().selectionEnd).toBe(1);
    input().dispatchEvent(new CompositionEvent("compositionstart"));
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
    expect(sent.some(message => message.type === "sendMessage")).toBe(false);
    input().dispatchEvent(new CompositionEvent("compositionend"));
  });
  it("late results finish their original group while the new group keeps running", () => {
    tool("old"); append("boundary", "agent", "Next step", { isIntermediate: true }); tool("current");
    host({ type: "updateMessage", messageId: "old", patch: { toolStatus: "completed", toolOutput: "old result" } });
    expect(groups()).toEqual([["old"], ["current"]]);
    expect(card("old").textContent).toContain("old result"); expect(card("current").textContent).not.toContain("old result");
    const summaries = [...document.querySelectorAll(".tool-group-summary")].map(node => node.textContent);
    expect(summaries[0]).toContain("1/1"); expect(summaries[1]).toContain("0/1");
  });
  it("parallel results may finish out of order, with user turns preserving replay group boundaries", () => {
    tool("a"); tool("b");
    host({ type: "updateMessage", messageId: "b", patch: { toolStatus: "failed", toolOutput: "B failed" } });
    host({ type: "updateMessage", messageId: "a", patch: { toolStatus: "completed", toolOutput: "A passed" } });
    append("turn", "user", "second turn"); tool("c");
    expect(groups()).toEqual([["a", "b"], ["c"]]);
    expect(card("a").textContent).toContain("A passed"); expect(card("a").textContent).not.toContain("B failed");
    expect(card("b").textContent).toContain("B failed");
    host({ type: "clearMessages" });
    for (const id of ["a", "b"]) append(id, "tool_call", "", { toolCallId: id, toolName: "bash", toolStatus: id === "a" ? "completed" : "failed" });
    append("turn", "user", "second turn"); tool("c"); expect(groups()).toEqual([["a", "b"], ["c"]]);
  });
  it("timer ticks do not rebuild folded cards and expanding shows output received while folded", () => {
    tool("running"); const group = document.querySelector<HTMLDetailsElement>(".tool-group")!; group.open = false;
    const original = card("running"); vi.advanceTimersByTime(3000); expect(card("running")).toBe(original);
    host({ type: "updateMessage", messageId: "running", patch: { toolOutput: "latest hidden output" } });
    group.open = true; expect(card("running").textContent).toContain("latest hidden output");
  });
  it("clearing a transcript stops its tool group timers", () => {
    tool("a"); append("boundary", "agent", "next"); tool("b");
    const detached = [...document.querySelectorAll(".tool-group-summary")];
    host({ type: "clearMessages" }); const texts = detached.map(node => node.textContent);
    vi.advanceTimersByTime(5000); expect(detached.map(node => node.textContent)).toEqual(texts);
  });
  it.each(["user", "agent"] as const)("copies %s source without losing markup, tabs, whitespace or line breaks", kind => {
    const text = "  fix `List<String>` in <file>\n\tthen **ship**  "; append("copy", kind, text); copy("copy");
    expect(clipboard).toHaveBeenLastCalledWith(`[${kind === "user" ? "You" : "Code"}]\n${text}`);
  });
  it("selected text takes priority over a whole-message copy", () => {
    append("copy", "user", "selected remainder"); const range = document.createRange();
    const text = card("copy").querySelector(".user-message-text")!.firstChild!;
    range.setStart(text, 0); range.setEnd(text, 8); window.getSelection()!.addRange(range); copy("copy");
    expect(clipboard).toHaveBeenLastCalledWith("selected");
  });
  it("image preview captions are excluded from a user-message copy", () => {
    append("image", "user", "look at this", { imageAttachments: [{ name: "private.png", mimeType: "image/png", data: "QUJD" }] });
    copy("image"); expect(clipboard).toHaveBeenLastCalledWith("[You]\nlook at this");
  });
  it("a burst parses once per frame while copy reads the latest source immediately", () => {
    append("stream", "agent", "initial"); vi.mocked(renderMarkdown).mockClear();
    for (let i = 1; i <= 100; i++) host({ type: "updateMessageTextOnly", messageId: "stream", text: `**chunk ${i}**` });
    copy("stream"); expect(clipboard).toHaveBeenLastCalledWith("[Code]\n**chunk 100**");
    flushFrame(); expect(card("stream").querySelector("strong")?.textContent).toBe("chunk 100");
    expect(renderMarkdown).toHaveBeenCalledTimes(1);
  });
  it("a final patch cannot be overwritten by a queued streaming render", () => {
    append("stream", "agent", "initial"); host({ type: "updateMessageTextOnly", messageId: "stream", text: "stale" });
    host({ type: "updateMessage", messageId: "stream", patch: { text: "**final**", isIntermediate: false } });
    flushFrame(); expect(card("stream").querySelector("strong")?.textContent).toBe("final");
  });
  it("pending stream renders cannot leak into a new transcript reusing the message id", () => {
    append("stream", "agent", "old"); host({ type: "updateMessageTextOnly", messageId: "stream", text: "old queued" });
    host({ type: "clearMessages" }); append("stream", "agent", "new session"); flushFrame();
    expect(card("stream").textContent).toContain("new session"); expect(card("stream").textContent).not.toContain("old queued");
  });
});
