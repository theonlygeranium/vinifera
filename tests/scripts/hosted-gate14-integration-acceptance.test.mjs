import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  acceptedEnvelopeScopeSha256,
  acceptanceScopeSha256,
  authorize,
  runAcceptance,
  sha256,
  validateManifest,
  validatePolicy,
} from "../../scripts/hosted-gate14-integration-acceptance.mjs";
const worker = "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const supabase = "https://staging.example.test";
const candidate = "b".repeat(40);
const staging = "d".repeat(40);
const control = "a".repeat(40);
const storedCiphertext = "stored-ciphertext";
const storedIv = "stored-iv";
const keyVersions = ["key-2026-06", "key-2026-07"];
const manifest = () => ({
  schemaVersion: 1,
  gate: 14,
  candidateRevision: candidate,
  observedAt: "2026-08-06T12:00:00Z",
  organizationId: "00000000-0000-4000-8000-000000000001",
  brandId: "00000000-0000-4000-8000-000000000002",
  keyring: {
    provisioned: true,
    activeVersion: "key-2026-07",
    versions: keyVersions,
  },
  connections: Object.fromEntries(
    ["klaviyo", "avalara", "meta", "quickbooks"].map((provider, index) => [
      provider,
      {
        connectionId: `00000000-0000-4000-8000-${String(index + 3).padStart(12, "0")}`,
        winerySpecific: true,
        status: "active",
        envelope: {
          algorithm: "AES-256-GCM",
          version: 1,
          ciphertextSha256: sha256(storedCiphertext),
          ivSha256: sha256(storedIv),
          keyIdSha256: sha256("key-2026-07"),
          plaintextAbsent: true,
        },
      },
    ]),
  ),
  klaviyo: {
    bulkProfiles: 1000,
    bulkElapsedMs: 30000,
    bulkTerminalStatus: "completed",
    memberUpdateVisible: true,
    listTransitionVisible: true,
    openReflected: true,
    clickReflected: true,
    tamperedSignatureRejected: true,
    staleSignatureRejected: true,
    disconnectDisclosureBlocked: true,
  },
  quickbooks: {
    applicationClientConfigured: true,
    redirectUriExact: true,
    oauthStateVerified: true,
    realmApproved: true,
    companyApproved: true,
    perConnectionTokenEncrypted: true,
    refreshTokenRotated: true,
    latestRefreshTokenPersistedBeforeUse: true,
    ambiguousWritesReconciled: true,
    taxAndAccountMappingsExact: true,
    salesReceiptObserved: true,
    refundReceiptObserved: true,
    splitRefundConverged: true,
    splitRefundIncrementsCents: [4863, 4862],
    splitRefundTotalCents: 9725,
    transactionCount: 100,
    elapsedMs: 60000,
    duplicateCount: 0,
    refreshCount: 1,
    unexplainedDifferenceCents: 0,
    startingTokenGeneration: 4,
    endingTokenGeneration: 5,
  },
  avalara: {
    jurisdictionExact: true,
    exemptionExact: true,
    shippingTaxExact: true,
    totalTaxExact: true,
    savedBeforeCharge: true,
    committedAfterCharge: true,
    partialRefundReturnInvoiceExact: true,
    completingRefundReturnInvoiceExact: true,
    refundReturnInvoiceExact: true,
    partialRefundExpectedTaxReductionCents: 486,
    partialRefundObservedTaxReductionCents: 486,
    completingRefundExpectedTaxReductionCents: 487,
    completingRefundObservedTaxReductionCents: 487,
    cumulativeRefundTaxReductionCents: 973,
    liabilityBeforeRefundCents: 1500,
    liabilityAfterPartialRefundCents: 1014,
    liabilityAfterCompletingRefundCents: 527,
    liabilityReduced: true,
    interruptedAfterProvider: "quickbooks",
    completedProviderWritesBeforeResume: 1,
    incompleteProviderWritesResumed: 1,
    duplicateCompletedProviderWritesAfterResume: 0,
    checkpointConverged: true,
    noStrandedSavedTransaction: true,
    failedChargeNotCommitted: true,
    calculationElapsedMs: 499,
  },
  meta: {
    unconsentedSuppressed: true,
    rawIdentifiersAbsent: true,
    browserServerEventIdMatched: true,
    withdrawalRedacted: true,
    testEventCodeRemoved: true,
    eventLifecycles: ["Lead", "Purchase", "tier_upgrade", "referral"].map(
      (eventName, index) => ({
        eventName,
        eventIdSha256: String(index + 1).repeat(64),
        sent: true,
        eventsManagerObserved: true,
      }),
    ),
    acknowledgementElapsedMs: 5000,
  },
});
function policy(text) {
  return {
    schemaVersion: 1,
    enabled: true,
    stagingWorkerOriginSha256: [sha256(worker)],
    stagingSupabaseUrlSha256: [sha256(supabase)],
    acceptanceScopeSha256: [
      acceptanceScopeSha256(validateManifest(JSON.parse(text))),
    ],
  };
}
function env(overrides = {}) {
  return {
    STAGING_GATE14_ACCEPTANCE_ENABLED: "true",
    GATE14_ACCEPTANCE_CONFIRMATION:
      "RUN VINIFERA GATE 14 INTEGRATION ACCEPTANCE",
    STAGING_WORKER_ORIGIN: worker,
    SUPABASE_URL: supabase,
    GATE14_CANDIDATE_REVISION: candidate,
    GATE14_STAGING_REVISION: staging,
    GATE14_CONTROL_SHA: control,
    GITHUB_SHA: control,
    CF_ACCESS_CLIENT_ID: "id",
    CF_ACCESS_CLIENT_SECRET: "secret",
    STAGING_SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ...overrides,
  };
}
const runtimeConfig = (overrides = {}) => ({
  data: {
    database: { bindingHashes: { supabaseUrlSha256: sha256(supabase) } },
    integrationEncryption: {
      bindingHashes: {
        activeVersionSha256: sha256("key-2026-07"),
        keyringVersionsSha256: sha256(JSON.stringify(keyVersions)),
        acceptedConnectionIdsSha256: sha256(
          JSON.stringify(
            Object.values(manifest().connections)
              .map((connection) => connection.connectionId)
              .sort(),
          ),
        ),
        acceptedEnvelopeScopeSha256: acceptedEnvelopeScopeSha256(
          validateManifest(manifest()),
        ),
        ...overrides,
      },
    },
  },
});
function databaseRows(url, { ciphertext = storedCiphertext, iv = storedIv } = {}) {
  const value = String(url);
  if (value.includes("/rest/v1/integration_secrets"))
    return Object.entries(manifest().connections).map(([integrationType, connection]) => ({
      connection_id: connection.connectionId,
      organization_id: manifest().organizationId,
      storage_mode: "encrypted_envelope",
      envelope_version: 1,
      algorithm: "A256GCM",
      credential_ciphertext: ciphertext,
      credential_iv: iv,
      key_version: "key-2026-07",
      connection: {
        id: connection.connectionId,
        organization_id: manifest().organizationId,
        brand_id: manifest().brandId,
        integration_type: integrationType,
        status: "active",
        opted_in: true,
      },
    }));
  return null;
}
describe("Gate 14 hosted integration acceptance", () => {
  it("validates either the disabled baseline or a reviewed enabled policy", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL(
          "../../config/gate14-integration-acceptance-policy.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(() => validatePolicy(raw)).not.toThrow();
  });
  it("requires four distinct winery-specific runtime-keyring encrypted connections", () => {
    expect(Object.keys(validateManifest(manifest()).connections)).toHaveLength(
      4,
    );
    for (const change of [
      { algorithm: "AES-128-GCM" },
      { version: 2 },
      { plaintextAbsent: false },
      { keyIdSha256: sha256("unknown-key") },
    ]) {
      const bad = manifest();
      Object.assign(bad.connections.meta.envelope, change);
      expect(() => validateManifest(bad)).toThrow();
    }
    const wrongTenant = manifest();
    wrongTenant.connections.avalara.winerySpecific = false;
    expect(() => validateManifest(wrongTenant)).toThrow(/winery-specific/);
    const duplicate = manifest();
    duplicate.connections.meta.connectionId =
      duplicate.connections.klaviyo.connectionId;
    expect(() => validateManifest(duplicate)).toThrow(/distinct/);
  });
  it("requires each provider lifecycle, exact Avalara recovery, and bounded performance", () => {
    for (const mutate of [
      (m) => {
        m.klaviyo.bulkProfiles = 999;
      },
      (m) => {
        m.quickbooks.perConnectionTokenEncrypted = false;
      },
      (m) => {
        m.quickbooks.salesReceiptObserved = false;
      },
      (m) => {
        m.quickbooks.splitRefundIncrementsCents = [4862, 4863];
      },
      (m) => {
        m.quickbooks.refreshCount = 2;
      },
      (m) => {
        m.quickbooks.endingTokenGeneration = 6;
      },
      (m) => {
        m.avalara.partialRefundObservedTaxReductionCents = 485;
      },
      (m) => {
        m.avalara.liabilityAfterCompletingRefundCents = 1200;
      },
      (m) => {
        m.avalara.liabilityAfterPartialRefundCents = 1013;
        m.avalara.liabilityAfterCompletingRefundCents = 526;
      },
      (m) => {
        m.avalara.duplicateCompletedProviderWritesAfterResume = 1;
      },
      (m) => {
        m.avalara.calculationElapsedMs = 500;
      },
      (m) => {
        m.meta.rawIdentifiersAbsent = false;
      },
      (m) => {
        m.meta.acknowledgementElapsedMs = 5001;
      },
      (m) => {
        m.meta.eventLifecycles[2].sent = false;
      },
      (m) => {
        m.meta.eventLifecycles[3].eventName = "Lead";
      },
    ]) {
      const bad = manifest();
      mutate(bad);
      expect(() => validateManifest(bad)).toThrow();
    }
  });
  it("fails closed on switch, confirmation, and exact target drift", () => {
    const text = JSON.stringify(manifest());
    const p = validatePolicy(policy(text));
    const normalized = validateManifest(JSON.parse(text));
    expect(authorize(env(), p, normalized)).toHaveProperty(
      "workerOrigin",
      worker,
    );
    expect(
      authorize(
        env(),
        p,
        validateManifest({ ...manifest(), observedAt: "2026-08-06T12:15:00Z" }),
      ),
    ).toHaveProperty("workerOrigin", worker);
    for (const bad of [
      { STAGING_GATE14_ACCEPTANCE_ENABLED: "false" },
      { GATE14_ACCEPTANCE_CONFIRMATION: "RUN SOMETHING" },
      { SUPABASE_URL: "https://other.example" },
    ])
      expect(() => authorize(env(bad), p, normalized)).toThrow();
  });
  it("requires a strict round-tripping RFC3339 observation instant", () => {
    for (const observedAt of ["2026-02-30T12:00:00Z", "2026-08-06T12:00:00", "2026-08-06 12:00:00Z"]) {
      expect(() => validateManifest({ ...manifest(), observedAt })).toThrow(/ISO\/RFC3339/);
    }
  });
  it("keeps reviewed static scope independent of the containing candidate SHA", () => {
    const normalized = validateManifest(manifest());
    const anotherCandidate = validateManifest({ ...manifest(), candidateRevision: "f".repeat(40) });
    expect(acceptanceScopeSha256(anotherCandidate)).toBe(acceptanceScopeSha256(normalized));
  });
  it("binds sanitized evidence to the exact staging revision, database, and runtime keyring", async () => {
    const text = JSON.stringify(manifest());
    const fetchImpl = vi.fn(
      async (url) =>
        new Response(
          JSON.stringify(
            databaseRows(url) ?? (String(url).endsWith("/configuration")
              ? runtimeConfig()
              : {
                  data: {
                    environment: "staging",
                    service: "vinifera-api",
                    status: "ok",
                    revision: candidate,
                  },
                }),
          ),
        ),
    );
    const report = await runAcceptance({
      env: env(),
      fetchImpl,
      manifestText: text,
      policyText: JSON.stringify(policy(text)),
      now: () => new Date("2026-08-06T12:00:00Z"),
    });
    expect(report).toMatchObject({
      gate: 14,
      passed: true,
      completionClaimed: false,
      candidateRevision: candidate,
      keyringActiveVersionSha256: sha256("key-2026-07"),
      blockers: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const secretCall = fetchImpl.mock.calls.find(([url]) => String(url).includes("/rest/v1/integration_secrets"));
    const secretUrl = new URL(String(secretCall[0]));
    expect(secretCall[1].headers).toMatchObject({
      "CF-Access-Client-Id": "id",
      "CF-Access-Client-Secret": "secret",
      apikey: "service-role-key",
      authorization: "Bearer service-role-key",
    });
    expect(secretUrl.searchParams.get("connection.brand_id")).toBe(`eq.${manifest().brandId}`);
    expect(secretUrl.searchParams.get("select")).toContain("integration_secrets_connection_org_fkey!inner");
    expect(JSON.stringify(report)).not.toContain("ciphertextSha256");
    expect(JSON.stringify(report)).not.toContain("key-2026-07");
  });
  it("rejects reused/stale manifests and runtime database/keyring drift", async () => {
    const run = async (
      value,
      configuration = runtimeConfig(),
      now = () => new Date("2026-08-06T12:00:00Z"),
      stored = {},
    ) => {
      const text = JSON.stringify(value);
      return runAcceptance({
        env: env(),
        manifestText: text,
        policyText: JSON.stringify(policy(text)),
        now,
        fetchImpl: async (url) =>
          new Response(
            JSON.stringify(
              databaseRows(url, stored) ?? (String(url).endsWith("/configuration")
                ? configuration
                : {
                    data: {
                      environment: "staging",
                      service: "vinifera-api",
                      status: "ok",
                      revision: candidate,
                    },
                  }),
            ),
          ),
      });
    };
    await expect(
      run({ ...manifest(), candidateRevision: "f".repeat(40) }),
    ).rejects.toThrow(/manifest does not match/);
    await expect(
      run({ ...manifest(), observedAt: "2099-01-01T00:00:00Z" }),
    ).rejects.toThrow(/future-dated/);
    await expect(
      run({ ...manifest(), observedAt: "2026-08-06T11:29:59Z" }),
    ).rejects.toThrow(/stale/);
    await expect(
      run(manifest(), runtimeConfig({ activeVersionSha256: "f".repeat(64) })),
    ).rejects.toThrow(/keyring differs/);
    await expect(
      run(
        manifest(),
        runtimeConfig({ acceptedConnectionIdsSha256: "f".repeat(64) }),
      ),
    ).rejects.toThrow(/decrypt every accepted provider connection/);
    await expect(
      run(
        manifest(),
        runtimeConfig({ acceptedEnvelopeScopeSha256: "f".repeat(64) }),
      ),
    ).rejects.toThrow(/accepted tenant and provider envelopes/);
    await expect(
      run(manifest(), runtimeConfig(), () => new Date("2026-08-06T12:00:00Z"), { ciphertext: "database-drift" }),
    ).rejects.toThrow(/active brand-scoped database envelopes/);
    await expect(
      run(manifest(), runtimeConfig(), () => new Date("2026-08-06T12:00:00Z"), { iv: "iv-drift" }),
    ).rejects.toThrow(/active brand-scoped database envelopes/);
    const databaseDrift = runtimeConfig();
    databaseDrift.data.database.bindingHashes.supabaseUrlSha256 = "f".repeat(
      64,
    );
    await expect(run(manifest(), databaseDrift)).rejects.toThrow(
      /database target differs/,
    );
  });
  it("wires protected canonical-main execution, fresh promotion authority checks, and 90-day evidence", async () => {
    const workflow = await readFile(
      new URL(
        "../../.github/workflows/gate14-integration-acceptance.yml",
        import.meta.url,
      ),
      "utf8",
    );
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain('origin/staging)" == "$STAGING_REVISION"');
    expect(workflow).toContain('"$CANDIDATE_REVISION^{tree}"');
    expect(workflow).toContain('commits/$STAGING_REVISION/pulls');
    expect(workflow).toContain('.head.ref == "dev"');
    expect(workflow).toContain("'.head.sha // empty'");
    expect(workflow.split("git fetch --force --no-tags")).toHaveLength(4);
    expect(workflow).toContain("Canonical main, staging, or exact promotion authority drifted after acceptance.");
    expect(workflow).toContain("if ! git fetch --force --no-tags");
    expect(workflow).toContain("elif ! promotion_pr=$(gh api");
    expect(workflow).toContain('if [[ -n "$authority_error" ]]');
    expect(workflow).toContain("gate14-integration-acceptance.unretained.json");
    expect(workflow).toContain(".passed = false");
    expect(workflow).toContain("STAGING_SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow).toContain("staging-acceptance-control");
    expect(workflow).toContain("retention-days: 90");
  });
});
