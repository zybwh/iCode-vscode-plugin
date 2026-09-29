const THINK_RE = /<think>([\s\S]*?)<\/think>/gi;

export function processThinkTags(text: string, intermediate = false): string {
  if (!text) return text;
  if (!intermediate) {
    return text.replace(THINK_RE, "").trim();
  }
  return text.replace(THINK_RE, (_match, inner: string) => {
    const body = String(inner)
      .trim()
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => `*${part}*`)
      .join("\n\n");
    return body ? `Think: ${body}` : "";
  }).trim();
}
