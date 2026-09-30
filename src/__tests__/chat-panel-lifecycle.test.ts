import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  panels: [] as Array<{
    dispose: () => void;
    receive: (message: { type: string }) => void;
    postMessage: ReturnType<typeof vi.fn>;
    reveal: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("../common/chatPanelState", () => ({ chatPanelState: () => ({ sessionState: "idle" }) }));
vi.mock("../handlers/companion", () => ({
  awardCompanionUsageEvent: vi.fn(), awardCompanionActiveMinutes: vi.fn(),
  handleCompanionDirectAddress: () => false, handleCompanionCommand: vi.fn(),
}));

vi.mock("vscode", () => ({
  TreeItem: class {},
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); },
  Uri: {
    joinPath: (_base: unknown, ...parts: string[]) => ({
      toString: () => parts.join("/"),
      with: () => parts.join("/"),
    }),
  },
  ViewColumn: { Two: 2 },
  env: { language: "en" },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
  window: {
    showInformationMessage: vi.fn(async () => undefined),
    createWebviewPanel: () => {
      let disposed = false;
      let onDispose = () => {};
      const assertAlive = () => {
        if (disposed) throw new Error("Webview is disposed");
      };
      const postMessage = vi.fn(() => { assertAlive(); return Promise.resolve(true); });
      const panel = {
        receive: (_message: { type: string }) => {},
        postMessage,
        reveal: vi.fn(assertAlive),
        onDidDispose: (listener: () => void) => { onDispose = listener; },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          onDispose();
        },
        get webview() { assertAlive(); return webview; },
      };
      const webview = {
        html: "",
        cspSource: "test:",
        asWebviewUri: (uri: unknown) => uri,
        postMessage,
        onDidReceiveMessage: (listener: typeof panel.receive) => { panel.receive = listener; },
      };
      harness.panels.push(panel);
      return panel;
    },
  },
}));

import { ChatPanel, STREAM_FLUSH_MS } from "../chat/panel";
import { AskUserHandler } from "../askUser/modal";
import { ApprovalHandler } from "../approval/modal";
import { rt, currentRuntime, createSessionRuntime, focusRuntime, withRuntime, sessionRuntimes } from "../state/runtime";
import { handleSendMessage, handleWebviewCommand } from "../handlers/actions";
import { handleAgentChunk, handleToolCallStart, handleToolCallProgress } from "../handlers/session";
import { openLogsDialog, clearLogsRefreshTimer, openSessionsDialog, refreshModelDialog, refreshAgentDialog } from "../ui/dialogs";
import { ManagementPanel } from "../manage/panel";
import { refreshManagementPanel } from "../ui/management";

const rootRuntime = currentRuntime();

const context = { extensionUri: {}, subscriptions: [] } as never;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function openChat() {
  rt.chatPanel = new ChatPanel(context);
  const host = harness.panels.at(-1)!;
  host.receive({ type: "webviewReady" });
  return host;
}

beforeEach(() => {
  focusRuntime(rootRuntime);
  sessionRuntimes.clear(); sessionRuntimes.add(rootRuntime);
  harness.panels.length = 0;
  rt.chatPanel = null as never;
  rt.transcript?.clearMessages();
  rt.resetRenderState(true);
  rt.connectionInitialization = null;
  rt.sessionInitialization = null;
  rt.extensionContext = null;
  rt.activeInlineDialogKind = null;
  rt.pendingApproval = null;
  rt.pendingQuestion = null;
  rt.composerDraft = "";
  rt.askUserHandler = new AskUserHandler(() => rt.chatPanel);
  rt.approvalHandler = new ApprovalHandler(() => rt.chatPanel, () => null);
});

