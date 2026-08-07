import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = '.';
const DIST = 'dist';
const IS_CLOUDFLARE_PAGES = process.env.CF_PAGES === '1';

await mkdir(DIST, { recursive: true });

// Vite builds the authenticated React application to dist/app.html first.
// Keep the existing marketing site and investor guide as static public routes.
const rootFiles = [
  'index.html',
  'guide',
  ...(IS_CLOUDFLARE_PAGES ? ['app'] : []),
];
for (const f of rootFiles) {
  await copyFile(join(ROOT, f), join(DIST, f));
  console.log(`  copied ${f}`);
}

const pubDir = join(ROOT, 'public');
try {
  const pubFiles = await readdir(pubDir);
  for (const f of pubFiles) {
    await copyFile(join(pubDir, f), join(DIST, f));
    console.log(`  copied public/${f}`);
  }
} catch {
  console.log('  no public/ directory');
}

const iconDirectory = join(DIST, 'icons');
await mkdir(iconDirectory, { recursive: true });
for (const size of [192, 512]) {
  const target = join(iconDirectory, `vinifera-${size}.png`);
  await sharp(join(ROOT, 'mobile/assets/vinifera-mobile-mark.svg'))
    .resize(size, size)
    .png()
    .toFile(target);
  console.log(`  generated ${target}`);
}

console.log(
  IS_CLOUDFLARE_PAGES
    ? 'Build complete: dist/ contains the verified Pages rollback baseline'
    : 'Build complete: dist/ ready for Cloudflare Workers Static Assets',
);
