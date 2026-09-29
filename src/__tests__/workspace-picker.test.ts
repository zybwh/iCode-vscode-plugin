import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  folders: [] as { name: string; uri: { fsPath: string } }[],
  language: "en",
  quickPick: vi.fn(),
  openDialog: vi.fn(),
}));

vi.mock("vscode", () => ({
  workspace: {
    get workspaceFolders() { return host.folders; },
    getConfiguration: () => ({ get: () => host.language }),
  },
  env: { language: "en" },
  window: { showQuickPick: host.quickPick, showOpenDialog: host.openDialog },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
}));

import { pickWorkspaceDirectory } from "../ui/workspacePicker";

describe("workspace directory picker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    host.language = "en";
    host.folders = [
      { name: "API", uri: { fsPath: "/project/api" } },
      { name: "UI", uri: { fsPath: "/project/ui" } },
    ];
  });

  it("selects the second workspace root by its actual path and marks the current root", async () => {
    host.quickPick.mockImplementation(async items => {
      expect(items[0]).toMatchObject({ label: "API", detail: "/project/api", description: "Current directory" });
      expect(items[1]).toMatchObject({ label: "UI", detail: "/project/ui" });
      return items[1];
    });
    expect(await pickWorkspaceDirectory("/project/api")).toBe("/project/ui");
    expect(host.openDialog).not.toHaveBeenCalled();
  });

  it("cancels without falling through to the filesystem dialog", async () => {
    expect(await pickWorkspaceDirectory()).toBeUndefined();
    expect(host.openDialog).not.toHaveBeenCalled();
  });

  it("allows browsing outside the workspace with localized labels", async () => {
    host.language = "zh-CN";
    host.quickPick.mockImplementation(async items => {
      expect(items[2].label).toBe("浏览其他目录…");
      return items[2];
    });
    host.openDialog.mockResolvedValue([{ fsPath: "/other/project" }]);
    expect(await pickWorkspaceDirectory("/project/api")).toBe("/other/project");
    expect(host.openDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultUri: { fsPath: "/project/api" }, canSelectFolders: true, canSelectFiles: false,
    }));
  });

  it("uses the filesystem dialog directly in an empty window and supports cancellation", async () => {
    host.folders = [];
    expect(await pickWorkspaceDirectory()).toBeUndefined();
    expect(host.quickPick).not.toHaveBeenCalled();
    expect(host.openDialog).toHaveBeenCalledOnce();
  });

  it("reads workspace folders again after folders are added or removed", async () => {
    host.quickPick.mockImplementation(async items => items[0]);
    expect(await pickWorkspaceDirectory()).toBe("/project/api");
    host.folders = [{ name: "New root", uri: { fsPath: "/new/root" } }];
    expect(await pickWorkspaceDirectory()).toBe("/new/root");
  });
});
