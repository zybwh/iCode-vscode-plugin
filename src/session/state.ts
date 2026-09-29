/** Session state machine — enforces valid state transitions. */

export type SessionState = "idle" | "running" | "cancelling";

const VALID_TRANSITIONS: Record<SessionState, SessionState[]> = {
  idle: ["running"],
  running: ["cancelling", "idle"],
  cancelling: ["idle"],
};

export class SessionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStateError";
  }
}

export class SessionStateMachine {
  private _state: SessionState = "idle";

  get state(): SessionState {
    return this._state;
  }

  get isIdle(): boolean {
    return this._state === "idle";
  }

  get isRunning(): boolean {
    return this._state === "running";
  }

  get isCancelling(): boolean {
    return this._state === "cancelling";
  }

  /** Transition to a new state, throwing if the transition is invalid. */
  transition(to: SessionState): void {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed.includes(to)) {
      throw new SessionStateError(`Invalid state transition: ${this._state} → ${to}`);
    }
    this._state = to;
  }

  /** Force a state override (for error recovery). */
  force(to: SessionState): void {
    this._state = to;
  }
}
