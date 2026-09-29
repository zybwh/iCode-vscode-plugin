import type { ChatMessage } from "./provider";

type TranscriptView = Pick<ChatTranscript,
  "appendMessage" | "updateMessage" | "updateMessageTextOnly" | "removeMessage" | "clearMessages"
>;

/** Host-owned conversation display state; survives closing the editor tab. */
export class ChatTranscript {
  private readonly entries = new Map<string, ChatMessage>();

  constructor(private readonly view: () => TranscriptView | null | undefined) {}

  get messages(): readonly ChatMessage[] {
    return [...this.entries.values()];
  }

  appendMessage(message: ChatMessage): void {
    this.entries.set(message.id, { ...message });
    this.view()?.appendMessage(message);
  }

  updateMessage(messageId: string, patch: Partial<ChatMessage>): void {
    const previous = this.entries.get(messageId);
    if (previous) this.entries.set(messageId, { ...previous, ...patch });
    this.view()?.updateMessage(messageId, patch);
  }

  updateMessageTextOnly(messageId: string, text: string): void {
    const previous = this.entries.get(messageId);
    if (previous) this.entries.set(messageId, { ...previous, text });
    this.view()?.updateMessageTextOnly(messageId, text);
  }

  removeMessage(messageId: string): void {
    this.entries.delete(messageId);
    this.view()?.removeMessage(messageId);
  }

  clearMessages(): void {
    this.entries.clear();
    this.view()?.clearMessages();
  }
}
