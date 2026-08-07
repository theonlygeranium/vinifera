import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { verifyActivationTarget } from "./lib/activation-guard.mjs";

const WORKER_ORIGIN =
  "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const MAX_RESPONSE_BYTES = 64 * 1024;
const FAILURE_STAGES = new Set([
  "target_authorization",
  "client_creation",
  "fixture_provisioning",
  "staff_isolation",
  "member_isolation",
  "owner_aggregate",
  "billing_isolation",
  "integration_claim",
  "ambiguous_email",
  "cleanup",
]);

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function safeFailureStage(value) {
  return FAILURE_STAGES.has(value) ? value : "client_creation";
}

function checkedUuid(value, label) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      normalized,
    )
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function plusAddress(base, tag) {
  const match = /^([^@+]+)(?:\+[^@]*)?@([^@]+)$/u.exec(
    String(base ?? "")
      .trim()
      .toLowerCase(),
  );
  if (!match) throw new Error("Gate 15 fixture email base is invalid.");
  return `${match[1]}+${tag}@${match[2]}`;
}

async function boundedResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) {
    return new Response(null, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Hosted Gate 15 response exceeded its limit.");
    }
    chunks.push(value);
  }
  return new Response(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    },
  );
}

export function createBoundedTargetFetch({
  accessHeaders = {},
  fetchImpl = fetch,
  origins,
}) {
  const allowed = new Set(origins);
  return async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (!allowed.has(url.origin)) {
      throw new Error("Hosted Gate 15 request escaped its approved targets.");
    }
    const headers = new Headers(init.headers);
    for (const [name, value] of Object.entries(accessHeaders)) {
      headers.set(name, value);
    }
    const response = await fetchImpl(url, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    return boundedResponse(response);
  };
}

export function authorizeGate15Targets({
  allowlist,
  supabaseUrl,
  workerOrigin,
}) {
  const worker = new URL(String(workerOrigin ?? ""));
  if (
    worker.origin !== WORKER_ORIGIN ||
    worker.pathname !== "/" ||
    worker.search ||
    worker.hash ||
    worker.username ||
    worker.password ||
    worker.port
  ) {
    throw new Error("Gate 15 Worker origin is not the exact staging target.");
  }
  const supabase = new URL(String(supabaseUrl ?? ""));
  const authorization = verifyActivationTarget({
    allowlist,
    kind: "supabase-origin",
    rawValue: supabase.origin,
  });
  if (
    supabase.origin !== String(supabaseUrl).trim().replace(/\/$/u, "") ||
    supabase.pathname !== "/" ||
    supabase.search ||
    supabase.hash
  ) {
    throw new Error("Gate 15 Supabase URL must be one canonical origin.");
  }
  return {
    supabaseOrigin: supabase.origin,
    supabaseOriginSha256: authorization.targetHash,
    workerOrigin: worker.origin,
  };
}

export class CleanupLedger {
  constructor() {
    this.entries = [];
    this.sealed = false;
  }

  register(name, phase, cleanup) {
    if (this.sealed) throw new Error("Gate 15 cleanup ledger is sealed.");
    this.entries.push({ cleanup, name, phase, status: "pending" });
  }

  async settle() {
    this.sealed = true;
    const phases = [...new Set(this.entries.map((entry) => entry.phase))].sort(
      (left, right) => right - left,
    );
    for (const phase of phases) {
      const entries = this.entries.filter((entry) => entry.phase === phase);
      const results = await Promise.allSettled(
        entries.map((entry) => entry.cleanup()),
      );
      results.forEach((result, index) => {
        entries[index].status =
          result.status === "fulfilled" ? "passed" : "failed";
      });
    }
    return {
      attempted: this.entries.length,
      failed: this.entries.filter((entry) => entry.status === "failed").length,
      passed: this.entries.filter((entry) => entry.status === "passed").length,
      steps: this.entries.map(({ name, status }) => ({ name, status })),
    };
  }
}

