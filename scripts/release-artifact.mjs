import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function exactSha(value, label = "Source") {
  if (!/^[0-9a-f]{40}$/.test(value || "")) {
    throw new Error(`${label} SHA must be an exact lowercase commit.`);
  }
  return value;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function inventory(root) {
  const absoluteRoot = resolve(root);
  const files = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error("Release artifacts may not contain symbolic links.");
      }
      if (stat.isDirectory()) visit(absolute);
      else if (stat.isFile()) {
        const path = relative(absoluteRoot, absolute).replaceAll("\\", "/");
        files.push({
          path,
          sha256: sha256(readFileSync(absolute)),
          size: stat.size,
        });
      } else {
        throw new Error("Release artifacts may contain only files and directories.");
      }
    }
  }
  visit(absoluteRoot);
  if (files.length === 0) throw new Error("Release artifact directory is empty.");
  return files;
}

function inventoryDigest(files) {
  return sha256(
    Buffer.from(
      files
        .map(({ path, sha256: digest, size }) => `${path}\0${size}\0${digest}\n`)
        .join(""),
      "utf8",
    ),
  );
}

export function buildReleaseManifest({
  assetsDirectory,
  bundlePath,
  sourceSha,
}) {
  const exactSourceSha = exactSha(sourceSha);
  const absoluteBundle = resolve(bundlePath);
  const bundleStat = lstatSync(absoluteBundle);
  if (bundleStat.isSymbolicLink() || !bundleStat.isFile()) {
    throw new Error("Release Worker bundle must be one regular file.");
  }
  const bundle = readFileSync(absoluteBundle);
  const assets = inventory(assetsDirectory);
  const manifest = {
    schemaVersion: 1,
    sourceSha: exactSourceSha,
    worker: {
      path: "worker/worker.js",
      sha256: sha256(bundle),
      size: bundle.length,
    },
    assets: {
      files: assets,
      sha256: inventoryDigest(assets),
    },
  };
  return {
    ...manifest,
    artifactSha256: sha256(
      Buffer.from(JSON.stringify(manifest), "utf8"),
    ),
  };
}

export function verifyReleaseManifest({
  assetsDirectory,
  bundlePath,
  manifest,
  sourceSha,
}) {
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    !/^[0-9a-f]{64}$/.test(manifest.artifactSha256 || "")
  ) {
    throw new Error("Release manifest is malformed.");
  }
  const expected = buildReleaseManifest({
    assetsDirectory,
    bundlePath,
    sourceSha: exactSha(sourceSha),
  });
  if (JSON.stringify(expected) !== JSON.stringify(manifest)) {
    throw new Error("Release artifact does not match its immutable manifest.");
  }
  return expected;
}

function usage() {
  throw new Error(
    "Usage: release-artifact.mjs create|verify <source-sha> <bundle> <assets> <manifest>",
  );
}

function main(argv) {
  const [operation, sourceSha, bundlePath, assetsDirectory, manifestPath] = argv;
  if (
    !["create", "verify"].includes(operation) ||
    !sourceSha ||
    !bundlePath ||
    !assetsDirectory ||
    !manifestPath
  ) {
    usage();
  }
  if (operation === "create") {
    const manifest = buildReleaseManifest({
      assetsDirectory,
      bundlePath,
      sourceSha,
    });
    writeFileSync(resolve(manifestPath), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });
    return;
  }
  verifyReleaseManifest({
    assetsDirectory,
    bundlePath,
    manifest: JSON.parse(readFileSync(resolve(manifestPath), "utf8")),
    sourceSha,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
