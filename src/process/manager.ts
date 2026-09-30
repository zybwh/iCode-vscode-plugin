import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { ChrysAcpClient } from "../acp/client";

type ProcessState = "stopped" | "starting" | "running";

export type ProcessEvent = "connected" | "disconnected" | "stderr" | "stdout" | "started";

type EventHandler = (...args: unknown[]) => void;

const SHUTDOWN_TIMEOUT_MS = 5000;
const RECENT_OUTPUT_LIMIT = 80;

const ELECTRON_ENV_PREFIXES = ["ELECTRON_", "VSCODE_", "NODE_OPTIONS", "ORIGINAL_"];
const ELECTRON_ENV_KEYS = new Set(["ATOM_HOME", "CHROME_DESKTOP", "GOOGLE_API_KEY", "NODE_ENV"]);

function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (ELECTRON_ENV_KEYS.has(key)) continue;
    if (ELECTRON_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function isWindowsCommandScript(binaryPath: string): boolean {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(binaryPath);
}

function quoteCmdArg(arg: string): string {
  return `"${arg.replace(/(["^&|<>%])/g, "^$1")}"`;
}

function spawnChrysProcess(binaryPath: string, args: string[], cwd?: string): ChildProcess {
  const env = cleanEnv(process.env);
  if (isWindowsCommandScript(binaryPath)) {
    const command = [quoteCmdArg(binaryPath), ...args.map(quoteCmdArg)].join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
      // Match Node's cmd.exe shell convention; libuv must not re-escape these quotes.
      windowsVerbatimArguments: true,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
  }
  return spawn(binaryPath, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
}

async function stopWindowsProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { killer.kill(); resolve(); }, SHUTDOWN_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); resolve(); };
    killer.once("error", done);
    killer.once("close", done);
  });
}

export class ProcessManager {
  private _state: ProcessState = "stopped";
  private _child: ChildProcess | null = null;
  private _cancelStart: ((error: Error) => void) | null = null;
  private _client: ChrysAcpClient | null = null;
  private _handlers = new Map<ProcessEvent, EventHandler[]>();
  private _recentOutput: string[] = [];

  get state(): ProcessState {
    return this._state;
  }

  get client(): ChrysAcpClient | null {
    return this._client;
  }

  get recentOutput(): string {
    return this._recentOutput.join("\n");
  }

  // ── Events ─────────────────────────────────

  on(event: ProcessEvent, handler: EventHandler): void {
    const handlers = this._handlers.get(event) ?? [];
    handlers.push(handler);
    this._handlers.set(event, handlers);
  }

  private _emit(event: ProcessEvent, ...args: unknown[]): void {
    for (const h of this._handlers.get(event) ?? []) {
      h(...args);
    }
  }

  private _rememberOutput(stream: "stdout" | "stderr", text: string): void {
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      this._recentOutput.push(`[${stream}] ${trimmed}`);
    }
    if (this._recentOutput.length > RECENT_OUTPUT_LIMIT) {
      this._recentOutput.splice(0, this._recentOutput.length - RECENT_OUTPUT_LIMIT);
    }
  }

  // ── Lifecycle ──────────────────────────────

  /** Spawn the chrys binary and return the connected ACP client. */
  async start(binaryPath: string, args: string[] = ["acp"], cwd?: string): Promise<ChrysAcpClient> {
    if (this._state !== "stopped") {
      throw new Error(`Cannot start: process is ${this._state}`);
    }
    this._state = "starting";
    this._recentOutput = [];

    this._emit("started", binaryPath, args);

    const child = spawnChrysProcess(binaryPath, args, cwd);
    this._child = child;

    // Collect stderr for debugging
    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this._rememberOutput("stderr", text);
      stderrTail = `${stderrTail}${text}`.slice(-64 * 1024);
      this._emit("stderr", text);
    });

    // A missing or non-executable binary reports "error" instead of "spawn"; reject
    // start() so the caller shows one setup error instead of a restart loop.
    try {
      await new Promise<void>((resolve, reject) => {
        this._cancelStart = reject;
        child.once("spawn", () => {
          child.off("error", reject);
          resolve();
        });
        child.once("error", reject);
      });
    } catch (error) {
      if (this._child === child) {
        this._child = null;
        this._state = "stopped";
      }
      throw error;
    } finally {
      this._cancelStart = null;
    }
    if (this._child !== child) throw new Error("iCode process was stopped while starting");

    // Node can emit both "error" and "exit" for one child; only the first report counts.
    child.on("error", (err: Error) => {
      this._handleExit(child, "error", err.message);
    });
    child.on("exit", (code: number | null, signal: string | null) => {
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      this._handleExit(child, reason, stderrTail);
    });

    // Wire up ACP client to stdio
    const client = new ChrysAcpClient();
    const stdin = child.stdin!;
    const stdout = child.stdout!;

    // PassThrough allows us to use readline on stdout
    const passThrough = new PassThrough();
    stdout.pipe(passThrough);

    client.transport.attach(stdin, passThrough);
    client.transport.onNonJsonLine((line) => {
      this._rememberOutput("stdout", line);
      this._emit("stdout", line);
    });

    this._client = client;
    this._state = "running";

    this._emit("connected", client);
    return client;
  }

  /** Gracefully stop the chrys process. */
  async stop(): Promise<void> {
    this._client?.transport.detach();
    const child = this._child;
    this._child = null;
    this._cancelStart?.(new Error("iCode process was stopped while starting"));
    if (child) {
      child.removeAllListeners();
      // Keep a late spawn/kill error from surfacing as an unhandled "error" event.
      child.on("error", () => {});
      // A .cmd launcher owns a Python/CLI child; stopping only cmd.exe leaves it running.
      if (process.platform === "win32" && child.pid && child.exitCode === null) {
        await stopWindowsProcessTree(child.pid);
      }
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
            resolve();
          }, SHUTDOWN_TIMEOUT_MS);
          child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
          child.kill("SIGTERM");
        });
      }
    }
    this._client = null;
    this._state = "stopped";
  }

  // ── Private ────────────────────────────────

  private _handleExit(child: ChildProcess, reason: string, stderr: string): void {
    if (this._child !== child) return;
    this._state = "stopped";
    this._child = null;

    if (this._client) {
      this._client.transport.detach();
      this._client = null;
    }

    const recentOutput = this.recentOutput;
    const detail = [
      reason,
      stderr.trim() ? `Stderr: ${stderr.trim().slice(-2000)}` : "",
      recentOutput ? `Recent output:\n${recentOutput}` : "",
    ].filter(Boolean).join("\n");
    // Auto-restart and its attempt limit are owned by extension.ts, which listens for "disconnected".
    this._emit("disconnected", reason, detail);
  }
}
