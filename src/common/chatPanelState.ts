import { localSessionName } from "../session/localNames";
import * as vscode from "vscode";
import { rt } from "../state/runtime";
import { runtimeModelName, countRuntimeTools, countRuntimeFiles, platformLabel, runtimeVisionEnabled } from "./runtimeUtils";
import type { ChatPanelState } from "../chat/panel";
import { resolveUiLanguage } from "./i18n";
import { resolveUiBrand } from "./uiBrand";
import { resolveUiTheme } from "./uiTheme";
import { loadCompanionViewState } from "../companion/store";

function runtimeSkillNames(): string[] {
  const snapshot = rt.currentRuntime;
  const names = new Set<string>();
  for (const name of snapshot?.skillNames ?? []) {
    if (name) names.add(name);
  }
  for (const detail of snapshot?.runtimeDetails?.skillDetails ?? snapshot?.runtimeDetails?.skill_details ?? []) {
    if (detail.name) names.add(detail.name);
  }
  for (const sourceNames of Object.values(snapshot?.runtimeDetails?.skillSources ?? snapshot?.runtimeDetails?.skill_sources ?? {})) {
    for (const name of sourceNames) {
      if (name) names.add(name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function runtimeMcpTools(): Record<string, string[]> {
  const details = rt.currentRuntime?.runtimeDetails;
  const tools = details?.mcpTools ?? details?.mcp_tools ?? {};
  const result: Record<string, string[]> = {};
  for (const [serverName, names] of Object.entries(tools)) {
    result[serverName] = [...names].sort((left, right) => left.localeCompare(right));
  }
  return result;
}

export function chatPanelState(overrides?: Partial<ChatPanelState>): ChatPanelState {
  const config = vscode.workspace.getConfiguration("chrys");
  rt.currentCompanion = loadCompanionViewState({
    workspaceDir: rt.currentCwd ?? undefined,
    assetBaseUri: rt.currentCompanion?.assetBaseUri,
  });
  return {
    chrysCliVersion: rt.chrysCliVersion,
    uiLanguage: resolveUiLanguage(config.get<string>("ui.language"), vscode.env.language),
    uiBrand: resolveUiBrand(config.get<string>("ui.brand")),
    uiTheme: rt.currentTheme || resolveUiTheme(config.get<string>("ui.theme"), process.env.CHRYS_THEME),
    agentName: rt.currentRuntime?.agentProfile || rt.activeAgentName || config.get<string>("agent.default") || process.env.CHRYS_DEFAULT_AGENT || "Code",
    modelName: runtimeModelName(rt.currentRuntime) || config.get<string>("model.profile") || process.env.CHRYS_MODEL_PROFILE || "",
    sessionId: rt.currentSessionId ?? "",
    sessionTitle: localSessionName(rt.extensionContext?.workspaceState, rt.currentSessionId) ?? rt.currentSessionTitle,
    sessionState: (rt.sessionManager?.state ?? "idle") as ChatPanelState["sessionState"],
    platformLabel: platformLabel(),
    usageText: rt.currentUsageText,
    contextUsedTokens: rt.currentContextUsedTokens,
    contextMaxTokens: rt.currentContextMaxTokens
      ?? rt.currentRuntime?.maxContextTokens
      ?? rt.currentRuntime?.runtimeDetails?.model?.maxContextTokens
      ?? rt.currentRuntime?.runtimeDetails?.model?.max_context_tokens
      ?? 0,
    contextPct: rt.currentContextPct,
    cacheHitTokens: rt.currentUsageUpdate?.totalSessionCacheHitTokens,
    inputTokens: rt.currentUsageUpdate?.totalSessionInputTokens,
    outputTokens: rt.currentUsageUpdate?.totalSessionOutputTokens,
    totalTokens: rt.currentUsageUpdate?.totalSessionTokens,
    latestInputTokens: rt.currentUsageUpdate?.inputTokens,
    latestOutputTokens: rt.currentUsageUpdate?.outputTokens,
    latestCacheHitTokens: rt.currentUsageUpdate?.cacheHitTokens ?? undefined,
    localTokens: rt.currentUsageUpdate?.localTokens,
    calibrationRatio: rt.currentUsageUpdate?.calibrationRatio,
    systemOverheadTokens: rt.currentUsageUpdate?.systemOverheadTokens,
    compressedMessages: rt.compressedMessages,
    planEntries: rt.currentPlanEntries,
    activeCompactionCount: rt.activeCompactions.size,
    committedCompactionCount: rt.committedCompactions.size,
    imageInputEnabled: runtimeVisionEnabled(rt.currentRuntime) ?? (rt.currentPromptCapabilities?.image === true),
    companion: rt.currentCompanion,
    approvalMode: rt.currentApprovalMode,
    additionalDirectories: rt.additionalDirectories,
    workspacePath: rt.currentCwd ?? "",
    toolCount: countRuntimeTools(rt.currentRuntime),
    fileCount: countRuntimeFiles(rt.currentRuntime),
    mcpTools: runtimeMcpTools(),
    runtimeSkillNames: runtimeSkillNames(),
    mcpFailures: runtimeMcpFailures(),
    memoryFiles: runtimeMemoryFiles(),
    subAgentToolNames: runtimeSubAgentToolNames(),
    sessionUpdatedAt: rt.currentSessionUpdatedAt,
    agentLifecycle: rt.agentLifecycle,
    connectionState: rt.connectionState,
    connectionDetail: rt.connectionDetail,
    connectionStartedAt: rt.connectionStartedAt,
    ...overrides,
  };
}

function runtimeMcpFailures(): Record<string, string> {
  const details = rt.currentRuntime?.runtimeDetails;
  return { ...(details?.mcpFailures ?? details?.mcp_failures ?? {}) };
}

function runtimeMemoryFiles(): string[] {
  const snapshot = rt.currentRuntime;
  const names = new Set(snapshot?.memoryFiles ?? []);
  const sources = snapshot?.runtimeDetails?.memorySources ?? snapshot?.runtimeDetails?.memory_sources ?? {};
  for (const files of Object.values(sources)) {
    for (const file of files) names.add(file);
  }
  return [...names].filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function runtimeSubAgentToolNames(): string[] {
  const snapshot = rt.currentRuntime;
  return [...new Set([
    ...(snapshot?.subAgentToolNames ?? []),
    ...(snapshot?.runtimeDetails?.subAgentTools ?? snapshot?.runtimeDetails?.sub_agent_tools ?? []),
  ])].filter(Boolean).sort((left, right) => left.localeCompare(right));
}
