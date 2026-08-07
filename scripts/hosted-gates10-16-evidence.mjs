import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collectGate15CoreEvidence } from "./hosted-gate15-core-evidence.mjs";

const TARGET_ALLOWLIST_PATH = new URL(
  "../config/hosted-target-allowlist.json",
  import.meta.url,
);

const GATE_REQUIREMENTS = Object.freeze({
  10: ["app", "database"],
  11: ["app", "database"],
  12: ["app", "database", "communications"],
  13: ["billing", "compliance", "shipping"],
  14: ["app", "database", "integrationEncryption", "quickBooksOAuth"],
  15: ["app", "billing", "database", "security"],
  16: ["app", "customDomains", "database"],
});

const EXTERNAL_EVIDENCE_REMAINING = Object.freeze({
  10: ["real-winery-source-reconciliation", "metric-and-csv-reconciliation"],
  11: [
    "active-platform-actor",
    "qualified-production-history",
    "completed-30-day-comparison",
  ],
  12: ["ten-opted-in-contributors", "quarterly-report-delivery"],
  13: ["vendor-sandbox-contract", "decision-matrix-and-label-recovery"],
  14: ["provider-account-connections", "provider-lifecycle-reconciliation"],
  15: ["same-organization-core-isolation", "hostname-context-after-gate-16"],
  16: ["dns-ownership", "active-certificate-and-host-routing"],
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_MISSING_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;
const APPROVED_STAGING_ORIGINS = new Set([
  "https://vinifera-staging.edstratum-labs-staging.workers.dev",
]);

function checkedGate(value) {
  const gate = Number(value);
  if (!Number.isInteger(gate) || !Object.hasOwn(GATE_REQUIREMENTS, gate)) {
    throw new Error(
      "Hosted evidence gate must be an integer from 10 through 16.",
    );
  }
  return gate;
}

function checkedRevision(value) {
  const revision = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!SHA_PATTERN.test(revision)) {
    throw new Error(
      "Hosted evidence requires an exact 40-character candidate revision.",
    );
  }
  return revision;
}

function checkedOrigin(value) {
  let origin;
  try {
    origin = new URL(String(value ?? "").trim());
  } catch {
    throw new Error(
      "Hosted evidence requires a canonical HTTPS Worker origin.",
    );
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      "Hosted evidence requires a canonical HTTPS Worker origin.",
    );
  }
  if (!APPROVED_STAGING_ORIGINS.has(origin.origin)) {
    throw new Error(
      "Hosted evidence origin is not an approved staging target.",
    );
  }
  return origin;
}

function safeMissingNames(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (name) => typeof name === "string" && SAFE_MISSING_NAME.test(name),
      ),
    ),
  ].sort();
}

async function boundedJson(response) {
  if (!response.ok) {
    throw new Error("Hosted evidence endpoint returned a non-success status.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Hosted evidence endpoint returned no body.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Hosted evidence endpoint exceeded its response limit.");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
  ).toString("utf8");
  return JSON.parse(body);
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    return await boundedJson(response);
  } finally {
    clearTimeout(timeout);
  }
}

function configurationEvidence(payload, names) {
  const data = payload?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Hosted configuration response is invalid.");
  }
  return Object.fromEntries(
    names.map((name) => {
      const entry = data[name];
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.configured !== "boolean"
      ) {
        throw new Error(`Hosted configuration group ${name} is invalid.`);
      }
      return [
        name,
        {
          configured: entry.configured,
          missing: safeMissingNames(entry.missing),
        },
      ];
    }),
  );
}

export function requiredConfigurationForGate(gate) {
  return [...GATE_REQUIREMENTS[checkedGate(gate)]];
}

