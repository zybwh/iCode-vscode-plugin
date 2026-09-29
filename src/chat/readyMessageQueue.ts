export interface TypedMessage {
  type: string;
}

/** Holds host messages until the webview confirms that its listener is installed. */
export class ReadyMessageQueue<T extends TypedMessage> {
  private ready = false;
  private pending: T[] = [];

  constructor(private readonly deliver: (message: T) => void) {}

  send(message: T): void {
    if (this.ready) {
      this.deliver(message);
      return;
    }

    if (message.type === "setState") {
      const previousState = this.pending.findIndex((candidate) => candidate.type === "setState");
      if (previousState >= 0) {
        this.pending[previousState] = message;
        return;
      }
    }
    this.pending.push(message);
  }

  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    const messages = this.pending;
    this.pending = [];
    for (const message of messages) this.deliver(message);
  }
}
