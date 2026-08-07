import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  analyticsEventIdempotencyKey,
  authorizeTargets,
  buildEvidence,
  createBoundedAccessFetch,
  fingerprintCleanupPatch,
  sha256,
  validateEvidenceBinding,
  validateFixtureManifest,
  validatePolicy,
  validateScenarioResult,
} from "../../scripts/hosted-gate13-shipcompliant-acceptance.mjs";

const workerOrigin =
  "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const values = {
  account: "sandbox-account",
  checkPath: "/shipments/check",
  contract: "vendor-contract-v1",
  license: "sandbox-license",
  manifest: "fixture-manifest",
  sandboxOrigin: "https://sandbox.shipcompliant.test",
  supabaseUrl: "https://staging-supabase.example.test",
  tokenPath: "/oauth/token",
};

function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    accountIdSha256: [sha256(values.account)],
    checkPathSha256: [sha256(values.checkPath)],
    contractVersionSha256: [sha256(values.contract)],
    licenseIdSha256: [sha256(values.license)],
    sandboxOriginSha256: [sha256(values.sandboxOrigin)],
    stagingSupabaseUrlSha256: [sha256(values.supabaseUrl)],
    stagingWorkerOriginSha256: [sha256(workerOrigin)],
    tokenPathSha256: [sha256(values.tokenPath)],
    ...overrides,
  };
}

function environment(overrides = {}) {
  return {
    COMPLIANCE_PROVIDER: "shipcompliant",
    COMPLIANCE_SIMULATOR_ENABLED: "false",
    GATE13_CANDIDATE_REVISION: "b".repeat(40),
    GATE13_ACCEPTANCE_CONFIRMATION:
      "RUN VINIFERA GATE 13 SHIPCOMPLIANT ACCEPTANCE",
    SHIPCOMPLIANT_ACCOUNT_ID: values.account,
    SHIPCOMPLIANT_BASE_URL: values.sandboxOrigin,
    SHIPCOMPLIANT_CHECK_PATH: values.checkPath,
    SHIPCOMPLIANT_CONTRACT_VERSION: values.contract,
    SHIPCOMPLIANT_ENDPOINT_MODE: "sandbox",
    SHIPCOMPLIANT_LICENSE_ID: values.license,
    SHIPCOMPLIANT_TOKEN_PATH: values.tokenPath,
    STAGING_GATE13_ACCEPTANCE_ENABLED: "true",
    STAGING_GATE13_ACCEPTANCE_MANIFEST_SHA256: sha256(values.manifest),
    STAGING_WORKER_ORIGIN: workerOrigin,
    SUPABASE_URL: values.supabaseUrl,
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateRevision: "b".repeat(40),
    organizationId: "00000000-0000-4000-8000-000000000001",
    brandId: "00000000-0000-4000-8000-000000000002",
    crossTenantBrandId: "00000000-0000-4000-8000-000000000008",
    crossTenantShipmentId: "00000000-0000-4000-8000-000000000009",
    staffEmail: "owner+vinifera-g13-fixture@example.test",
    staffPassword: "fixture-password-strong",
    fingerprintMutationAddress: {
      city: "Napa",
      country: "US",
      line1: "13 Acceptance Way",
      name: "Gate Thirteen",
      phone: "+17075550113",
      postalCode: "94558",
      state: "CA",
    },
    scenarios: Object.fromEntries(
      [
        "compliant",
        "nonCompliant",
        "unknown",
        "timeout",
        "fingerprint",
        "recovery",
      ].map((name, index) => [
        name,
        {
          shipmentId: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
        },
      ]),
    ),
    ...overrides,
  };
}

