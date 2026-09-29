export type AgentSelectionTarget = "next-session" | "active-session";
export type WorkspaceSelectionTarget = "restart-backend" | "active-session";

export function agentSelectionTarget(hasActiveSession: boolean): AgentSelectionTarget {
  return hasActiveSession ? "active-session" : "next-session";
}

export function workspaceSelectionTarget(hasActiveSession: boolean): WorkspaceSelectionTarget {
  return hasActiveSession ? "active-session" : "restart-backend";
}
