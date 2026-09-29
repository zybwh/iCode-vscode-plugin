import type { McpListResponse, SkillsListResponse } from "./types";
import { AcpRequestError } from "./protocol";
import { AcpClient } from "./protocol";
import type {
  InitializeResponse,
  InitializeRequest,
  NewSessionResponse,
  NewSessionRequest,
  LoadSessionRequest,
  LoadSessionResponse,
  ListSessionsResponse,
  ListSessionsRequest,
  PromptResponse,
  PromptRequest,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  RequestInputRequest,
  RequestInputResponse,
  RuntimeSnapshot,
  RuntimeUpdateNotification,
  ChrysErrorNotification,
  ChrysWarningNotification,
  SessionRestoredNotification,
  ContextCompressedNotification,
  ContextPressureNotification,
  ToolCompactedNotification,
  UsageUpdateNotification,
  AgentLoadNotification,
  ApprovalReviewedNotification,
  ProfileSummary,
  ModelSummary,
  HistorySnapshot,
  WorkspaceUpdatedNotification,
  ProfileSwitchedNotification,
  ApprovalModeUpdateNotification,
  UserInjectResultNotification,
  MutationsSnapshot,
  DiffSnapshot,
  RollbackResultNotification,
  SubAgentNotification,
  CancelNotification,
  CloseSessionRequest,
  DeleteSessionRequest,
  SetSessionModeRequest,
  SetSessionModeResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
  ContentBlock,
  Implementation,
  ClientCapabilities,
  CompactionNotification,
} from "./types";
import { cancelledInputResponse, validatedInputResponse } from "../askUser/protocol";

// iCode ACP method name mapping (from acp/meta.py: method normalization)
// Method names use "session/new" → "session_new" internally, but we send the
// slash/snake-compatible form. The server accepts either.

