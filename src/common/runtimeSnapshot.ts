import type { RuntimeSnapshot, RuntimeUpdateMessage } from "../acp/types";

/** Merge a flat runtime snapshot or a partial runtime-update envelope. */
export function mergeRuntimeSnapshot(
  previous: RuntimeSnapshot | null,
  message: RuntimeUpdateMessage,
): RuntimeSnapshot {
  const envelope = isRuntimeEnvelope(message) ? message : null;
  const update = envelope?.runtime ?? message;
  const sessionId = update.sessionId ?? envelope?.sessionId ?? previous?.sessionId ?? "";
  const sameSession = previous?.sessionId === sessionId;
  const merged: Record<string, unknown> = sameSession ? { ...previous } : {};

  for (const [key, value] of Object.entries(update)) {
    if (key !== "sessionId" && value !== undefined) merged[key] = value;
  }
  merged.sessionId = sessionId;

  return merged as unknown as RuntimeSnapshot;
}

function isRuntimeEnvelope(message: RuntimeUpdateMessage): message is import("../acp/types").RuntimeUpdateNotification & { runtime: Partial<RuntimeSnapshot> } {
  return "runtime" in message && typeof message.runtime === "object" && message.runtime !== null;
}
