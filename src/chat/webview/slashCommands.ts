// Slash command catalogue and the host commands it can dispatch.
import { COMPANION_ENABLED } from "../../common/utils";
import { SUPPORTED_UI_THEME_IDS } from "../../common/uiTheme";
import type { ChatCommand } from "../panel";

export const HOST_COMMANDS = new Set<ChatCommand>([
  "newSession",
  "resumeLastSession",
  "showSessions",
  "closeChat",
  "clearChat",
  "showPromptHistory",
  "renameSession",
  "attachFile",
  "insertFileMention",
  "openShell",
  "runtimeTools",
  "runtimeFiles",
  "searchWorkspace",
  "grepWorkspace",
  "findWorkspaceFile",
  "showLogs",
  "runtimeDetails",
  "selectAgent",
  "showDiff",
  "rollback",
  "retrySubAgent",
  "abortSubAgent",
  "setApprovalMode",
  "switchAgent",
  "showAgentProfiles",
  "showModelProfiles",
  "reloadSettings",
  "changeWorkspace",
  "showStructuredHistory",
  "setModelProfile",
  "createModelProfile",
  "deleteModelProfile",
  "deleteAgentProfile",
  "testMcpServer",
  "setConfigOption",
  "manage",
  "manageModels",
  "manageAgents",
  "diagnostics",
  "copySupportBundle",
  "trajectory",
  "workflows",
  "doctor",
  "companionCommand",
  "summonCompanion",
  "pickBrand",
  "pickTheme",
]);

export const BUSY_DISABLED_HOST_COMMANDS = new Set<ChatCommand>([
  "clearChat",
  "attachFile",
  "openShell",
  "rollback",
  "reloadSettings",
  "changeWorkspace",
  "selectAgent",
  "switchAgent",
  "setModelProfile",
]);

export type LocalCommand =
  | "copyLast"
  | "copyDebugSnapshot"
  | "foldTools"
  | "toggleSidebar"
  | "pickTheme"
  | "notifications"
  | "startSlashCommand"
  | "showHelp"
  | "companionWip";

export type SlashCommand =
  | {
      kind: "host";
      command: ChatCommand;
      arg?: string;
    }
  | { kind: "local"; command: LocalCommand; arg?: string };

export type SlashArgSuggestion = {
  value: string;
  label: string;
  description: string;
};

export type SlashDefinition = {
  names: string[];
  zhNames?: string[];
  title: string;
  description: string;
  action: SlashCommand;
  allowWhileRunning?: boolean;
  argHint?: string;
  argSuggestions?: SlashArgSuggestion[];
  examples?: string[];
  zhExamples?: string[];
};

export type SlashSuggestion = {
  label: string;
  description: string;
  commandText: string;
  action?: SlashCommand;
  insertText?: string;
  disabled?: boolean;
};

export const COMPANION_SLASH_ACTION: SlashCommand = COMPANION_ENABLED
  ? { kind: "host", command: "companionCommand" }
  : { kind: "local", command: "companionWip" };

export const TUI_SHORTCUT_HELP: Array<{ key: string; en: string; zh: string }> = [
  { key: "Enter", en: "Send message", zh: "发送消息" },
  { key: "Ctrl+J", en: "Insert newline", zh: "插入换行" },
  { key: "Ctrl+B", en: "Interrupt current run", zh: "中断当前运行" },
];

export const THEME_ARG_SUGGESTIONS: SlashArgSuggestion[] = [
  { value: "auto", label: "auto", description: "Follow CHRYS_THEME when supported" },
  ...SUPPORTED_UI_THEME_IDS.map((themeId) => ({
    value: themeId,
    label: themeId,
    description: themeId.startsWith("chrys") ? "iCode TUI theme" : "Textual TUI theme",
  })),
];

