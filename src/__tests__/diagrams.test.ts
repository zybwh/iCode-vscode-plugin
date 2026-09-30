// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { closedDiagramFence, renderTerminalDiagram } from "../chat/webview/diagrams";
import { renderMarkdown } from "../chat/webview/renderer";

function rendered(source: string) {
  const root = document.createElement("div");
  root.innerHTML = renderMarkdown(source);
  return root;
}

describe("terminal diagrams", () => {
  it("renders closed fences inline without SVG or a preview button", () => {
    const root = rendered('```mermaid\ngraph LR\n A[输入] --> B[处理] --> C[输出]\n```');
    expect(root.querySelector(".terminal-diagram-canvas")?.textContent).toContain("输入");
    expect(root.querySelector(".terminal-diagram-canvas")?.textContent).toContain("┌");
    expect(root.querySelector("img, svg, button")).toBeNull();
    expect(root.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
    expect(root.querySelector("details code")?.textContent).toContain("A[输入]");
    expect(root.querySelectorAll(".diagram-wide").length).toBeGreaterThan(0);
  });
  it("keeps CJK cell widths aligned with box borders", () => {
    const root = document.createElement("div");
    root.innerHTML = renderTerminalDiagram('graph LR\n A[输入] --> B[输出]')!;
    const widths = root.textContent!.split('\n').map(line => [...line].reduce((n, c) => n + (/[输入出]/.test(c) ? 2 : 1), 0));
    expect(new Set(widths).size).toBe(1);
    expect(root.textContent).not.toMatch(/[\ue000-\uf8ff]/);
  });
  it.each([
    'sequenceDiagram\n Alice->>Bob: hello',
    'classDiagram\n class User {\n +name\n }',
    'erDiagram\n USER ||--o{ ORDER : places',
    'stateDiagram-v2\n [*] --> Ready\n Ready --> [*]',
  ])("renders supported diagram families: %s", source => {
    expect(renderTerminalDiagram(source)).toBeTruthy();
  });
  it("retains incomplete, unsupported and bounded-out source", () => {
    expect(rendered('```mermaid\ngraph LR\n A-->B').querySelector(".terminal-diagram")).toBeNull();
    expect(rendered('```mermaid\nunsupportedDiagram\n```').querySelector('code')?.textContent).toContain('unsupportedDiagram');
    expect(renderTerminalDiagram('graph RL\n A-->B')).toBeNull();
    expect(renderTerminalDiagram('graph LR\n' + 'x'.repeat(13000))).toBeNull();
    expect(closedDiagramFence('````mermaid\ngraph LR\n A-->B\n```')).toBe(false);
    expect(closedDiagramFence('~~~mermaid\ngraph LR\n A-->B\n~~~')).toBe(true);
  });
  it("does not turn diagram labels or source into executable markup", () => {
    const root = rendered('```mermaid\ngraph LR\n A["<script>alert(1)</script>"] --> B[done]\n```');
    expect(root.querySelector('script, iframe, img')).toBeNull();
    expect(root.textContent).toContain('<script>');
  });
});
