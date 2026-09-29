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

import {
  formatSubAgentEvent,
  formatContextPressureText,
  handleCompactionNotification,
  handleContextPressure,
  handleRichUsageUpdate,
  handleSubAgentEvent,
  isParentUsageUpdate,
} from "../handlers/notifications";
import { rt } from "../state/runtime";

describe("iCode v0.22.5 notification behavior", () => {
  beforeEach(() => {
    rt.currentSessionId = "session-1";
    rt.currentUsageUpdate = null;
    rt.currentContextUsedTokens = undefined;
    rt.currentContextMaxTokens = undefined;
    rt.currentContextPct = undefined;
    rt.activityMessageIds.clear();
    rt.subAgentMessageIds.clear();
    rt.subAgentInvocationByParentCallId.clear();
    rt.subAgentInnerToolCalls.clear();
    rt.subAgentCommittedCompactions.clear();
    rt.toolMessageIds.clear();
    rt.activeCompactions.clear();
    rt.committedCompactions.clear();
    rt.chatPanel = {
      appendDebugEvent: vi.fn(),
      appendMessage: vi.fn(),
      updateMessage: vi.fn(),
      setState: vi.fn(),
    } as never;
  });

  it("accepts backward-compatible and session-owned usage only", () => {
    expect(isParentUsageUpdate({ sessionId: "session-1" }, "session-1")).toBe(true);
    expect(isParentUsageUpdate({
      sessionId: "session-1",
      usageSourceId: "session-1",
    }, "session-1")).toBe(true);
    expect(isParentUsageUpdate({
      sessionId: "session-1",
      usageSourceId: "invocation-1",
    }, "session-1")).toBe(false);
  });

  it("does not let sub-agent usage replace the parent context gauge", () => {
    rt.currentUsageUpdate = { sessionId: "session-1", totalTokens: 120 };
    rt.currentContextUsedTokens = 120;

    handleRichUsageUpdate({
      sessionId: "session-1",
      agentProfile: "Explore",
      usageSourceId: "invocation-1",
      totalTokens: 900,
      maxContextTokens: 1000,
      pct: 90,
    });

    expect(rt.currentUsageUpdate).toEqual({ sessionId: "session-1", totalTokens: 120 });
    expect(rt.currentContextUsedTokens).toBe(120);
    expect(rt.chatPanel.setState).not.toHaveBeenCalled();
  });

  it("updates the parent context gauge for a session-owned source", () => {
    handleRichUsageUpdate({
      sessionId: "session-1",
      usageSourceId: "session-1",
      totalTokens: 400,
      maxContextTokens: 1000,
      pct: 40,
    });

    expect(rt.currentContextUsedTokens).toBe(400);
    expect(rt.currentContextPct).toBe(40);
    expect(rt.chatPanel.setState).toHaveBeenCalledOnce();
  });

  it("distinguishes sub-agent context tokens from cumulative usage", () => {
    expect(formatSubAgentEvent("_chrys/sub_agent_progress", {
      sessionId: "session-1",
      agentName: "Explore",
      invocationId: "invocation-1",
      toolCallCount: 2,
      totalTokens: 400,
      totalUsageTokens: 1200,
    })).toBe("Explore (invocation-1): 2 tool call(s), 400 context token(s), 1200 cumulative token(s).");
  });

  it("keeps new sub-agent usage and context-pressure copy aligned in Chinese", () => {
    expect(formatSubAgentEvent("_chrys/sub_agent_progress", {
      sessionId: "session-1",
      agentName: "Explore",
      invocationId: "invocation-1",
      toolCallCount: 2,
      totalTokens: 400,
      totalUsageTokens: 1200,
    }, "zh-CN")).toBe("Explore (invocation-1)：2 次工具调用，400 个上下文 token，累计 1200 个 token。");

    expect(formatContextPressureText({
      sessionId: "session-1",
      reason: "side-call budget exhausted",
      attempts: 3,
      sideCallTokens: 12000,
      sideCallTokenBudget: 12000,
      source: "main",
    }, "zh-CN")).toBe("上下文压力：side-call budget exhausted；来源=main；尝试次数=3；侧调用 token=12000/12000");
  });

  it("surfaces context pressure as a visible warning", () => {
    handleContextPressure({
      sessionId: "session-1",
      reason: "side-call budget exhausted",
      attempts: 3,
      sideCallTokens: 12000,
      sideCallTokenBudget: 12000,
      source: "main",
    });

    expect(rt.chatPanel.appendDebugEvent).toHaveBeenCalledWith(
      "ContextPressure",
      expect.stringContaining("side-call budget exhausted"),
    );
    expect(rt.chatPanel.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "activity",
      activityType: "context-pressure",
      activityStatus: "warning",
      activityDetail: expect.stringContaining("side-call budget exhausted"),
    }));
  });

  it("surfaces compaction failure details and malformed accepted summaries", () => {
    rt.activeCompactions.set("c1", {
      sessionId: "session-1",
      compactionId: "c1",
      phase: "phase4",
    });

    handleCompactionNotification("_chrys/compaction_finished", {
      sessionId: "session-1",
      compactionId: "c1",
      outcome: "failed",
      failureReason: "side-call budget exhausted",
      formatViolation: "missing Next heading",
    });

    expect(rt.activeCompactions.has("c1")).toBe(false);
    expect(rt.chatPanel.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "activity",
      activityType: "compaction",
      activityStatus: "failed",
      activityDetail: expect.stringContaining("side-call budget exhausted"),
    }));
    expect(rt.chatPanel.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: "activity",
      activityDetail: expect.stringContaining("missing Next heading"),
    }));
  });

  it("tracks only committed sub-agent compactions as durable", () => {
    handleCompactionNotification("_chrys/sub_agent_compaction_committed", {
      sessionId: "session-1",
      agentName: "Explore",
      invocationId: "invocation-1",
      compactionId: "c2",
      phase: "phase4",
    });

    expect(rt.committedCompactions).toEqual(new Set(["invocation-1:c2"]));
    expect(rt.activeCompactions.size).toBe(0);
  });
});


