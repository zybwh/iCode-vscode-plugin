import { beforeEach, describe, expect, it, vi } from "vitest";
import * as crypto from "node:crypto";
import * as vscode from "vscode";

const harness = vi.hoisted(() => ({ processes: [] as any[], panels: [] as any[], initialization: null as Promise<void> | null }));
vi.mock("vscode", () => ({
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); },
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
  window: { showWarningMessage: vi.fn(), showErrorMessage: vi.fn(), showInformationMessage: vi.fn() },
  env: { language: "en" },
}));
vi.mock("node:fs", async original => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, promises: { ...fs.promises, readFile: async () => Buffer.from("binary"), rm: vi.fn() } };
});
vi.mock("../common/chatPanelState", () => ({ chatPanelState: () => ({ sessionState: "idle" }) }));
vi.mock("../views/sessionTree", () => ({ SessionTreeProvider: class {} }));
vi.mock("../handlers/companion", () => ({ awardCompanionUsageEvent: vi.fn(), awardCompanionActiveMinutes: vi.fn() }));
vi.mock("../process/manager", () => ({
  ProcessManager: class {
    state = "stopped";
    handlers = new Map<string, (...args: any[]) => any>();
    events = new Map<string, (...args: any[]) => any>();
    id = `session-${harness.processes.length}`;
    client: any;
    constructor() {
      harness.processes.push(this);
      const methods = {
        initialize: async () => { await harness.initialization; return { protocolVersion: 1, agentInfo: { version: "test" } }; },
        newSession: vi.fn(async () => ({ sessionId: this.id })),
        loadSession: vi.fn(async (_cwd: string, id: string) => { this.id = id; return {}; }),
        runtime: async () => ({ sessionId: this.id }),
        listMcp: async () => ({ servers: [] }),
        listSkills: async () => ({ skills: [] }),
        setApprovalMode: async () => ({}),
        closeSession: vi.fn(async () => ({})), cancel: vi.fn(),
      };
      this.client = new Proxy(methods, { get: (target, key: string) => key in target ? (target as any)[key] : typeof key === "string" && key.startsWith("on") ? (callback: any) => this.events.set(key, callback) : undefined });
    }
    on(event: string, callback: any) { this.handlers.set(event, callback); }
    async start() { this.state = "running"; return this.client; }
    async stop() { this.state = "stopped"; }
  },
}));
vi.mock("../chat/panel", () => ({
  ChatPanel: class {
    disposed = false;
    constructor() {
      harness.panels.push(this);
      return new Proxy(this, { get: (target, key: string) => key in target ? (target as any)[key] : () => {} });
    }
    dispose() { this.disposed = true; }
  },
}));

import { openSessionTab, restartBackendConnection, deleteSessionById } from "../extension";
import { rt, currentRuntime, focusRuntime, withRuntime, sessionRuntimes, bindRuntime } from "../state/runtime";
import { handleAgentChunk } from "../handlers/session";
const root = currentRuntime();
const context = {
  subscriptions: [], extensionUri: {},
  workspaceState: { get: () => undefined, update: vi.fn() },
  globalState: { get: () => crypto.createHash("sha256").update("binary").digest("hex"), update: vi.fn() },
} as never;

beforeEach(() => {
  focusRuntime(root);
  sessionRuntimes.clear(); sessionRuntimes.add(root);
  root.currentSessionId = null; root.restoreSession = null;
  root.extensionContext = context; root.currentCwd = "/workspace";
  root.currentBinaryPath = process.execPath;
  root.outputChannel = { appendLine: vi.fn() } as never;
  root.sessionTreeProvider = { refresh: vi.fn() } as never;
  harness.processes.length = 0; harness.panels.length = 0; harness.initialization = null;
});

