// ACP Protocol Type Definitions
// Mirrors .venv/lib/python3.14/site-packages/acp/schema.py (v0.12.2, PROTOCOL_VERSION=1)
// JSON field names match the Python alias="" serialization.

// ──────────────────────────────────────────────
// Primitives / Enums
// ──────────────────────────────────────────────

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export type ToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "sleep" | "other";

export type ApiStyle = "chat_completions" | "responses";

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

// ──────────────────────────────────────────────
// JSON-RPC Envelope
// ──────────────────────────────────────────────

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: RequestId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: RequestId;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

// ──────────────────────────────────────────────
// Common
// ──────────────────────────────────────────────

export interface Implementation {
  name: string;
  title?: string;
  version: string;
}

// _meta is present on nearly every model; we accept it everywhere but ignore it
export type Meta = Record<string, unknown>;

// ──────────────────────────────────────────────
// Content Blocks (discriminated by "type")
// ──────────────────────────────────────────────

export interface TextContentBlock {
  type: "text";
  text: string;
  _meta?: Meta;
  annotations?: unknown;
}

export interface ImageContentBlock {
  type: "image";
  data: string;
  mimeType: string;
  uri?: string;
  _meta?: Meta;
  annotations?: unknown;
}

export interface AudioContentBlock {
  type: "audio";
  data: string;
  mimeType: string;
  _meta?: Meta;
  annotations?: unknown;
}

export interface ResourceContentBlock {
  type: "resource_link";
  uri: string;
  name: string;
  title?: string;
  mimeType?: string;
  description?: string;
  size?: number;
  _meta?: Meta;
  annotations?: unknown;
}

export interface TextResourceContents {
  text: string;
  uri: string;
  mimeType?: string;
  _meta?: Meta;
}

export interface BlobResourceContents {
  blob: string;
  uri: string;
  mimeType?: string;
  _meta?: Meta;
}

export interface EmbeddedResourceContentBlock {
  type: "resource";
  resource: TextResourceContents | BlobResourceContents;
  _meta?: Meta;
  annotations?: unknown;
}

export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | AudioContentBlock
  | ResourceContentBlock
  | EmbeddedResourceContentBlock;

// ──────────────────────────────────────────────
// Capabilities
// ──────────────────────────────────────────────

export interface PromptCapabilities {
  audio?: boolean;
  embeddedContext?: boolean;
  image?: boolean;
  _meta?: Meta;
}

export interface SessionCloseCapabilities {
  _meta?: Meta;
}

export interface SessionListCapabilities {
  _meta?: Meta;
}

export interface SessionCapabilities {
  additionalDirectories?: unknown;
  close?: SessionCloseCapabilities;
  fork?: unknown;
  list?: SessionListCapabilities;
  resume?: unknown;
  _meta?: Meta;
}

export interface McpCapabilities {
  http?: boolean;
  sse?: boolean;
  _meta?: Meta;
}

export interface AgentCapabilities {
  auth?: unknown;
  loadSession?: boolean;
  mcpCapabilities?: McpCapabilities;
  promptCapabilities?: PromptCapabilities;
  sessionCapabilities?: SessionCapabilities;
  _meta?: Meta;
}

// ──────────────────────────────────────────────
// Initialize
// ──────────────────────────────────────────────

export interface InitializeRequest {
  protocolVersion: number;
  clientCapabilities?: ClientCapabilities;
  clientInfo?: Implementation;
  _meta?: Meta;
}

export interface ClientCapabilities {
  _meta?: Meta;
}

export interface InitializeResponse {
  protocolVersion: number;
  agentCapabilities?: AgentCapabilities;
  agentInfo?: Implementation;
  authMethods?: unknown[];
  _meta?: Meta;
}

// ──────────────────────────────────────────────
// Session Info
// ──────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  additionalDirectories?: string[];
  _meta?: Meta;
}

// ──────────────────────────────────────────────
// Session RPC Methods
// ──────────────────────────────────────────────

export interface HttpMcpServer {
  transport: "http";
  name: string;
  url: string;
  headers?: { name: string; value: string }[];
  _meta?: Meta;
}

export type McpServer = HttpMcpServer | { transport: "sse"; _meta?: Meta } | { transport: "stdio"; _meta?: Meta };

export interface NewSessionRequest {
  cwd?: string;
  mcpServers: McpServer[];
  additionalDirectories?: string[];
  _meta?: Meta;
}

export interface NewSessionResponse {
  sessionId: string;
  _meta?: Meta;

modes?: SessionModeState;
models?: SessionModelState;
}

