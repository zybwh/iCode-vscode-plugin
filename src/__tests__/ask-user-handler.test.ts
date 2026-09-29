import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  CancellationTokenSource: class {
    private listeners: Array<() => void> = [];
    token = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        this.listeners.push(listener);
        return { dispose: vi.fn() };
      },
    };
    cancel(): void {
      this.token.isCancellationRequested = true;
      this.listeners.forEach((listener) => listener());
    }
    dispose = vi.fn();
  },
  EventEmitter: class<T> {
    event = vi.fn();
    fire = vi.fn((_event: T) => undefined);
    dispose = vi.fn();
  },
  env: { language: "en" },
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(() => undefined) })) },
  window: {
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
  },
}));

import * as vscode from "vscode";
import { AskUserHandler } from "../askUser/modal";
import { rt } from "../state/runtime";

describe("AskUser handler lifecycle", () => {
  it("does not create a closed chat panel when cancelling", () => {
    const provider = vi.fn(() => null);
    rt.chatPanel = null;
    new AskUserHandler(provider).cancelActive("backend-restarting");
    expect(provider).not.toHaveBeenCalled();
  });
  it("cancels and releases a pending batch when the session closes", async () => {
    const panel = {
      appendDebugEvent: vi.fn(),
      reveal: vi.fn(),
      setAskUserDialogState: vi.fn(),
    };
    const handler = new AskUserHandler(() => panel as never);
    rt.chatPanel = panel as never;
    const response = handler.requestInput({
      sessionId: "s1",
      requestId: "q1",
      questions: [{ question: "Continue?", options: [] }],
    });

    await Promise.resolve();
    handler.cancelActive("session-cancelled");

    await expect(response).resolves.toEqual({ cancelled: true });
    expect(panel.setAskUserDialogState).toHaveBeenLastCalledWith(null);
  });

  it("keeps an active AskUser dialog alive when only render state is cleared", async () => {
    const panel = {
      appendDebugEvent: vi.fn(),
      reveal: vi.fn(),
      setAskUserDialogState: vi.fn(),
    };
    const handler = new AskUserHandler(() => panel as never);
    rt.askUserHandler = handler;
    const response = handler.requestInput({
      sessionId: "s1",
      requestId: "q2",
      questions: [{ question: "Still there?", options: [] }],
    });

    await Promise.resolve();
    rt.resetRenderState();

    expect(rt.activeAskUserRequest?.requestId).toBe("q2");
    handler.cancelActive("test-cleanup");
    await expect(response).resolves.toEqual({ cancelled: true });
    rt.askUserHandler = null;
  });

  it("cancels native fallback input when the session closes", async () => {
    vi.mocked(vscode.window.showInputBox).mockImplementation((_options, token) => new Promise((resolve) => {
      token?.onCancellationRequested(() => resolve(undefined));
    }));
    const handler = new AskUserHandler(() => null);
    const response = handler.requestInput({
      sessionId: "s1",
      requestId: "q3",
      questions: [{ question: "Fallback?", options: [] }],
    });

    await Promise.resolve();
    handler.cancelActive("session-closed");

    await expect(response).resolves.toEqual({ cancelled: true });
    expect(vscode.window.showInputBox).toHaveBeenCalled();
  });
});
