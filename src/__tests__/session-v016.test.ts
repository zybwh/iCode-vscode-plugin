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

function resetRuntimeForSessionTests(): void {
  rt.currentPlanEntries = [];
  rt.currentSessionTitle = "";
  rt.chatPanel = {
    appendDebugEvent: vi.fn(),
    setState: vi.fn(),
  } as never;
  rt.sessionTreeProvider = {
    refresh: vi.fn(),
  } as never;
}

describe("iCode v0.22.5 session updates", () => {
  beforeEach(() => {
    resetRuntimeForSessionTests();
  });

  it("stores plan updates and refreshes the chat panel", async () => {
    await handleSessionUpdate("s1", {
      sessionUpdate: "plan",
      entries: [
        { content: "Inspect ACP contract", priority: "medium", status: "completed" },
        { content: "Render plan", priority: "medium", status: "in_progress" },
      ],
    });

    expect(rt.currentPlanEntries.map((entry) => [entry.content, entry.status])).toEqual([
      ["Inspect ACP contract", "completed"],
      ["Render plan", "in_progress"],
    ]);
    expect(rt.chatPanel.setState).toHaveBeenCalledOnce();
  });

  it("clears stale plan entries when the backend sends an empty plan", async () => {
    rt.currentPlanEntries = [{ content: "old", priority: "medium", status: "pending" }];

    await handleSessionUpdate("s1", { sessionUpdate: "plan", entries: [] });

    expect(rt.currentPlanEntries).toEqual([]);
    expect(rt.chatPanel.setState).toHaveBeenCalledOnce();
  });

  it("stores live session titles and refreshes session surfaces", async () => {
    await handleSessionUpdate("s1", {
      sessionUpdate: "session_info_update",
      title: "Fix login bug",
      updatedAt: "2026-07-08T10:00:00Z",
    });

    expect(rt.currentSessionTitle).toBe("Fix login bug");
    expect(rt.chatPanel.setState).toHaveBeenCalledOnce();
    expect(rt.sessionTreeProvider?.refresh).toHaveBeenCalledOnce();
  });
});
