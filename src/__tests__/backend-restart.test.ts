import { beforeEach, expect, it, vi } from "vitest";
import * as path from "node:path";
import * as crypto from "node:crypto";
const harness = vi.hoisted(() => ({
  commands: new Map<string, () => Promise<void>>(),
  initialize: vi.fn(), start: vi.fn(), stop: vi.fn(), quickPick: vi.fn(),
}));
vi.mock("vscode", () => ({
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
  workspace: {
    getConfiguration: () => ({ get: (key: string) => key === "binary.path" ? process.execPath : undefined }),
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
    registerTextDocumentContentProvider: vi.fn(), onDidChangeConfiguration: vi.fn(),
  },
  window: {
    createOutputChannel: () => ({ appendLine: vi.fn() }),
    showQuickPick: harness.quickPick, showWarningMessage: async () => "Switch Agent",
    showInformationMessage: vi.fn(), showErrorMessage: vi.fn(), setStatusBarMessage: vi.fn(),
  },
  commands: { registerCommand: (key: string, fn: () => Promise<void>) => harness.commands.set(key, fn) },
  extensions: { getExtension: vi.fn() },
  QuickPickItemKind: { Separator: -1 },
  env: { language: "en" },
}));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, promises: { ...fs.promises, readFile: async () => Buffer.from("fake-binary"), rm: vi.fn() } };
});
vi.mock("../views/sessionTree", () => ({ SessionTreeProvider: class {} }));

import { activate, restartBackendConnection } from "../extension";
import { changeWorkspace, runDoctor } from "../ui/dialogs";
import { rt } from "../state/runtime";
import { ApprovalHandler } from "../approval/modal";

const context = {
  subscriptions: [], extensionUri: { toString: () => "" },
  workspaceState: { get: () => undefined, update: vi.fn() },
  globalState: { get: () => crypto.createHash("sha256").update("fake-binary").digest("hex"), update: vi.fn() },
} as never;
beforeEach(async () => {
  vi.clearAllMocks(); harness.commands.clear();
  rt.connectionInitialization = null; rt.currentSessionId = null; rt.skipRestoreOnce = false;
  rt.currentCwd = "/workspace"; rt.currentBinaryPath = process.execPath;
  rt.extensionContext = context; rt.currentRuntime = null;
  rt.chatPanel = { reveal: vi.fn(), setState: vi.fn(), appendDebugEvent: vi.fn(), clearMessages: vi.fn(), setAskUserDialogState: vi.fn(), setApprovalDialogState: vi.fn() } as never;
  rt.sessionTreeProvider = { refresh: vi.fn(), diagnosticsSnapshot: () => ({}) } as never;
  harness.initialize.mockResolvedValue({ protocolVersion: 1, agentInfo: { version: "0.22.5" } });
  const client = new Proxy({ initialize: harness.initialize }, { get: (target, key) => key === "then" ? undefined : key in target ? target[key as "initialize"] : vi.fn() });
  harness.start.mockImplementation(async () => { (rt.processManager as unknown as { state: string }).state = "running"; return client; });
  harness.stop.mockImplementation(async () => { (rt.processManager as unknown as { state: string }).state = "stopped"; });
  rt.processManager = { state: "stopped", start: harness.start, stop: harness.stop } as never;
  await activate(context);
  await rt.connectionInitialization;
  expect(rt.connectionState).toBe("ready");
});

it("initializes the replacement client when switching agents from the command palette", async () => {
  const previous = rt.sessionManager;
  harness.quickPick.mockResolvedValue({ label: "Explore" });
  await harness.commands.get("chrys.selectAgent")!();
  expect(harness.initialize).toHaveBeenCalledTimes(2);
  expect(rt.sessionManager).not.toBe(previous);
  expect(rt.connectionState).toBe("ready");
  expect(rt.preferredAgentName).toBe("Explore");
});

it("initializes the replacement client through Doctor", async () => {
  const previous = rt.sessionManager;
  harness.quickPick.mockResolvedValue({ action: "restartAcp" });
  await runDoctor();
  expect(harness.initialize).toHaveBeenCalledTimes(2);
  expect(rt.sessionManager).not.toBe(previous);
  expect(rt.connectionState).toBe("ready");
});

it("settles a pending approval before replacing its handler", async () => {
  const oldHandler = new ApprovalHandler(() => rt.chatPanel, () => rt.currentCwd);
  rt.approvalHandler = oldHandler;
  const approval = oldHandler.requestPermission({ sessionId: "s1", toolCall: { toolCallId: "t1" }, options: [] });
  await restartBackendConnection(context, process.execPath);
  await expect(approval).resolves.toEqual({ outcome: "cancelled" });
  expect(rt.chatPanel.setApprovalDialogState).toHaveBeenLastCalledWith(null);
  expect(rt.activeApprovalRequest).toBeNull();
  expect(rt.approvalHandler).not.toBe(oldHandler);
});

it("restarts the backend in the directory selected from CWD before a session exists", async () => {
  harness.quickPick.mockResolvedValue({ directory: path.resolve("/workspace/second") });
  await changeWorkspace();
  expect(harness.initialize).toHaveBeenCalledTimes(2);
  expect(harness.start).toHaveBeenLastCalledWith(process.execPath, expect.any(Array), path.resolve("/workspace/second"));
  expect(rt.currentCwd).toBe(path.resolve("/workspace/second"));
  expect(rt.currentSessionId).toBeNull();
  expect(rt.connectionState).toBe("ready");
});

it("updates the active session workspace without restarting the backend", async () => {
  rt.currentSessionId = "session-1";
  const setWorkspace = vi.spyOn(rt.sessionManager!, "setWorkspace").mockResolvedValue({ primaryCwd: path.resolve("/workspace/second") });
  harness.quickPick.mockResolvedValue({ directory: path.resolve("/workspace/second") });
  await changeWorkspace();
  expect(setWorkspace).toHaveBeenCalledWith(path.resolve("/workspace/second"));
  expect(harness.initialize).toHaveBeenCalledTimes(1);
  expect(rt.currentCwd).toBe(path.resolve("/workspace/second"));
  expect(rt.currentSessionId).toBe("session-1");
});

it("settles a pending AskUser before replacing its handler", async () => {
  const { AskUserHandler } = await import("../askUser/modal");
  const oldHandler = new AskUserHandler(() => rt.chatPanel);
  rt.askUserHandler = oldHandler;
  const response = oldHandler.requestInput({ sessionId: "s1", requestId: "q1", questions: [{ question: "Continue?", options: [] }] });
  await restartBackendConnection(context, process.execPath);
  await expect(response).resolves.toEqual({ cancelled: true });
  expect(rt.chatPanel.setAskUserDialogState).toHaveBeenLastCalledWith(null);
  expect(rt.activeAskUserRequest).toBeNull();
  expect(rt.askUserHandler).not.toBe(oldHandler);
});

it("does not report ready when the backend exits during session initialization", async () => {
  // The process dies after initialize while the startup restore is still running.
  harness.initialize.mockImplementationOnce(async () => {
    (rt.processManager as unknown as { state: string }).state = "stopped";
    return { protocolVersion: 1, agentInfo: { version: "0.22.5" } };
  });
  rt.connectionState = "disconnected";
  const connected = await restartBackendConnection(context, process.execPath);
  expect(connected).toBe(false);
  expect(rt.connectionState).not.toBe("ready");
});
