import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { chrysSessionRootDir, chrysSessionsDir, findSessionJsonPath, sessionShortId } from "../common/sessionFiles";

const originalSessionRootDir = process.env.CHRYS_SESSION_ROOT_DIR;

afterEach(() => {
  if (originalSessionRootDir === undefined) {
    delete process.env.CHRYS_SESSION_ROOT_DIR;
  } else {
    process.env.CHRYS_SESSION_ROOT_DIR = originalSessionRootDir;
  }
});

function withTempSessionRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chrys-sessions-"));
  process.env.CHRYS_SESSION_ROOT_DIR = root;
  return root;
}

describe("sessionFiles", () => {
  it("honors CHRYS_SESSION_ROOT_DIR for nested session.json files", () => {
    const root = withTempSessionRoot();
    const sessionId = "12345678-1234-1234-1234-123456789abc";
    const shortId = sessionShortId(sessionId);
    const expectedPath = path.join(root, "sessions", shortId, "session.json");

    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, "{}");

    expect(chrysSessionRootDir()).toBe(root);
    expect(chrysSessionsDir()).toBe(path.join(root, "sessions"));
    expect(findSessionJsonPath(sessionId)).toBe(expectedPath);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("keeps the legacy flat short-id lookup fallback", () => {
    const root = withTempSessionRoot();
    const sessionId = "abcdef12-3456-7890-abcd-ef1234567890";
    const expectedPath = path.join(root, "sessions", `${sessionShortId(sessionId)}.json`);

    fs.mkdirSync(path.dirname(expectedPath), { recursive: true });
    fs.writeFileSync(expectedPath, "{}");

    expect(findSessionJsonPath(sessionId)).toBe(expectedPath);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
