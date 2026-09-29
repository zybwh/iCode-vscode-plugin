import { describe, it, expect } from "vitest";
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  TextContentBlock,
  ImageContentBlock,
  SessionNotification,
  UserMessageChunk,
  AgentMessageChunk,
  ToolCallStart,
  ToolCallProgress,
  InitializeResponse,
  NewSessionResponse,
  PromptResponse,
  SessionInfo,
  AllowedOutcome,
  DeniedOutcome,
} from "../acp/types";

describe("ACP Types", () => {
  it("JSONRPCRequest structure", () => {
    const msg: JSONRPCRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1 },
    };
    expect(msg.jsonrpc).toBe("2.0");
    expect(msg.id).toBe(1);
    expect(msg.method).toBe("initialize");
  });

  it("InitializeResponse parsing", () => {
    const json = `{
      "protocolVersion": 1,
      "agentCapabilities": {
        "loadSession": true,
        "promptCapabilities": {
          "embeddedContext": true,
          "image": false,
          "audio": false
        },
        "mcpCapabilities": {
          "http": true,
          "sse": false
        },
        "sessionCapabilities": {}
      },
      "agentInfo": {
        "name": "iCode",
        "version": "0.9.5"
      }
    }`;
    const resp: InitializeResponse = JSON.parse(json);
    expect(resp.protocolVersion).toBe(1);
    expect(resp.agentInfo?.name).toBe("iCode");
    expect(resp.agentCapabilities?.promptCapabilities?.image).toBe(false);
    expect(resp.agentCapabilities?.mcpCapabilities?.http).toBe(true);
  });

  it("NewSessionResponse parsing", () => {
    const json = `{"sessionId": "abc123"}`;
    const resp: NewSessionResponse = JSON.parse(json);
    expect(resp.sessionId).toBe("abc123");
  });

  it("PromptResponse parsing", () => {
    const json = `{"stopReason": "end_turn", "usage": {"inputTokens": 100, "outputTokens": 50}}`;
    const resp: PromptResponse = JSON.parse(json);
    expect(resp.stopReason).toBe("end_turn");
    expect(resp.usage?.inputTokens).toBe(100);
  });

  it("SessionInfo parsing", () => {
    const json = `{
      "sessionId": "s1",
      "cwd": "/home/user/project",
      "title": "Fix login bug",
      "updatedAt": "2026-01-01T00:00:00Z"
    }`;
    const info: SessionInfo = JSON.parse(json);
    expect(info.sessionId).toBe("s1");
    expect(info.cwd).toBe("/home/user/project");
    expect(info.title).toBe("Fix login bug");
  });

  it("TextContentBlock", () => {
    const block: TextContentBlock = { type: "text", text: "Hello" };
    expect(block.type).toBe("text");
    expect(block.text).toBe("Hello");
  });

  it("ImageContentBlock", () => {
    const block: ImageContentBlock = {
      type: "image",
      data: "base64...",
      mimeType: "image/png",
    };
    expect(block.mimeType).toBe("image/png");
  });

  it("SessionNotification with user_message_chunk", () => {
    const json = `{
      "sessionId": "abc",
      "update": {
        "sessionUpdate": "user_message_chunk",
        "content": [{"type": "text", "text": "Hello"}]
      }
    }`;
    const notif: SessionNotification = JSON.parse(json);
    const update = notif.update as UserMessageChunk;
    expect(update.sessionUpdate).toBe("user_message_chunk");
    expect(update.content[0].type).toBe("text");
  });

  it("SessionNotification with tool_call", () => {
    const json = `{
      "sessionId": "abc",
      "update": {
        "sessionUpdate": "tool_call",
        "toolCallId": "tc1",
        "title": "read_file",
        "kind": "read",
        "status": "in_progress",
        "rawInput": {"path": "foo.txt"}
      }
    }`;
    const notif: SessionNotification = JSON.parse(json);
    const update = notif.update as ToolCallStart;
    expect(update.sessionUpdate).toBe("tool_call");
    expect(update.toolCallId).toBe("tc1");
    expect(update.title).toBe("read_file");
  });

  it("AllowedOutcome", () => {
    const outcome: AllowedOutcome = { outcome: "selected", optionId: "allow_once_opt" };
    expect(outcome.outcome).toBe("selected");
    expect(outcome.optionId).toBe("allow_once_opt");
  });

  it("DeniedOutcome", () => {
    const outcome: DeniedOutcome = { outcome: "cancelled" };
    expect(outcome.outcome).toBe("cancelled");
  });
});
