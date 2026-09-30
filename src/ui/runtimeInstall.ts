import * as vscode from "vscode";
import { installRuntime, RUNTIME_VERSION, runtimeTarget, type InstallStage } from "../runtime/install";
import { resolveUiLanguage } from "../common/i18n";
import { logError } from "../common/logging";
let installing: Promise<string | undefined> | undefined;
export function installManagedRuntime(context: vscode.ExtensionContext): Promise<string | undefined> {
    if (installing)
        return installing;
    installing = runInstall(context).finally(() => { installing = undefined; });
    return installing;
}
async function runInstall(context: vscode.ExtensionContext): Promise<string | undefined> {
    const zh = resolveUiLanguage(vscode.workspace.getConfiguration("chrys").get<string>("ui.language"), vscode.env.language) === "zh-CN";
    const t = (en: string, cn: string) => zh ? cn : en;
    try {
        const target = runtimeTarget();
        return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, cancellable: true, title: t(`Install iCode CLI v${RUNTIME_VERSION} (${target.target})`, `安装 iCode CLI v${RUNTIME_VERSION}（${target.target}）`) }, async (progress, token) => {
            const controller = new AbortController();
            const subscription = token.onCancellationRequested(() => controller.abort());
            if (token.isCancellationRequested)
                controller.abort();
            const labels: Record<InstallStage, string> = { download: t("Downloading official offline release…", "正在下载官方离线版本…"), verify: t("Verifying SHA256…", "正在校验 SHA256…"), extract: t("Extracting runtime…", "正在解压运行时…"), validate: t("Checking version and ACP startup…", "正在验证版本及 ACP 启动…"), ready: t("Runtime installed", "运行时已安装") };
            try {
                let last = 0;
                return await installRuntime(context.globalStorageUri.fsPath, controller.signal, (stage, bytes, total) => {
                    if (bytes && Date.now() - last < 200)
                        return;
                    last = Date.now();
                    const size = bytes ? ` ${(bytes / 1048576).toFixed(1)}${total ? ` / ${(total / 1048576).toFixed(1)}` : ""} MB` : "";
                    progress.report({ message: labels[stage] + size });
                });
            }
            finally {
                subscription.dispose();
            }
        });
    }
    catch (error) {
        if (error instanceof Error && error.name === "AbortError")
            return undefined;
        const detail = error instanceof Error ? error.message : String(error);
        logError(`Runtime installation failed: ${detail}`);
        const retry = t("Retry", "重试");
        const choice = await vscode.window.showErrorMessage(t(`iCode installation failed: ${detail}. Your previous runtime has not been replaced.`, `iCode 安装失败：${detail}。原有运行时未被替换。`), retry);
        if (choice === retry)
            return runInstall(context);
        return undefined;
    }
}
