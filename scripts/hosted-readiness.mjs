import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PHASE_TABLES = Object.freeze({
  phase1: "organizations",
  phase5: "brands",
});

const SECRET_GROUPS = Object.freeze([
  {
    provider: "cloudflare",
    logicalName: "CLOUDFLARE_ACCOUNT_ID",
    aliases: ["CLOUDFLARE_ACCOUNT_ID"],
  },
  {
    provider: "cloudflare",
    logicalName: "CLOUDFLARE_API_TOKEN",
    aliases: ["CLOUDFLARE_API_TOKEN"],
  },
  {
    provider: "supabase",
    logicalName: "SUPABASE_URL",
    aliases: ["SUPABASE_URL"],
  },
  {
    provider: "supabase",
    logicalName: "SUPABASE_PUBLISHABLE_KEY|SUPABASE_ANON_KEY",
    aliases: ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"],
  },
  {
    provider: "supabase",
    logicalName: "SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY",
    aliases: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  },
  {
    provider: "stripe",
    logicalName: "STRIPE_SECRET_KEY",
    aliases: ["STRIPE_SECRET_KEY"],
  },
  {
    provider: "stripe",
    logicalName: "STRIPE_PRICE_VINE",
    aliases: ["STRIPE_PRICE_VINE"],
  },
  {
    provider: "stripe",
    logicalName: "STRIPE_PRICE_CELLAR",
    aliases: ["STRIPE_PRICE_CELLAR"],
  },
  {
    provider: "stripe",
    logicalName: "STRIPE_PRICE_ESTATE",
    aliases: ["STRIPE_PRICE_ESTATE"],
  },
  {
    provider: "stripe",
    logicalName: "STRIPE_PRICE_RESERVE",
    aliases: ["STRIPE_PRICE_RESERVE"],
  },
  {
    provider: "stripe",
    logicalName: "STRIPE_WEBHOOK_SECRET",
    aliases: ["STRIPE_WEBHOOK_SECRET"],
  },
]);

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function genericValue(env, name) {
  const mappedName = `GENERIC_${name}`;
  return Object.hasOwn(env, mappedName) ? env[mappedName] : env[name];
}

function availabilityFor(env, name) {
  return {
    generic: hasValue(genericValue(env, name)),
    staging: hasValue(env[`STAGING_${name}`]),
  };
}

function selectSecret(env, group) {
  for (const name of group.aliases) {
    const value = env[`STAGING_${name}`];
    if (hasValue(value)) {
      return { name, source: "staging", value: value.trim() };
    }
  }

  for (const name of group.aliases) {
    const value = genericValue(env, name);
    if (hasValue(value)) {
      return { name, source: "generic", value: value.trim() };
    }
  }

  return { name: null, source: "missing", value: null };
}

function classifySources(selectedGroups) {
  const presentSources = new Set(
    selectedGroups
      .map((entry) => entry.selected.source)
      .filter((source) => source !== "missing"),
  );
  const hasMissing = selectedGroups.some(
    (entry) => entry.selected.source === "missing",
  );

  if (presentSources.size === 0) {
    return "missing";
  }
  if (hasMissing) {
    return "partial";
  }
  if (presentSources.size > 1) {
    return "mixed";
  }
  return presentSources.values().next().value;
}

export function resolveCredentialState(env = process.env) {
  const selectedGroups = SECRET_GROUPS.map((group) => ({
    ...group,
    selected: selectSecret(env, group),
  }));

  const availability = Object.fromEntries(
    [...new Set(SECRET_GROUPS.flatMap((group) => group.aliases))]
      .sort()
      .map((name) => [name, availabilityFor(env, name)]),
  );

  const providers = Object.fromEntries(
    ["cloudflare", "supabase", "stripe"].map((provider) => {
      const providerGroups = selectedGroups.filter(
        (entry) => entry.provider === provider,
      );
      return [provider, classifySources(providerGroups)];
    }),
  );

  return {
    availability,
    selectedGroups,
    sourceClassification: {
      overall: classifySources(selectedGroups),
      providers,
    },
    missingNames: selectedGroups
      .filter((entry) => entry.selected.source === "missing")
      .map((entry) => entry.logicalName),
    missingStagingNames: selectedGroups
      .filter((entry) =>
        entry.aliases.every(
          (name) => !availabilityFor(env, name).staging,
        ),
      )
      .map(
        (entry) =>
          entry.aliases.map((name) => `STAGING_${name}`).join("|"),
      ),
  };
}

