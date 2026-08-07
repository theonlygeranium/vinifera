import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const POLICY_PATH = resolve(
  import.meta.dirname,
  "../config/gate6-staging-acceptance-policy.json",
);
const APPROVED_WORKER_ORIGIN =
  "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const STRIPE_API_VERSION = "2026-02-25.clover";
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TEST_MEMBER_COUNT = 10;
const MAX_RESPONSE_BYTES = 64 * 1024;
const POLICY_HASH_FIELDS = Object.freeze([
  "fixtureContractSha256",
  "stagingWorkerOriginSha256",
  "stagingSupabaseUrlSha256",
  "stripeAccountIdSha256",
]);

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function required(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

export function requiredRaw(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function deterministicCommandId(value) {
  const hex = sha256(value).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8).join(""),
    hex.slice(8, 12).join(""),
    hex.slice(12, 16).join(""),
    hex.slice(16, 20).join(""),
    hex.slice(20).join(""),
  ].join("-");
}

export function validateStripeTestSecret(value) {
  const secret = required(value, "STRIPE_SECRET_KEY");
  expect(
    secret.startsWith("sk_test_") && secret.length > "sk_test_".length,
    "STRIPE_SECRET_KEY must be an sk_test_ credential.",
  );
  return secret;
}

export function validateNegativeControl(brand, staff, manifest) {
  expect(
    brand?.id === manifest.crossTenantBrandId &&
      brand.active === true &&
      typeof brand.organization_id === "string" &&
      brand.organization_id !== manifest.organizationId,
    "Gate 6 negative-control brand must be an active brand in another staging tenant.",
  );
  expect(
    staff?.organization_id === manifest.organizationId &&
      staff.status === "active" &&
      ["owner", "admin"].includes(staff.role) &&
      staff.email?.toLowerCase() === manifest.staffEmail,
    "Gate 6 fixture staff identity is not an active refund-authorized principal in its declared tenant.",
  );
  return true;
}

export function supabaseAdminClientOptions(accessHeaders) {
  return {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: accessHeaders },
  };
}

export function validateGate6AuditRows(rows, manifest, refundShipmentId, baseline) {
  expect(Array.isArray(rows) && rows.length > 0, "Gate 6 audit evidence is missing.");
  expect(rows.length < 1_000, "Gate 6 audit evidence exceeded the bounded query window.");
  const hashPattern = /^[a-f0-9]{64}$/u;
  const firstSequence = BigInt(rows[0].sequence_number);
  if (baseline) {
    expect(
      hashPattern.test(baseline.entry_hash ?? "") && BigInt(baseline.sequence_number) > 0n,
      "Gate 6 audit baseline is invalid.",
    );
    expect(
      firstSequence === BigInt(baseline.sequence_number) + 1n &&
        rows[0].previous_hash === baseline.entry_hash,
      "Gate 6 audit baseline linkage is broken.",
    );
  } else {
    expect(
      firstSequence === 1n && rows[0].previous_hash === null,
      "Gate 6 audit genesis linkage is broken.",
    );
  }
  for (const [index, row] of rows.entries()) {
    expect(hashPattern.test(row.entry_hash ?? ""), "Gate 6 audit entry hash is invalid.");
    const sequence = BigInt(row.sequence_number);
    expect(sequence > 0n, "Gate 6 audit sequence is invalid.");
    if (index > 0) {
      const previous = rows[index - 1];
      expect(
        sequence === BigInt(previous.sequence_number) + 1n &&
          row.previous_hash === previous.entry_hash,
        "Gate 6 audit sequence or hash linkage is broken.",
      );
    }
  }

  const fixtureShipmentIds = new Set(manifest.members.map((member) => member.shipmentId));
  const declinedShipmentId = manifest.members.find((member) => member.declined)?.shipmentId;
  const matchingIds = (action, entityType, brandScoped = true) =>
    new Set(
      rows
        .filter(
          (row) =>
            row.action === action &&
            row.entity_type === entityType &&
            (!brandScoped || row.brand_id === manifest.brandId),
        )
        .map((row) => row.entity_id),
    );
  const expectExactIds = (action, entityType, expectedIds, brandScoped = true) => {
    const actual = matchingIds(action, entityType, brandScoped);
    expect(
      actual.size === expectedIds.size && [...expectedIds].every((id) => actual.has(id)),
      `Gate 6 audit evidence is incomplete for ${action}.`,
    );
  };

  expectExactIds("release.processed", "release", new Set([manifest.releaseId]));
  expectExactIds(
    "shipment.labels_generated",
    "organization",
    new Set([manifest.organizationId]),
  );
  expectExactIds("shipment.charge_succeeded", "shipment", fixtureShipmentIds);
  expectExactIds("shipment.charge_declined", "shipment", new Set([declinedShipmentId]));
  expectExactIds("shipment.item_packed", "shipment", fixtureShipmentIds);
  expectExactIds("shipment.shipped", "shipment", fixtureShipmentIds);
  expectExactIds("shipment.delivered", "shipment", fixtureShipmentIds);
  expectExactIds("shipment.refunded", "shipment", new Set([refundShipmentId]));
  return {
    firstSequence: String(rows[0].sequence_number),
    lastSequence: String(rows.at(-1).sequence_number),
    rowCount: rows.length,
  };
}

