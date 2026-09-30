import { onMissingDiagramEngine } from "./diagrams";
import { DIAGRAM_ENGINE_READY_EVENT } from "./diagramEngineTypes";

let engineRequested = false;

/**
 * Load dist/diagrams.js once. The chat HTML publishes its URL on #app and the page nonce
 * on the main script, which the CSP requires for every script.
 */
function requestDiagramEngine(): void {
  if (engineRequested) return;
  const source = document.getElementById("app")?.dataset.diagramScript;
  if (!source) return;
  engineRequested = true;
  const script = document.createElement("script");
  const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  if (nonce) script.nonce = nonce;
  script.src = source;
  script.onerror = () => { engineRequested = false; };
  document.head.appendChild(script);
}

onMissingDiagramEngine(requestDiagramEngine);

/** Fires once the diagram engine has loaded and pending diagrams can render. */
export function onDiagramEngineReady(listener: () => void): void {
  window.addEventListener(DIAGRAM_ENGINE_READY_EVENT, listener);
}
