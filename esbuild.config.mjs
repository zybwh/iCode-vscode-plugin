import * as esbuild from "esbuild";
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const watch = process.argv.includes("--watch");
const webview = process.argv.includes("--webview");

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  metafile: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  alias: { "beautiful-mermaid": "./node_modules/beautiful-mermaid/src/ascii/index.ts" },
  platform: "node",
  format: "cjs",
  sourcemap: true,
  minify: !watch,
  keepNames: true,
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  entryPoints: ["src/chat/webview/app.ts"],
  bundle: true,
  metafile: true,
  outfile: "dist/webview.js",
  platform: "browser",
  // Ship the terminal renderer only; the package root also imports the SVG/ELK engine.
  alias: { "beautiful-mermaid": "./node_modules/beautiful-mermaid/src/ascii/index.ts" },
  format: "iife",
  sourcemap: watch,
  minify: !watch,
};

async function buildThemeCss(minify) {
  const outfile = "dist/theme.css";
  const source = "src/chat/webview/styles/theme.css";
  mkdirSync(dirname(outfile), { recursive: true });
  if (!minify) {
    copyFileSync(source, outfile);
    return;
  }
  // Minify and merge duplicate rules; the webview CSP forbids inline styles anyway.
  const result = await esbuild.transform(readFileSync(source, "utf8"), { loader: "css", minify: true, target: "chrome120" });
  writeFileSync(outfile, result.code);
}

/** The Mermaid layout engine ships as its own bundle, loaded when a diagram first renders. */
const diagramConfig = {
  ...webviewConfig,
  entryPoints: ["src/chat/webview/diagramEngine.ts"],
  outfile: "dist/diagrams.js",
};

function copyWebviewAssets() {
  const source = "src/chat/webview/assets";
  if (!existsSync(source)) return;
  cpSync(source, "dist/assets", { recursive: true });
}

async function build() {
  const config = webview ? webviewConfig : extensionConfig;

  if (watch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    if (webview) await (await esbuild.context(diagramConfig)).watch();
    await buildThemeCss(false);
    copyWebviewAssets();
    console.log(`[esbuild] watching ${webview ? "webview" : "extension"}...`);
  } else {
    const result = await esbuild.build(config);
    writeFileSync(`${config.outfile}.meta.json`, JSON.stringify(result.metafile));
    if (webview) {
      const diagrams = await esbuild.build(diagramConfig);
      writeFileSync(`${diagramConfig.outfile}.meta.json`, JSON.stringify(diagrams.metafile));
    }
    await buildThemeCss(true);
    copyWebviewAssets();
    console.log(`[esbuild] ${webview ? "webview" : "extension"} build complete`);
  }
}

build().catch(() => process.exit(1));
