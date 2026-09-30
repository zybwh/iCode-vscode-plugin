import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ pick: vi.fn(), save: vi.fn(), open: vi.fn(), cli: vi.fn(), rm: vi.fn(), copy: vi.fn(), panel: vi.fn(), text: vi.fn(), realpath: vi.fn(async value => value) }));
vi.mock("vscode", () => ({
  env: { language: "en" }, ViewColumn: { Active: 1 }, ProgressLocation: { Notification: 1 }, Uri: { file: (fsPath: string) => ({ scheme: "file", fsPath }) },
  workspace: { isTrusted: true, getConfiguration: () => ({ get: () => "en" }) },
  window: { showQuickPick: mock.pick, showSaveDialog: mock.save, showOpenDialog: mock.open, showTextDocument: mock.text,
    createWebviewPanel: mock.panel, showWarningMessage: vi.fn(), withProgress: async (_: unknown, callback: Function) => callback({}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }) },
}));
vi.mock("node:fs/promises", () => ({ mkdtemp: async () => "/tmp/trajectory-test", rm: mock.rm, copyFile: mock.copy, realpath: mock.realpath,
  stat: async () => ({ size: 20 }), readFile: async () => JSON.stringify({ schema: "chrys.trajectory.export/1", session: { availability: "available" }, turns: [] }) }));
vi.mock("../workflow/cli", () => ({ runIcodeCli: mock.cli }));
import { openTrajectory, trajectoryArgs } from "../ui/trajectory";
import type * as vscode from "vscode";
const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
beforeEach(() => {
  vi.clearAllMocks();
  mock.pick.mockReset().mockResolvedValueOnce({ value: "current" }).mockResolvedValueOnce({ format: "view" });
  mock.cli.mockReset().mockResolvedValue({ code: 0, cancelled: false, stderr: "" });
  mock.panel.mockReturnValue({ onDidDispose: vi.fn(), webview: { html: "", onDidReceiveMessage: vi.fn(), postMessage: vi.fn() } });
});
describe("trajectory host", () => {
  it("uses only public export arguments and preserves option-looking source paths", () => {
    expect(trajectoryArgs({ kind: "events", value: "--foo\nbar" }, "json", "/tmp/out")).toEqual(["trajectory", "export", "--events=--foo\nbar", "--format", "json", "--out", "/tmp/out"]);
  });
  it("shows a nonce-protected interactive report and cleans temporary files", async () => {
    await openTrajectory(context, "/bin/icode", "/workspace", "session");
    expect(mock.cli.mock.calls[0][1]).not.toContain("--include-sensitive");
    expect(mock.panel.mock.calls[0][3]).toEqual({ enableScripts: true, localResourceRoots: [] });
    expect(mock.rm).toHaveBeenCalledWith("/tmp/trajectory-test", { recursive: true, force: true });
  });
  it("refreshes in place and keeps errors visible without replacing the last report", async () => {
    await openTrajectory(context,"/bin/icode","/workspace","session");
    const panel=mock.panel.mock.results[0].value;
    const refresh=panel.webview.onDidReceiveMessage.mock.calls[0][0];
    const html=panel.webview.html;
    mock.cli.mockResolvedValueOnce({code:1,cancelled:false,stderr:"export unavailable"});
    await refresh({type:"refresh"});
    expect(mock.panel).toHaveBeenCalledTimes(1);
    expect(panel.webview.html).toBe(html);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith({type:"status",busy:false,error:"Error: export unavailable"});
    expect(mock.rm).toHaveBeenCalledTimes(2);
  });
  it("cleans up after unsupported CLI errors", async () => {
    mock.cli.mockResolvedValue({ code: 1, stderr: "unsupported", cancelled: false });
    await expect(openTrajectory(context, "/bin/icode", "/workspace", "session")).rejects.toThrow("unsupported");
    expect(mock.rm).toHaveBeenCalled();
    expect(mock.panel).not.toHaveBeenCalled();
  });
  it("cancellation never opens a report", async () => {
    mock.cli.mockResolvedValue({ code: null, cancelled: true, stderr: "" });
    await openTrajectory(context, "/bin/icode", "/workspace", "session");
    expect(mock.panel).not.toHaveBeenCalled();
    expect(mock.rm).toHaveBeenCalled();
  });
  it("prevents overwriting source events through an export destination", async () => {
    mock.pick.mockReset().mockResolvedValueOnce({ value: "events" }).mockResolvedValueOnce({ format: "json" });
    mock.open.mockResolvedValue([{ fsPath: "/source.json" }]);
    mock.save.mockResolvedValue({ scheme: "file", fsPath: "/source.json" });
    await expect(openTrajectory(context, "/bin/icode", "/workspace", "session")).rejects.toThrow("overwrite");
    expect(mock.cli).not.toHaveBeenCalled();
  });
  it("pages historical sessions and uses the selected session workspace", async () => {
    const list = vi.fn().mockResolvedValueOnce({ sessions: [], nextCursor: "page2" }).mockResolvedValueOnce({ sessions: [{ sessionId: "old", cwd: "/old" }] });
    mock.pick.mockReset().mockResolvedValueOnce({ value: "saved" }).mockResolvedValueOnce({ source: undefined })
      .mockResolvedValueOnce({ source: { kind: "session", value: "old", cwd: "/old", label: "Old" } }).mockResolvedValueOnce({ format: "view" });
    await openTrajectory(context, "/bin/icode", "/workspace", "session", list);
    expect(list).toHaveBeenLastCalledWith("/workspace", "page2");
    expect(mock.cli.mock.calls[0][1]).toContain("--session=old");
    expect(mock.cli.mock.calls[0][2]).toBe("/old");
  });
});
