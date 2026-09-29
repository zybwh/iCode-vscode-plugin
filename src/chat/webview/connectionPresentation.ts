import type { UiLanguage } from "../../common/i18n";

export type ChatConnectionState =
  | "resolving-workspace"
  | "resolving-backend"
  | "starting"
  | "initializing"
  | "ready"
  | "disconnected"
  | "error";

export interface ConnectionPresentation {
  label: string;
  detail: string;
  tone: "running" | "ready" | "failed";
}

export function connectionPresentation(
  connectionState: ChatConnectionState,
  detail: string,
  language: UiLanguage,
): ConnectionPresentation {
  const zh = language === "zh-CN";
  switch (connectionState) {
    case "resolving-workspace":
      return { label: zh ? "正在识别工作目录" : "Finding working directory", detail, tone: "running" };
    case "resolving-backend":
      return { label: zh ? "正在查找 iCode 后端" : "Finding iCode backend", detail: joinDetail(zh ? "工作目录" : "Working directory", detail), tone: "running" };
    case "starting":
      return { label: zh ? "正在启动 iCode" : "Starting iCode", detail: joinDetail(zh ? "正在启动 iCode 后端" : "Launching iCode backend", detail), tone: "running" };
    case "initializing":
      return { label: zh ? "正在启动 iCode" : "Starting iCode", detail: joinDetail(zh ? "正在初始化 ACP" : "Initializing ACP", detail), tone: "running" };
    case "ready":
      return { label: zh ? "iCode 已就绪" : "iCode ready", detail: joinDetail(zh ? "工作目录" : "Working directory", detail), tone: "ready" };
    case "disconnected":
      return { label: zh ? "iCode 连接已断开" : "iCode disconnected", detail, tone: "failed" };
    case "error":
      return { label: zh ? "iCode 启动失败" : "iCode failed to start", detail, tone: "failed" };
  }
}

function joinDetail(label: string, value: string): string {
  return value ? `${label} · ${value}` : label;
}
