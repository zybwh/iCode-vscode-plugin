import type { Memento } from "vscode";
import type { SessionInfo } from "../acp/types";

interface LocalName { sessionId: string; name: string }
const NAMES_KEY = "chrys.sessionLocalNames";
const cache = new WeakMap<Memento, LocalName[]>();
const writes = new WeakMap<Memento, Promise<void>>();

function names(storage: Memento): LocalName[] {
  const saved = cache.get(storage);
  if (saved) return saved;
  const raw = storage.get<unknown>(NAMES_KEY);
  const valid = Array.isArray(raw) ? raw.filter((entry): entry is LocalName =>
    entry && typeof entry.sessionId === "string" && typeof entry.name === "string",
  ) : [];
  cache.set(storage, valid);
  return valid;
}

export function localSessionName(storage: Memento | undefined, sessionId: string | null): string | undefined {
  return storage && sessionId ? names(storage).find(entry => entry.sessionId === sessionId)?.name : undefined;
}

export function validateSessionName(value: string): boolean {
  return value.trim().length <= 120 && !/[\r\n\u0000-\u001f\u007f]/.test(value);
}

export async function setLocalSessionName(storage: Memento, sessionId: string, value: string): Promise<void> {
  if (!sessionId || !validateSessionName(value)) throw new Error("Invalid local session name");
  const write = (writes.get(storage) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const updated = names(storage).filter(entry => entry.sessionId !== sessionId);
    if (value.trim()) updated.push({ sessionId, name: value.trim() });
    // Serialize workspace writes so concurrent renames in different tabs survive.
    await storage.update(NAMES_KEY, updated);
    cache.set(storage, updated);
  });
  writes.set(storage, write);
  await write;
}

export function withLocalSessionNames(sessions: SessionInfo[], storage: Memento | undefined): SessionInfo[] {
  return sessions.map(session => {
    const name = localSessionName(storage, session.sessionId);
    return name ? { ...session, title: name, _meta: { ...session._meta, vsixLocalName: true, vsixBackendTitle: session.title ?? "" } } : session;
  });
}
