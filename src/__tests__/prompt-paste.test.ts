import { describe, expect, it } from "vitest";

import { convertPastedImagePathsToMentions, sanitizePromptPaste } from "../common/promptPaste";

describe("sanitizePromptPaste", () => {
  it("normalizes terminal and Windows line endings before insertion", () => {
    expect(sanitizePromptPaste("a\r\nb\rc").text).toBe("a\nb\nc");
  });

  it("keeps short paste text intact", () => {
    const result = sanitizePromptPaste("hello\nworld", 10);

    expect(result.text).toBe("hello\nworld");
    expect(result.truncated).toBe(false);
    expect(result.maxEstimatedTokens).toBe(10);
  });

  it("truncates large ASCII pastes by estimated token budget", () => {
    const result = sanitizePromptPaste("a".repeat(13), 3);

    expect(result.text).toBe("a".repeat(12));
    expect(result.truncated).toBe(true);
    expect(result.originalEstimatedTokens).toBe(4);
  });

  it("budgets CJK text as roughly one token per character", () => {
    const result = sanitizePromptPaste("你好世界", 3);

    expect(result.text).toBe("你好世");
    expect(result.truncated).toBe(true);
    expect(result.originalEstimatedTokens).toBe(4);
  });

  it("converts path-only image paste payloads into quoted image mentions", () => {
    expect(convertPastedImagePathsToMentions("/tmp/screen shot.png")).toBe("@\"/tmp/screen shot.png\" ");
    expect(convertPastedImagePathsToMentions("./assets/a.png\n../b.webp")).toBe("@\"./assets/a.png\" @\"../b.webp\" ");
    expect(convertPastedImagePathsToMentions("file:///tmp/screen%20shot.jpg")).toBe("@\"/tmp/screen shot.jpg\" ");
  });

  it("accepts text/uri-list image drops with comment lines", () => {
    expect(convertPastedImagePathsToMentions("# dragged files\nfile:///tmp/screen%201.png\nfile:///tmp/screen%202.webp")).toBe("@\"/tmp/screen 1.png\" @\"/tmp/screen 2.webp\" ");
  });

  it("does not rewrite ordinary prose that happens to mention an image filename", () => {
    expect(convertPastedImagePathsToMentions("please inspect screenshot.png")).toBeNull();
    expect(convertPastedImagePathsToMentions("screenshot.png")).toBeNull();
    expect(convertPastedImagePathsToMentions("https://example.com/a.png")).toBeNull();
  });
});
