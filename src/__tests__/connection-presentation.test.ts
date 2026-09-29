import { describe, expect, it } from "vitest";
import { connectionPresentation } from "../chat/webview/connectionPresentation";

describe("startup presentation", () => {
  it("keeps the selected working directory visible while ACP initializes", () => {
    expect(connectionPresentation("initializing", "D:\\dev\\project", "en")).toEqual({
      label: "Starting iCode",
      detail: "Initializing ACP · D:\\dev\\project",
      tone: "running",
    });
  });

  it("distinguishes ready and failed startup states", () => {
    expect(connectionPresentation("ready", "D:\\dev\\project", "zh-CN").label).toBe("iCode 已就绪");
    expect(connectionPresentation("error", "backend unavailable", "zh-CN").tone).toBe("failed");
  });
});
