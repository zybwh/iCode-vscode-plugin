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
