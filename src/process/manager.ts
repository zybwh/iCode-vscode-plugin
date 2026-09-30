import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { ChrysAcpClient } from "../acp/client";

type ProcessState = "stopped" | "starting" | "running" | "error";

export type ProcessEvent = "connected" | "disconnected" | "error" | "stderr" | "stdout" | "started";

type EventHandler = (...args: unknown[]) => void;

const MAX_CONSECUTIVE_CRASHES = 3;
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
  private _crashCount = 0;
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

    this._child = spawnChrysProcess(binaryPath, args, cwd);

    // Collect stderr for debugging
    let stderrTail = "";
    if (this._child.stderr) {
      this._child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        this._rememberOutput("stderr", text);
        stderrTail = `${stderrTail}${text}`.slice(-64 * 1024);
        this._emit("stderr", text);
      });
    }

    this._child.on("error", (err: Error) => {
      this._handleExit("error", err.message);
    });

    this._child.on("exit", (code: number | null, signal: string | null) => {
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      this._handleExit(reason, stderrTail);
    });

    // Wire up ACP client to stdio
    const client = new ChrysAcpClient();
    const stdin = this._child.stdin!;
    const stdout = this._child.stdout!;

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
    this._crashCount = 0;

    this._emit("connected", client);
    return client;
  }

  /** Gracefully stop the chrys process. */
  async stop(): Promise<void> {
    this._client?.transport.detach();
    this._crashCount = MAX_CONSECUTIVE_CRASHES; // prevent auto-restart
    if (this._child) {
      this._child.removeAllListeners();
      // A .cmd launcher owns a Python/CLI child; stopping only cmd.exe leaves it running.
      if (process.platform === "win32" && this._child.pid && this._child.exitCode === null) {
        await stopWindowsProcessTree(this._child.pid);
      }
      if (this._child.exitCode === null && this._child.signalCode === null) {
        this._child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (this._child && this._child.exitCode === null) {
              this._child.kill("SIGKILL");
            }
            resolve();
          }, SHUTDOWN_TIMEOUT_MS);

          this._child!.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      this._child = null;
    }
    this._client = null;
    this._state = "stopped";
  }

  // ── Private ────────────────────────────────

  private _handleExit(reason: string, stderr: string): void {
    const wasRunning = this._state === "running";
    this._state = "stopped";
    this._child = null;

    if (this._client) {
      this._client.transport.detach();
      this._client = null;
    }

    this._emit("disconnected", reason);

    if (wasRunning && this._crashCount < MAX_CONSECUTIVE_CRASHES) {
      this._crashCount++;
      // Auto-restart will be handled by extension.ts which listens for "disconnected"
    }

    if (this._crashCount >= MAX_CONSECUTIVE_CRASHES) {
      this._state = "error";
      const recentOutput = this.recentOutput;
      this._emit("error", `iCode process crashed ${this._crashCount} times: ${reason}.${stderr ? " Stderr: " + stderr : ""}${recentOutput ? "\nRecent output:\n" + recentOutput : ""}`);
    }
  }
}
