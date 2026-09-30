import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ pick: vi.fn(), input: vi.fn(), confirm: vi.fn(), show: vi.fn(), cli: vi.fn(), update: vi.fn(), read: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: mock.read }));
vi.mock("vscode", () => ({
  env: { language: "en" }, ProgressLocation: { Notification: 1 }, Uri: { file: (value: string) => value },
  workspace: { isTrusted: true, getConfiguration: () => ({ get: () => "en" }), openTextDocument: vi.fn(async value => value) },
  window: { showQuickPick: mock.pick, showInputBox: mock.input, showWarningMessage: mock.confirm, showTextDocument: mock.show,
    showInformationMessage: vi.fn(), withProgress: async (_: unknown, callback: Function) => callback({ report: vi.fn() }, { onCancellationRequested: () => ({ dispose() {} }) }) },
}));
vi.mock("../workflow/cli", async original => ({ ...await original<typeof import("../workflow/cli")>(), runIcodeCli: mock.cli }));
import { openWorkflows } from "../ui/workflows";
import type * as vscode from "vscode";
const source = { id: "demo", source: "builtin", title: "Demo", path: "builtin:demo" };
const context = { workspaceState: { get: () => [], update: mock.update } } as unknown as vscode.ExtensionContext;
beforeEach(() => {
  vi.clearAllMocks();
  mock.pick.mockReset().mockResolvedValueOnce({ action: "list" }).mockResolvedValueOnce({ source });
  mock.input.mockReset().mockResolvedValueOnce("input").mockResolvedValueOnce("10");
  mock.cli.mockReset().mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ workflows: [source] }), stderr: "", cancelled: false });
  mock.confirm.mockReset();
});
describe("workflow user flow", () => {
  it("rejects user source changed during confirmation", async () => {
    mock.pick.mockReset().mockResolvedValueOnce({ action: "list" }).mockResolvedValueOnce({ source: { ...source, source: "project", path: "/workflow.py" } });
    mock.read.mockResolvedValueOnce(Buffer.from("before")).mockResolvedValueOnce(Buffer.from("after"));
    mock.confirm.mockResolvedValue("Run without tool approvals");
    await expect(openWorkflows(context, "/bin/icode", "/workspace")).rejects.toThrow("source changed");
    expect(mock.cli).toHaveBeenCalledTimes(1);
  });
  it("never runs when BYPASS confirmation is dismissed", async () => {
    await openWorkflows(context, "/bin/icode", "/workspace");
    expect(mock.cli).toHaveBeenCalledTimes(1);
    expect(mock.confirm.mock.calls[0][0]).toContain("BYPASS");
  });
  it("runs independently and saves structured failure results", async () => {
    mock.confirm.mockResolvedValue("Run without tool approvals");
    mock.cli.mockResolvedValueOnce({ code: 1, stdout: '{"outcome":"node_failed","run_id":"r1"}', stderr: "failed", cancelled: false });
    await openWorkflows(context, "/bin/icode", "/workspace");
    expect(mock.cli.mock.calls[1][1]).not.toContain("--session");
    expect(mock.cli.mock.calls[1][1]).not.toContain("--trust");
    expect(mock.show).toHaveBeenCalled();
    expect(mock.update.mock.calls[0][1][0].result).toContain("node_failed");
  });
  it("does not run after cancelling input", async () => {
    mock.input.mockReset().mockResolvedValue(undefined);
    await openWorkflows(context, "/bin/icode", "/workspace");
    expect(mock.cli).toHaveBeenCalledTimes(1);
    expect(mock.confirm).not.toHaveBeenCalled();
  });
});
