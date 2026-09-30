import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { get } from "node:https";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ProcessManager } from "../process/manager";
export const RUNTIME_VERSION = "0.28.0";
export const RELEASE_BASE = `https://github.com/openJiuwen-ai/iCode/releases/download/v${RUNTIME_VERSION}`;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_BINARY_BYTES = 1024 * 1024 * 1024;
export type InstallStage = "download" | "verify" | "extract" | "validate" | "ready";
export type InstallProgress = (stage: InstallStage, bytes?: number, total?: number) => void;
export interface RuntimeTarget {
    target: string;
    asset: string;
    binary: string;
    launcher: string;
}
export function runtimeTarget(platform: string = process.platform, arch: string = process.arch): RuntimeTarget {
    const targets: Record<string, string> = {
        "linux-x64": "linux-x86_64", "linux-arm64": "linux-aarch64",
        "darwin-x64": "macos-x86_64", "darwin-arm64": "macos-aarch64", "win32-x64": "windows-x86_64",
    };
    const target = `${platform}-${arch}`;
    if (!targets[target])
        throw new Error(`Unsupported iCode runtime platform: ${target}`);
    const windows = platform === "win32";
    return { target, asset: `icode-${targets[target]}-v${RUNTIME_VERSION}-offline.${windows ? "zip" : "tar.gz"}`, binary: windows ? "icode.exe" : "icode", launcher: windows ? "icode-managed.cmd" : "icode-managed" };
}
export function checksumFor(text: string, asset: string): string {
    const matches = text.split(/\r?\n/).flatMap(line => {
        const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());
        return match?.[2] === asset ? [match[1].toLowerCase()] : [];
    });
    if (matches.length !== 1)
        throw new Error(`Missing or ambiguous SHA256 checksum for ${asset}`);
    return matches[0];
}
function limitBytes(limit: number, progress?: (bytes: number) => void): Transform {
    let size = 0;
    return new Transform({ transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            if (size > limit) {
                callback(new Error("Runtime download exceeds size limit"));
                return;
            }
            progress?.(size);
            callback(null, chunk);
        } });
}
/** HTTPS only, bounded redirects/size and cancellation. No credentials are sent. */
export async function download(url: string, destination: string, signal: AbortSignal, maxBytes: number, progress?: (bytes: number, total?: number) => void): Promise<void> {
    let current = new URL(url);
    for (let redirects = 0; redirects <= 8; redirects++) {
        if (current.protocol !== "https:")
            throw new Error("Runtime downloads require HTTPS");
        signal.throwIfAborted();
        const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
            const request = get(current, { signal, headers: { "User-Agent": "icode-vscode-plugin", "Accept": "application/octet-stream" } }, resolve);
            request.on("error", reject);
            request.setTimeout(60000, () => request.destroy(new Error("Runtime download timed out")));
        });
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
            response.resume();
            current = new URL(response.headers.location, current);
            continue;
        }
        if (response.statusCode !== 200) {
            response.resume();
            throw new Error(`Runtime download failed: HTTP ${response.statusCode}`);
        }
        const total = Number(response.headers["content-length"]) || undefined;
        if (total && total > maxBytes) {
            response.destroy();
            throw new Error("Runtime download exceeds size limit");
        }
        await pipeline(response, limitBytes(maxBytes, bytes => progress?.(bytes, total)), createWriteStream(destination, { flags: "wx" }), { signal });
        return;
    }
    throw new Error("Too many runtime download redirects");
}
export async function verifyArchive(archive: string, expected: string, signal: AbortSignal): Promise<void> {
    const hash = createHash("sha256");
    await pipeline(createReadStream(archive), hash, { signal });
    if (hash.digest("hex") !== expected)
        throw new Error("iCode archive SHA256 verification failed");
}
async function extractBinary(archive: string, destination: string, binaryName: string, signal: AbortSignal): Promise<void> {
    // Stream only the named file: archive paths, links and extra files are never extracted.
    const child = spawn("tar", ["-xOf", archive, binaryName], { stdio: ["ignore", "pipe", "pipe"], signal });
    let detail = "";
    child.stderr.on("data", (chunk: Buffer) => { detail = (detail + chunk.toString()).slice(-2000); });
    const exited = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", code => code === 0 ? resolve() : reject(new Error(`Cannot extract iCode (tar exit ${code}): ${detail}`)));
    });
    try {
        await Promise.all([exited, pipeline(child.stdout, limitBytes(MAX_BINARY_BYTES), createWriteStream(destination, { flags: "wx", mode: 0o755 }), { signal })]);
    }
    finally {
        if (child.exitCode === null)
            child.kill();
    }
}
export function launcherText(windows: boolean): string {
    return windows
        ? '@echo off\r\nsetlocal\r\nset "PYAPP_INSTALL_DIR_CHRYS=%~dp0pyapp"\r\n"%~dp0icode.exe" %*\r\nexit /b %ERRORLEVEL%\r\n'
        : '#!/bin/sh\nset -eu\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexport PYAPP_INSTALL_DIR_CHRYS="$SCRIPT_DIR/pyapp"\nexec "$SCRIPT_DIR/icode" "$@"\n';
}
export async function validateRuntime(binary: string, signal: AbortSignal): Promise<void> {
    const manager = new ProcessManager();
    let stopping: Promise<void> | undefined;
    let timedOut = false;
    const abort = () => { stopping ??= manager.stop(); };
    const timer = setTimeout(() => { timedOut = true; abort(); }, 180000);
    signal.addEventListener("abort", abort, { once: true });
    try {
        signal.throwIfAborted();
        const client = await manager.start(binary, ["acp"], path.dirname(binary));
        const initialized = await client.initialize(1, { name: "icode-vscode-runtime-check", version: "1" });
        signal.throwIfAborted();
        if (initialized.protocolVersion !== 1)
            throw new Error(`Unsupported ACP protocol: ${initialized.protocolVersion}`);
        if (initialized.agentInfo?.version !== RUNTIME_VERSION)
            throw new Error(`Expected iCode ${RUNTIME_VERSION}, received ${initialized.agentInfo?.version ?? "unknown"}`);
    }
    catch (error) {
        signal.throwIfAborted();
        if (timedOut)
            throw new Error("iCode ACP validation timed out");
        throw error;
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        await (stopping ?? manager.stop());
    }
}
export async function managedRuntime(storage: string): Promise<string | null> {
    try {
        const record = JSON.parse(await fs.readFile(path.join(storage, "runtimes", "active.json"), "utf8")) as {
            directory?: unknown;
            launcher?: unknown;
        };
        if (typeof record.directory !== "string" || !/^icode-[a-zA-Z0-9.-]+$/.test(record.directory))
            return null;
        if (record.launcher !== runtimeTarget().launcher)
            return null;
        const binary = path.join(storage, "runtimes", record.directory, record.launcher);
        if (!(await fs.stat(binary)).isFile())
            return null;
        await fs.access(binary, process.platform === "win32" ? 0 : 1);
        return binary;
    }
    catch {
        return null;
    }
}
/** Superseded runtimes are kept for a while because another window may still run them. */
export const STALE_RUNTIME_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Best-effort removal of managed runtimes that are no longer active. Each install keeps
 * the previous runtime intact for atomic activation; without pruning every reinstall or
 * upgrade leaves a full runtime (hundreds of MB) behind in extension global storage.
 */