function selectedValue(credentialState, logicalName) {
  return (
    credentialState.selectedGroups.find(
      (entry) => entry.logicalName === logicalName,
    )?.selected.value ?? null
  );
}

function stripeMode(secret) {
  if (!secret) {
    return "missing";
  }
  if (secret.startsWith("sk_test_")) {
    return "test";
  }
  if (secret.startsWith("sk_live_")) {
    return "live";
  }
  return "unsupported";
}

function safeSupabaseBaseUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname.toLowerCase())
    ) {
      return null;
    }
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed;
  } catch {
    return null;
  }
}

async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Probe output is intentionally independent of provider response bodies.
  }
}

async function statusProbe(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      ...init,
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    const ok = response.ok;
    await discardBody(response);
    return ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function cloudflareTokenProbe(fetchImpl, token, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      await discardBody(response);
      return false;
    }

    const payload = await response.json();
    return (
      payload !== null &&
      typeof payload === "object" &&
      payload.success === true &&
      payload.result !== null &&
      typeof payload.result === "object" &&
      payload.result.status === "active"
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function tableProbeUrl(baseUrl, table) {
  const url = new URL(`/rest/v1/${table}`, baseUrl);
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "0");
  return url;
}

function supabaseServerHeaders(serverKey) {
  const headers = {
    apikey: serverKey,
    Accept: "application/json",
  };
  if (!serverKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${serverKey}`;
  }
  return headers;
}

function determineSafeNextGate(report) {
  if (report.probes.stripe.secretMode === "live") {
    return "replace_live_stripe_key_with_test_key";
  }
  if (report.probes.stripe.secretMode === "unsupported") {
    return "replace_unsupported_stripe_key_with_test_key";
  }
  if (!report.probes.cloudflare.credentialsComplete) {
    return "configure_cloudflare_read_credentials";
  }
  if (
    !report.probes.cloudflare.tokenValid ||
    !report.probes.cloudflare.workersReadCapable
  ) {
    return "repair_cloudflare_read_access";
  }
  if (!report.probes.supabase.credentialsComplete) {
    return "configure_supabase_probe_credentials";
  }
  if (
    !report.probes.supabase.authReachable ||
    !report.probes.supabase.phase1TableExists ||
    !report.probes.supabase.phase5TableExists
  ) {
    return "repair_supabase_hosted_foundation";
  }
  if (report.probes.stripe.secretMode === "missing") {
    return "configure_stripe_test_key";
  }
  if (!report.probes.stripe.apiReachable) {
    return "repair_stripe_test_api_access";
  }
  if (!report.probes.stripe.requiredNamesComplete) {
    return "configure_stripe_test_prices_and_webhook";
  }
  if (
    report.credentials.sourceClassification.overall !== "staging"
  ) {
    return "provision_staging_scoped_credentials";
  }
  return "ready_for_guarded_staging_activation";
}

export async function runHostedReadinessProbe({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  const credentialState = resolveCredentialState(env);
  const cloudflareAccountId = selectedValue(
    credentialState,
    "CLOUDFLARE_ACCOUNT_ID",
  );
  const cloudflareToken = selectedValue(
    credentialState,
    "CLOUDFLARE_API_TOKEN",
  );
  const supabaseUrl = safeSupabaseBaseUrl(
    selectedValue(credentialState, "SUPABASE_URL"),
  );
  const supabasePublicKey = selectedValue(
    credentialState,
    "SUPABASE_PUBLISHABLE_KEY|SUPABASE_ANON_KEY",
  );
  const supabaseServerKey = selectedValue(
    credentialState,
    "SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY",
  );
  const stripeSecret = selectedValue(
    credentialState,
    "STRIPE_SECRET_KEY",
  );
  const detectedStripeMode = stripeMode(stripeSecret);

  const cloudflareCredentialsComplete = Boolean(
    cloudflareAccountId && cloudflareToken,
  );
  let cloudflareTokenValid = false;
  let cloudflareWorkersReadCapable = false;
  if (cloudflareCredentialsComplete) {
    cloudflareTokenValid = await cloudflareTokenProbe(
      fetchImpl,
      cloudflareToken,
      timeoutMs,
    );
    if (cloudflareTokenValid) {
      cloudflareWorkersReadCapable = await statusProbe(
        fetchImpl,
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/workers/scripts`,
        {
          headers: {
            Authorization: `Bearer ${cloudflareToken}`,
            Accept: "application/json",
          },
        },
        timeoutMs,
      );
    }
  }

  const supabaseAuthCredentialsComplete = Boolean(
    supabaseUrl && supabasePublicKey,
  );
  const supabaseTableCredentialsComplete = Boolean(
    supabaseUrl && supabaseServerKey,
  );
  let supabaseAuthReachable = false;
  let phase1TableExists = false;
  let phase5TableExists = false;

  if (supabaseAuthCredentialsComplete) {
    supabaseAuthReachable = await statusProbe(
      fetchImpl,
      new URL("/auth/v1/settings", supabaseUrl),
      {
        headers: {
          apikey: supabasePublicKey,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
  }

  if (supabaseTableCredentialsComplete) {
    const tableHeaders = supabaseServerHeaders(supabaseServerKey);
    phase1TableExists = await statusProbe(
      fetchImpl,
      tableProbeUrl(supabaseUrl, PHASE_TABLES.phase1),
      { headers: tableHeaders },
      timeoutMs,
    );
    phase5TableExists = await statusProbe(
      fetchImpl,
      tableProbeUrl(supabaseUrl, PHASE_TABLES.phase5),
      { headers: tableHeaders },
      timeoutMs,
    );
  }

  let stripeApiReachable = false;
  const stripeApiProbeAttempted = detectedStripeMode === "test";
  if (stripeApiProbeAttempted) {
    stripeApiReachable = await statusProbe(
      fetchImpl,
      "https://api.stripe.com/v1/balance",
      {
        headers: {
          Authorization: `Bearer ${stripeSecret}`,
          Accept: "application/json",
        },
      },
      timeoutMs,
    );
  }

  const stripeRequiredNames = Object.fromEntries(
    [
      "STRIPE_PRICE_VINE",
      "STRIPE_PRICE_CELLAR",
      "STRIPE_PRICE_ESTATE",
      "STRIPE_PRICE_RESERVE",
      "STRIPE_WEBHOOK_SECRET",
    ].map((name) => [name, Boolean(selectedValue(credentialState, name))]),
  );

  const report = {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    readOnly: true,
    credentials: {
      availability: credentialState.availability,
      sourceClassification: credentialState.sourceClassification,
      missingNames: credentialState.missingNames,
      missingStagingNames: credentialState.missingStagingNames,
    },
    probes: {
      cloudflare: {
        credentialsComplete: cloudflareCredentialsComplete,
        tokenValid: cloudflareTokenValid,
        workersReadCapable: cloudflareWorkersReadCapable,
      },
      supabase: {
        credentialsComplete:
          supabaseAuthCredentialsComplete &&
          supabaseTableCredentialsComplete,
        authReachable: supabaseAuthReachable,
        phase1TableExists,
        phase5TableExists,
      },
      stripe: {
        credentialPresent: Boolean(stripeSecret),
        secretMode: detectedStripeMode,
        apiProbeAttempted: stripeApiProbeAttempted,
        apiReachable: stripeApiReachable,
        requiredNames: stripeRequiredNames,
        requiredNamesComplete: Object.values(stripeRequiredNames).every(
          Boolean,
        ),
      },
    },
    safeNextGate: "",
  };
  report.safeNextGate = determineSafeNextGate(report);
  return report;
}

const SAFE_GATE_LABELS = Object.freeze({
  replace_live_stripe_key_with_test_key:
    "Replace the live Stripe key with a sandbox test key before any Stripe probe.",
  replace_unsupported_stripe_key_with_test_key:
    "Replace the unsupported Stripe credential with an sk_test_ key.",
  configure_cloudflare_read_credentials:
    "Configure the Cloudflare account identifier and a read-capable API token.",
  repair_cloudflare_read_access:
    "Repair Cloudflare token validity or Workers Scripts Read access.",
  configure_supabase_probe_credentials:
    "Configure the Supabase project URL, public key, and server-side probe key.",
  repair_supabase_hosted_foundation:
    "Repair Supabase Auth reachability or apply the hosted Phase 1 through Phase 5 tables.",
  configure_stripe_test_key:
    "Configure a Stripe sk_test_ secret key.",
  repair_stripe_test_api_access:
    "Repair read-only Stripe test API access.",
  configure_stripe_test_prices_and_webhook:
    "Configure all four Stripe test Price names and the webhook signing secret.",
  provision_staging_scoped_credentials:
    "Provision the verified credentials under STAGING_* names in the protected staging environment.",
  ready_for_guarded_staging_activation:
    "Credential and read-only hosted probes are ready for the separate guarded staging activation gate.",
});

function yesNo(value) {
  return value ? "yes" : "no";
}

export function renderReadinessMarkdown(report) {
  const missingNames =
    report.credentials.missingNames.length > 0
      ? report.credentials.missingNames.map((name) => `\`${name}\``).join(", ")
      : "none";
  const missingStagingNames =
    report.credentials.missingStagingNames.length > 0
      ? report.credentials.missingStagingNames
          .map((name) => `\`${name}\``)
          .join(", ")
      : "none";

  return `## Hosted readiness probe

This report contains only read-only booleans and credential-name classifications. Provider response bodies and credential values are never emitted.

| Probe | Result |
| --- | --- |
| Cloudflare credentials complete | ${yesNo(report.probes.cloudflare.credentialsComplete)} |
| Cloudflare token active | ${yesNo(report.probes.cloudflare.tokenValid)} |
| Cloudflare Workers read capability | ${yesNo(report.probes.cloudflare.workersReadCapable)} |
| Supabase credentials complete | ${yesNo(report.probes.supabase.credentialsComplete)} |
| Supabase Auth reachable | ${yesNo(report.probes.supabase.authReachable)} |
| Supabase Phase 1 table present | ${yesNo(report.probes.supabase.phase1TableExists)} |
| Supabase Phase 5 table present | ${yesNo(report.probes.supabase.phase5TableExists)} |
| Stripe credential mode | ${report.probes.stripe.secretMode} |
| Stripe API probe attempted | ${yesNo(report.probes.stripe.apiProbeAttempted)} |
| Stripe test API reachable | ${yesNo(report.probes.stripe.apiReachable)} |
| Stripe Price and webhook names complete | ${yesNo(report.probes.stripe.requiredNamesComplete)} |

- Credential source: ${report.credentials.sourceClassification.overall}
- Cloudflare source: ${report.credentials.sourceClassification.providers.cloudflare}
- Supabase source: ${report.credentials.sourceClassification.providers.supabase}
- Stripe source: ${report.credentials.sourceClassification.providers.stripe}
- Missing credential names: ${missingNames}
- Missing staging names: ${missingStagingNames}
- Safe next gate: ${SAFE_GATE_LABELS[report.safeNextGate]}
`;
}

function parseArguments(argv) {
  const options = { jsonPath: null, markdownPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.jsonPath = argv[index + 1] ?? null;
      index += 1;
    } else if (argument === "--markdown") {
      options.markdownPath = argv[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error("Unsupported argument.");
    }
  }
  if (!options.jsonPath) {
    throw new Error("--json is required.");
  }
  return options;
}

async function writePrivateFile(path, contents) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const report = await runHostedReadinessProbe();
  await writePrivateFile(
    options.jsonPath,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (options.markdownPath) {
    await writePrivateFile(
      options.markdownPath,
      renderReadinessMarkdown(report),
    );
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
