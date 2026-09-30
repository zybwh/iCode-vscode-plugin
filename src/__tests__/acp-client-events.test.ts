import { describe, expect, it, vi } from "vitest";
import { ChrysAcpClient } from "../acp/client";

type Incoming = (method: string, params: unknown, respond: (result: unknown) => void) => void;

function incoming(client: ChrysAcpClient): Incoming {
  return (client as unknown as { _handleIncoming: Incoming })._handleIncoming.bind(client);
}

describe("ChrysAcpClient notification handlers", () => {
  it("routes notifications to every handler until it is disposed", () => {
    const client = new ChrysAcpClient();
    const first = vi.fn();
    const second = vi.fn();
    const registration = client.onWarning(first);
    client.onWarning(second);
    incoming(client)("_chrys/warning", { message: "one" }, () => {});
    registration.dispose();
    incoming(client)("_chrys/warning", { message: "two" }, () => {});
    expect(first.mock.calls).toEqual([[{ message: "one" }]]);
    expect(second.mock.calls).toEqual([[{ message: "one" }], [{ message: "two" }]]);
  });

  it("passes the event name for grouped notifications and session ids for updates", () => {
    const client = new ChrysAcpClient();
    const subAgent = vi.fn();
    const update = vi.fn();
    client.onSubAgent(subAgent);
    client.onSessionUpdate(update);
    incoming(client)("_chrys/sub_agent_progress", { invocationId: "i1" }, () => {});
    incoming(client)("session/update", { sessionId: "s1", update: { sessionUpdate: "plan", entries: [] } }, () => {});
    expect(subAgent).toHaveBeenCalledWith("_chrys/sub_agent_progress", { invocationId: "i1" });
    expect(update).toHaveBeenCalledWith("s1", { sessionUpdate: "plan", entries: [] });
  });
});
