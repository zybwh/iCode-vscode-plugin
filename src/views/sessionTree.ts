import { withLocalSessionNames } from "../session/localNames";
import { rt } from "../state/runtime";
import * as vscode from "vscode";
import type { SessionInfo } from "../acp/types";
import type { SessionManager } from "../session/manager";
import { logError } from "../common/logging";
import { findSessionJsonPath } from "../common/sessionFiles";
import { hostUiLanguage, localized as treeText } from "../common/hostI18n";
import { relativeSessionTime, sessionMetaLine } from "../common/sessionFormat";

type DateGroupKey = "today" | "yesterday" | "thisWeek" | "older";
type GroupKey = "actions" | "current" | DateGroupKey;

type TreeAction = {
  label: string;
  zhLabel: string;
  description: string;
  zhDescription: string;
  command: string;
  icon: string;
};

export type SessionTreeDiagnosticsSnapshot = {
  hasSessionManager: boolean;
  cwd: string;
  currentSessionId: string;
  totalSessions: number;
  groupCounts: Partial<Record<GroupKey, number>>;
  currentSessionInList: boolean;
  listError: string;
  lastRefreshAt: string;
  lastListAt: string;
};

function zh(): boolean {
  return hostUiLanguage() === "zh-CN";
}

function groupLabel(key: GroupKey): string {
  const labels: Record<GroupKey, string> = {
    actions: treeText("iCode Actions", "iCode 操作"),
    current: treeText("Current Session", "当前会话"),
    today: treeText("Today", "今天"),
    yesterday: treeText("Yesterday", "昨天"),
    thisWeek: treeText("This Week", "本周"),
    older: treeText("Older", "更早"),
  };
  return labels[key];
}

const DATE_GROUP_ORDER: DateGroupKey[] = ["today", "yesterday", "thisWeek", "older"];

function todayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dateGroupKey(info: SessionInfo): DateGroupKey {
  const ts = info.updatedAt ? new Date(info.updatedAt).getTime() : 0;
  const today = todayStart().getTime();
  const yesterday = today - 86_400_000;
  const weekStart = today - new Date().getDay() * 86_400_000;

  if (ts >= today) return "today";
  if (ts >= yesterday) return "yesterday";
  if (ts >= weekStart) return "thisWeek";
  return "older";
}

function defaultGroupState(key: GroupKey): vscode.TreeItemCollapsibleState {
  return key === "actions" || key === "current" || key === "today"
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.Collapsed;
}

const TREE_ACTIONS: TreeAction[] = [
  {
    label: "Open iCode",
    zhLabel: "打开 iCode",
    description: "focus chat",
    zhDescription: "打开聊天",
    command: "chrys.focusChat",
    icon: "comment-discussion",
  },
  {
    label: "New Session",
    zhLabel: "新建会话",
    description: "start clean",
    zhDescription: "开始新会话",
    command: "chrys.newSession",
    icon: "add",
  },
  {
    label: "Agents",
    zhLabel: "智能体",
    description: "manage and switch",
    zhDescription: "管理与切换",
    command: "chrys.manageAgents",
    icon: "hubot",
  },
  {
    label: "Models",
    zhLabel: "模型",
    description: "profiles",
    zhDescription: "配置",
    command: "chrys.manageModels",
    icon: "server-process",
  },
  {
    label: "Logs",
    zhLabel: "日志",
    description: "VSIX/ACP",
    zhDescription: "VSIX/ACP",
    command: "chrys.showLogs",
    icon: "list-flat",
  },
  {
    label: "Themes",
    zhLabel: "主题",
    description: "pick UI theme",
    zhDescription: "选择界面主题",
    command: "chrys.pickTheme",
    icon: "color-mode",
  },
  {
    label: "Language",
    zhLabel: "语言",
    description: "English / Chinese",
    zhDescription: "English / 中文",
    command: "chrys.pickLanguage",
    icon: "globe",
  },
  {
    label: "Notifications",
    zhLabel: "通知",
    description: "frontend events",
    zhDescription: "前端事件",
    command: "chrys.showNotifications",
    icon: "bell",
  },
  {
    label: "Session JSON",
    zhLabel: "会话 JSON",
    description: "structured history",
    zhDescription: "结构化历史",
    command: "chrys.showStructuredHistory",
    icon: "json",
  },
  {
    label: "Doctor",
    zhLabel: "健康检查",
    description: "diagnose setup",
    zhDescription: "诊断配置",
    command: "chrys.doctor",
    icon: "tools",
  },
];

