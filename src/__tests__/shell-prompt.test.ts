import { describe, expect, it } from "vitest";

import { shellCommandFromPrompt } from "../chat/webview/shellPrompt";

describe("shellCommandFromPrompt", () => {
  it("opens the terminal for a bare shell trigger", () => {
    expect(shellCommandFromPrompt("!")).toBe("");
    expect(shellCommandFromPrompt("！")).toBe("");
  });

  it("extracts shell commands from ASCII and fullwidth triggers", () => {
    expect(shellCommandFromPrompt("! npm test")).toBe("npm test");
    expect(shellCommandFromPrompt("！ pnpm build")).toBe("pnpm build");
  });

  it("does not treat ordinary messages as shell commands", () => {
    expect(shellCommandFromPrompt("please run npm test")).toBeNull();
  });
});
