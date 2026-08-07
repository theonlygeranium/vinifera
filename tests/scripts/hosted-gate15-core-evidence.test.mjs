import { describe, expect, it, vi } from "vitest";
import {
  authorizeGate15Targets,
  collectGate15CoreEvidence,
  createBoundedTargetFetch,
  resolveGate15AuthCleanupIds,
} from "../../scripts/hosted-gate15-core-evidence.mjs";
import { hashActivationTarget } from "../../scripts/lib/activation-guard.mjs";

const candidate = "a".repeat(40);
const workerOrigin =
  "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const supabaseUrl = "https://supabase.staging.example.test";

function allowlist() {
  return {
    version: 1,
    staging: {
      supabaseOriginSha256: [
        hashActivationTarget("supabase-origin", supabaseUrl),
      ],
    },
    deniedProduction: { supabaseOriginSha256: [] },
  };
}

function fakeAdapter({ calls, cleanupFailure = false } = {}) {
  const record = (name) => async () => calls?.push(name);
  return {
    cleanupAuth: record("cleanupAuth"),
    cleanupOrganization: record("cleanupOrganization"),
    cleanupRunRows: async () => {
      calls?.push("cleanupRunRows");
      if (cleanupFailure) throw new Error("synthetic cleanup failure");
    },
    provision: record("fixture_provisioning"),
    verifyStaffIsolation: record("staff_isolation"),
    verifyMemberIsolation: record("member_isolation"),
    verifyOwnerAggregate: record("owner_aggregate"),
    verifyBillingIsolation: record("billing_isolation"),
    verifyIntegrationClaim: record("integration_claim"),
    verifyAmbiguousEmail: record("ambiguous_email"),
  };
}

function options(overrides = {}) {
  return {
    accessClientId: "client-id",
    accessClientSecret: "client-secret",
    adapterFactory: () => fakeAdapter(),
    allowlist: allowlist(),
    anonKey: "anon-key",
    emailBase: "acceptance@example.test",
    expectedRevision: candidate,
    serviceKey: "service-key",
    supabaseUrl,
    workerOrigin,
    ...overrides,
  };
}

