import * as path from "node:path";

export interface InitialWorkspaceInput {
  activeWorkspacePath?: string;
  firstWorkspacePath?: string;
  activeFilePath?: string;
}

/** Resolve the directory iCode should treat as the current IDE project. */
export function initialWorkspacePath(input: InitialWorkspaceInput): string | null {
  const activeWorkspace = input.activeWorkspacePath?.trim();
  if (activeWorkspace) return activeWorkspace;

  const firstWorkspace = input.firstWorkspacePath?.trim();
  if (firstWorkspace) return firstWorkspace;

  const activeFile = input.activeFilePath?.trim();
  return activeFile ? path.dirname(activeFile) : null;
}
