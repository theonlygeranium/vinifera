import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const POLICY_PATH = resolve(
  import.meta.dirname,
  "../config/gate14-integration-acceptance-policy.json",
);
const APPROVED_WORKER =
  "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROVIDERS = Object.freeze(["klaviyo", "avalara", "meta", "quickbooks"]);
const MAX_OBSERVATION_AGE_MS = 30 * 60 * 1000;
function expect(value, message) {
  if (!value) throw new Error(message);
}
function required(value, label) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(`${label} is required.`);
  return result;
}
function integer(value, label, min = 0) {
  expect(
    Number.isSafeInteger(value) && value >= min,
    `${label} must be an integer >= ${min}.`,
  );
  return value;
}
function instant(value, label) {
  const result = required(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(result);
  const parsed = Date.parse(result);
  expect(match && Number.isFinite(parsed), `${label} must be a timezone-qualified ISO/RFC3339 instant.`);
  const [, year, month, day, hour, minute, second, fraction = "", zone, sign, offsetHour = "00", offsetMinute = "00"] = match;
  expect(Number(offsetHour) <= 23 && Number(offsetMinute) <= 59 && Number(second) <= 59, `${label} must be a valid ISO/RFC3339 instant.`);
  const offsetMinutes = zone === "Z" ? 0 : (sign === "+" ? 1 : -1) * (Number(offsetHour) * 60 + Number(offsetMinute));
  const wall = new Date(parsed + offsetMinutes * 60_000);
  expect(wall.getUTCFullYear() === Number(year) && wall.getUTCMonth() + 1 === Number(month) && wall.getUTCDate() === Number(day) && wall.getUTCHours() === Number(hour) && wall.getUTCMinutes() === Number(minute) && wall.getUTCSeconds() === Number(second) && wall.getUTCMilliseconds() === Number(fraction.padEnd(3, "0")), `${label} must round-trip as a valid ISO/RFC3339 instant.`);
  return result;
}
function uuid(value, label) {
  const result = required(value, label).toLowerCase();
  expect(UUID.test(result), `${label} must be a UUID.`);
  return result;
}
export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function hashes(value, label) {
  expect(
    Array.isArray(value) &&
      value.every((item) => typeof item === "string" && SHA256.test(item)) &&
      new Set(value).size === value.length,
    `${label} must contain unique SHA-256 values.`,
  );
  return [...value];
}
function origin(value, label) {
  let parsed;
  try {
    parsed = new URL(required(value, label));
  } catch {
    throw new Error(`${label} must be a canonical HTTPS origin.`);
  }
  expect(
    parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash,
    `${label} must be a canonical HTTPS origin.`,
  );
  return parsed.origin;
}

export function validatePolicy(raw) {
  expect(
    raw?.schemaVersion === 1 && typeof raw.enabled === "boolean",
    "Gate 14 policy schema is invalid.",
  );
  const policy = {
    schemaVersion: 1,
    enabled: raw.enabled,
    stagingWorkerOriginSha256: hashes(
      raw.stagingWorkerOriginSha256,
      "stagingWorkerOriginSha256",
    ),
    stagingSupabaseUrlSha256: hashes(
      raw.stagingSupabaseUrlSha256,
      "stagingSupabaseUrlSha256",
    ),
    acceptanceScopeSha256: hashes(
      raw.acceptanceScopeSha256,
      "acceptanceScopeSha256",
    ),
  };
  if (policy.enabled)
    for (const [name, value] of Object.entries(policy))
      if (name.endsWith("Sha256"))
        expect(value.length === 1, `Enabled Gate 14 requires one ${name}.`);
  return policy;
}
function envelope(raw, provider) {
  expect(
    raw?.algorithm === "AES-256-GCM",
    `${provider} envelope must use AES-256-GCM.`,
  );
  expect(
    integer(raw.version, `${provider}.envelope.version`, 1) === 1,
    `${provider} envelope format version must be 1.`,
  );
  for (const field of ["ciphertextSha256", "ivSha256", "keyIdSha256"])
    expect(
      SHA256.test(required(raw[field], `${provider}.${field}`)),
      `${provider}.${field} must be SHA-256.`,
    );
  expect(
    raw.plaintextAbsent === true,
    `${provider} evidence must prove plaintext absence.`,
  );
  return {
    algorithm: "AES-256-GCM",
    version: raw.version,
    ciphertextSha256: raw.ciphertextSha256,
    ivSha256: raw.ivSha256,
    keyIdSha256: raw.keyIdSha256,
    plaintextAbsent: true,
  };
}
export function validateManifest(raw) {
  expect(
    raw?.schemaVersion === 1 && raw.gate === 14,
    "Gate 14 manifest is invalid.",
  );
  const candidateRevision = required(
    raw.candidateRevision,
    "candidateRevision",
  ).toLowerCase();
  expect(SHA.test(candidateRevision), "Manifest candidateRevision is invalid.");
  const observedAt = instant(raw.observedAt, "observedAt");
  const common = {
    candidateRevision,
    observedAt,
    organizationId: uuid(raw.organizationId, "organizationId"),
    brandId: uuid(raw.brandId, "brandId"),
  };
  expect(
    raw.keyring?.provisioned === true,
    "The integration credential keyring is not provisioned.",
  );
  const activeVersion = required(
    raw.keyring.activeVersion,
    "keyring.activeVersion",
  );
  expect(
    Array.isArray(raw.keyring.versions) && raw.keyring.versions.length > 0,
    "keyring.versions is required.",
  );
  const keyringVersions = raw.keyring.versions
    .map((value, index) => required(value, `keyring.versions[${index}]`))
    .sort();
  expect(
    new Set(keyringVersions).size === keyringVersions.length &&
      keyringVersions.includes(activeVersion),
    "The active key version must belong to a unique runtime keyring.",
  );
  const keyIdHashes = new Set(keyringVersions.map(sha256));
  const connections = {};
  for (const provider of PROVIDERS) {
    const connection = raw.connections?.[provider];
    expect(
      connection?.winerySpecific === true && connection?.status === "active",
      `${provider} must be an active winery-specific connection.`,
    );
    connections[provider] = {
      connectionId: uuid(connection.connectionId, `${provider}.connectionId`),
      winerySpecific: true,
      status: "active",
      envelope: envelope(connection.envelope, provider),
    };
  }
  expect(
    new Set(
      Object.values(connections).map((connection) => connection.connectionId),
    ).size === PROVIDERS.length,
    "Provider connection IDs must be distinct.",
  );
  expect(
    Object.values(connections).every((connection) =>
      keyIdHashes.has(connection.envelope.keyIdSha256),
    ),
    "Every provider envelope key ID must belong to the runtime keyring.",
  );
  const k = raw.klaviyo;
  expect(
    integer(k?.bulkProfiles, "klaviyo.bulkProfiles", 1000) >= 1000 &&
      integer(k.bulkElapsedMs, "klaviyo.bulkElapsedMs") <= 30_000 &&
      k.bulkTerminalStatus === "completed",
    "Klaviyo bulk lifecycle is incomplete.",
  );
  for (const name of [
    "memberUpdateVisible",
    "listTransitionVisible",
    "openReflected",
    "clickReflected",
    "tamperedSignatureRejected",
    "staleSignatureRejected",
    "disconnectDisclosureBlocked",
  ])
    expect(k[name] === true, `Klaviyo ${name} evidence is missing.`);
  const q = raw.quickbooks;
  for (const name of [
    "applicationClientConfigured",
    "redirectUriExact",
    "oauthStateVerified",
    "realmApproved",
    "companyApproved",
    "perConnectionTokenEncrypted",
    "refreshTokenRotated",
    "latestRefreshTokenPersistedBeforeUse",
    "ambiguousWritesReconciled",
    "taxAndAccountMappingsExact",
    "salesReceiptObserved",
    "refundReceiptObserved",
    "splitRefundConverged",
  ])
    expect(q?.[name] === true, `QuickBooks ${name} evidence is missing.`);
  expect(
    Array.isArray(q.splitRefundIncrementsCents) &&
      q.splitRefundIncrementsCents.length === 2 &&
      q.splitRefundIncrementsCents[0] === 4863 &&
      q.splitRefundIncrementsCents[1] === 4862 &&
      q.splitRefundTotalCents === 9725,
    "QuickBooks split refund evidence is not the exact 4,863 + 4,862 = 9,725 contract.",
  );
  expect(
    integer(q.transactionCount, "quickbooks.transactionCount", 100) >= 100 &&
      integer(q.elapsedMs, "quickbooks.elapsedMs") <= 60_000 &&
      integer(q.duplicateCount, "quickbooks.duplicateCount") === 0 &&
      integer(q.refreshCount, "quickbooks.refreshCount") === 1 &&
      integer(
        q.unexplainedDifferenceCents,
        "quickbooks.unexplainedDifferenceCents",
      ) === 0 &&
      integer(
        q.startingTokenGeneration,
        "quickbooks.startingTokenGeneration",
        1,
      ) +
        1 ===
        integer(q.endingTokenGeneration, "quickbooks.endingTokenGeneration", 2),
    "QuickBooks token or reconciliation lifecycle failed.",
  );
  const a = raw.avalara;
  for (const name of [
    "jurisdictionExact",
    "exemptionExact",
    "shippingTaxExact",
    "totalTaxExact",
    "savedBeforeCharge",
    "committedAfterCharge",
    "partialRefundReturnInvoiceExact",
    "completingRefundReturnInvoiceExact",
    "refundReturnInvoiceExact",
    "liabilityReduced",
    "checkpointConverged",
    "noStrandedSavedTransaction",
    "failedChargeNotCommitted",
  ])
    expect(a?.[name] === true, `Avalara ${name} evidence is missing.`);
  const partialExpected = integer(
    a.partialRefundExpectedTaxReductionCents,
    "avalara.partialRefundExpectedTaxReductionCents",
    1,
  );
  const partialObserved = integer(
    a.partialRefundObservedTaxReductionCents,
    "avalara.partialRefundObservedTaxReductionCents",
    1,
  );
  const completingExpected = integer(
    a.completingRefundExpectedTaxReductionCents,
    "avalara.completingRefundExpectedTaxReductionCents",
    1,
  );
  const completingObserved = integer(
    a.completingRefundObservedTaxReductionCents,
    "avalara.completingRefundObservedTaxReductionCents",
    1,
  );
  expect(
    partialExpected === partialObserved &&
      completingExpected === completingObserved &&
      a.cumulativeRefundTaxReductionCents ===
        partialObserved + completingObserved,
    "Avalara partial/completing refund tax deltas do not reconcile exactly.",
  );
  const liabilityBefore = integer(
    a.liabilityBeforeRefundCents,
    "avalara.liabilityBeforeRefundCents",
    1,
  );
  const liabilityPartial = integer(
    a.liabilityAfterPartialRefundCents,
    "avalara.liabilityAfterPartialRefundCents",
  );
  const liabilityComplete = integer(
    a.liabilityAfterCompletingRefundCents,
    "avalara.liabilityAfterCompletingRefundCents",
  );
  expect(
    liabilityBefore - liabilityPartial === partialObserved &&
      liabilityPartial - liabilityComplete === completingObserved,
    "Avalara liability totals must reconcile exactly with each refund tax delta.",
  );
  expect(
    ["avalara", "quickbooks"].includes(a.interruptedAfterProvider) &&
      integer(
        a.completedProviderWritesBeforeResume,
        "avalara.completedProviderWritesBeforeResume",
      ) === 1 &&
      integer(
        a.incompleteProviderWritesResumed,
        "avalara.incompleteProviderWritesResumed",
      ) === 1 &&
      integer(
        a.duplicateCompletedProviderWritesAfterResume,
        "avalara.duplicateCompletedProviderWritesAfterResume",
      ) === 0,
    "Avalara checkpoint recovery did not resume only the incomplete provider write.",
  );
  expect(
    integer(a.calculationElapsedMs, "avalara.calculationElapsedMs") < 500,
    "Avalara calculation exceeded 500 ms.",
  );
  const m = raw.meta;
  for (const name of [
    "unconsentedSuppressed",
    "rawIdentifiersAbsent",
    "browserServerEventIdMatched",
    "withdrawalRedacted",
    "testEventCodeRemoved",
  ])
    expect(m?.[name] === true, `Meta ${name} evidence is missing.`);
  const metaEvents = ["Lead", "Purchase", "referral", "tier_upgrade"];
  expect(
    Array.isArray(m.eventLifecycles) &&
      m.eventLifecycles.length === metaEvents.length,
    "Meta requires one lifecycle for every mapped event.",
  );
  const observedEvents = m.eventLifecycles.map((event, index) => {
    const eventName = required(
      event?.eventName,
      `meta.eventLifecycles[${index}].eventName`,
    );
    expect(
      metaEvents.includes(eventName) &&
        event?.sent === true &&
        event?.eventsManagerObserved === true &&
        SHA256.test(
          required(
            event?.eventIdSha256,
            `meta.eventLifecycles[${index}].eventIdSha256`,
          ),
        ),
      `Meta ${eventName} lifecycle is incomplete.`,
    );
    return eventName;
  });
  expect(
    new Set(observedEvents).size === metaEvents.length,
    "Meta event lifecycles must cover each mapped event exactly once.",
  );
  expect(
    integer(m.acknowledgementElapsedMs, "meta.acknowledgementElapsedMs") <=
      5_000,
    "Meta acknowledgement exceeded five seconds.",
  );
  return {
    ...common,
    keyringActiveVersionSha256: sha256(activeVersion),
    keyringVersionsSha256: sha256(JSON.stringify(keyringVersions)),
    connections,
    providerChecks: {
      klaviyoProfiles: k.bulkProfiles,
      quickBooksTransactions: q.transactionCount,
      quickBooksRefreshCount: q.refreshCount,
      avalaraCalculationElapsedMs: a.calculationElapsedMs,
      avalaraRefundTaxReductionCents: a.cumulativeRefundTaxReductionCents,
      metaAcknowledgementElapsedMs: m.acknowledgementElapsedMs,
      metaEventCount: metaEvents.length,
    },
  };
}
export function acceptanceScopeSha256(manifest) {
  return sha256(
    JSON.stringify({
      organizationId: manifest.organizationId,
      brandId: manifest.brandId,
      keyringActiveVersionSha256: manifest.keyringActiveVersionSha256,
      keyringVersionsSha256: manifest.keyringVersionsSha256,
      connections: Object.fromEntries(
        PROVIDERS.map((provider) => [
          provider,
          {
            connectionId: manifest.connections[provider].connectionId,
            ciphertextSha256:
              manifest.connections[provider].envelope.ciphertextSha256,
            ivSha256: manifest.connections[provider].envelope.ivSha256,
            keyIdSha256: manifest.connections[provider].envelope.keyIdSha256,
          },
        ]),
      ),
    }),
  );
}
export function acceptedEnvelopeScopeSha256(manifest) {
  return sha256(
    JSON.stringify(
      PROVIDERS.map((integrationType) => ({
        brandId: manifest.brandId,
        ciphertextSha256:
          manifest.connections[integrationType].envelope.ciphertextSha256,
        ivSha256: manifest.connections[integrationType].envelope.ivSha256,
        integrationType,
        keyIdSha256: manifest.connections[integrationType].envelope.keyIdSha256,
        organizationId: manifest.organizationId,
        targetId: manifest.connections[integrationType].connectionId,
      })).sort((left, right) =>
        left.integrationType.localeCompare(right.integrationType),
      ),
    ),
  );
}
export function authorize(env, policy, manifest) {
  expect(
    policy.enabled && env.STAGING_GATE14_ACCEPTANCE_ENABLED === "true",
    "Gate 14 acceptance is disabled.",
  );
  expect(
    env.GATE14_ACCEPTANCE_CONFIRMATION ===
      "RUN VINIFERA GATE 14 INTEGRATION ACCEPTANCE",
    "Exact Gate 14 confirmation is required.",
  );
  const workerOrigin = origin(
    env.STAGING_WORKER_ORIGIN,
    "STAGING_WORKER_ORIGIN",
  );
  expect(
    workerOrigin === APPROVED_WORKER,
    "Worker origin is not approved staging.",
  );
  const supabaseUrl = origin(env.SUPABASE_URL, "SUPABASE_URL");
  expect(
    policy.stagingWorkerOriginSha256.includes(sha256(workerOrigin)) &&
      policy.stagingSupabaseUrlSha256.includes(sha256(supabaseUrl)) &&
      policy.acceptanceScopeSha256.includes(acceptanceScopeSha256(manifest)),
    "Gate 14 target or acceptance scope is unauthorized.",
  );
  return { workerOrigin, supabaseUrl };
}
async function health(fetchImpl, target, env) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${target}/api/health`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "CF-Access-Client-Id": required(
          env.CF_ACCESS_CLIENT_ID,
          "CF_ACCESS_CLIENT_ID",
        ),
        "CF-Access-Client-Secret": required(
          env.CF_ACCESS_CLIENT_SECRET,
          "CF_ACCESS_CLIENT_SECRET",
        ),
      },
    });
    expect(response.ok, "Staging health failed.");
    const text = await response.text();
    expect(Buffer.byteLength(text) <= 65_536, "Health response is oversized.");
    return JSON.parse(text)?.data;
  } finally {
    clearTimeout(timer);
  }
}
async function runtimeConfiguration(fetchImpl, target, env) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${target}/api/health/configuration`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "CF-Access-Client-Id": required(
          env.CF_ACCESS_CLIENT_ID,
          "CF_ACCESS_CLIENT_ID",
        ),
        "CF-Access-Client-Secret": required(
          env.CF_ACCESS_CLIENT_SECRET,
          "CF_ACCESS_CLIENT_SECRET",
        ),
      },
    });
    expect(response.ok, "Staging configuration failed.");
    const text = await response.text();
    expect(
      Buffer.byteLength(text) <= 65_536,
      "Configuration response is oversized.",
    );
    const data = JSON.parse(text)?.data;
    const supabaseUrlSha256 = data?.database?.bindingHashes?.supabaseUrlSha256;
    const activeVersionSha256 =
      data?.integrationEncryption?.bindingHashes?.activeVersionSha256;
    const keyringVersionsSha256 =
      data?.integrationEncryption?.bindingHashes?.keyringVersionsSha256;
    const acceptedConnectionIdsSha256 =
      data?.integrationEncryption?.bindingHashes?.acceptedConnectionIdsSha256;
    const acceptedEnvelopeScopeSha256 =
      data?.integrationEncryption?.bindingHashes?.acceptedEnvelopeScopeSha256;
    expect(
      [
        supabaseUrlSha256,
        activeVersionSha256,
        keyringVersionsSha256,
        acceptedConnectionIdsSha256,
        acceptedEnvelopeScopeSha256,
      ].every((hash) => typeof hash === "string" && SHA256.test(hash)),
      "Staging runtime did not report exact database, validated keyring, and decryption-proof hashes.",
    );
    return {
      supabaseUrlSha256,
      activeVersionSha256,
      keyringVersionsSha256,
      acceptedConnectionIdsSha256,
      acceptedEnvelopeScopeSha256,
    };
  } finally {
    clearTimeout(timer);
  }
}
async function supabaseRows(fetchImpl, url, serviceRoleKey, env, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "CF-Access-Client-Id": required(env.CF_ACCESS_CLIENT_ID, "CF_ACCESS_CLIENT_ID"),
        "CF-Access-Client-Secret": required(env.CF_ACCESS_CLIENT_SECRET, "CF_ACCESS_CLIENT_SECRET"),
      },
    });
    expect(response.ok, `${label} database attestation failed.`);
    const text = await response.text();
    expect(Buffer.byteLength(text) <= 65_536, `${label} database attestation is oversized.`);
    const rows = JSON.parse(text);
    expect(Array.isArray(rows), `${label} database attestation is invalid.`);
    return rows;
  } finally {
    clearTimeout(timer);
  }
}
export async function storedEnvelopeScopeSha256(fetchImpl, target, env, manifest) {
  const serviceRoleKey = required(
    env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
    "STAGING_SUPABASE_SERVICE_ROLE_KEY",
  );
  const connectionIds = PROVIDERS.map((provider) => manifest.connections[provider].connectionId);
  const secretUrl = new URL("/rest/v1/integration_secrets", target);
  secretUrl.searchParams.set("select", "connection_id,organization_id,storage_mode,envelope_version,algorithm,credential_ciphertext,credential_iv,key_version,connection:integration_connections!integration_secrets_connection_org_fkey!inner(id,organization_id,brand_id,integration_type,status,opted_in)");
  secretUrl.searchParams.set("organization_id", `eq.${manifest.organizationId}`);
  secretUrl.searchParams.set("connection_id", `in.(${connectionIds.join(",")})`);
  secretUrl.searchParams.set("connection.organization_id", `eq.${manifest.organizationId}`);
  secretUrl.searchParams.set("connection.brand_id", `eq.${manifest.brandId}`);
  const secrets = await supabaseRows(fetchImpl, secretUrl, serviceRoleKey, env, "Credential envelope");
  expect(secrets.length === PROVIDERS.length, "Database must contain exactly four accepted credential envelopes.");
  const scopes = [];
  for (const integrationType of PROVIDERS) {
    const expected = manifest.connections[integrationType];
    const secret = secrets.find((row) => row?.connection_id === expected.connectionId);
    const connection = Array.isArray(secret?.connection) ? secret.connection[0] : secret?.connection;
    expect(
      connection?.organization_id === manifest.organizationId && connection?.brand_id === manifest.brandId
        && connection?.integration_type === integrationType && connection?.status === "active" && connection?.opted_in === true,
      `${integrationType} database connection is not the exact active opted-in winery connection.`,
    );
    expect(
      secret?.organization_id === manifest.organizationId && secret?.storage_mode === "encrypted_envelope"
        && secret?.envelope_version === 1 && secret?.algorithm === "A256GCM"
        && typeof secret?.credential_ciphertext === "string" && typeof secret?.credential_iv === "string" && typeof secret?.key_version === "string",
      `${integrationType} stored credential envelope is invalid.`,
    );
    scopes.push({
      brandId: manifest.brandId,
      ciphertextSha256: sha256(secret.credential_ciphertext),
      ivSha256: sha256(secret.credential_iv),
      integrationType,
      keyIdSha256: sha256(secret.key_version),
      organizationId: manifest.organizationId,
      targetId: expected.connectionId,
    });
  }
  return sha256(JSON.stringify(scopes.sort((left, right) => left.integrationType.localeCompare(right.integrationType))));
}
export async function runAcceptance({
  env = process.env,
  fetchImpl = fetch,
  manifestText,
  policyText,
  now = () => new Date(),
}) {
  const policy = validatePolicy(JSON.parse(policyText));
  const manifest = validateManifest(JSON.parse(manifestText));
  const targets = authorize(env, policy, manifest);
  const candidateRevision = required(
    env.GATE14_CANDIDATE_REVISION,
    "GATE14_CANDIDATE_REVISION",
  ).toLowerCase();
  expect(SHA.test(candidateRevision), "Candidate revision is invalid.");
  const stagingRevision = required(env.GATE14_STAGING_REVISION, "GATE14_STAGING_REVISION").toLowerCase();
  expect(SHA.test(stagingRevision), "Staging revision is invalid.");
  expect(
    manifest.candidateRevision === candidateRevision,
    "Evidence manifest does not match the candidate revision.",
  );
  const capturedAt = now();
  const observedAt = Date.parse(manifest.observedAt);
  expect(
    observedAt <= capturedAt.getTime(),
    "Provider evidence is future-dated.",
  );
  expect(
    capturedAt.getTime() - observedAt <= MAX_OBSERVATION_AGE_MS,
    "Provider evidence is stale.",
  );
  const controlSha = required(env.GATE14_CONTROL_SHA, "GATE14_CONTROL_SHA");
  expect(
    SHA.test(controlSha) && controlSha === env.GITHUB_SHA,
    "Control SHA is invalid.",
  );
  const healthState = await health(fetchImpl, targets.workerOrigin, env);
  expect(
    healthState?.environment === "staging" &&
      healthState?.service === "vinifera-api" &&
      healthState?.status === "ok" &&
      healthState?.revision === candidateRevision,
    "Runtime is not the exact staging candidate.",
  );
  const runtime = await runtimeConfiguration(
    fetchImpl,
    targets.workerOrigin,
    env,
  );
  expect(
    runtime.supabaseUrlSha256 === sha256(targets.supabaseUrl),
    "Staging Worker database target differs from the authorized Supabase target.",
  );
  expect(
    runtime.activeVersionSha256 === manifest.keyringActiveVersionSha256 &&
      runtime.keyringVersionsSha256 === manifest.keyringVersionsSha256,
    "Staging Worker keyring differs from the evidence manifest.",
  );
  const expectedConnectionIdsSha256 = sha256(
    JSON.stringify(
      Object.values(manifest.connections)
        .map((connection) => connection.connectionId)
        .sort(),
    ),
  );
  expect(
    runtime.acceptedConnectionIdsSha256 === expectedConnectionIdsSha256,
    "Staging Worker did not decrypt every accepted provider connection with the deployed keyring.",
  );
  expect(
    runtime.acceptedEnvelopeScopeSha256 ===
      acceptedEnvelopeScopeSha256(manifest),
    "Staging Worker decryption proofs do not match the accepted tenant and provider envelopes.",
  );
  const storedScopeSha256 = await storedEnvelopeScopeSha256(fetchImpl, targets.supabaseUrl, env, manifest);
  expect(
    storedScopeSha256 === acceptedEnvelopeScopeSha256(manifest),
    "Decrypted acceptance proofs do not match the active brand-scoped database envelopes.",
  );
  return {
    schemaVersion: 1,
    gate: 14,
    passed: true,
    completionClaimed: false,
    evidenceLevel: "hosted-provider-acceptance",
    capturedAt: capturedAt.toISOString(),
    candidateRevision,
    stagingRevision,
    controlSha,
    organizationId: manifest.organizationId,
    brandId: manifest.brandId,
    keyringActiveVersionSha256: runtime.activeVersionSha256,
    keyringVersionsSha256: runtime.keyringVersionsSha256,
    storedEnvelopeScopeSha256: storedScopeSha256,
    connectionIds: Object.fromEntries(
      PROVIDERS.map((provider) => [
        provider,
        manifest.connections[provider].connectionId,
      ]),
    ),
    providerChecks: manifest.providerChecks,
    targetHashes: {
      workerOriginSha256: sha256(targets.workerOrigin),
      supabaseUrlSha256: runtime.supabaseUrlSha256,
    },
    evidenceManifestSha256: sha256(manifestText),
    policySha256: sha256(policyText),
    blockers: [],
  };
}
async function main() {
  const index = process.argv.indexOf("--output");
  const output = resolve(
    index >= 0 ? process.argv[index + 1] : "gate14-integration-acceptance.json",
  );
  const manifestText = required(
    process.env.STAGING_GATE14_ACCEPTANCE_MANIFEST,
    "STAGING_GATE14_ACCEPTANCE_MANIFEST",
  );
  const policyText = await readFile(POLICY_PATH, "utf8");
  const report = await runAcceptance({ manifestText, policyText });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(
    "Gate 14 hosted acceptance passed; completion claimed: false\n",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(`Gate 14 acceptance failed: ${error.message}\n`);
    process.exitCode = 1;
  });
