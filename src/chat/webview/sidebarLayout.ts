export const SIDEBAR_DRAWER_BREAKPOINT = 760;

export type SidebarPreference = "auto" | "open" | "closed";

export function sidebarOpenForViewport(
  viewportWidth: number,
  preference: SidebarPreference,
): boolean {
  if (preference === "open") return true;
  if (preference === "closed") return false;
  return viewportWidth > SIDEBAR_DRAWER_BREAKPOINT;
}

export function normalizeSidebarPreference(value: unknown): SidebarPreference {
  return value === "open" || value === "closed" ? value : "auto";
}
