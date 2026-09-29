import { describe, expect, it } from "vitest";
import { ReadyMessageQueue } from "../chat/readyMessageQueue";

type Message =
  | { type: "setState"; state: { workspacePath: string; connectionState: string } }
  | { type: "appendMessage"; text: string };

describe("webview ready handshake", () => {
  it("replays the latest startup state after the webview begins listening", () => {
    const delivered: Message[] = [];
    const queue = new ReadyMessageQueue<Message>((message) => delivered.push(message));

    queue.send({ type: "setState", state: { workspacePath: "", connectionState: "resolving-workspace" } });
    queue.send({ type: "setState", state: { workspacePath: "D:\\dev\\project", connectionState: "initializing" } });

    expect(delivered).toEqual([]);
    queue.markReady();
    expect(delivered).toEqual([
      { type: "setState", state: { workspacePath: "D:\\dev\\project", connectionState: "initializing" } },
    ]);
  });

  it("preserves non-state messages queued before ready", () => {
    const delivered: Message[] = [];
    const queue = new ReadyMessageQueue<Message>((message) => delivered.push(message));

    queue.send({ type: "appendMessage", text: "Select a workspace" });
    queue.markReady();

    expect(delivered).toEqual([{ type: "appendMessage", text: "Select a workspace" }]);
  });
});
