import { beforeAll, describe, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "../support/runtime";
import pin from "../support/icode-upstream.json";

vi.mock("vscode", () => ({
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
  workspace: { getConfiguration: () => ({ get: () => undefined }), asRelativePath: (value: string) => value },
  env: { language: "en" },
}));
vi.mock("../../src/handlers/companion", () => ({ awardCompanionUsageEvent: vi.fn() }));
import { ExtensionRuntime, withRuntime } from "../../src/state/runtime";
import { handleSessionUpdate } from "../../src/handlers/session";
import { ApprovalHandler } from "../../src/approval/modal";
import { AskUserHandler } from "../../src/askUser/modal";
import type { ChatPanel } from "../../src/chat/panel";

let python: string;
let stub: string;
beforeAll(() => {
  if (!process.env.ICODE_SOURCE_PATH || !process.env.ICODE_TEST_PYTHON) {
    throw new Error("Set ICODE_SOURCE_PATH and ICODE_TEST_PYTHON; see tests/README.md. No fixture is downloaded automatically.");
  }
  python = resolve(process.env.ICODE_TEST_PYTHON);
  stub = resolve(process.env.ICODE_SOURCE_PATH, pin.stubPath);
  expect(createHash("sha256").update(readFileSync(stub)).digest("hex"), "Upstream fixture must match the pinned source").toBe(pin.stubSha256);
  const version = execFileSync(python, ["-c", 'import importlib.metadata; print(importlib.metadata.version("agent-client-protocol"))'], { encoding: "utf8", timeout: 10000 }).trim();
  expect(version, "Use the ACP SDK version from the pinned iCode source").toBe(pin.acpSdkVersion);
});

async function initialize(client: import("../../src/acp/client").ChrysAcpClient, cwd: string) {
  expect((await client.initialize(1, { name: "icode-vsix-stub-tests", version: "1" })).protocolVersion).toBe(1);
  return (await client.newSession(cwd)).sessionId;
}

const prompt = [{ type: "text" as const, text: "fixture" }];

describe("Pinned upstream ACP subprocess through the production client", () => {
  for (const scenario of ["permission", "ask_user"]) test(`round-trips the ${scenario} callback without a model`, async ({ runtime }) => {
    vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", scenario);
    const { client, manager } = await runtime.start(python, [stub]);
    const sessionId = await initialize(client, runtime.workspace);
    const permission = vi.fn(async () => ({ outcome: "selected" as const, optionId: "allow" }));
    const input = vi.fn(async () => ({ answers: [{ values: ["yes"], note: "" }], cancelled: false }));
    client.onRequestPermission(permission);
    client.onRequestInput(input);
    const texts: string[] = [];
    const owners: string[] = [];
    client.onSessionUpdate((owner, update) => {
      owners.push(owner);
      if (update.sessionUpdate === "agent_message_chunk") {
        const blocks = Array.isArray(update.content) ? update.content : [update.content];
        for (const block of blocks) if (block.type === "text") texts.push(block.text);
      }
    });
    expect((await client.prompt(sessionId, prompt)).stopReason).toBe("end_turn");
    expect(new Set(owners)).toEqual(new Set([sessionId]));
    expect(texts.join("")).toContain(scenario === "permission" ? "permission:allow" : "answer:yes");
    expect(scenario === "permission" ? permission : input).toHaveBeenCalledTimes(1);
    expect(scenario === "permission" ? input : permission).not.toHaveBeenCalled();
    if (scenario === "permission") await vi.waitFor(() => expect(manager.recentOutput).toContain("permission-outcome:allow"));
  });

  test("cancels a stalled streamed turn and keeps the session callable", async ({ runtime }) => {
    vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", "text_then_stall");
    const { client } = await runtime.start(python, [stub]);
    const sessionId = await initialize(client, runtime.workspace);
    const updates: string[] = [];
    client.onSessionUpdate((_owner, update) => {
      if (update.sessionUpdate === "agent_message_chunk") {
        const blocks = Array.isArray(update.content) ? update.content : [update.content];
        for (const block of blocks) if (block.type === "text") updates.push(block.text);
      }
    });
    const pending = client.prompt(sessionId, prompt);
    // Attach a rejection handler before waiting for the event to avoid a leaked
    // rejection if the subprocess fails before reaching the checkpoint.
    const settled = pending.then(result => ({ result }), error => ({ error }));
    await vi.waitFor(() => expect(updates).toContain("checkpoint progress"), { timeout: 5000 });
    await client.cancel(sessionId);
    expect(await settled).toMatchObject({ result: { stopReason: "cancelled" } });
    await client.closeSession(sessionId);
  });

  for (const scenario of ["truncated", "crash_mid_prompt"]) test(`rejects pending work when the child exits: ${scenario}`, async ({ runtime }) => {
    vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", scenario);
    const { client, manager } = await runtime.start(python, [stub]);
    if (scenario === "truncated") {
      await expect(client.initialize(1, { name: "fixture", version: "1" })).rejects.toThrow(/transport closed/i);
    } else {
      const sessionId = await initialize(client, runtime.workspace);
      await expect(client.prompt(sessionId, prompt)).rejects.toThrow(/transport closed/i);
    }
    await vi.waitFor(() => expect(manager.state).toBe("stopped"));
  });

  test("bounds a wedged initialize request and retains stdout diagnostics", async ({ runtime }) => {
    vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", "banner");
    const { client, manager } = await runtime.start(python, [stub]);
    await expect(client.transport.request("initialize", { protocolVersion: 1, clientCapabilities: {} }, 5000))
      .rejects.toThrow(/timed out/);
    expect(manager.recentOutput).toContain("not json");
    await manager.stop();
    expect(manager.state).toBe("stopped");
  });

  test("preserves usage on a structured prompt failure", async ({ runtime }) => {
    vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", "prompt_internal_with_usage");
    const { client } = await runtime.start(python, [stub]);
    const sessionId = await initialize(client, runtime.workspace);
    await expect(client.prompt(sessionId, prompt)).rejects.toMatchObject({
      code: -32603, usage: { inputTokens: 8, outputTokens: 13, totalTokens: 21 },
    });
  });

  test("drains heavy stderr without blocking the protocol response", async ({ runtime }) => {
    vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", "stderr_flood");
    const { client, manager } = await runtime.start(python, [stub]);
    const sessionId = await initialize(client, runtime.workspace);
    expect((await client.prompt(sessionId, prompt)).stopReason).toBe("end_turn");
    expect(manager.recentOutput).toContain("[stderr] x");
  });
});


describe("Upstream scenarios through session presentation", () => {
  for (const scenario of ["response_then_eof", "update_error_response_then_eof"]) {
    test(`preserves the final response before EOF: ${scenario}`, async ({ runtime }) => {
      vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", scenario);
      const { client, manager } = await runtime.start(python, [stub]);
      const sessionId = await initialize(client, runtime.workspace);
      const owner = new ExtensionRuntime();
      owner.currentSessionId = sessionId;
      client.onSessionUpdate((id, update) => { void withRuntime(owner, () => handleSessionUpdate(id, update)); });
      if (scenario === "response_then_eof") {
        await expect(client.prompt(sessionId, prompt)).resolves.toMatchObject({ stopReason: "end_turn", usage: { totalTokens: 5 } });
      } else {
        await expect(client.prompt(sessionId, prompt)).rejects.toMatchObject({ code: -32602, details: "rejected" });
        expect(owner.transcript.messages.map(message => message.text)).toEqual(["pre"]);
      }
      await vi.waitFor(() => expect(manager.state).toBe("stopped"));
    });
  }

  for (const scenario of ["foreign_update", "malformed_foreign_update", "tool_anomalies", "message_id_boundaries"]) {
    test(`projects only the intended conversation state: ${scenario}`, async ({ runtime }) => {
      vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", scenario);
      const { client } = await runtime.start(python, [stub]);
      const sessionId = await initialize(client, runtime.workspace);
      const owner = new ExtensionRuntime();
      owner.currentSessionId = sessionId;
      client.onSessionUpdate((id, update) => { void withRuntime(owner, () => handleSessionUpdate(id, update)); });
      expect((await client.prompt(sessionId, prompt)).stopReason).toBe("end_turn");
      const messages = owner.transcript.messages;
      expect(messages.filter(message => message.kind === "error")).toEqual([]);
      if (scenario.includes("foreign")) {
        expect(messages.map(message => message.text)).toEqual(["local"]);
      } else if (scenario === "message_id_boundaries") {
        expect(messages.map(message => message.text)).toEqual(["first continuation", "second"]);
      } else {
        const tools = messages.filter(message => message.kind === "tool_call");
        expect(tools).toHaveLength(3);
        expect(tools.find(message => message.toolCallId === "tool-1")).toMatchObject({
          toolName: "late start", toolStatus: "failed", toolOutput: "duplicate terminal",
        });
        expect(tools.find(message => message.toolCallId === "tool-2")).toMatchObject({ toolName: "progress before start", toolInput: { a: 1 } });
        expect(tools.find(message => message.toolCallId === "tool-3")).toMatchObject({ toolStatus: "completed" });
      }
    });
  }

  for (const scenario of ["permission", "ask_user"]) for (const decision of (scenario === "permission" ? ["reject", "cancel", "throw", "absent"] : ["cancel", "throw", "absent"])) {
    test(`${scenario} resolves safely when the UI chooses ${decision}`, async ({ runtime }) => {
      vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", scenario);
      const { client } = await runtime.start(python, [stub]);
      const sessionId = await initialize(client, runtime.workspace);
      const owner = new ExtensionRuntime();
      const panel = {
        appendDebugEvent: vi.fn(), requestAttention: vi.fn(),
        setApprovalDialogState: vi.fn(), setAskUserDialogState: vi.fn(),
      } as unknown as ChatPanel;
      owner.chatPanel = panel;
      const approval = new ApprovalHandler(() => panel, () => null);
      const ask = new AskUserHandler(() => panel);
      let calls = 0;
      if (decision !== "absent") {
        client.onRequestPermission(req => withRuntime(owner, async () => {
          calls++;
          if (decision === "throw") throw new Error("UI failure");
          const response = approval.requestPermission(req);
          approval.resolve(decision === "reject" ? "deny" : undefined);
          return response;
        }));
        client.onRequestInput(req => withRuntime(owner, async () => {
          calls++;
          if (decision === "throw") throw new Error("UI failure");
          const response = ask.requestInput(req);
          ask.cancelActive("test cancellation");
          return response;
        }));
      }
      const texts: string[] = [];
      client.onSessionUpdate((_id, update) => {
        if (update.sessionUpdate === "agent_message_chunk") {
          const blocks = Array.isArray(update.content) ? update.content : [update.content];
          for (const block of blocks) if (block.type === "text") texts.push(block.text);
        }
      });
      expect((await client.prompt(sessionId, prompt)).stopReason).toBe("end_turn");
      expect(texts.join("")).toBe(scenario === "permission" ? "permission:cancelled" : "answer:");
      expect(calls).toBe(decision === "absent" ? 0 : 1);
      expect(owner.activeApprovalRequest).toBeNull();
      expect(owner.activeAskUserRequest).toBeNull();
    });
  }
});

for (const scenario of ["permission", "ask_user"]) {
  test(`closing a session releases a pending ${scenario} dialog`, async ({ runtime }) => {
    vi.stubEnv("CHRYS_ACP_STUB_SCENARIO", scenario);
    const { client } = await runtime.start(python, [stub]);
    await initialize(client, runtime.workspace);
    const { SessionManager } = await import("../../src/session/manager");
    const owner = new ExtensionRuntime();
    owner.sessionManager = new SessionManager(client);
    owner.currentSessionId = await owner.sessionManager.newSession(runtime.workspace);
    const panel = {
      appendDebugEvent: vi.fn(), requestAttention: vi.fn(),
      setApprovalDialogState: vi.fn(), setAskUserDialogState: vi.fn(),
    } as unknown as ChatPanel;
    owner.chatPanel = panel;
    owner.approvalHandler = new ApprovalHandler(() => panel, () => null);
    owner.askUserHandler = new AskUserHandler(() => panel);
    client.onRequestPermission(req => withRuntime(owner, () => owner.approvalHandler.requestPermission(req)));
    client.onRequestInput(req => withRuntime(owner, () => owner.askUserHandler.requestInput(req)));
    let finished = false;
    const completion = owner.sessionManager.sendPrompt(prompt).then(() => { finished = true; }, () => { finished = true; });
    await vi.waitFor(() => expect(scenario === "permission" ? owner.activeApprovalRequest : owner.activeAskUserRequest).not.toBeNull());
    await withRuntime(owner, () => owner.dropSession());
    await vi.waitFor(() => expect(finished).toBe(true));
    await completion;
    expect(owner.activeApprovalRequest).toBeNull();
    expect(owner.activeAskUserRequest).toBeNull();
    expect(scenario === "permission" ? panel.setApprovalDialogState : panel.setAskUserDialogState).toHaveBeenLastCalledWith(null);
  });
}
