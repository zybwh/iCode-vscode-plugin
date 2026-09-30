import * as readline from "node:readline";
import { Writable, Readable } from "node:stream";
import type { JSONRPCRequest, JSONRPCResponse, JSONRPCNotification, JSONRPCMessage, RequestId } from "./types";

// ──────────────────────────────────────────────
// Internal types
// ──────────────────────────────────────────────

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | null;
};

type IncomingHandler = (method: string, params: unknown, respond: (result: unknown) => void) => void | Promise<void>;

// ──────────────────────────────────────────────
// AcpClient
// ──────────────────────────────────────────────

const LINE_TERMINATOR = "\n";
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Session creation and history replay can be slow on first run or for long sessions. */
export const SESSION_LIFECYCLE_TIMEOUT_MS = 10 * 60_000;

export class AcpRequestError extends Error {
  readonly details: unknown;
  readonly usage: unknown;

  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    const dataRecord = asRecord(data);
    const detailText = displayErrorDetail(typeof data === "string" ? data : dataRecord?.details ?? dataRecord?.detail);
    const nestedMessage = typeof dataRecord?.message === "string" && dataRecord.message !== message
      ? dataRecord.message
      : "";
    super([`ACP error ${code}: ${message}`, nestedMessage, detailText].filter(Boolean).join(" - "));
    this.name = "AcpRequestError";
    this.details = dataRecord?.details;
    this.usage = dataRecord?.usage;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function displayErrorDetail(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export class AcpClient {
  private nextId = 0;
  private pending = new Map<RequestId, PendingRequest>();
  private nonJsonLineHandler: ((line: string) => void) | null = null;
  private reader: Readable | null = null;
  private readonly transportError = () => this.detach();
  private handler: IncomingHandler | null = null;
  private rl: readline.Interface | null = null;
  private writer: Writable | null = null;

  // ── Lifecycle ──────────────────────────────

  /**
   * Attach to a stdio stream pair. Starts reading line-delimited JSON.
   */
  attach(writer: Writable, reader: Readable): void {
    this.detach();
    this.writer = writer;
    this.reader = reader;
    writer.on("error", this.transportError);
    reader.on("error", this.transportError);
    this.rl = readline.createInterface({ input: reader, crlfDelay: Infinity });
    const rl = this.rl;
    rl.on("close", () => { if (this.rl === rl) this.detach(); });
    this.rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as JSONRPCMessage;
        this._dispatch(msg);
      } catch {
        this.nonJsonLineHandler?.(trimmed);
      }
    });
  }

  /** Detach and clean up. */
  detach(): void {
    if (this.rl) {
      const rl = this.rl;
      this.rl = null;
      rl.close();
    }
    this.writer?.off("error", this.transportError);
    this.reader?.off("error", this.transportError);
    this.reader = null;
    this.writer = null;
    this.pending.forEach((pending) => {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new Error("ACP transport closed"));
    });
    this.pending.clear();
  }

  // ── Client → Agent (requests) ──────────────

  /** Send a JSON-RPC request, returning the result. */
  async request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = ++this.nextId;
    const msg: JSONRPCRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`ACP request timed out after ${timeoutMs} ms: ${method}`));
          }, timeoutMs)
        : null;
      this.pending.set(id, { resolve, reject, timeout });
      try {
        // Register before writing: an in-memory transport can synchronously
        // return the response from Writable.write().
        this._write(msg);
      } catch (error) {
        this.pending.delete(id);
        if (timeout) clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Send a JSON-RPC notification (no response expected). */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    const msg: JSONRPCNotification = { jsonrpc: "2.0", method, params };
    this._write(msg);
  }

  // ── Agent → Client (incoming requests/notifications) ──

  /**
   * Register a handler for incoming messages from the agent.
   * Called for both requests (has id + method) and notifications (method, no id).
   * For requests, `respond(result)` sends back the JSON-RPC response.
   */
  onMessage(handler: IncomingHandler): void {
    this.handler = handler;
  }

  onNonJsonLine(handler: (line: string) => void): void {
    this.nonJsonLineHandler = handler;
  }

  // ── Internal ───────────────────────────────

  private _write(msg: JSONRPCMessage): void {
    if (!this.writer) throw new Error("AcpClient not attached");
    this.writer.write(JSON.stringify(msg) + LINE_TERMINATOR);
  }

  private _dispatch(msg: JSONRPCMessage): void {
    const hasId = "id" in msg;
    const hasMethod = "method" in msg;

    if (hasMethod) {
      const writer = this.writer;
      let replied = false;
      const reply = (response: Omit<JSONRPCResponse, "jsonrpc" | "id">) => {
        if (!hasId || replied || !writer || writer !== this.writer) return;
        replied = true;
        this._write({ jsonrpc: "2.0", id: (msg as JSONRPCRequest).id, ...response });
      };
      const failed = (error: unknown) => reply({ error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Internal ACP client error",
      } });
      if (!this.handler) {
        reply({ error: { code: -32601, message: "Unsupported client method" } });
        return;
      }
      try {
        const handled = this.handler((msg as JSONRPCRequest).method, (msg as JSONRPCRequest).params, (result) => reply({ result }));
        void Promise.resolve(handled).catch(failed);
      } catch (error) {
        failed(error);
      }
    } else if (hasId && !hasMethod) {
      // Response to our request
      const response = msg as JSONRPCResponse;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (pending.timeout) clearTimeout(pending.timeout);

      if (response.error) {
        pending.reject(new AcpRequestError(response.error.code, response.error.message, response.error.data));
      } else {
        pending.resolve(response.result);
      }
    }
  }
}