function exactUuid(value, label) {
  const normalized = required(value, label).toLowerCase();
  expect(UUID_PATTERN.test(normalized), `${label} must be a UUID.`);
  return normalized;
}

function exactHttpsOrigin(value, label) {
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

function hashList(value, label) {
  expect(
    Array.isArray(value) &&
      value.every((entry) => typeof entry === "string" && SHA256_PATTERN.test(entry)) &&
      new Set(value).size === value.length,
    `${label} must contain unique lowercase SHA-256 hashes.`,
  );
  return value;
}

export function validatePolicy(raw) {
  expect(
    raw && typeof raw === "object" && raw.schemaVersion === 2,
    "Gate 6 acceptance policy schema version is invalid.",
  );
  expect(typeof raw.enabled === "boolean", "Policy enabled must be boolean.");
  const policy = { schemaVersion: 2, enabled: raw.enabled };
  for (const field of POLICY_HASH_FIELDS) {
    policy[field] = hashList(raw[field], field);
    if (policy.enabled) {
      expect(
        policy[field].length === 1,
        `Enabled Gate 6 policy requires exactly one ${field} value.`,
      );
    }
  }
  return policy;
}

export function validateFixtureManifest(raw, expectedCandidateRevision) {
  expect(
    raw && typeof raw === "object" && raw.schemaVersion === 1,
    "Gate 6 fixture manifest schema version is invalid.",
  );
  expect(raw.cleanupMode === "retire", "Gate 6 fixtures must use retire cleanup.");
  const candidateRevision = required(
    raw.candidateRevision,
    "fixture candidate revision",
  ).toLowerCase();
  expect(
    SHA_PATTERN.test(candidateRevision),
    "Gate 6 fixture candidate revision is invalid.",
  );
  if (expectedCandidateRevision !== undefined) {
    expect(
      candidateRevision === expectedCandidateRevision,
      "Gate 6 fixture manifest is not for the exact staging candidate.",
    );
  }
  const organizationId = exactUuid(raw.organizationId, "organization ID");
  const brandId = exactUuid(raw.brandId, "brand ID");
  const crossTenantBrandId = exactUuid(
    raw.crossTenantBrandId,
    "cross-tenant brand ID",
  );
  expect(crossTenantBrandId !== brandId, "Cross-tenant brand must differ.");
  const tierId = exactUuid(raw.tierId, "tier ID");
  const releaseId = exactUuid(raw.releaseId, "release ID");
  const staffEmail = required(raw.staffEmail, "staff email").toLowerCase();
  expect(
    /^[^@+]+\+vinifera-g6-[^@]+@[^@]+$/u.test(staffEmail),
    "Gate 6 staff must use a dedicated plus-address fixture.",
  );
  const staffPassword = required(raw.staffPassword, "staff password");
  expect(staffPassword.length >= 12, "Gate 6 staff password is too short.");
  expect(
    Array.isArray(raw.members) && raw.members.length === TEST_MEMBER_COUNT,
    "Gate 6 requires exactly ten fixture members.",
  );
  const members = raw.members.map((member, index) => {
    const email = required(member?.email, `member ${index + 1} email`).toLowerCase();
    expect(
      /^[^@+]+\+vinifera-g6-[^@]+@[^@]+$/u.test(email),
      `Member ${index + 1} is not a dedicated Gate 6 plus-address.`,
    );
    return {
      declined: member?.declined === true,
      email,
      id: exactUuid(member?.id, `member ${index + 1} ID`),
      shipmentId: exactUuid(
        member?.shipmentId,
        `member ${index + 1} shipment ID`,
      ),
    };
  });
  expect(
    members.filter((member) => member.declined).length === 1,
    "Exactly one Gate 6 member must use the decline scenario.",
  );
  expect(
    new Set(members.map((member) => member.id)).size === TEST_MEMBER_COUNT &&
      new Set(members.map((member) => member.email)).size === TEST_MEMBER_COUNT &&
      new Set(members.map((member) => member.shipmentId)).size === TEST_MEMBER_COUNT,
    "Gate 6 member, email, and shipment identifiers must be unique.",
  );
  return {
    brandId,
    candidateRevision,
    cleanupMode: "retire",
    crossTenantBrandId,
    members,
    organizationId,
    releaseId,
    staffEmail,
    staffPassword,
    tierId,
  };
}

export function fixtureContractSha256(manifest) {
  return sha256(
    JSON.stringify({
      brandId: manifest.brandId,
      cleanupMode: manifest.cleanupMode,
      crossTenantBrandId: manifest.crossTenantBrandId,
      members: manifest.members,
      organizationId: manifest.organizationId,
      releaseId: manifest.releaseId,
      staffEmail: manifest.staffEmail,
      tierId: manifest.tierId,
    }),
  );
}

export function validateEvidenceBinding(env, policyText) {
  expect(
    required(env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY") ===
      "theonlygeranium/vinifera",
    "Gate 6 accepts only the canonical Vinifera repository.",
  );
  const controlSha = required(env.GATE6_CONTROL_SHA, "GATE6_CONTROL_SHA").toLowerCase();
  const candidateRevision = required(
    env.GATE6_CANDIDATE_REVISION,
    "GATE6_CANDIDATE_REVISION",
  ).toLowerCase();
  expect(SHA_PATTERN.test(controlSha), "Gate 6 control SHA is invalid.");
  expect(
    controlSha === required(env.GITHUB_SHA, "GITHUB_SHA").toLowerCase(),
    "Gate 6 control SHA does not match the workflow revision.",
  );
  expect(SHA_PATTERN.test(candidateRevision), "Gate 6 candidate revision is invalid.");
  expect(/^[1-9][0-9]*$/u.test(required(env.GITHUB_RUN_ID, "GITHUB_RUN_ID")), "GitHub run ID is invalid.");
  expect(/^[1-9][0-9]*$/u.test(required(env.GITHUB_RUN_ATTEMPT, "GITHUB_RUN_ATTEMPT")), "GitHub run attempt is invalid.");
  return {
    candidateRevision,
    controlSha,
    policySha256: sha256(policyText),
    repository: env.GITHUB_REPOSITORY,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    runId: env.GITHUB_RUN_ID,
  };
}

export function authorizeRuntimeManifest({ env, manifest, manifestText, policy }) {
  expect(policy.enabled, "Gate 6 staging acceptance policy is disabled.");
  expect(
    env.STAGING_GATE6_ACCEPTANCE_ENABLED === "true",
    "Gate 6 staging acceptance toggle is disabled.",
  );
  expect(
    env.GATE6_ACCEPTANCE_CONFIRMATION ===
      "RUN VINIFERA GATE 6 PHASE 2 ACCEPTANCE",
    "Exact Gate 6 acceptance confirmation is required.",
  );
  const manifestSha256 = sha256(manifestText);
  expect(
    required(
      env.GATE6_ACCEPTANCE_MANIFEST_SHA256,
      "GATE6_ACCEPTANCE_MANIFEST_SHA256",
    ).toLowerCase() === manifestSha256,
    "Fixture manifest is not authorized by protected runtime state.",
  );
  const contractSha256 = fixtureContractSha256(manifest);
  expect(
    policy.fixtureContractSha256.includes(contractSha256),
    "fixtureContractSha256 is not authorized by exact Gate 6 policy.",
  );
  return { fixtureContractSha256: contractSha256, fixtureManifestSha256: manifestSha256 };
}

export function authorizeTargets({ env, policy, stripeAccountId }) {
  expect(env.LIVE_BILLING_ENABLED === "false", "Live billing must remain disabled.");
  expect(env.SHIPPING_PROVIDER === "easypost", "Gate 6 requires EasyPost.");
  expect(
    env.SHIPPING_SIMULATOR_ENABLED === "false",
    "The shipping simulator must remain disabled.",
  );
  expect(env.COMPLIANCE_PROVIDER === "shipcompliant", "Gate 6 requires ShipCompliant.");
  expect(
    env.COMPLIANCE_SIMULATOR_ENABLED === "false",
    "The compliance simulator must remain disabled.",
  );
  const workerOrigin = exactHttpsOrigin(
    env.STAGING_WORKER_ORIGIN,
    "STAGING_WORKER_ORIGIN",
  );
  expect(
    workerOrigin === APPROVED_WORKER_ORIGIN,
    "Gate 6 Worker origin is not the approved isolated staging target.",
  );
  const supabaseUrl = exactHttpsOrigin(env.SUPABASE_URL, "SUPABASE_URL");
  const actual = {
    stagingSupabaseUrlSha256: sha256(supabaseUrl),
    stagingWorkerOriginSha256: sha256(workerOrigin),
    stripeAccountIdSha256: sha256(required(stripeAccountId, "Stripe account ID")),
  };
  for (const field of POLICY_HASH_FIELDS.filter(
    (name) => name !== "fixtureContractSha256",
  )) {
    expect(policy[field].includes(actual[field]), `${field} is not authorized by exact Gate 6 policy.`);
  }
  return { actual, supabaseUrl, workerOrigin };
}

export function validateGate13Evidence(raw, candidateRevision, runId) {
  expect(raw && typeof raw === "object", "Gate 13 evidence is missing.");
  expect(raw.gate === 13, "Prerequisite evidence is not Gate 13.");
  expect(raw.passed === true && raw.cleanup === true, "Gate 13 did not pass with cleanup.");
  expect(
    raw.completionClaimed === false,
    "Gate 13 evidence violated the completion-claim contract.",
  );
  expect(
    raw.source?.candidateRevision === candidateRevision,
    "Gate 13 evidence is not for the exact Gate 6 staging candidate.",
  );
  expect(
    String(raw.source?.runId) === String(runId),
    "Gate 13 evidence run does not match the declared prerequisite run.",
  );
  return {
    evidenceSha256: sha256(`${JSON.stringify(raw)}\n`),
    runId: String(runId),
  };
}

export function buildEvidence({ checks, cleanup, gate13, generatedAt, source, targets }) {
  const requiredChecks = [
    "exactRevisionAndProviders",
    "gate13Prerequisite",
    "exactTenTenantFixtures",
    "stripeTestCustomersAndMethods",
    "nineChargesOneDecline",
    "declineRecovery",
    "tenCompliantEasyPostLabels",
    "pickAndPack",
    "shipAndDeliver",
    "singleTestRefund",
    "tenantScopedAuditChain",
    "durableProviderIdentifiers",
  ];
  const passed =
    cleanup === true && requiredChecks.every((name) => checks[name] === true);
  return {
    checks: Object.fromEntries(requiredChecks.map((name) => [name, checks[name] === true])),
    cleanup: cleanup === true,
    completionClaimed: false,
    evidenceLevel: "hosted-phase2-provider-acceptance",
    gate: 6,
    gate13,
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
      throw new Error("Gate 6 arguments must be --name value pairs.");
    }
    values[name.slice(2)] = value;
  }
  expect(values.output, "Gate 6 evidence output is required.");
  expect(values["gate13-evidence"], "Gate 13 evidence path is required.");
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

export function splitSetCookieHeader(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/u).map((item) => item.trim());
}

export function setCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie().flatMap(splitSetCookieHeader);
  }
  return splitSetCookieHeader(response.headers.get("set-cookie"));
}

