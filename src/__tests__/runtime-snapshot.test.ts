import { describe, expect, it } from "vitest";
import { mergeRuntimeSnapshot } from "../common/runtimeSnapshot";
import type { RuntimeSnapshot, RuntimeUpdateMessage } from "../acp/types";

describe("runtime snapshot updates", () => {
  it("merges partial notification fields without erasing the previous snapshot", () => {
    const previous: RuntimeSnapshot = {
      sessionId: "session-1",
      agentProfile: "Code",
      modelProfileId: "model-1",
      toolNames: ["read_file"],
      runtimeDetails: { model: { name: "test-model" } },
      pct: 10,
    };
    const update: RuntimeUpdateMessage = {
      sessionId: "session-1",
      runtime: { pct: 25, totalTokens: 2_500 },
    };

    expect(mergeRuntimeSnapshot(previous, update)).toEqual({
      ...previous,
      pct: 25,
      totalTokens: 2_500,
    });
  });

  it("replaces runtimeDetails as one complete child object", () => {
    const previous: RuntimeSnapshot = {
      sessionId: "session-1",
      runtimeDetails: {
        model: { name: "old" },
        builtinTools: { filesystem: ["read_file"] },
      },
    };
    const replacement = { model: { name: "new" } };

    expect(mergeRuntimeSnapshot(previous, {
      sessionId: "session-1",
      runtime: { runtimeDetails: replacement },
    }).runtimeDetails).toEqual(replacement);
  });

  it("does not carry state across session ids", () => {
    const previous: RuntimeSnapshot = { sessionId: "old", agentProfile: "Code" };
    expect(mergeRuntimeSnapshot(previous, {
      sessionId: "new",
      runtime: { pct: 1 },
    })).toEqual({ sessionId: "new", pct: 1 });
  });
});
