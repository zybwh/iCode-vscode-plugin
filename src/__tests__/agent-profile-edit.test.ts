import { describe, expect, it } from "vitest";

import {
  agentProfileMutation,
  agentProfileDeleteOutcome,
  buildAgentProfileSave,
  isBuiltinAgentName,
} from "../chat/agentProfileEdit";

describe("agent profile edit payloads", () => {
  it("preserves stable identity and unexposed fields when editing", () => {
    const existing = {
      id: "b011c0de0001",
      name: "Code",
      display_name: "Code",
      description: "Old description",
      instructions: "Old instructions",
      tools: {
        builtins: ["filesystem.read"],
        mcp: [{
          name: "docs",
          transport: "http",
          url: "https://example.invalid/mcp",
          headers: { Authorization: "***" },
          use_progressive_disclosure: true,
        }],
      },
      memory: { files: ["AGENTS.md"] },
      compaction: { phase4_side_call_token_budget: 12000 },
      metadata: { owner: "user" },
      future_backend_field: { enabled: true },
    };

    const result = buildAgentProfileSave(existing, {
      name: "Code Renamed",
      display_name: "Code Assistant",
      description: "Updated description",
      instructions: "Updated instructions",
    });

    expect(result).toEqual({
      ...existing,
      name: "Code",
      display_name: "Code Assistant",
      description: "Updated description",
      instructions: "Updated instructions",
    });
    expect(result.id).toBe("b011c0de0001");
    expect(result.tools).toBe(existing.tools);
    expect(result.future_backend_field).toBe(existing.future_backend_field);
  });

  it("does not fabricate an id for a new profile", () => {
    expect(buildAgentProfileSave(undefined, {
      name: "Reviewer",
      display_name: "Reviewer",
      description: "Reviews changes",
      instructions: "Review carefully.",
    })).toEqual({
      name: "Reviewer",
      display_name: "Reviewer",
      description: "Reviews changes",
      instructions: "Review carefully.",
    });
  });

  it("refuses to save an existing profile when its complete payload is unavailable", () => {
    expect(() => buildAgentProfileSave(undefined, {
      name: "Code",
      display_name: "Code",
      description: "",
      instructions: "",
    }, "Code")).toThrow("Complete agent profile data is unavailable for Code");
  });

  it("distinguishes restoring a built-in override from deleting a user profile", () => {
    expect(isBuiltinAgentName("Code")).toBe(true);
    expect(isBuiltinAgentName("QA")).toBe(true);
    expect(isBuiltinAgentName("Reviewer")).toBe(false);
    expect(agentProfileDeleteOutcome("Code", true)).toBe("restored_builtin");
    expect(agentProfileDeleteOutcome("Code", false)).toBe("already_builtin");
    expect(agentProfileDeleteOutcome("Reviewer", true)).toBe("deleted");
    expect(agentProfileDeleteOutcome("Reviewer", false)).toBe("not_found");
  });

  it("uses backend profile metadata to choose reset instead of a hardcoded name", () => {
    expect(agentProfileMutation({ name: "CustomBuiltIn", builtin: true })).toBe("reset");
    expect(agentProfileMutation({ name: "Code", builtin: false })).toBe("delete");
  });
});