export function mergeCookieJar(jar, response) {
  for (const setCookie of setCookieHeaders(response)) {
    const parts = setCookie.split(";");
    const pair = parts[0];
    const separator = pair.indexOf("=");
    if (separator > 0) {
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const deleted = parts.slice(1).some((rawAttribute) => {
        const attribute = rawAttribute.trim();
        const maxAge = /^max-age\s*=\s*(-?\d+)$/iu.exec(attribute);
        if (maxAge) return Number(maxAge[1]) <= 0;
        const expires = /^expires\s*=\s*(.+)$/iu.exec(attribute);
        return expires ? Date.parse(expires[1]) <= Date.now() : false;
      });
      if (deleted) jar.delete(name);
      else jar.set(name, value);
    }
  }
}

function expectStatus(result, status, label) {
  if (result.response.status !== status) {
    const detail = result.body?.error?.message ? ` ${result.body.error.message}` : "";
    throw new Error(`${label}: expected HTTP ${status}, received ${result.response.status}.${detail}`);
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const outputPath = resolve(args.output);
  const policyText = await readFile(POLICY_PATH, "utf8");
  const source = validateEvidenceBinding(process.env, policyText);
  const checks = {};
  let cleanup = true;
  let runError = null;
  let targets = null;
  let gate13 = null;
  let admin = null;
  let manifest = null;
  let completedLifecycle = false;

  try {
    const manifestText = requiredRaw(
      process.env.GATE6_ACCEPTANCE_MANIFEST,
      "GATE6_ACCEPTANCE_MANIFEST",
    );
    manifest = validateFixtureManifest(
      JSON.parse(manifestText),
      source.candidateRevision,
    );
    const policy = validatePolicy(JSON.parse(policyText));
    const manifestAuthorization = authorizeRuntimeManifest({
      env: process.env,
      manifest,
      manifestText,
      policy,
    });
    const gate13Text = await readFile(resolve(args["gate13-evidence"]), "utf8");
    gate13 = validateGate13Evidence(
      JSON.parse(gate13Text),
      source.candidateRevision,
      required(process.env.GATE13_PREREQUISITE_RUN_ID, "GATE13_PREREQUISITE_RUN_ID"),
    );
    checks.gate13Prerequisite = true;
    const stripe = new Stripe(validateStripeTestSecret(process.env.STRIPE_SECRET_KEY), {
      apiVersion: STRIPE_API_VERSION,
    });
    const account = await stripe.accounts.retrieve();
    expect(account.id.startsWith("acct_"), "Stripe account identity is invalid.");
    targets = authorizeTargets({
      env: process.env,
      policy,
      stripeAccountId: account.id,
    });
    targets.actual = { ...targets.actual, ...manifestAuthorization };

    const accessHeaders = {
      "CF-Access-Client-Id": required(process.env.CF_ACCESS_CLIENT_ID, "CF_ACCESS_CLIENT_ID"),
      "CF-Access-Client-Secret": required(process.env.CF_ACCESS_CLIENT_SECRET, "CF_ACCESS_CLIENT_SECRET"),
    };
    admin = createClient(
      targets.supabaseUrl,
      required(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
      supabaseAdminClientOptions(accessHeaders),
    );
    const jar = new Map();
    async function request(path, init = {}) {
      const headers = {
        Accept: "application/json",
        origin: targets.workerOrigin,
        ...accessHeaders,
        ...init.headers,
      };
      if (jar.size) {
        headers.cookie = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
      }
      const response = await fetch(new URL(path, targets.workerOrigin), {
        ...init,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      mergeCookieJar(jar, response);
      return { body: await boundedJson(response), response };
    }
    const brandHeaders = { "x-vinifera-brand-id": manifest.brandId };
    const health = await request("/api/health");
    expectStatus(health, 200, "Worker health");
    expect(
      health.body?.data?.environment === "staging" &&
        health.body?.data?.revision === source.candidateRevision,
      "Worker identity or exact revision did not match.",
    );
    const configuration = await request("/api/health/configuration");
    expectStatus(configuration, 200, "Worker configuration");
    expect(configuration.body?.data?.billing?.configured === true, "Stripe billing is not configured.");
    expect(configuration.body?.data?.shipping?.configured === true, "EasyPost is not configured.");
    expect(configuration.body?.data?.compliance?.configured === true, "ShipCompliant is not configured.");
    checks.exactRevisionAndProviders = true;

    const login = await request("/api/auth/staff/login", {
      body: JSON.stringify({ email: manifest.staffEmail, password: manifest.staffPassword }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expectStatus(login, 200, "Gate 6 staff login");
    const session = await request("/api/auth/staff/session");
    expectStatus(session, 200, "Gate 6 staff session");
    expect(
      session.body?.data?.organization?.id === manifest.organizationId,
      "Gate 6 staff resolved outside the fixture organization.",
    );
    const [{ data: negativeBrand, error: negativeBrandError }, { data: fixtureStaff, error: fixtureStaffError }] =
      await Promise.all([
        admin
          .from("brands")
          .select("id,organization_id,active")
          .eq("id", manifest.crossTenantBrandId)
          .single(),
        admin
          .from("staff_users")
          .select("id,email,organization_id,role,status")
          .eq("id", session.body?.data?.user?.id)
          .single(),
      ]);
    if (negativeBrandError) throw negativeBrandError;
    if (fixtureStaffError) throw fixtureStaffError;
    validateNegativeControl(negativeBrand, fixtureStaff, manifest);
    const crossTenant = await request("/api/shipments?limit=100", {
      headers: { "x-vinifera-brand-id": manifest.crossTenantBrandId },
    });
    expectStatus(crossTenant, 403, "Cross-tenant brand denial");

    const memberIds = manifest.members.map((member) => member.id);
    const shipmentIds = manifest.members.map((member) => member.shipmentId);
    const { data: members, error: memberError } = await admin
      .from("members")
      .select("id,email,organization_id,brand_id,club_tier_id,status,deleted_at,stripe_customer_id,stripe_payment_method_id")
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .in("id", memberIds);
    if (memberError) throw memberError;
    expect(members.length === TEST_MEMBER_COUNT, "The exact ten Gate 6 members are not present.");
    const stripeCustomers = new Map();
    for (const fixture of manifest.members) {
      const member = members.find((candidate) => candidate.id === fixture.id);
      expect(
        member?.email?.toLowerCase() === fixture.email &&
          member.club_tier_id === manifest.tierId &&
          member.status === "active" &&
          member.deleted_at === null,
        "A Gate 6 member is outside the active dedicated fixture contract.",
      );
    }
    const { count: scopedCount, error: scopedError } = await admin
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .in("id", memberIds);
    if (scopedError) throw scopedError;
    expect(scopedCount === TEST_MEMBER_COUNT, "Gate 6 member scope is incomplete.");
    const { data: fixtureRelease, error: releaseError } = await admin
      .from("releases")
      .select("id,status,organization_id,brand_id,release_tiers!inner(tier_id)")
      .eq("id", manifest.releaseId)
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .single();
    if (releaseError) throw releaseError;
    expect(
      fixtureRelease.status === "processing" &&
        fixtureRelease.release_tiers?.some(
          (releaseTier) => releaseTier.tier_id === manifest.tierId,
        ),
      "Gate 6 release is not the prepared processing fixture.",
    );
    const { data: fixtureShipments, error: fixtureShipmentError } = await admin
      .from("shipments")
      .select("id,member_id,release_id,tier_id,status,organization_id,brand_id")
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .eq("release_id", manifest.releaseId);
    if (fixtureShipmentError) throw fixtureShipmentError;
    expect(
      fixtureShipments.length === TEST_MEMBER_COUNT &&
        fixtureShipments.every(
          (shipment) =>
            shipmentIds.includes(shipment.id) &&
            memberIds.includes(shipment.member_id) &&
            shipment.tier_id === manifest.tierId &&
            shipment.status === "pending",
        ),
      "Gate 6 requires exactly ten untouched pending fixture shipments.",
    );
    const [priorBilling, priorLabels, auditBaseline] = await Promise.all([
      admin
        .from("billing_attempts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", manifest.organizationId)
        .eq("brand_id", manifest.brandId)
        .in("shipment_id", shipmentIds),
      admin
        .from("shipping_label_attempts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", manifest.organizationId)
        .eq("brand_id", manifest.brandId)
        .in("shipment_id", shipmentIds),
      admin
        .from("audit_log")
        .select("entry_hash,sequence_number")
        .eq("organization_id", manifest.organizationId)
        .order("sequence_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (priorBilling.error) throw priorBilling.error;
    if (priorLabels.error) throw priorLabels.error;
    if (auditBaseline.error) throw auditBaseline.error;
    expect(
      Number(priorBilling.count) === 0 && Number(priorLabels.count) === 0,
      "Gate 6 fixtures have prior provider attempts and cannot be blindly replayed.",
    );
    checks.exactTenTenantFixtures = true;

    for (const fixture of manifest.members) {
      const customer = await stripe.customers.create(
        {
          email: fixture.email,
          metadata: {
            brand_id: manifest.brandId,
            gate: "6",
            member_id: fixture.id,
            organization_id: manifest.organizationId,
          },
          name: `Vinifera Gate 6 Member ${manifest.members.indexOf(fixture) + 1}`,
        },
        { idempotencyKey: `vinifera:g6:${source.candidateRevision}:${fixture.id}:customer` },
      );
      expect(!customer.livemode, "Gate 6 created a live-mode Stripe Customer.");
      stripeCustomers.set(fixture.id, customer.id);
      const token = fixture.declined ? "tok_chargeDeclined" : "tok_visa";
      const paymentMethod = await stripe.paymentMethods.create(
        { card: { token }, type: "card" },
        { idempotencyKey: `vinifera:g6:${source.candidateRevision}:${fixture.id}:initial-pm` },
      );
      await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });
      const { data: updated, error: updateError } = await admin
        .from("members")
        .update({
          stripe_customer_id: customer.id,
          stripe_payment_method_id: paymentMethod.id,
        })
        .eq("id", fixture.id)
        .eq("organization_id", manifest.organizationId)
        .eq("brand_id", manifest.brandId)
        .select("id");
      if (updateError) throw updateError;
      expect(updated?.length === 1, "Stripe member binding was not tenant-scoped.");
    }
    checks.stripeTestCustomersAndMethods = true;

    const startedAt = new Date().toISOString();
    const processResult = await request(`/api/releases/${manifest.releaseId}/process`, {
      body: JSON.stringify({ confirmed: true }),
      headers: { ...brandHeaders, "content-type": "application/json" },
      method: "POST",
    });
    expectStatus(processResult, 200, "Gate 6 release processing");
    expect(
      processResult.body?.data?.charged === 9 &&
        processResult.body?.data?.declined === 1 &&
        processResult.body?.data?.skipped === 0,
      "Gate 6 did not produce exactly nine charges and one decline.",
    );
    checks.nineChargesOneDecline = true;

    const declinedFixture = manifest.members.find((member) => member.declined);
    const validMethod = await stripe.paymentMethods.create(
      { card: { token: "tok_visa" }, type: "card" },
      { idempotencyKey: `vinifera:g6:${source.candidateRevision}:${declinedFixture.id}:recovery-pm` },
    );
    await stripe.paymentMethods.attach(validMethod.id, {
      customer: stripeCustomers.get(declinedFixture.id),
    });
    const { data: recoveryUpdate, error: recoveryUpdateError } = await admin
      .from("members")
      .update({ stripe_payment_method_id: validMethod.id })
      .eq("id", declinedFixture.id)
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .select("id");
    if (recoveryUpdateError) throw recoveryUpdateError;
    expect(recoveryUpdate?.length === 1, "Decline recovery binding was not tenant-scoped.");
    const retry = await request(`/api/shipments/${declinedFixture.shipmentId}/retry`, {
      headers: brandHeaders,
      method: "POST",
    });
    expectStatus(retry, 200, "Gate 6 decline recovery");
    expect(retry.body?.data?.status === "charged", "Declined shipment did not recover.");
    checks.declineRecovery = true;

    const labels = await request("/api/shipments/labels", {
      body: JSON.stringify({ shipmentIds }),
      headers: { ...brandHeaders, "content-type": "application/json" },
      method: "POST",
    });
    expectStatus(labels, 200, "Gate 6 label generation");
    expect(
      labels.body?.data?.generated === TEST_MEMBER_COUNT &&
        labels.body?.data?.failed === 0 &&
        labels.body?.data?.results?.every((result) => result.success === true),
      "Gate 6 did not produce ten real EasyPost labels.",
    );
    const [{ data: complianceRows, error: complianceError }, { data: labelRows, error: labelError }] =
      await Promise.all([
        admin
          .from("compliance_checks")
          .select("shipment_id,status,provider,provider_response_id")
          .eq("organization_id", manifest.organizationId)
          .eq("brand_id", manifest.brandId)
          .in("shipment_id", shipmentIds)
          .gte("created_at", startedAt),
        admin
          .from("shipping_label_attempts")
          .select("shipment_id,status,provider,external_label_id,tracking_number")
          .eq("organization_id", manifest.organizationId)
          .eq("brand_id", manifest.brandId)
          .in("shipment_id", shipmentIds)
          .gte("created_at", startedAt),
      ]);
    if (complianceError) throw complianceError;
    if (labelError) throw labelError;
    expect(
      complianceRows.length === TEST_MEMBER_COUNT &&
        new Set(complianceRows.map((row) => row.shipment_id)).size ===
          TEST_MEMBER_COUNT &&
        complianceRows.every(
          (row) =>
            row.status === "compliant" &&
            row.provider === "shipcompliant" &&
            typeof row.provider_response_id === "string" &&
            !row.provider_response_id.startsWith("local-"),
        ),
      "Ten real ShipCompliant decisions were not retained.",
    );
    expect(
      labelRows.length === TEST_MEMBER_COUNT &&
        new Set(labelRows.map((row) => row.shipment_id)).size ===
          TEST_MEMBER_COUNT &&
        labelRows.every(
          (row) =>
            row.status === "succeeded" &&
            row.provider === "easypost" &&
            row.external_label_id &&
            row.tracking_number,
        ),
      "Ten durable EasyPost purchases were not retained.",
    );
    checks.tenCompliantEasyPostLabels = true;

    const pickList = await request(`/api/shipments/pick-list?releaseId=${manifest.releaseId}`, {
      headers: brandHeaders,
    });
    expectStatus(pickList, 200, "Gate 6 pick list");
    expect(pickList.body?.data?.shipmentCount === TEST_MEMBER_COUNT, "Pick list omitted a shipment.");
    for (const shipment of pickList.body.data.shipments) {
      expect(shipmentIds.includes(shipment.id), "Pick list leaked an unexpected shipment.");
      for (const item of shipment.shipmentItems ?? []) {
        for (let count = Number(item.packedQuantity ?? 0); count < Number(item.quantity); count += 1) {
          const packed = await request(`/api/shipments/${shipment.id}/pack`, {
            body: JSON.stringify({ barcode: item.barcode }),
            headers: { ...brandHeaders, "content-type": "application/json" },
            method: "POST",
          });
          expectStatus(packed, 200, "Gate 6 pack scan");
        }
      }
    }
    checks.pickAndPack = true;

    for (const shipmentId of shipmentIds) {
      const shipped = await request(`/api/shipments/${shipmentId}/status`, {
        body: JSON.stringify({ status: "shipped" }),
        headers: { ...brandHeaders, "content-type": "application/json" },
        method: "PATCH",
      });
      expectStatus(shipped, 200, "Gate 6 ship transition");
      const delivered = await request(`/api/shipments/${shipmentId}/status`, {
        body: JSON.stringify({ status: "delivered" }),
        headers: { ...brandHeaders, "content-type": "application/json" },
        method: "PATCH",
      });
      expectStatus(delivered, 200, "Gate 6 delivery transition");
    }
    checks.shipAndDeliver = true;

    const refundShipmentId = manifest.members.find((member) => !member.declined).shipmentId;
    const refund = await request(`/api/shipments/${refundShipmentId}/refund`, {
      body: JSON.stringify({ reason: "Gate 6 hosted acceptance refund" }),
      headers: {
        ...brandHeaders,
        "content-type": "application/json",
        "x-command-id": deterministicCommandId(
          `gate6:${source.candidateRevision}:${refundShipmentId}:refund`,
        ),
      },
      method: "POST",
    });
    expectStatus(refund, 200, "Gate 6 test refund");
    expect(refund.body?.data?.status === "refunded", "Gate 6 refund did not complete.");
    checks.singleTestRefund = true;

    const { data: finalShipments, error: finalShipmentError } = await admin
      .from("shipments")
      .select("id,status,stripe_payment_intent_id,stripe_charge_id,stripe_refund_id,shipping_provider,external_label_id,label_url,tracking_number")
      .eq("organization_id", manifest.organizationId)
      .eq("brand_id", manifest.brandId)
      .eq("release_id", manifest.releaseId)
      .in("id", shipmentIds);
    if (finalShipmentError) throw finalShipmentError;
    expect(finalShipments.length === TEST_MEMBER_COUNT, "Final shipment evidence is incomplete.");
    expect(
      finalShipments.every(
        (shipment) =>
          /^pi_/u.test(shipment.stripe_payment_intent_id ?? "") &&
          /^ch_/u.test(shipment.stripe_charge_id ?? "") &&
          shipment.shipping_provider === "easypost" &&
          shipment.external_label_id &&
          shipment.label_url &&
          shipment.tracking_number,
      ),
      "Durable charge or label identifiers are incomplete.",
    );
    expect(
      finalShipments.filter((shipment) => /^re_/u.test(shipment.stripe_refund_id ?? "")).length === 1,
      "Gate 6 did not retain exactly one Stripe refund ID.",
    );
    checks.durableProviderIdentifiers = true;
    const [{ count: billingCount, error: billingError }, { data: auditRows, error: auditError }] =
      await Promise.all([
        admin
          .from("billing_attempts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", manifest.organizationId)
          .eq("brand_id", manifest.brandId)
          .in("shipment_id", shipmentIds)
          .gte("created_at", startedAt),
        admin
          .from("audit_log")
          .select("action,brand_id,entity_id,entity_type,entry_hash,previous_hash,sequence_number")
          .eq("organization_id", manifest.organizationId)
          .gt("sequence_number", auditBaseline.data?.sequence_number ?? 0)
          .order("sequence_number", { ascending: true })
          .limit(1_000),
      ]);
    if (billingError) throw billingError;
    if (auditError) throw auditError;
    expect(Number(billingCount) >= 12, "Gate 6 billing attempt evidence is incomplete.");
    validateGate6AuditRows(auditRows, manifest, refundShipmentId, auditBaseline.data);
    checks.tenantScopedAuditChain = true;
    completedLifecycle = true;
  } catch (error) {
    runError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (admin && manifest && completedLifecycle) {
      const retiredAt = new Date().toISOString();
      const { data: retired, error } = await admin
        .from("members")
        .update({ cancelled_at: retiredAt, deleted_at: retiredAt, status: "cancelled" })
        .eq("organization_id", manifest.organizationId)
        .eq("brand_id", manifest.brandId)
        .in("id", manifest.members.map((member) => member.id))
        .select("id,status,deleted_at");
      if (
        error ||
        retired?.length !== TEST_MEMBER_COUNT ||
        retired.some((member) => member.status !== "cancelled" || !member.deleted_at)
      ) {
        cleanup = false;
        runError ??= new Error("Gate 6 fixture retirement failed.");
      }
    } else if (runError) {
      cleanup = false;
    }
    const evidence = buildEvidence({
      checks,
      cleanup,
      gate13,
      generatedAt: new Date().toISOString(),
      source,
      targets: targets?.actual ?? null,
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  }
  if (runError) throw runError;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}