export interface LoadSessionRequest {
  cwd?: string;
  sessionId: string;
  mcpServers: McpServer[];
  additionalDirectories?: string[];
  _meta?: Meta;
}

export interface LoadSessionResponse {
  modes?: SessionModeState;
  models?: SessionModelState;
  _meta?: Meta;
}

export interface ListSessionsRequest {
  cwd?: string;
  cursor?: string;
  additionalDirectories?: string[];
  _meta?: Meta;
}

export interface ListSessionsResponse {
  sessions: SessionInfo[];
  nextCursor?: string;
  _meta?: Meta;
}

export interface PromptRequest {
  sessionId: string;
  prompt: ContentBlock[];
  messageId?: string;
  _meta?: Meta;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  _meta?: Meta;

totalTokens?: number;
cachedReadTokens?: number;
}

export interface PromptResponse {
  stopReason: StopReason;
  usage?: Usage;
  userMessageId?: string;
  _meta?: Meta;
}

export interface CloseSessionRequest {
  sessionId: string;
  _meta?: Meta;
}

export interface DeleteSessionRequest {
  sessionId: string;
  cwd?: string;
  additionalDirectories?: string[];
  _meta?: Meta;
}

export interface SessionMode {
  id: string;
  name?: string;
  description?: string;
  _meta?: Meta;
}

export interface SessionModeState {
  availableModes: SessionMode[];
  currentModeId: string;
  _meta?: Meta;
}

export interface SetSessionModeRequest {
  sessionId: string;
  modeId: string;
  _meta?: Meta;
}

export interface SetSessionModeResponse {
  _meta?: Meta;
}

export interface SessionModel {
  id: string;
  name?: string;
  description?: string;
  _meta?: Meta;

modelId: string;
}

export interface SessionModelState {
  availableModels: SessionModel[];
  currentModelId?: string;
  _meta?: Meta;
}

export interface SetSessionModelRequest {
  sessionId: string;
  modelId: string;
  _meta?: Meta;
}

export interface SetSessionModelResponse {
  _meta?: Meta;
}

export interface RuntimeModelDetails {
  profile_id?: string;
  profileId?: string;
  name?: string;
  provider?: string;
  api_style?: ApiStyle | string;
  apiStyle?: ApiStyle | string;
  model_id?: string;
  modelId?: string;
  max_context_tokens?: number;
  maxContextTokens?: number;
  base_url?: string;
  baseUrl?: string;
  stream?: boolean;
  vision?: boolean;
}

export interface RuntimeSkillDetails {
  name?: string;
  description?: string;
  source?: string;
}

export interface AgentRuntimeDetails {
  model?: RuntimeModelDetails;
  builtin_tools?: Record<string, string[]>;
  builtinTools?: Record<string, string[]>;
  sub_agent_tools?: string[];
  subAgentTools?: string[];
  mcp_tools?: Record<string, string[]>;
  mcpTools?: Record<string, string[]>;
  mcp_failures?: Record<string, string>;
  mcpFailures?: Record<string, string>;
  skill_sources?: Record<string, string[]>;
  skillSources?: Record<string, string[]>;
  skill_details?: RuntimeSkillDetails[];
  skillDetails?: RuntimeSkillDetails[];
  memory_sources?: Record<string, string[]>;
  memorySources?: Record<string, string[]>;
}

export interface RuntimeSnapshot {
  sessionId: string;
  agentProfile?: string;
  displayName?: string;
  modelProfileId?: string;
  maxContextTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  pct?: number;
  totalSessionTokens?: number;
  totalSessionInputTokens?: number;
  totalSessionOutputTokens?: number;
  cacheHitTokens?: number | null;
  totalSessionCacheHitTokens?: number;
  localTokens?: number;
  calibrationRatio?: number;
  systemOverheadTokens?: number;
  toolNames?: string[];
  skillNames?: string[];
  memoryFiles?: string[];
  runtimeDetails?: AgentRuntimeDetails;
  runtime?: RuntimeUpdate;
  _meta?: Meta;

toolKinds?: Record<string, string>;
subAgentToolNames?: string[];
}

export interface ChrysErrorNotification {
  sessionId: string;
  code?: string;
  message?: string;
  recoverable?: boolean;
  _meta?: Meta;
}

export interface ChrysWarningNotification {
  sessionId: string;
  code?: string;
  message?: string;
  _meta?: Meta;
}

