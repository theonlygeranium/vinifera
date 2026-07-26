import { mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = '.';
const DIST = 'dist';

// Clean dist
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

// Copy root HTML files
const rootFiles = ['index.html', 'app.html'];
for (const f of rootFiles) {
  await copyFile(join(ROOT, f), join(DIST, f));
  console.log(`  copied ${f}`);
}

// Copy public/ contents (includes _redirects, _headers)
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

console.log('Build complete: dist/ ready for Cloudflare Pages');