afterEach(() => {
  clearLogsRefreshTimer();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("chat panel lifecycle", () => {
  it("releases a closed webview so the chat can be opened again", () => {
    const closed = rt.chatPanel = new ChatPanel(context);
    harness.panels[0].receive({ type: "webviewReady" });

    expect(() => harness.panels[0].dispose()).not.toThrow();
    expect(rt.chatPanel).toBeNull();

    if (!rt.chatPanel) rt.chatPanel = new ChatPanel(context);
    expect(rt.chatPanel).not.toBe(closed);
    expect(() => rt.chatPanel.reveal()).not.toThrow();
    rt.chatPanel.setComposer("reopened");
    harness.panels[1].receive({ type: "webviewReady" });
    expect(harness.panels[1].postMessage).toHaveBeenCalledWith({ type: "setComposer", text: "reopened" });
  });

  it("keeps questions and approvals pending when their tab closes, then answers after reopening", async () => {
    const old = openChat();
    const question = rt.askUserHandler.requestInput({
      sessionId: "s1", requestId: "q1", questions: [{ question: "Continue?", options: [] }],
    });
    const approval = rt.approvalHandler.requestPermission({
      sessionId: "s1", toolCall: { toolCallId: "t1" }, options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }],
    });
    old.dispose();
    expect(rt.activeAskUserRequest?.requestId).toBe("q1");
    expect(rt.activeApprovalRequest?.requestId).toBe("t1");
    const reopened = openChat();
    expect(reopened.postMessage).toHaveBeenCalledWith({ type: "askUserDialogState", state: expect.objectContaining({ requestId: "q1" }) });
    expect(reopened.postMessage).toHaveBeenCalledWith({ type: "approvalDialogState", state: expect.objectContaining({ requestId: "t1" }) });
    rt.askUserHandler.resolve("q1", [], true);
    rt.approvalHandler.resolve("allow");
    await expect(question).resolves.toEqual({ cancelled: true });
    await expect(approval).resolves.toEqual({ outcome: "selected", optionId: "allow" });
    expect(reopened.postMessage).toHaveBeenCalledWith({ type: "approvalDialogState", state: null });
    expect(reopened.postMessage).toHaveBeenCalledWith({ type: "askUserDialogState", state: null });
  });

  it("ignores delayed messages and ready events after closing during startup", () => {
    const closed = rt.chatPanel = new ChatPanel(context);
    closed.setComposer("queued before ready");
    closed.dispose();

    expect(() => {
      closed.setAskUserDialogState(null);
      harness.panels[0].receive({ type: "webviewReady" });
      closed.dispose();
    }).not.toThrow();
    expect(harness.panels[0].postMessage).not.toHaveBeenCalled();
  });

  it.each([false, true])("finishes a prompt with the panel closed (failed=%s)", async (failed) => {
    const prompt = deferred();
    const started = deferred();
    rt.currentSessionId = "s1";
    rt.sessionManager = { sessionId: "s1", state: "idle", sendPrompt: () => {
      started.resolve(); return prompt.promise;
    } } as never;
    const notify = vi.spyOn(rt, "notifySessionState");
    const host = openChat();
    const response = handleSendMessage("hello", [{ type: "text", text: "hello" }]);
    await started.promise;
    host.dispose();
    if (failed) prompt.reject(new Error("prompt failed"));
    else prompt.resolve();
    await expect(response).resolves.toBeUndefined();
    expect(notify).toHaveBeenLastCalledWith("idle");
  });

  it("restores transcript updates received while the chat is closed", () => {
    const host = openChat();
    handleAgentChunk({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } });
    host.dispose();
    handleAgentChunk({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: " after" } });
    handleToolCallStart({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", status: "in_progress" });
    handleToolCallProgress({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
    const reopened = openChat();
    const replayed = reopened.postMessage.mock.calls
      .map(([message]) => message)
      .filter(message => message.type === "appendMessages");
    expect(replayed).toHaveLength(1);
    expect(replayed[0].messages).toEqual([
      expect.objectContaining({ kind: "agent", text: "before after" }),
      expect.objectContaining({ toolCallId: "t1", toolStatus: "completed" }),
    ]);
    rt.transcript.clearMessages();
    reopened.dispose();
    expect(openChat().postMessage).not.toHaveBeenCalled();
  });

  it("stops log refresh when chat closes without reopening the dialog later", () => {
    vi.useFakeTimers();
    const host = openChat();
    openLogsDialog();
    host.dispose();
    expect(rt.logsRefreshTimer).toBeNull();
    expect(rt.activeInlineDialogKind).toBeNull();
    const reopened = openChat();
    vi.advanceTimersByTime(2100);
    expect(reopened.postMessage).not.toHaveBeenCalled();
  });

  it("finishes a management refresh after its webview closes", async () => {
    const panel = new ManagementPanel(context);
    const refresh = deferred();
    panel.onRefresh(() => refresh.promise);
    const response = (panel as unknown as { handleMessage: (message: { type: string }) => Promise<void> }).handleMessage({ type: "refresh" });
    harness.panels.at(-1)!.dispose();
    refresh.resolve();
    await expect(response).resolves.toBeUndefined();
  });

  it("does not deliver an old management refresh to a replacement panel", async () => {
    const refresh = deferred();
    rt.sessionManager = {
      listAgentProfiles: async () => { await refresh.promise; return []; },
      listModelProfiles: async () => [], configOptions: async () => ({ options: [] }),
    } as never;
    rt.managementPanel = new ManagementPanel(context);
    const response = refreshManagementPanel();
    harness.panels.at(-1)!.dispose();
    rt.managementPanel = new ManagementPanel(context);
    const replacement = harness.panels.at(-1)!;
    refresh.resolve();
    await expect(response).resolves.toBeUndefined();
    expect(replacement.postMessage).not.toHaveBeenCalled();
  });

  it.each([["sessions", openSessionsDialog], ["models", refreshModelDialog], ["agents", refreshAgentDialog]] as const)("drops a late %s dialog refresh from a closed chat", async (_name, refreshDialog) => {
    const refresh = deferred();
    rt.currentCwd = "/workspace";
    rt.sessionManager = {
      listSessions: async () => { await refresh.promise; return []; },
      listModelProfiles: async () => { await refresh.promise; return []; },
      listAgentProfiles: async () => { await refresh.promise; return []; },
    } as never;
    const host = openChat();
    const response = refreshDialog();
    host.dispose();
    const replacement = openChat();
    refresh.resolve();
    await expect(response).resolves.toBeUndefined();
    expect(replacement.postMessage).not.toHaveBeenCalled();
  });

  it("rehydrates a reloaded webview without duplicating or losing streamed messages", () => {
    const host = openChat();
    rt.chatPanel.setState({ agentName: "Code", modelName: "test", sessionId: "s1", sessionState: "running" });
    handleAgentChunk({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "before" } });
    handleAgentChunk({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: " after" } });
    host.postMessage.mockClear();
    host.receive({ type: "webviewReady" });
    const sent = host.postMessage.mock.calls.map(([message]) => message);
    expect(sent[0]).toEqual({ type: "clearMessages" });
    expect(sent.filter(message => message.type === "appendMessage" || message.type === "appendMessages")).toEqual([
      { type: "appendMessages", messages: [expect.objectContaining({ text: "before after" })] },
    ]);
    expect(sent).toContainEqual({ type: "setState", state: expect.objectContaining({ sessionState: "running" }) });
  });

  it("coalesces streamed text and flushes it before later messages", () => {
    vi.useFakeTimers();
    const host = openChat();
    handleAgentChunk({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a" } });
    host.postMessage.mockClear();
    for (const chunk of ["b", "c", "d"]) handleAgentChunk({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } });
    const textUpdates = () => host.postMessage.mock.calls.map(([message]) => message).filter(message => message.type === "updateMessageTextOnly");
    expect(textUpdates()).toEqual([]);
    vi.advanceTimersByTime(STREAM_FLUSH_MS);
    expect(textUpdates()).toEqual([expect.objectContaining({ text: "abcd" })]);

    host.postMessage.mockClear();
    handleAgentChunk({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "e" } });
    rt.transcript.appendMessage({ id: "after", kind: "system", text: "next", timestamp: 0 });
    const sent = host.postMessage.mock.calls.map(([message]) => message);
    expect(sent.map(message => message.type)).toEqual(["updateMessageTextOnly", "appendMessage"]);
    expect(sent[0]).toEqual(expect.objectContaining({ text: "abcde" }));
  });

  it("keeps pending approval and AskUser requests answerable after webview reload", async () => {
    const host = openChat();
    const question = rt.askUserHandler.requestInput({
      sessionId: "s1", requestId: "q1", questions: [{ question: "Continue?", options: [] }],
    });
    const approval = rt.approvalHandler.requestPermission({
      sessionId: "s1", toolCall: { toolCallId: "t1" }, options: [],
    });
    host.postMessage.mockClear();
    host.receive({ type: "webviewReady" });
    expect(host.postMessage).toHaveBeenCalledWith({ type: "askUserDialogState", state: expect.objectContaining({ requestId: "q1" }) });
    expect(host.postMessage).toHaveBeenCalledWith({ type: "approvalDialogState", state: expect.objectContaining({ requestId: "t1" }) });
    rt.askUserHandler.resolve("q1", [], true);
    rt.approvalHandler.resolve();
    await expect(question).resolves.toEqual({ cancelled: true });
    await expect(approval).resolves.toEqual({ outcome: "cancelled" });
  });

  it("clears only display and preserves context indicators and backend session state", async () => {
    openChat();
    rt.currentSessionId = "keep-session";
    rt.sessionManager = { state: "idle" } as never;
    rt.currentUsageText = "123 tokens";
    rt.currentPlanEntries = [{ content: "Keep plan", priority: "high", status: "pending" }];
    rt.transcript.appendMessage({ id: "old", kind: "user", text: "old prompt", timestamp: 0 });
    await handleWebviewCommand("clearChat");
    expect(rt.currentSessionId).toBe("keep-session");
    expect(rt.currentUsageText).toBe("123 tokens");
    expect(rt.currentPlanEntries[0].content).toBe("Keep plan");
    expect(rt.transcript.messages).toHaveLength(1);
    expect(rt.transcript.messages[0].text).toContain("Session context and saved history are unchanged");
  });

  it("does not clear a running task even if a stale webview sends the command", async () => {
    openChat(); rt.sessionManager = { state: "running" } as never;
    rt.transcript.appendMessage({ id: "running", kind: "agent", text: "working", timestamp: 0 });
    await handleWebviewCommand("clearChat");
    expect(rt.transcript.messages[0].text).toBe("working");
  });

  it("routes webview actions and identically named approvals to the originating tab", async () => {
    const a = createSessionRuntime("/a");
    const b = createSessionRuntime("/b");
    const setup = (owner: typeof a) => withRuntime(owner, () => {
      const host = openChat();
      owner.approvalHandler = new ApprovalHandler(() => owner.chatPanel, () => owner.currentCwd);
      owner.chatPanel!.onApprovalDialogDecision((optionId) => rt.approvalHandler.resolve(optionId));
      const decision = owner.approvalHandler.requestPermission({
        sessionId: owner.tabId, toolCall: { toolCallId: "same-tool-id" },
        options: [{ optionId: "yes", kind: "allow_once", name: "Allow" }],
      });
      return { host, decision };
    });
    const first = setup(a); const second = setup(b);
    focusRuntime(b);
    first.host.receive({ type: "approvalDialogDecision", optionId: "yes" } as never);
    await expect(first.decision).resolves.toEqual({ outcome: "selected", optionId: "yes" });
    expect(a.activeApprovalRequest).toBeNull();
    expect(b.activeApprovalRequest?.requestId).toBe("same-tool-id");
    second.host.receive({ type: "approvalDialogDecision" });
    await expect(second.decision).resolves.toEqual({ outcome: "cancelled" });
  });

  it("keeps drafts separate when messages arrive from an unfocused or reopened tab", () => {
    const a = createSessionRuntime("/a"); const b = createSessionRuntime("/b");
    const first = withRuntime(a, openChat); const second = withRuntime(b, openChat);
    focusRuntime(b);
    first.receive({ type: "composerDraft", text: "draft A" } as never);
    second.receive({ type: "composerDraft", text: "draft B" } as never);
    first.dispose();
    const reopened = withRuntime(a, openChat);
    expect(reopened.postMessage).toHaveBeenCalledWith({ type: "setComposer", text: "draft A" });
    expect(b.composerDraft).toBe("draft B");
  });

  it("restores the owning tab draft after its webview reloads in the background", () => {
    const a = createSessionRuntime("/a"); const b = createSessionRuntime("/b");
    const first = withRuntime(a, openChat); const second = withRuntime(b, openChat);
    first.receive({ type: "composerDraft", text: "draft A\ncontinued" } as never);
    second.receive({ type: "composerDraft", text: "draft B" } as never);
    focusRuntime(b);
    first.postMessage.mockClear();
    first.receive({ type: "webviewReady" });
    expect(first.postMessage).toHaveBeenCalledWith({ type: "setComposer", text: "draft A\ncontinued" });
    expect(b.composerDraft).toBe("draft B");
  });

  it("ignores composer updates from a disposed panel after replacement", () => {
    const first = openChat();
    const oldPanel = rt.chatPanel!;
    first.dispose();
    const replacement = openChat();
    rt.chatPanel!.setComposer("new draft");
    oldPanel.setComposer("late file picker result");
    expect(rt.composerDraft).toBe("new draft");
    replacement.receive({ type: "webviewReady" });
    expect(replacement.postMessage).toHaveBeenLastCalledWith({ type: "setComposer", text: "new draft" });
  });

  it("does not let a previous prompt completion reset a replacement session", async () => {
    const prompt = deferred();
    const started = deferred();
    rt.currentSessionId = "old-session";
    rt.sessionManager = { sessionId: "old-session", state: "idle", sendPrompt: () => {
      started.resolve(); return prompt.promise;
    } } as never;
    const host = openChat();
    const response = handleSendMessage("old", [{ type: "text", text: "old" }]);
    await started.promise;
    rt.currentSessionId = "new-session";
    rt.sessionManager = { sessionId: "new-session", state: "running" } as never;
    rt.pendingUserEchoText = "new";
    const notify = vi.spyOn(rt, "notifySessionState");
    host.postMessage.mockClear();
    prompt.reject(new Error("old transport closed"));
    await response;
    expect(rt.pendingUserEchoText).toBe("new");
    expect(host.postMessage).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
