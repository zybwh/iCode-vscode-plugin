export function shellCommandFromPrompt(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "!" || trimmed === "！") return "";
  const match = /^[!！]\s*(.+)$/s.exec(trimmed);
  return match ? match[1].trim() : null;
}
