import { ChrysAcpClient } from "../acp/client";
import { SessionStateMachine, type SessionState } from "./state";
import type {
  ContentBlock,
  DiffSnapshot,
  HistorySnapshot,
  ModelSummary,
  MutationsSnapshot,
  ProfileSummary,
  ProfileSwitchedNotification,
  RollbackResultNotification,
  RuntimeSnapshot,
  SessionInfo,
  WorkspaceUpdatedNotification,
  SetSessionModelResponse,
} from "../acp/types";

/** How long cancel() waits for the backend to settle the cancelled prompt before going idle. */
export const CANCEL_SETTLE_TIMEOUT_MS = 3000;

export class SessionManager {
  readonly acp: ChrysAcpClient;
  readonly stateMachine = new SessionStateMachine();

  private _currentSessionId: string | null = null;
  private _cwd: string | null = null;
  private _turn = 0;
  private _activePrompt: Promise<unknown> | null = null;
  private _cancelling: Promise<void> | null = null;

  constructor(acp: ChrysAcpClient) {
    this.acp = acp;
  }

  get sessionId(): string | null {
    return this._currentSessionId;
  }

  get cwd(): string | null {
    return this._cwd;
  }

  get state(): SessionState {
    return this.stateMachine.state;
  }

  /** Increments for every prompt; a settled prompt only owns the state while its turn is current. */
  get turn(): number {
    return this._turn;
  }

  // ── Session lifecycle ──────────────────────

  /** Create a new session. Must be in idle state. */
  async newSession(cwd: string, additionalDirectories?: string[]): Promise<string> {
    this.stateMachine.transition("running");
    try {
      const resp = await this.acp.newSession(cwd, additionalDirectories);
      this._currentSessionId = resp.sessionId;
      this._cwd = cwd;
      this.stateMachine.force("idle"); // session created, no prompt running yet
      return resp.sessionId;
    } catch (err) {
      this.stateMachine.force("idle");
      throw err;
    }
  }

  /** Load an existing session. */
  async loadSession(cwd: string, sessionId: string, additionalDirectories?: string[]): Promise<void> {
    this.stateMachine.transition("running");
    try {
      await this.acp.loadSession(cwd, sessionId, additionalDirectories);
      this._currentSessionId = sessionId;
      this._cwd = cwd;
      this.stateMachine.force("idle");
    } catch (err) {
      this.stateMachine.force("idle");
      throw err;
    }
  }

  /** List sessions for the current workspace. */
  async listSessions(cwd: string, cursor?: string): Promise<SessionInfo[]> {
    const resp = await this.acp.listSessions(cwd, cursor);
    return resp.sessions;
  }

  async runtime(): Promise<RuntimeSnapshot> {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.runtime(this._currentSessionId);
  }

  async listMcp() {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.listMcp(this._currentSessionId);
  }

  async listSkills() {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.listSkills(this._currentSessionId);
  }

  async inject(text: string): Promise<void> {
    if (!this._currentSessionId) throw new Error("No active session");
    await this.acp.inject(this._currentSessionId, text);
  }

  async mutations(): Promise<MutationsSnapshot> {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.mutations(this._currentSessionId);
  }

  async diff(path?: string, turn?: number): Promise<DiffSnapshot> {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.diff(this._currentSessionId, path, turn);
  }

  async rollback(
    targetTurn: number,
    revertChanges: boolean,
    selectedPaths?: string[],
  ): Promise<RollbackResultNotification> {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.rollback(this._currentSessionId, targetTurn, revertChanges, selectedPaths);
  }

  async retrySubAgent(invocationId: string): Promise<void> {
    if (!this._currentSessionId) throw new Error("No active session");
    await this.acp.retrySubAgent(this._currentSessionId, invocationId);
  }

  async abortSubAgent(invocationId: string): Promise<void> {
    if (!this._currentSessionId) throw new Error("No active session");
    await this.acp.abortSubAgent(this._currentSessionId, invocationId);
  }

  async skipSleep(callId: string): Promise<void> {
    if (!this._currentSessionId) throw new Error("No active session");
    await this.acp.skipSleep(this._currentSessionId, callId);
  }

  async setApprovalMode(mode: string): Promise<void> {
    if (!this._currentSessionId) throw new Error("No active session");
    await this.acp.setApprovalMode(this._currentSessionId, mode);
  }

  async switchAgent(agentProfile: string): Promise<ProfileSwitchedNotification> {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.switchAgent(this._currentSessionId, agentProfile);
  }

  async reloadSettings(): Promise<void> {
    if (!this._currentSessionId) throw new Error("No active session");
    await this.acp.reloadSettings(this._currentSessionId);
  }

  async configOptions(): Promise<Record<string, unknown>> {
    return this.acp.configOptions();
  }

  async setConfigOption(key: string, value: string): Promise<Record<string, unknown>> {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.setConfigOption(this._currentSessionId, key, value);
  }

