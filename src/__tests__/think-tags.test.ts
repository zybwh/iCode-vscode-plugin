import { describe, expect, it } from "vitest";

import { processThinkTags } from "../chat/webview/thinkTags";

describe("processThinkTags", () => {
  it("removes think blocks from final agent messages", () => {
    expect(processThinkTags("Before\n<think>hidden reasoning</think>\nAfter")).toBe("Before\n\nAfter");
  });

  it("renders think blocks as italic paragraphs for intermediate agent messages", () => {
    expect(processThinkTags("<think>one\n\ntwo</think>", true)).toBe("Think: *one*\n\n*two*");
  });

  it("handles case-insensitive multiline tags", () => {
    expect(processThinkTags("x <THINK>a\nb</THINK> y")).toBe("x  y");
  });
});