describe("hosted Gate 15 core evidence", () => {
  it("reconciles lost create responses by exact hosted fixture email", async () => {
    const listUsers = vi.fn(async () => ({
      data: {
        users: [
          {
            email: "G15-OWNER@example.test",
            id: "recovered-id",
            user_metadata: { hosted_acceptance: true },
          },
          {
            email: "g15-manager@example.test",
            id: "non-fixture-metadata",
            user_metadata: {},
          },
          {
            email: "unrelated@example.test",
            id: "unrelated-id",
            user_metadata: { hosted_acceptance: true },
          },
        ],
      },
      error: null,
    }));
    await expect(
      resolveGate15AuthCleanupIds({
        admin: { auth: { admin: { listUsers } } },
        fixtureEmails: [
          "g15-owner@example.test",
          "g15-manager@example.test",
        ],
        knownIds: ["known-id"],
      }),
    ).resolves.toEqual(["known-id", "recovered-id"]);
    expect(listUsers).toHaveBeenCalledWith({ page: 1, perPage: 100 });
  });

  it("fails closed when the Auth cleanup scan cannot prove completion", async () => {
    const listUsers = vi.fn(async () => ({
      data: {
        users: Array.from({ length: 100 }, (_, index) => ({ id: index })),
      },
      error: null,
    }));
    await expect(
      resolveGate15AuthCleanupIds({
        admin: { auth: { admin: { listUsers } } },
        fixtureEmails: ["g15-owner@example.test"],
        maxPages: 1,
      }),
    ).rejects.toThrow(/exceeded 2,000 users/);
  });

  it("uses the service-role scoped claim and cleans run-specific rate-limit rows", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("../../scripts/hosted-gate15-core-evidence.mjs", import.meta.url),
        "utf8",
      ),
    );
    expect(source).toContain(
      '"claim_gate15_integration_sync_jobs_for_scope"',
    );
    expect(source).toContain("p_organization_id: ids.organization");
    expect(source).toContain(
      "p_brand_ids: [created.sharedBrand, ids.independentBrand]",
    );
    expect(source).toContain("p_job_ids: [activeJob, suspendedJob]");
    expect(source).toContain('.gt("next_attempt_at", claimAsOf)');
    expect(source).toContain('hosted_acceptance: "gate15"');
    expect(source).toContain("accessHeaders,");
    expect(source).toContain("headers.set(name, value)");
    expect(source).toContain("const claimAsOf = now().toISOString()");
    expect(source).toContain("p_as_of: claimAsOf");
    expect(source).not.toContain(
      'p_as_of: "1971-01-01T00:00:00.000Z"',
    );
    expect(source).toContain('.from("member_magic_link_requests")');
    expect(source).toContain('.eq("email_hash", created.magicEmailHash)');
    expect(source).toContain("resolveGate15AuthCleanupIds");
  });

  it("hardens every nullable scoped-claim parameter in a forward migration", async () => {
    const migration = await import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL(
          "../../supabase/migrations/202608060034_harden_scoped_integration_job_claim.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const requiredCheck of [
      "p_organization_id is null",
      "p_brand_ids is null",
      "p_job_ids is null",
      "p_worker is null",
      "p_limit is null",
      "p_lease_seconds is null",
      "p_as_of is null",
    ]) {
      expect(migration).toContain(requiredCheck);
    }
    expect(migration).toContain("job.id = any(p_job_ids)");
    expect(migration).toContain("job.next_attempt_at > p_as_of");
    expect(migration).toContain(
      "create function public.claim_gate15_integration_sync_jobs_for_scope",
    );
  });

  it("authorizes the exact Worker and reviewed Supabase origin before clients", () => {
    expect(
      authorizeGate15Targets({
        allowlist: allowlist(),
        supabaseUrl,
        workerOrigin,
      }),
    ).toMatchObject({
      supabaseOrigin: supabaseUrl,
      workerOrigin,
    });
    expect(() =>
      authorizeGate15Targets({
        allowlist: allowlist(),
        supabaseUrl: "https://production.example.test",
        workerOrigin,
      }),
    ).toThrow(/not an allowlisted staging target/);
    expect(() =>
      authorizeGate15Targets({
        allowlist: allowlist(),
        supabaseUrl,
        workerOrigin: "https://attacker.example.test",
      }),
    ).toThrow(/exact staging target/);
  });

  it("blocks before client creation when target authorization fails", async () => {
    const adapterFactory = vi.fn();
    const report = await collectGate15CoreEvidence(
      options({
        adapterFactory,
        supabaseUrl: "https://production.example.test",
      }),
    );
    expect(adapterFactory).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      completionClaimed: false,
      failureStage: "target_authorization",
      result: "blocked",
      targets: null,
    });
    expect(JSON.stringify(report)).not.toContain("production.example.test");
  });

  it("retains a sanitized client-creation failure and performs no mutation", async () => {
    const report = await collectGate15CoreEvidence(
      options({
        adapterFactory: () => {
          throw new Error("secret-bearing provider diagnostic");
        },
      }),
    );
    expect(report.failureStage).toBe("client_creation");
    expect(report.mutationStagesCompleted).toEqual([]);
    expect(report.cleanup.attempted).toBe(0);
    expect(JSON.stringify(report)).not.toContain("secret-bearing");
  });

  it("executes every behavioral stage and binds partial evidence to Gate 16", async () => {
    const calls = [];
    const report = await collectGate15CoreEvidence(
      options({ adapterFactory: () => fakeAdapter({ calls }) }),
    );
    expect(report.result).toBe("core-ready");
    expect(report.completionClaimed).toBe(false);
    expect(report.externalEvidenceRemaining).toEqual([
      "hostname-context-after-gate-16",
    ]);
    expect(report.mutationStagesCompleted).toEqual([
      "fixture_provisioning",
      "staff_isolation",
      "member_isolation",
      "owner_aggregate",
      "billing_isolation",
      "integration_claim",
      "ambiguous_email",
    ]);
    expect(calls.slice(-3)).toEqual([
      "cleanupRunRows",
      "cleanupOrganization",
      "cleanupAuth",
    ]);
    expect(report.cleanup).toMatchObject({
      attempted: 3,
      failed: 0,
      passed: 3,
    });
  });

  it("records the exact failed stage and still settles every cleanup phase", async () => {
    const calls = [];
    const report = await collectGate15CoreEvidence(
      options({
        adapterFactory: () => fakeAdapter({ calls }),
        failAfterStage: "owner_aggregate",
      }),
    );
    expect(report.result).toBe("blocked");
    expect(report.failureStage).toBe("owner_aggregate");
    expect(report.mutationStagesCompleted).toEqual([
      "fixture_provisioning",
      "staff_isolation",
      "member_isolation",
      "owner_aggregate",
    ]);
    expect(calls).toContain("cleanupRunRows");
    expect(calls).toContain("cleanupOrganization");
    expect(calls).toContain("cleanupAuth");
    expect(calls).not.toContain("billing_isolation");
  });

  it("fails core evidence when one cleanup fails without skipping later cleanup", async () => {
    const calls = [];
    const report = await collectGate15CoreEvidence(
      options({
        adapterFactory: () => fakeAdapter({ calls, cleanupFailure: true }),
      }),
    );
    expect(report).toMatchObject({
      failureStage: "cleanup",
      result: "blocked",
      cleanup: { attempted: 3, failed: 1, passed: 2 },
    });
    expect(calls.slice(-3)).toEqual([
      "cleanupRunRows",
      "cleanupOrganization",
      "cleanupAuth",
    ]);
  });

  it("uses redirect-error bounded fetches and rejects off-target requests", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("error");
      return new Response(JSON.stringify({ ok: true }));
    });
    const targetFetch = createBoundedTargetFetch({
      accessHeaders: {
        "CF-Access-Client-Id": "client-id",
        "CF-Access-Client-Secret": "client-secret",
      },
      fetchImpl,
      origins: [workerOrigin, supabaseUrl],
    });
    await expect(
      targetFetch(`${workerOrigin}/api/health`),
    ).resolves.toBeInstanceOf(Response);
    await expect(targetFetch("https://attacker.example.test/")).rejects.toThrow(
      /escaped its approved targets/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const sentHeaders = fetchImpl.mock.calls[0][1].headers;
    expect(sentHeaders.get("CF-Access-Client-Id")).toBe("client-id");
    expect(sentHeaders.get("CF-Access-Client-Secret")).toBe("client-secret");

    const empty = createBoundedTargetFetch({
      fetchImpl: async () => new Response(null, { status: 204 }),
      origins: [supabaseUrl],
    });
    await expect(
      empty(`${supabaseUrl}/rest/v1/example`),
    ).resolves.toMatchObject({ status: 204 });

    const oversized = createBoundedTargetFetch({
      fetchImpl: async () => new Response("x".repeat(65 * 1024)),
      origins: [workerOrigin],
    });
    await expect(oversized(`${workerOrigin}/api/health`)).rejects.toThrow(
      /exceeded its limit/,
    );
  });
});
