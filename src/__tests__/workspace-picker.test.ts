import { beforeEach, describe, expect, it, vi } from "vitest";

import * as path from "node:path";

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

import { pickWorkspaceDirectory, pickAdditionalDirectories } from "../ui/workspacePicker";

describe("workspace directory picker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    host.language = "en";
    host.folders = [
      { name: "API", uri: { fsPath: "/project/api" } },
      { name: "UI", uri: { fsPath: "/project/ui" } },
    ];
  });

  it("grants only explicitly selected extra roots and can clear or cancel", async () => {
    host.quickPick.mockImplementationOnce(async items => {
      expect(items.some((item: {directory:string})=>item.directory==="/project/api")).toBe(false);
      expect(items[0].picked).toBe(false);
      return [items[0]];
    });
    expect(await pickAdditionalDirectories("/project/api",[])).toEqual([path.resolve("/project/ui")]);
    host.quickPick.mockResolvedValueOnce([]);
    expect(await pickAdditionalDirectories("/project/api",["/project/ui"])).toEqual([]);
    expect(await pickAdditionalDirectories("/project/api",["/project/ui"])).toBeUndefined();
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
