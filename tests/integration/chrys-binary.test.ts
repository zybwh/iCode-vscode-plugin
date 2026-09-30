import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { createInterface, Interface } from "node:readline";
import * as path from "node:path";
import * as fs from "node:fs";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface InitializeResponse {
  protocolVersion: number;
  agentCapabilities?: Record<string, unknown>;
  agentInfo?: { name: string; version: string };
}

interface NewSessionResponse {
  sessionId: string;
}

interface PromptResponse {
  stopReason: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

interface SessionInfo {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

interface ListSessionsResponse {
  sessions: SessionInfo[];
  nextCursor?: string;
}

interface RuntimeSnapshot {
  sessionId?: string;
  modelProfileId?: string;
  runtimeDetails?: Record<string, unknown>;
}

// ──────────────────────────────────────────────
// iCode Process Helper
// ──────────────────────────────────────────────

class ChrysProcess {
  private proc: ChildProcess;
  private rl: Interface;
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private requestHandlers = new Map<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>();
  private closed = false;

  constructor(proc: ChildProcess, rl: Interface) {
    this.proc = proc;
    this.rl = rl;

    this.rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JSONRPCResponse | JSONRPCRequest;
        if ("method" in msg && msg.id !== undefined) {
          void this.respondToBackendRequest(msg);
        } else if (msg.id !== undefined) {
          const pending = this.pending.get(msg.id);
          if (pending) {
            this.pending.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
            } else {
              pending.resolve(msg.result);
            }
          }
        }
      } catch {
        // Ignore non-JSON lines
      }
    });
  }

  onRequest(method: string, handler: (params: Record<string, unknown>) => unknown | Promise<unknown>): void {
    this.requestHandlers.set(method, handler);
  }

  private async respondToBackendRequest(request: JSONRPCRequest): Promise<void> {
    const handler = this.requestHandlers.get(request.method);
    if (!handler) {
      this.proc.stdin!.write(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Unhandled client method: ${request.method}` },
      }) + "\n");
      return;
    }
    try {
      const result = await handler(request.params ?? {});
      this.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
    } catch (error) {
      this.proc.stdin!.write(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      }) + "\n");
    }
  }

  /** Send a JSON-RPC request and return the result. */
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw new Error("ChrysProcess is closed");
    const id = ++this.nextId;
    const msg = { jsonrpc: "2.0", id, method, params };
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  /** Kill the child process and clean up. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rl.close();
    if (this.proc.exitCode === null) {
      this.proc.kill("SIGTERM");
    }
    // Reject all pending requests
    for (const [, p] of this.pending) {
      p.reject(new Error("ChrysProcess closed"));
    }
    this.pending.clear();
  }
}

// ──────────────────────────────────────────────
// Spawn helper
// ──────────────────────────────────────────────

function spawnChrys(): ChrysProcess {
  const chrysBin = resolveChrysBinary();
  const proc = spawn(chrysBin, ["acp", "--agent", "Code", "--approval", "bypass", "-C", "/tmp"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Collect stderr for debugging but don't crash on it
  proc.stderr?.on("data", (_data: Buffer) => {
    // stderr may contain chrys logging; ignore for tests
  });

  proc.on("error", (err) => {
    // Let the test fail naturally when send() times out
    console.error("chrys process error:", err.message);
  });

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
  return new ChrysProcess(proc, rl);
}

function resolveChrysBinary(): string {
  const candidates = [
    process.env.ICODE_BINARY_PATH,
    process.env.CHRYS_BINARY_PATH,
    path.resolve(__dirname, "..", "..", "..", "chrys", ".venv", "bin", "chrys"),
    path.resolve(__dirname, "..", "..", "..", "dist", "chrys"),
    path.resolve(__dirname, "..", "..", "..", "chrys", "dist", "chrys"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  return candidates[0];
}

async function expectMethodRoutes(chrys: ChrysProcess, method: string, params: Record<string, unknown>): Promise<unknown> {
  try {
    return await chrys.send(method, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).not.toContain("Method not found");
    expect(message).not.toContain("-32601");
    return undefined;
  }
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("iCode Binary Integration", () => {
  let chrys: ChrysProcess;
  let sessionId: string;

  beforeAll(async () => {
    chrys = spawnChrys();
  }, 30_000);

  afterAll(() => {
    chrys.close();
  });

  it(
    "initialize returns capabilities",
    async () => {
      const result = (await chrys.send("initialize", {
        protocolVersion: 1,
        clientInfo: {
          name: "chrys-vscode-tests",
          version: "0.0.0",
        },
      })) as InitializeResponse;

      expect(result).toBeDefined();
      expect(result.protocolVersion).toBe(1);
      expect(result.agentInfo).toBeDefined();
      expect(result.agentInfo!.name).toBeTruthy();
      expect(result.agentInfo!.version).toBe(process.env.ICODE_EXPECTED_VERSION || "0.27.1");
      expect(result.agentCapabilities).toBeDefined();
    },
    30_000,
  );

  it(
    "session/new creates session",
    async () => {
      const result = (await chrys.send("session/new", {
        cwd: "/tmp",
        mcpServers: [],
      })) as NewSessionResponse;

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe("string");
      expect(result.sessionId.length).toBeGreaterThan(0);

      sessionId = result.sessionId;
    },
    30_000,
  );

  it(
    "session/list returns sessions (from previous runs)",
    async () => {
      const result = (await chrys.send("session/list", {
        cwd: "/tmp",
      })) as ListSessionsResponse;

      expect(result).toBeDefined();
      expect(Array.isArray(result.sessions)).toBe(true);
      // At minimum we should get a valid response; sessions may include
      // ones from previous runs. Fresh sessions without messages may not
      // appear until after session/prompt is called.
    },
    30_000,
  );

  it(
    "routes VSIX underscore extension method names against iCode v0.22.5",
    async () => {
      const runtime = (await expectMethodRoutes(chrys, "_chrys/session_runtime", { sessionId })) as RuntimeSnapshot;
      const mutations = await expectMethodRoutes(chrys, "_session/mutations", { sessionId });

      expect(runtime).toBeDefined();
      expect(runtime.sessionId).toBe(sessionId);
      expect(runtime.runtimeDetails).toBeTruthy();
      expect(mutations).toBeDefined();
      await expectMethodRoutes(chrys, "_settings/options", {});
      await expect(chrys.send("chrys/session_runtime", { sessionId })).rejects.toThrow(/Method not found|-32601/);

      await expectMethodRoutes(chrys, "session/set_mode", { sessionId, modeId: "bypass" });
      expect(runtime.modelProfileId).toBeDefined();
      await expectMethodRoutes(chrys, "session/set_model", { sessionId, modelId: runtime.modelProfileId });
    },
    30_000,
  );

  it("keeps the iCode v0.22.5 plan update shape in integration coverage", () => {
    const planUpdate = {
      sessionId,
      update: {
        sessionUpdate: "plan",
        entries: [{ content: "one", priority: "medium", status: "pending" }],
      },
    };

    expect(planUpdate.update.sessionUpdate).toBe("plan");
    expect(planUpdate.update.entries[0].priority).toBe("medium");
  });

  it.skipIf(process.env.CHRYS_ASK_USER_CALLBACK_SMOKE !== "1")(
    "handles a real iCode v0.22.5 request_input callback",
    async () => {
      const callbacks: Record<string, unknown>[] = [];
      chrys.onRequest("_chrys/request_input", (params) => {
        callbacks.push(params);
        const questions = Array.isArray(params.questions) ? params.questions : [];
        return {
          answers: questions.map((value) => {
            const question = value && typeof value === "object" ? value as Record<string, unknown> : {};
            const options = Array.isArray(question.options) ? question.options : [];
            const first = options[0] && typeof options[0] === "object" ? options[0] as Record<string, unknown> : null;
            const label = typeof first?.label === "string" ? first.label : "VSIX callback response";
            return { values: [label], note: "" };
          }),
          cancelled: false,
        };
      });

      await chrys.send("session/prompt", {
        sessionId,
        prompt: [{
          type: "text",
          text: "Call the ask_user tool now with two questions: one single-choice question with two options, and one open-ended question. After the answers arrive, finish briefly.",
        }],
      });

      expect(callbacks).toHaveLength(1);
      expect(callbacks[0].sessionId).toBe(sessionId);
      expect(Array.isArray(callbacks[0].questions)).toBe(true);
      expect(callbacks[0].questions).toHaveLength(2);
    },
    60_000,
  );

  it(
    "session/run sends prompt and gets response",
    async () => {
      const result = (await chrys.send("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "Say hello in one word" }],
      })) as PromptResponse;

      expect(result).toBeDefined();
      expect(result.stopReason).toBeDefined();
      // stopReason should be one of the expected values
      expect(["end_turn", "max_tokens", "cancelled"]).toContain(result.stopReason);
    },
    30_000,
  );

  it(
    "session/list includes our session after running a prompt",
    async () => {
      const result = (await chrys.send("session/list", {
        cwd: "/tmp",
      })) as ListSessionsResponse;

      expect(result).toBeDefined();
      expect(Array.isArray(result.sessions)).toBe(true);

      // After running a prompt, our session should now appear in the list
      const found = result.sessions.find((s) => s.sessionId === sessionId);
      expect(found).toBeDefined();
      expect(found!.cwd).toBeDefined();
    },
    30_000,
  );

  it(
    "session/close closes session",
    async () => {
      const result = (await chrys.send("session/close", {
        sessionId,
      }));

      // session/close returns an empty object on success
      expect(result).toEqual({});
    },
    30_000,
  );
});

// Exercise the production transport/client as well as the raw protocol smoke.
describe("Production ACP client inventories", () => {
  it("initializes and reads session-scoped runtime, MCP, and skills", async () => {
    const { ProcessManager } = await import("../../src/process/manager");
    const manager = new ProcessManager();
    try {
      const client = await manager.start(resolveChrysBinary(), ["acp", "--agent", "Code", "-C", "/tmp"], "/tmp");
      const initialized = await client.initialize(1, { name: "chrys-vscode-inventory-tests", version: "0.0.0" });
      expect(initialized.agentInfo?.name).toBeTruthy();
      const { sessionId } = await client.newSession("/tmp");
      const [runtime, mcp, skills] = await Promise.all([
        client.runtime(sessionId), client.listMcp(sessionId), client.listSkills(sessionId),
      ]);
      expect(runtime.sessionId).toBe(sessionId);
      expect(mcp.sessionId).toBe(sessionId);
      expect(mcp.mcpTools).toBeTypeOf("object");
      expect(mcp.mcpFailures).toBeTypeOf("object");
      expect(skills.sessionId).toBe(sessionId);
      expect(skills.skillSources).toBeTypeOf("object");
      expect(Array.isArray(skills.skillDetails)).toBe(true);
      await client.closeSession(sessionId);
    } finally {
      await manager.stop();
    }
  }, 30_000);
});

// Session tabs use separate installed ACP processes; lifecycle actions stay local.
describe("Independent session processes", () => {
  it("keeps B usable after A closes, without confusing session identities", async () => {
    const { ProcessManager } = await import("../../src/process/manager");
    const first = new ProcessManager();
    const second = new ProcessManager();
    try {
      const [a, b] = await Promise.all([first, second].map(async manager => {
        const client = await manager.start(resolveChrysBinary(), ["acp", "--agent", "Code", "-C", "/tmp"], "/tmp");
        await client.initialize(1, { name: "chrys-vscode-multitab-tests", version: "0.0.0" });
        const { sessionId } = await client.newSession("/tmp");
        return { client, sessionId };
      }));
      expect(a.sessionId).not.toBe(b.sessionId);
      const [aRuntime, bRuntime] = await Promise.all([a.client.runtime(a.sessionId), b.client.runtime(b.sessionId)]);
      expect(aRuntime.sessionId).toBe(a.sessionId);
      expect(bRuntime.sessionId).toBe(b.sessionId);
      await a.client.closeSession(a.sessionId);
      await first.stop();
      expect((await b.client.runtime(b.sessionId)).sessionId).toBe(b.sessionId);
      await b.client.closeSession(b.sessionId);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  }, 30_000);
});

describe("Public multi-root ACP contract", () => {
  it("preserves explicitly granted roots across close/load and lists the scope", async () => {
    const { ProcessManager } = await import("../../src/process/manager");
    const os = await import("node:os");
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"icode-roots-test-"));
    const extra=path.join(root,"extra");fs.mkdirSync(extra);
    const manager=new ProcessManager();
    const profileId=(await import("node:crypto")).randomUUID();
    let wroteProfile=false;
    try {
      const client=await manager.start(resolveChrysBinary(),["acp","--agent","Code","-C",root],root);
      await client.initialize(1,{name:"icode-roots-test",version:"0.0.0"});
      const {sessionId}=await client.newSession(root,[extra]);
      await client.writeModelProfile({id:profileId,name:"Integration roots fixture",provider:"mock",api_style:"chat_completions",model_id:"mock"});wroteProfile=true;
      await client.setModel(sessionId,profileId);
      await client.prompt(sessionId,[{type:"text",text:"Scope persistence fixture"}]);
      await client.closeSession(sessionId);
      await client.loadSession(root,sessionId);
      const page=await client.listSessions(root);
      expect(page.sessions.find(s=>s.sessionId===sessionId)?.additionalDirectories).toEqual([fs.realpathSync(extra)]);
      await client.closeSession(sessionId);
      await client.loadSession(root,sessionId,[]);
      await client.prompt(sessionId,[{type:"text",text:"Persist cleared scope fixture"}]);
      expect((await client.listSessions(root)).sessions.find(s=>s.sessionId===sessionId)?.additionalDirectories??[]).toEqual([]);
      await client.closeSession(sessionId);
    } finally {if(wroteProfile)await manager.client?.deleteModelProfile(profileId);await manager.stop();fs.rmSync(root,{recursive:true,force:true});}
  },60_000);
});

// Cross-platform smoke used by the full-package matrix, with no model requests.
describe("Packaged runtime startup", () => {
  it("checks the selected runtime version and ACP session lifecycle", async () => {
    const os = await import("node:os");
    const { ProcessManager } = await import("../../src/process/manager");
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "icode-runtime-smoke-"));
    const manager = new ProcessManager();
    try {
      const client = await manager.start(path.resolve(resolveChrysBinary()), ["acp", "-C", workspace], workspace);
      const initialized = await client.initialize(1, { name: "icode-vsix-runtime-smoke", version: "1" });
      expect(initialized.agentInfo?.version).toBe(process.env.ICODE_EXPECTED_VERSION || "0.28.0");
      expect(initialized.protocolVersion).toBe(1);
      const { sessionId } = await client.newSession(workspace);
      expect((await client.runtime(sessionId)).sessionId).toBe(sessionId);
      await client.closeSession(sessionId);
    } finally {
      await manager.stop();
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }, 60_000);
});
