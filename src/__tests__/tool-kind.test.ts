import { describe, expect, it } from "vitest";

import { normalizeToolKind } from "../chat/webview/components/toolCards";
import { toolRendererCoverage, toolRendererFor } from "../common/toolRendering";

describe("normalizeToolKind", () => {
  it("maps iCode runtime kinds to VSIX renderer kinds", () => {
    expect(normalizeToolKind("chrys.shell")).toBe("execute");
    expect(normalizeToolKind("chrys.search")).toBe("search");
    expect(normalizeToolKind("chrys.filesystem.read")).toBe("read");
    expect(normalizeToolKind("chrys.filesystem.write")).toBe("edit");
    expect(normalizeToolKind("chrys.sleep")).toBe("sleep");
    expect(normalizeToolKind("chrys.sub_agent")).toBe("sub_agent");
    expect(normalizeToolKind("chrys.skill")).toBe("skill");
    expect(normalizeToolKind("chrys.ask_user")).toBe("ask_user");
    expect(normalizeToolKind("chrys.doc_converter")).toBe("doc_converter");
    expect(normalizeToolKind("chrys.mcp")).toBe("mcp");
  });

  it("uses common tool names as a fallback when kind is missing", () => {
    expect(normalizeToolKind(undefined, "zsh")).toBe("execute");
    expect(normalizeToolKind(undefined, "grep")).toBe("search");
    expect(normalizeToolKind(undefined, "write_file")).toBe("edit");
    expect(normalizeToolKind(undefined, "read_file")).toBe("read");
    expect(normalizeToolKind(undefined, "Sub-agent: Explore")).toBe("sub_agent");
    expect(normalizeToolKind(undefined, "load_skill")).toBe("skill");
    expect(normalizeToolKind(undefined, "read_skill_resource")).toBe("skill");
    expect(normalizeToolKind(undefined, "run_skill_script")).toBe("skill");
  });

  it("reports renderer coverage for support diagnostics", () => {
    expect(toolRendererFor("chrys.shell", "zsh")).toBe("shell");
    expect(toolRendererFor("chrys.ask_user", "ask_user")).toBe("ask_user");
    expect(toolRendererFor(undefined, "unknown_tool")).toBe("generic");

    const coverage = toolRendererCoverage([
      { toolCallId: "a", toolName: "zsh", kind: "chrys.shell", status: "completed", hasInput: true, hasOutput: true },
      { toolCallId: "b", toolName: "ask_user", kind: "chrys.ask_user", status: "completed", hasInput: true, hasOutput: true },
      { toolCallId: "c", toolName: "unknown_tool", status: "completed", hasInput: true, hasOutput: false },
    ]);

    expect(coverage.total).toBe(3);
    expect(coverage.generic).toBe(1);
    expect(coverage.missingKind).toBe(1);
    expect(coverage.byRenderer).toMatchObject({ shell: 1, ask_user: 1, generic: 1 });
    expect(coverage.recent[2]).toMatchObject({
      id: "c",
      toolName: "unknown_tool",
      rawKind: "",
      normalizedKind: "other",
      renderer: "generic",
    });
  });
});
