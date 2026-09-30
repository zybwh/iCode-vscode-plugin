import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  values: {} as Record<string, string>, scope: {} as Record<string, unknown>,
  update: vi.fn(), quickPick: vi.fn(),
}));
vi.mock("vscode", () => ({
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
  workspace: { getConfiguration: () => ({
    get: (key: string) => settings.values[key], inspect: () => settings.scope,
    update: settings.update,
  }) },
  window: { showQuickPick: settings.quickPick },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  env: { language: "en" },
}));
vi.mock("../extension", () => ({ restartBackendConnection: vi.fn(), PROTOCOL_VERSION: 1, buildAcpArgs: vi.fn() }));
vi.mock("../handlers/notifications", () => ({ refreshRuntimeSnapshot: vi.fn() }));

import { rt } from "../state/runtime";
import { setActiveAgentFromDialog, setActiveModelFromDialog, saveAgentFromDialog, deleteAgentFromDialog } from "../ui/dialogs";
import { pickUiBrand } from "../ui/branding";
import { refreshPreferredDefaultsFromSettings } from "../session/defaults";

beforeEach(() => {
  settings.values = {}; settings.scope = {}; settings.update.mockReset(); settings.quickPick.mockReset();
  settings.update.mockImplementation(async (key: string, value: string) => { settings.values[key] = value; refreshPreferredDefaultsFromSettings(); });
  rt.currentSessionId = null; rt.currentRuntime = null; rt.activeAgentName = "Code";
  rt.preferredAgentName = "Code"; rt.preferredModelProfileId = "";
  rt.sessionManager = {
    state: "idle", switchAgent: vi.fn(), setModel: vi.fn(), reloadSettings: vi.fn(),
    writeAgentProfile: vi.fn(), listAgentProfiles: vi.fn(async () => [{ name: "Custom" }]),
    readAgentProfile: vi.fn(async () => ({ name: "Custom" })), deleteAgentProfile: vi.fn(async () => ({ deleted: true })),
    listModelProfiles: vi.fn(async () => [{ id: "new-model" }]), readModelProfile: vi.fn(async () => ({})),
  } as never;
  rt.chatPanel = {
    setAgentDialogBusy: vi.fn(), setAgentDialogState: vi.fn(), agentDialogNotice: vi.fn(),
    setModelDialogBusy: vi.fn(), setModelDialogState: vi.fn(), modelDialogNotice: vi.fn(),
    appendDebugEvent: vi.fn(), setState: vi.fn(),
  } as never;
});

describe("profile editors before the first session", () => {
  it.each([{}, { workspaceValue: "old" }, { workspaceFolderValue: "old" }])("persists selected defaults at their effective scope %j", async (scope) => {
    settings.scope = scope;
    await setActiveAgentFromDialog("Custom");
    await setActiveModelFromDialog("new-model");
    expect(rt.sessionManager.switchAgent).not.toHaveBeenCalled();
    expect(rt.sessionManager.setModel).not.toHaveBeenCalled();
    expect(rt.preferredAgentName).toBe("Custom"); expect(rt.preferredModelProfileId).toBe("new-model");
    const target = "workspaceFolderValue" in scope ? 3 : "workspaceValue" in scope ? 2 : 1;
    expect(settings.update).toHaveBeenCalledWith("agent.default", "Custom", target);
    expect(settings.update).toHaveBeenCalledWith("model.profile", "new-model", target);
    expect(rt.chatPanel.setModelDialogState).toHaveBeenLastCalledWith(expect.objectContaining({ activeModelProfileId: "new-model" }));
  });
  it("saves and deletes profiles without trying to reload a nonexistent session", async () => {
    await saveAgentFromDialog({ name: "Custom" });
    expect(rt.chatPanel.setAgentDialogState).toHaveBeenLastCalledWith(expect.objectContaining({ updatedAgentName: "Custom" }));
    await deleteAgentFromDialog("Custom");
    expect(rt.sessionManager.writeAgentProfile).toHaveBeenCalledWith({ name: "Custom" });
    expect(rt.sessionManager.deleteAgentProfile).toHaveBeenCalledWith("Custom");
    expect(rt.sessionManager.reloadSettings).not.toHaveBeenCalled();
    expect(rt.chatPanel.agentDialogNotice).not.toHaveBeenCalledWith("error", expect.anything());
  });
  it("still applies profile changes to an existing session", async () => {
    rt.currentSessionId = "active";
    await setActiveAgentFromDialog("Custom"); await setActiveModelFromDialog("new-model");
    await saveAgentFromDialog({ name: "Custom" });
    expect(rt.sessionManager.switchAgent).toHaveBeenCalledWith("Custom");
    expect(rt.sessionManager.setModel).toHaveBeenCalledWith("new-model");
    expect(rt.sessionManager.reloadSettings).toHaveBeenCalledOnce();
  });
});

it("persists the brand choice and keeps it when the picker is cancelled", async () => {
  settings.scope = { workspaceValue: "icode" };
  settings.quickPick.mockResolvedValue({ id: "chrys", label: "iCode" });
  await pickUiBrand();
  expect(settings.quickPick.mock.calls[0][0]).toEqual([
    expect.objectContaining({ id: "icode", picked: true }),
    expect.objectContaining({ id: "chrys", picked: false }),
  ]);
  expect(settings.update).toHaveBeenCalledWith("ui.brand", "chrys", 2);
  expect(rt.chatPanel.setState).toHaveBeenLastCalledWith(expect.objectContaining({ uiBrand: "chrys" }));
  settings.update.mockClear(); settings.quickPick.mockResolvedValue(undefined);
  await pickUiBrand();
  expect(settings.update).not.toHaveBeenCalled();
  expect(settings.values["ui.brand"]).toBe("chrys");
});
