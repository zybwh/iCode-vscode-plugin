import * as esbuild from "esbuild";
import { cpSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const watch = process.argv.includes("--watch");
const webview = process.argv.includes("--webview");

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
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
  outfile: "dist/webview.js",
  platform: "browser",
  format: "iife",
  sourcemap: watch,
  minify: !watch,
};

function copyThemeCss() {
  const outfile = "dist/theme.css";
  mkdirSync(dirname(outfile), { recursive: true });
  copyFileSync("src/chat/webview/styles/theme.css", outfile);
}

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
    copyThemeCss();
    copyWebviewAssets();
    console.log(`[esbuild] watching ${webview ? "webview" : "extension"}...`);
  } else {
    await esbuild.build(config);
    copyThemeCss();
    copyWebviewAssets();
    console.log(`[esbuild] ${webview ? "webview" : "extension"} build complete`);
  }
}

build().catch(() => process.exit(1));
