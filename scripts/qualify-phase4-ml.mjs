import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUIRED_SOURCES = [
  "shipments",
  "billing",
  "email_delivery",
  "portal_activity",
  "loyalty",
  "declines",
];

function nonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

export function validateQualificationEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Qualification evidence must be a JSON object.");
  }
  const trainingRunId = String(value.trainingRunId ?? "");
  const datasetHash = String(value.datasetHash ?? "");
  const status = String(value.status ?? "");
  const sourceCoverage = value.sourceCoverage;
  if (!UUID_PATTERN.test(trainingRunId)) {
    throw new Error("trainingRunId must be a UUID.");
  }
  if (!SHA256_PATTERN.test(datasetHash)) {
    throw new Error("datasetHash must be a lowercase SHA-256 value.");
  }
  if (status !== "qualified" && status !== "rejected") {
    throw new Error("status must be qualified or rejected.");
  }
  if (
    !sourceCoverage ||
    typeof sourceCoverage !== "object" ||
    Array.isArray(sourceCoverage)
  ) {
    throw new Error("sourceCoverage must be a JSON object.");
  }
  const eligibleMemberCount = nonnegativeInteger(
    sourceCoverage.eligible_member_count,
    "sourceCoverage.eligible_member_count",
  );
  if (
    typeof sourceCoverage.reconciled_through !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(sourceCoverage.reconciled_through)
  ) {
    throw new Error(
      "sourceCoverage.reconciled_through must be an ISO calendar date.",
    );
  }
  if (
    !sourceCoverage.sources ||
    typeof sourceCoverage.sources !== "object" ||
    Array.isArray(sourceCoverage.sources)
  ) {
    throw new Error("sourceCoverage.sources must be a JSON object.");
  }
  for (const source of REQUIRED_SOURCES) {
    const coverage = sourceCoverage.sources[source];
    if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
      throw new Error(`sourceCoverage.sources.${source} is required.`);
    }
    const sourceEligible = nonnegativeInteger(
      coverage.eligible_member_count,
      `sourceCoverage.sources.${source}.eligible_member_count`,
    );
    const reconciled = nonnegativeInteger(
      coverage.reconciled_member_count,
      `sourceCoverage.sources.${source}.reconciled_member_count`,
    );
    if (
      sourceEligible !== eligibleMemberCount ||
      reconciled < Math.ceil(sourceEligible * 0.95) ||
      reconciled > sourceEligible
    ) {
      throw new Error(
        `sourceCoverage.sources.${source} must use the shared denominator and reconcile at least 95 percent.`,
      );
    }
  }
  return {
    datasetHash,
    sourceCoverage,
    status,
    trainingRunId,
  };
}

export function qualificationRpcPayload(evidence, actorUserId) {
  if (!UUID_PATTERN.test(actorUserId)) {
    throw new Error(
      "ML_PLATFORM_ACTOR_USER_ID must be an active platform super-admin UUID.",
    );
  }
  return {
    p_actor_user_id: actorUserId,
    p_dataset_hash: evidence.datasetHash,
    p_source_coverage: evidence.sourceCoverage,
    p_status: evidence.status,
    p_training_run_id: evidence.trainingRunId,
  };
}

function parseArguments(argv) {
  const options = { dryRun: false, evidencePath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--evidence") {
      options.evidencePath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.evidencePath) {
    throw new Error("Usage: --evidence <qualification.json> [--dry-run]");
  }
  return options;
}

function normalizedSupabaseUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "localhost"
  ) {
    throw new Error("SUPABASE_URL must use HTTPS outside local development.");
  }
  return url.origin;
}

export async function qualifyPhase4Ml({
  argv = process.argv.slice(2),
  env = process.env,
  fetcher = fetch,
  log = console.log,
} = {}) {
  const options = parseArguments(argv);
  const evidenceText = await fs.readFile(
    path.resolve(options.evidencePath),
    "utf8",
  );
  const evidence = validateQualificationEvidence(JSON.parse(evidenceText));
  const actorUserId = String(env.ML_PLATFORM_ACTOR_USER_ID ?? "");
  const payload = qualificationRpcPayload(evidence, actorUserId);
  if (options.dryRun) {
    log(
      JSON.stringify({
        actorUserId,
        datasetHash: evidence.datasetHash,
        dryRun: true,
        eligibleMemberCount:
          evidence.sourceCoverage.eligible_member_count,
        reconciledThrough: evidence.sourceCoverage.reconciled_through,
        status: evidence.status,
        trainingRunId: evidence.trainingRunId,
      }),
    );
    return { dryRun: true, payload };
  }
  const supabaseUrl = normalizedSupabaseUrl(String(env.SUPABASE_URL ?? ""));
  const secret = String(
    env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY ?? "",
  );
  if (!secret) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required.",
    );
  }
  const response = await fetcher(
    `${supabaseUrl}/rest/v1/rpc/record_ml_training_source_qualification`,
    {
      body: JSON.stringify(payload),
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Qualification RPC failed with HTTP ${response.status}: ${String(
        body?.message ?? body?.code ?? "unknown error",
      )}`,
    );
  }
  const result = Array.isArray(body) ? body[0] : body;
  log(
    JSON.stringify({
      evidenceHash: result?.evidence_hash ?? null,
      qualifiedAt: result?.qualified_at ?? null,
      status: result?.status ?? evidence.status,
      trainingRunId:
        result?.training_run_id ?? evidence.trainingRunId,
    }),
  );
  return { dryRun: false, payload, result };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  qualifyPhase4Ml().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
