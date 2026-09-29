export const UI_BRANDS = {
  icode: { name: "iCode", mark: "iC" },
  chrys: { name: "iCode", mark: "C" },
} as const;

export type UiBrand = keyof typeof UI_BRANDS;

export function resolveUiBrand(value: string | undefined): UiBrand {
  return value === "chrys" ? "chrys" : "icode";
}
