import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  authorizeRuntimeManifest,
  authorizeTargets,
  buildEvidence,
  deterministicCommandId,
  fixtureContractSha256,
  mergeCookieJar,
  requiredRaw,
  sha256,
  supabaseAdminClientOptions,
  validateGate6AuditRows,
  validateNegativeControl,
  validateEvidenceBinding,
  validateFixtureManifest,
  validateGate13Evidence,
  validatePolicy,
  validateStripeTestSecret,
} from "../../scripts/hosted-gate6-phase2-acceptance.mjs";

const workerOrigin =
  "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const values = {
  account: "acct_test_gate6",
  manifest: "fixture-manifest",
  supabaseUrl: "https://staging-supabase.example.test",
};

function policy(overrides = {}) {
  const manifest = validateFixtureManifest(fixture());
  return {
    enabled: true,
    fixtureContractSha256: [fixtureContractSha256(manifest)],
    schemaVersion: 2,
    stagingSupabaseUrlSha256: [sha256(values.supabaseUrl)],
    stagingWorkerOriginSha256: [sha256(workerOrigin)],
    stripeAccountIdSha256: [sha256(values.account)],
    ...overrides,
  };
}

function environment(overrides = {}) {
  return {
    COMPLIANCE_PROVIDER: "shipcompliant",
    COMPLIANCE_SIMULATOR_ENABLED: "false",
    GATE6_ACCEPTANCE_CONFIRMATION: "RUN VINIFERA GATE 6 PHASE 2 ACCEPTANCE",
    GATE6_ACCEPTANCE_MANIFEST_SHA256: sha256(values.manifest),
    LIVE_BILLING_ENABLED: "false",
    SHIPPING_PROVIDER: "easypost",
    SHIPPING_SIMULATOR_ENABLED: "false",
    STAGING_GATE6_ACCEPTANCE_ENABLED: "true",
    STAGING_WORKER_ORIGIN: workerOrigin,
    SUPABASE_URL: values.supabaseUrl,
    ...overrides,
  };
}

function fixture(overrides = {}) {
  return {
    brandId: "00000000-0000-4000-8000-000000000002",
    candidateRevision: "b".repeat(40),
    cleanupMode: "retire",
    crossTenantBrandId: "00000000-0000-4000-8000-000000000003",
    members: Array.from({ length: 10 }, (_, index) => ({
      declined: index === 9,
      email: `owner+vinifera-g6-member-${index + 1}@example.test`,
      id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
      shipmentId: `00000000-0000-4000-8002-${String(index + 1).padStart(12, "0")}`,
    })),
    organizationId: "00000000-0000-4000-8000-000000000001",
    releaseId: "00000000-0000-4000-8000-000000000005",
    schemaVersion: 1,
    staffEmail: "owner+vinifera-g6-staff@example.test",
    staffPassword: "strong-fixture-password",
    tierId: "00000000-0000-4000-8000-000000000004",
    ...overrides,
  };
}

describe("Gate 6 exact policy and ten-member fixture contract", () => {
  it("keeps the checked-in policy disabled and empty", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL(
          "../../config/gate6-staging-acceptance-policy.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const normalized = validatePolicy(raw);
    expect(normalized.enabled).toBe(false);
    for (const [name, value] of Object.entries(normalized)) {
      if (name.endsWith("Sha256")) expect(value).toEqual([]);
    }
  });

  it("requires one exact target hash before activation", () => {
    expect(validatePolicy(policy()).enabled).toBe(true);
    expect(() =>
      validatePolicy(policy({ stripeAccountIdSha256: [] })),
    ).toThrow(/exactly one stripeAccountIdSha256/);
    expect(() =>
      validatePolicy(policy({ stagingSupabaseUrlSha256: ["A".repeat(64)] })),
    ).toThrow(/lowercase SHA-256/);
  });

  it("requires an exact candidate plus ten unique dedicated members and one decline", () => {
    expect(validateFixtureManifest(fixture()).members).toHaveLength(10);
    expect(() =>
      validateFixtureManifest(fixture(), "c".repeat(40)),
    ).toThrow(/exact staging candidate/);
    expect(() =>
      validateFixtureManifest(fixture({ members: fixture().members.slice(0, 9) })),
    ).toThrow(/exactly ten/);
    const twoDeclines = fixture();
    twoDeclines.members[0].declined = true;
    expect(() => validateFixtureManifest(twoDeclines)).toThrow(/Exactly one/);
    const duplicate = fixture();
    duplicate.members[1].shipmentId = duplicate.members[0].shipmentId;
    expect(() => validateFixtureManifest(duplicate)).toThrow(/must be unique/);
    expect(() =>
      validateFixtureManifest(fixture({ cleanupMode: "delete" })),
    ).toThrow(/retire cleanup/);
  });
});

