export type ToolRenderer =
  | "shell"
  | "search"
  | "read"
  | "edit"
  | "sleep"
  | "sub_agent"
  | "skill"
  | "ask_user"
  | "doc_converter"
  | "mcp"
  | "generic";

export interface ToolRendererInput {
  toolCallId?: string;
  title?: string;
  toolName?: string;
  kind?: string;
  status?: string;
  hasInput?: boolean;
  hasOutput?: boolean;
}

export interface ToolRendererEntry {
  id: string;
  toolName: string;
  rawKind: string;
  normalizedKind: string;
  renderer: ToolRenderer;
  status: string;
  hasInput: boolean;
  hasOutput: boolean;
}

export interface ToolRendererCoverage {
  total: number;
  generic: number;
  missingKind: number;
  byRenderer: Record<string, number>;
  recent: ToolRendererEntry[];
}

const SHELL_TOOL_NAMES = ["bash", "zsh", "sh", "fish", "pwsh", "powershell", "cmd", "git_bash"];
const SEARCH_TOOL_NAMES = ["grep", "glob", "search", "find"];
const SKILL_TOOL_NAMES = ["load_skill", "read_skill_resource", "run_skill_script"];
const WRITE_TOOL_NAMES = ["write_file", "edit_file", "delete_file", "move_file"];
const READ_TOOL_NAMES = ["read_file", "list_dir"];

export function normalizeToolKind(kind: string | undefined, toolName = ""): string {
  const value = (kind || "").trim().toLowerCase();
  const name = toolName.trim().toLowerCase();
  switch (value) {
    case "execute":
    case "shell":
    case "chrys.shell":
      return "execute";
    case "search":
    case "chrys.search":
      return "search";
    case "read":
    case "filesystem.read":
    case "chrys.filesystem.read":
      return "read";
    case "edit":
    case "write":
    case "filesystem.write":
    case "chrys.filesystem.write":
      return "edit";
    case "delete":
    case "move":
      return value;
    case "sleep":
    case "chrys.sleep":
      return "sleep";
    case "sub_agent":
    case "chrys.sub_agent":
      return "sub_agent";
    case "ask_user":
    case "chrys.ask_user":
      return "ask_user";
    case "mcp":
    case "chrys.mcp":
      return "mcp";
    case "doc_converter":
    case "chrys.doc_converter":
      return "doc_converter";
    case "skill":
    case "chrys.skill":
      return "skill";
    default:
      break;
  }
  if (SHELL_TOOL_NAMES.includes(name)) return "execute";
  if (SEARCH_TOOL_NAMES.includes(name)) return "search";
  if (name === "sleep") return "sleep";
  if (name.startsWith("sub-agent:") || name.startsWith("sub_agent")) return "sub_agent";
  if (SKILL_TOOL_NAMES.includes(name)) return "skill";
  if (WRITE_TOOL_NAMES.includes(name)) return "edit";
  if (READ_TOOL_NAMES.includes(name)) return "read";
  return value || "other";
}

export function toolRendererFor(kind: string | undefined, toolName = ""): ToolRenderer {
  switch (normalizeToolKind(kind, toolName)) {
    case "execute":
      return "shell";
    case "search":
      return "search";
    case "read":
      return "read";
    case "edit":
      return "edit";
    case "sleep":
      return "sleep";
    case "sub_agent":
      return "sub_agent";
    case "skill":
      return "skill";
    case "ask_user":
      return "ask_user";
    case "doc_converter":
      return "doc_converter";
    case "mcp":
      return "mcp";
    default:
      return "generic";
  }
}

export function toolRendererCoverage(tools: ToolRendererInput[], limit = 30): ToolRendererCoverage {
  const recent = tools.slice(-limit).map((tool) => {
    const toolName = tool.toolName ?? tool.title ?? "";
    const rawKind = tool.kind ?? "";
    const normalizedKind = normalizeToolKind(rawKind, toolName);
    const renderer = toolRendererFor(rawKind, toolName);
    return {
      id: tool.toolCallId ?? "",
      toolName,
      rawKind,
      normalizedKind,
      renderer,
      status: tool.status ?? "",
      hasInput: tool.hasInput ?? false,
      hasOutput: tool.hasOutput ?? false,
    };
  });
  const byRenderer: Record<string, number> = {};
  for (const entry of recent) {
    byRenderer[entry.renderer] = (byRenderer[entry.renderer] ?? 0) + 1;
  }
  return {
    total: recent.length,
    generic: byRenderer.generic ?? 0,
    missingKind: recent.filter((entry) => !entry.rawKind).length,
    byRenderer,
    recent,
  };
}
