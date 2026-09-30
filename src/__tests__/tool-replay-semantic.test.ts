import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../chat/provider";
import type { HostMessage, ChatPanel, ChatPanelState } from "../chat/panel";
import type { ToolCallStart, ToolCallProgress } from "../acp/types";
vi.mock("vscode", () => ({
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
  workspace: { getConfiguration: () => ({ get: () => undefined }), asRelativePath: (value: string) => value },
  env: { language: "en" },
}));
vi.mock("../handlers/companion", () => ({ awardCompanionUsageEvent: vi.fn() }));
import { ExtensionRuntime, withRuntime } from "../state/runtime";
import { handleSessionUpdate } from "../handlers/session";

function host(message: HostMessage) { window.dispatchEvent(new MessageEvent("message", { data: message })); }
const ready: ChatPanelState = {
  agentName: "Code", modelName: "Fixture", sessionId: "s1", sessionState: "idle",
  uiLanguage: "en", uiTheme: "chrys", connectionState: "ready", workspacePath: "/workspace", planEntries: [],
};
function owner() {
  const runtime = new ExtensionRuntime();
  runtime.currentSessionId = "s1";
  runtime.chatPanel = {
    appendDebugEvent: vi.fn(),
    appendMessage: (message: ChatMessage) => host({ type: "appendMessage", message }),
    updateMessage: (messageId: string, patch: Partial<ChatMessage>) => host({ type: "updateMessage", messageId, patch }),
  } as unknown as ChatPanel;
  return runtime;
}
function golden() {
  const card = document.querySelector(".tool-card");
  expect(document.querySelectorAll(".tool-card")).toHaveLength(1);
  return {
    text: card!.textContent!.replace(/\s+/g, " ").trim(),
    status: card!.querySelector(".tool-card-status")?.textContent,
    images: [...card!.querySelectorAll("img")].map(image => image.getAttribute("src")),
    resources: [...card!.querySelectorAll("[data-resource-uri]")].map(link => link.getAttribute("data-resource-uri")),
    diff: !!card!.querySelector("[data-tool-call-id]"),
  };
}

const cases: Array<{ name: string; start: ToolCallStart; chunks: string[]; final: ToolCallProgress; required: string[] }> = [
  {
    name: "shell streaming tail",
    start: { sessionUpdate: "tool_call", toolCallId: "shell", title: "bash", kind: "execute", status: "in_progress", rawInput: { command: "run-tests" } },
    chunks: ["collecting\n", "all passed\n"],
    final: { sessionUpdate: "tool_call_update", toolCallId: "shell", status: "completed" },
    required: ["collecting", "all passed", "run-tests"],
  },
  {
    name: "failed shell result",
    start: { sessionUpdate: "tool_call", toolCallId: "failed", title: "bash", kind: "execute", status: "in_progress", rawInput: { command: "run-tests" } },
    chunks: ["partial output"],
    final: { sessionUpdate: "tool_call_update", toolCallId: "failed", status: "failed", rawOutput: "test failed\n[exit_code: 2]" },
    required: ["test failed", "exit 2"],
  },
  {
    name: "file diff",
    start: { sessionUpdate: "tool_call", toolCallId: "edit", title: "edit_file", kind: "edit", status: "in_progress", rawInput: { path: "app.ts", old_string: "before", new_string: "after" } },
    chunks: [],
    final: { sessionUpdate: "tool_call_update", toolCallId: "edit", status: "completed", rawOutput: "Edited app.ts" },
    required: ["app.ts", "before", "after"],
  },
  {
    name: "hosted image and artifact",
    start: { sessionUpdate: "tool_call", toolCallId: "hosted", title: "image_generation", kind: "other", status: "in_progress" },
    chunks: [],
    final: { sessionUpdate: "tool_call_update", toolCallId: "hosted", status: "completed", rawOutput: "generated", content: [
      { content: { type: "image", data: "QUJD", mimeType: "image/png" } },
      { content: { type: "resource_link", name: "report.csv", uri: "https://example.com/report.csv" } },
    ] },
    required: ["generated", "report.csv"],
  },
];

describe("tool semantics through live host messages, replay and webview rebuild", () => {
  beforeAll(async () => {
    // Node keeps VS Code imports mockable; mount the actual webview in JSDOM.
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><body></body>", { url: "https://fixture.local", pretendToBeVisual: true });
    for (const key of ["window", "document", "navigator", "MutationObserver", "HTMLElement", "Element", "Node", "HTMLDetailsElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLButtonElement", "DocumentFragment", "Event", "MessageEvent", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
      vi.stubGlobal(key, key === "window" ? dom.window : Reflect.get(dom.window, key));
    }
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("acquireVsCodeApi", () => ({ getState: () => ({}), setState: vi.fn(), postMessage: vi.fn() }));
    await import("../chat/webview/app");
  });
  afterAll(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  for (const fixture of cases) it(fixture.name, async () => {
    host({ type: "clearMessages" });
    host({ type: "setState", state: ready });
    const live = owner();
    await withRuntime(live, async () => {
      await handleSessionUpdate("s1", fixture.start);
      for (const rawOutput of fixture.chunks) await handleSessionUpdate("s1", {
        sessionUpdate: "tool_call_update", toolCallId: fixture.start.toolCallId, status: "in_progress", rawOutput,
      });
      await handleSessionUpdate("s1", fixture.final);
    });
    const expected = golden();
    for (const text of fixture.required) expect(expected.text).toContain(text);
    if (fixture.name === "file diff") expect(expected.diff).toBe(true);
    if (fixture.name === "hosted image and artifact") {
      expect(expected.images).toEqual(["data:image/png;base64,QUJD"]);
      expect(expected.resources).toEqual(["https://example.com/report.csv"]);
    }
    // Collapse/expand is local display state and must retain the payload.
    for (const detail of document.querySelectorAll("details")) { detail.open = false; detail.open = true; }
    expect(golden()).toEqual(expected);

    host({ type: "clearMessages" });
    // A fresh view receives serialized host transcript entries, not live DOM.
    const saved: ChatMessage[] = JSON.parse(JSON.stringify(live.transcript.messages));
    for (const message of saved) host({ type: "appendMessage", message });
    expect(golden()).toEqual(expected);

    host({ type: "clearMessages" });
    const replay = owner();
    await withRuntime(replay, async () => {
      await handleSessionUpdate("s1", { ...fixture.start, status: fixture.final.status });
      await handleSessionUpdate("s1", { ...fixture.final, rawOutput: fixture.final.rawOutput ?? fixture.chunks.join("") });
    });
    expect(golden()).toEqual(expected);

    // Prove the oracle notices missing output/media/diff inputs rather than
    // merely comparing IDs, renderer kinds, or two equally empty views.
    host({ type: "clearMessages" });
    host({ type: "appendMessage", message: { ...saved[0], toolOutput: "", toolContent: [], toolInput: {}, canDiff: false } });
    expect(golden()).not.toEqual(expected);
  });
});