export interface SessionRestoredNotification {
  sessionId: string;
  agentProfile?: string;
  displayName?: string;
  messageCount?: number;
  cwdWarning?: string;
  primaryCwd?: string;
  _meta?: Meta;
}

export interface ContextCompressedNotification {
  sessionId: string;
  compressedContextId?: string;
  summary?: string;
  freedMessages?: number;
  turnRange?: number[];
  source?: string;
  _meta?: Meta;
}

export interface ContextPressureNotification {
  sessionId: string;
  reason?: string;
  attempts?: number;
  sideCallTokens?: number;
  sideCallTokenBudget?: number;
  source?: string;
  invocationId?: string;
  _meta?: Meta;
}

export interface ToolCompactedNotification {
  sessionId: string;
  compactedGroups?: number;
  phase?: string;
  turnNumbers?: number[];
  compactedToolNames?: string[];
  tokensBefore?: number;
  tokensAfter?: number;
  lastWordsGenerated?: boolean;
  _meta?: Meta;
}

export interface UsageUpdateNotification {
  sessionId: string;
  agentProfile?: string;
  usageSourceId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  pct?: number;
  maxContextTokens?: number;
  totalSessionTokens?: number;
  totalSessionInputTokens?: number;
  totalSessionOutputTokens?: number;
  cacheHitTokens?: number | null;
  totalSessionCacheHitTokens?: number;
  localTokens?: number;
  calibrationRatio?: number;
  systemOverheadTokens?: number;
  _meta?: Meta;
}

export interface RuntimeUpdateNotification {
  sessionId?: string;
  runtime?: RuntimeSnapshot;
  _meta?: Meta;
}

export interface CompactionStartedNotification {
  sessionId: string;
  compactionId: string;
  phase?: string;
  _meta?: Meta;
}

export interface CompactionFinishedNotification {
  sessionId: string;
  compactionId: string;
  outcome: string;
  durationMs?: number;
  lastWords?: string;
  formatViolation?: string;
  failureReason?: string;
  _meta?: Meta;
}

export interface SubAgentCompactionStartedNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  compactionId: string;
  phase?: string;
  _meta?: Meta;
}

export interface SubAgentCompactionFinishedNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  compactionId: string;
  outcome: string;
  durationMs?: number;
  formatViolation?: string;
  failureReason?: string;
  _meta?: Meta;
}

export interface SubAgentCompactionCommittedNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  compactionId: string;
  phase?: string;
  _meta?: Meta;
}

export type CompactionNotification =
  | CompactionStartedNotification
  | CompactionFinishedNotification
  | SubAgentCompactionStartedNotification
  | SubAgentCompactionFinishedNotification
  | SubAgentCompactionCommittedNotification;

export interface AgentLoadNotification {
  sessionId: string;
  operation?: string;
  phase?: string;
  message?: string;
  fromProfile?: string;
  toProfile?: string;
  agentProfile?: string;
  displayName?: string;
  current?: number;
  total?: number;
  failed?: boolean;
  serverName?: string;
  _meta?: Meta;
}

export interface ApprovalReviewedNotification {
  sessionId: string;
  requestId: string;
  approved: boolean;
  reason?: string;
  _meta?: Meta;
}

export interface ProfileSummary {
  id?: string;
  name: string;
  displayName?: string;
  description?: string;
  subAgentOnly?: boolean;
  builtin?: boolean;
}

export interface ModelSummary {
  id: string;
  name: string;
  provider?: string;
  apiStyle?: ApiStyle | string;
  modelId?: string;
  maxContextTokens?: number;
  stream?: boolean;
  vision?: boolean;
}

export interface HistorySnapshot {
  sessionId: string;
  messages: Record<string, unknown>[];
  _meta?: Meta;
}

export interface WorkspaceUpdatedNotification {
  sessionId: string;
  primaryCwd?: string;
  workingDirs?: string[];
  referenceFiles?: string[];
  _meta?: Meta;
}

export interface ProfileSwitchedNotification {
  sessionId: string;
  fromProfile?: string;
  toProfile?: string;
  fromDisplayName?: string;
  toDisplayName?: string;
  messageCount?: number;
  modelProfileId?: string;
  maxContextTokens?: number;
  toolNames?: string[];
  skillNames?: string[];
  subAgentToolNames?: string[];
  memoryFiles?: string[];
  runtimeDetails?: AgentRuntimeDetails;
  _meta?: Meta;
}

export interface ApprovalModeUpdateNotification {
  sessionId: string;
  mode?: string;
  _meta?: Meta;
}

