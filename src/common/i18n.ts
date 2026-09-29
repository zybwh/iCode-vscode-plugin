export type UiLanguage = "en" | "zh-CN";

export function resolveUiLanguage(configured: string | undefined, hostLanguage: string | undefined): UiLanguage {
  const value = (configured || "auto").trim().toLowerCase();
  if (value === "zh-cn" || value === "zh") return "zh-CN";
  if (value === "en" || value === "en-us" || value === "en-gb") return "en";
  return (hostLanguage || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
