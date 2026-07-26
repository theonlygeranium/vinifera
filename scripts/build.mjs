import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

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

console.log(
  IS_CLOUDFLARE_PAGES
    ? 'Build complete: dist/ contains the verified Pages rollback baseline'
    : 'Build complete: dist/ ready for Cloudflare Workers Static Assets',
);