export interface UserInjectResultNotification {
  sessionId: string;
  text: string;
  consumed: boolean;
  createdAt?: string;
  injectionId?: string;
  _meta?: Meta;
}

export type SnapshotSkipReason = "too_large" | "binary";
export type MutationProvenance = "proven" | "assumed" | "foreign";

export interface MutationEntry {
  path: string;
  operation: string;
  source: string;
  toolCallId: string;
  timestamp: number;
  oldPath?: string | null;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforeSkip?: SnapshotSkipReason | null;
  afterSkip?: SnapshotSkipReason | null;
  provenance?: MutationProvenance | null;
  contested?: boolean;
}

export interface MutationTurn {
  turnId: number;
  mutationCount: number;
  mutations: MutationEntry[];
}

export interface MutationFileSummary {
  path: string;
  operation: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforeSkip?: SnapshotSkipReason | null;
  afterSkip?: SnapshotSkipReason | null;
  contested?: boolean;
  inferred?: boolean;
}

export interface MutationsSnapshot {
  sessionId: string;
  currentTurn: number;
  availableRollbackTurns: number[];
  turns: MutationTurn[];
  files: MutationFileSummary[];
  _meta?: Meta;
}

export interface DiffEntry {
  path: string;
  operation: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  beforeText: string;
  afterText: string;
  isBinary: boolean;
  bytesChanged: boolean;
  contested?: boolean;
  inferred?: boolean;
}

export interface DiffSnapshot {
  sessionId: string;
  turn?: number;
  entries: DiffEntry[];
  _meta?: Meta;
}

export interface RestoreResult {
  path: string;
  outcome: string;
  reason?: string;
  changed: boolean;
  ok: boolean;
}

export interface RollbackExclusion {
  path: string;
  reason: string;
}

export interface RollbackResultNotification {
  sessionId: string;
  targetTurn: number;
  filesReverted: number;
  restoreResults: RestoreResult[];
  rolledBackUserText?: string;
  exclusions?: RollbackExclusion[];
  warnings?: string[];
  _meta?: Meta;
}

export interface SubAgentInvocationStartNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  toolName: string;
  parentCallId: string;
  _meta?: Meta;
}

export interface SubAgentToolCallStartNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  toolName: string;
  toolKind?: string;
  args?: Record<string, unknown>;
  callId: string;
  _meta?: Meta;
}

export interface SubAgentToolCallResultNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  toolName: string;
  callId: string;
  result: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
  _meta?: Meta;
}

export interface SubAgentProgressNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  toolCallCount: number;
  totalTokens: number;
  totalUsageTokens?: number;
  _meta?: Meta;

usageUnreportedAttempts?: number;
}

export interface SubAgentRetryAttemptNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  message: string;
  attempt: number;
  maxAttempts: number;
  delaySeconds: number;
  _meta?: Meta;
}

export interface SubAgentPausedNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  toolName: string;
  reason: string;
  lastError: string;
  retryAttempts: number;
  _meta?: Meta;
}

export interface SubAgentResumedNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  _meta?: Meta;
}

export interface SubAgentAbortedNotification {
  sessionId: string;
  agentName: string;
  invocationId: string;
  lastError?: string;
  _meta?: Meta;
}

export type SubAgentNotification =
  | SubAgentCompactionStartedNotification
  | SubAgentCompactionFinishedNotification
  | SubAgentCompactionCommittedNotification
  | SubAgentInvocationStartNotification
  | SubAgentToolCallStartNotification
  | SubAgentToolCallResultNotification
  | SubAgentProgressNotification
  | SubAgentRetryAttemptNotification
  | SubAgentPausedNotification
  | SubAgentResumedNotification
  | SubAgentAbortedNotification;

export interface CancelNotification {
  sessionId: string;
  _meta?: Meta;
}

// ──────────────────────────────────────────────
// Tool Calls
// ──────────────────────────────────────────────

export interface ToolCallLocation {
  uri?: string;
  range?: unknown;
  _meta?: Meta;
}

export interface ToolCallContent {
  content?: ContentBlock;
  _meta?: Meta;

type?: string;
}

export interface ToolCall {
  toolCallId: string;
  title: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: ToolCallLocation[];
  content?: ToolCallContent[];
  _meta?: Meta;
}

export interface ToolCallUpdate {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: ToolCallLocation[];
  content?: ToolCallContent[];
  _meta?: Meta;
}

// ──────────────────────────────────────────────
// Session Updates (discriminated by "sessionUpdate")
// ──────────────────────────────────────────────

