import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Memento } from "vscode";
import * as vscode from "vscode";

vi.mock("vscode", () => ({
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); },
  env: { language: "en" },
  workspace: { getConfiguration: () => ({ get: () => "en" }) },
  window: { showQuickPick: vi.fn(), showInputBox: vi.fn(), showInformationMessage: vi.fn(), showWarningMessage: vi.fn() },
}));
vi.mock("../ui/dialogs", () => ({ refreshOpenSessionsDialog: vi.fn(), refreshSessionsSidebar: vi.fn() }));
vi.mock("../common/chatPanelState", () => ({ chatPanelState: () => ({}) }));
import { promptHistory, rememberPrompt } from "../session/promptHistory";
import { localSessionName, setLocalSessionName, withLocalSessionNames, validateSessionName } from "../session/localNames";
import { showPromptHistory } from "../ui/promptHistory";
import { renameSessionLocally } from "../ui/sessionName";
import { rt, currentRuntime, createSessionRuntime, sessionRuntimes, focusRuntime, withRuntime } from "../state/runtime";

function storage(seed: Record<string, unknown> = {}) {
  const data = { ...seed };
  return {
    data,
    state: {
      get: (key: string) => data[key], keys: () => Object.keys(data),
      update: vi.fn(async (key: string, value: unknown) => { data[key] = structuredClone(value); }),
    } as unknown as Memento,
  };
}
const root = currentRuntime();
beforeEach(() => {
  vi.clearAllMocks(); focusRuntime(root);
  sessionRuntimes.clear(); sessionRuntimes.add(root);
  rt.extensionContext = { workspaceState: storage().state } as never;
  rt.currentCwd = "/a"; rt.currentSessionId = "a"; rt.currentSessionTitle = "Automatic title";
  rt.chatPanel = { setComposer: vi.fn(), setState: vi.fn() } as never;
  rt.sessionTreeProvider = { refresh: vi.fn() } as never;
});

describe("persistent prompt history", () => {
  it("serializes concurrent tab writes and recovers from failed persistence", async () => {
    const { state, data } = storage();
    vi.mocked(state.update).mockRejectedValueOnce(new Error("disk full"));
    await expect(rememberPrompt(state, "/a", "failed")).rejects.toThrow("disk full");
    expect(promptHistory(state, "/a")).toEqual([]);
    let finish!: () => void;
    vi.mocked(state.update).mockImplementationOnce((key, value) => new Promise<void>(resolve => {
      finish = () => { data[key] = structuredClone(value); resolve(); };
    }));
    const first = rememberPrompt(state, "/a", "A");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const second = rememberPrompt(state, "/b", "B");
    finish();
    await Promise.all([first, second]);
    const reloaded = storage(data).state;
    expect(promptHistory(reloaded, "/a")).toEqual(["A"]);
    expect(promptHistory(reloaded, "/b")).toEqual(["B"]);
  });
  it("preserves multiline text exactly, deduplicates newest first, and separates directories", async () => {
    const { state } = storage();
    await rememberPrompt(state, "/a", "  original\ntext  ");
    await rememberPrompt(state, "/a", "other");
    await rememberPrompt(state, "/b", "private to B");
    await rememberPrompt(state, "/a", "  original\ntext  ");
    expect(promptHistory(state, "/a")).toEqual(["  original\ntext  ", "other"]);
    expect(promptHistory(state, "/b")).toEqual(["private to B"]);
  });
  it("survives reload, ignores malformed records, and bounds storage to 100 prompts", async () => {
    const { state, data } = storage({ "chrys.promptHistory": [null, {}, { cwd: "/a", text: 1 }] });
    expect(promptHistory(state, "/a")).toEqual([]);
    for (let i = 0; i < 103; i++) await rememberPrompt(state, "/a", `prompt ${i}`);
    const reloaded = storage(data).state;
    expect(promptHistory(reloaded, "/a")).toHaveLength(100);
    expect(promptHistory(reloaded, "/a")[0]).toBe("prompt 102");
  });
  it("fills only the initiating tab after focus changes, without sending", async () => {
    const a = createSessionRuntime("/a"); const b = createSessionRuntime("/a");
    a.chatPanel = { setComposer: vi.fn() } as never;
    b.chatPanel = { setComposer: vi.fn() } as never;
    await rememberPrompt(a.extensionContext!.workspaceState, "/a", "multi\nline");
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(async items => {
      focusRuntime(b);
      return (items as Array<never>)[0];
    });
    await withRuntime(a, showPromptHistory);
    expect(a.chatPanel!.setComposer).toHaveBeenCalledWith("multi\nline");
    expect(b.chatPanel!.setComposer).not.toHaveBeenCalled();
  });
  it("does not replace a draft on cancellation or after the source panel closes", async () => {
    await rememberPrompt(rt.extensionContext!.workspaceState, "/a", "previous");
    const panel = rt.chatPanel!;
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);
    await showPromptHistory();
    expect(panel.setComposer).not.toHaveBeenCalled();
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(async items => {
      rt.chatPanel = { setComposer: vi.fn() } as never;
      return (items as Array<never>)[0];
    });
    await showPromptHistory();
    expect(rt.chatPanel!.setComposer).not.toHaveBeenCalled();
  });
});

