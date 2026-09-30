import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const extensionRoot = path.resolve(__dirname, "..", "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8")) as {
  version: string;
  activationEvents?: string[];
  extensionKind?: string[];
  capabilities?: {
    untrustedWorkspaces?: { supported?: boolean };
    virtualWorkspaces?: boolean;
  };
  contributes: {
    commands: Array<{ command: string }>;
    configuration: { properties: Record<string, unknown> };
    menus?: Record<string, Array<{ command: string; when?: string; group?: string }>>;
  };
  scripts: Record<string, string>;
};

function readSource(...segments: string[]): string {
  return fs.readFileSync(path.join(extensionRoot, ...segments), "utf8").replace(/\r\n/g, "\n");
}

/** src/ui/dialogs.ts is a barrel over src/ui/dialogs/*.ts; policy checks cover the whole family. */
function readDialogsSource(): string {
  const directory = path.join(extensionRoot, "src", "ui", "dialogs");
  return [
    readSource("src", "ui", "dialogs.ts"),
    ...fs.readdirSync(directory).filter((name) => name.endsWith(".ts")).sort().map((name) => readSource("src", "ui", "dialogs", name)),
  ].join("\n");
}

type WebpAnimationFrame = {
  duration: number;
  payloadSignature: string;
};

function webpAnimationFrames(assetName: string): WebpAnimationFrame[] {
  const buffer = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "assets", "companions", assetName));
  const frames: WebpAnimationFrame[] = [];
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (chunkType === "ANMF") {
      frames.push({
        duration: readUInt24LE(buffer, dataStart + 12),
        payloadSignature: buffer.subarray(dataStart + 16, dataEnd).toString("base64"),
      });
    }
    offset = dataEnd + (chunkSize % 2);
  }
  return frames;
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function collectNlsKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const match = /^%(.+)%$/.exec(value);
    if (match) keys.add(match[1]);
    return keys;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNlsKeys(item, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectNlsKeys(item, keys);
  }
  return keys;
}