export type SessionUpdateHandler = (sessionId: string, update: SessionNotification["update"]) => void;
export type PermissionHandler = (req: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
export type InputHandler = (req: RequestInputRequest) => Promise<RequestInputResponse>;
export type RuntimeUpdateHandler = (update: RuntimeSnapshot) => void;
export type ErrorHandler = (update: ChrysErrorNotification) => void;
export type WarningHandler = (update: ChrysWarningNotification) => void;
export type SessionRestoredHandler = (update: SessionRestoredNotification) => void;
export type ContextCompressedHandler = (update: ContextCompressedNotification) => void;
export type ContextPressureHandler = (update: ContextPressureNotification) => void;
export type ToolCompactedHandler = (update: ToolCompactedNotification) => void;
export type UsageUpdateHandler = (update: UsageUpdateNotification) => void;
export type AgentLoadHandler = (eventName: string, update: AgentLoadNotification) => void;
export type ApprovalReviewedHandler = (update: ApprovalReviewedNotification) => void;
export type ProfileSwitchedHandler = (update: ProfileSwitchedNotification) => void;
export type WorkspaceUpdatedHandler = (update: WorkspaceUpdatedNotification) => void;
export type ApprovalModeUpdateHandler = (update: ApprovalModeUpdateNotification) => void;
export type UserInjectResultHandler = (update: UserInjectResultNotification) => void;
export type RollbackResultHandler = (update: RollbackResultNotification) => void;
export type SubAgentHandler = (eventName: string, update: SubAgentNotification) => void;
export type CompactionHandler = (eventName: string, update: CompactionNotification) => void;

function normalizeRuntimeUpdate(params: unknown): RuntimeSnapshot {
  const payload = (params && typeof params === "object") ? params as RuntimeUpdateNotification : {};
  return (payload.runtime && typeof payload.runtime === "object")
    ? { ...payload.runtime, sessionId: payload.runtime.sessionId ?? payload.sessionId ?? "" }
    : payload as RuntimeSnapshot;
}

export class ChrysAcpClient {
  private unavailableInventoryMethods = new Set<string>();
  private acp: AcpClient;
  private sessionUpdateHandlers: SessionUpdateHandler[] = [];
  private runtimeUpdateHandlers: RuntimeUpdateHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private warningHandlers: WarningHandler[] = [];
  private sessionRestoredHandlers: SessionRestoredHandler[] = [];
  private contextCompressedHandlers: ContextCompressedHandler[] = [];
  private contextPressureHandlers: ContextPressureHandler[] = [];
  private toolCompactedHandlers: ToolCompactedHandler[] = [];
  private usageUpdateHandlers: UsageUpdateHandler[] = [];
  private agentLoadHandlers: AgentLoadHandler[] = [];
  private approvalReviewedHandlers: ApprovalReviewedHandler[] = [];
  private profileSwitchedHandlers: ProfileSwitchedHandler[] = [];
  private workspaceUpdatedHandlers: WorkspaceUpdatedHandler[] = [];
  private approvalModeUpdateHandlers: ApprovalModeUpdateHandler[] = [];
  private userInjectResultHandlers: UserInjectResultHandler[] = [];
  private rollbackResultHandlers: RollbackResultHandler[] = [];
  private subAgentHandlers: SubAgentHandler[] = [];
  private compactionHandlers: CompactionHandler[] = [];
  private permissionHandler: PermissionHandler | null = null;
  private inputHandler: InputHandler | null = null;

  constructor() {
    this.acp = new AcpClient();
    this.acp.onMessage((method, params, respond) => {
      return this._handleIncoming(method, params, respond);
    });
  }

  get transport(): AcpClient {
    return this.acp;
  }

  // ── Event registration ─────────────────────

  onSessionUpdate(handler: SessionUpdateHandler): void {
    this.sessionUpdateHandlers.push(handler);
  }

  onRequestPermission(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }

  onRequestInput(handler: InputHandler): void {
    this.inputHandler = handler;
  }

  onRuntimeUpdate(handler: RuntimeUpdateHandler): void {
    this.runtimeUpdateHandlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  onWarning(handler: WarningHandler): void {
    this.warningHandlers.push(handler);
  }

  onSessionRestored(handler: SessionRestoredHandler): void {
    this.sessionRestoredHandlers.push(handler);
  }

  onContextCompressed(handler: ContextCompressedHandler): void {
    this.contextCompressedHandlers.push(handler);
  }

  onContextPressure(handler: ContextPressureHandler): void {
    this.contextPressureHandlers.push(handler);
  }

  onToolCompacted(handler: ToolCompactedHandler): void {
    this.toolCompactedHandlers.push(handler);
  }

  onUsageUpdate(handler: UsageUpdateHandler): void {
    this.usageUpdateHandlers.push(handler);
  }

  onAgentLoad(handler: AgentLoadHandler): void {
    this.agentLoadHandlers.push(handler);
  }

  onApprovalReviewed(handler: ApprovalReviewedHandler): void {
    this.approvalReviewedHandlers.push(handler);
  }

  onProfileSwitched(handler: ProfileSwitchedHandler): void {
    this.profileSwitchedHandlers.push(handler);
  }

  onWorkspaceUpdated(handler: WorkspaceUpdatedHandler): void {
    this.workspaceUpdatedHandlers.push(handler);
  }

  onApprovalModeUpdate(handler: ApprovalModeUpdateHandler): void {
    this.approvalModeUpdateHandlers.push(handler);
  }

  onUserInjectResult(handler: UserInjectResultHandler): void {
    this.userInjectResultHandlers.push(handler);
  }

  onRollbackResult(handler: RollbackResultHandler): void {
    this.rollbackResultHandlers.push(handler);
  }

  onSubAgent(handler: SubAgentHandler): void {
    this.subAgentHandlers.push(handler);
  }

  onCompaction(handler: CompactionHandler): void {
    this.compactionHandlers.push(handler);
  }

  // ── RPC Methods ────────────────────────────

  async initialize(
    protocolVersion: number,
    clientInfo: Implementation,
    clientCapabilities?: ClientCapabilities,
  ): Promise<InitializeResponse> {
    const params: InitializeRequest = {
      protocolVersion,
      clientInfo,
      clientCapabilities,
    };
    return (await this.acp.request("initialize", params as unknown as Record<string, unknown>)) as InitializeResponse;
  }

  async newSession(cwd: string, additionalDirectories?: string[]): Promise<NewSessionResponse> {
    const params: NewSessionRequest = {
      cwd,
      mcpServers: [],
      additionalDirectories,
    };
    return (await this.acp.request("session/new", params as unknown as Record<string, unknown>)) as NewSessionResponse;
  }

  async loadSession(cwd: string, sessionId: string, additionalDirectories?: string[]): Promise<LoadSessionResponse> {
    const params: LoadSessionRequest = {
      cwd,
      sessionId,
      mcpServers: [],
      additionalDirectories,
    };
    return (await this.acp.request("session/load", params as unknown as Record<string, unknown>)) as LoadSessionResponse;
  }

  async listSessions(cwd: string, cursor?: string): Promise<ListSessionsResponse> {
    const params: ListSessionsRequest = { cwd, cursor };
    return (await this.acp.request(
      "session/list",
      params as unknown as Record<string, unknown>,
    )) as ListSessionsResponse;
  }

  async prompt(sessionId: string, blocks: ContentBlock[], messageId?: string): Promise<PromptResponse> {
    const params: PromptRequest = { sessionId, prompt: blocks, messageId };
    return (await this.acp.request("session/prompt", params as unknown as Record<string, unknown>, 0)) as PromptResponse;
  }

  async cancel(sessionId: string): Promise<void> {
    const params: CancelNotification = { sessionId };
    this.acp.sendNotification("session/cancel", params as unknown as Record<string, unknown>);
  }

  async closeSession(sessionId: string): Promise<void> {
    const params: CloseSessionRequest = { sessionId };
    await this.acp.request("session/close", params as unknown as Record<string, unknown>);
  }

  async deleteSession(sessionId: string, cwd?: string): Promise<void> {
    const params: DeleteSessionRequest = { sessionId, cwd };
    await this.acp.request("_session/delete", params as unknown as Record<string, unknown>);
  }

  async runtime(sessionId: string): Promise<RuntimeSnapshot> {
    return (await this.acp.request("_chrys/session_runtime", { sessionId })) as RuntimeSnapshot;
  }

  async listMcp(sessionId: string): Promise<McpListResponse> {
    return this.inventoryRequest<McpListResponse>("_mcp/list", sessionId);
  }

  async listSkills(sessionId: string): Promise<SkillsListResponse> {
    return this.inventoryRequest<SkillsListResponse>("_skills/list", sessionId);
  }

  private async inventoryRequest<T>(method: string, sessionId: string): Promise<T> {
    if (this.unavailableInventoryMethods.has(method)) throw new AcpRequestError(-32601, "Feature unavailable: " + method);
    try { return await this.acp.request(method, { sessionId }) as T; }
    catch (error) {
      if (error instanceof AcpRequestError && error.code === -32601) this.unavailableInventoryMethods.add(method);
      throw error;
    }
  }

  async inject(sessionId: string, text: string): Promise<void> {
    await this.acp.request("_session/inject", { sessionId, text });
  }

  async mutations(sessionId: string): Promise<MutationsSnapshot> {
    return (await this.acp.request("_session/mutations", { sessionId })) as MutationsSnapshot;
  }

  async diff(sessionId: string, path?: string, turn?: number): Promise<DiffSnapshot> {
    return (await this.acp.request("_session/diff", { sessionId, path, turn })) as DiffSnapshot;
  }

  async rollback(
    sessionId: string,
    targetTurn: number,
    revertChanges: boolean,
    selectedPaths?: string[],
  ): Promise<RollbackResultNotification> {
    return (await this.acp.request("_session/rollback", {
      sessionId,
      targetTurn,
      revertChanges,
      selectedPaths,
    })) as RollbackResultNotification;
  }

  async retrySubAgent(sessionId: string, invocationId: string): Promise<void> {
    await this.acp.request("_sub_agent/retry", { sessionId, invocationId });
  }

  async abortSubAgent(sessionId: string, invocationId: string): Promise<void> {
    await this.acp.request("_sub_agent/abort", { sessionId, invocationId });
  }

  async skipSleep(sessionId: string, callId: string): Promise<void> {
    await this.acp.request("_session/skip_sleep", { sessionId, callId });
  }

  async setApprovalMode(sessionId: string, mode: string): Promise<SetSessionModeResponse> {
    const params: SetSessionModeRequest = { sessionId, modeId: mode };
    return (await this.acp.request("session/set_mode", params as unknown as Record<string, unknown>)) as SetSessionModeResponse;
  }

  async switchAgent(sessionId: string, agentProfile: string): Promise<ProfileSwitchedNotification> {
    return (await this.acp.request("_session/switch_agent", { sessionId, agentProfile })) as ProfileSwitchedNotification;
  }

  async reloadSettings(sessionId: string): Promise<void> {
    await this.acp.request("_settings/reload", { sessionId });
  }

  async configOptions(): Promise<Record<string, unknown>> {
    return (await this.acp.request("_settings/options", {})) as Record<string, unknown>;
  }

  async setConfigOption(sessionId: string, key: string, value: string): Promise<Record<string, unknown>> {
    return (await this.acp.request("_session/set_config_option", { sessionId, key, value })) as Record<string, unknown>;
  }

  async setWorkspace(sessionId: string, primaryCwd: string): Promise<WorkspaceUpdatedNotification> {
    return (await this.acp.request("_session/set_workspace", { sessionId, primaryCwd })) as WorkspaceUpdatedNotification;
  }

  async history(sessionId: string): Promise<HistorySnapshot> {
    return (await this.acp.request("_session/history", { sessionId })) as HistorySnapshot;
  }

  async listAgentProfiles(): Promise<ProfileSummary[]> {
    const response = (await this.acp.request("_profiles/agents/list", {})) as { agents?: ProfileSummary[] };
    return response.agents ?? [];
  }

  async readAgentProfile(name: string): Promise<Record<string, unknown>> {
    const response = (await this.acp.request("_profiles/agents/read", { name })) as { profile?: Record<string, unknown> };
    return response.profile ?? {};
  }

  async writeAgentProfile(profile: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await this.acp.request("_profiles/agents/write", { profile })) as Record<string, unknown>;
  }

  async deleteAgentProfile(name: string): Promise<Record<string, unknown>> {
    return (await this.acp.request("_profiles/agents/delete", { name })) as Record<string, unknown>;
  }

  async resetAgentProfile(name: string): Promise<Record<string, unknown>> {
    return (await this.acp.request("_profiles/agents/reset", { name })) as Record<string, unknown>;
  }

  async listModelProfiles(): Promise<ModelSummary[]> {
    const response = (await this.acp.request("_profiles/models/list", {})) as { models?: ModelSummary[] };
    return response.models ?? [];
  }

  async readModelProfile(id: string): Promise<Record<string, unknown>> {
    const response = (await this.acp.request("_profiles/models/read", { id })) as { profile?: Record<string, unknown> };
    return response.profile ?? {};
  }

  async writeModelProfile(profile: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await this.acp.request("_profiles/models/write", { profile })) as Record<string, unknown>;
  }

  async deleteModelProfile(id: string): Promise<Record<string, unknown>> {
    return (await this.acp.request("_profiles/models/delete", { id })) as Record<string, unknown>;
  }

  async setModel(sessionId: string, modelProfileId: string): Promise<SetSessionModelResponse> {
    const params: SetSessionModelRequest = { sessionId, modelId: modelProfileId };
    return (await this.acp.request("session/set_model", params as unknown as Record<string, unknown>)) as SetSessionModelResponse;
  }

  async testMcpServer(server: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await this.acp.request("_mcp/test", { server })) as Record<string, unknown>;
  }

  // ── Incoming message routing ───────────────

  private _handleIncoming(method: string, params: unknown, respond: (result: unknown) => void): void | Promise<void> {
    switch (method) {
      case "session/update":
        this._handleSessionUpdate(params as SessionNotification);
        break;
      case "session/request_permission":
        return this._handlePermissionRequest(params as RequestPermissionRequest, respond);
      case "_chrys/request_input":
        return this._handleInputRequest(params as RequestInputRequest, respond);
      case "_chrys/runtime_update":
        this.runtimeUpdateHandlers.forEach((handler) => handler(normalizeRuntimeUpdate(params)));
        break;
      case "_chrys/error":
        this.errorHandlers.forEach((handler) => handler(params as ChrysErrorNotification));
        break;
      case "_chrys/warning":
        this.warningHandlers.forEach((handler) => handler(params as ChrysWarningNotification));
        break;
      case "_chrys/session_restored":
        this.sessionRestoredHandlers.forEach((handler) => handler(params as SessionRestoredNotification));
        break;
      case "_chrys/context_compressed":
        this.contextCompressedHandlers.forEach((handler) => handler(params as ContextCompressedNotification));
        break;
      case "_chrys/context_pressure":
        this.contextPressureHandlers.forEach((handler) => handler(params as ContextPressureNotification));
        break;
      case "_chrys/tool_compacted":
        this.toolCompactedHandlers.forEach((handler) => handler(params as ToolCompactedNotification));
        break;
      case "_chrys/usage_update":
        this.usageUpdateHandlers.forEach((handler) => handler(params as UsageUpdateNotification));
        break;
      case "_chrys/agent_load_started":
      case "_chrys/agent_load_progress":
      case "_chrys/agent_load_finished":
      case "_chrys/agent_load_failed":
        this.agentLoadHandlers.forEach((handler) => handler(method, params as AgentLoadNotification));
        break;
      case "_chrys/approval_reviewed":
        this.approvalReviewedHandlers.forEach((handler) => handler(params as ApprovalReviewedNotification));
        break;
      case "_chrys/profile_switched":
        this.profileSwitchedHandlers.forEach((handler) => handler(params as ProfileSwitchedNotification));
        break;
      case "_chrys/workspace_updated":
        this.workspaceUpdatedHandlers.forEach((handler) => handler(params as WorkspaceUpdatedNotification));
        break;
      case "_chrys/approval_mode_update":
        this.approvalModeUpdateHandlers.forEach((handler) => handler(params as ApprovalModeUpdateNotification));
        break;
      case "_chrys/user_inject_result":
        this.userInjectResultHandlers.forEach((handler) => handler(params as UserInjectResultNotification));
        break;
      case "_chrys/rollback_result":
        this.rollbackResultHandlers.forEach((handler) => handler(params as RollbackResultNotification));
        break;
      case "_chrys/compaction_started":
      case "_chrys/compaction_finished":
      case "_chrys/sub_agent_compaction_started":
      case "_chrys/sub_agent_compaction_finished":
      case "_chrys/sub_agent_compaction_committed":
        this.compactionHandlers.forEach((handler) => handler(method, params as CompactionNotification));
        break;
      case "_chrys/sub_agent_invocation_start":
      case "_chrys/sub_agent_tool_call_start":
      case "_chrys/sub_agent_tool_call_result":
      case "_chrys/sub_agent_progress":
      case "_chrys/sub_agent_retry_attempt":
      case "_chrys/sub_agent_paused":
      case "_chrys/sub_agent_resumed":
      case "_chrys/sub_agent_aborted":
      case "_chrys/sub_agent_cascade_aborted":
        this.subAgentHandlers.forEach((handler) => handler(method, params as SubAgentNotification));
        break;
      // Unknown notifications are silently ignored
    }
  }

  private _handleSessionUpdate(notification: SessionNotification): void {
    for (const handler of this.sessionUpdateHandlers) {
      handler(notification.sessionId, notification.update);
    }
  }

  private async _handlePermissionRequest(
    req: RequestPermissionRequest,
    respond: (result: unknown) => void,
  ): Promise<void> {
    if (!this.permissionHandler) {
      // No handler registered → deny
      respond({ outcome: { outcome: "cancelled" } });
      return;
    }
    try {
      const outcome = await this.permissionHandler(req);
      respond({ outcome });
    } catch {
      respond({ outcome: { outcome: "cancelled" } });
    }
  }

  private async _handleInputRequest(
    req: RequestInputRequest,
    respond: (result: unknown) => void,
  ): Promise<void> {
    if (!this.inputHandler) {
      respond(cancelledInputResponse(req));
      return;
    }
    try {
      respond(validatedInputResponse(req, await this.inputHandler(req)));
    } catch {
      respond(cancelledInputResponse(req));
    }
  }
}
