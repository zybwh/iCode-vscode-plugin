// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "../chat/provider";
import { renderMessage } from "../chat/webview/components/messages";
import { state } from "../chat/webview/state";

function activity(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "activity-1",
    kind: "activity",
    text: "",
    timestamp: 1,
    ...overrides,
  };
}

describe("TUI-style lifecycle cards", () => {
  beforeEach(() => {
    state.uiLanguage = "zh-CN";
  });

  it("renders a localized running compaction state", () => {
    const element = renderMessage(activity({
      activityType: "compaction",
      activityStatus: "running",
      activitySubtitle: "last_words",
    }));

    expect(element.classList.contains("running")).toBe(true);
    expect(element.querySelector(".activity-card-title")?.textContent).toBe("正在压缩对话…");
    expect(element.textContent).toContain("last_words");
  });

  it("opens failure details by default", () => {
    const element = renderMessage(activity({
      activityType: "agent-load",
      activityStatus: "failed",
      activityDetail: "MCP server failed",
    }));

    expect(element.querySelector(".activity-card-title")?.textContent).toBe("智能体加载失败");
    expect(element.querySelector("details")?.hasAttribute("open")).toBe(true);
    expect(element.textContent).toContain("MCP server failed");
  });
});
