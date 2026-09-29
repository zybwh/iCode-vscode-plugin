import { rt } from "../state/runtime";

export function appendLogLine(level: "info" | "warn" | "error", message: string): void {
  const line = `[${level}] ${new Date().toISOString()} ${message}`;
  rt.logLines.push(line);
  if (rt.logLines.length > 500) {
    rt.logLines.splice(0, rt.logLines.length - 500);
  }
  rt.outputChannel?.appendLine(line);
}

export function recordDebugEvent(kind: string, detail = ""): void {
  const event = { time: Date.now(), kind, detail };
  rt.debugEvents.push(event);
  if (rt.debugEvents.length > 500) {
    rt.debugEvents.splice(0, rt.debugEvents.length - 500);
  }
  const compactDetail = detail.replace(/\s+/g, " ").trim();
  appendLogLine("info", `[event:${kind}]${compactDetail ? ` ${compactDetail}` : ""}`);
}

export function logInfo(message: string): void {
  appendLogLine("info", message);
}

export function logWarn(message: string): void {
  appendLogLine("warn", message);
}

export function logError(message: string): void {
  appendLogLine("error", message);
}
