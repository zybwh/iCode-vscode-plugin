export interface AgentProfileFormFields {
  name: string;
  display_name: string;
  description: string;
  instructions: string;
}

export const BUILTIN_AGENT_NAMES: readonly string[] = ["Code", "QA", "Explore", "Plan", "General"];

export function isBuiltinAgentName(name: string): boolean {
  return BUILTIN_AGENT_NAMES.includes(name);
}

export function agentProfileMutation(profile: { name: string; builtin?: boolean }): "reset" | "delete" {
  return profile.builtin === true ? "reset" : "delete";
}

export type AgentProfileDeleteOutcome =
  | "restored_builtin"
  | "already_builtin"
  | "deleted"
  | "not_found";

export function agentProfileDeleteOutcome(
  name: string,
  deleted: boolean,
): AgentProfileDeleteOutcome {
  if (isBuiltinAgentName(name)) {
    return deleted ? "restored_builtin" : "already_builtin";
  }
  return deleted ? "deleted" : "not_found";
}

export function buildAgentProfileSave(
  existing: Record<string, unknown> | undefined,
  fields: AgentProfileFormFields,
  existingName?: string,
): Record<string, unknown> {
  if (existingName && !existing) {
    throw new Error(`Complete agent profile data is unavailable for ${existingName}`);
  }
  if (!existing) return { ...fields };
  return {
    ...existing,
    ...fields,
    name: typeof existing.name === "string" ? existing.name : existingName,
  };
}

/** A clone has a new identity. Masked credentials cannot be recovered by a new profile. */
export function cloneAgentProfile(source: Record<string, unknown>, names: readonly string[]): {
  profile: Record<string, unknown>; omittedSecrets: boolean;
} {
  const profile = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  delete profile.id;
  const base = `${String(source.name || "agent")}-copy`;
  let name = base;
  for (let suffix = 2; names.includes(name); suffix++) name = `${base}-${suffix}`;
  profile.name = name;
  profile.display_name = name;
  let omittedSecrets = false;
  // New identities must never save a redaction placeholder as a real credential.
  const strip = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (child === "***") {
        delete (value as Record<string, unknown>)[key];
        omittedSecrets = true;
      } else strip(child);
    }
  };
  const tools = profile.tools as { mcp?: unknown[] } | undefined;
  for (const server of tools?.mcp ?? []) {
    if (!server || typeof server !== "object") continue;
    strip((server as Record<string, unknown>).headers);
    strip((server as Record<string, unknown>).env);
  }
  strip((profile.acp as Record<string, unknown> | undefined)?.env);
  return { profile, omittedSecrets };
}
