import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../session/manager";
import type { ChrysAcpClient } from "../acp/client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeAcp() {
  const prompts: Array<ReturnType<typeof deferred<unknown>>> = [];
  const acp = {
    newSession: vi.fn(async () => ({ sessionId: "s1" })),
    prompt: vi.fn(() => {
      const next = deferred<unknown>();
      prompts.push(next);
      return next.promise;
    }),
    cancel: vi.fn(async () => {}),
    closeSession: vi.fn(async () => {}),
  };
  return { acp: acp as unknown as ChrysAcpClient, raw: acp, prompts };
}

describe("SessionManager turn ownership", () => {
  it("stays cancelling until the cancelled prompt settles", async () => {
    const { acp, prompts } = fakeAcp();
    const manager = new SessionManager(acp);
    await manager.newSession("/w");
    const turn = manager.sendPrompt([{ type: "text", text: "a" }]);
    const cancelling = manager.cancel();
    await Promise.resolve();
    expect(manager.state).toBe("cancelling");
    prompts[0].resolve({ stopReason: "cancelled" });
    await Promise.all([turn, cancelling]);
    expect(manager.state).toBe("idle");
  });

  it("does not let a late cancelled prompt reset a newer turn", async () => {
    vi.useFakeTimers();
    try {
      const { acp, prompts } = fakeAcp();
      const manager = new SessionManager(acp);
      await manager.newSession("/w");
      const first = manager.sendPrompt([{ type: "text", text: "a" }]);
      const cancelling = manager.cancel();
      await vi.advanceTimersByTimeAsync(5000);
      await cancelling;
      expect(manager.state).toBe("idle");

      const second = manager.sendPrompt([{ type: "text", text: "b" }]);
      const secondTurn = manager.turn;
      expect(manager.state).toBe("running");
      prompts[0].resolve({ stopReason: "cancelled" });
      await first;
      expect(manager.state).toBe("running");
      expect(manager.turn).toBe(secondTurn);
      prompts[1].resolve({ stopReason: "end_turn" });
      await second;
      expect(manager.state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns to idle when the cancel notification fails", async () => {
    const { acp, raw } = fakeAcp();
    raw.cancel.mockRejectedValueOnce(new Error("ACP transport closed"));
    const manager = new SessionManager(acp);
    await manager.newSession("/w");
    void manager.sendPrompt([{ type: "text", text: "a" }]).catch(() => {});
    await expect(manager.cancel()).rejects.toThrow("ACP transport closed");
    expect(manager.state).toBe("idle");
  });
});

describe("sending right after Stop", () => {
  it("waits for the cancel to settle and then starts a new turn instead of injecting", async () => {
    const { acp, raw, prompts } = fakeAcp();
    const manager = new SessionManager(acp);
    await manager.newSession("/w");
    (raw as unknown as { inject: ReturnType<typeof vi.fn> }).inject = vi.fn(async () => {});
    const first = manager.sendPrompt([{ type: "text", text: "a" }]);
    const cancelling = manager.cancel();
    await Promise.resolve();
    expect(manager.state).toBe("cancelling");
    let settled = false;
    const waiting = manager.whenCancelSettled().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    prompts[0].resolve({ stopReason: "cancelled" });
    await Promise.all([first, cancelling, waiting]);
    expect(manager.state).toBe("idle");
    const second = manager.sendPrompt([{ type: "text", text: "b" }]);
    expect(manager.state).toBe("running");
    prompts[1].resolve({ stopReason: "end_turn" });
    await second;
  });
});