function formatTimestamp(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  const today = todayStart();
  const pad = (n: number) => String(n).padStart(2, "0");

  if (d >= today) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d >= yesterday) return `${treeText("Yesterday", "昨天")} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const weekStart = new Date(today.getTime() - now.getDay() * 86_400_000);
  if (d >= weekStart) {
    const days = zh() ? ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${days[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (zh()) return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  if (d.getFullYear() === now.getFullYear()) return `${months[d.getMonth()]} ${d.getDate()}`;
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export class SessionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind: "group" | "session" | "message" | "action",
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly groupKey?: GroupKey,
    public readonly sessionInfo?: SessionInfo,
    currentSessionId?: string | null,
    action?: TreeAction,
  ) {
    super(label, collapsibleState);

    if (kind === "action" && action) {
      this.description = zh() ? action.zhDescription : action.description;
      this.tooltip = `${zh() ? action.zhLabel : action.label}\n${zh() ? action.zhDescription : action.description}`;
      this.iconPath = new vscode.ThemeIcon(action.icon);
      this.command = {
        command: action.command,
        title: zh() ? action.zhLabel : action.label,
      };
      this.contextValue = "action";
    } else if (kind === "session" && sessionInfo) {
      const isCurrent = Boolean(currentSessionId && sessionInfo.sessionId === currentSessionId);
      const metaLine = sessionMetaLine(sessionInfo);
      this.description = [isCurrent ? treeText("current", "当前") : undefined, formatTimestamp(sessionInfo.updatedAt), metaLine].filter(Boolean).join("  ");
      // The tooltip probes the file system for session.json; build it on hover in
      // resolveTreeItem instead of for every row on every refresh.
      this.command = {
        command: "chrys.loadSessionFromTree",
        title: treeText("Load Session", "加载会话"),
        arguments: [sessionInfo.sessionId, sessionInfo.cwd],
      };
      this.iconPath = new vscode.ThemeIcon(isCurrent ? "circle-filled" : "history");
      this.contextValue = "session";
    } else if (kind === "message") {
      this.iconPath = new vscode.ThemeIcon("info");
      this.contextValue = "message";
      this.tooltip = label;
    } else {
      this.iconPath = new vscode.ThemeIcon(groupKey === "actions" ? "rocket" : groupKey === "current" ? "debug-stackframe-active" : "calendar");
      this.contextValue = "group";
    }
  }
}

export function sessionTreeTooltip(sessionInfo: SessionInfo): string {
  const sessionJsonPath = findSessionJsonPath(sessionInfo.sessionId);
  return [
    `${treeText("Title", "标题")}: ${sessionInfo.title ?? treeText("Untitled", "无标题")}`,
    sessionInfo._meta?.vsixLocalName ? treeText(`TUI title: ${sessionInfo._meta.vsixBackendTitle}`, `TUI 标题：${sessionInfo._meta.vsixBackendTitle}`) : "",
    sessionMetaLine(sessionInfo),
    `${treeText("Last active", "最近活动")}: ${sessionInfo.updatedAt ? relativeSessionTime(sessionInfo.updatedAt) : treeText("unknown", "未知")}`,
    `${treeText("Session", "会话")}: ${sessionInfo.sessionId}`,
    `${treeText("Workspace", "工作区")}: ${sessionInfo.cwd}`,
    `${treeText("local session.json", "本地 session.json")}: ${sessionJsonPath ?? treeText("not found on this host", "当前主机未找到")}`,
    treeText("Right-click to copy a parity-debug summary.", "右键可复制用于排查 VSIX/TUI 差异的会话摘要。"),
  ].filter(Boolean).join("\n");
}

/** Coalesces refresh bursts (tab focus, session info and runtime updates). */
const REFRESH_DEBOUNCE_MS = 150;
/** One session/list result serves the root and every expanded group of a refresh. */
const SESSION_LIST_CACHE_MS = 2000;

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private listError: string | null = null;
  private lastRefreshAt = "";
  private lastListAt = "";
  private lastTotalSessions = 0;
  private lastGroupCounts: Partial<Record<GroupKey, number>> = {};
  private lastCurrentSessionInList = false;
  private sessionList: { promise: Promise<SessionInfo[]>; at: number; key: string } | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private getSessionManager: () => SessionManager | undefined,
    private getCwd: () => string | null | undefined,
    private getCurrentSessionId: () => string | null | undefined = () => undefined,
  ) {}

  refresh(): void {
    this.sessionList = null;
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.sessionList = null;
      this.lastRefreshAt = new Date().toISOString();
      this._onDidChangeTreeData.fire();
    }, REFRESH_DEBOUNCE_MS);
  }

  resolveTreeItem(item: vscode.TreeItem, element: SessionTreeItem): vscode.TreeItem {
    if (element.kind === "session" && element.sessionInfo && !item.tooltip) {
      item.tooltip = sessionTreeTooltip(element.sessionInfo);
    }
    return item;
  }

  diagnosticsSnapshot(): SessionTreeDiagnosticsSnapshot {
    return {
      hasSessionManager: Boolean(this.getSessionManager()),
      cwd: this.getCwd() || "",
      currentSessionId: this.getCurrentSessionId() || "",
      totalSessions: this.lastTotalSessions,
      groupCounts: this.lastGroupCounts,
      currentSessionInList: this.lastCurrentSessionInList,
      listError: this.listError || "",
      lastRefreshAt: this.lastRefreshAt,
      lastListAt: this.lastListAt,
    };
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SessionTreeItem): Promise<SessionTreeItem[]> {
    if (element?.groupKey === "actions") return this.getActionItems();
    if (element) return this.getSessionItems(element);
    return this.getGroupItems();
  }

  private fetchSessions(): Promise<SessionInfo[]> {
    const key = `${this.getCwd() ?? ""}`;
    const cached = this.sessionList;
    if (cached && cached.key === key && this.getSessionManager() && Date.now() - cached.at < SESSION_LIST_CACHE_MS) return cached.promise;
    const promise = this.fetchSessionsUncached();
    this.sessionList = { promise, at: Date.now(), key };
    return promise;
  }

  private async fetchSessionsUncached(): Promise<SessionInfo[]> {
    const sm = this.getSessionManager();
    const cwd = this.getCwd();
    if (!sm || !cwd) {
      this.lastTotalSessions = 0;
      this.lastGroupCounts = {};
      this.lastCurrentSessionInList = false;
      this.lastListAt = new Date().toISOString();
      return [];
    }
    try {
      const sessions = withLocalSessionNames(await sm.listSessions(cwd), rt.extensionContext?.workspaceState);
      this.listError = null;
      this.lastListAt = new Date().toISOString();
      this.lastTotalSessions = sessions.length;
      return sessions;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.listError = message;
      this.lastListAt = new Date().toISOString();
      this.lastTotalSessions = 0;
      this.lastGroupCounts = {};
      this.lastCurrentSessionInList = false;
      logError(`Session tree list failed: ${message}`);
      return [];
    }
  }

  private async getGroupItems(): Promise<SessionTreeItem[]> {
    const roots = [
      new SessionTreeItem("group", groupLabel("actions"), defaultGroupState("actions"), "actions"),
    ];
    const sm = this.getSessionManager();
    const cwd = this.getCwd();
    if (!sm) {
      const item = new SessionTreeItem("message", treeText("iCode is starting... Open Doctor", "iCode 正在启动... 打开健康检查"), vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("sync");
      item.command = {
        command: "chrys.doctor",
        title: treeText("Open Doctor", "打开健康检查"),
      };
      return [...roots, item];
    }
    if (!cwd) {
      const item = new SessionTreeItem("message", treeText("Select a workspace to list sessions.", "选择工作区后显示会话。"), vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("folder-opened");
      item.command = {
        command: "chrys.changeWorkspace",
        title: treeText("Change Workspace", "切换工作区"),
      };
      return [...roots, item];
    }
    const sessions = await this.fetchSessions();
    if (this.listError) {
      const item = new SessionTreeItem(
        "message",
        treeText("Unable to list sessions. Open iCode: Doctor.", "无法列出会话。请打开 iCode: 健康检查。"),
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon("warning");
      item.tooltip = this.listError;
      item.command = {
        command: "chrys.doctor",
        title: treeText("Open Doctor", "打开健康检查"),
      };
      return [...roots, item];
    }
    if (!sessions.length) {
      const item = new SessionTreeItem("message", treeText("No saved sessions yet.", "暂无已保存会话。"), vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("add");
      item.command = {
        command: "chrys.focusChat",
        title: treeText("Open iCode", "打开 iCode"),
      };
      return [...roots, item];
    }
    const groups = new Map<GroupKey, SessionInfo[]>();
    const currentSessionId = this.getCurrentSessionId() ?? null;
    const currentSession = currentSessionId ? sessions.find((session) => session.sessionId === currentSessionId) : undefined;
    this.lastCurrentSessionInList = Boolean(currentSession);
    if (currentSession) {
      groups.set("current", [currentSession]);
    }
    for (const session of sessions) {
      if (currentSessionId && session.sessionId === currentSessionId) continue;
      const key = dateGroupKey(session);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(session);
    }
    this.lastGroupCounts = Object.fromEntries(
      [...groups.entries()].map(([key, value]) => [key, value.length]),
    ) as Partial<Record<GroupKey, number>>;

    const items = (["current", ...DATE_GROUP_ORDER] as GroupKey[])
      .filter((key) => groups.has(key))
      .map((key) => {
        const count = groups.get(key)!.length;
        const item = new SessionTreeItem(
          "group",
          `${groupLabel(key)} (${count})`,
          defaultGroupState(key),
          key,
        );
        if (key === "current") {
          item.tooltip = treeText("Pinned active VSIX session. Other sessions stay grouped by last activity.", "置顶当前 VSIX 会话。其他会话按最近活动时间分组。");
        }
        return item;
      });
    if (currentSessionId && !currentSession) {
      return [...roots, ...items];
    }
    return [...roots, ...items];
  }

  private getActionItems(): SessionTreeItem[] {
    return TREE_ACTIONS.map((action) => new SessionTreeItem(
      "action",
      zh() ? action.zhLabel : action.label,
      vscode.TreeItemCollapsibleState.None,
      undefined,
      undefined,
      undefined,
      action,
    ));
  }

  private async getSessionItems(element: SessionTreeItem): Promise<SessionTreeItem[]> {
    if (element.kind !== "group" || !element.groupKey) return [];

    const sessions = await this.fetchSessions();
    const currentSessionId = this.getCurrentSessionId() ?? null;
    const filtered = sessions.filter((session) => {
      if (element.groupKey === "current") return Boolean(currentSessionId && session.sessionId === currentSessionId);
      if (currentSessionId && session.sessionId === currentSessionId) return false;
      return dateGroupKey(session) === element.groupKey;
    });
    filtered.sort((a, b) => {
      const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return db - da;
    });

    return filtered.map((session) => {
      const shortId = session.sessionId.length > 16 ? `${session.sessionId.slice(0, 16)}...` : session.sessionId;
      return new SessionTreeItem(
        "session",
        session.title ?? shortId,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        session,
        this.getCurrentSessionId() ?? null,
      );
    });
  }
}
