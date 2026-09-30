import { test as base, vi, onTestFailed, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessManager } from "../../src/process/manager";
import type { ChrysAcpClient } from "../../src/acp/client";

interface RuntimeFixture {
  workspace: string;
  start(binary: string, args?: string[]): Promise<{ manager: ProcessManager; client: ChrysAcpClient }>;
}

// Vitest files run in isolated workers; tests using this fixture must stay serial
// because ProcessManager takes a snapshot of process.env when spawning.
export const test = base.extend<{ runtime: RuntimeFixture }>({
  runtime: async ({}, use) => {
    const root = mkdtempSync(join(tmpdir(), "icode-acp-test-"));
    const workspace = join(root, "workspace");
    const home = join(root, "home");
    const appdata = join(root, "appdata");
    for (const directory of [workspace, home, appdata]) mkdirSync(directory);
    // These are the backend's platform configuration roots, scoped to the test
    // worker and restored after all child processes have stopped.
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("APPDATA", appdata);
    const managers: ProcessManager[] = [];
    const unexpectedStdout: unknown[] = [];
    onTestFailed(() => {
      for (const manager of managers) console.error(`ACP subprocess diagnostics:\n${manager.recentOutput}`);
    });
    try {
      await use({
        workspace,
        async start(binary, args = ["acp", "--agent", "Code", "-C", workspace]) {
          const manager = new ProcessManager();
          managers.push(manager);
          if (args[0] === "acp") manager.on("stdout", line => unexpectedStdout.push(line));
          const client = await manager.start(binary, args, workspace);
          return { manager, client };
        },
      });
    } finally {
      try {
        await Promise.all(managers.map(manager => manager.stop()));
        expect(unexpectedStdout, "Official ACP stdout must contain only protocol frames").toEqual([]);
      } finally {
        vi.unstubAllEnvs();
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
});