describe("Gate 13 exact policy and fixture contract", () => {
  it("accepts a valid disabled baseline or reviewed enabled policy", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL(
          "../../config/shipcompliant-staging-acceptance-policy.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const normalized = validatePolicy(raw);
    expect(raw).not.toHaveProperty("fixtureManifestSha256");
    for (const [name, value] of Object.entries(normalized)) {
      if (!name.endsWith("Sha256")) continue;
      expect(value).toHaveLength(normalized.enabled ? 1 : 0);
    }
  });

  it("requires one exact hash per binding before policy activation", () => {
    expect(validatePolicy(policy()).enabled).toBe(true);
    expect(() =>
      validatePolicy(policy({ accountIdSha256: [] })),
    ).toThrow(/exactly one accountIdSha256/);
    expect(() =>
      validatePolicy(policy({ tokenPathSha256: ["A".repeat(64)] })),
    ).toThrow(/lowercase SHA-256/);
    expect(() =>
      validatePolicy({
        ...policy(),
        fixtureManifestSha256: [sha256(values.manifest)],
      }),
    ).toThrow(/protected per-run state/);
  });

  it("requires unique, dedicated tenant fixtures and a reversible address", () => {
    expect(validateFixtureManifest(manifest())).toMatchObject({
      brandId: "00000000-0000-4000-8000-000000000002",
      staffEmail: "owner+vinifera-g13-fixture@example.test",
    });
    expect(() =>
      validateFixtureManifest(
        manifest({ staffEmail: "ordinary-owner@example.test" }),
      ),
    ).toThrow(/dedicated plus-address/);
    const duplicate = manifest();
    duplicate.scenarios.timeout.shipmentId =
      duplicate.scenarios.unknown.shipmentId;
    expect(() => validateFixtureManifest(duplicate)).toThrow(/must be unique/);
    expect(() =>
      validateFixtureManifest(
        manifest({ crossTenantBrandId: manifest().brandId }),
      ),
    ).toThrow(/must differ/);
    expect(() =>
      validateFixtureManifest(manifest({ candidateRevision: "not-a-sha" })),
    ).toThrow(/40-character Git SHA/);
  });
});

