import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = '.';
const DIST = 'dist';

await mkdir(DIST, { recursive: true });

// Vite builds the authenticated React application to dist/app.html first.
// Keep the existing marketing site and investor guide as static public routes.
const rootFiles = ['index.html', 'guide'];
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

console.log('Build complete: dist/ ready for Cloudflare Workers Static Assets');
