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

/** Containers whose HTML comes from renderMarkdown (model, tool or MCP authored). */
export const UNTRUSTED_MARKUP_SELECTOR = ".bubble-content, .tool-structured-text, .activity-card-detail-body, .ask-user-question-body";

// Model and tool output must not be able to forge the chat's own action controls:
// click handlers act on data-* attributes, and form controls could imitate buttons.
const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option", "style"],
};

export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, SANITIZE_OPTIONS);
}

/** True when an element sits inside rendered untrusted markup rather than extension chrome. */
export function isInsideUntrustedMarkup(element: Element): boolean {
  return Boolean(element.closest(UNTRUSTED_MARKUP_SELECTOR));
}