export const SLASH_DEFINITIONS: SlashDefinition[] = [
  { names: ["new"], zhNames: ["新建"], title: "New session", description: "Start a new iCode session", action: { kind: "host", command: "newSession" }, allowWhileRunning: true },
  { names: ["exit", "quit"], zhNames: ["退出", "关闭"], title: "Close Chat", description: "Close the iCode chat panel", action: { kind: "host", command: "closeChat" }, allowWhileRunning: true },
  { names: ["resume"], zhNames: ["恢复"], title: "Resume", description: "Resume the most recent session", action: { kind: "host", command: "resumeLastSession" }, allowWhileRunning: true },
  { names: ["sessions"], zhNames: ["会话"], title: "Sessions", description: "Browse and load saved sessions", action: { kind: "host", command: "showSessions" }, allowWhileRunning: true },
  { names: ["agents", "agent"], zhNames: ["智能体"], title: "Agents", description: "Manage agent profiles", action: { kind: "host", command: "manageAgents" } },
  { names: ["switch"], zhNames: ["切换"], title: "Switch agent", description: "Switch the active agent", action: { kind: "host", command: "switchAgent" } },
  { names: ["profiles"], zhNames: ["配置"], title: "Agent profiles", description: "Show agent profile details", action: { kind: "host", command: "showAgentProfiles" } },
  { names: ["model"], zhNames: ["模型"], title: "Model", description: "Switch the active model profile", action: { kind: "host", command: "setModelProfile" } },
  { names: ["models"], zhNames: ["模型管理"], title: "Models", description: "Manage model profiles", action: { kind: "host", command: "manageModels" } },
  { names: ["modelnew"], zhNames: ["新建模型"], title: "Create model", description: "Create a new model profile", action: { kind: "host", command: "createModelProfile" } },
  { names: ["modeldelete"], zhNames: ["删除模型"], title: "Delete model", description: "Delete a model profile", action: { kind: "host", command: "deleteModelProfile" } },
  { names: ["agentdelete"], zhNames: ["删除智能体"], title: "Delete agent", description: "Delete an agent profile", action: { kind: "host", command: "deleteAgentProfile" } },
  { names: ["runtime", "details"], zhNames: ["运行时", "详情"], title: "Runtime", description: "Show ACP runtime details", action: { kind: "host", command: "runtimeDetails" }, allowWhileRunning: true },
  { names: ["tools"], zhNames: ["工具"], title: "Tools", description: "Show loaded tools", action: { kind: "host", command: "runtimeTools" }, allowWhileRunning: true },
  { names: ["files", "file"], zhNames: ["文件"], title: "Files", description: "Show loaded workspace files", action: { kind: "host", command: "runtimeFiles" }, allowWhileRunning: true },
  { names: ["search"], zhNames: ["搜索"], title: "Search workspace", description: "Open VS Code Search for the current workspace", action: { kind: "host", command: "searchWorkspace" }, allowWhileRunning: true, argHint: "QUERY", examples: ["/search TODO", "/search function handleSendMessage"], zhExamples: ["/搜索 TODO", "/搜索 handleSendMessage"] },
  { names: ["grep"], zhNames: ["检索"], title: "Grep workspace", description: "Show matching lines in a Quick Pick list", action: { kind: "host", command: "grepWorkspace" }, allowWhileRunning: true, argHint: "QUERY", examples: ["/grep approval", "/grep WorkspaceGrep"], zhExamples: ["/检索 审批", "/检索 WorkspaceGrep"] },
  { names: ["find", "open"], zhNames: ["查找", "打开"], title: "Find file", description: "Open a workspace file by name", action: { kind: "host", command: "findWorkspaceFile" }, allowWhileRunning: true, argHint: "FILE", examples: ["/find sessionTree", "/open package.json"], zhExamples: ["/查找 sessionTree", "/打开 package.json"] },
  { names: ["mention"], zhNames: ["引用"], title: "Mention file", description: "Insert a file mention", action: { kind: "host", command: "insertFileMention" }, allowWhileRunning: true },
  { names: ["selection"], zhNames:["选区"], title:"Attach selection", description:"Attach editor selection with line numbers", action:{kind:"host",command:"attachFile",arg:"selection"}},
  { names: ["problems"], zhNames:["问题"], title:"Attach Problems", description:"Attach editor diagnostics", action:{kind:"host",command:"attachFile",arg:"problems"}},
  { names: ["attach"], zhNames: ["附加"], title: "Attach file", description: "Attach workspace file content", action: { kind: "host", command: "attachFile" } },
  { names: ["roots"], zhNames: ["目录范围"], title: "Workspace roots", description: "Select additional workspace directories", action: { kind: "host", command: "changeWorkspace", arg: "roots" } },
  { names: ["cd", "cwd", "chdir", "workspace"], zhNames: ["工作区", "目录"], title: "Workspace", description: "Change workspace directory", action: { kind: "host", command: "changeWorkspace" }, argHint: "PATH" },
  { names: ["logs", "log"], zhNames: ["日志", "日志面板"], title: "Logs", description: "Show VSIX and ACP frontend logs", action: { kind: "host", command: "showLogs" }, allowWhileRunning: true },
  { names: ["debug"], zhNames: ["调试", "事件"], title: "Debug events", description: "Show recent frontend event notifications", action: { kind: "local", command: "notifications" }, allowWhileRunning: true },
  { names: ["debugcopy"], zhNames: ["调试快照", "复制调试"], title: "Copy debug snapshot", description: "Copy VSIX frontend state and recent events", action: { kind: "local", command: "copyDebugSnapshot" }, allowWhileRunning: true },
  { names: ["diagnostics", "diag"], zhNames: ["诊断", "诊断报告"], title: "Diagnostics", description: "Open a VSIX and ACP diagnostics report", action: { kind: "host", command: "diagnostics" }, allowWhileRunning: true },
  { names: ["support", "supportcopy"], zhNames: ["支持", "排查", "支持快照"], title: "Support bundle", description: "Copy a shareable VSIX/TUI mismatch support bundle", action: { kind: "host", command: "copySupportBundle" }, allowWhileRunning: true },
  { names: ["trajectory", "usage"], zhNames: ["轨迹", "用量"], title: "Usage & Trajectory", description: "View historical usage and timelines or export analysis", action: { kind: "host", command: "trajectory" }, allowWhileRunning: true },
  { names: ["workflow", "workflows"], zhNames: ["工作流"], title: "Workflow", description: "Choose and run CLI workflows, view results or cancel", action: { kind: "host", command: "workflows" }, allowWhileRunning: true },
  { names: ["doctor", "health"], zhNames: ["健康检查", "doctor"], title: "Doctor", description: "Check iCode VSIX and ACP health", action: { kind: "host", command: "doctor" }, allowWhileRunning: true },
  { names: ["rename"], zhNames: ["改名"], title: "Local Session Name", description: "Name this session in VS Code only; TUI title stays unchanged", action: { kind: "host", command: "renameSession" }, allowWhileRunning: true, argHint: "TITLE" },
  { names: ["prompts"], zhNames: ["历史输入"], title: "Prompt History", description: "Search and reuse prompts without sending (Ctrl+R)", action: { kind: "host", command: "showPromptHistory" }, allowWhileRunning: true },
  { names: ["history", "json"], zhNames: ["会话json", "历史"], title: "Session JSON", description: "Show structured session history", action: { kind: "host", command: "showStructuredHistory" } },
  { names: ["shell", "terminal"], zhNames: ["终端", "shell"], title: "Shell", description: "Open a terminal or run a command in the workspace", action: { kind: "host", command: "openShell" }, argHint: "COMMAND", examples: ["/shell", "/shell npm test"], zhExamples: ["/终端", "/终端 npm test"] },
  { names: ["diff"], zhNames: ["差异"], title: "Diff", description: "Show session file changes", action: { kind: "host", command: "showDiff" }, allowWhileRunning: true },
  { names: ["rollback"], zhNames: ["回滚"], title: "Rollback", description: "Preview and confirm rollback by count or retained turn", action: { kind: "host", command: "rollback" }, argHint: "[last N | to N] [revert]", examples:["/rollback last 2","/rollback to 2 revert"], zhExamples:["/回滚 last 2","/回滚 to 2 revert"] },
  {
    names: ["approval"],
    zhNames: ["审批"],
    title: "Approval",
    description: "Set approval mode",
    action: { kind: "host", command: "setApprovalMode" },
    allowWhileRunning: true,
    argHint: "manual|auto|bypass",
    argSuggestions: [
      { value: "manual", label: "Manual approval", description: "Require explicit approval" },
      { value: "auto", label: "Approve for me", description: "Use the approval judge" },
      { value: "bypass", label: "Full access", description: "Allow tool calls without approval prompts" },
    ],
  },
  { names: ["reload"], zhNames: ["重载"], title: "Reload", description: "Reload iCode settings", action: { kind: "host", command: "reloadSettings" } },
  { names: ["mcptest"], zhNames: ["测试mcp"], title: "Test MCP", description: "Test an HTTP MCP server", action: { kind: "host", command: "testMcpServer" } },
  {
    names: ["manage", "config"],
    zhNames: ["管理", "设置"],
    title: "Manage",
    description: "Open the iCode management panel",
    action: { kind: "host", command: "manage" },
    argHint: "models|agents|tools|skills|mcp|memory|compaction",
    argSuggestions: [
      { value: "models", label: "models", description: "Model profiles" },
      { value: "agents", label: "agents", description: "Agent profiles" },
      { value: "tools", label: "tools", description: "Tool configuration" },
      { value: "skills", label: "skills", description: "Skill directories" },
      { value: "mcp", label: "mcp", description: "MCP servers" },
      { value: "memory", label: "memory", description: "Memory settings" },
      { value: "compaction", label: "compaction", description: "Context compaction" },
    ],
  },
  {
    names: ["theme", "themes"],
    zhNames: ["主题"],
    title: "Theme",
    description: "Pick a TUI-aligned theme",
    action: { kind: "local", command: "pickTheme" },
    argHint: "auto|chrys|dracula|monokai|tokyo-night|...",
    argSuggestions: THEME_ARG_SUGGESTIONS,
  },
  { names: ["notifications", "notify"], zhNames: ["通知"], title: "Notifications", description: "Show recent frontend notifications", action: { kind: "local", command: "notifications" }, allowWhileRunning: true },
  { names: ["clear"], zhNames: ["清空显示", "清空"], title: "Clear Display", description: "Clear display only; context stays. Use /new for a fresh context", action: { kind: "host", command: "clearChat" } },
  { names: ["copy"], zhNames: ["复制"], title: "Copy", description: "Copy conversation, thoughts, errors, or tool executions", action: { kind: "local", command: "copyLast" }, allowWhileRunning: true, argHint: "[N]|agent|user|tools|thoughts|errors|all", examples: ["/copy", "/copy user all", "/copy tools", "/copy errors"], zhExamples: ["/复制", "/复制 user all", "/复制 tools", "/复制 errors"] },
  { names: ["fold"], zhNames: ["折叠"], title: "Fold", description: "Toggle tool details and agent replies", action: { kind: "local", command: "foldTools" }, allowWhileRunning: true },
  { names: ["man", "help"], zhNames: ["帮助"], title: "Help", description: "Show command help", action: { kind: "local", command: "showHelp" }, allowWhileRunning: true, argHint: "COMMAND" },
  { names: ["subretry"], zhNames: ["重试子智能体"], title: "Retry sub-agent", description: "Retry the latest sub-agent", action: { kind: "host", command: "retrySubAgent" }, allowWhileRunning: true },
  { names: ["subabort"], zhNames: ["终止子智能体"], title: "Abort sub-agent", description: "Abort the running sub-agent", action: { kind: "host", command: "abortSubAgent" }, allowWhileRunning: true },
  {
    names: ["companion", "buddy"],
    zhNames: ["伙伴"],
    title: "Companion",
    description: "Show Companion status, collection, and interactions",
    action: COMPANION_SLASH_ACTION,
    allowWhileRunning: true,
    argHint: "pet|info|collection|summon|mute|name",
    examples: ["/companion collection", "/companion summon", "/companion info"],
    zhExamples: ["/伙伴 collection", "/伙伴 summon", "/伙伴 info"],
  },
];

// ──────────────────────────────────────────────
