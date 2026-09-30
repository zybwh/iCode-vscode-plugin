import { describe, expect } from "vitest";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";
import { test } from "../support/runtime";

function resolveBinary(): string {
  const explicit = process.env.ICODE_BINARY_PATH || process.env.CHRYS_BINARY_PATH;
  if (explicit) return path.resolve(explicit);
  const candidates = [
    path.resolve(__dirname, "../../../chrys/.venv/bin/chrys"),
    path.resolve(__dirname, "../../../dist/chrys"),
    path.resolve(__dirname, "../../../chrys/dist/chrys"),
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error("Set ICODE_BINARY_PATH to an official iCode release binary.");
  return found;
}

const expectedVersion = process.env.ICODE_EXPECTED_VERSION || "0.28.0";

describe("Public iCode ACP compatibility", () => {
  test("initializes and reads session-scoped runtime, MCP, skills and settings", async ({ runtime }) => {
    const { client } = await runtime.start(resolveBinary());
    const initialized = await client.initialize(1, { name: "icode-vsix-tests", version: "1" });
    expect(initialized.protocolVersion).toBe(1);
    expect(initialized.agentInfo?.version).toBe(expectedVersion);
    expect(initialized.agentCapabilities).toBeDefined();
    const { sessionId } = await client.newSession(runtime.workspace);
    expect(sessionId).toBeTruthy();
    const [snapshot, mutations, mcp, skills, settings] = await Promise.all([
      client.runtime(sessionId), client.mutations(sessionId), client.listMcp(sessionId),
      client.listSkills(sessionId), client.configOptions(),
    ]);
    expect(snapshot.sessionId).toBe(sessionId);
    expect(snapshot.runtimeDetails).toBeTruthy();
    expect(mutations).toBeDefined();
    expect(mcp.sessionId).toBe(sessionId);
    expect(mcp.mcpTools).toBeTypeOf("object");
    expect(mcp.mcpFailures).toBeTypeOf("object");
    expect(skills.sessionId).toBe(sessionId);
    expect(Array.isArray(skills.skillDetails)).toBe(true);
    expect(settings).toBeTypeOf("object");
    await expect(client.transport.request("chrys/session_runtime", { sessionId })).rejects.toMatchObject({ code: -32601 });
    await client.setApprovalMode(sessionId, "bypass");
    await client.closeSession(sessionId);
  });

  test("streams an offline mock turn, persists it and replays it through session/load", async ({ runtime }) => {
    const { client } = await runtime.start(resolveBinary());
    await client.initialize(1, { name: "icode-vsix-tests", version: "1" });
    const { sessionId } = await client.newSession(runtime.workspace);
    const profileId = randomUUID();
    await client.writeModelProfile({ id: profileId, name: "Integration mock", provider: "mock", model_id: "mock" });
    await client.setModel(sessionId, profileId);
    const live: string[] = [];
    const replay: string[] = [];
    const owners: string[] = [];
    let restoring = false;
    client.onSessionUpdate((owner, update) => {
      owners.push(owner);
      if (update.sessionUpdate === "agent_message_chunk") {
        const blocks = Array.isArray(update.content) ? update.content : [update.content];
        for (const block of blocks) if (block.type === "text") (restoring ? replay : live).push(block.text);
      }
    });
    expect((await client.prompt(sessionId, [{ type: "text", text: "Offline fixture" }])).stopReason).toBe("end_turn");
    expect(live.join("")).toContain("[No more scripted responses]");
    expect((await client.listSessions(runtime.workspace)).sessions.some(session => session.sessionId === sessionId)).toBe(true);
    await client.closeSession(sessionId);
    restoring = true;
    await client.loadSession(runtime.workspace, sessionId);
    expect(replay.join("")).toBe(live.join(""));
    expect(new Set(owners)).toEqual(new Set([sessionId]));
    await client.closeSession(sessionId);
    await client.deleteModelProfile(profileId);
  });

  test("keeps B usable after A stops without confusing session identities", async ({ runtime }) => {
    const [first, second] = await Promise.all([runtime.start(resolveBinary()), runtime.start(resolveBinary())]);
    const [a, b] = await Promise.all([first, second].map(async ({ client }) => {
      await client.initialize(1, { name: "icode-vsix-tabs", version: "1" });
      return client.newSession(runtime.workspace);
    }));
    expect(a.sessionId).not.toBe(b.sessionId);
    expect((await first.client.runtime(a.sessionId)).sessionId).toBe(a.sessionId);
    await first.client.closeSession(a.sessionId);
    await first.manager.stop();
    expect((await second.client.runtime(b.sessionId)).sessionId).toBe(b.sessionId);
    await second.client.closeSession(b.sessionId);
  });

  test("preserves granted roots across close/load and persists explicit clearing", async ({ runtime }) => {
    const extra = path.join(runtime.workspace, "extra");
    fs.mkdirSync(extra);
    const { client } = await runtime.start(resolveBinary());
    await client.initialize(1, { name: "icode-vsix-roots", version: "1" });
    const { sessionId } = await client.newSession(runtime.workspace, [extra]);
    const profileId = randomUUID();
    await client.writeModelProfile({ id: profileId, name: "Roots mock", provider: "mock", model_id: "mock" });
    await client.setModel(sessionId, profileId);
    await client.prompt(sessionId, [{ type: "text", text: "Persist roots" }]);
    await client.closeSession(sessionId);
    await client.loadSession(runtime.workspace, sessionId);
    expect((await client.listSessions(runtime.workspace)).sessions.find(s => s.sessionId === sessionId)?.additionalDirectories)
      .toEqual([fs.realpathSync(extra)]);
    await client.closeSession(sessionId);
    await client.loadSession(runtime.workspace, sessionId, []);
    await client.setModel(sessionId, profileId);
    await client.prompt(sessionId, [{ type: "text", text: "Persist cleared roots" }]);
    expect((await client.listSessions(runtime.workspace)).sessions.find(s => s.sessionId === sessionId)?.additionalDirectories ?? []).toEqual([]);
    await client.closeSession(sessionId);
    await client.deleteModelProfile(profileId);
  });
});

// Kept as a separate selection for the platform-package CI matrix.
describe("Packaged runtime startup", () => {
  test("checks the selected runtime version and ACP session lifecycle", async ({ runtime }) => {
    const { client } = await runtime.start(resolveBinary());
    const initialized = await client.initialize(1, { name: "icode-vsix-runtime-smoke", version: "1" });
    expect(initialized.agentInfo?.version).toBe(expectedVersion);
    expect(initialized.protocolVersion).toBe(1);
    const { sessionId } = await client.newSession(runtime.workspace);
    expect((await client.runtime(sessionId)).sessionId).toBe(sessionId);
    await client.closeSession(sessionId);
  });
});
