import { formatCount } from "../../common/utils";

export function el(tag: string, attrs: Record<string, string | undefined> = {}, ...children: (string | Node)[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) {
      continue;
    }
    if (k === "innerHTML") {
      e.innerHTML = v;
    } else if (k === "class") {
      e.className = v;
    } else if (k.startsWith("on")) {
      e.addEventListener(k.slice(2).toLowerCase(), v as unknown as EventListener);
    } else if (k.startsWith("data-") || k.startsWith("aria-") || k === "role" || k === "tabindex") {
      e.setAttribute(k, v);
    } else if (["open", "hidden", "disabled", "readonly", "required", "multiple", "checked"].includes(k.toLowerCase())) {
      e.setAttribute(k, v);
    } else {
      (e as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const child of children) {
    if (typeof child === "string") {
      e.appendChild(document.createTextNode(child));
    } else {
      e.appendChild(child);
    }
  }
  return e;
}

export function formatTime(ts: number): string {
  const date = new Date(ts);
  const hour = date.getHours();
  const displayHour = hour % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, "0");
  const suffix = hour < 12 ? "AM" : "PM";
  return `${displayHour}:${minute} ${suffix}`;
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function formatJson(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function shortSessionId(sessionId: string): string {
  return sessionId ? sessionId.replaceAll("-", "").slice(0, 12) : "";
}

export function baseName(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  if (!normalized) return value;
  return normalized.split(/[\\/]/).pop() || normalized;
}

export function timeAgo(value?: string): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export function compactTokens(value: number): string {
  if (!value) return "-";
  if (value >= 1000) {
    const count = value / 1000;
    return `${count >= 10 || count === Math.trunc(count) ? count.toFixed(0) : count.toFixed(1)}k`;
  }
  return String(value);
}

export function tokenValue(value: number | null | undefined): string {
  return typeof value === "number" ? compactTokens(value) : "-";
}

export function tokenValueOrDash(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? (value === 0 ? "0" : compactTokens(value)) : "\u2014";
}

export function formatCountLabel(value: number, noun: string): string {
  return `${formatCount(value)} ${noun}${value === 1 ? "" : "s"}`;
}

export function formatSessionListMeta(cwd: string, updatedAt?: string): string {
  return [baseName(cwd), timeAgo(updatedAt)].filter(Boolean).join(" · ");
}