describe("sub-agent dashboard metrics", () => {
  it("uses the existing parent card and preserves metrics across other events", () => {
    rt.currentSessionId = "session-1";
    rt.subAgentMessageIds.clear();
    rt.toolMessageIds.set("parent-call", "parent-card");
    const message: Record<string, unknown> = {};
    rt.chatPanel = {
      appendDebugEvent: vi.fn(), appendMessage: vi.fn(),
      updateMessage: vi.fn((_id, patch) => Object.assign(message, patch)),
    } as never;
    const base = { sessionId: "session-1", invocationId: "child-1", agentName: "Explore" };
    handleSubAgentEvent("_chrys/sub_agent_invocation_start", { ...base, parentCallId: "parent-call" });
    handleSubAgentEvent("_chrys/sub_agent_progress", { ...base, toolCallCount: 2, totalTokens: 123, totalUsageTokens: 456 });
    handleSubAgentEvent("_chrys/sub_agent_tool_call_start", { ...base, toolName: "Read", arguments: {} });
    expect(rt.chatPanel.appendMessage).not.toHaveBeenCalled();
    expect(rt.subAgentMessageIds.get("child-1")).toBe("parent-card");
    expect(message).toMatchObject({ subAgentTokens: 123, subAgentUsageTokens: 456 });
    handleSubAgentEvent("_chrys/sub_agent_compaction_committed", { ...base, compactionId: "compact-1", phase: "phase4" });
    handleSubAgentEvent("_chrys/sub_agent_compaction_committed", { ...base, compactionId: "compact-1", phase: "phase4" });
    expect(message.subAgentCompactions).toBe(1);
  });
});
