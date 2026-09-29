export const SUPPORTED_UI_THEME_IDS = [
  "ansi-dark",
  "ansi-light",
  "atom-one-dark",
  "atom-one-light",
  "catppuccin-frappe",
  "catppuccin-latte",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "chrys",
  "chrys-ansi",
  "dracula",
  "flexoki",
  "gruvbox",
  "monokai",
  "nord",
  "rose-pine",
  "rose-pine-dawn",
  "rose-pine-moon",
  "solarized-dark",
  "solarized-light",
  "textual-dark",
  "textual-light",
  "tokyo-night",
] as const;

export type UiTheme = (typeof SUPPORTED_UI_THEME_IDS)[number];

const UI_THEMES = new Set<string>(SUPPORTED_UI_THEME_IDS);

export function isSupportedUiTheme(value: string | undefined): value is UiTheme {
  return UI_THEMES.has((value || "").trim().toLowerCase());
}

export function resolveUiTheme(configured: string | undefined, envTheme: string | undefined): UiTheme {
  const value = (configured || "auto").trim().toLowerCase();
  if (isSupportedUiTheme(value)) return value;

  const envValue = (envTheme || "").trim().toLowerCase();
  if (isSupportedUiTheme(envValue)) return envValue;

  return "chrys";
}
