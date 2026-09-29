import type { Memento } from "vscode";

interface PromptEntry { cwd: string; text: string }
const HISTORY_KEY = "chrys.promptHistory";
const HISTORY_LIMIT = 100;
const cache = new WeakMap<Memento, PromptEntry[]>();
const writes = new WeakMap<Memento, Promise<void>>();

function entries(storage: Memento): PromptEntry[] {
  const cached = cache.get(storage);
  if (cached) return cached;
  const saved = storage.get<unknown>(HISTORY_KEY);
  const valid = Array.isArray(saved) ? saved.filter((entry): entry is PromptEntry =>
    entry && typeof entry.cwd === "string" && typeof entry.text === "string" && Boolean(entry.text.trim()),
  ).slice(-HISTORY_LIMIT) : [];
  cache.set(storage, valid);
  return valid;
}

/** Workspace-local text only; never imports credentials, CLI history or image data. */
export function promptHistory(storage: Memento, cwd: string): string[] {
  return entries(storage).filter(entry => entry.cwd === cwd).map(entry => entry.text).reverse();
}

export async function rememberPrompt(storage: Memento, cwd: string, text: string): Promise<void> {
  if (!text.trim()) return;
  const write = (writes.get(storage) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = entries(storage).filter(entry => entry.cwd !== cwd || entry.text !== text);
    next.push({ cwd, text });
    const bounded = next.slice(-HISTORY_LIMIT);
    await storage.update(HISTORY_KEY, bounded);
    cache.set(storage, bounded);
  });
  writes.set(storage, write);
  await write;
}
