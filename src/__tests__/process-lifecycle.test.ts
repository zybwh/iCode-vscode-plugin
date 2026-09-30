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

it.skipIf(process.platform !== "win32")("starts a Windows command wrapper with spaces using the production ACP transport", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "icode cmd fixture "));
  const manager = new ProcessManager();
  try {
    await fs.writeFile(path.join(root, "worker.js"), `
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: {
          protocolVersion: 1, agentInfo: { name: JSON.stringify(process.argv.slice(2)), version: 'test' }
        } }) + '\\n');
      });
      process.stdin.on('end', () => process.exit());
    `);
    const launcher = path.join(root, "icode fixture.cmd");
    await fs.writeFile(launcher, `@echo off\r\n"${process.execPath}" "%~dp0worker.js" %*\r\n`);
    const args = ["acp", "--workdir", root];
    const client = await manager.start(launcher, args, root);
    const result = await client.initialize(1, { name: "test", version: "1" });
    expect(JSON.parse(result.agentInfo!.name)).toEqual(args);
  } finally {
    await manager.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15000);

it("rejects start for a missing binary without reporting a disconnect", async () => {
  const manager = new ProcessManager();
  const disconnected: unknown[] = [];
  manager.on("disconnected", (reason) => disconnected.push(reason));
  await expect(manager.start("/nonexistent/icode-binary-for-test", ["acp"])).rejects.toThrow(/ENOENT/);
  expect(manager.state).toBe("stopped");
  expect(disconnected).toEqual([]);
});

it("reports a crash once and can start again afterwards", async () => {
  const manager = new ProcessManager();
  const disconnected: unknown[] = [];
  manager.on("disconnected", (reason) => disconnected.push(reason));
  await manager.start(process.execPath, ["-e", "process.exit(3)"]);
  await new Promise<void>((resolve) => manager.on("disconnected", () => resolve()));
  expect(disconnected).toEqual(["exit code 3"]);
  expect(manager.state).toBe("stopped");
  await manager.start(process.execPath, ["-e", "process.stdin.resume()"]);
  expect(manager.state).toBe("running");
  await manager.stop();
});
