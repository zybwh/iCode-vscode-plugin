import { describe, expect, it } from "vitest";

import {
  lineChangeSummary,
  isToolErrorMessage,
  mcpServerForTool,
  parseAskUserToolOutput,
  parseDocumentToolOutput,
  parseReadOutput,
  parseShellOutput,
  parseSkillToolOutput,
  structuredToolContentForDisplay,
} from "../chat/webview/components/toolCards";

describe("tool card parsers", () => {
  it("parses read_file output into bounded preview inputs", () => {
    const parsed = parseReadOutput([
      "File: src/app.ts (3 lines, 42 chars)",
      "10|export const a = 1;",
      "11|export const b = 2;",
      "[Truncated after 2 lines]",
    ].join("\n"));

    expect(parsed.path).toBe("src/app.ts");
    expect(parsed.totalLines).toBe(3);
    expect(parsed.totalChars).toBe(42);
    expect(parsed.lines).toEqual([
      { line: 10, text: "export const a = 1;" },
      { line: 11, text: "export const b = 2;" },
    ]);
    expect(parsed.truncated).toBe(true);
    expect(parsed.isError).toBe(false);
  });

  it("strips shell exit code metadata from visible output", () => {
    const parsed = parseShellOutput("one\ntwo\n[exit_code: 7]");

    expect(parsed.body).toBe("one\ntwo");
    expect(parsed.preview).toBe("one\ntwo");
    expect(parsed.exitCode).toBe(7);
  });

  it("detects UI-styled tool error messages separately from raw logs", () => {
    expect(isToolErrorMessage("Error: Tool execution was rejected by user.\nUser reason: cancelled.")).toBe(true);
    expect(isToolErrorMessage("npm ERR! missing script: test")).toBe(false);
  });

  it("summarizes edit previews with addition and removal counts", () => {
    expect(lineChangeSummary("a\nb\nc", "a\nB\nc\nd")).toEqual({ additions: 2, removals: 1 });
    expect(lineChangeSummary("", "created")).toEqual({ additions: 1, removals: 0 });
  });

  it("parses load_skill metadata into a compact transcript preview", () => {
    const parsed = parseSkillToolOutput("load_skill", { skill_name: "reviewer" }, [
      "---",
      "name: reviewer",
      "---",
      "<instructions>",
      "Use this skill for code review.",
      "</instructions>",
      "<skill_dir>/tmp/reviewer</skill_dir>",
      "<resource name=\"checklist.md\" />",
      "<script name=\"audit.sh\" />",
    ].join("\n"));

    expect(parsed.title).toBe("reviewer");
    expect(parsed.subtitle).toContain("1 resource");
    expect(parsed.subtitle).toContain("1 script");
    expect(parsed.skillDir).toBe("/tmp/reviewer");
    expect(parsed.resources).toEqual(["checklist.md"]);
    expect(parsed.scripts).toEqual(["audit.sh"]);
    expect(parsed.preview).toContain("Use this skill for code review.");
  });

  it("parses run_skill_script exit-code metadata", () => {
    const parsed = parseSkillToolOutput("run_skill_script", { skill_name: "reviewer", script_name: "audit.sh" }, "done\n[exit_code: 2]");

    expect(parsed.title).toBe("audit.sh");
    expect(parsed.subtitle).toBe("exit 2");
    expect(parsed.exitCode).toBe(2);
    expect(parsed.isError).toBe(true);
    expect(parsed.preview).toBe("done");
  });

  it("strips ask_user transport prefixes while preserving question and options", () => {
    const parsed = parseAskUserToolOutput({
      question: "Pick a branch",
      options: ["main", "release"],
    }, "User response: release");

    expect(parsed.question).toBe("Pick a branch");
    expect(parsed.options).toEqual(["main", "release"]);
    expect(parsed.answer).toBe("release");
    expect(parsed.answered).toBe(true);
    expect(parsed.isError).toBe(false);
  });

  it("parses v0.22.5 ask_user batches with multi-select, notes, and unanswered questions", () => {
    const parsed = parseAskUserToolOutput({
      questions: [
        {
          question: "Which targets?",
          header: "Targets",
          multi_select: true,
          options: [
            { label: "TUI", description: "Terminal frontend" },
            { label: "ACP", description: "Editor frontend" },
          ],
        },
        { question: "Anything else?", header: "Notes", options: [] },
      ],
    }, JSON.stringify({
      responses: [
        { question: "Which targets?", answers: ["TUI", "ACP"], note: "both" },
        { question: "Anything else?", answers: [], unanswered: true },
      ],
    }));

    expect(parsed.questions).toEqual([
      expect.objectContaining({
        question: "Which targets?",
        header: "Targets",
        multiSelect: true,
        options: [
          { label: "TUI", description: "Terminal frontend" },
          { label: "ACP", description: "Editor frontend" },
        ],
        answers: ["TUI", "ACP"],
        note: "both",
        unanswered: false,
      }),
      expect.objectContaining({
        question: "Anything else?",
        answers: [],
        unanswered: true,
      }),
    ]);
  });

  it("keeps ask_user failures distinct from answered prompts", () => {
    const parsed = parseAskUserToolOutput({
      questions: [{ question: "Continue?", options: [] }],
    }, "Error: ask_user_no_response");

    expect(parsed.isError).toBe(true);
    expect(parsed.answered).toBe(false);
  });

  it("deduplicates structured text already shown as raw tool output", () => {
    expect(structuredToolContentForDisplay([
      { type: "text", text: "same result" },
      { type: "image", data: "QUJD", mimeType: "image/png" },
    ], "same result")).toEqual([
      { type: "image", data: "QUJD", mimeType: "image/png" },
    ]);
    expect(structuredToolContentForDisplay([
      { type: "text", text: "second chunk" },
    ], "first chunk\nsecond chunk")).toEqual([]);
    expect(structuredToolContentForDisplay([
      { type: "text", text: "x".repeat(5_100) },
    ], `${"x".repeat(5_000)}\n... (truncated, 5100 total chars)`)).toEqual([]);
  });

  it("does not drop independent structured text that is only a substring of raw output", () => {
    expect(structuredToolContentForDisplay([
      { type: "text", text: "ok" },
      { type: "text", text: "book" },
    ], "notebook result")).toEqual([
      { type: "text", text: "ok" },
      { type: "text", text: "book" },
    ]);
  });

  it("parses document converter output and saved markdown paths", () => {
    const parsed = parseDocumentToolOutput({ path: "report.pdf" }, [
      "File: /work/report.pdf (120 lines, 9000 chars, ~2100 tokens)",
      "Document is too large to return inline. Saved Markdown to: /tmp/session/doc_converter/report.md",
      "",
      "## Summary",
      "- Lines: 120",
    ].join("\n"));

    expect(parsed.filePath).toBe("/work/report.pdf");
    expect(parsed.savedPath).toBe("/tmp/session/doc_converter/report.md");
    expect(parsed.lineCount).toBe(120);
    expect(parsed.charCount).toBe(9000);
    expect(parsed.tokenCount).toBe(2100);
    expect(parsed.isLarge).toBe(true);
    expect(parsed.preview).toContain("Document is too large");
  });

  it("resolves MCP tool calls back to their runtime server", () => {
    const mapping = {
      github: ["search_repositories", "github_get_issue"],
      linear: ["linear.create_issue"],
    };

    expect(mcpServerForTool("github_get_issue", mapping)).toBe("github");
    expect(mcpServerForTool("linear.create_issue", mapping)).toBe("linear");
    expect(mcpServerForTool("unknown_tool", mapping)).toBe("");
  });
});
