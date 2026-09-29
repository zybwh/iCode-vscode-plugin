export const PASTE_MAX_TOKENS = 30_000;

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
]);

export interface SanitizedPromptPaste {
  text: string;
  truncated: boolean;
  originalEstimatedTokens: number;
  maxEstimatedTokens: number;
}

const TOKEN_UNITS_PER_TOKEN = 4;

export function sanitizePromptPaste(text: string, maxEstimatedTokens = PASTE_MAX_TOKENS): SanitizedPromptPaste {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const maxUnits = Math.max(0, maxEstimatedTokens * TOKEN_UNITS_PER_TOKEN);
  let totalUnits = 0;
  let keptUnits = 0;
  let kept = "";
  for (const char of normalized) {
    const units = estimatedTokenUnits(char);
    totalUnits += units;
    if (keptUnits + units <= maxUnits) {
      kept += char;
      keptUnits += units;
    }
  }
  return {
    text: totalUnits > maxUnits ? kept : normalized,
    truncated: totalUnits > maxUnits,
    originalEstimatedTokens: Math.ceil(totalUnits / TOKEN_UNITS_PER_TOKEN),
    maxEstimatedTokens,
  };
}

export function convertPastedImagePathsToMentions(text: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paths = parseImagePathPayload(normalized);
  if (!paths.length) return null;
  return `${paths.map(formatImageMention).join(" ")} `;
}

function estimatedTokenUnits(char: string): number {
  return isCjkCharacter(char) ? TOKEN_UNITS_PER_TOKEN : 1;
}

function isCjkCharacter(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0xac00 && code <= 0xd7af)
    || (code >= 0x3100 && code <= 0x312f)
  );
}

function parseImagePathPayload(text: string): string[] {
  const stripped = text.trim();
  if (!stripped) return [];
  for (const candidates of candidatePathGroups(stripped)) {
    const paths = resolveSupportedImageGroup(candidates);
    if (paths.length) return paths;
  }
  return [];
}

function candidatePathGroups(text: string): string[][] {
  const groups: string[][] = [[text]];
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const uriListLines = lines.filter((line) => !line.startsWith("#"));
  if (uriListLines.length && uriListLines.length !== lines.length) groups.push(uriListLines);
  if (lines.length > 1) groups.push(lines);
  const tokens = splitShellLike(text);
  if (tokens.length > 1) groups.push(tokens);
  return groups;
}

function splitShellLike(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "'" || char === "\"") && (!quote || quote === char)) {
      quote = quote ? "" : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += "\\";
  if (quote) return [];
  if (current) tokens.push(current);
  return tokens;
}

function resolveSupportedImageGroup(candidates: string[]): string[] {
  const paths: string[] = [];
  for (const candidate of candidates) {
    const path = resolveSupportedImagePath(candidate);
    if (!path) return [];
    paths.push(path);
  }
  return paths;
}

function resolveSupportedImagePath(candidate: string): string | null {
  const quoted = candidateIsQuoted(candidate);
  const pathText = pathTextFromCandidate(candidate);
  if (hasNonFileUrlScheme(pathText)) return null;
  if (!hasSupportedImageSuffix(pathText) || !looksLikeSinglePath(pathText, quoted)) return null;
  return pathText;
}

function hasNonFileUrlScheme(pathText: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(pathText);
}

function hasSupportedImageSuffix(pathText: string): boolean {
  const match = /(\.[A-Za-z0-9]+)(?:[?#].*)?$/.exec(pathText);
  return Boolean(match && IMAGE_EXTENSIONS.has(match[1].toLowerCase()));
}

function looksLikeSinglePath(pathText: string, quoted: boolean): boolean {
  if (!pathText.trim()) return false;
  if (/\s/.test(pathText) && !(quoted || isAbsoluteLikePath(pathText) || pathText.startsWith("~"))) return false;
  return (
    quoted
    || pathText.startsWith("./")
    || pathText.startsWith("../")
    || pathText.startsWith("~/")
    || pathText.includes("/")
    || pathText.includes("\\")
    || isAbsoluteLikePath(pathText)
  );
}

function isAbsoluteLikePath(pathText: string): boolean {
  return pathText.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(pathText)
    || pathText.startsWith("\\\\")
    || pathText.startsWith("//");
}

function candidateIsQuoted(candidate: string): boolean {
  const text = candidate.trim();
  return text.length >= 2 && text[0] === text[text.length - 1] && (text[0] === "'" || text[0] === "\"");
}

function pathTextFromCandidate(candidate: string): string {
  let text = candidate.trim();
  if (candidateIsQuoted(text)) text = text.slice(1, -1);
  if (!/^file:/i.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== "file:") return text;
    const host = url.hostname && url.hostname !== "localhost" ? `//${url.hostname}` : "";
    return `${host}${decodeURIComponent(url.pathname)}`;
  } catch {
    return text;
  }
}

function formatImageMention(pathText: string): string {
  const escaped = pathText.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `@"${escaped}"`;
}
