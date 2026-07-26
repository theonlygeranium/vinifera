import { createHash } from "node:crypto";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const COMPILE_ONLY_ORIGIN = "https://unconfigured.invalid";
const PRODUCTION_MOBILE_ORIGIN = "https://vinifera.edstratumlabs.ai";

const TARGETS = {
  cloudflare: {
    allowlistKey: "cloudflareAccountIdSha256",
    deniedKey: "cloudflareAccountIdSha256",
    environmentName: "CLOUDFLARE_ACCOUNT_ID",
    label: "Cloudflare account ID",
    normalize(value) {
      const normalized = String(value ?? "").trim().toLowerCase();
      if (!CLOUDFLARE_ACCOUNT_ID_PATTERN.test(normalized)) {
        throw new Error("The supplied Cloudflare account ID has an invalid format.");
      }
      return normalized;
    },
  },
  supabase: {
    allowlistKey: "supabaseProjectRefSha256",
    deniedKey: "supabaseProjectRefSha256",
    environmentName: "SUPABASE_PROJECT_ID",
    label: "Supabase project ref",
    normalize(value) {
      const normalized = String(value ?? "").trim().toLowerCase();
      if (!SUPABASE_PROJECT_REF_PATTERN.test(normalized)) {
        throw new Error("The supplied Supabase project ref has an invalid format.");
      }
      return normalized;
    },
  },
};

function targetDefinition(kind) {
  const definition = TARGETS[kind];
  if (!definition) {
    throw new Error("Activation target kind must be supabase or cloudflare.");
  }
  return definition;
}

function validatedHashList(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !SHA256_PATTERN.test(entry))
  ) {
    throw new Error(`${label} must contain only lowercase SHA-256 hashes.`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} contains duplicate hashes.`);
  }
  return value;
}

export function hashActivationTarget(kind, rawValue) {
  const definition = targetDefinition(kind);
  const normalized = definition.normalize(rawValue);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function verifyActivationTarget({
  allowlist,
  kind,
  rawValue,
}) {
  if (!allowlist || allowlist.version !== 1) {
    throw new Error("Hosted target allowlist version is unsupported.");
  }
  const definition = targetDefinition(kind);
  const stagingHashes = validatedHashList(
    allowlist.staging?.[definition.allowlistKey],
    `staging.${definition.allowlistKey}`,
  );
  const deniedHashes = validatedHashList(
    allowlist.deniedProduction?.[definition.deniedKey],
    `deniedProduction.${definition.deniedKey}`,
  );
  if (stagingHashes.length === 0) {
    throw new Error(
      `No staging ${definition.label} hashes are allowlisted; hosted activation is blocked.`,
    );
  }
  const overlap = stagingHashes.some((hash) => deniedHashes.includes(hash));
  if (overlap) {
    throw new Error(
      `The ${definition.label} target policy contains an allow/deny conflict.`,
    );
  }
  const targetHash = hashActivationTarget(kind, rawValue);
  if (deniedHashes.includes(targetHash)) {
    throw new Error(
      `The supplied ${definition.label} is a denied production target.`,
    );
  }
  if (!stagingHashes.includes(targetHash)) {
    throw new Error(
      `The supplied ${definition.label} is not an allowlisted staging target.`,
    );
  }
  return {
    environmentName: definition.environmentName,
    kind,
    targetHash,
  };
}

function parseHostnameInput(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    throw new Error("Custom-hostname origin is empty.");
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Custom-hostname origin has an invalid format.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  return { hostname, parsed, value };
}

export function verifyStagingCustomHostnameOrigin(
  rawValue,
  deniedProductionOrigins,
) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return { configured: false, hostname: null };
  }
  if (
    !Array.isArray(deniedProductionOrigins) ||
    deniedProductionOrigins.length === 0
  ) {
    throw new Error("Production custom-hostname origin denylist is empty.");
  }
  const denied = deniedProductionOrigins.map((origin) => {
    const { hostname } = parseHostnameInput(origin);
    return hostname;
  });
  const { hostname, parsed, value } = parseHostnameInput(rawValue);
  if (denied.includes(hostname)) {
    throw new Error(
      "The staging custom-hostname origin resolves to a denied production origin.",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !HOSTNAME_PATTERN.test(hostname) ||
    hostname === "localhost" ||
    /^[0-9.]+$/.test(hostname) ||
    value !== hostname
  ) {
    throw new Error(
      "The staging custom-hostname origin must be one canonical HTTPS hostname without scheme, credentials, port, path, query, or fragment.",
    );
  }
  return { configured: true, hostname };
}

function canonicalHttpsOrigin(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    throw new Error("VITE_MOBILE_API_ORIGIN is required for native preparation.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "VITE_MOBILE_API_ORIGIN must be a credential-free HTTPS origin.",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !HOSTNAME_PATTERN.test(parsed.hostname.toLowerCase())
  ) {
    throw new Error(
      "VITE_MOBILE_API_ORIGIN must be a credential-free default-port HTTPS origin.",
    );
  }
  return parsed.origin.toLowerCase();
}

export function resolveMobileBuildTarget({
  apiOrigin,
  buildProfile,
  productionAuthorized,
}) {
  const origin = canonicalHttpsOrigin(apiOrigin);
  const profile = String(buildProfile ?? "").trim();
  if (profile === "compile-only") {
    if (origin !== COMPILE_ONLY_ORIGIN) {
      throw new Error(
        "Compile-only native builds must use https://unconfigured.invalid.",
      );
    }
    return { classification: "compile-only", origin, profile };
  }
  if (profile === "staging-runtime") {
    const hostname = new URL(origin).hostname;
    if (
      !hostname.startsWith("vinifera-staging.") ||
      !hostname.endsWith(".workers.dev") ||
      hostname === "vinifera-staging.workers.dev"
    ) {
      throw new Error(
        "Native runtime QA requires the isolated vinifera-staging workers.dev origin.",
      );
    }
    return { classification: "staging-runtime-qa", origin, profile };
  }
  if (profile === "production-authorized") {
    if (
      origin !== PRODUCTION_MOBILE_ORIGIN ||
      productionAuthorized !== "true"
    ) {
      throw new Error(
        "The production native API origin requires separate explicit authorization.",
      );
    }
    return { classification: "production-authorized", origin, profile };
  }
  throw new Error(
    "MOBILE_BUILD_PROFILE must be compile-only, staging-runtime, or production-authorized.",
  );
}

export const activationGuardConstants = {
  compileOnlyOrigin: COMPILE_ONLY_ORIGIN,
  productionMobileOrigin: PRODUCTION_MOBILE_ORIGIN,
};
