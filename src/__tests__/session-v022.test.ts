import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class EventEmitter<T> {
    event = vi.fn();
    fire = vi.fn((_event: T) => undefined);
    dispose = vi.fn();
  }
  return {
    EventEmitter,
    workspace: {
      getConfiguration: vi.fn(() => ({ get: vi.fn(() => undefined) })),
      asRelativePath: vi.fn((value: string) => value),
    },
    env: { language: "en" },
  };
});

import { handleSessionUpdate } from "../handlers/session";
import { rt } from "../state/runtime";

describe("iCode v0.22.5 structured tool content", () => {
  beforeEach(() => {
    rt.toolMessageIds.clear();
    rt.toolSnapshots.clear();
    rt.chatPanel = {
      appendDebugEvent: vi.fn(),
      appendMessage: vi.fn(),
      updateMessage: vi.fn(),
      setState: vi.fn(),
    } as never;
  });

  it("projects hosted images and resource links into tool messages", async () => {
    await handleSessionUpdate("s1", {
      sessionUpdate: "tool_call",
      toolCallId: "hosted-1",
      title: "image_generation",
      kind: "other",
      status: "in_progress",
      _meta: { chrys: { provider_hosted: true, provider: "openai", hosted_family: "image_generation" } },
      content: [
        { content: { type: "image", data: "QUJD", mimeType: "image/png" } },
        {
          content: {
            type: "resource_link",
            name: "report.csv",
            uri: "https://files.example/report.csv",
            mimeType: "text/csv",
            size: 12,
          },
        },
      ],
    });

    expect(rt.chatPanel?.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      toolContent: [
        { type: "image", data: "QUJD", mimeType: "image/png" },
        {
          type: "resource_link",
          name: "report.csv",
          uri: "https://files.example/report.csv",
          mimeType: "text/csv",
          size: 12,
        },
      ],
      toolMeta: { chrys: { provider_hosted: true, provider: "openai", hosted_family: "image_generation" } },
    }));

    await handleSessionUpdate("s1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "hosted-1",
      status: "completed",
      _meta: { chrys: { provider_hosted: true, provider: "openai", provider_status: "completed" } },
      content: [{ content: { type: "text", text: "done" } }],
    });

    expect(rt.chatPanel?.updateMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        toolContent: [{ type: "text", text: "done" }],
        toolMeta: { chrys: { provider_hosted: true, provider: "openai", provider_status: "completed" } },
      }),
    );
  });

  it("preserves accurate tool kinds from history replay updates", async () => {
    await handleSessionUpdate("s1", {
      sessionUpdate: "tool_call",
      toolCallId: "history-read-1",
      title: "read_file",
      kind: "read",
      status: "completed",
      rawInput: { path: "README.md" },
    });

    expect(rt.chatPanel?.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: "history-read-1",
      toolKind: "read",
    }));
  });

  it("removes text content duplicated by the same streaming rawOutput update", async () => {
    await handleSessionUpdate("s1", {
      sessionUpdate: "tool_call",
      toolCallId: "stream-1",
      title: "hosted_search",
      status: "in_progress",
    });
    await handleSessionUpdate("s1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "stream-1",
      status: "in_progress",
      rawOutput: "first chunk",
      content: [{ content: { type: "text", text: "first chunk" } }],
    });
    await handleSessionUpdate("s1", {
      sessionUpdate: "tool_call_update",
      toolCallId: "stream-1",
      status: "in_progress",
      rawOutput: "second chunk",
      content: [{ content: { type: "text", text: "second chunk" } }],
    });

    expect(rt.chatPanel?.updateMessage).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        toolContent: [],
        toolOutput: "first chunksecond chunk",
      }),
    );
  });
});
