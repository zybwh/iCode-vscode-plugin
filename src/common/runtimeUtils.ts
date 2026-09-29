import { objectValue, stringField, numberField, boolField, formatCount } from "./utils";
import type { UiLanguage } from "./i18n";
import type { RuntimeSnapshot, RuntimeModelDetails } from "../acp/types";
import type { RuntimeDetailsTab } from "../chat/panel";

// ──────────────────────────────────────────────
// Pure display helpers for RuntimeSnapshot
// ──────────────────────────────────────────────

export function runtimeModelName(snapshot: RuntimeSnapshot | null): string {
  if (!snapshot) return "";
  const model = snapshot.runtimeDetails?.model;
  const name = model?.name ?? snapshot.modelProfileId ?? "";
  const modelId = model?.modelId ?? model?.model_id ?? "";
  const maxContext = model?.maxContextTokens ?? model?.max_context_tokens ?? snapshot.maxContextTokens;
  if (name && modelId) {
    return maxContext ? `${name} (${modelId} - ${formatCompactNumber(maxContext)})` : `${name} (${modelId})`;
  }
  return modelId || name;
}

export function runtimeLabel(snapshot: RuntimeSnapshot): string {
  const model = snapshot.runtimeDetails?.model;
  const modelId = model?.modelId ?? model?.model_id ?? snapshot.modelProfileId ?? "(unknown model)";
  return `${snapshot.agentProfile ?? "(unknown agent)"} / ${modelId}`;
}

export function runtimeVisionEnabled(snapshot: RuntimeSnapshot | null): boolean | undefined {
  if (!snapshot?.runtimeDetails?.model) return undefined;
  return boolField(objectValue(snapshot.runtimeDetails.model), "vision") === true;
}

export function runtimeDetailsTabs(snapshot: RuntimeSnapshot | null, language: UiLanguage = "en"): RuntimeDetailsTab[] {
  const details = snapshot?.runtimeDetails;
  return [
    { id: "model", label: rtText(language, "Model", "模型"), sections: runtimeModelSections(details?.model, language) },
    { id: "tools", label: rtText(language, "Tools", "工具"), sections: runtimeToolSections(details, language) },
    { id: "mcp", label: "MCP", sections: runtimeMcpSections(details, language) },
    { id: "skills", label: rtText(language, "Skills", "技能"), sections: runtimeSkillSections(details, language) },
    { id: "files", label: rtText(language, "Files", "文件"), sections: runtimeFileSections(snapshot, language) },
  ];
}

export function runtimeModelSections(model: RuntimeModelDetails | undefined, language: UiLanguage = "en"): RuntimeDetailsTab["sections"] {
  const record = objectValue(model);
  if (!record || (!stringField(record, "name") && !stringField(record, "model_id") && !stringField(record, "modelId"))) {
    return [{ title: rtText(language, "Model", "模型"), lines: [rtText(language, "No active model profile details are available.", "当前没有可用的模型配置详情。")] }];
  }
  const maxContext = numberField(record, "max_context_tokens") ?? numberField(record, "maxContextTokens") ?? 0;
  return [{
    title: rtText(language, "Model Profile", "模型配置"),
    lines: kvLines([
      [rtText(language, "Profile ID", "配置 ID"), stringField(record, "profile_id") ?? stringField(record, "profileId") ?? ""],
      [rtText(language, "Name", "名称"), stringField(record, "name") ?? ""],
      [rtText(language, "Provider", "供应商"), providerLabel(stringField(record, "provider") ?? "")],
      [rtText(language, "API Style", "API 样式"), apiStyleLabel(stringField(record, "api_style") ?? stringField(record, "apiStyle") ?? "")],
      [rtText(language, "Model ID", "模型 ID"), stringField(record, "model_id") ?? stringField(record, "modelId") ?? ""],
      [rtText(language, "Context", "上下文"), contextLabel(maxContext, language)],
      [rtText(language, "Base URL", "接口地址"), stringField(record, "base_url") ?? stringField(record, "baseUrl") ?? ""],
      [rtText(language, "Streaming", "流式响应"), boolLabel(boolField(record, "stream") ?? false, language)],
      [rtText(language, "Vision", "视觉能力"), boolLabel(boolField(record, "vision") ?? false, language)],
    ]),
  }];
}

export function runtimeToolSections(details: RuntimeSnapshot["runtimeDetails"] | undefined, language: UiLanguage = "en"): RuntimeDetailsTab["sections"] {
  const sections: RuntimeDetailsTab["sections"] = [];
  for (const [category, names] of Object.entries(details?.builtinTools ?? details?.builtin_tools ?? {})) {
    sections.push({ title: category, lines: uniqueStrings(names) });
  }
  const subAgentTools = details?.subAgentTools ?? details?.sub_agent_tools ?? [];
  if (subAgentTools.length) {
    sections.push({ title: rtText(language, "Sub-agent tools", "子智能体工具"), lines: uniqueStrings(subAgentTools) });
  }
  return sections.length ? sections : [{ title: rtText(language, "Tools", "工具"), lines: [rtText(language, "No built-in or sub-agent tools loaded.", "没有加载内置工具或子智能体工具。")] }];
}

