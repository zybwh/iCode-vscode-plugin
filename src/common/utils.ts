/** Shared helper functions used by both the extension host and webview. */

// ──────────────────────────────────────────────
// Feature flags
// ──────────────────────────────────────────────

/** Enable the VSIX-owned Companion surface. */
export const COMPANION_ENABLED = true;

// ──────────────────────────────────────────────

export function objectValue(obj: unknown): Record<string, unknown> | null {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
}

export function stringField(obj: Record<string, unknown> | null | undefined, field: string): string | undefined {
  if (!obj || !field) return undefined;
  const value = obj[field];
  return typeof value === "string" && value ? value : undefined;
}

export function numberField(obj: Record<string, unknown> | null | undefined, field: string): number | undefined {
  if (!obj || !field) return undefined;
  const value = obj[field];
  return typeof value === "number" ? value : undefined;
}

export function boolField(obj: Record<string, unknown> | null | undefined, field: string): boolean | undefined {
  if (!obj || !field) return undefined;
  const value = obj[field];
  return typeof value === "boolean" ? value : undefined;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}
