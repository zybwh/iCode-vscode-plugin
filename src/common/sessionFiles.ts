import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function chrysConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "chrys");
  }
  return path.join(os.homedir(), ".chrys");
}

function expandHomeDir(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function chrysSessionRootDir(): string {
  const configured = process.env.CHRYS_SESSION_ROOT_DIR?.trim();
  if (configured) return path.resolve(expandHomeDir(configured));
  return chrysConfigDir();
}

export function chrysSessionsDir(): string {
  return path.join(chrysSessionRootDir(), "sessions");
}

export function sessionShortId(sessionId: string): string {
  return sessionId.replace(/[\\/]/g, "_").replace(/-/g, "").slice(0, 12);
}

export function findSessionJsonPath(sessionId: string): string | undefined {
  const sessionsDir = chrysSessionsDir();
  const shortId = sessionShortId(sessionId);
  const candidates = [
    path.join(sessionsDir, shortId, "session.json"),
    path.join(sessionsDir, `${shortId}.json`),
  ];
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}
