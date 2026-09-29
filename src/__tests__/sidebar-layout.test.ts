import { describe, expect, it } from "vitest";
import { sidebarOpenForViewport } from "../chat/webview/sidebarLayout";

describe("auxiliary sidebar layout", () => {
  it("keeps the secondary panel out of a narrow chat by default", () => {
    expect(sidebarOpenForViewport(620, "auto")).toBe(false);
  });

  it("shows the secondary panel alongside the chat on a wide viewport by default", () => {
    expect(sidebarOpenForViewport(981, "auto")).toBe(true);
  });

  it("honours an explicit open preference on a narrow viewport", () => {
    expect(sidebarOpenForViewport(620, "open")).toBe(true);
  });

  it("honours an explicit closed preference on a wide viewport", () => {
    expect(sidebarOpenForViewport(981, "closed")).toBe(false);
  });
});
