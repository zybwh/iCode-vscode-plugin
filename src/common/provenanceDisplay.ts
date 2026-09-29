import * as path from "node:path";
import type { DiffEntry, MutationFileSummary, RollbackResultNotification } from "../acp/types";
import type { UiLanguage } from "./i18n";

type RollbackResultFormatOptions = {
  language?: UiLanguage;
  relativePath?: (filePath: string) => string;
};

function text(language: UiLanguage): {
  externalOverlap: string;
  inferred: string;
  before: string;
  after: string;
  binaryFile: string;
  chars: string;
  tooLarge: string;
  binary: string;
  rolledBack: (turn: number, files: number) => string;
  warning: (message: string) => string;
  excluded: (filePath: string, reason: string) => string;
} {
  if (language === "zh-CN") {
    return {
      externalOverlap: "外部改动重叠",
      inferred: "推断",
      before: "之前",
      after: "之后",
      binaryFile: "二进制文件",
      chars: "字符",
      tooLarge: "过大",
      binary: "二进制",
      rolledBack: (turn, files) => `已回滚到第 ${turn} 轮；已还原 ${files} 个文件。`,
      warning: (message) => `警告：${message}`,
      excluded: (filePath, reason) => `已排除 ${filePath}：${reason}`,
    };
  }
  return {
    externalOverlap: "external overlap",
    inferred: "inferred",
    before: "before",
    after: "after",
    binaryFile: "Binary file",
    chars: "chars",
    tooLarge: "too large",
    binary: "binary",
    rolledBack: (turn, files) => `Rolled back to turn ${turn}; reverted ${files} file(s).`,
    warning: (message) => `Warning: ${message}`,
    excluded: (filePath, reason) => `Excluded ${filePath}: ${reason}`,
  };
}

export function formatMutationBadges(
  entry: Pick<MutationFileSummary, "contested" | "inferred" | "beforeSkip" | "afterSkip">,
  language: UiLanguage = "en",
): string[] {
  const labels = text(language);
  const badges: string[] = [];
  if (entry.contested) badges.push(labels.externalOverlap);
  if (entry.inferred) badges.push(labels.inferred);
  if (entry.beforeSkip) badges.push(`${labels.before}${language === "zh-CN" ? "：" : ": "}${formatSnapshotSkipReason(entry.beforeSkip, language)}`);
  if (entry.afterSkip) badges.push(`${labels.after}${language === "zh-CN" ? "：" : ": "}${formatSnapshotSkipReason(entry.afterSkip, language)}`);
  return badges;
}

export function formatSnapshotSkipReason(reason: string, language: UiLanguage = "en"): string {
  const labels = text(language);
  if (reason === "too_large") return labels.tooLarge;
  if (reason === "binary") return labels.binary;
  return reason;
}

export function formatDiffRiskDetail(entry: DiffEntry, language: UiLanguage = "en"): string {
  const labels = text(language);
  const badges = formatMutationBadges(entry, language);
  const size = entry.isBinary
    ? labels.binaryFile
    : `${entry.beforeText.length} -> ${entry.afterText.length} ${labels.chars}`;
  return [entry.operation, ...badges, size].filter(Boolean).join(" · ");
}

export function formatRollbackResultMessage(
  result: RollbackResultNotification,
  options: RollbackResultFormatOptions = {},
): string {
  const language = options.language ?? "en";
  const relativePath = options.relativePath ?? ((filePath: string) => path.basename(filePath));
  const labels = text(language);
  const lines = [
    labels.rolledBack(result.targetTurn, result.filesReverted),
  ];
  for (const warning of result.warnings ?? []) {
    lines.push(labels.warning(warning));
  }
  for (const exclusion of result.exclusions ?? []) {
    lines.push(labels.excluded(relativePath(exclusion.path), formatSnapshotSkipReason(exclusion.reason, language)));
  }
  return lines.join("\n");
}
