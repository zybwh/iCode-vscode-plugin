import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AcpClient } from "../acp/protocol";

describe("AcpClient", () => {
  it("includes JSON-RPC error details in rejected request errors", async () => {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const client = new AcpClient();
    client.attach(clientToServer, serverToClient);

    const request = client.request("session/new", { cwd: "/tmp" });
    serverToClient.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32603,
        message: "Internal error",
        data: {
          details: "ImportError: Using SOCKS proxy, but the 'socksio' package is not installed.",
        },
      },
    }) + "\n");

    await expect(request).rejects.toThrow(
      "ACP error -32603: Internal error - ImportError: Using SOCKS proxy, but the 'socksio' package is not installed.",
    );

    client.detach();
  });
});