describe("Gate 13 fail-closed authorization and evidence", () => {
  it("builds an explicit invalidated fingerprint cleanup patch", () => {
    const shippingAddress = { city: "Napa", line1: "13 Gate Street" };

    expect(fingerprintCleanupPatch(shippingAddress)).toEqual({
      compliance_checked_at: null,
      compliance_reason: null,
      compliance_status: null,
      compliance_tax_estimate_cents: null,
      latest_compliance_check_id: null,
      latest_compliance_request_fingerprint: null,
      latest_compliance_state_fingerprint: null,
      shipping_address: shippingAddress,
    });
  });

  it("bounds Access headers to the reviewed Supabase origin and rejects redirects", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      expect(init.redirect).toBe("error");
      expect(init.headers.get("CF-Access-Client-Id")).toBe("client-id");
      return new Response(null, { status: 204 });
    });
    const boundedFetch = createBoundedAccessFetch({
      accessHeaders: {
        "CF-Access-Client-Id": "client-id",
        "CF-Access-Client-Secret": "client-secret",
      },
      fetchImpl,
      origin: values.supabaseUrl,
    });
    await expect(
      boundedFetch(`${values.supabaseUrl}/rest/v1/shipments`),
    ).resolves.toMatchObject({ status: 204 });
    await expect(
      boundedFetch("https://redirect-target.example.test/rest/v1/shipments"),
    ).rejects.toThrow(/escaped its reviewed origin/u);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("derives the same analytics idempotency hash as the Worker", () => {
    const input = {
      actorUserId: "00000000-0000-4000-8000-000000000003",
      eventType: "shipment.compliance_checked",
      organizationId: "00000000-0000-4000-8000-000000000001",
      requestKey: "compliance:shipment:provider-response",
    };
    expect(analyticsEventIdempotencyKey(input)).toBe(
      sha256(JSON.stringify({ ...input, version: "vinifera-analytics-event-v1" })),
    );
    expect(
      analyticsEventIdempotencyKey({ ...input, requestKey: `${input.requestKey}-other` }),
    ).not.toBe(analyticsEventIdempotencyKey(input));
  });

  it("binds evidence to canonical main control and an exact deployed candidate", () => {
    const controlSha = "a".repeat(40);
    const binding = validateEvidenceBinding(
      {
        GATE13_CANDIDATE_REVISION: "b".repeat(40),
        GATE13_CONTROL_SHA: controlSha,
        GITHUB_REPOSITORY: "theonlygeranium/vinifera",
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_RUN_ID: "123456",
        GITHUB_SHA: controlSha,
      },
      "policy-text",
    );
    expect(binding).toMatchObject({
      candidateRevision: "b".repeat(40),
      controlSha,
      policySha256: sha256("policy-text"),
    });
    expect(() =>
      validateEvidenceBinding(
        {
          GATE13_CANDIDATE_REVISION: "b".repeat(40),
          GATE13_CONTROL_SHA: controlSha,
          GITHUB_REPOSITORY: "fork/vinifera",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_RUN_ID: "1",
          GITHUB_SHA: controlSha,
        },
        "policy-text",
      ),
    ).toThrow(/canonical/);
  });

  it("authorizes only the exact sandbox, account, contract, tenant target, and manifest", () => {
    expect(
      authorizeTargets({
        env: environment(),
        manifest: validateFixtureManifest(manifest()),
        manifestText: values.manifest,
        policy: validatePolicy(policy()),
      }),
    ).toMatchObject({
      sandboxOrigin: values.sandboxOrigin,
      supabaseUrl: values.supabaseUrl,
      workerOrigin,
    });
    for (const drift of [
      { COMPLIANCE_SIMULATOR_ENABLED: "true" },
      { SHIPCOMPLIANT_ACCOUNT_ID: "another-account" },
      { SHIPCOMPLIANT_ENDPOINT_MODE: "production" },
      { STAGING_GATE13_ACCEPTANCE_ENABLED: "false" },
      { STAGING_GATE13_ACCEPTANCE_MANIFEST_SHA256: "f".repeat(64) },
      { GATE13_CANDIDATE_REVISION: "c".repeat(40) },
      { STAGING_WORKER_ORIGIN: "https://attacker.example" },
    ]) {
      expect(() =>
        authorizeTargets({
          env: environment(drift),
          manifest: validateFixtureManifest(manifest()),
          manifestText: values.manifest,
          policy: validatePolicy(policy()),
        }),
      ).toThrow();
    }
  });

  it("accepts vendor decisions and only a deterministic local timeout ID", () => {
    expect(
      validateScenarioResult(
        {
          provider: "shipcompliant",
          providerResponseId: "vendor-compliant-1",
          status: "compliant",
          taxEstimateCents: 875,
        },
        "compliant",
      ),
    ).toHaveProperty("taxEstimateCents", 875);
    expect(
      validateScenarioResult(
        {
          provider: "shipcompliant",
          providerResponseId: "local-timeout-1",
          reason: "Provider deadline exceeded.",
          status: "unknown",
        },
        "unknown",
        { timeout: true },
      ),
    ).toHaveProperty("status", "unknown");
    expect(() =>
      validateScenarioResult(
        {
          provider: "shipcompliant",
          providerResponseId: "local-fabricated",
          reason: "No",
          status: "non_compliant",
        },
        "non_compliant",
      ),
    ).toThrow(/real provider response ID/);
    expect(() =>
      validateScenarioResult(
        {
          provider: "shipcompliant",
          providerResponseId: "local-provider-error-1",
          reason: "Generic provider failure.",
          status: "unknown",
        },
        "unknown",
        { timeout: true },
      ),
    ).toThrow(/timeout-specific/);
  });

  it("never claims completion and passes only with all checks plus cleanup", () => {
    const checks = Object.fromEntries(
      [
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
      ].map((name) => [name, true]),
    );
    const passed = buildEvidence({
      checks,
      cleanup: true,
      generatedAt: "2026-08-06T12:00:00.000Z",
      source: {},
      targets: {},
    });
    expect(passed).toMatchObject({ passed: true, completionClaimed: false });
    expect(buildEvidence({
      checks,
      cleanup: false,
      generatedAt: "2026-08-06T12:00:00.000Z",
      source: {},
      targets: {},
    }).passed).toBe(false);
  });

  it("wires a protected main-only one-shot workflow and tenant-scoped audit reads", async () => {
    const [
      workflow,
      controller,
      service,
      brandScopeMigration,
      phase4PgTap,
    ] = await Promise.all([
      readFile(
        new URL(
          "../../.github/workflows/shipcompliant-staging-acceptance.yml",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../../scripts/hosted-gate13-shipcompliant-acceptance.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../../server/services/orders.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../../supabase/migrations/202608060032_shipping_label_attempt_brand_scope.sql",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../../supabase/tests/012_phase_4_analytics_ml_compliance.test.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain(
      '[[ "$(git rev-parse origin/staging)" == "$CANDIDATE_REVISION" ]]',
    );
    expect(workflow).toContain("name: staging-acceptance-control");
    expect(workflow).toContain("STAGING_GATE13_ACCEPTANCE_ENABLED");
    expect(workflow).toContain("STAGING_GATE13_ACCEPTANCE_MANIFEST");
    expect(workflow).toContain("STAGING_GATE13_ACCEPTANCE_MANIFEST_SHA256");
    expect(workflow).toContain("retention-days: 90");
    expect(workflow).toContain("Revalidate canonical refs before evidence upload");
    expect(workflow.match(/git fetch --force --no-tags origin main/g)).toHaveLength(1);
    expect(workflow.match(/git fetch --force --no-tags origin staging/g)).toHaveLength(1);
    expect(workflow).toContain(
      ".passed = false | .checks.exactRevisionAndConfiguration = false",
    );
    expect(controller).toContain('.eq("organization_id", manifest.organizationId)');
    expect(controller).toContain('.eq("brand_id", manifest.brandId)');
    expect(controller).toContain('.eq("brand_id", manifest.crossTenantBrandId)');
    expect(controller).toContain("result.body?.data?.compliance?.bindingHashes");
    expect(controller).toContain("result.body?.data?.database?.bindingHashes?.supabaseUrlSha256");
    expect(controller).toContain("Number.isInteger(attemptsBefore)");
    expect(controller).toContain("recoveryAttemptsAfter");
    expect(controller.indexOf("fingerprintSnapshot = fingerprintFixture.shipping_address")).toBeLessThan(
      controller.indexOf('await runScenario("fingerprint", "compliant")'),
    );
    expect(controller).toContain(
      '.select("id,shipping_address,latest_compliance_check_id,compliance_status")',
    );
    expect(controller).toContain("restoredRows?.length !== 1");
    expect(controller).toContain(".update(fingerprintCleanupPatch(fingerprintSnapshot))");
    expect(controller.indexOf("const [finalHealth, finalConfiguration] = await Promise.all")).toBeGreaterThan(
      controller.indexOf("checks.appendOnlyAuditEvidence = true"),
    );
    expect(controller).toContain(
      'validateRuntimeConfiguration(\n      finalConfiguration,\n      "Final Worker configuration",',
    );
    expect(controller.indexOf("checks.exactRevisionAndConfiguration = true")).toBeGreaterThan(
      controller.indexOf("const [finalHealth, finalConfiguration] = await Promise.all"),
    );
    expect(controller.indexOf("checks.exactSandboxBinding = true")).toBeGreaterThan(
      controller.indexOf("const [finalHealth, finalConfiguration] = await Promise.all"),
    );
    expect(controller).toContain('.from("compliance_checks")');
    expect(controller).toContain(
      '.in("provider_response_id", [...complianceResponseIds])',
    );
    expect(controller).toContain('.from("analytics_events")');
    expect(controller).toContain("createBoundedAccessFetch({");
    expect(controller).toContain('redirect: "error"');
    expect(controller).toContain("...accessHeaders");
    expect(controller).toContain("analyticsEventIdempotencyKey({");
    expect(controller).toContain('error?.status ===');
    expect(controller).toContain('?.providerResponseId === "string"');
    expect(controller).toContain('.in("idempotency_key", [...analyticsKeys])');
    expect(controller).not.toContain(
      '.in("idempotency_key", [...analyticsKeys])\n      .gte("created_at", startedAt)',
    );
    expect(controller).toContain('.from("audit_log")');
    expect(service).toContain('if (shipment.status === "label_created")');
    expect(service).toContain("const recovered = recoveredShippingLabelResult(");
    expect(service.match(/p_brand_id: brandId/g)?.length).toBeGreaterThanOrEqual(2);
    expect(brandScopeMigration).toContain("shipment.brand_id = p_brand_id");
    expect(brandScopeMigration).toContain("for update;");
    expect(brandScopeMigration).not.toContain("for share;");
    expect(brandScopeMigration).toContain(
      "uuid, uuid, text, uuid, integer, text\n) from public, anon, authenticated, service_role",
    );
    expect(brandScopeMigration).toContain(
      "uuid, uuid, uuid, text, uuid, integer, text\n) to service_role",
    );
    expect(phase4PgTap).toContain(
      "pg_temp.acquire_shipping_label_attempt_compat",
    );
    expect(phase4PgTap).toContain("p_brand_id uuid");
    expect(phase4PgTap).toContain("and brand_id = $2");
    expect(phase4PgTap).toContain(
      "current-schema label acquisition rejects the wrong active brand",
    );
    expect(phase4PgTap).toContain(
      "public.acquire_shipping_label_attempt(uuid,uuid,uuid,text,uuid,integer,text)",
    );
  });
});
