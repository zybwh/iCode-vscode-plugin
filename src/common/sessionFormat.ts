import type { SessionInfo } from "../acp/types";
import { hostUiLanguage, localized } from "./hostI18n";

function stringMeta(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === "string" && value ? value : undefined;
}

function numberMeta(meta: Record<string, unknown>, key: string): number | undefined {
  const value = meta[key];
  return typeof value === "number" ? value : undefined;
}

/** Agent · model · message count · size, from whatever session metadata the backend sent. */
export function sessionMetaLine(session: SessionInfo): string {
  const meta = session._meta ?? {};
  const messageCount = numberMeta(meta, "message_count") ?? numberMeta(meta, "messageCount");
  return [
    stringMeta(meta, "agentDisplayName") ?? stringMeta(meta, "agentProfile") ?? stringMeta(meta, "agent_profile") ?? stringMeta(meta, "agent") ?? stringMeta(meta, "profile"),
    stringMeta(meta, "modelProfile") ?? stringMeta(meta, "model_profile") ?? stringMeta(meta, "model"),
    messageCount !== undefined ? localized(`${messageCount} messages`, `${messageCount} 条消息`) : undefined,
    stringMeta(meta, "sessionSizeHuman"),
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

/** "3m ago" / "3 分钟前", falling back to a date after 30 days. */
export function relativeSessionTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (hostUiLanguage() === "zh-CN") {
    if (seconds < 60) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 30) return `${days} 天前`;
    return new Date(iso).toLocaleDateString("zh-CN");
  }
  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
