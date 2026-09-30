import { marked } from "marked";
import DOMPurify from "dompurify";
import { closedDiagramFence, terminalDiagramMarkup } from "./diagrams";
import { state } from "./state";

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code(token) {
      if (token.lang?.trim().toLowerCase() !== "mermaid" || !closedDiagramFence(token.raw)) return false;
      return terminalDiagramMarkup(token.text, state.uiLanguage === "zh-CN") ?? false;
    },
  },
});

export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}
