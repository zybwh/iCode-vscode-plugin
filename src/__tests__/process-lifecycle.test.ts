import { expect, it } from "vitest";
import { ProcessManager } from "../process/manager";

it("settles outstanding ACP work when deliberately stopping the backend", async () => {
  const manager = new ProcessManager();
  const client = await manager.start(process.execPath, ["-e", "process.stdin.resume()"]);
  const pending = expect(client.prompt("session-1", [{ type: "text", text: "hello" }])).rejects.toThrow("ACP transport closed");
  try {
    await manager.stop();
    await pending;
    expect(manager.state).toBe("stopped");
  } finally {
    if (manager.state !== "stopped") await manager.stop();
  }
});
