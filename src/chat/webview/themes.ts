// TUI theme presets, applied as CSS variable overrides.

// ──────────────────────────────────────────────
// Theme presets (CSS variable overrides)
// ──────────────────────────────────────────────

export type ThemePalette = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  panel: string;
  foreground: string;
  error: string;
  warning: string;
  success: string;
  muted?: string;
  codeBg?: string;
  buttonFg?: string;
};

export function themeVars(palette: ThemePalette): Record<string, string> {
  const muted = palette.muted ?? palette.secondary;
  const codeBg = palette.codeBg ?? palette.surface;
  return {
    "--chrys-bg": palette.background,
    "--chrys-fg": palette.foreground,
    "--chrys-border": palette.primary,
    "--chrys-accent": palette.accent,
    "--chrys-input-bg": palette.background,
    "--chrys-input-fg": palette.foreground,
    "--chrys-button-bg": palette.accent,
    "--chrys-button-fg": palette.buttonFg ?? palette.background,
    "--chrys-user-bg": palette.surface,
    "--chrys-tool-bg": codeBg,
    "--chrys-code-bg": codeBg,
    "--chrys-tui-bg": palette.background,
    "--chrys-tui-panel": palette.panel,
    "--chrys-tui-primary": palette.primary,
    "--chrys-tui-cyan": palette.primary,
    "--chrys-tui-green": palette.success,
    "--chrys-tui-yellow": palette.warning,
    "--chrys-tui-magenta": palette.accent,
    "--chrys-tui-accent": palette.accent,
    "--chrys-tui-accent-soft": `color-mix(in srgb, ${palette.accent} 20%, transparent)`,
    "--chrys-tui-purple": palette.secondary,
    "--chrys-tui-muted": muted,
    "--chrys-muted": muted,
    "--chrys-tui-error": palette.error,
    "--chrys-error-border": palette.error,
    "--chrys-tui-error-muted": palette.error,
    "--chrys-tui-success-muted": palette.success,
    "--chrys-tui-warning-muted": palette.warning,
  };
}

