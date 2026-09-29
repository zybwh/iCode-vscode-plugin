import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { ChrysAcpClient } from "../acp/client";

async function nextOutboundLine(stream: PassThrough): Promise<Record<string, unknown>> {
  return await new Promise((resolve) => {
    stream.once("data", (chunk: Buffer) => {
      resolve(JSON.parse(chunk.toString("utf8").trim()) as Record<string, unknown>);
    });
  });
}

describe("iCode v0.22.5 ACP client", () => {
  it("answers a structured request_input batch without legacy fields", async () => {
    const client = new ChrysAcpClient();
    const toBackend = new PassThrough();
    const fromBackend = new PassThrough();
    client.transport.attach(toBackend, fromBackend);
    client.onRequestInput(async (request) => {
      expect("questions" in request ? request.questions : []).toHaveLength(2);
      return {
        answers: [
          { values: ["tenacity"], note: "existing dependency" },
          { values: ["Keep it transport-agnostic."], note: "" },
        ],
        cancelled: false,
      };
    });

    const responsePromise = nextOutboundLine(toBackend);
    fromBackend.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 41,
      method: "_chrys/request_input",
      params: {
        sessionId: "s1",
        requestId: "q1",
        callerName: "Code",
        questions: [
          {
            question: "Which library?",
            header: "Library",
            multiSelect: false,
            options: [{ label: "tenacity", description: "Use the existing dependency." }],
          },
          {
            question: "Anything else?",
            header: "Constraints",
            multiSelect: false,
            options: [],
          },
        ],
      },
    })}\n`);

    expect(await responsePromise).toEqual({
      jsonrpc: "2.0",
      id: 41,
      result: {
        answers: [
          { values: ["tenacity"], note: "existing dependency" },
          { values: ["Keep it transport-agnostic."], note: "" },
        ],
        cancelled: false,
      },
    });
    client.transport.detach();
  });

  it("returns a valid cancelled permission outcome if the dialog fails", async () => {
    const client = new ChrysAcpClient();
    const toBackend = new PassThrough();
    const fromBackend = new PassThrough();
    client.transport.attach(toBackend, fromBackend);
    client.onRequestPermission(async () => { throw new Error("dialog failed"); });
    const response = nextOutboundLine(toBackend);
    fromBackend.write(JSON.stringify({ jsonrpc: "2.0", id: 44, method: "session/request_permission", params: { sessionId: "s1", toolCall: { toolCallId: "t1" }, options: [] } }) + "\n");
    expect(await response).toEqual({ jsonrpc: "2.0", id: 44, result: { outcome: { outcome: "cancelled" } } });
    client.transport.detach();
  });

  it("uses the dedicated reset route for built-in agent profiles", async () => {
    const client = new ChrysAcpClient();
    const toBackend = new PassThrough();
    const fromBackend = new PassThrough();
    client.transport.attach(toBackend, fromBackend);

    const outboundPromise = nextOutboundLine(toBackend);
    const resultPromise = client.resetAgentProfile("Code");
    const outbound = await outboundPromise;
    expect(outbound).toMatchObject({
      method: "_profiles/agents/reset",
      params: { name: "Code" },
    });
    fromBackend.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: outbound.id,
      result: { profile: { name: "Code", builtin: true }, changed: true },
    })}\n`);

    await expect(resultPromise).resolves.toMatchObject({ changed: true });
    client.transport.detach();
  });

  it("fails closed when a request_input handler returns an invalid batch", async () => {
    const client = new ChrysAcpClient();
    const toBackend = new PassThrough();
    const fromBackend = new PassThrough();
    client.transport.attach(toBackend, fromBackend);
    client.onRequestInput(async () => ({
      answers: [{ values: ["one", "two"], note: "" }],
      cancelled: false,
    }));

    const responsePromise = nextOutboundLine(toBackend);
    fromBackend.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "_chrys/request_input",
      params: {
        sessionId: "s1",
        requestId: "q2",
        questions: [{ question: "Pick one", multiSelect: false, options: [{ label: "one" }, { label: "two" }] }],
      },
    })}\n`);

    expect(await responsePromise).toEqual({
      jsonrpc: "2.0",
      id: 42,
      result: { cancelled: true },
    });
    client.transport.detach();
  });

  it("fails closed when a request_input handler throws", async () => {
    const client = new ChrysAcpClient();
    const toBackend = new PassThrough();
    const fromBackend = new PassThrough();
    client.transport.attach(toBackend, fromBackend);
    client.onRequestInput(async () => {
      throw new Error("dialog failed");
    });

    const responsePromise = nextOutboundLine(toBackend);
    fromBackend.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 43,
      method: "_chrys/request_input",
      params: {
        sessionId: "s1",
        requestId: "q3",
        questions: [{ question: "Continue?", multiSelect: false, options: [] }],
      },
    })}\n`);

    expect(await responsePromise).toEqual({
      jsonrpc: "2.0",
      id: 43,
      result: { cancelled: true },
    });
    client.transport.detach();
  });
});