describe("Gate 6 prerequisite, authorization, and evidence", () => {
  it("removes deleted base cookies without shadowing valid SSR chunks", () => {
    const jar = new Map([["vinifera-staff-auth", "stale"]]);
    mergeCookieJar(jar, {
      headers: {
        get: () => null,
        getSetCookie: () => [
          "vinifera-staff-auth=; Path=/; Max-Age=0; HttpOnly",
          "vinifera-staff-auth.0=part-one; Path=/; HttpOnly",
          "vinifera-staff-auth.1=part-two; Path=/; HttpOnly",
        ],
      },
    });
    expect(jar.has("vinifera-staff-auth")).toBe(false);
    expect([...jar.entries()]).toEqual([
      ["vinifera-staff-auth.0", "part-one"],
      ["vinifera-staff-auth.1", "part-two"],
    ]);
  });

  it("keeps the Access-protected Supabase client bound to explicit transport headers", () => {
    const accessHeaders = {
      "CF-Access-Client-Id": "client-id",
      "CF-Access-Client-Secret": "client-secret",
    };
    expect(supabaseAdminClientOptions(accessHeaders)).toEqual({
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: accessHeaders },
    });
  });

  it("rejects non-test Stripe credentials before client construction", () => {
    expect(validateStripeTestSecret("sk_test_example")).toBe("sk_test_example");
    expect(() => validateStripeTestSecret("sk_live_example")).toThrow(/sk_test_/);
    expect(() => validateStripeTestSecret("sk_test_")).toThrow(/sk_test_/);
  });

  it("preserves the exact manifest bytes operators hash", () => {
    expect(requiredRaw("{\"schemaVersion\":1}\n", "manifest")).toBe(
      "{\"schemaVersion\":1}\n",
    );
    expect(() => requiredRaw(" \n", "manifest")).toThrow(/required/);
  });

  it("requires a real active negative-control brand in another tenant", () => {
    const manifest = fixture();
    const brand = {
      active: true,
      id: manifest.crossTenantBrandId,
      organization_id: "00000000-0000-4000-8000-000000000099",
    };
    const staff = {
      email: manifest.staffEmail,
      organization_id: manifest.organizationId,
      role: "owner",
      status: "active",
    };
    expect(validateNegativeControl(brand, staff, manifest)).toBe(true);
    expect(() => validateNegativeControl(null, staff, manifest)).toThrow(/negative-control brand/);
    expect(() =>
      validateNegativeControl(
        { ...brand, organization_id: manifest.organizationId },
        staff,
        manifest,
      ),
    ).toThrow(/another staging tenant/);
    expect(() =>
      validateNegativeControl(brand, { ...staff, organization_id: brand.organization_id }, manifest),
    ).toThrow(/staff identity/);
    expect(() =>
      validateNegativeControl(brand, { ...staff, role: "manager" }, manifest),
    ).toThrow(/refund-authorized/);
  });

  it("derives a stable UUID command identity for the single refund", () => {
    const first = deterministicCommandId("gate6:refund");
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(deterministicCommandId("gate6:refund")).toBe(first);
    expect(deterministicCommandId("gate6:another-refund")).not.toBe(first);
  });

  it("binds canonical main control to the exact deployed candidate", () => {
    const controlSha = "a".repeat(40);
    expect(
      validateEvidenceBinding(
        {
          GATE6_CANDIDATE_REVISION: "b".repeat(40),
          GATE6_CONTROL_SHA: controlSha,
          GITHUB_REPOSITORY: "theonlygeranium/vinifera",
          GITHUB_RUN_ATTEMPT: "2",
          GITHUB_RUN_ID: "123",
          GITHUB_SHA: controlSha,
        },
        "policy-text",
      ),
    ).toMatchObject({
      candidateRevision: "b".repeat(40),
      controlSha,
      policySha256: sha256("policy-text"),
    });
  });

  it("authorizes the exact per-run manifest from protected runtime state", () => {
    const manifest = validateFixtureManifest(fixture());
    expect(
      authorizeRuntimeManifest({
        env: environment(),
        manifest,
        manifestText: values.manifest,
        policy: validatePolicy(policy()),
      }),
    ).toEqual({
      fixtureContractSha256: fixtureContractSha256(manifest),
      fixtureManifestSha256: sha256(values.manifest),
    });
    expect(() =>
      authorizeRuntimeManifest({
        env: environment({ GATE6_ACCEPTANCE_MANIFEST_SHA256: sha256("other") }),
        manifest,
        manifestText: values.manifest,
        policy: validatePolicy(policy()),
      }),
    ).toThrow(/protected runtime state/);
    expect(() =>
      authorizeRuntimeManifest({
        env: environment({ STAGING_GATE6_ACCEPTANCE_ENABLED: "false" }),
        manifest,
        manifestText: values.manifest,
        policy: validatePolicy(policy()),
      }),
    ).toThrow(/toggle is disabled/);
    const nextCandidate = validateFixtureManifest(
      fixture({ candidateRevision: "c".repeat(40), staffPassword: "another-strong-password" }),
    );
    expect(fixtureContractSha256(nextCandidate)).toBe(fixtureContractSha256(manifest));
  });

  it("authorizes only exact test-mode provider and tenant targets", () => {
    expect(
      authorizeTargets({
        env: environment(),
        policy: validatePolicy(policy()),
        stripeAccountId: values.account,
      }),
    ).toMatchObject({
      supabaseUrl: values.supabaseUrl,
      workerOrigin,
    });
    for (const drift of [
      { LIVE_BILLING_ENABLED: "true" },
      { SHIPPING_PROVIDER: "simulated" },
      { COMPLIANCE_PROVIDER: "simulated" },
      { STAGING_WORKER_ORIGIN: "https://attacker.example" },
    ]) {
      expect(() =>
        authorizeTargets({
          env: environment(drift),
          policy: validatePolicy(policy()),
          stripeAccountId: values.account,
        }),
      ).toThrow();
    }
  });

  it("requires successful exact-candidate Gate 13 evidence", () => {
    const candidateRevision = "b".repeat(40);
    const evidence = {
      cleanup: true,
      completionClaimed: false,
      gate: 13,
      passed: true,
      source: { candidateRevision, runId: "321" },
    };
    expect(
      validateGate13Evidence(evidence, candidateRevision, "321"),
    ).toHaveProperty("runId", "321");
    expect(() =>
      validateGate13Evidence(
        { ...evidence, source: { candidateRevision: "c".repeat(40), runId: "321" } },
        candidateRevision,
        "321",
      ),
    ).toThrow(/exact Gate 6 staging candidate/);
  });

  it("never claims completion and requires every check plus cleanup", () => {
    const names = [
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
    const checks = Object.fromEntries(names.map((name) => [name, true]));
    expect(
      buildEvidence({
        checks,
        cleanup: true,
        gate13: {},
        generatedAt: "2026-08-06T12:00:00.000Z",
        source: {},
        targets: {},
      }),
    ).toMatchObject({ passed: true, completionClaimed: false });
    checks.singleTestRefund = false;
    expect(
      buildEvidence({ checks, cleanup: true, gate13: {}, generatedAt: "", source: {}, targets: {} }).passed,
    ).toBe(false);
  });

  it("binds the audit chain to every exact Gate 6 entity and action", () => {
    const manifest = fixture();
    const shipmentIds = manifest.members.map((member) => member.shipmentId);
    const declinedId = manifest.members.find((member) => member.declined).shipmentId;
    const refundId = shipmentIds[0];
    const entries = [
      ["release.processed", "release", manifest.releaseId],
      ["shipment.labels_generated", "organization", manifest.organizationId],
      ...shipmentIds.map((id) => ["shipment.charge_succeeded", "shipment", id]),
      ["shipment.charge_declined", "shipment", declinedId],
      ...shipmentIds.flatMap((id) => [
        ["shipment.item_packed", "shipment", id],
        ["shipment.shipped", "shipment", id],
        ["shipment.delivered", "shipment", id],
      ]),
      ["shipment.refunded", "shipment", refundId],
    ];
    const rows = entries.map(([action, entity_type, entity_id], index) => ({
      action,
      brand_id: manifest.brandId,
      entity_id,
      entity_type,
      entry_hash: String(index + 1).padStart(64, "0"),
      previous_hash: index === 0 ? "f".repeat(64) : String(index).padStart(64, "0"),
      sequence_number: index + 100,
    }));
    const baseline = { entry_hash: "f".repeat(64), sequence_number: 99 };
    expect(validateGate6AuditRows(rows, manifest, refundId, baseline)).toMatchObject({
      rowCount: rows.length,
    });
    expect(() =>
      validateGate6AuditRows(
        rows.filter((row) => row.action !== "shipment.delivered"),
        manifest,
        refundId,
        baseline,
      ),
    ).toThrow(/sequence or hash linkage|shipment.delivered/);
    const broken = structuredClone(rows);
    broken[1].previous_hash = "e".repeat(64);
    expect(() => validateGate6AuditRows(broken, manifest, refundId, baseline)).toThrow(/hash linkage/);
    expect(() =>
      validateGate6AuditRows(rows, manifest, refundId, {
        entry_hash: "e".repeat(64),
        sequence_number: 99,
      }),
    ).toThrow(/baseline linkage/);
  });

  it("wires a main-only protected one-shot workflow with retained sanitized evidence", async () => {
    const [workflow, controller] = await Promise.all([
      readFile(
        new URL("../../.github/workflows/gate6-staging-acceptance.yml", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../scripts/hosted-gate6-phase2-acceptance.mjs", import.meta.url),
        "utf8",
      ),
    ]);
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain('[[ "$(git rev-parse origin/staging)" == "$CANDIDATE_REVISION" ]]');
    expect(workflow).toContain("name: staging-acceptance-control");
    expect(workflow).toContain("STAGING_GATE6_ACCEPTANCE_ENABLED");
    expect(workflow).toContain("STAGING_GATE6_ACCEPTANCE_MANIFEST");
    expect(workflow).toContain("STAGING_GATE6_ACCEPTANCE_MANIFEST_SHA256");
    expect(workflow).toContain("shipcompliant-staging-acceptance.yml");
    expect(workflow).toContain("retention-days: 90");
    const prerequisiteIndex = workflow.indexOf(
      "- name: Retrieve exact Gate 13 prerequisite evidence",
    );
    const revalidationIndex = workflow.indexOf(
      "- name: Revalidate immutable authority immediately before mutation",
    );
    const providerIndex = workflow.indexOf(
      "- name: Run protected Phase 2 provider acceptance",
    );
    expect(prerequisiteIndex).toBeGreaterThan(-1);
    expect(revalidationIndex).toBeGreaterThan(prerequisiteIndex);
    expect(providerIndex).toBeGreaterThan(revalidationIndex);
    expect(workflow.slice(revalidationIndex, providerIndex)).toContain(
      '[[ "$(git rev-parse origin/main)" == "$CONTROL_SHA" ]]',
    );
    expect(workflow.slice(revalidationIndex, providerIndex)).toContain(
      '[[ "$(git rev-parse origin/staging)" == "$CANDIDATE_REVISION" ]]',
    );
    expect(controller).toContain('.eq("organization_id", manifest.organizationId)');
    expect(controller).toContain('.eq("brand_id", manifest.brandId)');
    expect(controller).toContain('idempotencyKey: `vinifera:g6:');
    expect(controller).toContain('.from("billing_attempts")');
    expect(controller).toContain('.from("compliance_checks")');
    expect(controller).toContain('.from("shipping_label_attempts")');
    expect(controller).toContain('.from("audit_log")');
    expect(controller).toContain('status: "cancelled"');
    expect(controller).toContain("...accessHeaders");
    expect(controller).toContain("supabaseAdminClientOptions(accessHeaders)");
    expect(controller).toContain("validateStripeTestSecret(process.env.STRIPE_SECRET_KEY)");
    expect(controller).toContain("const manifestText = requiredRaw(");
    expect(controller).toContain("validateNegativeControl(negativeBrand, fixtureStaff, manifest)");
    expect(controller).toContain('expectStatus(crossTenant, 403, "Cross-tenant brand denial")');
    expect(controller).toContain("mergeCookieJar(jar, response)");
  });
});