describe("editor-local session names", () => {
  it("persists across reload without modifying the backend title or source session", async () => {
    const { state, data } = storage();
    const session = { sessionId: "s", cwd: "/a", title: "Automatic" };
    await setLocalSessionName(state, "s", "My task");
    expect(withLocalSessionNames([session], storage(data).state)[0]).toMatchObject({ title: "My task", _meta: { vsixBackendTitle: "Automatic", vsixLocalName: true } });
    expect(session.title).toBe("Automatic");
    await setLocalSessionName(state, "s", "");
    expect(withLocalSessionNames([session], state)[0].title).toBe("Automatic");
  });
  it("keeps concurrent renames of different sessions", async () => {
    const { state } = storage();
    await Promise.all([setLocalSessionName(state, "a", "A"), setLocalSessionName(state, "b", "B")]);
    expect(localSessionName(state, "a")).toBe("A");
    expect(localSessionName(state, "b")).toBe("B");
  });
  it("does not display failed writes as successful names and can retry", async () => {
    const { state } = storage();
    vi.mocked(state.update).mockRejectedValueOnce(new Error("disk full"));
    await expect(setLocalSessionName(state, "a", "failed")).rejects.toThrow("disk full");
    expect(localSessionName(state, "a")).toBeUndefined();
    await setLocalSessionName(state, "a", "retry");
    expect(localSessionName(state, "a")).toBe("retry");
  });
  it("validates names and preserves the previous value when the picker is cancelled", async () => {
    expect(validateSessionName("line\nbreak")).toBe(false);
    expect(validateSessionName("x".repeat(121))).toBe(false);
    await setLocalSessionName(rt.extensionContext!.workspaceState, "a", "Keep");
    vi.mocked(vscode.window.showInputBox).mockResolvedValueOnce(undefined);
    await renameSessionLocally();
    expect(localSessionName(rt.extensionContext!.workspaceState, "a")).toBe("Keep");
    expect(rt.currentSessionTitle).toBe("Automatic title");
  });
  it("renames the chosen saved session even if focus changes while the picker is open", async () => {
    const b = createSessionRuntime("/b"); b.currentSessionId = "b";
    vi.mocked(vscode.window.showInputBox).mockImplementationOnce(async () => { focusRuntime(b); return "Saved A"; });
    await withRuntime(root, () => renameSessionLocally("a"));
    expect(localSessionName(root.extensionContext!.workspaceState, "a")).toBe("Saved A");
    expect(localSessionName(root.extensionContext!.workspaceState, "b")).toBeUndefined();
  });
});
