#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const assetDir = path.join(root, "src", "chat", "webview", "assets", "companions");
const companionPrefixes = [
  "baize",
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
];
const animationNames = ["idle", "tail", "rest"];
const files = companionPrefixes.flatMap((prefix) => animationNames.map((name) => `${prefix}-gba-${name}.webp`));

for (const tool of ["magick", "identify", "webpmux", "cwebp"]) {
  const result = spawnSync("which", [tool], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${tool} is required to clean companion sprite fringes.`);
  }
}

for (const file of files) {
  cleanWebp(path.join(assetDir, file));
}

function cleanWebp(inputPath) {
  const workDir = mkdtempSync(path.join(tmpdir(), "chrys-companion-fringe-"));
  try {
    let durations = frameDurations(inputPath);
    execFileSync("magick", [inputPath, "-coalesce", path.join(workDir, "frame-%03d.png")]);
    const frames = readdirSync(workDir)
      .filter((entry) => /^frame-\d+\.png$/.test(entry))
      .sort((left, right) => left.localeCompare(right))
      .map((entry) => path.join(workDir, entry));
    if (durations.length === 0 && frames.length === 1) {
      durations = [1000];
    }
    if (frames.length !== durations.length) {
      throw new Error(`${path.basename(inputPath)} frame count mismatch: ${frames.length} frames, ${durations.length} durations`);
    }
    frames.forEach(cleanPng);
    const args = ["-loop", "0", "-bgcolor", "0,0,0,0"];
    frames.forEach((frame, index) => {
      const frameWebp = `${frame}.webp`;
      execFileSync("cwebp", ["-lossless", "-exact", frame, "-o", frameWebp], { stdio: "ignore" });
      args.push("-frame", frameWebp, `+${durations[index]}+0+0+1-b`);
    });
    args.push("-o", inputPath);
    execFileSync("webpmux", args, { stdio: "inherit" });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function frameDurations(inputPath) {
  const info = execFileSync("webpmux", ["-info", inputPath], { encoding: "utf8" });
  return info.split(/\r?\n/)
    .map((line) => /^\s+\d+:\s+/.test(line) ? Number(line.trim().split(/\s+/)[6]) : NaN)
    .filter(Number.isFinite);
}

function cleanPng(filePath) {
  const [width, height] = execFileSync("identify", ["-format", "%w %h", filePath], { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .map(Number);
  const rgba = execFileSync("magick", [filePath, "rgba:-"]);
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3];
    if (alpha === 0) continue;
    const red = rgba[index];
    const green = rgba[index + 1];
    const blue = rgba[index + 2];
    if (!isPurpleFringe(red, green, blue)) continue;
    const [nextRed, nextGreen, nextBlue] = neutralOutline(red, green, blue);
    rgba[index] = nextRed;
    rgba[index + 1] = nextGreen;
    rgba[index + 2] = nextBlue;
  }
  execFileSync("magick", ["-size", `${width}x${height}`, "-depth", "8", "rgba:-", filePath], {
    input: rgba,
  });
}

function isPurpleFringe(red, green, blue) {
  const [hue, saturation, value] = rgbToHsv(red, green, blue);
  return hue >= 255 && hue <= 330 && saturation >= 0.2 && value >= 0.1;
}

function neutralOutline(red, green, blue) {
  const luma = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  if (luma < 42) return [31, 42, 47];
  if (luma < 78) return [48, 63, 70];
  if (luma < 122) return [69, 88, 94];
  if (luma < 170) return [96, 121, 124];
  return [126, 151, 151];
}

function rgbToHsv(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = ((b - r) / delta) + 2;
    else hue = ((r - g) / delta) + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const saturation = max === 0 ? 0 : delta / max;
  return [hue, saturation, max];
}