export const THEMES: Record<string, Record<string, string>> = {
  "ansi-dark": themeVars({ primary: "#5FAFFF", secondary: "#5FFFFF", accent: "#5FFF87", background: "#1C1C1C", surface: "#262626", panel: "#303030", foreground: "#EEEEEE", error: "#FF5F5F", warning: "#FFFF87", success: "#5FFF87", muted: "#A8A8A8" }),
  "ansi-light": themeVars({ primary: "#005FAF", secondary: "#008787", accent: "#AF00AF", background: "#EEEEEE", surface: "#DADADA", panel: "#C6C6C6", foreground: "#1C1C1C", error: "#D70000", warning: "#D75F00", success: "#008700", muted: "#666666" }),
  "atom-one-dark": themeVars({ primary: "#61AFEF", secondary: "#C678DD", accent: "#A378C2", background: "#282C34", surface: "#3B414D", panel: "#4F5666", foreground: "#ABB2BF", error: "#F06262", warning: "#DEB25B", success: "#62F062" }),
  "atom-one-light": themeVars({ primary: "#4078F2", secondary: "#A626A4", accent: "#BF9232", background: "#FAFAFA", surface: "#E0E0E0", panel: "#CCCCCC", foreground: "#383A42", error: "#F23F3F", warning: "#D8D938", success: "#6CF23F" }),
  "catppuccin-frappe": themeVars({ primary: "#CA9EE6", secondary: "#EF9F76", accent: "#F4B8E4", background: "#303446", surface: "#414559", panel: "#51576D", foreground: "#C6D0F5", error: "#E78284", warning: "#E5C890", success: "#A6D189" }),
  "catppuccin-latte": themeVars({ primary: "#8839EF", secondary: "#DC8A78", accent: "#FE640B", background: "#EFF1F5", surface: "#E6E9EF", panel: "#CCD0DA", foreground: "#4C4F69", error: "#D20F39", warning: "#DF8E1D", success: "#40A02B" }),
  "catppuccin-macchiato": themeVars({ primary: "#C6A0F6", secondary: "#F5A97F", accent: "#F5BDE6", background: "#24273A", surface: "#363A4F", panel: "#494D64", foreground: "#CAD3F5", error: "#ED8796", warning: "#EED49F", success: "#A6DA95" }),
  "catppuccin-mocha": themeVars({ primary: "#F5C2E7", secondary: "#CBA6F7", accent: "#FAB387", background: "#181825", surface: "#313244", panel: "#45475A", foreground: "#CDD6F4", error: "#F28FAD", warning: "#FAE3B0", success: "#ABE9B3" }),
  chrys: themeVars({ primary: "#AF87FF", secondary: "#5F5FAF", accent: "#FF87D7", background: "#1C1C1C", surface: "#1C1C1C", panel: "#1C1C1C", foreground: "#EEEEEE", error: "#FF5F5F", warning: "#FFAF5F", success: "#5FFF87", muted: "#875FAF", codeBg: "#303030", buttonFg: "#303030" }),
  "chrys-ansi": themeVars({ primary: "#AF87FF", secondary: "#5F5FAF", accent: "#FF87D7", background: "var(--vscode-editor-background, #1C1C1C)", surface: "var(--vscode-editor-background, #1C1C1C)", panel: "var(--vscode-editor-background, #1C1C1C)", foreground: "var(--vscode-editor-foreground, #EEEEEE)", error: "#FF5F5F", warning: "#FFAF5F", success: "#5FFF87", muted: "#875FAF", codeBg: "var(--vscode-textCodeBlock-background, #303030)", buttonFg: "#303030" }),
  dracula: themeVars({ primary: "#BD93F9", secondary: "#6272A4", accent: "#FF79C6", background: "#282A36", surface: "#2B2E3B", panel: "#313442", foreground: "#F8F8F2", error: "#FF5555", warning: "#FFB86C", success: "#50FA7B" }),
  flexoki: themeVars({ primary: "#205EA6", secondary: "#24837B", accent: "#9B76C8", background: "#100F0F", surface: "#1C1B1A", panel: "#282726", foreground: "#FFFCF0", error: "#AF3029", warning: "#AD8301", success: "#66800B" }),
  gruvbox: themeVars({ primary: "#85A598", secondary: "#A89A85", accent: "#FABD2F", background: "#282828", surface: "#3C3836", panel: "#504945", foreground: "#FBF1C7", error: "#FB4934", warning: "#FE8019", success: "#B8BB26" }),
  monokai: themeVars({ primary: "#AE81FF", secondary: "#F92672", accent: "#66D9EF", background: "#272822", surface: "#2E2E2E", panel: "#3E3D32", foreground: "#D6D6D6", error: "#F92672", warning: "#FD971F", success: "#A6E22E" }),
  nord: themeVars({ primary: "#88C0D0", secondary: "#81A1C1", accent: "#B48EAD", background: "#2E3440", surface: "#3B4252", panel: "#434C5E", foreground: "#D8DEE9", error: "#BF616A", warning: "#EBCB8B", success: "#A3BE8C" }),
  "rose-pine": themeVars({ primary: "#C4A7E7", secondary: "#31748F", accent: "#EBBCBA", background: "#191724", surface: "#1F1D2E", panel: "#26233A", foreground: "#E0DEF4", error: "#EB6F92", warning: "#F6C177", success: "#9CCFD8" }),
  "rose-pine-dawn": themeVars({ primary: "#907AA9", secondary: "#286983", accent: "#D7827E", background: "#FAF4ED", surface: "#FFFAF3", panel: "#F2E9E1", foreground: "#575279", error: "#B4637A", warning: "#EA9D34", success: "#56949F" }),
  "rose-pine-moon": themeVars({ primary: "#C4A7E7", secondary: "#3E8FB0", accent: "#EA9A97", background: "#232136", surface: "#2A273F", panel: "#393552", foreground: "#E0DEF4", error: "#EB6F92", warning: "#F6C177", success: "#9CCFD8" }),
  "solarized-dark": themeVars({ primary: "#268BD2", secondary: "#2AA198", accent: "#6C71C4", background: "#002B36", surface: "#073642", panel: "#073642", foreground: "#839496", error: "#DC322F", warning: "#CB4B16", success: "#859900" }),
  "solarized-light": themeVars({ primary: "#268BD2", secondary: "#2AA198", accent: "#6C71C4", background: "#FDF6E3", surface: "#EEE8D5", panel: "#EEE8D5", foreground: "#586E75", error: "#DC322F", warning: "#CB4B16", success: "#859900" }),
  "textual-dark": themeVars({ primary: "#0178D4", secondary: "#004578", accent: "#FFA62B", background: "#1C1C1C", surface: "#262626", panel: "#303030", foreground: "#E0E0E0", error: "#BA3C5B", warning: "#FFA62B", success: "#4EBF71" }),
  "textual-light": themeVars({ primary: "#004578", secondary: "#0178D4", accent: "#FFA62B", background: "#E0E0E0", surface: "#D8D8D8", panel: "#D0D0D0", foreground: "#1C1C1C", error: "#BA3C5B", warning: "#FFA62B", success: "#4EBF71" }),
  "tokyo-night": themeVars({ primary: "#BB9AF7", secondary: "#7AA2F7", accent: "#FF9E64", background: "#1A1B26", surface: "#24283B", panel: "#414868", foreground: "#A9B1D6", error: "#F7768E", warning: "#E0AF68", success: "#9ECE6A" }),
};

export function applyTheme(themeId: string): void {
  const vars = THEMES[themeId];
  if (!vars) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
