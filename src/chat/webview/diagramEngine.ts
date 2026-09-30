// Separate webview bundle (dist/diagrams.js): the Mermaid layout engine is loaded on demand
// the first time a closed mermaid fence renders. The extension host imports it directly.
import { renderMermaidASCII } from "beautiful-mermaid";
import { DIAGRAM_ENGINE_READY_EVENT, installDiagramEngine } from "./diagramEngineTypes";

installDiagramEngine({ renderMermaidASCII });
(globalThis as unknown as { dispatchEvent?: (event: Event) => boolean }).dispatchEvent?.(new Event(DIAGRAM_ENGINE_READY_EVENT));
