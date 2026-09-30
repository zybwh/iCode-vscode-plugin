import type { renderMermaidASCII } from "beautiful-mermaid";

export const DIAGRAM_ENGINE_READY_EVENT = "icode:diagram-engine-ready";

export interface DiagramEngine {
  renderMermaidASCII: typeof renderMermaidASCII;
}

// Separately bundled scripts share the engine through one global slot.
const holder = globalThis as unknown as { icodeDiagramEngine?: DiagramEngine };

export function installDiagramEngine(engine: DiagramEngine): void {
  holder.icodeDiagramEngine = engine;
}

export function installedDiagramEngine(): DiagramEngine | undefined {
  return holder.icodeDiagramEngine;
}
