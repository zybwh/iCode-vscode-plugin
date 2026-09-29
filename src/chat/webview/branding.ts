
import { UI_BRANDS, resolveUiBrand, type UiBrand } from "../../common/uiBrand";

export interface BrandDisplayInput {
  uiBrand?: UiBrand;
  chrysCliVersion?: string;
  agentName?: string;
  modelName?: string;
  platformLabel?: string;
  workspacePath?: string;
}

export interface BrandDisplay {
  header: string;
  product: string;
  backend: string;
  tooltip: string;
}

export function brandDisplay(input: BrandDisplayInput): BrandDisplay {
  const product = UI_BRANDS[resolveUiBrand(input.uiBrand)].name;
  const backend = input.chrysCliVersion ? `iCode CLI v${input.chrysCliVersion}` : "iCode CLI";
  const details = [
    product,
    input.agentName ? `Agent: ${input.agentName}` : "",
    input.modelName ? `Model: ${input.modelName}` : "",
    `Backend: ${backend}`,
    input.platformLabel || "",
    input.workspacePath || "",
  ].filter(Boolean);
  return {
    header: input.chrysCliVersion ? backend : product,
    product,
    backend,
    tooltip: details.join(" · "),
  };
}
