import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const POLICY_PATH = resolve(
  import.meta.dirname,
  "../config/shipcompliant-staging-acceptance-policy.json",
);
const APPROVED_WORKER_ORIGIN =
  "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u;
const MAX_RESPONSE_BYTES = 64 * 1024;
const POLICY_HASH_FIELDS = Object.freeze([
  "accountIdSha256",
  "contractVersionSha256",
  "licenseIdSha256",
  "sandboxOriginSha256",
  "tokenPathSha256",
  "checkPathSha256",
  "stagingWorkerOriginSha256",
  "stagingSupabaseUrlSha256",
]);
const SCENARIO_NAMES = Object.freeze([
  "compliant",
  "nonCompliant",
  "unknown",
  "timeout",
  "fingerprint",
  "recovery",
]);

function required(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function analyticsEventIdempotencyKey({
  actorUserId,
  eventType,
  organizationId,
  requestKey,
}) {
  return sha256(
    JSON.stringify({
      actorUserId,
      eventType,
      organizationId,
      requestKey,
      version: "vinifera-analytics-event-v1",
    }),
  );
}

export function fingerprintCleanupPatch(shippingAddress) {
  return {
    compliance_checked_at: null,
    compliance_reason: null,
    compliance_status: null,
    compliance_tax_estimate_cents: null,
    latest_compliance_check_id: null,
    latest_compliance_request_fingerprint: null,
    latest_compliance_state_fingerprint: null,
    shipping_address: shippingAddress,
  };
}

function exactUuid(value, label) {
  const normalized = required(value, label).toLowerCase();
  expect(UUID_PATTERN.test(normalized), `${label} must be a UUID.`);
  return normalized;
}

export function exactHttpsOrigin(value, label) {
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

export function exactApiPath(value, label) {
  const path = required(value, label);
  expect(
    path.startsWith("/") &&
      !path.startsWith("//") &&
      !path.includes("?") &&
      !path.includes("#"),
    `${label} must be an exact absolute API path.`,
  );
  return path;
}

function hashList(value, label) {
  expect(
    Array.isArray(value) &&
      value.every(
        (entry) => typeof entry === "string" && SHA256_PATTERN.test(entry),
      ) &&
      new Set(value).size === value.length,
    `${label} must contain unique lowercase SHA-256 hashes.`,
  );
  return value;
}

export function validatePolicy(raw) {
  expect(
    raw && typeof raw === "object" && raw.schemaVersion === 1,
    "Gate 13 acceptance policy schema version is invalid.",
  );
  expect(
    !Object.prototype.hasOwnProperty.call(raw, "fixtureManifestSha256"),
    "Gate 13 fixture manifest hash must reside in protected per-run state.",
  );
  expect(typeof raw.enabled === "boolean", "Policy enabled must be boolean.");
  const policy = { schemaVersion: 1, enabled: raw.enabled };
  for (const field of POLICY_HASH_FIELDS) {
    policy[field] = hashList(raw[field], field);
    if (policy.enabled) {
      expect(
        policy[field].length === 1,
        `Enabled Gate 13 policy requires exactly one ${field} value.`,
      );
    }
  }
  return policy;
}

function normalizeAddress(raw) {
  expect(
    raw && typeof raw === "object" && !Array.isArray(raw),
    "Fingerprint mutation address is invalid.",
  );
  const address = {
    city: required(raw.city, "fingerprintMutationAddress.city"),
    country: required(
      raw.country ?? raw.country_code,
      "fingerprintMutationAddress.country",
    ).toUpperCase(),
    line1: required(raw.line1, "fingerprintMutationAddress.line1"),
    line2:
      typeof raw.line2 === "string" && raw.line2.trim()
        ? raw.line2.trim()
        : null,
    name: required(raw.name, "fingerprintMutationAddress.name"),
    phone: required(raw.phone, "fingerprintMutationAddress.phone"),
    postal_code: required(
      raw.postalCode ?? raw.postal_code,
      "fingerprintMutationAddress.postalCode",
    ),
    region: required(
      raw.state ?? raw.region,
      "fingerprintMutationAddress.state",
    ).toUpperCase(),
  };
  expect(/^[A-Z]{2}$/u.test(address.region), "Mutation state must be two letters.");
  expect(/^[A-Z]{2}$/u.test(address.country), "Mutation country must be two letters.");
  return address;
}

export function validateFixtureManifest(raw) {
  expect(
    raw && typeof raw === "object" && raw.schemaVersion === 1,
    "Gate 13 fixture manifest schema version is invalid.",
  );
  const scenarios = {};
  for (const name of SCENARIO_NAMES) {
    scenarios[name] = {
      shipmentId: exactUuid(
        raw.scenarios?.[name]?.shipmentId,
        `${name} shipment ID`,
      ),
    };
  }
  const ids = SCENARIO_NAMES.map((name) => scenarios[name].shipmentId);
  expect(new Set(ids).size === ids.length, "Gate 13 scenario shipments must be unique.");
  const organizationId = exactUuid(raw.organizationId, "organization ID");
  const brandId = exactUuid(raw.brandId, "brand ID");
  const candidateRevision = required(
    raw.candidateRevision,
    "fixture candidate revision",
  ).toLowerCase();
  expect(
    SHA_PATTERN.test(candidateRevision),
    "Fixture candidate revision must be a 40-character Git SHA.",
  );
  const crossTenantShipmentId = exactUuid(
    raw.crossTenantShipmentId,
    "cross-tenant shipment ID",
  );
  const crossTenantBrandId = exactUuid(
    raw.crossTenantBrandId,
    "cross-tenant brand ID",
  );
  expect(
    !ids.includes(crossTenantShipmentId),
    "Cross-tenant shipment must not be a scenario fixture.",
  );
  expect(
    crossTenantBrandId !== brandId,
    "Cross-tenant brand must differ from the acceptance brand.",
  );
  const staffEmail = required(raw.staffEmail, "staff email").toLowerCase();
  expect(
    /^[^@+]+\+vinifera-g13-[^@]+@[^@]+$/u.test(staffEmail),
    "Gate 13 staff must use a dedicated plus-address fixture.",
  );
  const staffPassword = required(raw.staffPassword, "staff password");
  expect(staffPassword.length >= 12, "Gate 13 staff password is too short.");
  return {
    brandId,
    candidateRevision,
    crossTenantBrandId,
    crossTenantShipmentId,
    fingerprintMutationAddress: normalizeAddress(
      raw.fingerprintMutationAddress,
    ),
    organizationId,
    scenarios,
    staffEmail,
    staffPassword,
  };
}

export function validateEvidenceBinding(env, policyText) {
  const repository = required(env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  expect(
    repository === "theonlygeranium/vinifera",
    "Gate 13 accepts only the canonical Vinifera repository.",
  );
  const controlSha = required(env.GATE13_CONTROL_SHA, "GATE13_CONTROL_SHA")
    .toLowerCase();
  const workflowSha = required(env.GITHUB_SHA, "GITHUB_SHA").toLowerCase();
  const candidateRevision = required(
    env.GATE13_CANDIDATE_REVISION,
    "GATE13_CANDIDATE_REVISION",
  ).toLowerCase();
  expect(SHA_PATTERN.test(controlSha), "Gate 13 control SHA is invalid.");
  expect(
    controlSha === workflowSha,
    "Gate 13 control SHA does not match the workflow revision.",
  );
  expect(
    SHA_PATTERN.test(candidateRevision),
    "Gate 13 candidate revision is invalid.",
  );
  const runId = required(env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  const runAttempt = required(env.GITHUB_RUN_ATTEMPT, "GITHUB_RUN_ATTEMPT");
  expect(RUN_ID_PATTERN.test(runId), "GitHub run ID is invalid.");
  expect(RUN_ID_PATTERN.test(runAttempt), "GitHub run attempt is invalid.");
  return {
    candidateRevision,
    controlSha,
    policySha256: sha256(policyText),
    repository,
    runAttempt,
    runId,
  };
}

export function authorizeTargets({ env, manifest, manifestText, policy }) {
  expect(policy.enabled, "Gate 13 staging acceptance policy is disabled.");
  expect(
    env.STAGING_GATE13_ACCEPTANCE_ENABLED === "true",
    "Gate 13 staging acceptance toggle is disabled.",
  );
  expect(
    env.GATE13_ACCEPTANCE_CONFIRMATION ===
      "RUN VINIFERA GATE 13 SHIPCOMPLIANT ACCEPTANCE",
    "Exact Gate 13 acceptance confirmation is required.",
  );
  expect(
    required(env.SHIPCOMPLIANT_ENDPOINT_MODE, "SHIPCOMPLIANT_ENDPOINT_MODE") ===
      "sandbox",
    "Gate 13 accepts only ShipCompliant sandbox mode.",
  );
  expect(
    required(env.COMPLIANCE_PROVIDER, "COMPLIANCE_PROVIDER") ===
      "shipcompliant",
    "Gate 13 requires the real ShipCompliant provider.",
  );
  expect(
    env.COMPLIANCE_SIMULATOR_ENABLED === "false",
    "The compliance simulator must remain disabled.",
  );
  expect(
    manifest.candidateRevision ===
      required(
        env.GATE13_CANDIDATE_REVISION,
        "GATE13_CANDIDATE_REVISION",
      ).toLowerCase(),
    "Gate 13 fixture manifest is not bound to the exact candidate revision.",
  );
  const workerOrigin = exactHttpsOrigin(
    env.STAGING_WORKER_ORIGIN,
    "STAGING_WORKER_ORIGIN",
  );
  expect(
    workerOrigin === APPROVED_WORKER_ORIGIN,
    "Gate 13 Worker origin is not the approved isolated staging target.",
  );
  const sandboxOrigin = exactHttpsOrigin(
    env.SHIPCOMPLIANT_BASE_URL,
    "SHIPCOMPLIANT_BASE_URL",
  );
  const supabaseUrl = exactHttpsOrigin(env.SUPABASE_URL, "SUPABASE_URL");
  const contractVersion = required(
    env.SHIPCOMPLIANT_CONTRACT_VERSION,
    "SHIPCOMPLIANT_CONTRACT_VERSION",
  );
  const fixtureManifestSha256 = required(
    env.STAGING_GATE13_ACCEPTANCE_MANIFEST_SHA256,
    "STAGING_GATE13_ACCEPTANCE_MANIFEST_SHA256",
  ).toLowerCase();
  expect(
    SHA256_PATTERN.test(fixtureManifestSha256) &&
      fixtureManifestSha256 === sha256(manifestText),
    "Gate 13 protected manifest hash is unauthorized.",
  );
  const actual = {
    accountIdSha256: sha256(required(env.SHIPCOMPLIANT_ACCOUNT_ID, "SHIPCOMPLIANT_ACCOUNT_ID")),
    checkPathSha256: sha256(exactApiPath(env.SHIPCOMPLIANT_CHECK_PATH, "SHIPCOMPLIANT_CHECK_PATH")),
    contractVersionSha256: sha256(contractVersion),
    fixtureManifestSha256,
    licenseIdSha256: sha256(required(env.SHIPCOMPLIANT_LICENSE_ID, "SHIPCOMPLIANT_LICENSE_ID")),
    sandboxOriginSha256: sha256(sandboxOrigin),
    stagingSupabaseUrlSha256: sha256(supabaseUrl),
    stagingWorkerOriginSha256: sha256(workerOrigin),
    tokenPathSha256: sha256(exactApiPath(env.SHIPCOMPLIANT_TOKEN_PATH, "SHIPCOMPLIANT_TOKEN_PATH")),
  };
  for (const field of POLICY_HASH_FIELDS) {
    expect(
      policy[field].includes(actual[field]),
      `${field} is not authorized by exact Gate 13 policy.`,
    );
  }
  return {
    actual,
    contractVersion,
    sandboxOrigin,
    supabaseUrl,
    workerOrigin,
  };
}

export function validateScenarioResult(data, expectedStatus, { timeout = false } = {}) {
  expect(data && typeof data === "object", "Compliance response is invalid.");
  expect(data.provider === "shipcompliant", "Compliance response used another provider.");
  expect(data.status === expectedStatus, `Expected ${expectedStatus} compliance status.`);
  expect(
    typeof data.providerResponseId === "string" && data.providerResponseId,
    "Compliance response lacks an auditable provider response ID.",
  );
  if (timeout) {
    expect(
      data.providerResponseId.startsWith("local-timeout-"),
      "Timeout evidence must use the timeout-specific local audit ID.",
    );
  } else {
    expect(
      !data.providerResponseId.startsWith("local-"),
      "Vendor scenario evidence must retain a real provider response ID.",
    );
  }
  if (expectedStatus === "compliant") {
    expect(
      Number.isInteger(data.taxEstimateCents) && data.taxEstimateCents >= 0,
      "Compliant evidence requires a nonnegative tax estimate.",
    );
  } else {
    expect(
      typeof data.reason === "string" && data.reason.trim(),
      "Blocked compliance evidence requires a reason.",
    );
  }
  return data;
}

export function buildEvidence({ checks, cleanup, generatedAt, source, targets }) {
  const requiredChecks = [
    "exactRevisionAndConfiguration",
    "exactSandboxBinding",
    "tenantScopedFixtures",
    "compliantDecisionAndTax",
    "nonCompliantFailClosed",
    "unknownFailClosed",
    "timeoutFailClosed",
    "crossTenantDenied",
    "fingerprintInvalidation",
    "labelRecovery",
    "appendOnlyAuditEvidence",
  ];
  const passed =
    cleanup === true && requiredChecks.every((name) => checks[name] === true);
  return {
    checks: Object.fromEntries(
      requiredChecks.map((name) => [name, checks[name] === true]),
    ),
    cleanup: cleanup === true,
    completionClaimed: false,
    evidenceLevel: "hosted-shipcompliant-acceptance",
    gate: 13,
    generatedAt,
    passed,
    schemaVersion: 1,
    source,
    targets,
  };
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Gate 13 arguments must be --name value pairs.");
    }
    values[name.slice(2)] = value;
  }
  expect(values.output, "Gate 13 evidence output is required.");
  return values;
}

async function boundedJson(response) {
  const reader = response.body?.getReader();
  expect(reader, "Hosted response has no body.");
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Hosted response exceeded its size limit.");
    }
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

export function createBoundedAccessFetch({
  accessHeaders,
  fetchImpl = fetch,
  origin,
}) {
  const allowedOrigin = new URL(origin).origin;
  return async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    expect(
      url.origin === allowedOrigin,
      "Gate 13 Supabase request escaped its reviewed origin.",
    );
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    for (const [name, value] of Object.entries(accessHeaders)) {
      headers.set(name, value);
    }
    return fetchImpl(url, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  };
}

function mergeCookies(jar, response) {
  const raw = response.headers.get("set-cookie");
  if (!raw) return;
  for (const value of raw.split(/,(?=\s*[^;,=\s]+=[^;,]*)/u)) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const outputPath = resolve(args.output);
  const policyText = await readFile(POLICY_PATH, "utf8");
  const source = validateEvidenceBinding(process.env, policyText);
  const evidenceBase = {
    source,
    targets: null,
  };
  const checks = {};
  let cleanup = true;
  let runError = null;
  let fingerprintSnapshot = null;
  let fingerprintIdentity = null;
  let admin = null;

  try {
    const policy = validatePolicy(JSON.parse(policyText));
    const manifestText = required(
      process.env.GATE13_ACCEPTANCE_MANIFEST,
      "GATE13_ACCEPTANCE_MANIFEST",
    );
    const manifest = validateFixtureManifest(JSON.parse(manifestText));
    const authorized = authorizeTargets({
      env: process.env,
      manifest,
      manifestText,
      policy,
    });
    evidenceBase.targets = authorized.actual;
    const accessHeaders = {
      "CF-Access-Client-Id": required(
        process.env.CF_ACCESS_CLIENT_ID,
        "CF_ACCESS_CLIENT_ID",
      ),
      "CF-Access-Client-Secret": required(
        process.env.CF_ACCESS_CLIENT_SECRET,
        "CF_ACCESS_CLIENT_SECRET",
      ),
    };
    admin = createClient(
      authorized.supabaseUrl,
      required(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          fetch: createBoundedAccessFetch({
            accessHeaders,
            origin: authorized.supabaseUrl,
          }),
          headers: accessHeaders,
        },
      },
    );
    const jar = new Map();
    async function request(path, init = {}) {
      const headers = {
        Accept: "application/json",
        ...accessHeaders,
        origin: authorized.workerOrigin,
        ...init.headers,
      };
      if (jar.size) {
        headers.cookie = [...jar.entries()]
          .map(([name, value]) => `${name}=${value}`)
          .join("; ");
      }
      const response = await fetch(new URL(path, authorized.workerOrigin), {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      mergeCookies(jar, response);
      return { body: await boundedJson(response), response };
    }
    function expectStatus(result, status, label) {
      expect(
        result.response.status === status,
        `${label}: expected HTTP ${status}, received ${result.response.status}.`,
      );
    }
    function validateRuntimeConfiguration(result, label) {
      expectStatus(result, 200, label);
      for (const capability of [
        "app",
        "billing",
        "compliance",
        "database",
        "shipping",
      ]) {
        expect(
          result.body?.data?.[capability]?.configured === true,
          `${label}: ${capability} is not configured.`,
        );
      }
      expect(
        result.body?.data?.database?.bindingHashes?.supabaseUrlSha256 ===
          authorized.actual.stagingSupabaseUrlSha256,
        `${label}: Worker runtime Supabase target does not match the reviewed Gate 13 binding.`,
      );
      const runtimeHashes = result.body?.data?.compliance?.bindingHashes;
      for (const field of [
        "accountIdSha256",
        "checkPathSha256",
        "contractVersionSha256",
        "licenseIdSha256",
        "sandboxOriginSha256",
        "tokenPathSha256",
      ]) {
        expect(
          runtimeHashes?.[field] === authorized.actual[field],
          `${label}: Worker runtime ${field} does not match the reviewed Gate 13 binding.`,
        );
      }
    }
    const requestHeaders = { "x-vinifera-brand-id": manifest.brandId };
    const startedAt = new Date().toISOString();
    const [health, configuration] = await Promise.all([
      request("/api/health"),
      request("/api/health/configuration"),
    ]);
    expectStatus(health, 200, "Worker health");
    validateRuntimeConfiguration(configuration, "Worker configuration");
    expect(
      health.body?.data?.environment === "staging" &&
        health.body?.data?.revision === source.candidateRevision &&
        health.body?.data?.service === "vinifera-api" &&
        health.body?.data?.status === "ok",
      "Gate 13 Worker identity or exact revision did not match.",
    );

    const login = await request("/api/auth/staff/login", {
      body: JSON.stringify({
        email: manifest.staffEmail,
        password: manifest.staffPassword,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expectStatus(login, 200, "Gate 13 staff login");
    const session = await request("/api/auth/staff/session", {
      headers: requestHeaders,
    });
    expectStatus(session, 200, "Gate 13 staff session");
    expect(
      session.body?.data?.authenticated === true &&
        session.body?.data?.organization?.id === manifest.organizationId,
      "Gate 13 staff session is outside the fixture organization.",
    );
    const actorUserId = exactUuid(
      session.body?.data?.user?.id,
      "Gate 13 staff actor user ID",
    );

    const scenarioIds = SCENARIO_NAMES.map(
      (name) => manifest.scenarios[name].shipmentId,
    );
    const { data: shipments, error: shipmentError } = await admin
      .from("shipments")
      .select("id,organization_id,brand_id,status,shipping_address,latest_compliance_check_id,compliance_status,members!inner(email)")
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .in("id", scenarioIds);
    if (shipmentError) throw shipmentError;
    expect(shipments.length === scenarioIds.length, "Gate 13 fixture inventory is incomplete.");
    for (const shipment of shipments) {
      const member = Array.isArray(shipment.members)
        ? shipment.members[0]
        : shipment.members;
      const expectedStatus =
        shipment.id === manifest.scenarios.recovery.shipmentId
          ? "label_created"
          : "charged";
      expect(
        shipment.status === expectedStatus,
        `Gate 13 fixture ${shipment.id} must be ${expectedStatus}.`,
      );
      expect(
        String(member?.email ?? "").includes("+vinifera-g13-"),
        "Gate 13 shipment is not owned by a dedicated fixture member.",
      );
      if (shipment.id === manifest.scenarios.fingerprint.shipmentId) {
        expect(
          shipment.latest_compliance_check_id === null &&
            shipment.compliance_status === null,
          "Fingerprint fixture must begin from the documented invalidated baseline.",
        );
      }
    }
    const fingerprintFixture = shipments.find(
      (shipment) => shipment.id === manifest.scenarios.fingerprint.shipmentId,
    );
    expect(
      fingerprintFixture?.shipping_address &&
        typeof fingerprintFixture.shipping_address === "object",
      "Fingerprint fixture must have a restorable shipping address.",
    );
    fingerprintIdentity = {
      brandId: manifest.brandId,
      organizationId: manifest.organizationId,
      shipmentId: manifest.scenarios.fingerprint.shipmentId,
    };
    fingerprintSnapshot = fingerprintFixture.shipping_address;
    const { data: crossTenant, error: crossTenantError } = await admin
      .from("shipments")
      .select("id,organization_id,brand_id")
      .eq("id", manifest.crossTenantShipmentId)
      .eq("brand_id", manifest.crossTenantBrandId)
      .neq("organization_id", manifest.organizationId)
      .single();
    if (crossTenantError) throw crossTenantError;
    expect(crossTenant, "Cross-tenant fixture is not outside the acceptance organization.");
    const { data: recoveryAttempts, error: recoveryError } = await admin
      .from("shipping_label_attempts")
      .select("id,status,provider,request_fingerprint,external_label_id,label_url,tracking_number")
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .eq("shipment_id", manifest.scenarios.recovery.shipmentId)
      .eq("status", "succeeded");
    if (recoveryError) throw recoveryError;
    expect(
      recoveryAttempts.length === 1 &&
        recoveryAttempts[0].provider === "easypost" &&
        recoveryAttempts[0].external_label_id &&
        recoveryAttempts[0].label_url &&
        recoveryAttempts[0].tracking_number,
      "Recovery fixture requires one succeeded EasyPost attempt.",
    );
    const recoveryShipmentBefore = shipments.find(
      (shipment) =>
        shipment.id === manifest.scenarios.recovery.shipmentId,
    );
    expect(recoveryShipmentBefore, "Recovery fixture shipment is missing.");
    checks.tenantScopedFixtures = true;
    const analyticsKeys = new Set();
    const complianceResponseIds = new Set();

    async function runScenario(name, expectedStatus, options = {}) {
      const shipmentId = manifest.scenarios[name].shipmentId;
      const response = await request(
        `/api/compliance/shipments/${shipmentId}/check`,
        { headers: requestHeaders, method: "POST" },
      );
      expectStatus(response, 201, `${name} compliance check`);
      const result = validateScenarioResult(
        response.body?.data,
        expectedStatus,
        options,
      );
      analyticsKeys.add(
        analyticsEventIdempotencyKey({
          actorUserId,
          eventType: "shipment.compliance_checked",
          organizationId: manifest.organizationId,
          requestKey: `compliance:${shipmentId}:${result.providerResponseId}`,
        }),
      );
      complianceResponseIds.add(result.providerResponseId);
      return result;
    }
    await runScenario("compliant", "compliant");
    checks.compliantDecisionAndTax = true;
    await runScenario("nonCompliant", "non_compliant");
    await runScenario("unknown", "unknown");
    await runScenario("timeout", "unknown", { timeout: true });

    const blockedNames = ["nonCompliant", "unknown", "timeout"];
    const blockedStatuses = {
      nonCompliant: "non_compliant",
      timeout: "unknown",
      unknown: "unknown",
    };
    const blockedIds = blockedNames.map(
      (name) => manifest.scenarios[name].shipmentId,
    );
    const { count: attemptsBefore, error: attemptsBeforeError } = await admin
      .from("shipping_label_attempts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .in("shipment_id", blockedIds);
    if (attemptsBeforeError) throw attemptsBeforeError;
    for (const name of blockedNames) {
      const shipmentId = manifest.scenarios[name].shipmentId;
      const response = await request("/api/shipments/labels", {
        body: JSON.stringify({ shipmentIds: [shipmentId] }),
        headers: { ...requestHeaders, "content-type": "application/json" },
        method: "POST",
      });
      expectStatus(response, 200, `${name} label denial`);
      expect(
        response.body?.data?.generated === 0 &&
          response.body?.data?.failed === 1 &&
          response.body?.data?.results?.[0]?.success === false &&
          response.body?.data?.results?.[0]?.error?.status ===
            blockedStatuses[name] &&
          response.body?.data?.results?.[0]?.compliance?.status ===
            blockedStatuses[name] &&
          response.body?.data?.results?.[0]?.compliance?.provider ===
            "shipcompliant" &&
          typeof response.body?.data?.results?.[0]?.compliance
            ?.providerResponseId === "string" &&
          response.body.data.results[0].compliance.providerResponseId,
        `${name} did not fail closed before label creation.`,
      );
      const denial = response.body.data.results[0].compliance;
      if (name === "timeout") {
        expect(
          denial.providerResponseId.startsWith("local-timeout-"),
          "Timeout label denial did not come from the timeout decision.",
        );
      } else {
        expect(
          !denial.providerResponseId.startsWith("local-"),
          `${name} label denial did not retain a vendor decision.`,
        );
      }
      analyticsKeys.add(
        analyticsEventIdempotencyKey({
          actorUserId,
          eventType: "shipment.compliance_checked",
          organizationId: manifest.organizationId,
          requestKey: `compliance:${shipmentId}:${denial.providerResponseId}`,
        }),
      );
      complianceResponseIds.add(denial.providerResponseId);
    }
    const { count: attemptsAfter, error: attemptsAfterError } = await admin
      .from("shipping_label_attempts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .in("shipment_id", blockedIds);
    if (attemptsAfterError) throw attemptsAfterError;
    expect(
      Number.isInteger(attemptsBefore) &&
        Number.isInteger(attemptsAfter) &&
        attemptsAfter === attemptsBefore,
      "A blocked ShipCompliant decision created a label attempt.",
    );
    checks.nonCompliantFailClosed = true;
    checks.unknownFailClosed = true;
    checks.timeoutFailClosed = true;

    const crossTenantResponse = await request(
      `/api/compliance/shipments/${manifest.crossTenantShipmentId}/check`,
      { headers: requestHeaders, method: "POST" },
    );
    expect(
      [403, 404].includes(crossTenantResponse.response.status),
      "Cross-tenant compliance request was not denied.",
    );
    checks.crossTenantDenied = true;

    await runScenario("fingerprint", "compliant");
    const { data: fingerprintShipment, error: fingerprintError } = await admin
      .from("shipments")
      .select("shipping_address,latest_compliance_check_id,compliance_status")
      .eq("id", fingerprintIdentity.shipmentId)
      .eq("organization_id", fingerprintIdentity.organizationId)
      .eq("brand_id", fingerprintIdentity.brandId)
      .single();
    if (fingerprintError) throw fingerprintError;
    expect(
      fingerprintShipment.latest_compliance_check_id,
      "Fingerprint fixture lacks its compliant decision.",
    );
    expect(
      fingerprintShipment.compliance_status === "compliant",
      "Fingerprint fixture did not retain its compliant decision status.",
    );
    const { data: mutatedRows, error: mutationError } = await admin
      .from("shipments")
      .update({ shipping_address: manifest.fingerprintMutationAddress })
      .eq("id", fingerprintIdentity.shipmentId)
      .eq("organization_id", fingerprintIdentity.organizationId)
      .eq("brand_id", fingerprintIdentity.brandId)
      .select("id");
    if (mutationError) throw mutationError;
    expect(
      mutatedRows?.length === 1,
      "Fingerprint mutation did not affect exactly one fixture shipment.",
    );
    const { data: invalidated, error: invalidatedError } = await admin
      .from("shipments")
      .select("latest_compliance_check_id,compliance_status")
      .eq("id", fingerprintIdentity.shipmentId)
      .eq("organization_id", fingerprintIdentity.organizationId)
      .eq("brand_id", fingerprintIdentity.brandId)
      .single();
    if (invalidatedError) throw invalidatedError;
    expect(
      invalidated.latest_compliance_check_id === null &&
        invalidated.compliance_status === null,
      "Compliance-relevant shipment mutation did not invalidate the decision.",
    );
    checks.fingerprintInvalidation = true;

    const recoveryResponse = await request("/api/shipments/labels", {
      body: JSON.stringify({
        shipmentIds: [manifest.scenarios.recovery.shipmentId],
      }),
      headers: { ...requestHeaders, "content-type": "application/json" },
      method: "POST",
    });
    expectStatus(recoveryResponse, 200, "recovered label request");
    expect(
      recoveryResponse.body?.data?.generated === 1 &&
        recoveryResponse.body?.data?.results?.[0]?.success === true &&
        recoveryResponse.body?.data?.results?.[0]?.recovered === true,
      "The durable EasyPost label attempt was not recovered.",
    );
    const { data: recoveryShipmentAfter, error: recoveryShipmentError } =
      await admin
        .from("shipments")
        .select("id,status,latest_compliance_check_id,compliance_status")
        .eq("id", manifest.scenarios.recovery.shipmentId)
        .eq("organization_id", manifest.organizationId)
        .eq("brand_id", manifest.brandId)
        .single();
    if (recoveryShipmentError) throw recoveryShipmentError;
    expect(
      recoveryShipmentAfter.status === recoveryShipmentBefore.status &&
        recoveryShipmentAfter.latest_compliance_check_id ===
          recoveryShipmentBefore.latest_compliance_check_id &&
        recoveryShipmentAfter.compliance_status ===
          recoveryShipmentBefore.compliance_status,
      "Recovery changed the reusable shipment fixture.",
    );
    const { data: recoveryAttemptsAfter, error: recoveryAttemptsAfterError } =
      await admin
        .from("shipping_label_attempts")
        .select("id,status,provider,request_fingerprint,external_label_id,label_url,tracking_number")
        .eq("organization_id", manifest.organizationId)
        .eq("brand_id", manifest.brandId)
        .eq("shipment_id", manifest.scenarios.recovery.shipmentId)
        .eq("status", "succeeded");
    if (recoveryAttemptsAfterError) throw recoveryAttemptsAfterError;
    expect(
      JSON.stringify(recoveryAttemptsAfter) === JSON.stringify(recoveryAttempts),
      "Recovery changed the reusable succeeded-attempt fixture.",
    );
    checks.labelRecovery = true;

    const { data: complianceRows, error: complianceError } = await admin
      .from("compliance_checks")
      .select("shipment_id,status,provider,provider_response_id,request_fingerprint,shipment_state_fingerprint,metadata,tax_estimate_cents")
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .in("shipment_id", scenarioIds)
      .in("provider_response_id", [...complianceResponseIds]);
    if (complianceError) throw complianceError;
    expect(
      complianceRows.length === complianceResponseIds.size &&
        complianceRows.every((row) =>
          complianceResponseIds.has(row.provider_response_id),
        ),
      "Append-only compliance evidence is incomplete.",
    );
    for (const row of complianceRows) {
      expect(row.provider === "shipcompliant", "Audit row used another compliance provider.");
      expect(SHA256_PATTERN.test(row.request_fingerprint), "Request fingerprint is invalid.");
      expect(SHA256_PATTERN.test(row.shipment_state_fingerprint), "State fingerprint is invalid.");
      expect(
        row.metadata?.contract_version === authorized.contractVersion,
        "Audit row contract version does not match the reviewed binding.",
      );
    }
    const { data: analyticsRows, error: analyticsError } = await admin
      .from("analytics_events")
      .select("idempotency_key")
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .eq("event_type", "shipment.compliance_checked")
      .in("idempotency_key", [...analyticsKeys]);
    if (analyticsError) throw analyticsError;
    const { count: auditCount, error: auditError } = await admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .eq("action", "shipment.labels_generated")
      .gte("created_at", startedAt);
    if (auditError) throw auditError;
    expect(
      analyticsRows.length === analyticsKeys.size &&
        analyticsRows.every((row) => analyticsKeys.has(row.idempotency_key)) &&
        Number(auditCount) >= 4,
      "Gate 13 analytics or audit evidence is incomplete.",
    );
    checks.appendOnlyAuditEvidence = true;

    const [finalHealth, finalConfiguration] = await Promise.all([
      request("/api/health"),
      request("/api/health/configuration"),
    ]);
    expectStatus(finalHealth, 200, "Final Worker health");
    validateRuntimeConfiguration(
      finalConfiguration,
      "Final Worker configuration",
    );
    expect(
      finalHealth.body?.data?.environment === "staging" &&
        finalHealth.body?.data?.revision === source.candidateRevision &&
        finalHealth.body?.data?.service === "vinifera-api" &&
        finalHealth.body?.data?.status === "ok",
      "Gate 13 Worker identity or exact revision changed during acceptance.",
    );
    checks.exactRevisionAndConfiguration = true;
    checks.exactSandboxBinding = true;
  } catch (error) {
    runError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (fingerprintSnapshot && fingerprintIdentity && admin) {
      const { data: restoredRows, error } = await admin
        .from("shipments")
        .update(fingerprintCleanupPatch(fingerprintSnapshot))
        .eq("id", fingerprintIdentity.shipmentId)
        .eq("organization_id", fingerprintIdentity.organizationId)
        .eq("brand_id", fingerprintIdentity.brandId)
        .select("id,shipping_address,latest_compliance_check_id,compliance_status");
      if (
        error ||
        restoredRows?.length !== 1 ||
        JSON.stringify(restoredRows[0].shipping_address) !==
          JSON.stringify(fingerprintSnapshot) ||
        restoredRows[0].latest_compliance_check_id !== null ||
        restoredRows[0].compliance_status !== null
      ) {
        cleanup = false;
        if (!runError) runError = new Error("Gate 13 fingerprint fixture cleanup failed.");
      }
    }
    const evidence = buildEvidence({
      checks,
      cleanup,
      generatedAt: new Date().toISOString(),
      source: evidenceBase.source,
      targets: evidenceBase.targets,
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  if (runError) throw runError;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
