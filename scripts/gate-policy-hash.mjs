#!/usr/bin/env node
// Generate exact policy-hash entries for hosted-gate activation (Gates 13 & 16).
//
// The Gate 13 and Gate 16 acceptance controllers fail closed unless each
// `*Sha256` array in their policy file contains the SHA-256 of the exact,
// normalized target value. Computing those by hand — with the controller's
// precise origin/path/hostname normalization — is the most error-prone step in
// the activation runbooks. This helper removes that toil by REUSING each
// controller's own `sha256` and normalization functions, so the emitted hashes
// cannot drift from what the controller checks.
//
// Safety: read-only. It computes hashes from values you supply locally, prints
// only the resulting policy JSON (never the source secret values), makes no
// network calls, and writes/mutates nothing.
//
// Usage:
//   # Gate 13: reads the same env var names the workflow uses.
//   SHIPCOMPLIANT_ACCOUNT_ID=... SHIPCOMPLIANT_LICENSE_ID=... \
//   SHIPCOMPLIANT_CONTRACT_VERSION=... SHIPCOMPLIANT_BASE_URL=... \
//   SHIPCOMPLIANT_TOKEN_PATH=... SHIPCOMPLIANT_CHECK_PATH=... \
//   STAGING_WORKER_ORIGIN=... SUPABASE_URL=... \
//     node scripts/gate-policy-hash.mjs gate13
//
//   # Gate 16: derives policy hashes from your acceptance manifest JSON.
//   node scripts/gate-policy-hash.mjs gate16 --manifest ./gate16-manifest.json
//
//   # Manifest byte hash for STAGING_GATE1{3,6}_ACCEPTANCE_MANIFEST_SHA256.
//   node scripts/gate-policy-hash.mjs manifest-sha256 --manifest ./manifest.json
//
// Paste the printed policy object into the matching config/*-policy.json through
// the normal reviewed dev -> staging -> main path. The controller re-derives and
// fail-closed compares these hashes, so a wrong value produces a precise error
// rather than a silent pass.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  sha256,
  exactHttpsOrigin,
  exactApiPath,
} from "./hosted-gate13-shipcompliant-acceptance.mjs";
import {
  validateManifest as validateGate16Manifest,
} from "./hosted-gate16-custom-hostname-acceptance.mjs";

function requiredEnv(env, name) {
  const value = typeof env[name] === "string" ? env[name].trim() : "";
  if (!value) throw new Error(`${name} is required in the environment.`);
  return value;
}

// Field order mirrors config/shipcompliant-staging-acceptance-policy.json so the
// output is paste-ready.
export function gate13PolicyHashes(env = process.env) {
  return {
    schemaVersion: 1,
    enabled: true,
    accountIdSha256: [sha256(requiredEnv(env, "SHIPCOMPLIANT_ACCOUNT_ID"))],
    contractVersionSha256: [
      sha256(requiredEnv(env, "SHIPCOMPLIANT_CONTRACT_VERSION")),
    ],
    licenseIdSha256: [sha256(requiredEnv(env, "SHIPCOMPLIANT_LICENSE_ID"))],
    sandboxOriginSha256: [
      sha256(exactHttpsOrigin(env.SHIPCOMPLIANT_BASE_URL, "SHIPCOMPLIANT_BASE_URL")),
    ],
    tokenPathSha256: [
      sha256(exactApiPath(env.SHIPCOMPLIANT_TOKEN_PATH, "SHIPCOMPLIANT_TOKEN_PATH")),
    ],
    checkPathSha256: [
      sha256(exactApiPath(env.SHIPCOMPLIANT_CHECK_PATH, "SHIPCOMPLIANT_CHECK_PATH")),
    ],
    stagingWorkerOriginSha256: [
      sha256(exactHttpsOrigin(env.STAGING_WORKER_ORIGIN, "STAGING_WORKER_ORIGIN")),
    ],
    stagingSupabaseUrlSha256: [
      sha256(exactHttpsOrigin(env.SUPABASE_URL, "SUPABASE_URL")),
    ],
  };
}

// Field order mirrors config/gate16-custom-hostname-acceptance-policy.json.
export function gate16PolicyHashes(manifestText) {
  const manifest = validateGate16Manifest(JSON.parse(manifestText));
  return {
    schemaVersion: 1,
    enabled: true,
    customHostnameSha256: [sha256(manifest.customHostname)],
    cloudflareZoneIdSha256: [sha256(manifest.cloudflareZoneId)],
    fallbackOriginSha256: [sha256(manifest.fallbackOrigin)],
    stagingSupabaseUrlSha256: [sha256(manifest.supabaseUrl)],
  };
}

// Matches the controllers' sha256(manifestText) evidence-binding check.
export function manifestSha256(manifestText) {
  return sha256(manifestText);
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      index += 1;
    }
  }
  return flags;
}

function readManifestText(flags) {
  if (typeof flags.manifest !== "string") {
    throw new Error("--manifest <path> is required.");
  }
  return readFileSync(flags.manifest, "utf8");
}

function main(argv) {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  if (command === "gate13") {
    process.stdout.write(`${JSON.stringify(gate13PolicyHashes(), null, 2)}\n`);
    return;
  }
  if (command === "gate16") {
    process.stdout.write(
      `${JSON.stringify(gate16PolicyHashes(readManifestText(flags)), null, 2)}\n`,
    );
    return;
  }
  if (command === "manifest-sha256") {
    process.stdout.write(`${manifestSha256(readManifestText(flags))}\n`);
    return;
  }
  throw new Error(
    "Usage: gate-policy-hash.mjs <gate13|gate16|manifest-sha256> [--manifest <path>]",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