describe("independent session tabs", () => {
  it("creates another session while the first is running and routes ACP updates to their owners", async () => {
    expect(await openSessionTab()).toBe(true);
    const a = currentRuntime();
    a.sessionManager.stateMachine.force("running");
    expect(await openSessionTab()).toBe(true);
    const b = currentRuntime();
    expect(b).not.toBe(a);
    expect(a.sessionManager.state).toBe("running");
    expect(a.processManager).not.toBe(b.processManager);
    await harness.processes[0].events.get("onSessionUpdate")("session-0", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "A" } });
    await harness.processes[1].events.get("onSessionUpdate")("session-1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "B" } });
    expect(a.transcript.messages.map(message => message.text)).toEqual(["A"]);
    expect(b.transcript.messages.map(message => message.text)).toEqual(["B"]);
    expect(harness.processes[0].client.closeSession).not.toHaveBeenCalled();
  });

  it("deduplicates opening a saved session during ACP warm-up", async () => {
    let ready!: () => void;
    harness.initialization = new Promise<void>(resolve => { ready = resolve; });
    const first = openSessionTab({ sessionId: "saved", cwd: "/workspace" });
    const owner = currentRuntime();
    expect(await openSessionTab({ sessionId: "saved", cwd: "/workspace" })).toBe(true);
    expect(currentRuntime()).toBe(owner);
    expect(harness.panels).toHaveLength(1);
    ready();
    expect(await first).toBe(true);
    expect(harness.processes).toHaveLength(1);
    expect(owner.currentSessionId).toBe("saved");
  });

  it("reopens a closed tab without loading or starting another backend session", async () => {
    await openSessionTab();
    const a = currentRuntime();
    a.composerDraft = "draft A";
    a.chatPanel = null;
    await openSessionTab();
    expect(await openSessionTab({ sessionId: a.currentSessionId!, cwd: "/workspace" })).toBe(true);
    expect(currentRuntime()).toBe(a);
    expect(harness.processes).toHaveLength(2);
    expect(harness.processes[0].client.loadSession).not.toHaveBeenCalled();
    expect(a.composerDraft).toBe("draft A");
  });

  it("keeps async continuations scoped after tab focus changes", async () => {
    await openSessionTab(); const a = currentRuntime();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const operation = withRuntime(a, async () => {
      await gate;
      rt.currentUsageText = "A usage";
      handleAgentChunk({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "late A" } });
    });
    await openSessionTab(); const b = currentRuntime();
    finish(); await operation;
    expect(a.currentUsageText).toBe("A usage");
    expect(b.currentUsageText).not.toBe("A usage");
    expect(a.transcript.messages[0].text).toBe("late A");
    expect(b.transcript.messages).toHaveLength(0);
  });

  it.each([false, true])("protects a running target from deletion in another tab (starts during confirmation=%s)", async (startsDuringConfirmation) => {
    await openSessionTab(); const a = currentRuntime();
    await openSessionTab();
    const deletion = vi.spyOn(a.sessionManager, "deleteSession");
    if (startsDuringConfirmation) {
      vi.mocked(vscode.window.showWarningMessage).mockImplementationOnce(async () => {
        a.sessionManager.stateMachine.force("running");
        return "Delete" as never;
      });
    } else {
      a.sessionManager.stateMachine.force("running");
    }
    await deleteSessionById(a.currentSessionId!, "/workspace");
    expect(deletion).not.toHaveBeenCalled();
    expect(a.currentSessionId).toBe("session-0");
  });

  it("restarts only the requested tab and restores its own session", async () => {
    await openSessionTab(); const a = currentRuntime();
    await openSessionTab(); const b = currentRuntime();
    b.sessionManager.stateMachine.force("running");
    const before = b.sessionManager;
    const restart = bindRuntime(() => restartBackendConnection(context, process.execPath), a);
    expect(await restart()).toBe(true);
    expect(a.currentSessionId).toBe("session-0");
    expect(harness.processes[0].client.loadSession).toHaveBeenCalled();
    expect(b.sessionManager).toBe(before);
    expect(b.sessionManager.state).toBe("running");
    expect(harness.processes[1].client.loadSession).not.toHaveBeenCalled();
  });

  it("does not delete a saved session opened while confirmation is pending", async () => {
    await openSessionTab(); const a = currentRuntime();
    const deletion = vi.spyOn(a.sessionManager, "deleteSession");
    vi.mocked(vscode.window.showWarningMessage).mockImplementationOnce(async () => {
      await openSessionTab({ sessionId: "saved-later", cwd: "/workspace" });
      currentRuntime().sessionManager.stateMachine.force("running");
      return "Delete" as never;
    });
    await withRuntime(a, () => deleteSessionById("saved-later", "/workspace"));
    expect(deletion).not.toHaveBeenCalled();
  });
});