function exactRows(result, count, label) {
  if (result.error) throw new Error(`${label} failed.`);
  expect(
    Array.isArray(result.data) && result.data.length === count,
    `${label} affected an unexpected row count.`,
  );
  return result.data;
}

function cookieValues(response) {
  const raw =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return raw
    .flatMap((value) => value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/u))
    .map((value) => value.split(";", 1)[0])
    .filter((value) => !value.endsWith("="));
}

export async function resolveGate15AuthCleanupIds({
  admin,
  fixtureEmails,
  knownIds = [],
  maxPages = 20,
}) {
  const expectedEmails = new Set(
    fixtureEmails.map((email) => email.toLowerCase()),
  );
  const cleanupIds = new Set(knownIds);
  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) throw new Error("Gate 15 Auth cleanup scan failed.");
    for (const user of data.users) {
      if (
        expectedEmails.has(user.email?.toLowerCase()) &&
        user.user_metadata?.hosted_acceptance === true
      ) {
        cleanupIds.add(user.id);
      }
    }
    if (data.users.length < 100) return [...cleanupIds];
  }
  throw new Error("Gate 15 Auth cleanup scan exceeded 2,000 users.");
}

function createProductionAdapter({
  accessHeaders,
  anonKey,
  boundedFetch,
  createClientImpl,
  emailBase,
  now,
  runId,
  serviceKey,
  supabaseOrigin,
  workerOrigin,
}) {
  const global = { fetch: boundedFetch };
  const admin = createClientImpl(supabaseOrigin, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global,
  });
  const ids = {
    independentBrand: randomUUID(),
    organization: randomUUID(),
  };
  const password = `${randomBytes(18).toString("base64url")}Aa1!`;
  const suffix = `${runId}-${randomBytes(5).toString("hex")}`.toLowerCase();
  const emails = {
    ambiguous: plusAddress(emailBase, `g15-ambiguous-${suffix}`),
    manager: plusAddress(emailBase, `g15-manager-${suffix}`),
    memberA: plusAddress(emailBase, `g15-member-a-${suffix}`),
    memberB: plusAddress(emailBase, `g15-member-b-${suffix}`),
    owner: plusAddress(emailBase, `g15-owner-${suffix}`),
  };
  const authIds = [];
  const created = {
    magicEmailHash: createHash("sha256")
      .update(emails.ambiguous)
      .digest("hex"),
  };

  async function worker(path, init = {}, cookies = []) {
    const headers = {
      ...accessHeaders,
      origin: workerOrigin,
      ...init.headers,
    };
    if (cookies.length) headers.cookie = cookies.join("; ");
    const response = await boundedFetch(new URL(path, workerOrigin), {
      ...init,
      headers,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { body, cookies: cookieValues(response), status: response.status };
  }

  async function authUser(email, surface) {
    const result = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      user_metadata: { auth_surface: surface, hosted_acceptance: true },
    });
    if (result.error || !result.data.user)
      throw new Error("Gate 15 Auth fixture creation failed.");
    authIds.push(result.data.user.id);
    return result.data.user.id;
  }

  async function login(email) {
    const result = await worker("/api/auth/staff/login", {
      body: JSON.stringify({ email, password }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(
      result.status === 200 && result.cookies.length > 0,
      "Gate 15 staff login failed.",
    );
    return result.cookies;
  }

  return {
    async cleanupAuth() {
      const cleanupIds = await resolveGate15AuthCleanupIds({
        admin,
        fixtureEmails: Object.values(emails),
        knownIds: authIds,
      });
      const results = await Promise.allSettled(
        cleanupIds.map(async (id) => {
          const result = await admin.auth.admin.deleteUser(id);
          if (
            result.error &&
            result.error.status !== 404 &&
            result.error.code !== "user_not_found"
          ) {
            throw new Error("Gate 15 Auth cleanup failed.");
          }
        }),
      );
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("Gate 15 Auth cleanup failed.");
      }
    },

    async cleanupOrganization() {
      const result = await admin
        .from("organizations")
        .delete()
        .eq("id", ids.organization)
        .eq("name", `Vinifera Gate 15 ${suffix}`)
        .select("id");
      if (result.error || (result.data?.length ?? 0) > 1) {
        throw new Error("Gate 15 organization cleanup failed.");
      }
    },

    async cleanupRunRows() {
      if (!created.sharedBrand) return;
      const operations = [
        admin
          .from("integration_sync_jobs")
          .delete()
          .eq("organization_id", ids.organization)
          .in("brand_id", [created.sharedBrand, ids.independentBrand])
          .like("idempotency_key", `gate15-${suffix}-%`)
          .select("id"),
        admin
          .from("member_magic_link_requests")
          .delete()
          .eq("email_hash", created.magicEmailHash)
          .select("id"),
      ];
      if (created.metricDate) {
        operations.push(
          admin
            .from("brand_analytics_daily_metrics")
            .delete()
            .eq("organization_id", ids.organization)
            .eq("brand_id", created.sharedBrand)
            .eq("metric_date", created.metricDate)
            .select("brand_id"),
          admin
            .from("brand_analytics_daily_metrics")
            .delete()
            .eq("organization_id", ids.organization)
            .eq("brand_id", ids.independentBrand)
            .eq("metric_date", created.metricDate)
            .select("brand_id"),
        );
      }
      const results = await Promise.allSettled(operations);
      if (
        results.some(
          (result, index) =>
            result.status === "rejected" ||
            result.value?.error ||
            (result.value?.data?.length ?? 0) > (index === 0 ? 2 : 1),
        )
      ) {
        throw new Error("Gate 15 row cleanup failed.");
      }
    },

    async provision() {
      exactRows(
        await admin
          .from("organizations")
          .insert({
            access_status: "active",
            id: ids.organization,
            name: `Vinifera Gate 15 ${suffix}`,
            plan_tier: "vine",
            subscription_status: "active",
          })
          .select("id,default_brand_id"),
        1,
        "Gate 15 organization insert",
      );
      const organization = exactRows(
        await admin
          .from("organizations")
          .select("id,default_brand_id")
          .eq("id", ids.organization),
        1,
        "Gate 15 organization lookup",
      )[0];
      created.sharedBrand = checkedUuid(
        organization.default_brand_id,
        "Gate 15 shared brand",
      );
      exactRows(
        await admin
          .from("brands")
          .insert({
            access_status: "active",
            active: true,
            billing_mode: "independent",
            id: ids.independentBrand,
            is_default: false,
            name: `Gate 15 Independent ${suffix}`,
            organization_id: ids.organization,
            slug: `gate-15-${suffix}`,
          })
          .select("id"),
        1,
        "Gate 15 independent brand insert",
      );

      const owner = await authUser(emails.owner, "staff");
      const manager = await authUser(emails.manager, "staff");
      const memberAUser = await authUser(emails.memberA, "member");
      const memberBUser = await authUser(emails.memberB, "member");
      created.owner = owner;
      created.manager = manager;
      exactRows(
        await admin
          .from("staff_users")
          .insert([
            {
              email: emails.owner,
              id: owner,
              organization_id: ids.organization,
              role: "owner",
              status: "active",
            },
            {
              email: emails.manager,
              id: manager,
              organization_id: ids.organization,
              role: "manager",
              status: "active",
            },
          ])
          .select("id"),
        2,
        "Gate 15 staff insert",
      );
      const seededAccess = exactRows(
        await admin
          .from("organization_staff_access")
          .select("staff_user_id,scope")
          .eq("organization_id", ids.organization)
          .in("staff_user_id", [owner, manager]),
        2,
        "Gate 15 seeded organization access check",
      );
      expect(
        seededAccess.some(
          (row) => row.staff_user_id === owner && row.scope === "all_brands",
        ) &&
          seededAccess.some(
            (row) =>
              row.staff_user_id === manager && row.scope === "brand_restricted",
          ),
        "Gate 15 seeded organization access is incorrect.",
      );
      exactRows(
        await admin
          .from("staff_brand_access")
          .insert({
            access_level: "admin",
            brand_id: ids.independentBrand,
            granted_by: owner,
            organization_id: ids.organization,
            staff_user_id: owner,
          })
          .select("brand_id,staff_user_id"),
        1,
        "Gate 15 owner sibling-brand access insert",
      );
      const members = exactRows(
        await admin
          .from("members")
          .insert([
            {
              auth_user_id: memberAUser,
              brand_id: created.sharedBrand,
              email: emails.memberA,
              first_name: "Gate",
              last_name: "Member A",
              organization_id: ids.organization,
            },
            {
              auth_user_id: memberBUser,
              brand_id: ids.independentBrand,
              email: emails.memberB,
              first_name: "Gate",
              last_name: "Member B",
              organization_id: ids.organization,
            },
            {
              brand_id: created.sharedBrand,
              email: emails.ambiguous,
              first_name: "Gate",
              last_name: "Ambiguous A",
              organization_id: ids.organization,
            },
            {
              brand_id: ids.independentBrand,
              email: emails.ambiguous,
              first_name: "Gate",
              last_name: "Ambiguous B",
              organization_id: ids.organization,
            },
          ])
          .select("id,brand_id,email"),
        4,
        "Gate 15 member insert",
      );
      created.memberA = members.find((row) => row.email === emails.memberA)?.id;
      created.memberB = members.find((row) => row.email === emails.memberB)?.id;
      created.ambiguousMembers = members
        .filter((row) => row.email === emails.ambiguous)
        .map((row) => row.id);
      created.memberAUser = memberAUser;
      return { organizationId: ids.organization };
    },

    async verifyStaffIsolation() {
      const cookies = await login(emails.manager);
      const brands = await worker("/api/brands", {}, cookies);
      expect(brands.status === 200, "Gate 15 restricted brand list failed.");
      const visible = (brands.body?.data?.items ?? []).map((row) => row.id);
      expect(
        visible.includes(created.sharedBrand) &&
          !visible.includes(ids.independentBrand),
        "Gate 15 restricted browser isolation failed.",
      );
      const aggregate = await worker(
        "/api/organization/overview?brandId=all",
        {},
        cookies,
      );
      expect(
        aggregate.status === 403,
        "Gate 15 restricted aggregate was not denied.",
      );
      const client = createClientImpl(supabaseOrigin, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global,
      });
      const auth = await client.auth.signInWithPassword({
        email: emails.manager,
        password,
      });
      if (auth.error) throw new Error("Gate 15 native staff login failed.");
      const rows = await client
        .from("brands")
        .select("id")
        .in("id", [created.sharedBrand, ids.independentBrand]);
      if (rows.error) throw new Error("Gate 15 native staff query failed.");
      expect(
        rows.data.some((row) => row.id === created.sharedBrand) &&
          !rows.data.some((row) => row.id === ids.independentBrand),
        "Gate 15 native staff isolation failed.",
      );
    },

    async verifyMemberIsolation() {
      const client = createClientImpl(supabaseOrigin, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global,
      });
      const auth = await client.auth.signInWithPassword({
        email: emails.memberA,
        password,
      });
      if (auth.error) throw new Error("Gate 15 native member login failed.");
      const members = await client
        .from("members")
        .select("id,brand_id")
        .in("brand_id", [created.sharedBrand, ids.independentBrand]);
      if (members.error) throw new Error("Gate 15 native member query failed.");
      expect(
        members.data.some((row) => row.id === created.memberA) &&
          !members.data.some((row) => row.id === created.memberB),
        "Gate 15 member row isolation failed.",
      );
      const brands = await client
        .from("brands")
        .select("id")
        .in("id", [created.sharedBrand, ids.independentBrand]);
      if (brands.error)
        throw new Error("Gate 15 native member brand query failed.");
      expect(
        brands.data.some((row) => row.id === created.sharedBrand) &&
          !brands.data.some((row) => row.id === ids.independentBrand),
        "Gate 15 member brand isolation failed.",
      );
    },

    async verifyOwnerAggregate() {
      created.metricDate = new Date().toISOString().slice(0, 10);
      exactRows(
        await admin
          .from("brand_analytics_daily_metrics")
          .insert([
            {
              active_members: 2,
              brand_id: created.sharedBrand,
              metric_date: created.metricDate,
              organization_id: ids.organization,
              revenue_cents: 1200,
              shipment_count: 3,
            },
            {
              active_members: 5,
              brand_id: ids.independentBrand,
              metric_date: created.metricDate,
              organization_id: ids.organization,
              revenue_cents: 3400,
              shipment_count: 7,
            },
          ])
          .select("brand_id,metric_date"),
        2,
        "Gate 15 analytics insert",
      );
      const aggregate = await worker(
        "/api/organization/overview?brandId=all",
        {},
        await login(emails.owner),
      );
      expect(
        aggregate.status === 200 &&
          aggregate.body?.data?.brandCount === 2 &&
          aggregate.body?.data?.activeMembers === 7 &&
          aggregate.body?.data?.monthlyRecurringRevenueCents === 4600 &&
          aggregate.body?.data?.shipmentsThisPeriod === 10,
        "Gate 15 owner aggregate was not exact.",
      );
    },

    async verifyBillingIsolation() {
      exactRows(
        await admin
          .from("brands")
          .update({ access_status: "suspended" })
          .eq("organization_id", ids.organization)
          .eq("id", ids.independentBrand)
          .select("id"),
        1,
        "Gate 15 independent suspension",
      );
      const cookies = await login(emails.owner);
      const shared = await worker(
        "/api/members?limit=1",
        { headers: { "x-vinifera-brand-id": created.sharedBrand } },
        cookies,
      );
      const independent = await worker(
        "/api/members?limit=1",
        { headers: { "x-vinifera-brand-id": ids.independentBrand } },
        cookies,
      );
      expect(
        shared.status === 200 && independent.status === 403,
        "Gate 15 billing sibling isolation failed.",
      );
    },

    async verifyIntegrationClaim() {
      const connections = exactRows(
        await admin
          .from("integration_connections")
          .insert([
            {
              brand_id: created.sharedBrand,
              consented_at: new Date().toISOString(),
              integration_type: "meta",
              opted_in: true,
              organization_id: ids.organization,
              status: "configured",
            },
            {
              brand_id: ids.independentBrand,
              consented_at: new Date().toISOString(),
              integration_type: "klaviyo",
              opted_in: true,
              organization_id: ids.organization,
              status: "configured",
            },
          ])
          .select("id,brand_id"),
        2,
        "Gate 15 connection insert",
      );
      const activeConnection = connections.find(
        (row) => row.brand_id === created.sharedBrand,
      ).id;
      const suspendedConnection = connections.find(
        (row) => row.brand_id === ids.independentBrand,
      ).id;
      const jobs = exactRows(
        await admin
          .from("integration_sync_jobs")
          .insert([
            {
              brand_id: created.sharedBrand,
              connection_id: activeConnection,
              direction: "outbound",
              entity_type: "brand",
              idempotency_key: `gate15-${suffix}-active`,
              integration_type: "meta",
              next_attempt_at: "9999-12-31T23:59:59.000Z",
              organization_id: ids.organization,
              payload: { hosted_acceptance: "gate15", run_id: runId },
              sync_type: "connection.validate",
            },
            {
              brand_id: ids.independentBrand,
              connection_id: suspendedConnection,
              direction: "outbound",
              entity_type: "brand",
              idempotency_key: `gate15-${suffix}-suspended`,
              integration_type: "klaviyo",
              next_attempt_at: "9999-12-31T23:59:59.000Z",
              organization_id: ids.organization,
              payload: { hosted_acceptance: "gate15", run_id: runId },
              sync_type: "connection.validate",
            },
          ])
          .select("id,brand_id"),
        2,
        "Gate 15 integration job insert",
      );
      const activeJob = jobs.find(
        (row) => row.brand_id === created.sharedBrand,
      ).id;
      const suspendedJob = jobs.find(
        (row) => row.brand_id === ids.independentBrand,
      ).id;
      const claimAsOf = now().toISOString();
      const preflight = await admin
        .from("integration_sync_jobs")
        .select("id")
        .eq("organization_id", ids.organization)
        .in("brand_id", [created.sharedBrand, ids.independentBrand])
        .in("status", ["queued", "retry"])
        .gt("next_attempt_at", claimAsOf);
      if (preflight.error) throw new Error("Gate 15 claim preflight failed.");
      expect(
        preflight.data.length === 2 &&
          preflight.data.every((row) =>
            [activeJob, suspendedJob].includes(row.id),
          ),
        "Gate 15 claim window contains another job.",
      );
      const claim = await admin.rpc(
        "claim_gate15_integration_sync_jobs_for_scope",
        {
          p_as_of: claimAsOf,
          p_brand_ids: [created.sharedBrand, ids.independentBrand],
          p_job_ids: [activeJob, suspendedJob],
          p_lease_seconds: 60,
          p_limit: 1,
          p_organization_id: ids.organization,
          p_worker: `gate15-${suffix}`,
        },
      );
      if (claim.error) throw new Error("Gate 15 service claim failed.");
      expect(
        claim.data?.length === 1 &&
          claim.data[0].job_id === activeJob &&
          claim.data[0].organization_id === ids.organization &&
          claim.data[0].brand_id === created.sharedBrand,
        "Gate 15 service claim crossed brand scope.",
      );
      const suspended = exactRows(
        await admin
          .from("integration_sync_jobs")
          .select("id,status")
          .eq("organization_id", ids.organization)
          .eq("brand_id", ids.independentBrand)
          .eq("id", suspendedJob),
        1,
        "Gate 15 suspended claim check",
      )[0];
      expect(
        suspended.status === "queued",
        "Gate 15 suspended sibling job was claimed.",
      );
    },

    async verifyAmbiguousEmail() {
      const before = await admin
        .from("member_auth_link_contexts")
        .select("token_hash", { count: "exact", head: true })
        .eq("organization_id", ids.organization)
        .in("brand_id", [created.sharedBrand, ids.independentBrand])
        .in("member_id", created.ambiguousMembers);
      if (before.error)
        throw new Error("Gate 15 ambiguous context preflight failed.");
      const result = await worker("/api/auth/member/magic-link", {
        body: JSON.stringify({ email: emails.ambiguous }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(
        result.status === 200,
        "Gate 15 ambiguous email response was not generic.",
      );
      const after = await admin
        .from("member_auth_link_contexts")
        .select("token_hash", { count: "exact", head: true })
        .eq("organization_id", ids.organization)
        .in("brand_id", [created.sharedBrand, ids.independentBrand])
        .in("member_id", created.ambiguousMembers);
      if (after.error)
        throw new Error("Gate 15 ambiguous context verification failed.");
      expect(
        after.count === before.count,
        "Gate 15 ambiguous email selected a brand context.",
      );
    },
  };
}

export async function collectGate15CoreEvidence({
  accessClientId,
  accessClientSecret,
  adapterFactory = createProductionAdapter,
  allowlist,
  anonKey,
  createClientImpl = createClient,
  emailBase,
  expectedRevision,
  failAfterStage,
  fetchImpl = fetch,
  now = () => new Date(),
  runId = "local",
  serviceKey,
  supabaseUrl,
  workerOrigin,
}) {
  const checks = {};
  const mutations = [];
  const ledger = new CleanupLedger();
  let adapter;
  let failureStage = "target_authorization";
  let targetEvidence = null;
  let cleanup = { attempted: 0, failed: 0, passed: 0, steps: [] };
  let blocked = false;

  try {
    targetEvidence = authorizeGate15Targets({
      allowlist,
      supabaseUrl,
      workerOrigin,
    });
    failureStage = "client_creation";
    for (const [label, value] of [
      ["Access client ID", accessClientId],
      ["Access client secret", accessClientSecret],
      ["Supabase anon key", anonKey],
      ["Supabase service key", serviceKey],
      ["fixture email base", emailBase],
    ]) {
      expect(
        typeof value === "string" && value.trim().length > 0,
        `Gate 15 ${label} is missing.`,
      );
    }
    const accessHeaders = {
      "CF-Access-Client-Id": String(accessClientId),
      "CF-Access-Client-Secret": String(accessClientSecret),
    };
    const boundedFetch = createBoundedTargetFetch({
      accessHeaders,
      fetchImpl,
      origins: [targetEvidence.workerOrigin, targetEvidence.supabaseOrigin],
    });
    adapter = adapterFactory({
      accessHeaders,
      anonKey,
      boundedFetch,
      createClientImpl,
      emailBase,
      now,
      runId,
      serviceKey,
      supabaseOrigin: targetEvidence.supabaseOrigin,
      workerOrigin: targetEvidence.workerOrigin,
    });
    ledger.register("run-scoped-rows", 30, () => adapter.cleanupRunRows());
    ledger.register("run-scoped-organization", 20, () =>
      adapter.cleanupOrganization(),
    );
    ledger.register("run-scoped-auth-users", 10, () => adapter.cleanupAuth());

    const stages = [
      ["fixture_provisioning", "fixtureProvisioned", () => adapter.provision()],
      [
        "staff_isolation",
        "restrictedStaffIsolation",
        () => adapter.verifyStaffIsolation(),
      ],
      [
        "member_isolation",
        "memberRlsIsolation",
        () => adapter.verifyMemberIsolation(),
      ],
      [
        "owner_aggregate",
        "ownerAggregate",
        () => adapter.verifyOwnerAggregate(),
      ],
      [
        "billing_isolation",
        "billingSiblingIsolation",
        () => adapter.verifyBillingIsolation(),
      ],
      [
        "integration_claim",
        "integrationClaimBrandScope",
        () => adapter.verifyIntegrationClaim(),
      ],
      [
        "ambiguous_email",
        "ambiguousSameEmail",
        () => adapter.verifyAmbiguousEmail(),
      ],
    ];
    for (const [stage, check, operation] of stages) {
      failureStage = stage;
      await operation();
      checks[check] = true;
      mutations.push(stage);
      if (failAfterStage === stage)
        throw new Error("Injected Gate 15 stage failure.");
    }
  } catch {
    blocked = true;
  } finally {
    failureStage = blocked ? safeFailureStage(failureStage) : "cleanup";
    try {
      cleanup = await ledger.settle();
    } catch {
      cleanup = {
        attempted: ledger.entries.length,
        failed: ledger.entries.length,
        passed: 0,
        steps: [],
      };
    }
  }

  const cleanupPassed = cleanup.failed === 0 && cleanup.attempted >= 3;
  const corePassed =
    !blocked && cleanupPassed && Object.keys(checks).length === 7;
  return {
    schemaVersion: 1,
    gate: 15,
    evidenceLevel: "hosted-core-partial",
    candidateRevision: expectedRevision,
    capturedAt: now().toISOString(),
    result: corePassed ? "core-ready" : "blocked",
    completionClaimed: false,
    checks,
    cleanup,
    failureStage: corePassed ? null : failureStage,
    mutationStagesCompleted: mutations,
    targets: targetEvidence
      ? {
          supabaseOriginSha256: targetEvidence.supabaseOriginSha256,
          workerOriginHost: new URL(targetEvidence.workerOrigin).hostname,
        }
      : null,
    externalEvidenceRemaining: ["hostname-context-after-gate-16"],
  };
}