describe("VSIX release manifest", () => {
  it("keeps TUI parity surfaces on supported contracts with explicit context", () => {
    expect(readSource("src/ui/changes.ts")).toContain("signature(await manager.mutations())");
    expect(readSource("src/changes/view.ts")).toContain("split-preview");
    expect(readSource("src/handlers/actions.ts")).not.toContain("collectEditorContext");
    expect(readSource("src/state/runtime.ts")).toContain("additionalDirectories");
    expect(readSource(".github/workflows/ci.yml")).toContain("sha256sum --check");
    for(const document of ["README.md","DESIGN_DECISIONS.md","RELEASE_CHECKLIST.md"]){
      expect(readSource(document)).toContain("/roots");
      expect(readSource(document)).toContain("/rollback to ");
    }
  });
  it("keeps trajectory analysis on the public export contract and preserves usage scope", () => {
    expect(readSource("src/ui/trajectory.ts")).toContain('["trajectory", "export"');
    expect(readSource("src/ui/trajectory.ts")).toContain("enableScripts: true");
    expect(readSource("src/trajectory/report.ts")).toContain("Where time went");
    expect(readSource("src/trajectory/report.ts")).not.toContain("<table");
    expect(readSource("src/ui/trajectory.ts")).not.toContain('"--include-sensitive"');
    expect(readSource("src/acp/client.ts")).not.toContain("_trajectory/");
    expect(readSource("DESIGN_DECISIONS.md")).toContain("Never fall back between these scopes");
    expect(readSource("README.md")).toContain("/usage");
  });
  it("keeps workflow execution on the supported CLI contract with explicit approval disclosure", () => {
    expect(readSource("src/workflow/cli.ts")).toContain('["workflow", "run"');
    expect(readSource("src/ui/workflows.ts")).toContain("BYPASS");
    expect(readSource("src/ui/workflows.ts")).toContain("modal: true");
    expect(readSource("README.md")).toContain("/workflow");
    expect(readSource("src/acp/client.ts")).not.toContain("_workflow/");
  });
  it("keeps diagram presentation terminal-native without shipping the SVG engine", () => {
    expect(readSource("DESIGN_DECISIONS.md")).toContain("automatic rendering only after a fence closes");
    expect(readSource("esbuild.config.mjs")).toContain("beautiful-mermaid/src/ascii/index.ts");
    expect(readSource("src/chat/webview/styles/theme.css")).not.toContain(".diagram-preview");
  });
  it("ships an honest product capability plan for workflow and trajectory gaps", () => {
    expect(readSource("README.md")).toContain("[capability plan](./FEATURE_PARITY.md)");
    expect(readSource("FEATURE_PARITY.md")).toContain("Workflow / 工作流");
    expect(readSource("FEATURE_PARITY.md")).toContain("Trajectory / 执行轨迹");
    expect(readSource("DESIGN_DECISIONS.md")).toContain("missing product surfaces");
    expect(readSource("scripts", "pack.py")).toContain("extension/FEATURE_PARITY.md");
  });
  it("keeps standalone VSIX agent guidance in the subproject", () => {
    const agentsPath = path.join(extensionRoot, "AGENTS.md");
    const agents = fs.readFileSync(agentsPath, "utf8");

    expect(fs.existsSync(agentsPath)).toBe(true);
    expect(agents).toContain("standalone iCode VS Code / openUBMC Studio extension");
    expect(agents).toContain("Do not patch the iCode backend for VSIX polish");
    expect(agents).toContain("Do not add explicit `activationEvents`");
    expect(agents).toContain("Do not rely on unsupported private ACP hooks");
    expect(agents).toContain("src/chrys/app/acp/server.py");
    expect(agents).not.toContain("src/chrys/acp/server.py");
    expect(agents).toContain("README.md");
    expect(agents).toContain("DESIGN_DECISIONS.md");
    expect(agents).toContain("RELEASE_CHECKLIST.md");
  });

  it("lets contributed commands and views generate activation events automatically", () => {
    expect(packageJson.activationEvents).toBeUndefined();
  });

  it("does not expose removed binary download or workspace path settings", () => {
    const settings = Object.keys(packageJson.contributes.configuration.properties);

    expect(settings).not.toContain("chrys.binary.autoUpdate");
    expect(settings).not.toContain("chrys.binary.updateChannel");
    expect(settings).not.toContain("chrys.workspace.path");
  });

  it("does not keep scripts that build or download a iCode binary inside the VSIX package", () => {
    expect(packageJson.scripts).not.toHaveProperty("build:binary");
    expect(packageJson.scripts).not.toHaveProperty("package:bundle");
    expect(packageJson.scripts).not.toHaveProperty("package:full");
    expect(packageJson.scripts.package).toBe("npm run build && uv run python scripts/pack.py");
    expect(packageJson.scripts.deploy).toBe("npm run package && '/Applications/openUBMC Studio.app/Contents/Resources/app/bin/studio' --install-extension icode-vscode-plugin-$npm_package_version.vsix --force && echo 'Deployed OK，重启 Studio 窗口生效'");
  });

  it("contributes release-critical commands", () => {
    const commands = new Set(packageJson.contributes.commands.map((entry) => entry.command));

    expect(commands).toContain("chrys.focusChat");
    expect(commands).toContain("chrys.newSession");
    expect(commands).toContain("chrys.listSessions");
    expect(commands).toContain("chrys.manageAgents");
    expect(commands).toContain("chrys.manageModels");
    expect(commands).toContain("chrys.showStructuredHistory");
    expect(commands).toContain("chrys.showLogs");
    expect(commands).toContain("chrys.pickTheme");
    expect(commands).toContain("chrys.pickLanguage");
    expect(commands).toContain("chrys.showNotifications");
    expect(commands).toContain("chrys.diagnostics");
    expect(commands).toContain("chrys.copySupportBundle");
    expect(commands).toContain("chrys.doctor");
    expect(commands).toContain("chrys.openSessionJsonFromTree");
    expect(commands).toContain("chrys.copySessionJsonPathFromTree");
    expect(commands).toContain("chrys.copySessionIdFromTree");
    expect(commands).toContain("chrys.copySessionSummaryFromTree");
  });

  it("moves non-composer TUI footer capabilities to iCode TreeView entries and title menu", () => {
    const viewTitle = packageJson.contributes.menus?.["view/title"] ?? [];
    const sessionTreeSource = fs.readFileSync(path.join(extensionRoot, "src", "views", "sessionTree.ts"), "utf8");
    const chrysViewCommands = new Map(
      viewTitle
        .filter((entry) => entry.when === "view == chrys-sessions")
        .map((entry) => [entry.command, entry.group ?? ""]),
    );

    expect(chrysViewCommands.get("chrys.focusChat")).toContain("navigation");
    expect(chrysViewCommands.get("chrys.newSession")).toContain("navigation");
    expect(chrysViewCommands.get("chrys.refreshSessionTree")).toContain("navigation");
    expect(chrysViewCommands.get("chrys.manageAgents")).toContain("chrys");
    expect(chrysViewCommands.get("chrys.manageModels")).toContain("chrys");
    expect(chrysViewCommands.get("chrys.showLogs")).toContain("chrys");
    expect(chrysViewCommands.get("chrys.pickTheme")).toContain("chrys");
    expect(chrysViewCommands.get("chrys.showNotifications")).toContain("chrys");
    expect(chrysViewCommands.get("chrys.showStructuredHistory")).toContain("chrys");
    expect(chrysViewCommands.get("chrys.doctor")).toContain("chrys");
    expect(chrysViewCommands.get("chrys.diagnostics")).toContain("chrys");
    expect(chrysViewCommands.get("chrys.copySupportBundle")).toContain("chrys");
    expect(sessionTreeSource).toContain("TREE_ACTIONS");
    expect(sessionTreeSource).toContain("iCode Actions");
    expect(sessionTreeSource).toContain("chrys.manageAgents");
    expect(sessionTreeSource).toContain("chrys.showLogs");
    expect(sessionTreeSource).toContain("chrys.pickTheme");
    expect(sessionTreeSource).toContain("chrys.pickLanguage");
    expect(sessionTreeSource).toContain("chrys.showNotifications");
    expect(sessionTreeSource).toContain("chrys.showStructuredHistory");
  });

  it("ships Apache-2.0 licensing with preserved original notices and bilingual repository links", () => {
    const lock = JSON.parse(readSource("package-lock.json"));
    expect(packageJson.license).toBe("Apache-2.0");
    expect(lock.packages[""].license).toBe("Apache-2.0");
    expect(readSource("LICENSE")).toContain("Version 2.0, January 2004");
    expect(readSource("NOTICE")).toContain("Copyright (c) 2026 Jiaqi (0x7c13) Liu");
    expect(readSource("NOTICE")).toContain("Permission is hereby granted, free of charge");
    expect(readSource("scripts", "pack.py")).toContain("validate_frontend_licenses(ext_dir)");
    const readme = readSource("README.md");
    expect(readme).toContain("## English");
    expect(readme).toContain("## 中文说明");
    expect(readme).toContain("https://github.com/zybwh/iCode-vscode-plugin");
    expect(readme).toContain("https://github.com/openJiuwen-ai/iCode");
    expect(readme).toContain("## License / 许可证");
    expect(readme).not.toContain("https://github.com/0x7c13/chrys");
  });

  it("keeps bundled dependency licenses complete and unused signing tools out", () => {
    const lock = JSON.parse(readSource("package-lock.json"));
    expect(Object.keys(lock.packages).some(name => name.includes("@vscode/vsce"))).toBe(false);
    const components = JSON.parse(readSource("licenses", "components.json")) as Array<{name: string; version: string; file: string; packagePath?: string; upstreamFiles?: string[]}>;
    for (const component of components) {
      const packagePath = component.packagePath || `node_modules/${component.name}`;
      expect(lock.packages[packagePath].version).toBe(component.version);
      const originals = component.upstreamFiles || [component.name === "marked" ? "LICENSE.md" : "LICENSE"];
      expect(readSource(component.file)).toBe(originals.map(file => readSource(packagePath, file)).join("\n\n"));
    }
    const provenance = readSource("ASSET_PROVENANCE.md");
    const assets = fs.readdirSync(path.join(extensionRoot, "src/chat/webview/assets/companions"));
    for (const asset of assets.filter(name => name.endsWith(".webp"))) expect(provenance).toContain(asset);
  });

  it("ships marketplace-facing metadata assets", () => {
    const readme = fs.readFileSync(path.join(extensionRoot, "README.md"), "utf8");

    expect(fs.existsSync(path.join(extensionRoot, "README.md"))).toBe(true);
    expect(fs.existsSync(path.join(extensionRoot, "LICENSE"))).toBe(true);
    expect(fs.existsSync(path.join(extensionRoot, "resources", "icon.png"))).toBe(true);
    expect(fs.existsSync(path.join(extensionRoot, "resources", "chrys.svg"))).toBe(true);
    expect(readme).toContain("frontend for the iCode coding agent");
    expect(readme).toContain("universal VSIX");
    expect(readme).toContain("platform VSIX");
    expect(readme).toContain("Downloads require an explicit user action");
    expect(readme).toContain("legacy raw-binary packages use `extension/bin/chrys` or `extension/bin/chrys.exe`");
    expect(readme).toContain("## VSIX and TUI parity");
    expect(readme).toContain("Terminal mode opens the VS Code integrated terminal");
    expect(readme).toContain("Companion is a VSIX-owned workflow pet");
    expect(readme).toContain("real iCode-usage growth levels");
    expect(readme).toContain("quiet local animated WebP Buddy tab");
    expect(readme).toContain("/companion collection");
    expect(readme).toContain("pet/mute/rename/info interactions");
    expect(readme).toContain("direct-address short responses");
    expect(readme).toContain("never calls private backend Buddy APIs or depends on iCode hook configuration");
    expect(readme).toContain("[VSIX Design Decisions](./DESIGN_DECISIONS.md)");
    expect(readme).toContain("[VSIX Release Checklist](./RELEASE_CHECKLIST.md)");
    expect(readme).toContain("## 中文说明");
    expect(readme).toContain("平台 VSIX 内置");
    expect(readme).toContain("下载必须由用户主动触发");
    expect(readme).toContain("全角 `／`、`＠`、`＃`、`！`");
    expect(readme).toContain("VSIX 不复刻 TUI 的 F-key/footer 快捷按钮");
    expect(readme).toContain("VSIX 终端模式会打开 VS Code 集成终端");
    expect(readme).toContain("复制支持快照");
  });

  it("keeps the VSIX release checklist focused on the accepted ship gates", () => {
    const checklist = fs.readFileSync(path.join(extensionRoot, "RELEASE_CHECKLIST.md"), "utf8");

    expect(checklist).toContain("# VSIX Release Checklist");
    expect(checklist).toContain("Only validate and fix the VSIX frontend in this repository.");
    expect(checklist).toContain("Do not modify the iCode backend for VSIX release polish.");
    expect(checklist).toContain("ACP protocol gaps that do not block normal coding-agent workflows are not release blockers.");
    expect(checklist).toContain("[VSIX Design Decisions](./DESIGN_DECISIONS.md)");
    expect(checklist).toContain("npm run lint");
    expect(checklist).toContain("npm test");
    expect(checklist).toContain("npm run build");
    expect(checklist).toContain("npm run package");
    expect(checklist).toContain("npm run package -- --target linux-x64 --binary /path/to/chrys");
    expect(checklist).toContain("Universal VSIX packages must not include `extension/bin/`");
    expect(checklist).toContain("TargetPlatform");
    expect(checklist).toContain("Composer hints and typed triggers both work");
    expect(checklist).toContain("TUI F-key/footer shortcut buttons are intentionally absent");
    expect(checklist).toContain("Approval requests show localized labels");
    expect(checklist).toContain("Ask-user requests support one-to-five-question batches");
    expect(checklist).toContain("Support bundle redacts secrets");
    expect(checklist).toContain("`chrys.ui.language=zh-CN` localizes");
    expect(checklist).toContain("Companion animated WebP assets load");
    expect(checklist).toContain("the Buddy tab keeps management in a compact options menu");
    expect(checklist).toContain("/companion collection");
    expect(checklist).toContain("pet/mute/rename/info/direct-address interactions work through local commands");
    expect(checklist).toContain("levels grow only from real iCode usage/time");
    expect(checklist).toContain("A VSIX release candidate is acceptable when:");
  });

  it("keeps the VSIX/TUI design decision table as the source of accepted differences", () => {
    const decisionsPath = path.join(extensionRoot, "DESIGN_DECISIONS.md");
    const decisions = fs.readFileSync(decisionsPath, "utf8");

    expect(fs.existsSync(decisionsPath)).toBe(true);
    expect(decisions).toContain("# VSIX Design Decisions");
    expect(decisions).toContain("Opening iCode renders the panel immediately");
    expect(decisions).toContain("The extension host retains the current transcript in memory");
    expect(readSource("RELEASE_CHECKLIST.md")).toContain("Close and reopen chat during a streaming response");
    expect(decisions).toContain("Doctor treats no active session as normal idle");
    expect(decisions).toContain("Changing approval mode with no active session updates the VSIX default only");
    expect(decisions).toContain("Resolve explicit `chrys.binary.path`");
    expect(decisions).toContain("light universal package");
    expect(decisions).toContain("platform package carrying a release-built PyApp runtime");
    expect(decisions).toContain("This repository owns the VSIX frontend release surface only");
    expect(decisions).toContain("Use VS Code/webview context actions");
    expect(decisions).toContain("Support coherent VSIX themes");
    expect(decisions).toContain("Keep the chat webview as a TUI-inspired bordered cockpit");
    expect(decisions).toContain("Avoid reverting to generic rounded web cards");
    expect(decisions).toContain("Do not render or bind TUI F-key/footer shortcut buttons");
    expect(decisions).toContain("Keep the composer hint buttons and typed triggers");
    expect(decisions).toContain("Companion is VSIX-owned");
    expect(decisions).toContain("iCode-usage growth levels");
    expect(decisions).toContain("pet/mute/rename/info/direct-address interactions");
    expect(decisions).toContain("The redesigned Buddy tab centers the pixel companion");
    expect(decisions).toContain("compact options menu backed by the existing local commands");
    expect(decisions).toContain("Do not call unsupported Buddy ACP methods");
    expect(decisions).toContain("depend on iCode hook configuration");
  });

  it("declares workspace-only execution boundaries", () => {
    expect(packageJson.extensionKind).toEqual(["workspace"]);
    expect(packageJson.capabilities?.untrustedWorkspaces?.supported).toBe(false);
    expect(packageJson.capabilities?.virtualWorkspaces).toBe(false);
  });

  it("exposes the quick-differentiator UI language setting", () => {
    const properties = packageJson.contributes.configuration.properties as Record<string, {
      enum?: string[];
      enumDescriptions?: string[];
    }>;

    expect(properties).toHaveProperty("chrys.ui.language");
    expect(properties).toHaveProperty("chrys.ui.theme");
    expect(properties["chrys.approval.mode"].enumDescriptions).toHaveLength(properties["chrys.approval.mode"].enum?.length);
    expect(properties["chrys.ui.language"].enumDescriptions).toHaveLength(properties["chrys.ui.language"].enum?.length);
    expect(properties["chrys.ui.theme"].enumDescriptions).toHaveLength(properties["chrys.ui.theme"].enum?.length);
  });

  it("localizes package contribution strings for English and Chinese VS Code surfaces", () => {
    const english = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.nls.json"), "utf8")) as Record<string, string>;
    const chinese = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.nls.zh-cn.json"), "utf8")) as Record<string, string>;

    for (const key of collectNlsKeys(packageJson)) {
      expect(english, key).toHaveProperty(key);
      expect(chinese, key).toHaveProperty(key);
      expect(english[key], key).toBeTruthy();
      expect(chinese[key], key).toBeTruthy();
    }
    expect(english["extension.description"]).toContain("VS Code frontend for iCode");
    expect(english["extension.description"]).toContain("bundled platform iCode CLI");
    expect(english["viewsWelcome.sessions.contents"]).toContain("bundled runtime in a platform VSIX");
    expect(english["viewsWelcome.sessions.contents"]).toContain("chrys.binary.path");
    expect(chinese["extension.description"]).toContain("iCode 的 VS Code 前端");
    expect(chinese["extension.description"]).toContain("平台 VSIX 内置的 iCode CLI");
    expect(chinese["viewsWelcome.sessions.contents"]).toContain("平台 VSIX 内置运行时");
    expect(chinese["viewsWelcome.sessions.contents"]).toContain("chrys.binary.path");
    expect(chinese["configuration.ui.language.zh-cn.description"]).toContain("简体中文");
    expect(chinese["configuration.ui.theme.chrys.description"]).toContain("TUI 输入框");
    expect(chinese["configuration.approval.mode.auto.description"]).toContain("审批判断");
  });

  it("packages nls files and resolves marketplace metadata placeholders", () => {
    const packScript = fs.readFileSync(path.join(extensionRoot, "scripts", "pack.py"), "utf8");
    const esbuildConfig = fs.readFileSync(path.join(extensionRoot, "esbuild.config.mjs"), "utf8");

    expect(packScript).toContain("package.nls*.json");
    expect(packScript).toContain("VALID_TARGETS");
    expect(packScript).toContain("TargetPlatform");
    expect(packScript).toContain("extension/bin/{binary_name}");
    expect(packScript).toContain("--binary and --runtime are mutually exclusive");
    expect(packScript).toContain("extension/runtime/{runtime_launcher}");
    expect(packScript).toContain("zip_write_directory");
    expect(packScript).toContain("resolve_nls(pkg.get(\"description\"");
    expect(packScript).toContain("RELEASE_CHECKLIST.md");
    expect(packScript).toContain("DESIGN_DECISIONS.md");
    expect(packScript).toContain("extension/dist/assets");
    expect(esbuildConfig).toContain("copyWebviewAssets");
    expect(esbuildConfig).toContain("src/chat/webview/assets");
    expect(packageJson.scripts["assets:clean-companion-fringe"]).toBe("node scripts/clean_companion_fringe.mjs");
    expect(fs.existsSync(path.join(extensionRoot, "scripts", "clean_companion_fringe.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(extensionRoot, "src", "chat", "webview", "assets", "companions", "baize-gba-idle.webp"))).toBe(true);
    expect(fs.existsSync(path.join(extensionRoot, "src", "chat", "webview", "assets", "companions", "baize-gba-tail.webp"))).toBe(true);
    expect(fs.existsSync(path.join(extensionRoot, "src", "chat", "webview", "assets", "companions", "baize-gba-rest.webp"))).toBe(true);
    for (const companion of [
      "bifang",
      "qingniao",
      "xuangui",
      "chenghuang",
      "lushu",
      "eshou",
      "zhulong",
      "jiuweihu",
      "yinglong",
      "kui",
      "xingxing",
      "zhuyan",
      "wenyaoyu",
      "chongmingniao",
      "dangkang",
      "feilian",
      "jumang",
      "jiutianxuannv",
      "hebo",
    ]) {
      expect(fs.existsSync(path.join(extensionRoot, "src", "chat", "webview", "assets", "companions", `${companion}-gba-idle.webp`))).toBe(true);
      expect(fs.existsSync(path.join(extensionRoot, "src", "chat", "webview", "assets", "companions", `${companion}-gba-tail.webp`))).toBe(true);
      expect(fs.existsSync(path.join(extensionRoot, "src", "chat", "webview", "assets", "companions", `${companion}-gba-rest.webp`))).toBe(true);
      expect(fs.existsSync(path.join(extensionRoot, "src", "chat", "webview", "assets", "companions", `${companion}-gba-thumb.webp`))).toBe(true);
    }
    expect(packScript).toContain("image/png");
    expect(packScript).toContain("image/webp");
    expect(packScript).toContain("image/svg+xml");
    expect(packScript).toContain("text/markdown");
    expect(packScript).toContain("resources_dir.rglob");
  });

  it("ships final Companion animations with anchored 400ms frame timing", () => {
    const idle = webpAnimationFrames("baize-gba-idle.webp");
    const tail = webpAnimationFrames("baize-gba-tail.webp");
    const rest = webpAnimationFrames("baize-gba-rest.webp");

    expect(idle.map((frame) => frame.duration)).toEqual([400, 400, 400, 400, 400]);
    expect(tail.map((frame) => frame.duration)).toEqual([400, 400, 400, 400, 400]);
    expect(rest.map((frame) => frame.duration)).toEqual([400, 400, 400, 400, 400]);

    expect([idle[0].payloadSignature, idle[2].payloadSignature, idle[4].payloadSignature])
      .toEqual([idle[0].payloadSignature, idle[0].payloadSignature, idle[0].payloadSignature]);
    expect([tail[0].payloadSignature, tail[2].payloadSignature, tail[4].payloadSignature])
      .toEqual([tail[0].payloadSignature, tail[0].payloadSignature, tail[0].payloadSignature]);
    expect([rest[0].payloadSignature, rest[2].payloadSignature, rest[4].payloadSignature])
      .toEqual([tail[1].payloadSignature, tail[1].payloadSignature, tail[1].payloadSignature]);

    expect(new Set([idle[1].payloadSignature, idle[3].payloadSignature]).size).toBe(2);
    expect(new Set([tail[1].payloadSignature, tail[3].payloadSignature]).size).toBe(2);
    expect(rest[3].payloadSignature).toBe(tail[3].payloadSignature);
    expect(rest.map((frame) => frame.payloadSignature)).not.toContain(idle[3].payloadSignature);
  });

  it("resolves configured, bundled, managed, then PATH runtimes", () => {
    const source = readSource("src/extension.ts");
    const resolver = readSource("src/runtime/resolve.ts");
    expect(source).toContain("resolveRuntime(");
    expect(source).toContain("managedRuntime(context.globalStorageUri.fsPath)");
    expect(resolver.replace(/\s/g, "")).toContain('["configured","bundled","managed","path"]');
    expect(source).not.toContain("invalidatePyappCacheIfBinaryChanged");
    expect(packageJson.contributes.commands.some(c => c.command === "chrys.installRuntime")).toBe(true);
    const installer = readSource("src/runtime/install.ts");
    expect(installer.replace(/\s/g, "")).toContain("verifyArchive(archive,expected,signal)");
    expect(installer.replace(/\s/g, "")).toContain("awaitio.validate(launcher,signal)");
  });

  it("builds one universal VSIX and five platform VSIX packages in CD", () => {
    const workflow = fs
      .readFileSync(path.join(extensionRoot, ".github", "workflows", "cd.yml"), "utf8")
      .replace(/\r\n/g, "\n");

    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).not.toContain("push:\n    tags:");
    expect(workflow).toContain("vsix_release_tag");
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("--repo openJiuwen-ai/iCode");
    expect(workflow).toContain("- name: Download iCode release binary\n        shell: bash");
    expect(workflow).toContain("build-vsix-universal");
    expect(workflow).toContain("build-vsix-platform");
    expect(workflow).toContain("icode-vscode-plugin-universal");
    expect(workflow).toContain("icode-vscode-plugin-${{ matrix.vsix_target }}");
    expect(workflow).toContain('"runner":"ubuntu-latest"');
    expect(workflow).toContain('"runner":"ubuntu-24.04-arm"');
    expect(workflow).toContain('"runner":"macos-14"');
    expect(workflow).toContain('"runner":"macos-15-intel"');
    expect(workflow).toContain('"runner":"windows-latest"');
    for (const target of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]) {
      expect(workflow).toContain(`"vsix_target":"${target}"`);
    }
    expect(workflow).toContain("runs-on: ${{ matrix.runner }}");
    expect(workflow).toContain("Prepare standalone iCode runtime");
    expect(workflow).toContain("scripts/prepare_runtime.py");
    expect(workflow).toContain("Smoke bundled iCode runtime");
    expect(workflow).toContain("- name: Smoke bundled iCode runtime\n        shell: bash");
    expect(workflow).toContain("const path = require(\"node:path\")");
    expect(workflow).toContain("const launcherPath = path.resolve(launcher)");
    expect(workflow).toContain("spawn(launcherPath, [\"--version\"]");
    expect(workflow).toContain("shell: isCmd");
    expect(workflow).toContain("Prepared VSIX runtimes must run without first-run dependency installation.");
    expect(workflow).toContain("npm run package -- --target ${{ matrix.vsix_target }} --runtime");
    expect(workflow).toContain("cp artifacts/icode-vscode-plugin-universal/*.vsix release/");
    expect(workflow).toContain("for artifact_dir in artifacts/icode-vscode-plugin-*");
    expect(workflow).toContain("icode-vscode-plugin-universal|icode-vscode-plugin-linux|icode-vscode-plugin-macos|icode-vscode-plugin-windows");
    expect(workflow).toContain("tag_name: ${{ inputs.vsix_release_tag }}");
  });

  it("prepares PyApp runtimes across platform-specific data directories", () => {
    const prepareScript = fs.readFileSync(path.join(extensionRoot, "scripts", "prepare_runtime.py"), "utf8");

    expect(prepareScript).toContain('env["PYAPP_INSTALL_DIR_CHRYS"]');
    expect(prepareScript).toContain('home / "pyapp-install"');
    expect(prepareScript).toContain('home / "data" / "pyapp" / "chrys"');
    expect(prepareScript).toContain('home / "Library" / "Application Support" / "pyapp" / "chrys"');
    expect(prepareScript).toContain('home / "localappdata" / "pyapp" / "chrys"');
    expect(prepareScript).toContain("def tree_preview");
    expect(prepareScript).toContain("temporary HOME contents");
    expect(prepareScript).toContain("candidates = [root, *root.rglob(\"*\")]");
    expect(prepareScript).toContain('launcher.parent / "python" / "python.exe"');
    expect(prepareScript).toContain('"-m", "chrys.app.cli.app", "--version"');
    expect(prepareScript).toContain('-m chrys.app.cli.app \\"$@\\"');
    expect(prepareScript).not.toContain("chrys.cli.app");
  });

  it("times out ACP initialization failures instead of hanging the frontend", () => {
    const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const protocolSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "protocol.ts"), "utf8");
    const processSource = fs.readFileSync(path.join(extensionRoot, "src", "process", "manager.ts"), "utf8");

    expect(source).toContain("ACP_INITIALIZE_TIMEOUT_MS");
    expect(source).toContain("handleAcpInitializeFailure");
    expect(source).toContain("withTimeout(");
    expect(source).toContain("If this is a bundled platform VSIX");
    expect(source).toContain("initialize did not respond within");
    expect(source).toContain("Recent iCode startup output");
    expect(source).toContain("manager.on(\"stdout\"");
    expect(protocolSource).toContain("onNonJsonLine");
    expect(processSource).toContain("recentOutput");
    expect(processSource).toContain("_rememberOutput(\"stdout\"");
    expect(processSource).toContain("isWindowsCommandScript");
    expect(processSource).toContain("cmd.exe");
  });

  it("keeps iCode v0.22.5 ACP extension route compatibility explicit", () => {
    const clientSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "client.ts"), "utf8");
    const typesSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "types.ts"), "utf8");

    expect(clientSource).toContain('this.acp.request("_chrys/session_runtime"');
    expect(clientSource).toContain('case "_chrys/runtime_update":');
    expect(clientSource).toContain("normalizeRuntimeUpdate(params)");
    expect(clientSource).not.toContain('this.acp.request("chrys/session_runtime"');
    expect(typesSource).toContain("export interface RuntimeUpdateNotification");
    expect(typesSource).toContain("export type CompactionNotification");
  });

  it("handles iCode v0.22.5 plan and session title updates", () => {
    const typesSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "types.ts"), "utf8");
    const sessionHandlerSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "session.ts"), "utf8");
    const runtimeSource = fs.readFileSync(path.join(extensionRoot, "src", "state", "runtime.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(typesSource).toContain('sessionUpdate: "plan"');
    expect(sessionHandlerSource).toContain('case "plan":');
    expect(sessionHandlerSource).toContain('case "session_info_update":');
    expect(runtimeSource).toContain("currentPlanEntries");
    expect(runtimeSource).toContain("currentSessionTitle");
    expect(appSource).toContain("sidebar-plan-list");
    expect(appSource).toContain("panelState.sessionTitle");
  });

  it("surfaces iCode mutation provenance and rollback details", () => {
    const typesSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "types.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    const notificationsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "notifications.ts"), "utf8");
    const provenanceSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "provenanceDisplay.ts"), "utf8");

    expect(typesSource).toContain("export type MutationProvenance");
    expect(typesSource).toContain("provenance?: MutationProvenance");
    expect(typesSource).toContain("contested?: boolean");
    expect(typesSource).toContain("rolledBackUserText?: string");
    expect(typesSource).toContain("exclusions?: RollbackExclusion[]");
    expect(readSource("src/changes/view.ts")).toContain("formatDiffRiskDetail");
    expect(notificationsSource).toContain("formatRollbackResultMessage");
    expect(notificationsSource).toContain("RollbackComposerRestored");
    expect(provenanceSource).toContain("formatMutationBadges");
  });

  it("routes iCode compaction notifications into chat state", () => {
    const clientSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "client.ts"), "utf8");
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const notificationsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "notifications.ts"), "utf8");
    const runtimeSource = fs.readFileSync(path.join(extensionRoot, "src", "state", "runtime.ts"), "utf8");
    const panelStateSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "chatPanelState.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(clientSource).toContain('case "_chrys/compaction_started":');
    expect(clientSource).toContain('case "_chrys/sub_agent_compaction_finished":');
    expect(clientSource).toContain('case "_chrys/sub_agent_compaction_committed":');
    expect(clientSource).toContain('case "_chrys/context_pressure":');
    expect(extensionSource).toContain("client.onCompaction");
    expect(notificationsSource).toContain("handleCompactionNotification");
    expect(runtimeSource).toContain("activeCompactions");
    expect(runtimeSource).toContain("committedCompactions");
    expect(panelStateSource).toContain("committedCompactionCount");
    expect(appSource).toContain("renderCompactionStatus");
    expect(appSource).toContain("Committed sub-agent compactions");
  });

  it("documents iCode v0.22.5 VSIX compatibility gates", () => {
    const designDecisions = fs.readFileSync(path.join(extensionRoot, "DESIGN_DECISIONS.md"), "utf8");
    const releaseChecklist = fs.readFileSync(path.join(extensionRoot, "RELEASE_CHECKLIST.md"), "utf8");
    const agentsMd = fs.readFileSync(path.join(extensionRoot, "AGENTS.md"), "utf8");

    expect(designDecisions).toContain("iCode ACP Extension Route Names");
    expect(designDecisions).toContain("_chrys/session_runtime");
    expect(releaseChecklist).toContain("iCode CLI Compatibility Smoke");
    expect(releaseChecklist).toContain("plan updates, session title updates, rollback provenance, usage-source identity, context pressure, compaction notifications, and batched AskUser prompts");
    expect(designDecisions).toContain("iCode `v0.22.5`");
    expect(releaseChecklist).toContain("iCode `v0.22.5`");
    expect(agentsMd).toContain("_chrys/*");
    expect(agentsMd).toContain("live stdio smoke test");
  });

  it("guards the iCode v0.22.5 AskUser, agent reset, and hosted content contracts", () => {
    const clientSource = readSource("src", "acp", "client.ts");
    const typesSource = readSource("src", "acp", "types.ts");
    const askUserSource = readSource("src", "askUser", "modal.ts");
    const sessionSource = readSource("src", "handlers", "session.ts");
    const toolCardsSource = readSource("src", "chat", "webview", "components", "toolCards.ts");
    const releaseChecklist = readSource("RELEASE_CHECKLIST.md");

    expect(clientSource).toContain('"_profiles/agents/reset"');
    expect(typesSource).toContain("questions: RequestInputQuestion[]");
    expect(typesSource).toContain("answers?: RequestInputAnswer[]");
    expect(askUserSource).toContain("completedInputResponse");
    expect(sessionSource).toContain("toolContentBlocks");
    expect(sessionSource).toContain("toolMeta: update._meta");
    expect(toolCardsSource).toContain("renderStructuredToolContent");
    expect(toolCardsSource).toContain("structuredToolContentForDisplay");
    expect(releaseChecklist).toContain("one-to-five-question batches");
    expect(releaseChecklist).toContain("dedicated ACP reset route");
  });

  it("keeps VSIX 0.0.29 release metadata aligned", () => {
    const packageLock = JSON.parse(readSource("package-lock.json")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    const versionSource = readSource("src", "common", "version.ts");
    const readme = readSource("README.md");
    const workflow = readSource(".github", "workflows", "cd.yml");

    expect(packageJson.version).toBe("0.0.29");
    expect(packageLock.version).toBe("0.0.29");
    expect(packageLock.packages[""].version).toBe("0.0.29");
    expect(versionSource).toContain('PACKAGE_VERSION = "0.0.29"');
    expect(readme).toContain("v0.0.29-icode-v0.28.0");
    expect(workflow).toMatch(/VSIX release tag to create, for example v\d+\.\d+\.\d+-icode-v\d+\.\d+\.\d+/);
  });

  it("keeps management commands visible when the ACP runtime is unavailable", () => {
    const source = fs.readFileSync(path.join(extensionRoot, "src", "ui", "management.ts"), "utf8");

    expect(source).toContain("showManagementUnavailable");
    expect(source).toContain("ManagementUnavailable");
    expect(source).toContain("chrys.doctor");
    expect(source).toContain("chrys.binary.path");
  });

  it("keeps profile editing on the full inline dialogs instead of partial management forms", () => {
    const managementPanelSource = fs.readFileSync(path.join(extensionRoot, "src", "manage", "panel.ts"), "utf8");
    const managementSource = fs.readFileSync(path.join(extensionRoot, "src", "ui", "management.ts"), "utf8");
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    const webviewDialogsSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "dialogs.ts"), "utf8");

    expect(managementPanelSource).toContain("openAgentDialog");
    expect(managementPanelSource).toContain("openModelDialog");
    expect(managementPanelSource).toContain("agentEditorHelp");
    expect(managementPanelSource).toContain("modelEditorHelp");
    expect(managementPanelSource).not.toContain("agent-instructions");
    expect(managementPanelSource).not.toContain("model-base-url");
    expect(managementSource).toContain("onOpenAgentDialog");
    expect(managementSource).toContain("onOpenModelDialog");
    expect(extensionSource).toContain("chrys.manageModels");
    expect(extensionSource).toContain("[\"chrys.manageModels\", openModelDialog]");
    expect(dialogsSource).toContain("openModelDialog(\"__new__\")");
    expect(webviewDialogsSource).toContain("dialogState.selectedModelId");
  });

  it("does not suggest unsupported stdio configs in VSIX MCP tests", () => {
    const managementSource = fs.readFileSync(path.join(extensionRoot, "src", "manage", "panel.ts"), "utf8");
    const dialogsSource = readDialogsSource();

    expect(managementSource).toContain("\"transport\": \"http\"");
    expect(managementSource).toContain("mcpHttpOnly");
    expect(dialogsSource).toContain("https://example.com/mcp");
    expect(dialogsSource).toContain("Client-supplied stdio is not run");
  });

  it("surfaces list-session failures instead of silently returning", () => {
    const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8")
      + readSource("src", "common", "sessionFormat.ts");

    expect(source).toContain("ListSessionsUnavailable");
    expect(source).toContain("ListSessionsFailed");
    expect(source).toContain("Unable to list iCode sessions");
    expect(source).toContain("sessionQuickPickItem");
    expect(source).toContain("sessionMetaLine");
    expect(source).toContain("relativeSessionTime");
    expect(source).toContain("local session.json: ${sessionJsonPath");
    expect(source).toContain("message_count");
    expect(source).toContain("ID ${shortId}");
  });

  it("surfaces unavailable new-session and select-agent command states", () => {
    const source = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");

    expect(source).toContain("showCommandUnavailable");
    expect(source).toContain("NewSessionUnavailable");
    expect(source).toContain("SelectAgentUnavailable");
    expect(source).toContain("SelectAgentBlocked");
    expect(source).toContain("iCode cannot start a new session");
    expect(source).toContain("iCode cannot switch agents");
    expect(source).toContain("cannot switch agents for a new session while the current task is running");
    expect(source).toContain("rt.sessionManager?.state && rt.sessionManager.state !== \"idle\"");
  });

  it("keeps webview commands observable and avoids silent prompt failures", () => {
    const source = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "actions.ts"), "utf8");

    expect(source).toContain("PromptUnavailable");
    expect(source).toContain("CommandRequested");
    expect(source).toContain("CommandFailed");
    expect(source).toContain("showActionUnavailable");
    expect(source).toContain("iCode runtime is not connected yet");
    expect(source).toContain("Open Doctor");
  });

  it("localizes high-frequency inline management and image capability notices", () => {
    const dialogsSource = readDialogsSource();
    const panelSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "panel.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const companionSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "companionPanel.ts"), "utf8");
    const modelDialogSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "dialogs.ts"), "utf8");
    const managementPanelSource = fs.readFileSync(path.join(extensionRoot, "src", "manage", "panel.ts"), "utf8");

    expect(dialogsSource).toContain("正在加载模型配置");
    expect(dialogsSource).toContain("模型配置已保存");
    expect(dialogsSource).toContain("ModelDialogSaveUnavailable");
    expect(dialogsSource).toContain("正在加载智能体配置");
    expect(dialogsSource).toContain("智能体配置已保存");
    expect(dialogsSource).toContain("AgentDialogSaveUnavailable");
    expect(panelSource).toContain("当前 iCode 模型配置不支持图片输入");
    expect(panelSource).toContain("data-ui-language");
    expect(panelSource).toContain("<html lang=\"${language}\">");
    expect(appSource).toContain("const initialUiLanguage = app.dataset.uiLanguage === \"zh-CN\"");
    expect(appSource).toContain("createWelcomeElement");
    expect(appSource).toContain("welcome-profile-label");
    expect(appSource).toContain("copySessionId: \"复制会话 ID\"");
    expect(appSource).toContain("changeWorkspace: \"切换工作区\"");
    expect(companionSource).toContain("Click to pet");
    expect(companionSource).toContain("点一下，摸摸它");
    expect(companionSource).toContain("onCommand(arg)");
    expect(companionSource).not.toContain("companion-actions");
    expect(companionSource).toContain("companion-collection-link");
    expect(companionSource).toContain("prefers-reduced-motion: reduce");
    expect(companionSource).toContain("experienceForLevel");
    expect(companionSource).not.toContain("Summon Companion");
    expect(companionSource).not.toContain("召唤伙伴");
    expect(companionSource).not.toContain("data-companion-preview-state");
    expect(appSource).not.toContain("setCompanionPreviewState");
    expect(appSource).toContain("pet|info|collection|summon|mute|name");
    expect(companionSource).toContain("companionRarityLabel");
    expect(companionSource).toContain("growth.level");
    expect(modelDialogSource).toContain("接口地址（Base URL）");
    expect(modelDialogSource).toContain("必须是 JSON 对象");
    expect(managementPanelSource).toContain("接口地址（Base URL）");
    expect(managementPanelSource).toContain("服务器 JSON");
    expect(managementPanelSource).toContain("HTTP MCP 服务器配置");
  });

  it("keeps mid-run prompt injection available from composer enter", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");
    const actionsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "actions.ts"), "utf8");
    const managerSource = fs.readFileSync(path.join(extensionRoot, "src", "session", "manager.ts"), "utf8");
    const clientSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "client.ts"), "utf8");
    const notificationsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "notifications.ts"), "utf8");

    expect(appSource).toContain("lockComposerForQueuedInjection();");
    expect(appSource).not.toContain("localizedRetryLabel");
    expect(appSource).not.toContain("type: \"retry\"");
    expect(actionsSource).not.toContain("handleRetry");
    expect(actionsSource).not.toContain("RetryUnsupported");
    expect(managerSource).not.toContain("async retry(text: string)");
    expect(clientSource).not.toContain("_session/retry");
    expect(clientSource).not.toContain("_chrys/retry_attempt");
    expect(notificationsSource).not.toContain("handleRetryAttempt");
    expect(themeSource).toContain(".queued-btn");
  });

  it("localizes persistent approval chrome and ask-user fallback prompts", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const dialogComponentsSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "dialogs.ts"), "utf8");
    const askUserSource = fs.readFileSync(path.join(extensionRoot, "src", "askUser", "modal.ts"), "utf8");
    const clientSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "client.ts"), "utf8");
    const notificationsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "notifications.ts"), "utf8");
    const runtimeSource = fs.readFileSync(path.join(extensionRoot, "src", "state", "runtime.ts"), "utf8");
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");

    expect(appSource).toContain("approvalMode");
    expect(appSource).toContain("审批模式");
    expect(appSource).toContain("approvalModeLabel");
    expect(appSource).toContain("手动批准");
    expect(appSource).toContain("帮我批准");
    expect(appSource).toContain("完全访问");
    expect(appSource).toContain("askuser-cancel");
    expect(appSource).toContain("agentQuestion: \"智能体提问\"");
    expect(dialogComponentsSource).toContain("data-approval-cancel");
    expect(dialogComponentsSource).toContain("type: \"approvalDialogDecision\"");
    expect(dialogComponentsSource).toContain("ApprovalDialogShown");
    expect(dialogComponentsSource).toContain("ApprovalDialogSubmitted");
    expect(dialogComponentsSource).toContain("approvalDialog.onkeydown");
    expect(dialogComponentsSource).toContain("event.key === \"Escape\"");
    expect(dialogComponentsSource).toContain("event.key === \"Enter\"");
    expect(dialogComponentsSource).toContain("primaryOptionId");
    expect(dialogComponentsSource).toContain("reason:");
    expect(dialogComponentsSource).toContain("let responded = false");
    expect(dialogComponentsSource).toContain("button.disabled = true");
    expect(dialogComponentsSource).toContain("button.dataset.approvalOptionId");
    expect(dialogComponentsSource).toContain("data-approval-option-kind");
    expect(dialogComponentsSource).toContain("ApprovalPreviewOpened");
    expect(dialogComponentsSource).toContain("source: \"dialog\" | \"cancel\" | \"keyboard\"");
    expect(dialogComponentsSource).toContain("cancel.onclick = () => respond(true, \"cancel\")");
    expect(dialogComponentsSource).toContain("multiSelect");
    expect(dialogComponentsSource).toContain("answers: cancelled ? [] : answers()");
    expect(dialogComponentsSource).toContain("showReview");
    expect(dialogComponentsSource).toContain("reviewing ? respond(false");
    expect(dialogComponentsSource).toContain("dialogText(\"Cancel\", \"取消\")");
    expect(dialogComponentsSource).toContain("textarea.disabled = false");
    expect(dialogComponentsSource).toContain("cancel.disabled = false");
    expect(dialogComponentsSource).toContain("AskUserDialogShown");
    expect(askUserSource).toContain("askUserLabels");
    expect(askUserSource).toContain("AskUserFallback");
    expect(askUserSource).toContain("result.answers.length");
    expect(askUserSource).toContain("activeAskUserRequest");
    expect(askUserSource).toContain("来自 ${callerName} 的 iCode 提问");
    expect(askUserSource).toContain("自定义回答");
    expect(fs.readFileSync(path.join(extensionRoot, "src", "approval", "modal.ts"), "utf8")).toContain("activeApprovalRequest");
    expect(fs.readFileSync(path.join(extensionRoot, "src", "approval", "modal.ts"), "utf8")).toContain("ApprovalRequestBlocked");
    expect(clientSource).not.toContain("_chrys/approval_judging_started");
    expect(clientSource).not.toContain("onApprovalJudgingStarted");
    expect(notificationsSource).not.toContain("handleApprovalJudgingStarted");
    expect(notificationsSource).toContain("ApprovalJudge");
    expect(runtimeSource).toContain("approvalJudgeReviews");
    expect(extensionSource).not.toContain("client.onApprovalJudgingStarted");
  });

  it("keeps streaming agent and thought chunks updating the rendered bubble body", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const messagesSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "messages.ts"), "utf8");
    const sessionSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "session.ts"), "utf8");

    expect(sessionSource).toContain("updateMessageTextOnly(rt.activeAgentMessageId, rt.activeAgentText)");
    expect(sessionSource).toContain("updateMessageTextOnly(rt.activeThoughtMessageId, rt.activeThoughtText)");
    expect(messagesSource).toContain("class: \"bubble-content\"");
    expect(appSource).toContain("renderMessageTextUpdate");
    expect(appSource).toContain("querySelector<HTMLElement>(\".bubble-content\")");
    expect(appSource).toContain("processThinkTags(message.text, Boolean(message.isIntermediate))");
    expect(appSource).not.toContain(".bubble-body");
  });

  it("starts a fresh final agent bubble after tool calls", () => {
    const sessionSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "session.ts"), "utf8");
    const toolStart = sessionSource.slice(sessionSource.indexOf("export function handleToolCallStart"));

    expect(toolStart).toContain("rt.activeAgentMessageId = null");
    expect(toolStart).toContain("rt.activeAgentText = \"\"");
  });

  it("sets webview aria attributes as DOM attributes", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const helpersSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "helpers.ts"), "utf8");
    const messagesSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "messages.ts"), "utf8");
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");

    expect(helpersSource).toContain("k.startsWith(\"aria-\")");
    expect(helpersSource).toContain("e.setAttribute(k, v)");
    expect(appSource).toContain("role: \"dialog\"");
    expect(appSource).toContain("\"aria-modal\": \"true\"");
    expect(themeSource).toContain("--chrys-line-soft");
    expect(themeSource).toContain(".tool-card-status");
    expect(themeSource).toContain(".input-bar:focus-within");
    expect(messagesSource).toContain("setupAgentBubbleToggle");
    expect(messagesSource).toContain("aria-expanded");
  });

  it("renders tool error explanations with UI typography instead of raw log typography", () => {
    const toolCardsSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "toolCards.ts"), "utf8");
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");

    expect(toolCardsSource).toContain("export function isToolErrorMessage");
    expect(toolCardsSource).toContain("output.trimStart().startsWith(\"Error:\")");
    expect(toolCardsSource).toContain("class: \"tool-error-message\"");
    expect(toolCardsSource).toContain("renderToolOutput(parsedOutput.preview, \"shell-output\")");
    expect(themeSource).toContain(".tool-error-message");
    expect(themeSource).toContain("font-family: var(--chrys-font);");
    expect(themeSource).toContain("border-left: 2px solid var(--chrys-error-border);");
  });

  it("uses one raw typography token for tool inputs and outputs", () => {
    const themeSource = readSource("src", "chat", "webview", "styles", "theme.css");

    expect(themeSource).toContain("--chrys-tool-raw-font-size: var(--chrys-font-size-sm);");
    expect(themeSource).toContain("--chrys-tool-raw-line-height: 1.4;");
    expect(themeSource).toContain(".tool-card-body .tool-card-input,\n.tool-card-body .tool-card-output,\n.tool-shell-command");
    expect(themeSource).toContain("font-size: var(--chrys-tool-raw-font-size);");
    expect(themeSource).toContain("line-height: var(--chrys-tool-raw-line-height);");
    expect(themeSource).not.toContain("--chrys-tool-input-font-size");
    expect(themeSource).not.toContain("--chrys-tool-output-font-size");
    expect(themeSource).not.toContain("--chrys-emoji-font");
    expect(themeSource).not.toContain("font-family: var(--chrys-font-mono),");
    expect(themeSource).not.toContain("font-family: var(--chrys-font),");
    expect(themeSource).not.toContain("Menlo");
    expect(themeSource).not.toContain("Cascadia");
    expect(themeSource).not.toContain("Consolas");
  });

  it("keeps user turn numbers in the sidebar instead of the main chat bubble", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const messagesSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "messages.ts"), "utf8");
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");
    const decisionsSource = fs.readFileSync(path.join(extensionRoot, "DESIGN_DECISIONS.md"), "utf8");

    expect(appSource).toContain("msg.turnNumber = ++userTurnCount");
    expect(appSource).toContain("filter((message) => !message.isInjection)");
    expect(appSource).toContain("return renderSidebarMessage(message, visibleTurnNumber)");
    expect(appSource).toContain("class: \"sidebar-message-prefix\"");
    expect(appSource).toContain("message.isInjection ? \"└─\"");
    expect(messagesSource).not.toContain("user-turn-prefix");
    expect(messagesSource).not.toContain("`${msg.turnNumber}.`");
    expect(messagesSource).toContain("user-message-text");
    expect(appSource).toContain("querySelector<HTMLElement>(\".user-message-text\")");
    expect(appSource).toContain("return `[${role}]\\n${message.text}`");
    expect(themeSource).toContain(".sidebar-message-prefix");
    expect(themeSource).toContain("grid-template-columns: 3.2ch minmax(0, 1fr)");
    expect(themeSource).toContain("white-space: pre-wrap");
    expect(decisionsSource).toContain("Keep turn numbers in the VSIX sidebar message list only");
    expect(decisionsSource).toContain("Do not render turn numbers in the main chat transcript");
    expect(decisionsSource).toContain("Mid-run injected user messages are not numbered");
    expect(decisionsSource).toContain("in the same prefix column as the turn number");
  });

  it("shows localized slash argument labels while preserving command values", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(appSource).toContain("localizedArgLabel");
    expect(appSource).toContain("localizedArgDescription");
    expect(appSource).toContain("const displayName = slashDisplayName(exact)");
    expect(appSource).toContain("commandText: `/${displayName} ${suggestion.value}`");
    expect(appSource).toContain("手动批准");
    expect(appSource).toContain("帮我批准");
    expect(appSource).toContain("完全访问");
    expect(appSource).toContain("${localizedArgLabel(suggestion)} (${suggestion.value})");
  });

  it("exposes a shareable support bundle for long-term VSIX/TUI mismatch debugging", () => {
    const dialogsSource = readDialogsSource();
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const actionsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "actions.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const panelSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "panel.ts"), "utf8");
    const toolRenderingSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "toolRendering.ts"), "utf8");

    expect(dialogsSource).toContain("copySupportBundle");
    expect(dialogsSource).toContain("SupportBundleCopied");
    expect(dialogsSource).toContain("VSIX / TUI Mismatch Checklist");
    expect(dialogsSource).toContain("currentSessionJsonPath");
    expect(dialogsSource).toContain("- local session.json:");
    expect(dialogsSource).toContain("activeBlockingPromptDetail");
    expect(dialogsSource).toContain("Blocking prompt");
    expect(dialogsSource).toContain("Active blocking prompt");
    expect(dialogsSource).toContain("No active blocking approval or ask-user prompt");
    expect(dialogsSource).toContain("activeApprovalRequest");
    expect(dialogsSource).toContain("activeAskUserRequest");
    expect(dialogsSource).toContain("diagnosticsExtensionInstallState");
    expect(dialogsSource).toContain("extensionInstallLine");
    expect(dialogsSource).toContain("openubmc-studio");
    expect(dialogsSource).toContain("/.bmc-studio/extensions/");
    expect(dialogsSource).toContain("versionedSiblings");
    expect(dialogsSource).toContain("registryLocation");
    expect(dialogsSource).not.toContain("registryVersion");
    expect(dialogsSource).toContain("Extension install");
    expect(dialogsSource).toContain("Session Tree State");
    expect(dialogsSource).toContain("diagnosticsSnapshot()");
    expect(dialogsSource).toContain("Frontend Event Summary");
    expect(dialogsSource).toContain("diagnosticsFrontendEventSummaryLines");
    expect(dialogsSource).toContain("lastAt=");
    expect(dialogsSource).toContain("Recent Frontend Events");
    expect(dialogsSource).toContain("Session Lifecycle");
    expect(dialogsSource).toContain("diagnosticsSessionLifecycleLines");
    expect(dialogsSource).toContain("SESSION_LIFECYCLE_EVENT_PATTERN");
    expect(dialogsSource).toContain("Operation Guard Events");
    expect(dialogsSource).toContain("Approval Judge Reviews");
    expect(dialogsSource).toContain("approvalJudgeLines");
    expect(dialogsSource).toContain("diagnosticsOperationGuardLines");
    expect(dialogsSource).toContain("Input / Shortcut Parity");
    expect(dialogsSource).toContain("diagnosticsInputParityLines");
    expect(dialogsSource).toContain("ApprovalDialogShown");
    expect(dialogsSource).toContain("ApprovalDialogSubmitted");
    expect(dialogsSource).toContain("UI language resolution");
    expect(dialogsSource).toContain("resolvedUiLanguage");
    expect(dialogsSource).toContain("resolved=${resolvedUiLanguage}");
    expect(dialogsSource).toContain("Ctrl+J=newline");
    expect(dialogsSource).toContain("ComposerHint");
    expect(dialogsSource).toContain("AskUserDialogShown");
    expect(dialogsSource).toContain("AskUserFallback");
    expect(dialogsSource).toContain("#=agents; !=shell; /=slash command search; @=file mention");
    expect(dialogsSource).toContain("fullwidth ！ open shell");
    expect(dialogsSource).toContain("path-only image payloads become @\\\"path\\\" mentions");
    expect(dialogsSource).toContain("Shell mode:");
    expect(dialogsSource).toContain("VSIX intentionally uses the IDE terminal instead of the TUI embedded PTY panel");
    expect(dialogsSource).toContain("integration: \"vscode.integratedTerminal\"");
    expect(dialogsSource).toContain("nextCwd");
    expect(dialogsSource).toContain("runtimeTools=${runtimeToolCount}");
    expect(dialogsSource).toContain("recentToolSnapshots=${rt.toolSnapshots.size}");
    expect(dialogsSource).toContain("countRuntimeTools(rt.currentRuntime)");
    expect(dialogsSource).toContain("Recent VSIX frontend errors");
    expect(dialogsSource).toContain("ACP startup warnings/errors");
    expect(dialogsSource).toContain("diagnosticsAcpStartupIssueCount");
    expect(dialogsSource).toContain("isAcpStartupOutputIssue");
    expect(dialogsSource).toContain("Session tree consistency");
    expect(dialogsSource).toContain("sessionTreeConsistencyDetail");
    expect(dialogsSource).toContain("Tool Renderer Coverage");
    expect(dialogsSource).toContain("toolRendererCoverageLines");
    expect(appSource).toContain("toolRendererCoverage: toolRendererCoverage");
    expect(toolRenderingSource).toContain("export function toolRendererCoverage");
    expect(toolRenderingSource).toContain("generic");
    expect(dialogsSource).toContain("OPERATION_GUARD_EVENT_PATTERN");
    expect(dialogsSource).toContain("Blocked|Deferred");
    expect(dialogsSource).toContain("check Operation Guard Events");
    expect(dialogsSource).toContain("If the Sessions tree differs from chat/status state");
    expect(dialogsSource).toContain("If openUBMC Studio behaves differently from VS Code");
    expect(extensionSource).toContain("chrys.copySupportBundle");
    expect(extensionSource).toContain("recordLifecycleEvent");
    expect(extensionSource).toContain("AcpProcessStarted");
    expect(extensionSource).toContain("SessionRestoreStarted");
    expect(extensionSource).toContain("SessionStartupIdle");
    expect(extensionSource).toContain("SessionNewStarted");
    expect(actionsSource).toContain("SessionNewStarted");
    expect(actionsSource).toContain("SessionInitializationWait");
    expect(actionsSource).toContain("copySupportBundle");
    expect(appSource).toContain("supportcopy");
    expect(appSource).toContain("支持快照");
    expect(appSource).toContain("frontendDebugEvent");
    expect(appSource).toContain("persistWebviewDiagnosticsState");
    expect(appSource).toContain("debugEvents: state.debugEvents.slice(-200)");
    expect(appSource).toContain("addDebugEvent(msg.kind, msg.detail, false)");
    expect(panelSource).toContain("case \"frontendDebugEvent\"");
    expect(panelSource).toContain("recordDebugEvent(msg.kind, msg.detail)");
    const sessionTreeSource = fs.readFileSync(path.join(extensionRoot, "src", "views", "sessionTree.ts"), "utf8");
    expect(sessionTreeSource).toContain("SessionTreeDiagnosticsSnapshot");
    expect(sessionTreeSource).toContain("lastGroupCounts");
    expect(sessionTreeSource).toContain("currentSessionInList");
  });

  it("does not persist stale sessions before restore or manual load succeeds", () => {
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    const runtimeSource = fs.readFileSync(path.join(extensionRoot, "src", "state", "runtime.ts"), "utf8");

    const restoreLoad = extensionSource.indexOf("await rt.sessionManager.loadSession(rt.currentCwd!, savedState.sessionId, savedState.additionalDirectories)");
    const restoreClaim = extensionSource.indexOf("rt.currentSessionId = savedState.sessionId", restoreLoad);
    expect(restoreLoad).toBeGreaterThan(-1);
    expect(restoreClaim).toBeGreaterThan(restoreLoad);
    expect(extensionSource).toContain("rt.clearPersistedSession()");
    expect(extensionSource).toContain("Previous iCode session");

    expect(dialogsSource).toContain("return openSessionTab(session)");
    expect(extensionSource).toContain("owner.restoreSession = { sessionId: session.sessionId, cwd }");
    expect(runtimeSource).toContain("clearPersistedSession()");
  });

  it("supports TUI-style right-click copy for selected text and whole messages", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(appSource).toContain("data-copy-message-id");
    expect(appSource).toContain("markCopyableMessageElement");
    expect(appSource).toContain("copyMessageById");
    expect(appSource).toContain("RightClickCopyMessage");
    expect(appSource).toContain("RightClickCopy");
    expect(appSource).toContain("copyToolExecution(message.toolCallId)");
    expect(appSource).toContain("ToolCopied");
    expect(appSource).toContain("copyMessageRole");
    expect(appSource).toContain("type CopyTarget");
    expect(appSource).toContain("formatToolExecution");
    expect(appSource).toContain("- **Agent:** ${panelState?.agentName");
    expect(appSource).toContain("- **Workspace:** ${panelState?.workspacePath");
    expect(appSource).toContain("UI language");
    expect(appSource).toContain("ToolViewed");
    expect(appSource).toContain("normalized === \"tool\" || normalized === \"tools\"");
    expect(appSource).toContain("normalized === \"thought\" || normalized === \"thoughts\"");
    expect(appSource).toContain("normalized === \"error\" || normalized === \"errors\"");
  });

  it("keeps Doctor repair actions from silently interrupting running turns", () => {
    const dialogsSource = readDialogsSource();

    expect(dialogsSource).toContain("restartAcpFromDoctor");
    expect(dialogsSource).toContain("reloadWindowFromDoctor");
    expect(dialogsSource).toContain("DoctorRestartAcpBlocked");
    expect(dialogsSource).toContain("DoctorReloadWindowBlocked");
    expect(dialogsSource).toContain("DoctorReloadWindow");
    expect(dialogsSource).toContain("copyRecentLogsFromDoctor");
    expect(dialogsSource).toContain("DoctorLogsCopied");
    expect(dialogsSource).toContain("Copy Recent Logs");
    expect(dialogsSource).toContain("redactSensitiveDiagnosticsText(rt.logLines.slice(-250).join(\"\\n\"))");
    expect(dialogsSource).toContain("Terminal integration");
    expect(dialogsSource).toContain("workspaceTerminalDetail");
    expect(dialogsSource).toContain("当前任务运行时不能重启 iCode ACP 进程");
    expect(dialogsSource).toContain("当前任务运行时不能重新加载 VS Code 窗口");
    expect(dialogsSource).toContain("重新加载 VS Code 窗口？这会重启扩展宿主。");
    expect(dialogsSource).toContain("rt.sessionManager?.state && rt.sessionManager.state !== \"idle\"");
    expect(dialogsSource).toContain("workbench.action.reloadWindow");
  });

  it("redacts sensitive values from diagnostics and support bundles", () => {
    const dialogsSource = readDialogsSource();

    expect(dialogsSource).toContain("SENSITIVE_DIAGNOSTICS_KEY");
    expect(dialogsSource).toContain("redactDiagnosticsValue");
    expect(dialogsSource).toContain("redactSensitiveDiagnosticsText");
    expect(dialogsSource).toContain("<redacted>");
    expect(dialogsSource).toContain("return redactSensitiveDiagnosticsText(content);");
    expect(dialogsSource).toContain("Bearer\\s+");
    expect(dialogsSource).toContain("OPENAI_API_KEY");
    expect(dialogsSource).toContain("key === \"value\" && isSensitiveDiagnosticsKey(headerName)");
  });

  it("uses the connected iCode CLI version in the chat header", () => {
    const stateSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "chatPanelState.ts"), "utf8");
    const versionSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "version.ts"), "utf8");
    const uiThemeSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "uiTheme.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");

    expect(versionSource).toContain("PACKAGE_VERSION");
    expect(stateSource).not.toContain("import { PACKAGE_VERSION } from \"./version\"");
    expect(stateSource).toContain("chrysCliVersion: rt.chrysCliVersion");
    expect(stateSource).not.toContain("Keep in sync with PACKAGE_VERSION");
    expect(appSource).toContain("brandDisplay({");
    expect(appSource).not.toContain("panelState.version");
    expect(fs.readFileSync(path.join(extensionRoot, "src/chat/webview/branding.ts"), "utf8")).toContain("iCode CLI v${input.chrysCliVersion}");
    expect(appSource).toContain("tuiTitle.textContent = branding.header");
    expect(appSource).toContain("panelState.platformLabel");
    expect(appSource).toContain("tuiTitle.title = branding.tooltip");
    expect(appSource).toContain("{ value: \"auto\", label: \"auto\"");
    expect(appSource).toContain("...SUPPORTED_UI_THEME_IDS.map");
    expect(appSource).toContain("Textual TUI 主题");
    expect(uiThemeSource).toContain("SUPPORTED_UI_THEME_IDS");
    expect(uiThemeSource).toContain("\"tokyo-night\"");
    expect(packageJson.contributes.configuration.properties["chrys.ui.theme"].enum).toContain("tokyo-night");
    expect(uiThemeSource).toContain("isSupportedUiTheme");
    expect(dialogsSource).toContain("Follow CHRYS_THEME when it is a supported TUI theme");
    expect(dialogsSource).toContain("themeFallbackReason");
    expect(dialogsSource).toContain("themeResolutionLine");
    expect(dialogsSource).toContain("ThemeChanged");
    expect(themeSource).toContain("max-width: min(68vw, 760px)");
    expect(themeSource).toContain("text-overflow: ellipsis");
  });

  it("keeps the webview readable on Windows and openUBMC Studio defaults", () => {
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");

    expect(themeSource).toContain("--chrys-font-size-base: max(14px, var(--chrys-vscode-font-size))");
    expect(themeSource).toContain("--chrys-font-size-sm: max(12px, calc(var(--chrys-vscode-font-size) - 1px))");
    expect(themeSource).toContain("font-size: var(--chrys-font-size-base)");
    expect(themeSource).not.toContain("#app {\n  gap: 0;\n  background: var(--chrys-tui-bg);\n  font-family: var(--chrys-font-mono), var(--chrys-emoji-font), monospace;\n  font-size: 11px;");
  });

  it("keeps the idle footer status hidden until there is run state to show", () => {
    const statusSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "statusBar.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(statusSource).toContain("hasStatusRunContent");
    expect(statusSource).toContain("sessionState !== \"idle\" || Boolean(state.lastCompletedElapsed) || toolStats.total > 0");
    expect(statusSource).toContain("statusRun.classList.toggle(\"hidden\", !showRun)");
    expect(statusSource).toContain("statusTokens?.classList.toggle(\"hidden\", !panelState?.usageText)");
    expect(appSource).toContain("class: \"status-run hidden\"");
    expect(appSource).toContain("class: \"status-tokens hidden\"");
  });

  it("matches TUI session-title behavior by hiding empty sessions and copying the full id", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");

    expect(appSource).toContain("class: \"session-label hidden\"");
    expect(appSource).toContain("copyCurrentSessionId");
    expect(appSource).toContain("sessionLabel.textContent = sessionDisplay");
    expect(appSource).toContain("sessionLabel.classList.toggle(\"hidden\", !sessionShortId)");
    expect(appSource).toContain("navigator.clipboard?.writeText(sessionId)");
    expect(appSource).toContain("SessionIdCopied");
    expect(appSource).toContain("sessionCopied");
    expect(themeSource).toContain(".session-label:hover");
    expect(themeSource).toContain("cursor: pointer");
  });

  it("surfaces unsupported image input as a persistent TUI-style dialog", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(appSource).toContain("showImageUnsupportedDialog");
    expect(appSource).toContain("imageUnsupportedTitle");
    expect(appSource).toContain("imageUnsupportedBody");
    expect(appSource).toContain("图片输入不可用");
    expect(appSource).toContain("kind: \"notice\"");
    expect(appSource).toContain("setInlineDialogState({");
    expect(appSource).toContain("ImageAttachBlocked");
    expect(appSource).toContain("ImageBlocked");
  });

  it("makes image preparation progress visible in the composer controls", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const promptPasteSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "promptPaste.ts"), "utf8");

    expect(appSource).toContain("if (preparingImageCount > 0)");
    expect(appSource).toContain("showLocalNotice(t(\"preparingImages\"))");
    expect(appSource).toContain("attachment-chip-preparing");
    expect(appSource).toContain("imagePreparingMeta");
    expect(appSource).toContain("imageCompressingMeta");
    expect(appSource).toContain("imagePreparationItems");
    expect(appSource).toContain("ImagePreparationStarted");
    expect(appSource).toContain("ImagePreparationFinished");
    expect(appSource).toContain("ImageInputState");
    expect(appSource).toContain("recordImageInputState");
    expect(appSource).toContain("preparingImages: preparingImageCount");
    expect(appSource).toContain("imagePreparationItems: imagePreparationItems.map");
    expect(appSource).toContain("attachmentTraySummary");
    expect(appSource).toContain("aria-live");
    expect(appSource).toContain("item.index}/${item.total}");
    expect(appSource).toContain("ImageCompressed");
    expect(appSource).toContain("imageSizeMeta");
    expect(appSource).toContain("clearPendingImages");
    expect(appSource).toContain("sanitizePromptPaste");
    expect(appSource).toContain("PasteTruncated");
    expect(appSource).toContain("convertPastedImagePathsToMentions");
    expect(appSource).toContain("ImagePathMentioned");
    expect(appSource).toContain("imagePathMentionTextFromDataTransfer");
    expect(appSource).toContain("text/uri-list");
    expect(promptPasteSource).toContain("PASTE_MAX_TOKENS = 30_000");
    expect(promptPasteSource).toContain("replace(/\\r\\n/g, \"\\n\").replace(/\\r/g, \"\\n\")");
    expect(promptPasteSource).toContain("export function convertPastedImagePathsToMentions");
    expect(promptPasteSource).toContain("formatImageMention");
    expect(promptPasteSource).toContain("uriListLines");
  });

  it("does not require backend image compression progress ACP extensions", () => {
    const clientSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "client.ts"), "utf8");
    const typesSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "types.ts"), "utf8");
    const notificationsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "notifications.ts"), "utf8");
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");

    expect(typesSource).not.toContain("ImageAttachmentCompressionNotification");
    expect(clientSource).not.toContain("_chrys/image_attachment_compression_started");
    expect(clientSource).not.toContain("_chrys/image_attachment_compression_finished");
    expect(clientSource).not.toContain("onImageAttachmentCompression");
    expect(extensionSource).not.toContain("handleImageAttachmentCompression");
    expect(notificationsSource).not.toContain("ImageAttachmentCompressionStarted");
    expect(notificationsSource).not.toContain("ImageAttachmentCompressionFinished");
  });

  it("does not require unsupported backend ACP extensions for the VSIX-owned Companion", () => {
    const clientSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "client.ts"), "utf8");
    const typesSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "types.ts"), "utf8");
    const notificationsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "notifications.ts"), "utf8");
    const managerSource = fs.readFileSync(path.join(extensionRoot, "src", "session", "manager.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const companionHandlerSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "companion.ts"), "utf8");

    expect(clientSource).not.toContain("_chrys/session_history_status");
    expect(clientSource).not.toContain("_chrys/buddy");
    expect(clientSource).not.toContain("_buddy/state");
    expect(clientSource).not.toContain("_buddy/command");
    expect(typesSource).not.toContain("SessionHistoryStatusNotification");
    expect(typesSource).not.toContain("BuddyNotification");
    expect(managerSource).not.toContain("sendBuddyCommand");
    expect(notificationsSource).not.toContain("handleBuddyUpdate");
    expect(appSource).toContain("companionCommand");
    expect(appSource).toContain("summonCompanion");
    expect(companionHandlerSource).toContain("companionCollectionText");
    expect(companionHandlerSource).toContain("verb === \"collection\"");
    expect(companionHandlerSource).toContain("verb === \"summon\"");
    expect(companionHandlerSource).toContain("handleCompanionDirectAddress");
    expect(companionHandlerSource).toContain("handleCompanionCommand");
  });

  it("keeps TUI-style #agent quick switching in the VSIX composer", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const actionsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "actions.ts"), "utf8");
    const dialogsSource = readDialogsSource();

    expect(appSource).toContain("agentSwitchFromPrompt");
    expect(appSource).toContain("const match = /^[#＃]\\s*(.+)$/s.exec(trimmed)");
    expect(appSource).toContain("command: \"switchAgent\", arg: agentSwitch");
    expect(appSource).toContain("showAgentSwitchDisabledWhileRunning");
    expect(appSource).toContain("# 智能体切换在 agent 运行时不可用");
    expect(actionsSource).toContain("switchActiveAgent");
    expect(actionsSource).toContain("await switchActiveAgent(arg)");
    expect(dialogsSource).toContain("export async function switchActiveAgent(targetName?: string)");
    expect(dialogsSource).toContain("AgentSwitchBlocked");
    expect(dialogsSource).toContain("rt.sessionManager.state !== \"idle\"");
    expect(dialogsSource).toContain("AgentSwitchFailed");
    expect(dialogsSource).toContain("!agent.subAgentOnly");
    expect(dialogsSource).toContain("agentQuickPickItem");
    expect(dialogsSource).toContain("main agent");
    expect(dialogsSource).toContain("主智能体");
    expect(dialogsSource).toContain("Profile id:");
    expect(dialogsSource).toContain("可作为主智能体");
    expect(dialogsSource).toContain("await refreshRuntimeSnapshot()");
    expect(dialogsSource).toContain("rt.chatPanel?.setState(chatPanelState())");
    expect(dialogsSource).toContain("rt.chatPanel?.appendDebugEvent(\"AgentSwitch\", selected.profileName)");
    expect(dialogsSource).toContain("AgentDialogSetActiveUnavailable");
    expect(dialogsSource).toContain("iCode cannot switch agents while the current task is running");
  });

  it("keeps TUI-style single-character shell trigger in the VSIX composer", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(appSource).toContain("value === \"!\" || value === \"！\"");
    expect(appSource).toContain("showShellDisabledWhileRunning");
    expect(appSource).toContain("vscode.postMessage({ type: \"command\", command: \"openShell\" })");
    expect(appSource).toContain("state.inputTriggerPending = true");
  });

  it("accepts fullwidth slash commands for CJK input parity with the TUI", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(appSource).toContain("isSlashCommandText");
    expect(appSource).toContain("return /^[/／]/.test(text.trimStart())");
    expect(appSource).toContain("const match = /^[/／]([^\\s/／]+)(?:\\s+(.*))?$/");
    expect(appSource).toContain("const parsed = /^[/／]([^\\s/／]*)(?:\\s+(.*))?$/");
    expect(appSource).toContain("replace(/^[/／]/, \"\")");
  });

  it("keeps the TUI Ctrl+J composer newline shortcut", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(appSource).toContain("e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === \"j\"");
    expect(appSource).toContain("replaceComposerSelection(\"\\n\")");
    expect(appSource).toContain("if (e.key === \"Enter\" && !e.shiftKey)");
  });

  it("keeps the TUI Ctrl+B interrupt shortcut while the agent is running", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(appSource).toContain("e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === \"b\"");
    expect(appSource).toContain("state.currentSessionState === \"running\" || state.currentSessionState === \"cancelling\"");
    expect(appSource).toContain("vscode.postMessage({ type: \"cancel\" })");
  });

  it("does not bind or render TUI function-key/footer shortcut controls", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");

    expect(appSource).not.toContain("const TUI_FUNCTION_KEY_SHORTCUTS");
    expect(appSource).not.toContain("handleTuiFunctionKeyShortcut");
    expect(appSource).not.toContain("shortcutFooterLabel");
    expect(appSource).not.toContain("function tuiFooterKey");
    expect(appSource).not.toContain("footer-key");
    expect(appSource).not.toContain("footer-quit-separator");
    expect(appSource).not.toContain("e.key.toLowerCase() === \"g\"");
    expect(appSource).not.toContain("e.key.toLowerCase() === \"q\"");
    expect(appSource).not.toContain("F1: { kind: \"host\", command: \"showSessions\" }");
    expect(appSource).not.toContain("F2: { kind: \"host\", command: \"manageAgents\" }");
    expect(appSource).not.toContain("F4: { kind: \"host\", command: \"manageModels\" }");
    expect(appSource).not.toContain("F6: { kind: \"host\", command: \"showLogs\" }");
    expect(appSource).not.toContain("F9: { kind: \"local\", command: \"pickTheme\" }");
    expect(appSource).not.toContain("F10: { kind: \"local\", command: \"notifications\" }");
    expect(appSource).not.toContain("F12: { kind: \"host\", command: \"showStructuredHistory\" }");
    expect(themeSource).not.toContain(".footer-key");
    expect(themeSource).not.toContain(".footer-quit-separator");
  });

  it("keeps command help and coding-workflow slash documentation without TUI function keys", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(appSource).toContain("const TUI_SHORTCUT_HELP");
    expect(appSource).toContain("Keyboard Shortcuts");
    expect(appSource).toContain("shortcutHelpLines()");
    expect(appSource).not.toContain("{ key: \"F1\"");
    expect(appSource).not.toContain("{ key: \"F2\"");
    expect(appSource).not.toContain("{ key: \"F4\"");
    expect(appSource).not.toContain("{ key: \"F6\"");
    expect(appSource).not.toContain("{ key: \"F9\"");
    expect(appSource).not.toContain("{ key: \"F10\"");
    expect(appSource).not.toContain("{ key: \"F12\"");
    expect(appSource).toContain("function commandHelpDialogTitle");
    expect(appSource).toContain("帮助：/${command}");
    expect(appSource).toContain("function commandManualTitle");
    expect(appSource).toContain("iCode 命令手册");
    expect(appSource).toContain("function slashArgSuggestions");
    expect(appSource).toContain("function commandHelpArgSuggestions");
    expect(appSource).toContain("definition.names.includes(\"man\") || definition.names.includes(\"help\")");
    expect(appSource).toContain("Coding Workflow Quickstart");
    expect(appSource).toContain("function codingWorkflowHelpLines");
    expect(appSource).toContain("/grep <query>");
    expect(appSource).toContain("/copy tools");
    expect(appSource).toContain("VSIX/TUI mismatch support bundle");
    expect(appSource).toContain("Coding Workflow 速查");
    expect(appSource).toContain("/检索 <query>");
    expect(appSource).toContain("/支持");
    expect(appSource).toContain("examples?: string[]");
    expect(appSource).toContain("zhExamples?: string[]");
    expect(appSource).toContain("Examples");
    expect(appSource).toContain("示例");
  });

  it("keeps TUI-style @file trigger boundaries, including CJK text", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const dialogsSource = readDialogsSource();

    expect(appSource).toContain("isFileMentionTriggerText");
    expect(appSource).toContain("isCjkBoundaryChar");
    expect(appSource).toContain("text.endsWith(\"@\") && !text.endsWith(\"＠\")");
    expect(appSource).toContain("vscode.postMessage({ type: \"command\", command: \"insertFileMention\", arg: base })");
    expect(appSource).toContain("[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]");
    expect(dialogsSource).toContain("FileMentionInserted");
    expect(dialogsSource).toContain("FileAttachBlocked");
    expect(dialogsSource).toContain("FileAttached");
    expect(dialogsSource).toContain("Full file attach is available after the current turn finishes");
  });

  it("preserves TUI runtime-skill slash prompts instead of blocking them as unknown commands", () => {
    const stateSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "chatPanelState.ts"), "utf8");
    const panelSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "panel.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(panelSource).toContain("runtimeSkillNames?: string[]");
    expect(stateSource).toContain("function runtimeSkillNames()");
    expect(stateSource).toContain("runtimeSkillNames: runtimeSkillNames()");
    expect(appSource).toContain("isRuntimeSkillPrompt");
    expect(appSource).toContain("state.latestState?.runtimeSkillNames");
    expect(appSource).toContain("&& !isRuntimeSkillPrompt(text)");
    expect(appSource).toContain("Runtime skill");
    expect(appSource).toContain("运行时技能");
  });

  it("supports Chinese slash-command aliases in the localized VSIX chat", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const dialogsSource = readDialogsSource();

    expect(appSource).toContain("zhNames?: string[]");
    expect(appSource).toContain("zhNames: [\"搜索\"]");
    expect(appSource).toContain("zhNames: [\"模型管理\"]");
    expect(appSource).toContain("zhNames: [\"健康检查\", \"doctor\"]");
    expect(appSource).toContain("zhNames: [\"诊断\", \"诊断报告\"]");
    expect(appSource).toContain("zhNames: [\"支持\", \"排查\", \"支持快照\"]");
    expect(appSource).toContain("zhNames: [\"会话json\", \"历史\"]");
    expect(appSource).toContain("zhNames: [\"调试快照\", \"复制调试\"]");
    expect(appSource).toContain("modelnew: { title: \"新建模型\"");
    expect(appSource).toContain("mcptest: { title: \"测试 MCP\"");
    expect(appSource).toContain("function slashDefinitionNames");
    expect(appSource).toContain("function slashDisplayName");
    expect(appSource).toContain("^[/／]([^\\s/／]+)");
    expect(appSource).toContain("输入 /帮助 浏览全部命令");
    expect(appSource).toContain("/帮助 <command>");
    expect(appSource).toContain("正在打开诊断报告");
    expect(appSource).toContain("正在复制支持快照");
    expect(appSource).toContain("正在打开会话 JSON");
    expect(appSource).toContain("正在打开主题");
    expect(dialogsSource).toContain("Slash aliases");
    expect(dialogsSource).toContain("/search and /搜索");
  });

  it("keeps high-frequency workspace slash commands usable for coding workflows", () => {
    const panelSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "panel.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const actionsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "actions.ts"), "utf8");
    const dialogsSource = readDialogsSource();

    expect(panelSource).toContain("\"findWorkspaceFile\"");
    expect(panelSource).toContain("\"grepWorkspace\"");
    expect(appSource).toContain("names: [\"search\"]");
    expect(appSource).toContain("command: \"searchWorkspace\"");
    expect(appSource).toContain("names: [\"grep\"]");
    expect(appSource).toContain("command: \"grepWorkspace\"");
    expect(appSource).toContain("names: [\"find\", \"open\"]");
    expect(appSource).toContain("command: \"findWorkspaceFile\"");
    expect(appSource).toContain("查找文件");
    expect(appSource).toContain("commandNotice(command.command, command.arg)");
    expect(appSource).toContain("Opening search");
    expect(appSource).toContain("Searching");
    expect(appSource).toContain("Finding file");
    expect(appSource).toContain("/grep WorkspaceGrep");
    expect(appSource).toContain("/copy user all");
    expect(actionsSource).toContain("await searchWorkspace(arg)");
    expect(actionsSource).toContain("await grepWorkspace(arg)");
    expect(actionsSource).toContain("await findWorkspaceFile(arg)");
    expect(dialogsSource).toContain("export async function searchWorkspace");
    expect(dialogsSource).toContain("export async function grepWorkspace");
    expect(dialogsSource).toContain("export async function findWorkspaceFile");
    expect(dialogsSource).toContain("WorkspaceFileOpen");
    expect(dialogsSource).toContain("withProgress");
    expect(dialogsSource).toContain("WorkspaceGrep");
    expect(dialogsSource).toContain("3000");
    expect(dialogsSource).toContain("openVsCodeSearchView");
    expect(dialogsSource).toContain("WorkspaceSearchView");
    expect(dialogsSource).toContain("searchIncludePattern");
    expect(dialogsSource).toContain("workbench.action.findInFiles");
    expect(dialogsSource).toContain("Open all results in VS Code Search");
    expect(dialogsSource).toContain("在 VS Code 搜索中打开全部结果");
    expect(dialogsSource).toContain("Copy matches");
    expect(dialogsSource).toContain("Insert matches into composer");
    expect(dialogsSource).toContain("formatWorkspaceSearchResults");
    expect(dialogsSource).toContain("WorkspaceGrepCopied");
    expect(dialogsSource).toContain("WorkspaceGrepInserted");
  });

  it("keeps MCP tool calls attributable to their runtime server in the VSIX", () => {
    const stateSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "chatPanelState.ts"), "utf8");
    const panelSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "panel.ts"), "utf8");
    const toolCardsSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "toolCards.ts"), "utf8");
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");

    expect(stateSource).toContain("function runtimeMcpTools");
    expect(stateSource).toContain("mcpTools: runtimeMcpTools()");
    expect(panelSource).toContain("mcpTools?: Record<string, string[]>");
    expect(toolCardsSource).toContain("mcpServerForTool");
    expect(toolCardsSource).toContain("renderMcpToolCall");
    expect(toolCardsSource).toContain("state.latestState?.mcpTools");
    expect(themeSource).toContain(".mcp-card");
  });

  it("keeps tool-card file and search-result links truly clickable from nested labels", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const panelSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "panel.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    const toolCardsSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "toolCards.ts"), "utf8");

    expect(toolCardsSource).toContain("data-file-path");
    expect(toolCardsSource).toContain("data-file-line");
    expect(toolCardsSource).toContain("aria-label");
    expect(toolCardsSource).toContain("class: \"edit-path\"");
    expect(toolCardsSource).toContain("Open file ${path}");
    expect(appSource).toContain("target.closest<HTMLElement>(\"[data-file-path]\")");
    expect(appSource).toContain("OpenFileFromToolCard");
    expect(appSource).toContain("Opening ${location}");
    expect(panelSource).toContain("onOpenFile");
    expect(dialogsSource).toContain("export async function openWorkspaceFile");
    expect(dialogsSource).toContain("appendDebugEvent(\"WorkspaceFileOpen\"");
    expect(dialogsSource).toContain("WorkspaceFileOpenFailed");
    expect(dialogsSource).toContain("Cannot open ${filePath} because no iCode workspace is selected.");
    expect(dialogsSource).toContain("await changeWorkspace()");
    expect(dialogsSource).toContain("await searchWorkspace(path.basename(filePath))");
  });

  it("disables unsafe slash commands while the agent is running like the TUI", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");

    expect(appSource).toContain("allowWhileRunning");
    expect(appSource).toContain("BUSY_DISABLED_HOST_COMMANDS");
    expect(appSource).toContain("BUSY_DISABLED_HOST_COMMANDS.has(command)");
    expect(appSource).toContain("\"newSession\"");
    expect(appSource).toContain("\"changeWorkspace\"");
    expect(appSource).toContain("\"reloadSettings\"");
    expect(appSource).toContain("isSlashDisabledWhileRunning");
    expect(appSource).toContain("showSlashDisabledWhileRunning");
    expect(appSource).toContain("showHostCommandDisabledWhileRunning");
    expect(appSource).toContain("showShellDisabledWhileRunning");
    expect(appSource).toContain("showModelSwitchDisabledWhileRunning");
    expect(appSource).toContain("state.currentSessionState === \"running\" || state.currentSessionState === \"cancelling\"");
    expect(appSource).toContain("! 终端模式在 agent 运行时不可用");
    expect(appSource).toContain("模型切换在 agent 运行时不可用");
    expect(appSource).toContain("agent 运行时不可用");
    expect(appSource).toContain("names: [\"copy\"]");
    expect(appSource).toContain("allowWhileRunning: true");
    expect(themeSource).toContain(".slash-item.disabled");
    expect(themeSource).toContain("cursor: not-allowed");
  });

  it("keeps terminal shell mode as a workspace-scoped IDE terminal with visible feedback", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    const shellPromptSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "shellPrompt.ts"), "utf8");

    expect(appSource).toContain("shellCommandFromPrompt(text)");
    expect(appSource).toContain("command: \"openShell\"");
    expect(appSource).toContain("openingShell");
    expect(appSource).toContain("showLocalNotice(t(\"openingShell\"))");
    expect(appSource).toContain("ShellPromptSubmitted");
    expect(appSource).toContain("ShellBlocked");
    expect(shellPromptSource).toContain("^[!！]");
    expect(dialogsSource).toContain("vscode.window.createTerminal");
    expect(dialogsSource).toContain("name: \"iCode Shell\"");
    expect(dialogsSource).toContain("cwd: normalizedCwd");
    expect(dialogsSource).toContain("terminal.sendText(trimmedCommand, true)");
    expect(dialogsSource).toContain("ShellCommand");
    expect(dialogsSource).toContain("ShellOpened");
    expect(dialogsSource).toContain("ShellPromptSubmitted");
    expect(dialogsSource).toContain("ShellBlocked");
    expect(dialogsSource).toContain("iCode 终端");
  });

  it("keeps TUI model profile connection fields editable in the VSIX dialog", () => {
    const dialogsSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "components", "dialogs.ts"), "utf8");
    const themeSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "styles", "theme.css"), "utf8");

    expect(dialogsSource).toContain("http_connect_timeout");
    expect(dialogsSource).toContain("http_read_timeout");
    expect(dialogsSource).toContain("http_max_retries");
    expect(dialogsSource).toContain("verify_ssl");
    expect(dialogsSource).toContain("bypass_proxy");
    expect(dialogsSource).toContain("http_headers");
    expect(dialogsSource).toContain("chat_options");
    expect(dialogsSource).toContain("parseJsonObjectFormField");
    expect(dialogsSource).toContain("Base URL must start with http:// or https://");
    expect(dialogsSource).toContain("高级连接");
    expect(themeSource).toContain(".modal-advanced");
    expect(themeSource).toContain(".model-form textarea");
  });

  it("applies VSIX-selected defaults to newly created sessions", () => {
    const runtimeSource = fs.readFileSync(path.join(extensionRoot, "src", "state", "runtime.ts"), "utf8");
    const defaultsSource = fs.readFileSync(path.join(extensionRoot, "src", "session", "defaults.ts"), "utf8");
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const actionsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "actions.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    const managementSource = fs.readFileSync(path.join(extensionRoot, "src", "ui", "management.ts"), "utf8");

    expect(runtimeSource).toContain("preferredAgentName");
    expect(runtimeSource).toContain("preferredModelProfileId");
    expect(runtimeSource).toContain("preferredApprovalMode");
    expect(defaultsSource).toContain("applyPreferredDefaultsToNewSession");
    expect(defaultsSource).toContain("rememberPreferredAgent");
    expect(defaultsSource).toContain("rememberPreferredModel");
    expect(defaultsSource).toContain("persistPreferredModel");
    expect(defaultsSource).toContain("config.update(\"model.profile\"");
    expect(defaultsSource).toContain("rememberPreferredApprovalMode");
    expect(defaultsSource).toContain("NewSessionDefault");
    expect(extensionSource).toContain("initializePreferredDefaults");
    expect(extensionSource).toContain("refreshPreferredDefaultsFromSettings");
    expect(extensionSource).toContain("await applyPreferredDefaultsToNewSession()");
    expect(actionsSource).toContain("await applyPreferredDefaultsToNewSession()");
    expect(dialogsSource).toContain("await openSessionTab()");
    expect(dialogsSource).toContain("rememberPreferredApprovalMode");
    expect(dialogsSource).toContain("await persistPreferredModel(selected.id)");
    expect(managementSource).toContain("await persistPreferredModel(id)");
  });

  it("documents local names, searchable prompt history and display-only clearing", () => {
    const decisions = readSource("DESIGN_DECISIONS.md");
    const checklist = readSource("RELEASE_CHECKLIST.md");
    const app = readSource("src", "chat", "webview", "app.ts");
    const nameUi = readSource("src", "ui", "sessionName.ts");
    expect(decisions).toContain("| Local session names |");
    expect(decisions).toContain("| Prompt history search |");
    expect(decisions).toContain("| Clear display |");
    expect(checklist).toContain("Session Names, Prompt History And Clear Display");
    expect(app).toContain('names: ["history", "json"]');
    expect(app).toContain('names: ["prompts"]');
    expect(app).toContain("Clear Display");
    expect(nameUi).toContain("does not change the TUI title");
    expect(nameUi).not.toContain("acp.");
  });

  it("documents independent tabs and preserves pending requests across view closure", () => {
    const decisions = fs.readFileSync(path.join(extensionRoot, "DESIGN_DECISIONS.md"), "utf8");
    const checklist = fs.readFileSync(path.join(extensionRoot, "RELEASE_CHECKLIST.md"), "utf8");
    const panel = fs.readFileSync(path.join(extensionRoot, "src", "chat", "panel.ts"), "utf8");
    expect(decisions).toContain("| Multiple session tabs |");
    expect(decisions).toContain("independent ACP process");
    expect(checklist).toContain("Multiple Session Tabs");
    expect(panel).toContain("bindRuntime");
    expect(panel).not.toContain('cancelActive("chat-panel-disposed")');
  });

  it("opens independent session tabs without replacing a running session", () => {
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    expect(extensionSource).toContain("findSessionRuntime(session.sessionId)");
    expect(extensionSource).toContain("createSessionRuntime(cwd)");
    expect(dialogsSource).toContain("return openSessionTab(session)");
    expect(dialogsSource).not.toContain("SessionLoadBlocked");
    expect(extensionSource).not.toContain("NewSessionBlocked");
  });

  it("blocks rollback and current-session deletion while a turn is running", () => {
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const dialogsSource = readDialogsSource();

    expect(readSource("src/ui/changes.ts")).toContain("manager.state===\"idle\"");
    expect(readSource("src/ui/changes.ts")).toContain("Wait for the current task to finish before rollback.");
    expect(dialogsSource).toContain("await deleteSessionById(sessionId, cwd)");


    expect(extensionSource).toContain("SessionDeleteBlocked");
    expect(extensionSource).toContain("SessionDeleted");
    expect(extensionSource).toContain("deletingCurrent && rt.sessionManager.state !== \"idle\"");
  });

  it("blocks active model switching while a turn is running without blocking model management", () => {
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    const runtimeUtilsSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "runtimeUtils.ts"), "utf8");
    const managementSource = fs.readFileSync(path.join(extensionRoot, "src", "ui", "management.ts"), "utf8");

    expect(appSource).toContain("BUSY_DISABLED_HOST_COMMANDS");
    expect(appSource).toContain("\"setModelProfile\"");
    expect(appSource).toContain("showModelSwitchDisabledWhileRunning");
    expect(dialogsSource).toContain("ModelSwitchBlocked");
    expect(dialogsSource).toContain("ModelSwitch");
    expect(dialogsSource).toContain("cannot switch model profiles while the current task is running");
    expect(dialogsSource).toContain("rt.sessionManager.state !== \"idle\"");
    expect(dialogsSource).toContain("modelQuickPickItem");
    expect(dialogsSource).toContain("Image input");
    expect(dialogsSource).toContain("ImageInputState");
    expect(dialogsSource).toContain("图片输入");
    expect(dialogsSource).toContain("providerLabel");
    expect(dialogsSource).toContain("apiStyleLabel");
    expect(dialogsSource).toContain("activeModelProfileId");
    expect(dialogsSource).not.toContain("defaultModelQuickPickItem");
    expect(dialogsSource).not.toContain("Default / unpinned");
    expect(dialogsSource).not.toContain("Use Default Model");
    expect(dialogsSource).toContain("Select the active model profile and default for new VSIX sessions");
    expect(dialogsSource).toContain("saved as the VSIX default");
    expect(dialogsSource).toContain("runtimeDetailsTabs(rt.currentRuntime, language)");
    expect(runtimeUtilsSource).toContain("runtimeDetailsTabs(snapshot: RuntimeSnapshot | null, language: UiLanguage = \"en\")");
    expect(runtimeUtilsSource).toContain("rtText(language, \"Model Profile\", \"模型配置\")");
    expect(runtimeUtilsSource).toContain("rtText(language, \"Sub-agent tools\", \"子智能体工具\")");
    expect(runtimeUtilsSource).toContain("runtimeMcpSections(details, language)");
    expect(runtimeUtilsSource).toContain("rtText(language, \"Failed MCP servers\", \"失败的 MCP 服务器\")");
    expect(runtimeUtilsSource).toContain("rtText(language, \"No MCP tools loaded.\", \"没有加载 MCP 工具。\")");
    expect(runtimeUtilsSource).toContain("rtText(language, \"No skills loaded.\", \"没有加载技能。\")");
    expect(runtimeUtilsSource).toContain("return language === \"zh-CN\" ? zh : en");
    expect(managementSource).toContain("ModelSwitchBlocked");
    expect(managementSource).toContain("rt.sessionManager.state !== \"idle\"");
    expect(managementSource).toContain("await rt.sessionManager.writeModelProfile(model)");
    expect(managementSource).toContain("saved as the VSIX default");
  });

  it("localizes standalone runtime details for parity debugging", () => {
    const dialogsSource = readDialogsSource();

    expect(dialogsSource).toContain("# iCode 运行时详情");
    expect(dialogsSource).toContain("iCode CLI 版本");
    expect(dialogsSource).toContain("ACP 命令");
    expect(dialogsSource).toContain("最近工具调用");
    expect(dialogsSource).toContain("运行时快照");
    expect(dialogsSource).toContain("localizedCurrentSessionJsonPath");
    expect(dialogsSource).toContain("VS Code 集成终端");
    expect(dialogsSource).toContain("local session.json");
    expect(dialogsSource).toContain("当前前端会话还没有记录工具调用");
  });

  it("blocks manual settings reload while a turn is running", () => {
    const dialogsSource = readDialogsSource();

    expect(dialogsSource).toContain("SettingsReloadBlocked");
    expect(dialogsSource).toContain("SettingsReloaded");
    expect(dialogsSource).toContain("SettingsReloadDeferred");
    expect(dialogsSource).toContain("cannot reload settings while the current task is running");
    expect(dialogsSource).toContain("await rt.sessionManager.reloadSettings()");
  });

  it("blocks active profile deletion while preserving non-active profile management", () => {
    const dialogsSource = readDialogsSource();
    const managementSource = fs.readFileSync(path.join(extensionRoot, "src", "ui", "management.ts"), "utf8");

    expect(dialogsSource).toContain("isActiveAgentProfile");
    expect(dialogsSource).toContain("isActiveModelProfile");
    expect(dialogsSource).toContain("AgentDeleteBlocked");
    expect(dialogsSource).toContain("ModelDeleteBlocked");
    expect(dialogsSource).toContain("cannot delete the active agent profile while the current task is running");
    expect(dialogsSource).toContain("cannot delete the active model profile while the current task is running");
    expect(dialogsSource).toContain("modelQuickPickItem(model, { activeModelProfileId })");
    expect(dialogsSource).toContain("删除哪个模型配置？");
    expect(dialogsSource).toContain("删除模型配置 ${selected.id}？");
    expect(dialogsSource).toContain("删除哪个用户智能体配置？");
    expect(dialogsSource).toContain("删除智能体配置 ${selected.name}？");
    expect(dialogsSource).toContain("const deleteLabel = nativeText(\"Delete\", \"删除\")");
    expect(managementSource).toContain("AgentDeleteBlocked");
    expect(managementSource).toContain("ModelDeleteBlocked");
    expect(managementSource).toContain("SettingsReloadDeferred");
    expect(managementSource).toContain("await rt.sessionManager.writeModelProfile(model)");
  });

  it("explains iCode .env config separately from VS Code extension settings", () => {
    const defaultsSource = fs.readFileSync(path.join(extensionRoot, "src", "session", "defaults.ts"), "utf8");
    const managementPanelSource = fs.readFileSync(path.join(extensionRoot, "src", "manage", "panel.ts"), "utf8");
    const managementSource = fs.readFileSync(path.join(extensionRoot, "src", "ui", "management.ts"), "utf8");
    const dialogsSource = readDialogsSource();

    expect(defaultsSource).toContain("rememberPreferredConfigOption");
    expect(defaultsSource).toContain("default_agent");
    expect(defaultsSource).toContain("model_profile");
    expect(defaultsSource).toContain("default_approval_mode");
    expect(managementPanelSource).toContain("configHelp");
    expect(managementPanelSource).toContain("~/.chrys/.env");
    expect(managementPanelSource).toContain("Save iCode Config");
    expect(managementSource).toContain("rememberPreferredConfigOption");
    expect(dialogsSource).toContain("diagnosticsPreferredDefaults");
    expect(dialogsSource).toContain("VSIX Preferred Defaults");
    expect(dialogsSource).toContain("preferred/new-session");
    expect(dialogsSource).toContain("rememberPreferredConfigOption");
  });

  it("keeps backend built-in agents owned by the connected iCode runtime", () => {
    const extensionSource = readSource("src", "extension.ts");

    expect(extensionSource).toContain("rt.sessionManager = new SessionManager(client);");
    expect(extensionSource).not.toContain("ensureDefaultAgentProfileYaml");
    expect(fs.existsSync(path.join(extensionRoot, "src", "session", "agentBootstrap.ts"))).toBe(false);
  });

  it("wires Debug sidebar copy actions to real local and host commands", () => {
    const appSource = readSource("src", "chat", "webview", "app.ts");
    const themeSource = readSource("src", "chat", "webview", "styles", "theme.css");

    expect(appSource).toContain("copyDebugSnapshot");
    expect(appSource).toContain("copySupportBundle");
    expect(appSource).toContain("target.closest<HTMLElement>(\"[data-local-command]\")");
    expect(appSource).toContain("target.closest<HTMLElement>(\"[data-command]\")");
    expect(appSource).toContain("debug-actions");
    expect(appSource).toContain("debug-icon-btn");
    expect(appSource).toContain("\"aria-label\": t(\"copySnapshot\")");
    expect(appSource).toContain("\"aria-label\": t(\"copySupportBundle\")");
    expect(appSource).toContain("title: t(\"copySnapshot\")");
    expect(appSource).toContain("title: t(\"copySupportBundle\")");
    expect(appSource).toContain("class: \"debug-icon\"");
    expect(appSource).toContain("const visibleDebugEvents = state.debugEvents.slice(-80)");
    expect(appSource).toContain("class: \"event-row-head\"");
    expect(appSource).toContain("role: \"list\"");
    expect(appSource).not.toContain(".slice(0, 18)");
    expect(themeSource).toContain(".debug-actions");
    expect(themeSource).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(themeSource).toContain("display: inline-flex");
    expect(themeSource).toContain(".debug-icon");
    expect(themeSource).toContain(".event-stream {\n  font-size: var(--chrys-font-size-sm);");
    expect(themeSource).toContain(".event-row-head");
    expect(themeSource).toContain("grid-template-columns: 8ch minmax(0, 1fr)");
    expect(themeSource).toContain("padding-left: calc(8ch + 8px)");
    expect(themeSource).toContain("overflow-wrap: anywhere");
  });

  it("keeps composer hints and typed triggers in the input surface", () => {
    const appSource = readSource("src", "chat", "webview", "app.ts");
    const themeSource = readSource("src", "chat", "webview", "styles", "theme.css");

    expect(appSource).toContain("class: \"input-hint\"");
    expect(appSource).toContain("class: \"send-btn\"");
    expect(appSource).toContain("class: \"new-btn\"");
    expect(appSource).toContain("class: \"prompt-chip active\"");
    expect(appSource).toContain("\"aria-label\": t(\"typeMessage\")");
    expect(appSource).toContain("inputBar.classList.toggle(\"is-busy\", isBusy)");
    expect(appSource).toContain("const sessionMeta = el(\"div\", { class: \"session-meta\" },\n  thinkingIndicator,");
    expect(appSource).not.toContain("sessionMeta, thinkingIndicator, inputBar");
    expect(appSource).toContain("if (e.key === \"Enter\" && !e.shiftKey)");
    expect(appSource).toContain("replaceComposerSelection(\"\\n\")");
    expect(appSource).toContain("if (e.key === \"@\" && inputField.value.trim() === \"\")");
    expect(appSource).toContain("if (e.key === \"#\" && inputField.value.trim() === \"\")");
    expect(appSource).toContain("postCommand(\"insertFileMention\", inputField.value)");
    expect(appSource).toContain("slashSuggestions(value)");
    expect(appSource).toContain("handleSingleCharacterTrigger");
    expect(appSource).toContain("shellHint: \"! 终端\"");
    expect(themeSource).toContain(".input-hint");
    expect(themeSource).toContain(".send-btn");
    expect(themeSource).toContain(".new-btn");
    expect(themeSource).toContain(".prompt-chip");
    expect(themeSource).toContain(".input-bar.is-busy");
    expect(themeSource).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(themeSource).toContain("align-items: center");
    expect(themeSource).toContain("padding: 5px 4px");
    expect(themeSource).toContain("line-height: 22px");
    expect(themeSource).toContain(".session-meta {\n  min-height: 24px");
  });

  it("makes TreeView empty and error states actionable", () => {
    const source = fs.readFileSync(path.join(extensionRoot, "src", "views", "sessionTree.ts"), "utf8");
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const sessionFilesSource = fs.readFileSync(path.join(extensionRoot, "src", "common", "sessionFiles.ts"), "utf8");

    expect(source).toContain("iCode is starting... Open Doctor");
    expect(source).toContain("command: \"chrys.doctor\"");
    expect(source).toContain("command: \"chrys.changeWorkspace\"");
    expect(source).toContain("No saved sessions yet.");
    expect(source).toContain("command: \"chrys.focusChat\"");
    expect(source).toContain("iCode Actions");
    expect(source).toContain("TREE_ACTIONS");
    expect(source).toContain("findSessionJsonPath");
    expect(source).toContain("not found on this host");
    expect(source).toContain("Right-click to copy a parity-debug summary");
    expect(source).toContain("Current Session");
    expect(source).toContain("dateGroupKey");
    expect(source).toContain("defaultGroupState");
    expect(source).toContain("Pinned active VSIX session");
    expect(source).not.toContain("Current session is not saved yet.");
    expect(extensionSource).not.toContain("暂无会话。开始对话后会在这里显示。");
    expect(extensionSource).toContain("ensureSessionTree(context)");
    expect(extensionSource).toContain("findSessionJsonPath");
    expect(extensionSource).toContain("copySessionSummaryFromTree");
    expect(extensionSource).toContain("sessionTreeDebugSummary");
    expect(extensionSource).toContain("Raw Session Metadata");
    expect(extensionSource).toContain("SessionSummaryCopied");
    expect(sessionFilesSource).toContain("session.json");
    expect(sessionFilesSource).toContain("chrysSessionRootDir");
    expect(sessionFilesSource).toContain("chrysSessionsDir");
    expect(sessionFilesSource).toContain("CHRYS_SESSION_ROOT_DIR");
    expect(sessionFilesSource).toContain("sessionId.replace");
  });

  it("tracks iCode ACP payload additions without adding private methods", () => {
    const typesSource = fs.readFileSync(path.join(extensionRoot, "src", "acp", "types.ts"), "utf8");
    const notificationsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "notifications.ts"), "utf8");

    expect(typesSource).toContain("turnRange?: number[]");
    expect(notificationsSource).toContain("formatTurnRange");
    expect(notificationsSource).toContain("Context compressed${source}: freed");
    expect(notificationsSource).not.toContain("_buddy/");
    expect(notificationsSource).not.toContain("_chrys/session_history_status");
  });

  it("keeps workspace changes TUI-visible and blocked while the agent is busy", () => {
    const dialogsSource = readDialogsSource();
    const notificationsSource = fs.readFileSync(path.join(extensionRoot, "src", "handlers", "notifications.ts"), "utf8");
    const appSource = fs.readFileSync(path.join(extensionRoot, "src", "chat", "webview", "app.ts"), "utf8");

    expect(appSource).toContain("names: [\"cd\", \"cwd\", \"chdir\", \"workspace\"]");
    expect(dialogsSource).toContain("WorkspaceChangeBlocked");
    expect(dialogsSource).toContain("WorkspaceChangeRequested");
    expect(dialogsSource).toContain("WorkspaceChanged");
    expect(dialogsSource).toContain("iCode workspace changed");
    expect(notificationsSource).toContain("Working directory →");
    expect(notificationsSource).toContain("WorkspaceUpdated");
  });

  it("offers multi-root CWD selection while preserving automatic startup workspace resolution", () => {
    const extensionSource = fs.readFileSync(path.join(extensionRoot, "src", "extension.ts"), "utf8");
    const dialogsSource = readDialogsSource();
    const decisions = fs.readFileSync(path.join(extensionRoot, "DESIGN_DECISIONS.md"), "utf8");
    const checklist = fs.readFileSync(path.join(extensionRoot, "RELEASE_CHECKLIST.md"), "utf8");
    expect(extensionSource).toContain("const resolved = initialWorkspacePath({");
    expect(extensionSource).not.toContain("pickWorkspaceDirectory");
    expect(dialogsSource).toContain("await pickWorkspaceDirectory(rt.currentCwd ?? undefined)");
    expect(decisions).toContain("VS Code workspace folders by name and full path");
    expect(checklist).toContain("multi-root `.code-workspace`");
  });

  it("reads contributed settings through the chrys configuration section", () => {
    const sourceFiles = [
      "src/extension.ts",
      "src/common/chatPanelState.ts",
      "src/ui/dialogs.ts",
      ...fs.readdirSync(path.join(extensionRoot, "src", "ui", "dialogs")).map((name) => `src/ui/dialogs/${name}`),
      "src/approval/modal.ts",
      "src/askUser/modal.ts",
      "src/ui/management.ts",
    ];

    for (const file of sourceFiles) {
      const source = fs.readFileSync(path.join(extensionRoot, file), "utf8");
      expect(source, file).not.toMatch(/getConfiguration\("chrys"\)\.get<[^>]+>\("chrys\./);
      expect(source, file).not.toMatch(/\bconfig\.get<[^>]+>\("chrys\./);
    }
  });
});


describe("advanced Agent parity boundaries", () => {
  it("documents the remaining public-contract gaps and non-persistent compaction option", () => {
    const decisions = fs.readFileSync(path.join(extensionRoot, "DESIGN_DECISIONS.md"), "utf8");
    expect(decisions).toContain("https://github.com/openJiuwen-ai/iCode/issues/5");
    expect(decisions).toContain("programmatic-only");
    expect(decisions).not.toContain("Guided forms remain a separate usability improvement");
  });
});


it("documents frontend drafts separately from backend session replay", () => {
  const decisions = fs.readFileSync(path.join(extensionRoot, "DESIGN_DECISIONS.md"), "utf8");
  expect(decisions).toContain("Drafts are not persisted across webview disposal");
  expect(decisions).toContain("Clone never forks a chat session");
  expect(decisions).toContain("not interrupted backend execution recovery");
});

it("keeps upstream ACP test assets out of the runtime and runs both integration layers", () => {
  const pin = JSON.parse(readSource("tests", "support", "icode-upstream.json"));
  expect(pin.repository).toBe("openJiuwen-ai/iCode");
  expect(pin.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(pin.stubSha256).toMatch(/^[a-f0-9]{64}$/);
  const ci = readSource(".github", "workflows", "ci.yml");
  expect(ci).toContain("tests/support/icode-upstream.json");
  expect(ci).toContain("npm run test:acp-stub");
  expect(ci).toContain("npm run test:integration");
  expect(readSource("RELEASE_CHECKLIST.md")).toContain("tests/README.md");
  expect(readSource("tests", "support", "runtime.ts")).toContain('import { ProcessManager }');
  expect(readSource("tests", "integration", "chrys-binary.test.ts")).not.toContain("class ChrysProcess");
});
