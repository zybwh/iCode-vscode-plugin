export const PROVIDERS = ["openai", "anthropic", "deepseek-openai"] as const;
export type Provider = (typeof PROVIDERS)[number];
