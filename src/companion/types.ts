export type CompanionRarity = "rare" | "super_rare" | "ultra_rare";

export type CompanionRarityLabel = "Rare" | "Super Rare" | "Ultra Rare";

export type CompanionWorkflowState =
  | "idle"
  | "running"
  | "tool_running"
  | "approval_waiting"
  | "ask_user_waiting"
  | "error"
  | "done"
  | "context_high"
  | "disconnected";

export type CompanionQuickAction =
  | "diff"
  | "logs"
  | "doctor"
  | "support"
  | "runtime"
  | "approval"
  | "summon"
  | "collection";

export interface CompanionAvatar {
  kind: "builtin";
  animatedWebp: string;
  thumbnailPng: string;
  animations?: Partial<Record<CompanionWorkflowState | "pet", string>>;
}

export interface CompanionCard {
  id: string;
  name: string;
  title: string;
  description: string;
  personality: string;
  avatar: CompanionAvatar;
  statusLines: Partial<Record<CompanionWorkflowState, string>>;
  workflowBias: string[];
  quickActions?: CompanionQuickAction[];
}

export interface CompanionPack {
  id: string;
  name: string;
  cards: CompanionCard[];
}

export interface CompanionAppraisal {
  fingerprint: string;
  rarity: CompanionRarity;
  rarityLabel: CompanionRarityLabel;
}

export interface CompanionPoolCard extends CompanionCard {
  packId: string;
  appraisal: CompanionAppraisal;
}

export interface CompanionCollectionItem {
  fingerprint: string;
  card: CompanionCard;
  displayName?: string;
  packId: string;
  appraisal: CompanionAppraisal;
  growth: CompanionGrowth;
  copies: number;
  firstSummonedAt: string;
  lastSummonedAt: string;
}

export interface CompanionGrowth {
  experience: number;
  level: number;
  activeMinutes: number;
  completedTurns: number;
  toolRuns: number;
  interactionCount: number;
  petCount: number;
  approvalEvents: number;
  errorEvents: number;
  lastExperienceAt?: string;
}

export type CompanionGrowthEventKind =
  | "turn_completed"
  | "tool_completed"
  | "tool_failed"
  | "approval_waiting"
  | "direct_address"
  | "pet"
  | "active_minute";

export interface CompanionGrowthEvent {
  kind: CompanionGrowthEventKind;
  experience: number;
  activeMinutes?: number;
}

export interface CompanionCollectionFile {
  schemaVersion: number;
  activeFingerprint?: string;
  lastSummonedAt?: string;
  muted?: boolean;
  lastResponse?: CompanionResponse;
  cards: CompanionCollectionItem[];
}

export interface CompanionResponse {
  kind: "pet" | "direct_address" | "info";
  text: string;
  createdAt: string;
}

export interface CompanionSummonState {
  available: boolean;
  windowStart: string;
  nextResetAt: string;
  lastSummonedAt?: string;
}

export interface CompanionViewState {
  activeCard: CompanionCollectionItem | null;
  collection: CompanionCollectionItem[];
  pool: CompanionPoolCard[];
  summon: CompanionSummonState;
  muted: boolean;
  lastResponse?: CompanionResponse;
  assetBaseUri?: string;
}

export interface CompanionLoadOptions {
  companionRootDir?: string;
  workspaceDir?: string;
  assetBaseUri?: string;
}