  async setWorkspace(primaryCwd: string): Promise<WorkspaceUpdatedNotification> {
    if (!this._currentSessionId) throw new Error("No active session");
    const result = await this.acp.setWorkspace(this._currentSessionId, primaryCwd);
    this._cwd = result.primaryCwd ?? primaryCwd;
    return result;
  }

  async history(): Promise<HistorySnapshot> {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.history(this._currentSessionId);
  }

  async listAgentProfiles(): Promise<ProfileSummary[]> {
    return this.acp.listAgentProfiles();
  }

  async readAgentProfile(name: string): Promise<Record<string, unknown>> {
    return this.acp.readAgentProfile(name);
  }

  async writeAgentProfile(profile: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.acp.writeAgentProfile(profile);
  }

  async deleteAgentProfile(name: string): Promise<Record<string, unknown>> {
    return this.acp.deleteAgentProfile(name);
  }

  async resetAgentProfile(name: string): Promise<Record<string, unknown>> {
    return this.acp.resetAgentProfile(name);
  }

  async listModelProfiles(): Promise<ModelSummary[]> {
    return this.acp.listModelProfiles();
  }

  async readModelProfile(id: string): Promise<Record<string, unknown>> {
    return this.acp.readModelProfile(id);
  }

  async writeModelProfile(profile: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.acp.writeModelProfile(profile);
  }

  async deleteModelProfile(id: string): Promise<Record<string, unknown>> {
    return this.acp.deleteModelProfile(id);
  }

  async setModel(modelProfileId: string): Promise<SetSessionModelResponse> {
    if (!this._currentSessionId) throw new Error("No active session");
    return this.acp.setModel(this._currentSessionId, modelProfileId);
  }

  async testMcpServer(server: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.acp.testMcpServer(server);
  }

  // ── Turn lifecycle ─────────────────────────

  /** Send a prompt. Must have an active session and be idle. */
  async sendPrompt(blocks: ContentBlock[], messageId?: string): Promise<void> {
    if (!this._currentSessionId) throw new Error("No active session");
    this.stateMachine.transition("running");
    const turn = ++this._turn;
    // prompt() handles the response — caller listens to sessionUpdate events
    const prompt = this.acp.prompt(this._currentSessionId, blocks, messageId);
    this._activePrompt = prompt;
    try {
      await prompt;
    } finally {
      // A prompt that settles after cancel() already released the turn must not
      // reset the state of a newer turn.
      if (this._turn === turn) {
        this._activePrompt = null;
        this.stateMachine.force("idle");
      }
    }
  }

  /**
   * Cancel the current turn. Stays "cancelling" until the backend settles the prompt
   * (bounded by CANCEL_SETTLE_TIMEOUT_MS), so a new prompt cannot start while the
   * cancelled one is still being answered.
   */
  async cancel(options: { waitForTurn?: boolean } = {}): Promise<void> {
    if (!this._currentSessionId) return;
    if (!this.stateMachine.isRunning) return;
    const cancelling = this._cancel(options);
    const settled: Promise<void> = cancelling.catch(() => {}).finally(() => {
      if (this._cancelling === settled) this._cancelling = null;
    });
    this._cancelling = settled;
    return cancelling;
  }

  /** Resolves once an in-flight cancel() has returned the session to idle. */
  whenCancelSettled(): Promise<void> {
    return this._cancelling ?? Promise.resolve();
  }

  private async _cancel(options: { waitForTurn?: boolean }): Promise<void> {
    if (!this._currentSessionId) return;
    const turn = this._turn;
    const prompt = this._activePrompt;
    this.stateMachine.transition("cancelling");
    try {
      await this.acp.cancel(this._currentSessionId);
      if (prompt && options.waitForTurn !== false) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          prompt.then(() => {}, () => {}),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, CANCEL_SETTLE_TIMEOUT_MS); }),
        ]);
        clearTimeout(timer);
      }
    } finally {
      if (this._turn === turn && !this.stateMachine.isIdle) {
        // Release the turn: a late settlement of the cancelled prompt is ignored.
        this._turn++;
        this._activePrompt = null;
        this.stateMachine.force("idle");
      }
    }
  }

  /** Close the session. Cancels if running first. */
  async close(): Promise<void> {
    if (!this._currentSessionId) return;

    // Enforce: cancel before close if running
    if (this.stateMachine.isRunning) {
      await this.cancel({ waitForTurn: false });
    }

    await this.acp.closeSession(this._currentSessionId);
    this._currentSessionId = null;
    this._cwd = null;
  }

  /** Delete a saved session. Closes it first if it is currently active in this client. */
  async deleteSession(cwd: string, sessionId: string): Promise<void> {
    if (this._currentSessionId === sessionId) {
      await this.close();
    }
    await this.acp.deleteSession(sessionId, cwd);
  }
}
