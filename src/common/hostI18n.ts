import * as vscode from "vscode";
import { resolveUiLanguage, type UiLanguage } from "./i18n";

/** UI language for extension-host surfaces, from `chrys.ui.language` or the VS Code locale. */
export function hostUiLanguage(): UiLanguage {
  return resolveUiLanguage(vscode.workspace.getConfiguration("chrys").get<string>("ui.language"), vscode.env.language);
}

/** Pick the English or Simplified Chinese variant of a host UI string. */
export function localized(en: string, zh: string): string {
  return hostUiLanguage() === "zh-CN" ? zh : en;
}
