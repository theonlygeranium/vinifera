import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const source = (name) =>
  resolve(root, "mobile", "assets", `vinifera-mobile-${name}.svg`);

async function writePng(input, output, width, height = width, opaque = false) {
  await mkdir(dirname(output), { recursive: true });
  const image = sharp(input).resize(width, height, { fit: "fill" });
  if (opaque) image.flatten({ background: "#F7F4EE" }).removeAlpha();
  await image
    .png({ compressionLevel: 9 })
    .toFile(output);
}

const mark = await readFile(source("mark"));
const foreground = await readFile(source("foreground"));
const splash = await readFile(source("splash"));

await writePng(
  mark,
  resolve(
    root,
    "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  ),
  1024,
  1024,
  true,
);

for (const filename of [
  "splash-2732x2732.png",
  "splash-2732x2732-1.png",
  "splash-2732x2732-2.png",
]) {
  await writePng(
    splash,
    resolve(root, "ios/App/App/Assets.xcassets/Splash.imageset", filename),
    2732,
    2732,
    true,
  );
}

const androidIcons = [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432],
];
for (const [density, legacySize, foregroundSize] of androidIcons) {
  const directory = resolve(root, `android/app/src/main/res/mipmap-${density}`);
  await writePng(mark, resolve(directory, "ic_launcher.png"), legacySize, legacySize, true);
  await writePng(mark, resolve(directory, "ic_launcher_round.png"), legacySize, legacySize, true);
  await writePng(
    foreground,
    resolve(directory, "ic_launcher_foreground.png"),
    foregroundSize,
  );
}

const androidSplashes = [
  ["drawable/splash.png", 480, 320],
  ["drawable-land-mdpi/splash.png", 480, 320],
  ["drawable-land-hdpi/splash.png", 800, 480],
  ["drawable-land-xhdpi/splash.png", 1280, 720],
  ["drawable-land-xxhdpi/splash.png", 1600, 960],
  ["drawable-land-xxxhdpi/splash.png", 1920, 1280],
  ["drawable-port-mdpi/splash.png", 320, 480],
  ["drawable-port-hdpi/splash.png", 480, 800],
  ["drawable-port-xhdpi/splash.png", 720, 1280],
  ["drawable-port-xxhdpi/splash.png", 960, 1600],
  ["drawable-port-xxxhdpi/splash.png", 1280, 1920],
];
for (const [relativePath, width, height] of androidSplashes) {
  await writePng(
    splash,
    resolve(root, "android/app/src/main/res", relativePath),
    width,
    height,
    true,
  );
}

console.log("Generated Vinifera iOS and Android icon/splash assets.");