export function runtimeMcpSections(details: RuntimeSnapshot["runtimeDetails"] | undefined, language: UiLanguage = "en"): RuntimeDetailsTab["sections"] {
  const sections: RuntimeDetailsTab["sections"] = [];
  const failures = details?.mcpFailures ?? details?.mcp_failures ?? {};
  for (const [serverName, names] of Object.entries(details?.mcpTools ?? details?.mcp_tools ?? {})) {
    if (failures[serverName] !== undefined) continue;
    sections.push({
      title: serverName,
      lines: uniqueStrings(names),
      empty: rtText(language, "Connected, but no tools were exposed.", "已连接，但没有暴露工具。"),
    });
  }
  if (Object.keys(failures).length) {
    sections.push({
      title: rtText(language, "Failed MCP servers", "失败的 MCP 服务器"),
      lines: Object.entries(failures).sort(([left], [right]) => left.localeCompare(right)).map(([name, message]) => `${name}: ${message}`),
    });
  }
  return sections.length ? sections : [{ title: rtText(language, "MCP servers", "MCP 服务器"), lines: [rtText(language, "No MCP tools loaded.", "没有加载 MCP 工具。")] }];
}

export function runtimeSkillSections(details: RuntimeSnapshot["runtimeDetails"] | undefined, language: UiLanguage = "en"): RuntimeDetailsTab["sections"] {
  const sections: RuntimeDetailsTab["sections"] = [];
  for (const [source, names] of Object.entries(details?.skillSources ?? details?.skill_sources ?? {})) {
    const title = source === "Inline profile skills" ? rtText(language, "Inline skills", "内联技能") : source;
    const lines = title === source ? uniqueStrings(names) : [source, "", ...uniqueStrings(names)];
    sections.push({ title, lines });
  }
  return sections.length ? sections : [{ title: rtText(language, "Skills", "技能"), lines: [rtText(language, "No skills loaded.", "没有加载技能。")] }];
}

export function runtimeFileSections(snapshot: RuntimeSnapshot | null, language: UiLanguage = "en"): RuntimeDetailsTab["sections"] {
  const details = snapshot?.runtimeDetails;
  const sections = Object.entries(details?.memorySources ?? details?.memory_sources ?? {})
    .map(([source, files]) => ({ title: source, lines: uniqueStrings(files) }));
  if (sections.length) return sections;
  const memoryFiles = uniqueStrings(snapshot?.memoryFiles ?? []);
  return memoryFiles.length
    ? [{ title: rtText(language, "Auto-loaded files", "自动加载文件"), lines: memoryFiles }]
    : [{ title: rtText(language, "Auto-loaded files", "自动加载文件"), lines: [rtText(language, "No preconfigured files loaded.", "没有加载预配置文件。")] }];
}

export function contextLabel(tokens: number, language: UiLanguage = "en"): string {
  if (tokens <= 0) return "-";
  const suffix = language === "zh-CN" ? " token" : " tokens";
  if (tokens >= 1_000_000) {
    const count = tokens / 1_000_000;
    return `${count === Math.trunc(count) ? count.toFixed(0) : count.toFixed(1)}m${suffix}`;
  }
  if (tokens >= 1_000) {
    const count = tokens / 1_000;
    return `${count === Math.trunc(count) ? count.toFixed(0) : count.toFixed(1)}k${suffix}`;
  }
  return `${tokens}${suffix}`;
}

export function boolLabel(value: boolean, language: UiLanguage = "en"): string {
  if (language === "zh-CN") return value ? "开" : "关";
  return value ? "ON" : "OFF";
}

function rtText(language: UiLanguage, en: string, zh: string): string {
  return language === "zh-CN" ? zh : en;
}

export function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    "deepseek-openai": "DeepSeek (OpenAI)",
  };
  return labels[provider] ?? provider;
}

export function apiStyleLabel(apiStyle: string): string {
  const labels: Record<string, string> = {
    chat_completions: "Chat Completions",
    responses: "Responses",
  };
  return labels[apiStyle] ?? apiStyle;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function kvLines(pairs: [string, string][]): string[] {
  const width = Math.max(...pairs.map(([label]) => label.length), 0);
  return pairs.map(([label, value]) => `${label.padEnd(width)}  ${value || "-"}`);
}

export function formatCompactNumber(value: number): string {
  if (value >= 1000 && value % 1000 === 0) {
    return `${value / 1000}k`;
  }
  return formatCount(value);
}

export function countRecordValues(value: Record<string, string[]> | undefined): number {
  if (!value) return 0;
  return Object.values(value).reduce((total, entries) => total + entries.length, 0);
}

export function countRuntimeTools(snapshot: RuntimeSnapshot | null): number {
  if (!snapshot) return 0;
  if (snapshot.toolNames?.length) return snapshot.toolNames.length;
  const details = snapshot.runtimeDetails;
  if (!details) return 0;
  return countRecordValues(details.builtinTools ?? details.builtin_tools)
    + countRecordValues(details.mcpTools ?? details.mcp_tools)
    + (details.subAgentTools ?? details.sub_agent_tools ?? []).length;
}

export function countRuntimeFiles(snapshot: RuntimeSnapshot | null): number {
  const details = snapshot?.runtimeDetails;
  if (snapshot?.memoryFiles?.length) return snapshot.memoryFiles.length;
  return countRecordValues(details?.memorySources ?? details?.memory_sources);
}

export function platformLabel(): string {
  const osName = platformName(process.platform);
  const arch = process.arch === "arm64" ? "arm64" : process.arch;
  return `${osName}-${arch}`;
}

export function platformName(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}