export async function pruneStaleRuntimes(storage: string, now = Date.now(), graceMs = STALE_RUNTIME_GRACE_MS): Promise<string[]> {
    const root = path.join(storage, "runtimes");
    const active = await activeRuntimeDirectory(root);
    if (!active)
        return [];
    let entries: import("node:fs").Dirent[];
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const removed: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === active || !/^icode-[a-zA-Z0-9.-]+$/.test(entry.name))
            continue;
        const directory = path.join(root, entry.name);
        try {
            if (now - (await fs.stat(directory)).mtimeMs < graceMs)
                continue;
            await fs.rm(directory, { recursive: true, force: true });
            removed.push(entry.name);
        }
        catch {
            // A runtime still in use (for example on Windows) is retried on a later prune.
        }
    }
    return removed;
}
async function activeRuntimeDirectory(root: string): Promise<string | null> {
    try {
        const record = JSON.parse(await fs.readFile(path.join(root, "active.json"), "utf8")) as { directory?: unknown };
        return typeof record.directory === "string" ? record.directory : null;
    }
    catch {
        return null;
    }
}
export interface InstallDependencies {
    download: typeof download;
    extract: typeof extractBinary;
    validate: typeof validateRuntime;
}
interface SharedInstall {
    operation: Promise<string>;
    controller: AbortController;
    listeners: Set<InstallProgress>;
    callers: number;
    aborted: number;
}
const installs = new Map<string, SharedInstall>();
/**
 * Unique candidates + atomic pointer keep any previous working runtime intact.
 * Concurrent calls for one storage share a single install: every caller receives
 * progress, and the download is aborted only once every caller has cancelled.
 */
