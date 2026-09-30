import { installedDiagramEngine } from "./diagramEngineTypes";

const cache = new Map<string, string | null>();
let missingEngineHandler: (() => void) | null = null;

/** The webview loads the engine lazily; renders before it arrives fall back to source. */
export function onMissingDiagramEngine(handler: () => void): void {
  missingEngineHandler = handler;
}

/** True when text contains a mermaid fence that may still need the engine. */
export function mentionsMermaid(text: string): boolean {
  return /(```|~~~)\s*mermaid/i.test(text);
}

function wideCharacter(char: string): boolean {
  const code = char.codePointAt(0)!;
  return code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe6f)
    || (code >= 0xff01 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1faff) || (code >= 0x20000 && code <= 0x3fffd));
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** The ASCII layout library counts UTF-16 cells. Reserve two cells for wide glyphs. */
function terminalSource(source: string): { source: string; restore: (text: string) => string } {
  if (/[\ue000-\uf8ff]/u.test(source)) throw new Error("Reserved layout characters");
  const chars = new Map<string, string>();
  let converted = "";
  for (const char of source) {
    if (!wideCharacter(char)) { converted += char; continue; }
    let pair = chars.get(char);
    if (!pair) {
      if (chars.size >= 4000) throw new Error("Too many distinct labels");
      pair = String.fromCharCode(0xe000 + chars.size) + "\uf8ff";
      chars.set(char, pair);
    }
    converted += pair;
  }
  return { source: converted, restore: text => {
    for (const [char, pair] of chars) text = text.replaceAll(pair, char);
    return text;
  } };
}

export function renderTerminalDiagram(source: string): string | null {
  if (cache.has(source)) return cache.get(source)!;
  let result: string | null = null;
  try {
    // Keep the synchronous parser bounded. Unsupported diagrams retain their source.
    if (source.length > 12000 || source.split("\n").length > 150 || source.split(/--|==|\.\./).length > 150) return null;
    if (!/^\s*(graph|flowchart|stateDiagram(?:-v2)?|sequenceDiagram|classDiagram|erDiagram|xychart(?:-beta)?)\b/.test(source)) return null;
    // The library currently treats RL as LR; showing reversed semantics would be misleading.
    if (/^\s*(?:graph|flowchart)\s+RL\b/.test(source)) return null;
    const engine = installedDiagramEngine();
    if (!engine) {
      // Rendered as source until the engine arrives; not cached so it re-renders then.
      missingEngineHandler?.();
      return null;
    }
    const prepared = terminalSource(source);
    const diagram = prepared.restore(engine.renderMermaidASCII(prepared.source, {
      colorMode: "none", useAscii: false, paddingX: 4, paddingY: 2, boxBorderPadding: 1,
    }));
    if (diagram.length > 100000 || !diagram.trim()) return null;
    result = diagramMarkup(diagram);
  } catch { /* Incomplete or unsupported syntax stays readable as source. */ }
  if (cache.size >= 80) cache.delete(cache.keys().next().value!);
  cache.set(source, result);
  return result;
}

const LINE_CHARACTER = /[\u2500-\u257f\u2190-\u21ff►▼▲◄]/u;

/**
 * Wide characters keep one span each (each needs its own cell width), but runs of
 * box-drawing characters share a span: a large diagram otherwise produced one DOM
 * node per character.
 */
function diagramMarkup(diagram: string): string {
  const parts: string[] = [];
  let line = "";
  const flushLine = () => {
    if (line) parts.push(`<span class="diagram-line">${escape(line)}</span>`);
    line = "";
  };
  for (const char of diagram) {
    if (wideCharacter(char)) {
      flushLine();
      parts.push(`<span class="diagram-wide">${escape(char)}</span>`);
    } else if (LINE_CHARACTER.test(char)) {
      line += char;
    } else {
      flushLine();
      parts.push(escape(char));
    }
  }
  flushLine();
  return parts.join("");
}

export function closedDiagramFence(raw: string): boolean {
  const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*\n/.exec(raw);
  if (!opening) return false;
  const closing = raw.trimEnd().split("\n").at(-1)!;
  return new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`).test(closing);
}

export function terminalDiagramMarkup(source: string, chinese: boolean): string | null {
  const diagram = renderTerminalDiagram(source);
  if (!diagram) return null;
  return `<figure class="terminal-diagram"><pre class="terminal-diagram-canvas" tabindex="0" aria-label="Mermaid ${chinese ? "图表" : "diagram"}">${diagram}</pre><details class="diagram-source"><summary>${chinese ? "查看源码" : "View source"}</summary><pre><code>${escape(source)}</code></pre></details></figure>`;
}
