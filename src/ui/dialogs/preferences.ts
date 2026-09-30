import * as vscode from "vscode";
import { rt } from "../../state/runtime";
import { nextMessageId } from "../../chat/provider";
import { chatPanelState } from "../../common/chatPanelState";
import { resolveUiLanguage } from "../../common/i18n";
import { SUPPORTED_UI_THEME_IDS, resolveUiTheme, type UiTheme } from "../../common/uiTheme";
import { localized as nativeText } from "../../common/hostI18n";
import { themeFallbackReason, themeResolutionLine } from "./diagnostics";

// ──────────────────────────────────────────────
// Theme picker
// ──────────────────────────────────────────────

export type LanguageSetting = "auto" | "en" | "zh-CN";

export function normalizeLanguageSetting(value: string | undefined): LanguageSetting | undefined {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "auto") return "auto";
  if (normalized === "en" || normalized === "en-us" || normalized === "en-gb") return "en";
  if (normalized === "zh" || normalized === "zh-cn") return "zh-CN";
  return undefined;
}

export async function pickLanguageFromList(arg?: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("chrys");
  const configured = normalizeLanguageSetting(config.get<string>("ui.language")) ?? "auto";
  const current = resolveUiLanguage(configured, vscode.env.language);
  const languages: Array<{ id: LanguageSetting; name: string; detail: string }> = [
    {
      id: "auto",
      name: nativeText("Auto", "自动"),
      detail: nativeText(
        "Follow the VS Code display language.",
        "跟随 VS Code 显示语言。",
      ),
    },
    {
      id: "en",
      name: nativeText("English", "英文"),
      detail: nativeText("Use English UI text.", "使用英文界面。"),
    },
    {
      id: "zh-CN",
      name: nativeText("Simplified Chinese", "简体中文"),
      detail: nativeText("Use Simplified Chinese UI text.", "使用简体中文界面。"),
    },
  ];

  const direct = normalizeLanguageSetting(arg);
  if (direct) {
    const directLabel = languages.find((language) => language.id === direct)?.name ?? direct;
    await applyLanguageSelection(direct, directLabel, config, configured);
    return;
  }

  const items = languages.map((language) => ({
    label: language.name,
    description: language.id === "auto" ? nativeText(`active: ${current}`, `当前：${current}`) : language.id,
    detail: language.detail,
    id: language.id,
    picked: configured === language.id,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: nativeText("Select iCode language", "选择 iCode 语言"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected) return;
  await applyLanguageSelection(selected.id, selected.label, config, configured);
}

export async function applyLanguageSelection(
  languageSetting: LanguageSetting,
  label: string,
  workspaceConfig: vscode.WorkspaceConfiguration,
  previousSetting: LanguageSetting,
): Promise<void> {
  if (previousSetting === languageSetting) return;
  await workspaceConfig.update("ui.language", languageSetting, vscode.ConfigurationTarget.Global);
  rt.sessionTreeProvider?.refresh();
  rt.chatPanel?.setState(chatPanelState());
  rt.chatPanel?.appendDebugEvent("LanguageChanged", `setting=${languageSetting}; active=${resolveUiLanguage(languageSetting, vscode.env.language)}`);
  vscode.window.showInformationMessage(nativeText(
    `iCode language changed to ${label}.`,
    `iCode 语言已切换到 ${label}。`,
  ));
}

export async function pickThemeFromList(arg?: string): Promise<void> {
  if (!rt.chatPanel) return;
  const themeLabels: Partial<Record<UiTheme, string>> = {
    chrys: "iCode",
    "chrys-ansi": "iCode ANSI",
  };
  const themes: Array<{ id: UiTheme | "auto"; name: string; detail: string }> = [
    {
      id: "auto",
      name: "Auto",
      detail: nativeText("Follow CHRYS_THEME when it is a supported TUI theme; otherwise fall back to chrys.", "当 CHRYS_THEME 是受支持的 TUI 主题时跟随；否则回退到 chrys。"),
    },
    ...SUPPORTED_UI_THEME_IDS.map((id) => ({
      id,
      name: themeLabels[id] ?? id,
      detail: nativeText("Mirrors the TUI theme palette.", "镜像 TUI 主题配色。"),
    })),
  ];
  const config = vscode.workspace.getConfiguration("chrys");
  const configured = config.get<string>("ui.theme") || "auto";
  const current = resolveUiTheme(config.get<string>("ui.theme"), process.env.CHRYS_THEME);
  const direct = themes.find((theme) => theme.id === arg?.trim().toLowerCase());
  if (direct) {
    await applyThemeSelection(direct.id, direct.name, config);
    return;
  }
  const items = themes.map((t) => ({
    label: t.name,
    description: t.id === "auto" ? nativeText(`active: ${current}`, `当前：${current}`) : t.id,
    detail: t.id === "auto" ? `${t.detail}${themeFallbackReason("auto") ? `\n${themeResolutionLine("auto")}` : ""}` : t.detail,
    id: t.id,
    picked: configured === t.id || (configured === "auto" && t.id === "auto"),
  }));
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: nativeText("Select iCode theme", "选择 iCode 主题"),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!selected) return;
  await applyThemeSelection(selected.id, selected.label, config);

  async function applyThemeSelection(themeSetting: UiTheme | "auto", label: string, workspaceConfig: vscode.WorkspaceConfiguration): Promise<void> {
    const nextTheme = themeSetting === "auto" ? resolveUiTheme("auto", process.env.CHRYS_THEME) : themeSetting;
    const previousSetting = workspaceConfig.get<string>("ui.theme") || "auto";
    if (previousSetting === themeSetting && nextTheme === current) return;
    rt.currentTheme = nextTheme;
    await workspaceConfig.update("ui.theme", themeSetting, vscode.ConfigurationTarget.Global);
    rt.chatPanel?.applyTheme(nextTheme);
    const fallback = themeFallbackReason(themeSetting);
    const fallbackText = fallback ? nativeText(` ${fallback}.`, ` ${fallback}。`) : "";
    rt.transcript.appendMessage({
      id: nextMessageId(),
      kind: "system",
      text: nativeText(
        `Theme changed to ${label} (active: ${nextTheme}).${fallbackText}`,
        `主题已切换到 ${label}（当前：${nextTheme}）。${fallbackText}`,
      ),
      timestamp: Date.now(),
    });
    rt.chatPanel?.appendDebugEvent("ThemeChanged", themeResolutionLine(themeSetting));
    rt.chatPanel?.setState(chatPanelState());
  }
}