export async function collectHostedGateEvidence({
  gate: rawGate,
  expectedRevision: rawExpectedRevision,
  origin: rawOrigin,
  enabled,
  confirmation,
  mlActorConfigured = false,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
  gate15Collector,
  gate15Options,
}) {
  const gate = checkedGate(rawGate);
  const expectedRevision = checkedRevision(rawExpectedRevision);
  const origin = checkedOrigin(rawOrigin);
  if (enabled !== true) {
    throw new Error(`Hosted Gate ${gate} evidence is not enabled.`);
  }
  if (confirmation !== `COLLECT VINIFERA GATE ${gate} READINESS EVIDENCE`) {
    throw new Error(`Hosted Gate ${gate} evidence confirmation is invalid.`);
  }

  const blockers = [];
  let runtime = {
    environment: null,
    exactRevision: false,
    reachable: false,
    service: null,
    status: null,
  };
  let configuration = {};

  try {
    const healthPayload = await fetchJson(
      fetchImpl,
      new URL("/api/health", origin),
      timeoutMs,
    );
    const health = healthPayload?.data;
    if (!health || typeof health !== "object") {
      throw new Error("Hosted health response is invalid.");
    }
    runtime = {
      environment: health.environment === "staging" ? "staging" : null,
      exactRevision: health.revision === expectedRevision,
      reachable: true,
      service: health.service === "vinifera-api" ? "vinifera-api" : null,
      status: health.status === "ok" ? "ok" : null,
    };
    if (runtime.environment !== "staging")
      blockers.push("runtime_environment_mismatch");
    if (!runtime.exactRevision) blockers.push("runtime_revision_mismatch");
    if (runtime.service !== "vinifera-api" || runtime.status !== "ok") {
      blockers.push("runtime_health_invalid");
    }
  } catch {
    blockers.push("runtime_unreachable");
  }

  try {
    const configurationPayload = await fetchJson(
      fetchImpl,
      new URL("/api/health/configuration", origin),
      timeoutMs,
    );
    configuration = configurationEvidence(
      configurationPayload,
      GATE_REQUIREMENTS[gate],
    );
    for (const [name, state] of Object.entries(configuration)) {
      if (!state.configured) blockers.push(`configuration_${name}_incomplete`);
    }
  } catch {
    blockers.push("configuration_unreachable_or_invalid");
  }

  const actorPresence = gate === 11 ? Boolean(mlActorConfigured) : null;
  if (gate === 11 && !actorPresence) blockers.push("ml_platform_actor_missing");

  let gateSpecificEvidence = null;
  if (gate === 15 && gate15Collector) {
    if (blockers.length === 0) {
      gateSpecificEvidence = await gate15Collector({
        ...gate15Options,
        expectedRevision,
        workerOrigin: origin.origin,
      });
      if (gateSpecificEvidence.result !== "core-ready") {
        blockers.push("gate15_core_isolation_blocked");
      }
    } else {
      gateSpecificEvidence = {
        evidenceLevel: "hosted-core-partial",
        result: "not-started",
        completionClaimed: false,
        externalEvidenceRemaining: ["hostname-context-after-gate-16"],
      };
    }
  }

  const uniqueBlockers = [...new Set(blockers)].sort();
  return {
    schemaVersion: 1,
    gate,
    evidenceLevel: "hosted-readiness",
    result: uniqueBlockers.length === 0 ? "ready" : "blocked",
    capturedAt: now().toISOString(),
    candidateRevision: expectedRevision,
    originHost: origin.hostname,
    runtime,
    configuration,
    mlPlatformActorConfigured: actorPresence,
    blockers: uniqueBlockers,
    externalEvidenceRemaining:
      gate === 15 && gateSpecificEvidence?.result === "core-ready"
        ? [...gateSpecificEvidence.externalEvidenceRemaining]
        : [...EXTERNAL_EVIDENCE_REMAINING[gate]],
    gateSpecificEvidence,
    completionClaimed: false,
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(
        "Hosted gate evidence arguments must be --name value pairs.",
      );
    }
    values[name.slice(2)] = value;
  }
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const gate = checkedGate(args.gate);
  const outputPath = resolve(
    args.output ?? `hosted-gate-${gate}-readiness.json`,
  );
  const gate15Options =
    gate === 15
      ? {
          accessClientId: process.env.CF_ACCESS_CLIENT_ID,
          accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
          allowlist: JSON.parse(await readFile(TARGET_ALLOWLIST_PATH, "utf8")),
          anonKey: process.env.SUPABASE_ANON_KEY,
          emailBase: process.env.GATE15_ACCEPTANCE_EMAIL_BASE,
          runId: process.env.GITHUB_RUN_ID ?? "local",
          serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          supabaseUrl: process.env.SUPABASE_URL,
        }
      : undefined;
  const report = await collectHostedGateEvidence({
    gate,
    expectedRevision: args["expected-revision"],
    origin: args.origin,
    enabled: args.enabled === "true",
    confirmation: args.confirmation,
    mlActorConfigured: args["ml-actor-configured"] === "true",
    gate15Collector: gate === 15 ? collectGate15CoreEvidence : undefined,
    gate15Options,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(
    `Gate ${gate} hosted readiness: ${report.result}; completion claimed: false\n`,
  );
  if (report.result !== "ready") process.exitCode = 2;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch(async () => {
    const args = parseArguments(process.argv.slice(2));
    const outputPath = resolve(
      args.output ?? "hosted-gate-readiness-failure.json",
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          gate: Number.isInteger(Number(args.gate)) ? Number(args.gate) : null,
          evidenceLevel: "hosted-readiness",
          result: "blocked",
          blockers: ["collector_preflight_failed"],
          completionClaimed: false,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    console.error("Hosted gate evidence failed during sanitized preflight.");
    process.exitCode = 1;
  });
}
