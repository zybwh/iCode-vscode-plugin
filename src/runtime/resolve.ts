export type RuntimeSource = "configured" | "bundled" | "managed" | "path";
export interface RuntimeResolution {
    path: string;
    source: RuntimeSource;
}
/** Explicit settings win; full packages do not accidentally pick an older PATH runtime. */
export async function resolveRuntime(probes: Record<RuntimeSource, () => Promise<string | null>>): Promise<RuntimeResolution | null> {
    for (const source of ["configured", "bundled", "managed", "path"] as const) {
        const path = await probes[source]();
        if (path)
            return { path, source };
    }
    return null;
}