export interface UserMessageChunk {
  sessionUpdate: "user_message_chunk";
  content: ContentBlock[];
  _meta?: Meta;

messageId?: string;
}

export interface AgentMessageChunk {
  sessionUpdate: "agent_message_chunk";
  content: ContentBlock[];
  _meta?: Meta;

messageId?: string;
}

export interface AgentThoughtChunk {
  sessionUpdate: "agent_thought_chunk";
  content: ContentBlock[];
  _meta?: Meta;

messageId?: string;
}

export interface ToolCallStart {
  sessionUpdate: "tool_call";
  toolCallId: string;
  title: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  rawInput?: unknown;
  locations?: ToolCallLocation[];
  content?: ToolCallContent[];
  _meta?: Meta;
}

export interface ToolCallProgress {
  sessionUpdate: "tool_call_update";
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: ToolCallLocation[];
  content?: ToolCallContent[];
  _meta?: Meta;
}

export interface SessionInfoUpdate {
  sessionUpdate: "session_info_update";
  title?: string;
  updatedAt?: string;
  _meta?: Meta;
}

export interface UsageUpdate {
  sessionUpdate: "usage_update";
  used: number;
  size: number;
  _meta?: Meta;
}

export interface CurrentModeUpdate {
  sessionUpdate: "current_mode_update";
  currentModeId: string;
  _meta?: Meta;
}

export type PlanEntryStatus = "pending" | "in_progress" | "completed";
export type PlanEntryPriority = "low" | "medium" | "high";

export interface PlanEntry {
  content: string;
  status: PlanEntryStatus;
  priority: PlanEntryPriority;
  _meta?: Meta;
}

export interface AgentPlanUpdate {
  sessionUpdate: "plan";
  entries: PlanEntry[];
  _meta?: Meta;
}

export type SessionUpdate =
  | UserMessageChunk
  | AgentMessageChunk
  | AgentThoughtChunk
  | ToolCallStart
  | ToolCallProgress
  | SessionInfoUpdate
  | CurrentModeUpdate
  | AgentPlanUpdate
  | UsageUpdate;

export interface SessionNotification {
  sessionId: string;
  update: SessionUpdate;
  _meta?: Meta;
}

// ──────────────────────────────────────────────
// Permission
// ──────────────────────────────────────────────

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
  _meta?: Meta;
}

export interface RequestPermissionRequest {
  sessionId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  _meta?: Meta;
}

export interface RequestInputOption {
  label: string;
  description?: string;
  _meta?: Meta;
}

export interface RequestInputQuestion {
  question: string;
  header?: string;
  options?: RequestInputOption[];
  multiSelect?: boolean;
  _meta?: Meta;
}

export interface RequestInputAnswer {
  values: string[];
  note: string;
  _meta?: Meta;
}

export interface LegacyRequestInputRequest {
  sessionId: string;
  requestId: string;
  question: string;
  options?: string[];
  callerName?: string;
  _meta?: Meta;
}

export interface BatchRequestInputRequest {
  sessionId: string;
  requestId: string;
  questions: RequestInputQuestion[];
  callerName?: string;
  _meta?: Meta;
}

export type RequestInputRequest = LegacyRequestInputRequest | BatchRequestInputRequest;

export interface LegacyRequestInputResponse {
  text: string;
  _meta?: Meta;
}

export interface BatchRequestInputResponse {
  answers?: RequestInputAnswer[];
  cancelled: boolean;
  _meta?: Meta;
}

export type RequestInputResponse = LegacyRequestInputResponse | BatchRequestInputResponse;

// RequestPermissionResponse is a discriminated union on "outcome"
export interface AllowedOutcome {
  outcome: "selected";
  optionId: string;
  _meta?: Meta;
}

export interface DeniedOutcome {
  outcome: "cancelled";
  _meta?: Meta;
}

export type RequestPermissionResponse = AllowedOutcome | DeniedOutcome;

export type RequestId = string | number;

export type RuntimeUpdate = Partial<Omit<RuntimeSnapshot, "sessionId">> & {
  sessionId?: string;
};

export type RuntimeUpdateMessage = RuntimeSnapshot | RuntimeUpdateNotification;

export interface McpListResponse {
  sessionId: string;
  mcpTools: Record<string, string[]>;
  mcpFailures: Record<string, string>;
  _meta?: Meta;
}

export interface SkillsListResponse {
  sessionId: string;
  skillSources: Record<string, string[]>;
  skillDetails: RuntimeSkillDetails[];
  _meta?: Meta;
}
