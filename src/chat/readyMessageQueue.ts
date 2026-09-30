export interface TypedMessage {
  type: string;
  messageId?: string;
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
    // Streamed text updates carry the full text; only the latest per message matters.
    if (message.type === "updateMessageTextOnly" && message.messageId) {
      const previousText = this.pending.findIndex((candidate) => candidate.type === "updateMessageTextOnly" && candidate.messageId === message.messageId);
      if (previousText >= 0) {
        this.pending.splice(previousText, 1);
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
