import * as vscode from "vscode";
import type { ContentBlock } from "../acp/types";

/**
 * Collect context from the active text editor.
 *
 * - If the user has selected text, returns the selection.
 * - Otherwise, returns ~50 lines around the cursor.
 *
 * Returns undefined when no editor is active.
 */
export function collectEditorContext(): ContentBlock | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const filePath = vscode.workspace.asRelativePath(editor.document.uri);
  const language = editor.document.languageId;

  let body: string;

  if (!editor.selection.isEmpty) {
    body = editor.document.getText(editor.selection);
  } else {
    const cursorLine = editor.selection.active.line;
    const rangeStart = Math.max(0, cursorLine - 25);
    const rangeEnd = Math.min(editor.document.lineCount, cursorLine + 25);
    body = editor.document.getText(
      new vscode.Range(rangeStart, 0, rangeEnd, 0),
    );
  }

  const text = `@file ${filePath}\n\`\`\`${language}\n${body}\n\`\`\``;

  return { type: "text", text };
}
