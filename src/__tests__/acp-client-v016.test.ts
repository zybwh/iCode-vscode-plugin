import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ChrysAcpClient } from "../acp/client";
import type { ContextPressureNotification, RuntimeSnapshot } from "../acp/types";

function attachClient(): { client: ChrysAcpClient; agentToClient: PassThrough; clientToAgent: PassThrough } {
  const client = new ChrysAcpClient();
  const agentToClient = new PassThrough();
  const clientToAgent = new PassThrough();
  client.transport.attach(clientToAgent, agentToClient);
  return { client, agentToClient, clientToAgent };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("iCode ACP v0.22.5 notifications", () => {
  it("unwraps chrys runtime_update envelope payloads", async () => {
    const { client, agentToClient } = attachClient();
    const updates: RuntimeSnapshot[] = [];
    client.onRuntimeUpdate((update) => updates.push(update));

    agentToClient.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "_chrys/runtime_update",
      params: {
        sessionId: "s1",
        runtime: {
          sessionId: "s1",
          agentProfile: "Code",
          displayName: "Code",
          modelProfileId: "m1",
          maxContextTokens: 1000,
          runtimeDetails: { model: { profile_id: "m1", name: "DeepSeek" } },
        },
      },
    }) + "\n");

    await flush();

    expect(updates).toHaveLength(1);
    expect(updates[0].sessionId).toBe("s1");
    expect(updates[0].agentProfile).toBe("Code");
    expect(updates[0].modelProfileId).toBe("m1");
    expect(updates[0].runtimeDetails?.model?.name).toBe("DeepSeek");
  });

  it("still accepts the older flat runtime_update payload shape", async () => {
    const { client, agentToClient } = attachClient();
    const updates: RuntimeSnapshot[] = [];
    client.onRuntimeUpdate((update) => updates.push(update));

    agentToClient.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "_chrys/runtime_update",
      params: {
        sessionId: "s1",
        agentProfile: "Plan",
        modelProfileId: "m2",
      },
    }) + "\n");

    await flush();

    expect(updates).toEqual([{ sessionId: "s1", agentProfile: "Plan", modelProfileId: "m2" }]);
  });

  it("routes main and sub-agent compaction notifications", async () => {
    const { client, agentToClient } = attachClient();
    const events: Array<{ method: string; compactionId: string; outcome?: string }> = [];
    client.onCompaction((method, update) => {
      events.push({ method, compactionId: update.compactionId, outcome: "outcome" in update ? update.outcome : undefined });
    });

    agentToClient.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "_chrys/compaction_started",
      params: { sessionId: "s1", compactionId: "c1", phase: "phase4" },
    }) + "\n");
    agentToClient.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "_chrys/sub_agent_compaction_finished",
      params: {
        sessionId: "s1",
        agentName: "Explore",
        invocationId: "i1",
        compactionId: "c2",
        outcome: "ok",
        durationMs: 42,
        formatViolation: "missing Next heading",
      },
    }) + "\n");
    agentToClient.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "_chrys/sub_agent_compaction_committed",
      params: { sessionId: "s1", agentName: "Explore", invocationId: "i1", compactionId: "c2", phase: "phase4" },
    }) + "\n");

    await flush();

    expect(events).toEqual([
      { method: "_chrys/compaction_started", compactionId: "c1", outcome: undefined },
      { method: "_chrys/sub_agent_compaction_finished", compactionId: "c2", outcome: "ok" },
      { method: "_chrys/sub_agent_compaction_committed", compactionId: "c2", outcome: undefined },
    ]);
  });

  it("routes context pressure diagnostics", async () => {
    const { client, agentToClient } = attachClient();
    const events: ContextPressureNotification[] = [];
    client.onContextPressure((update) => events.push(update));

    agentToClient.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "_chrys/context_pressure",
      params: {
        sessionId: "s1",
        reason: "side-call budget exhausted",
        attempts: 3,
        sideCallTokens: 12000,
        sideCallTokenBudget: 12000,
        source: "sub_agent",
        invocationId: "i1",
      },
    }) + "\n");

    await flush();

    expect(events).toEqual([{
      sessionId: "s1",
      reason: "side-call budget exhausted",
      attempts: 3,
      sideCallTokens: 12000,
      sideCallTokenBudget: 12000,
      source: "sub_agent",
      invocationId: "i1",
    }]);
  });
});
