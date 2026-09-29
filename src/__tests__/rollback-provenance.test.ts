import { describe, expect, it } from "vitest";
import {
  formatDiffRiskDetail,
  formatMutationBadges,
  formatRollbackResultMessage,
} from "../common/provenanceDisplay";

describe("rollback and mutation provenance display", () => {
  it("formats mutation badges for foreign and inferred files", () => {
    expect(formatMutationBadges({
      path: "/repo/a.ts",
      operation: "modify",
      contested: true,
      inferred: true,
    })).toEqual(["external overlap", "inferred"]);
  });

  it("formats snapshot skip reasons", () => {
    expect(formatMutationBadges({
      path: "/repo/b.bin",
      operation: "modify",
      beforeSkip: "binary",
      afterSkip: "too_large",
    })).toEqual(["before: binary", "after: too large"]);
  });

  it("formats mutation badges in Simplified Chinese", () => {
    expect(formatMutationBadges({
      path: "/repo/b.bin",
      operation: "modify",
      contested: true,
      inferred: true,
      beforeSkip: "binary",
      afterSkip: "too_large",
    }, "zh-CN")).toEqual(["外部改动重叠", "推断", "之前：二进制", "之后：过大"]);
  });

  it("formats diff risk detail", () => {
    expect(formatDiffRiskDetail({
      path: "/repo/a.ts",
      operation: "modify",
      beforeText: "a",
      afterText: "b",
      beforeHash: "1",
      afterHash: "2",
      isBinary: false,
      bytesChanged: true,
      contested: true,
      inferred: false,
    })).toBe("modify · external overlap · 1 -> 1 chars");
  });

  it("formats diff risk detail in Simplified Chinese", () => {
    expect(formatDiffRiskDetail({
      path: "/repo/a.ts",
      operation: "modify",
      beforeText: "a",
      afterText: "b",
      beforeHash: "1",
      afterHash: "2",
      isBinary: false,
      bytesChanged: true,
      contested: true,
      inferred: false,
    }, "zh-CN")).toBe("modify · 外部改动重叠 · 1 -> 1 字符");
  });

  it("formats rollback warnings and exclusions", () => {
    const message = formatRollbackResultMessage({
      sessionId: "s1",
      targetTurn: 2,
      filesReverted: 1,
      restoreResults: [],
      warnings: ["working tree changed"],
      exclusions: [{ path: "/repo/b.bin", reason: "binary" }],
    });

    expect(message).toContain("working tree changed");
    expect(message).toContain("b.bin: binary");
  });

  it("formats rollback warnings and exclusions in Simplified Chinese", () => {
    const message = formatRollbackResultMessage({
      sessionId: "s1",
      targetTurn: 2,
      filesReverted: 1,
      restoreResults: [],
      warnings: ["working tree changed"],
      exclusions: [{ path: "/repo/b.bin", reason: "binary" }],
    }, { language: "zh-CN" });

    expect(message).toContain("已回滚到第 2 轮；已还原 1 个文件。");
    expect(message).toContain("警告：working tree changed");
    expect(message).toContain("已排除 b.bin：二进制");
  });
});
