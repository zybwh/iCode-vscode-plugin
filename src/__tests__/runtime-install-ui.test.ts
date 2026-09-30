import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
const mocks = vi.hoisted(() => ({ install: vi.fn(), error: vi.fn(), report: vi.fn(), dispose: vi.fn(), cancelled: false, language: "en", cancel: (() => {}) }));
vi.mock("../runtime/install", () => ({
  RUNTIME_VERSION: "0.28.0", runtimeTarget: () => ({ target: "darwin-arm64" }), installRuntime: mocks.install,
}));
vi.mock("../common/logging", () => ({ logError: vi.fn() }));
vi.mock("vscode", () => ({
  env: { language: "en" }, ProgressLocation: { Notification: 15 },
  workspace: { getConfiguration: () => ({ get: () => mocks.language }) },
  window: {
    showErrorMessage: mocks.error,
    withProgress: async (_options: unknown, run: Function) => run({ report: mocks.report }, {
      isCancellationRequested: mocks.cancelled,
      onCancellationRequested: (callback: () => void) => { mocks.cancel = callback; return { dispose: mocks.dispose }; },
    }),
  },
}));
import { installManagedRuntime } from "../ui/runtimeInstall";
const context = { globalStorageUri: { fsPath: "/extension-storage" } } as vscode.ExtensionContext;
beforeEach(() => { vi.clearAllMocks(); mocks.install.mockReset(); mocks.error.mockReset(); mocks.cancelled = false; mocks.language = "en"; });
describe("runtime installation UI", () => {
  it("uses extension storage, localizes progress and coalesces clicks", async () => {
    mocks.language = "zh-CN";
    mocks.install.mockImplementation(async (storage, _signal, progress) => {
      expect(storage).toBe("/extension-storage"); progress("verify"); return "/installed/icode";
    });
    const first = installManagedRuntime(context);
    expect(installManagedRuntime(context)).toBe(first);
    expect(await first).toBe("/installed/icode");
    expect(mocks.report).toHaveBeenCalledWith({ message: "正在校验 SHA256…" });
    expect(mocks.install).toHaveBeenCalledOnce(); expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("cancels silently and disposes progress listeners", async () => {
    mocks.install.mockImplementation(async (_storage, signal) => { mocks.cancel(); signal.throwIfAborted(); });
    expect(await installManagedRuntime(context)).toBeUndefined();
    expect(mocks.error).not.toHaveBeenCalled(); expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("allows an explicit retry after installation fails", async () => {
    mocks.install.mockRejectedValueOnce(new Error("checksum mismatch")).mockResolvedValueOnce("/installed/icode");
    mocks.error.mockResolvedValueOnce("Retry");
    expect(await installManagedRuntime(context)).toBe("/installed/icode");
    expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("previous runtime has not been replaced"), "Retry");
    expect(mocks.install).toHaveBeenCalledTimes(2); expect(mocks.dispose).toHaveBeenCalledTimes(2);
  });
});
