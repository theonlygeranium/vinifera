import { mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = '.';
const DIST = 'dist';

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

const rootFiles = ['index.html', 'app', 'guide'];
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

console.log('Build complete: dist/ ready for Cloudflare Pages');
