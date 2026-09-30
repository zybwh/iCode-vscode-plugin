import { spawn } from "node:child_process";

export interface WorkflowSource { id: string; source: "builtin" | "global" | "project"; title: string; path: string }
export interface CliResult { code: number | null; stdout: string; stderr: string; cancelled: boolean }

export function parseWorkflowList(text: string): WorkflowSource[] {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.workflows)) throw new Error("Invalid workflow list response");
  return data.workflows.map((row: WorkflowSource) => {
    if (!row || typeof row.id !== "string" || !row.id || row.id.startsWith("-") ||
      !["builtin", "global", "project"].includes(row.source) ||
      typeof row.path !== "string" || typeof row.title !== "string") throw new Error("Invalid workflow entry");
    return { id: row.id, source: row.source, title: row.title, path: row.path };
  });
}

export function workflowRunArgs(source: WorkflowSource, input: string, timeout: number): string[] {
  if (!source.id || source.id.startsWith("-")) throw new Error("Invalid workflow id");
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 86400) throw new Error("Invalid workflow timeout");
  return ["workflow", "run", source.id, `--input=${input}`, "--timeout", String(timeout), "--json",
    ...(source.source === "builtin" ? [] : ["--trust"])];
}

// Never interpret workflow ids or prompt text through a shell. Windows command
// wrappers cannot safely carry arbitrary prompts; use the native release binary.
export function runIcodeCli(binary: string, args: string[], cwd: string, signal: AbortSignal, timeoutMs: number): Promise<CliResult> {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    return Promise.reject(new Error("iCode CLI requires a native icode/chrys .exe on Windows"));
  }
  if (signal.aborted) return Promise.resolve({ code: null, stdout: "", stderr: "", cancelled: true });
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(ELECTRON_|VSCODE_|ORIGINAL_|NODE_OPTIONS$|NODE_ENV$)/.test(key)));
    const child = spawn(binary, args, { cwd, env, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, cancelled = false;
    let failure: Error | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (force = false) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") {
          // Console processes on Windows do not support graceful taskkill; terminate the tree immediately.
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: false }).on("error", () => child.kill());
        } else process.kill(-child.pid, force ? "SIGKILL" : "SIGINT");
      } catch { /* The process may have already exited. */ }
      if (!force && !forceTimer) forceTimer = setTimeout(() => stop(true), 5000);
    };
    const cancel = () => { cancelled = true; stop(); };
    signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => { failure = new Error("iCode CLI timed out"); stop(); }, timeoutMs);
    const collect = (chunk: string, stream: "stdout" | "stderr") => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) { failure = new Error("iCode CLI output exceeded 8 MiB"); stop(); return; }
      if (stream === "stdout") stdout += chunk; else stderr += chunk;
    };
    child.stdout.setEncoding("utf8").on("data", chunk => collect(chunk, "stdout"));
    child.stderr.setEncoding("utf8").on("data", chunk => collect(chunk, "stderr"));
    const cleanup = () => { clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); signal.removeEventListener("abort", cancel); };
    child.on("error", error => { cleanup(); reject(error); });
    child.on("close", code => { cleanup(); if (failure) reject(failure); else resolve({ code, stdout, stderr, cancelled }); });
    if (signal.aborted) cancel();
  });
}