export function installRuntime(storage: string, signal: AbortSignal, progress: InstallProgress, dependencies: Partial<InstallDependencies> = {}, target = runtimeTarget()): Promise<string> {
    const key = path.resolve(storage);
    let shared = installs.get(key);
    if (!shared) {
        const controller = new AbortController();
        const listeners = new Set<InstallProgress>();
        const operation = performInstall(key, controller.signal, (stage, bytes, total) => {
            for (const listener of listeners) listener(stage, bytes, total);
        }, { download, extract: extractBinary, validate: validateRuntime, ...dependencies }, target).finally(() => installs.delete(key));
        shared = { operation, controller, listeners, callers: 0, aborted: 0 };
        installs.set(key, shared);
    }
    const current = shared;
    current.callers += 1;
    current.listeners.add(progress);
    let leave: ((reason: unknown) => void) | undefined;
    // A caller that cancels stops waiting while other callers keep the install alive;
    // when the last caller cancels, the install itself aborts and cleans up first.
    const cancelled = new Promise<never>((_, reject) => { leave = reject; });
    const onAbort = () => {
        current.listeners.delete(progress);
        current.aborted += 1;
        if (current.aborted >= current.callers)
            current.controller.abort(signal.reason);
        else
            leave?.(signal.reason);
    };
    if (signal.aborted)
        onAbort();
    else
        signal.addEventListener("abort", onAbort, { once: true });
    return Promise.race([current.operation, cancelled]).finally(() => {
        signal.removeEventListener("abort", onAbort);
        current.listeners.delete(progress);
    });
}
async function performInstall(storage: string, signal: AbortSignal, progress: InstallProgress, io: InstallDependencies, target: RuntimeTarget): Promise<string> {
    const root = path.join(storage, "runtimes");
    await fs.mkdir(root, { recursive: true });
    const directory = `icode-${RUNTIME_VERSION}-${target.target}-${randomUUID()}`;
    const candidate = path.join(root, directory);
    await fs.mkdir(candidate);
    const pointer = path.join(root, `${directory}.json`);
    let activated = false;
    try {
        const sums = path.join(candidate, "SHA256SUMS.txt"), archive = path.join(candidate, target.asset);
        progress("download");
        await io.download(`${RELEASE_BASE}/SHA256SUMS.txt`, sums, signal, 1024 * 1024);
        const expected = checksumFor(await fs.readFile(sums, "utf8"), target.asset);
        await io.download(`${RELEASE_BASE}/${target.asset}`, archive, signal, MAX_ARCHIVE_BYTES, (bytes, total) => progress("download", bytes, total));
        progress("verify");
        await verifyArchive(archive, expected, signal);
        progress("extract");
        await io.extract(archive, path.join(candidate, target.binary), target.binary, signal);
        const launcher = path.join(candidate, target.launcher);
        await fs.writeFile(launcher, launcherText(target.target.startsWith("win32")), { mode: 0o755 });
        progress("validate");
        await io.validate(launcher, signal);
        signal.throwIfAborted();
        await fs.writeFile(path.join(candidate, "INSTALL.json"), JSON.stringify({ version: RUNTIME_VERSION, target: target.target, asset: target.asset, sha256: expected, source: RELEASE_BASE }, null, 2));
        await fs.rm(archive);
        await fs.writeFile(pointer, JSON.stringify({ directory, launcher: target.launcher }));
        signal.throwIfAborted();
        const previous = await activeRuntimeDirectory(root);
        await fs.rename(pointer, path.join(root, "active.json"));
        activated = true;
        // Start the superseded runtime's grace period now; pruning keys off its mtime.
        if (previous && previous !== directory) {
            const now = new Date();
            await fs.utimes(path.join(root, previous), now, now).catch(() => { });
        }
        await pruneStaleRuntimes(storage).catch(() => []);
        progress("ready");
        return launcher;
    }
    finally {
        await fs.rm(pointer, { force: true });
        if (!activated)
            await fs.rm(candidate, { recursive: true, force: true });
    }
}
