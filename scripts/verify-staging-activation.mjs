import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  hashActivationTarget,
  verifyActivationTarget,
  verifyStagingCustomHostnameOrigin,
} from "./lib/activation-guard.mjs";

const allowlistPath = resolve(
  import.meta.dirname,
  "../config/hosted-target-allowlist.json",
);
const allowlist = JSON.parse(await readFile(allowlistPath, "utf8"));
const [operation, kind] = process.argv.slice(2);

if (operation === "hash") {
  const environmentName = {
    cloudflare: "CLOUDFLARE_ACCOUNT_ID",
    "cloudflare-origin": "CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN",
    "cloudflare-zone": "CLOUDFLARE_ZONE_ID",
    "fcm-project": "FCM_PROJECT_ID",
    "shipcompliant-origin": "SHIPCOMPLIANT_BASE_URL",
    supabase: "SUPABASE_PROJECT_ID",
  }[kind];
  if (!environmentName) {
    throw new Error("Hash operation target is unsupported.");
  }
  console.log(hashActivationTarget(kind, process.env[environmentName]));
} else if (operation === "verify-target") {
  const environmentName = {
    cloudflare: "CLOUDFLARE_ACCOUNT_ID",
    "cloudflare-origin": "CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN",
    "cloudflare-zone": "CLOUDFLARE_ZONE_ID",
    "fcm-project": "FCM_PROJECT_ID",
    "shipcompliant-origin": "SHIPCOMPLIANT_BASE_URL",
    supabase: "SUPABASE_PROJECT_ID",
  }[kind];
  if (!environmentName) {
    throw new Error("Target verification target is unsupported.");
  }
  verifyActivationTarget({
    allowlist,
    kind,
    rawValue: process.env[environmentName],
  });
  console.log(`Verified allowlisted staging ${kind} target.`);
} else if (operation === "verify-custom-hostname-origin") {
  const result = verifyStagingCustomHostnameOrigin(
    process.env.CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN,
    allowlist.deniedProductionCustomHostnameOrigins,
    allowlist.staging.cloudflareFallbackOriginSha256,
  );
  console.log(
    result.configured
      ? "Verified canonical non-production staging custom-hostname origin."
      : "Staging custom-hostname origin is not configured; custom domains remain activation-required.",
  );
} else {
  throw new Error(
    "Usage: verify-staging-activation.mjs <hash|verify-target> <target> or verify-custom-hostname-origin",
  );
}
