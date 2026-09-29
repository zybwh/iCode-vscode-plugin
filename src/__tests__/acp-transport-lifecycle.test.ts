import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { AcpClient, AcpRequestError } from "../acp/protocol";

function nextJson(stream: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    stream.once("data", (chunk: Buffer) => resolve(JSON.parse(chunk.toString().trim()) as Record<string, unknown>));
  });
}

describe("ACP transport", () => {
  it("resolves a response that arrives synchronously during write", async () => {
    const reader = new PassThrough();
    const writer = new Writable({
      write(chunk, _encoding, callback) {
        const request = JSON.parse(chunk.toString()) as { id: number };
        reader.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ready: true } })}\n`);
        callback();
      },
    });
    const client = new AcpClient();
    client.attach(writer, reader);

    await expect(client.request("initialize", { protocolVersion: 1 })).resolves.toEqual({ ready: true });
    client.detach();
  });

  it("rejects pending requests when the transport detaches", async () => {
    const client = new AcpClient();
    client.attach(new PassThrough(), new PassThrough());
    const pending = client.request("session/list", { cwd: "C:\\workspace" });

    client.detach();

    await expect(pending).rejects.toThrow("ACP transport closed");
  });

  it("preserves JSON-RPC error codes for feature gating", async () => {
    const reader = new PassThrough();
    const writer = new PassThrough();
    const client = new AcpClient();
    client.attach(writer, reader);
    const request = client.request("_chrys/optional_feature", {});
    const outbound = await nextJson(writer);

    reader.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: outbound.id,
      error: { code: -32601, message: "Method not found" },
    })}\n`);

    await expect(request).rejects.toMatchObject<AcpRequestError>({ code: -32601 });
    client.detach();
  });

  it("preserves structured JSON-RPC error details and usage", async () => {
    const reader = new PassThrough();
    const writer = new PassThrough();
    const client = new AcpClient();
    client.attach(writer, reader);
    const request = client.request("session/prompt", {});
    const outbound = await nextJson(writer);

    reader.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: outbound.id,
      error: {
        code: -32000,
        message: "Prompt failed",
        data: {
          message: "Provider rejected the request",
          details: "Context window exceeded",
          usage: { totalTokens: 123 },
        },
      },
    })}\n`);

    await expect(request).rejects.toMatchObject<AcpRequestError>({
      code: -32000,
      details: "Context window exceeded",
      usage: { totalTokens: 123 },
      message: expect.stringContaining("Provider rejected the request"),
    });
    client.detach();
  });

  it("turns an incoming handler failure into a JSON-RPC error response", async () => {
    const reader = new PassThrough();
    const writer = new PassThrough();
    const client = new AcpClient();
    client.attach(writer, reader);
    client.onMessage(async () => {
      throw new Error("dialog failed");
    });
    const response = nextJson(writer);

    reader.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "_chrys/request_input", params: {} })}\n`);

    await expect(response).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -32603, message: "dialog failed" },
    });
    client.detach();
  });

  it("echoes string request IDs from the agent", async () => {
    const reader = new PassThrough();
    const writer = new PassThrough();
    const client = new AcpClient();
    client.attach(writer, reader);
    client.onMessage((_method, _params, respond) => respond({ accepted: true }));
    const response = nextJson(writer);

    reader.write(`${JSON.stringify({ jsonrpc: "2.0", id: "permission-1", method: "session/request_permission", params: {} })}\n`);

    await expect(response).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "permission-1",
      result: { accepted: true },
    });
    client.detach();
  });
});

it("rejects a pending prompt when the stdout stream reaches EOF", async () => {
  const reader = new PassThrough();
  const writer = new PassThrough();
  const client = new AcpClient();
  client.attach(writer, reader);
  const pending = expect(client.request("session/prompt", {}, 0)).rejects.toThrow("ACP transport closed");
  reader.end();
  await pending;
  writer.destroy();
});

it("responds to a synchronous reverse-request handler failure", async () => {
  const reader = new PassThrough();
  const writer = new PassThrough();
  const client = new AcpClient();
  client.attach(writer, reader);
  client.onMessage(() => { throw new Error("approval unavailable"); });
  reader.write(JSON.stringify({ jsonrpc: "2.0", id: "permission-1", method: "session/request_permission" }) + "\n");
  expect(JSON.parse(String(writer.read()))).toMatchObject({
    id: "permission-1", error: { code: -32603, message: "approval unavailable" },
  });
  client.detach();
});
