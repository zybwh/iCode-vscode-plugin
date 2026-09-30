import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import { checksumFor, installRuntime, runtimeTarget, launcherText, managedRuntime, pruneStaleRuntimes, STALE_RUNTIME_GRACE_MS, type InstallDependencies } from "../runtime/install";
import { resolveRuntime } from "../runtime/resolve";
const target = runtimeTarget();
const payload = Buffer.from('release fixture');
const digest = createHash('sha256').update(payload).digest('hex');
const dependencies = (): InstallDependencies => ({
    download: vi.fn(async (url, destination) => { await fs.writeFile(destination, url.endsWith('SHA256SUMS.txt') ? `${digest}  ${target.asset}\n` : payload); }),
    extract: vi.fn(async (_archive, destination) => { await fs.writeFile(destination, 'binary'); }),
    validate: vi.fn(async () => { }),
});
async function temporary(run: (root: string) => Promise<void>) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'icode-install-test-')); try {
    await run(root);
}
finally {
    await fs.rm(root, { recursive: true, force: true });
} }
describe('runtime selection', () => {
    it.each(['configured', 'bundled', 'managed', 'path'] as const)('selects %s before lower priority sources', async (source) => {
        const order = ['configured', 'bundled', 'managed', 'path'];
        const probes = { configured: vi.fn(), bundled: vi.fn(), managed: vi.fn(), path: vi.fn() };
        for (const name of order)
            probes[name as keyof typeof probes].mockResolvedValue(order.indexOf(name) < order.indexOf(source) ? null : `/${name}`);
        expect(await resolveRuntime(probes)).toEqual({ path: `/${source}`, source });
        for (const name of order.slice(order.indexOf(source) + 1))
            expect(probes[name as keyof typeof probes]).not.toHaveBeenCalled();
    });
});
describe('managed runtime installation', () => {
    it('maps the extension host platform and rejects unsupported architectures', () => {
        expect(runtimeTarget('darwin', 'arm64').asset).toContain('macos-aarch64');
        expect(runtimeTarget('win32', 'x64')).toMatchObject({ binary: 'icode.exe', launcher: 'icode-managed.cmd' });
        expect(() => runtimeTarget('win32', 'arm64')).toThrow('Unsupported');
        expect(() => runtimeTarget('linux', 'ia32')).toThrow('Unsupported');
        expect(launcherText(false)).toContain('PYAPP_INSTALL_DIR_CHRYS="$SCRIPT_DIR/pyapp"');
        expect(launcherText(true)).toContain('PYAPP_INSTALL_DIR_CHRYS=%~dp0pyapp');
    });
    it('requires an exact unique checksum entry', () => {
        expect(checksumFor(`${digest}  ${target.asset}\n`, target.asset)).toBe(digest);
        expect(() => checksumFor(`${digest}  wrong`, target.asset)).toThrow('Missing');
        expect(() => checksumFor(`${digest}  ${target.asset}\n${digest}  ${target.asset}`, target.asset)).toThrow('ambiguous');
    });
    it('activates only after validation and retains the previous runtime directory', async () => temporary(async (root) => {
        const io = dependencies();
        const first = await installRuntime(root, new AbortController().signal, () => { }, io);
        expect(await managedRuntime(root)).toBe(first);
        const previous = await fs.readFile(path.join(root, 'runtimes/active.json'), 'utf8');
        io.validate = vi.fn(async () => { expect(await fs.readFile(path.join(root, 'runtimes/active.json'), 'utf8')).toBe(previous); });
        const second = await installRuntime(root, new AbortController().signal, () => { }, io);
        expect(second).not.toBe(first);
        expect(await managedRuntime(root)).toBe(second);
        await expect(fs.stat(first)).resolves.toBeDefined();
        expect(await fs.readFile(second, 'utf8')).toContain('PYAPP_INSTALL_DIR_CHRYS');
    }));
    it('rejects checksum failures before executing the binary and preserves the active pointer', async () => temporary(async (root) => {
        const io = dependencies();
        await installRuntime(root, new AbortController().signal, () => { }, io);
        const before = await fs.readFile(path.join(root, 'runtimes/active.json'), 'utf8');
        io.download = async (url, destination) => { await fs.writeFile(destination, url.endsWith('SHA256SUMS.txt') ? `${digest}  ${target.asset}` : 'tampered'); };
        vi.mocked(io.validate).mockClear();
        await expect(installRuntime(root, new AbortController().signal, () => { }, io)).rejects.toThrow('SHA256');
        expect(io.validate).not.toHaveBeenCalled();
        expect(await fs.readFile(path.join(root, 'runtimes/active.json'), 'utf8')).toBe(before);
        expect((await fs.readdir(path.join(root, 'runtimes'))).length).toBe(2);
    }));
    it('removes incomplete candidates on cancellation or failed ACP validation', async () => temporary(async (root) => {
        const io = dependencies();
        io.validate = async () => { throw new Error('ACP mismatch'); };
        await expect(installRuntime(root, new AbortController().signal, () => { }, io)).rejects.toThrow('ACP mismatch');
        expect(await fs.readdir(path.join(root, 'runtimes'))).toEqual([]);
        const controller = new AbortController();
        io.validate = async () => controller.abort();
        await expect(installRuntime(root, controller.signal, () => { }, io)).rejects.toThrow();
        expect(await fs.readdir(path.join(root, 'runtimes'))).toEqual([]);
    }));
    it('coalesces concurrent installation requests', async () => temporary(async (root) => {
        const io = dependencies();
        const first = installRuntime(root, new AbortController().signal, () => { }, io);
        const second = installRuntime(root, new AbortController().signal, () => { }, io);
        expect(await first).toBe(await second);
        expect(io.validate).toHaveBeenCalledOnce();
    }));
    it('does not follow a pointer outside managed storage', async () => temporary(async (root) => {
        await fs.mkdir(path.join(root, 'runtimes'));
        await fs.writeFile(path.join(root, 'runtimes/active.json'), JSON.stringify({ directory: '../../outside', launcher: target.launcher }));
        expect(await managedRuntime(root)).toBeNull();
    }));
});
describe('managed runtime cleanup', () => {
    it('prunes superseded runtimes only after their grace period', async () => temporary(async (root) => {
        const io = dependencies();
        await installRuntime(root, new AbortController().signal, () => { }, io);
        await installRuntime(root, new AbortController().signal, () => { }, io);
        const runtimes = path.join(root, 'runtimes');
        const active = JSON.parse(await fs.readFile(path.join(runtimes, 'active.json'), 'utf8')).directory as string;
        const directories = (await fs.readdir(runtimes)).filter(name => name.startsWith('icode-'));
        expect(directories).toHaveLength(2);
        expect(await pruneStaleRuntimes(root)).toEqual([]);
        const removed = await pruneStaleRuntimes(root, Date.now() + STALE_RUNTIME_GRACE_MS + 1000);
        expect(removed).toEqual(directories.filter(name => name !== active));
        expect((await fs.readdir(runtimes)).filter(name => name.startsWith('icode-'))).toEqual([active]);
        expect(await managedRuntime(root)).toContain(active);
    }));
});
describe('legacy runtime cleanup', () => {
    it('starts the grace period when an old runtime is first seen, not from its install time', async () => temporary(async (root) => {
        const io = dependencies();
        await installRuntime(root, new AbortController().signal, () => { }, io);
        const runtimes = path.join(root, 'runtimes');
        // A runtime superseded before supersession was recorded, installed long ago.
        const legacy = path.join(runtimes, 'icode-0.27.0-legacy');
        await fs.mkdir(legacy);
        const old = new Date(Date.now() - 30 * STALE_RUNTIME_GRACE_MS);
        await fs.utimes(legacy, old, old);
        const now = Date.now();
        expect(await pruneStaleRuntimes(root, now)).toEqual([]);
        expect(await pruneStaleRuntimes(root, now + STALE_RUNTIME_GRACE_MS - 1000)).toEqual([]);
        expect(await pruneStaleRuntimes(root, now + STALE_RUNTIME_GRACE_MS + 1000)).toEqual(['icode-0.27.0-legacy']);
        expect((await fs.readdir(runtimes)).some(name => name.includes('legacy'))).toBe(false);
    }));
});
describe('shared installation requests', () => {
    it('reports progress to every caller and keeps installing until all callers cancel', async () => temporary(async (root) => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const io = dependencies();
        io.validate = vi.fn(async () => { await gate; });
        const firstController = new AbortController();
        const firstStages: string[] = [], secondStages: string[] = [];
        const first = installRuntime(root, firstController.signal, (stage) => firstStages.push(stage), io);
        const second = installRuntime(root, new AbortController().signal, (stage) => secondStages.push(stage), io);
        await vi.waitFor(() => expect(io.validate).toHaveBeenCalled());
        firstController.abort();
        await expect(first).rejects.toBeDefined();
        release();
        expect(await second).toContain(target.launcher);
        expect(secondStages).toContain('ready');
        expect(firstStages).toContain('download');
        expect(firstStages).not.toContain('ready');
    }));
});
