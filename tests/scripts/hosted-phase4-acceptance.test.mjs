import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { authorize, runAcceptance, sha256, validateManifest, validatePolicy } from "../../scripts/hosted-phase4-acceptance.mjs";

const worker = "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const supabase = "https://staging.example.test";
const revision = "b".repeat(40);
const control = "a".repeat(40);
const ids = { organizationId: "00000000-0000-4000-8000-000000000001", brandId: "00000000-0000-4000-8000-000000000002" };
const common = (gate) => ({ schemaVersion: 1, gate, candidateRevision: revision, ...ids, observedAt: "2026-08-06T12:00:00Z", sourceWindowStart: "2026-01-01T00:00:00Z", sourceWindowEnd: gate === 11 ? "2026-07-31T23:59:59Z" : "2026-06-30T23:59:59Z" });
const metricNames = ["recognizedRevenueCents", "refundCents", "discountCents", "taxCents", "mrrCents", "arrCents", "arpmCents", "revenueChurnCents", "ltvCents", "averageTenureDays", "activeMembers", "newMembers", "pausedMembers", "declinedMembers", "recoveredMembers", "cancelledMembers", "memberGrowthNet", "cohortRetainedMembers", "releasedShipments", "fulfilledShipments", "failedShipments", "shipmentFulfillmentBps", "averageShipmentCents", "declineRateBps", "shippingCostRatioBps", "emailsDelivered", "emailsOpened", "emailsClicked", "emailUnsubscribes", "emailOpenRateBps", "emailClickRateBps", "portalSessions", "portalLoginsPerMemberBps", "loyaltyAwards", "loyaltyRedemptions", "loyaltyRedemptionRateBps", "cancellationAttempts", "retainedOutcomes"];
const chartNames = ["revenueByTier", "activeMembersOverTime", "memberTenureDistribution", "cohortRetention", "declineReasons"];
const gate10 = () => ({ ...common(10), operationalProvenance: "active_winery_history", activeWinery: true, syntheticDataAbsent: true, provenanceEvidenceSha256: "8".repeat(64), metrics: Object.fromEntries(metricNames.map((name, index) => [name, { source: index, dashboard: index, csv: index }])), chartExports: Object.fromEntries(chartNames.map((name) => [name, { sourceRowsSha256: "e".repeat(64), dashboardRowsSha256: "e".repeat(64), csvRowsSha256: "e".repeat(64), rowCount: 2 }])), sourceQueryVersion: "analytics-v1", csvExportSha256: "c".repeat(64), csvRowCount: 38 });
const gate11 = () => { const trainingRunId = "00000000-0000-4000-8000-000000000004"; const modelVersionId = "00000000-0000-4000-8000-000000000008"; const experimentId = "00000000-0000-4000-8000-000000000009"; const datasetHash = "d".repeat(64); const sourceNames = ["shipments", "billing", "email_delivery", "portal_activity", "loyalty", "declines"]; const sourceCoverage = Object.fromEntries(sourceNames.map((name) => [name, { eligibleMembers: 500, reconciledMembers: 475 }])); const qualificationEvidencePayload = JSON.stringify({ training_run_id: trainingRunId, dataset_hash: datasetHash, status: "qualified", source_coverage: { eligible_member_count: 500, reconciled_through: "2026-07-31", sources: Object.fromEntries(sourceNames.map((name) => [name, { eligible_member_count: 500, reconciled_member_count: 475 }])) } }); return { ...common(11), actorUserId: "00000000-0000-4000-8000-000000000003", actorActive: true, actorPlatformSuperAdmin: true, trainingRunId, modelVersionId, modelDeploymentStatus: "ab_test", modelAucBps: 8300, experimentId, experimentStatus: "completed", experimentTrainingRunId: trainingRunId, experimentModelVersionId: modelVersionId, promotionAuditId: "00000000-0000-4000-8000-000000000005", promotionAuditTrainingRunId: trainingRunId, promotionAuditModelVersionId: modelVersionId, promotionAuditExperimentId: experimentId, datasetHash, provenance: "production_history", qualificationDryRunPassed: true, qualificationExecuted: true, qualificationTrainingRunId: trainingRunId, qualificationDatasetHash: datasetHash, qualificationEvidencePayload, qualificationEvidenceSha256: sha256(qualificationEvidencePayload), qualificationStatus: "qualified", eligibleMembers: 500, cancellations: 50, sourceCoverage, heldOutAucBps: 8300, rulesAucBps: 8100, experimentMlBrierBps: 1800, experimentRulesBrierBps: 2100, experimentStartedAt: "2026-06-01T00:00:00Z", experimentCompletedAt: "2026-07-01T00:00:00Z", dailyCoverage: Array.from({ length: 31 }, (_, index) => ({ date: new Date(Date.UTC(2026, 5, 1 + index)).toISOString().slice(0, 10), eligibleActiveMembers: 500, mlScoredMembers: 500, rulesScoredMembers: 500, immutableAssignments: 500 })), minimumRequiredOutcomes: 50, experimentEvaluatedOutcomes: 50, powerAnalysisSha256: "a".repeat(64), statisticalSufficiencyReviewed: true, driftReportId: "00000000-0000-4000-8000-000000000010", driftModelVersionId: modelVersionId, driftSnapshotDate: "2026-08-01", driftRetrainingRequired: false, driftIsLatestForModel: true, superior: true }; };
const gate12 = () => { const cohortId = "00000000-0000-4000-8000-000000000014"; return { ...common(12), sourceWindowStart: "2026-04-01T00:00:00Z", sourceWindowEnd: "2026-04-30T23:59:59Z", tier: "estate", optedIn: true, cohortId, contributorCount: 10, contributorOptIns: Array.from({ length: 10 }, (_, index) => ({ cohortId, organizationIdSha256: index === 0 ? sha256(ids.organizationId) : sha256(`organization-${index}`), brandIdSha256: index === 0 ? sha256(ids.brandId) : sha256(`brand-${index}`), ownerOptInAuditSha256: sha256(`audit-${index}`), tier: index % 2 === 0 ? "estate" : "reserve", entitled: true, optedIn: true })), reportQuarter: "2026-Q2", reportId: "00000000-0000-4000-8000-000000000007", benchmarkAvailable: true, benchmarkContributionId: "00000000-0000-4000-8000-000000000013", benchmarkAggregateId: cohortId, benchmarkAggregateSha256: "1".repeat(64), persistedReportContentSha256: "2".repeat(64), attachmentCount: 2, pdfAttachmentSha256: "3".repeat(64), csvAttachmentSha256: "4".repeat(64), deliveryEmailLogId: "00000000-0000-4000-8000-000000000011", deliveryEmailLogStatus: "delivered", deliveryEventId: "00000000-0000-4000-8000-000000000012", deliveryEventType: "delivered", deliveryProviderEventId: "resend-delivered-event-id", deliveryProviderMessageId: "resend-message-id", deliveredAt: "2026-07-02T00:00:00Z", suppressionVerified: true, differencingAttackDenied: true }; };
const gate12Attestation = (manifest = gate12()) => ({ organization_id: manifest.organizationId, brand_id: manifest.brandId, cohort_id: manifest.cohortId, report_id: manifest.reportId, report_type: "quarterly_benchmark", source_window_start: new Date(Date.parse(manifest.sourceWindowStart)).toISOString().slice(0, 10), source_window_end: new Date(Date.parse(manifest.sourceWindowEnd)).toISOString().slice(0, 10), benchmark_available: true, benchmark_contribution_id: manifest.benchmarkContributionId, benchmark_aggregate_id: manifest.benchmarkAggregateId, benchmark_aggregate_sha256: manifest.benchmarkAggregateSha256, persisted_report_content_sha256: manifest.persistedReportContentSha256, attachment_count: 2, pdf_attachment_sha256: manifest.pdfAttachmentSha256, csv_attachment_sha256: manifest.csvAttachmentSha256, email_log_id: manifest.deliveryEmailLogId, email_log_status: "delivered", delivery_event_id: manifest.deliveryEventId, delivery_event_type: "delivered", provider_event_id: manifest.deliveryProviderEventId, provider_message_id: manifest.deliveryProviderMessageId, delivered_at: manifest.deliveredAt });
function policy(gate) { return { schemaVersion: 1, enabledGates: [gate], stagingWorkerOriginSha256: [sha256(worker)], stagingSupabaseUrlSha256: [sha256(supabase)] }; }
function env(gate, text = JSON.stringify(gate === 10 ? gate10() : gate === 11 ? gate11() : gate12())) { return { GATE_NUMBER: String(gate), GATE_ACCEPTANCE_CONFIRMATION: `RUN VINIFERA GATE ${gate} HOSTED ACCEPTANCE`, [`STAGING_GATE${gate}_ACCEPTANCE_ENABLED`]: "true", [`STAGING_GATE${gate}_ACCEPTANCE_MANIFEST_SHA256`]: sha256(text), STAGING_WORKER_ORIGIN: worker, SUPABASE_URL: supabase, SUPABASE_SERVICE_ROLE_KEY: "service-role-key", GATE_CANDIDATE_REVISION: revision, GATE_CONTROL_SHA: control, GITHUB_SHA: control, CF_ACCESS_CLIENT_ID: "id", CF_ACCESS_CLIENT_SECRET: "secret" }; }

describe("Phase 4 hosted acceptance manifests", () => {
  it("validates either the disabled baseline or a reviewed enabled policy", async () => {
    const raw = JSON.parse(await readFile(new URL("../../config/phase4-hosted-acceptance-policy.json", import.meta.url), "utf8"));
    expect(() => validatePolicy(raw)).not.toThrow();
  });
  it("requires exact dashboard and CSV reconciliation for all Gate 10 metrics", () => {
    const valid = validateManifest(gate10(), 10);
    expect(Object.keys(valid.metrics)).toHaveLength(38);
    expect(Object.keys(valid.chartExports)).toHaveLength(5);
    const drift = gate10(); drift.metrics.arrCents.csv = 1;
    expect(() => validateManifest(drift, 10)).toThrow(/arrCents does not reconcile/);
    const chartDrift = gate10(); chartDrift.chartExports.cohortRetention.csvRowsSha256 = "f".repeat(64);
    expect(() => validateManifest(chartDrift, 10)).toThrow(/cohortRetention does not reconcile/);
    const impossibleRate = gate10(); impossibleRate.metrics.emailOpenRateBps = { source: 10_001, dashboard: 10_001, csv: 10_001 };
    expect(() => validateManifest(impossibleRate, 10)).toThrow(/cannot exceed 10000 basis points/);
    const frequentPortalUse = gate10(); frequentPortalUse.metrics.portalLoginsPerMemberBps = { source: 28_000, dashboard: 28_000, csv: 28_000 };
    expect(validateManifest(frequentPortalUse, 10).metrics.portalLoginsPerMemberBps.source).toBe(28_000);
    expect(() => validateManifest({ ...gate10(), operationalProvenance: "fixture" }, 10)).toThrow(/operational provenance/);
    expect(() => validateManifest({ ...gate10(), syntheticDataAbsent: false }, 10)).toThrow(/operational provenance/);
  });
  it("enforces Gate 11 population, all six families, AUC superiority, and 30 elapsed days", () => {
    expect(validateManifest(gate11(), 11).elapsedDays).toBe(30);
    for (const change of [{ eligibleMembers: 499 }, { cancellations: 49 }, { modelAucBps: 8199 }, { modelDeploymentStatus: "production" }, { experimentStatus: "running" }, { heldOutAucBps: 8199 }, { heldOutAucBps: 10001, rulesAucBps: 9999 }, { experimentMlBrierBps: 2100 }, { experimentRulesBrierBps: 1800 }, { experimentCompletedAt: "2026-06-30T00:00:00Z" }, { minimumRequiredOutcomes: 49 }, { experimentEvaluatedOutcomes: 49 }, { driftRetrainingRequired: true }, { driftIsLatestForModel: false }, { statisticalSufficiencyReviewed: false }, { superior: false }, { actorActive: false }, { qualificationExecuted: false }, { provenance: "synthetic" }]) expect(() => validateManifest({ ...gate11(), ...change }, 11)).toThrow();
    expect(validateManifest({ ...gate11(), experimentCompletedAt: "2026-07-01T23:59:59Z" }, 11).coverageDayCount).toBe(31);
    expect(validateManifest({ ...gate11(), experimentStartedAt: "2026-06-01T12:00:00.123456+00:00", experimentCompletedAt: "2026-07-01T12:00:00.654321+00:00" }, 11).coverageDayCount).toBe(31);
    const coverageGap = gate11(); coverageGap.dailyCoverage[12].date = "2026-06-30"; expect(() => validateManifest(coverageGap, 11)).toThrow(/not consecutive/);
    expect(() => validateManifest({ ...gate11(), sourceWindowEnd: "2026-02-28T23:59:59Z" }, 11)).toThrow(/outcome horizon/);
    expect(() => validateManifest({ ...gate11(), experimentModelVersionId: "00000000-0000-4000-8000-000000000099" }, 11)).toThrow(/experiment is not bound/);
    expect(() => validateManifest({ ...gate11(), promotionAuditExperimentId: "00000000-0000-4000-8000-000000000099" }, 11)).toThrow(/promotion audit is not bound/);
    expect(() => validateManifest({ ...gate11(), qualificationTrainingRunId: "00000000-0000-4000-8000-000000000099" }, 11)).toThrow(/qualification evidence.*bound/);
    expect(() => validateManifest({ ...gate11(), qualificationDatasetHash: "e".repeat(64) }, 11)).toThrow(/qualification evidence.*bound/);
    expect(() => validateManifest({ ...gate11(), qualificationEvidenceSha256: "invalid" }, 11)).toThrow(/qualification evidence.*bound/);
    const tamperedQualification = gate11(); tamperedQualification.qualificationEvidencePayload = tamperedQualification.qualificationEvidencePayload.replace("qualified", "rejected"); expect(() => validateManifest(tamperedQualification, 11)).toThrow(/cryptographically bound/);
    const emptyQualificationCoverage = gate11(); emptyQualificationCoverage.qualificationEvidencePayload = JSON.stringify({ ...JSON.parse(emptyQualificationCoverage.qualificationEvidencePayload), source_coverage: {} }); emptyQualificationCoverage.qualificationEvidenceSha256 = sha256(emptyQualificationCoverage.qualificationEvidencePayload); expect(() => validateManifest(emptyQualificationCoverage, 11)).toThrow(/reconciled_through|six-source coverage/);
    expect(() => validateManifest({ ...gate11(), cancellations: 501 }, 11)).toThrow(/cannot exceed eligibleMembers/);
    const missing = gate11(); delete missing.sourceCoverage.loyalty;
    expect(() => validateManifest(missing, 11)).toThrow(/loyalty/);
    expect(() => validateManifest({ ...gate11(), driftModelVersionId: "00000000-0000-4000-8000-000000000099" }, 11)).toThrow(/latest non-retraining drift report/);
  });
  it("enforces Gate 12 entitlement, opt-in, ten contributors, privacy, and quarterly delivery", () => {
    expect(validateManifest(gate12(), 12).contributorCount).toBe(10);
    for (const change of [{ tier: "standard" }, { optedIn: false }, { contributorCount: 9 }, { suppressionVerified: false }, { reportQuarter: "2026-05" }, { reportQuarter: "2026-Q1" }, { deliveredAt: "2099-01-01T00:00:00Z" }]) expect(() => validateManifest({ ...gate12(), ...change }, 12)).toThrow();
    expect(() => validateManifest({ ...gate12(), sourceWindowStart: "2026-03-31T23:59:59Z" }, 12)).toThrow(/entire source window/);
    expect(() => validateManifest({ ...gate12(), sourceWindowEnd: "2026-06-30T23:59:59Z" }, 12)).toThrow(/quarter-start benchmark month/);
    expect(() => validateManifest({ ...gate12(), sourceWindowStart: "2026-05-01T00:00:00Z", sourceWindowEnd: "2026-05-31T23:59:59Z" }, 12)).toThrow(/quarter-start benchmark month/);
    const missingOptIn = gate12(); missingOptIn.contributorOptIns[4].optedIn = false; expect(() => validateManifest(missingOptIn, 12)).toThrow(/not opted into the exact cohort/);
    const missingEntitlement = gate12(); missingEntitlement.contributorOptIns[4].entitled = false; expect(() => validateManifest(missingEntitlement, 12)).toThrow(/not entitled/);
    const invalidTier = gate12(); invalidTier.contributorOptIns[4].tier = "standard"; expect(() => validateManifest(invalidTier, 12)).toThrow(/not entitled/);
    const missingSelected = gate12(); missingSelected.contributorOptIns[0].brandIdSha256 = sha256("another-brand"); expect(() => validateManifest(missingSelected, 12)).toThrow(/selected winery is absent/);
    const duplicateOrganization = gate12(); duplicateOrganization.contributorOptIns[9].organizationIdSha256 = duplicateOrganization.contributorOptIns[8].organizationIdSha256; expect(() => validateManifest(duplicateOrganization, 12)).toThrow(/organizations.*unique/);
    expect(() => validateManifest({ ...gate12(), deliveryEmailLogStatus: "sent" }, 12)).toThrow(/persisted delivered/);
    expect(() => validateManifest({ ...gate12(), benchmarkAvailable: false }, 12)).toThrow(/suppression notice/);
    expect(() => validateManifest({ ...gate12(), attachmentCount: 0 }, 12)).toThrow(/exactly two persisted benchmark/);
    expect(() => validateManifest({ ...gate12(), deliveryEventType: "bounced" }, 12)).toThrow(/persisted delivered/);
  });
  it("rejects reversed evidence windows for every Phase 4 gate", () => { for (const [gate, build] of [[10, gate10], [11, gate11], [12, gate12]]) expect(() => validateManifest({ ...build(), sourceWindowStart: "2026-07-01T00:00:00Z", sourceWindowEnd: "2026-06-30T00:00:00Z" }, gate)).toThrow(/source window/); });
  it("rejects timezone-less and non-RFC3339 evidence timestamps", () => {
    expect(() => validateManifest({ ...gate10(), observedAt: "2026-08-06T12:00:00" }, 10)).toThrow(/timezone-qualified/);
    expect(() => validateManifest({ ...gate10(), observedAt: "2026-02-30T12:00:00Z" }, 10)).toThrow(/round-trip/);
    expect(() => validateManifest({ ...gate11(), experimentCompletedAt: "July 1, 2026 UTC" }, 11)).toThrow(/timezone-qualified/);
    expect(() => validateManifest({ ...gate11(), experimentCompletedAt: "2026-07-01T00:00:00.1234567Z" }, 11)).toThrow(/timezone-qualified/);
    expect(() => validateManifest({ ...gate12(), deliveredAt: "2026-07-02" }, 12)).toThrow(/timezone-qualified/);
  });
  it("requires independent one-shot switches and exact hashed targets", () => {
    const text = JSON.stringify(gate10()); const normalized = validatePolicy(policy(10));
    expect(authorize({ env: env(10, text), gate: 10, manifestText: text, policy: normalized })).toHaveProperty("workerOrigin", worker);
    expect(() => authorize({ env: { ...env(10), STAGING_GATE10_ACCEPTANCE_ENABLED: "false" }, gate: 10, manifestText: text, policy: normalized })).toThrow(/one-shot/);
    expect(() => authorize({ env: { ...env(10), STAGING_GATE10_ACCEPTANCE_MANIFEST_SHA256: "f".repeat(64) }, gate: 10, manifestText: text, policy: normalized })).toThrow(/protected manifest hash/);
    expect(() => authorize({ env: { ...env(10), SUPABASE_URL: "https://other.example" }, gate: 10, manifestText: text, policy: normalized })).toThrow(/hash/);
  });
  it("revalidates canonical refs before acceptance and evidence retention", async () => {
    const workflow = await readFile(new URL("../../.github/workflows/phase4-hosted-acceptance.yml", import.meta.url), "utf8");
    expect(workflow.split("git fetch --force --no-tags")).toHaveLength(3);
    expect(workflow).toContain("Canonical main or staging authority drifted after acceptance.");
    expect(workflow).toContain("Canonical ref refresh failed after acceptance.");
    expect(workflow).toContain('if [[ -n "$authority_error" ]]');
    expect(workflow).toContain('mv "$report" "$report.unretained"');
    expect(workflow).toContain(".passed = false");
  });
  it.each([[10, gate10], [11, gate11], [12, gate12]])("binds passing Gate %i evidence to exact runtime and never claims completion", async (gate, build) => {
    const manifest = build(); const manifestText = JSON.stringify(manifest); const policyText = JSON.stringify(policy(gate));
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).endsWith("/get_benchmark_delivery_attestation")) {
        expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { apikey: "service-role-key", authorization: "Bearer service-role-key" } });
        expect(JSON.parse(init.body)).toEqual({ p_organization_id: ids.organizationId, p_brand_id: ids.brandId, p_email_log_id: manifest.deliveryEmailLogId, p_delivery_event_id: manifest.deliveryEventId });
        return new Response(JSON.stringify(gate12Attestation(manifest)), { status: 200 });
      }
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      return new Response(JSON.stringify(String(url).endsWith("/configuration") ? { data: { database: { bindingHashes: { supabaseUrlSha256: sha256(supabase) } } } } : { data: { environment: "staging", service: "vinifera-api", status: "ok", revision } }), { status: 200 });
    });
    const report = await runAcceptance({ env: env(gate, manifestText), fetchImpl, manifestText, policyText, now: () => new Date("2026-08-06T12:00:00Z") });
    expect(report).toMatchObject({ gate, passed: true, completionClaimed: false, candidateRevision: revision, organizationId: ids.organizationId, brandId: ids.brandId, blockers: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(gate === 12 ? 4 : 3);
  });
  it("normalizes offset Gate 12 source instants to UTC database dates", async () => {
    const manifest = { ...gate12(), sourceWindowStart: "2026-03-31T20:00:00-04:00", sourceWindowEnd: "2026-04-30T19:59:59-04:00" };
    const manifestText = JSON.stringify(manifest);
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("/get_benchmark_delivery_attestation")) return new Response(JSON.stringify(gate12Attestation(manifest)));
      return new Response(JSON.stringify(String(url).endsWith("/configuration") ? { data: { database: { bindingHashes: { supabaseUrlSha256: sha256(supabase) } } } } : { data: { environment: "staging", service: "vinifera-api", status: "ok", revision } }));
    });
    await expect(runAcceptance({ env: env(12, manifestText), fetchImpl, manifestText, policyText: JSON.stringify(policy(12)), now: () => new Date("2026-08-06T12:00:00Z") })).resolves.toMatchObject({ gate: 12, passed: true });
  });
  it("rejects Gate 12 when the protected database attestation contradicts the manifest", async () => {
    const manifest = gate12(); const manifestText = JSON.stringify(manifest); const policyText = JSON.stringify(policy(12));
    const fetchImpl = async (url) => {
      if (String(url).endsWith("/get_benchmark_delivery_attestation")) return new Response(JSON.stringify({ ...gate12Attestation(manifest), benchmark_aggregate_id: "00000000-0000-4000-8000-000000000099" }));
      return new Response(JSON.stringify(String(url).endsWith("/configuration") ? { data: { database: { bindingHashes: { supabaseUrlSha256: sha256(supabase) } } } } : { data: { environment: "staging", service: "vinifera-api", status: "ok", revision } }));
    };
    await expect(runAcceptance({ env: env(12, manifestText), fetchImpl, manifestText, policyText, now: () => new Date("2026-08-06T12:00:00Z") })).rejects.toThrow(/database delivery attestation is not bound/);
  });
  it("rejects revision drift and Access redirects", async () => {
    const manifestText = JSON.stringify(gate10()); const policyText = JSON.stringify(policy(10));
    await expect(runAcceptance({ env: env(10, manifestText), manifestText, policyText, fetchImpl: async () => new Response(JSON.stringify({ data: { environment: "staging", service: "vinifera-api", status: "ok", revision: "f".repeat(40) } })) })).rejects.toThrow(/exact candidate/);
    let healthCalls = 0;
    const deploymentDrift = async (url) => { if (String(url).endsWith("/configuration")) return new Response(JSON.stringify({ data: { database: { bindingHashes: { supabaseUrlSha256: sha256(supabase) } } } })); healthCalls += 1; return new Response(JSON.stringify({ data: { environment: "staging", service: "vinifera-api", status: "ok", revision: healthCalls === 1 ? revision : "f".repeat(40) } })); };
    await expect(runAcceptance({ env: env(10, manifestText), manifestText, policyText, fetchImpl: deploymentDrift })).rejects.toThrow(/changed while database evidence/);
  });
  it("rejects reused manifests, runtime database drift, and future evidence", async () => {
    const base = gate11();
    const run = async (manifest, fetchImpl, now = () => new Date("2026-08-06T12:00:00Z")) => {
      const manifestText = JSON.stringify(manifest);
      return runAcceptance({ env: env(11, manifestText), manifestText, policyText: JSON.stringify(policy(11)), fetchImpl, now });
    };
    const healthy = async (url) => new Response(JSON.stringify(String(url).endsWith("/configuration") ? { data: { database: { bindingHashes: { supabaseUrlSha256: sha256(supabase) } } } } : { data: { environment: "staging", service: "vinifera-api", status: "ok", revision } }));
    await expect(run({ ...base, candidateRevision: "f".repeat(40) }, healthy)).rejects.toThrow(/manifest does not match/);
    await expect(run({ ...base, observedAt: "2099-02-02T00:00:00Z" }, healthy)).rejects.toThrow(/future-dated/);
    await expect(run({ ...base, observedAt: "2026-06-30T23:59:59Z" }, healthy)).rejects.toThrow(/source window closed|after its observation/);
    await expect(run({ ...base, driftSnapshotDate: "2026-07-29" }, healthy)).rejects.toThrow(/drift report.*stale/);
    await expect(run(base, async (url) => new Response(JSON.stringify(String(url).endsWith("/configuration") ? { data: { database: { bindingHashes: { supabaseUrlSha256: "f".repeat(64) } } } } : { data: { environment: "staging", service: "vinifera-api", status: "ok", revision } })))).rejects.toThrow(/database target differs/);
  });
  it("wires a main-only protected controller with 90-day sanitized artifacts", async () => {
    const workflow = await readFile(new URL("../../.github/workflows/phase4-hosted-acceptance.yml", import.meta.url), "utf8");
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain('origin/staging)" == "$CANDIDATE_REVISION"');
    expect(workflow).toContain("staging-acceptance-control");
    expect(workflow).toContain("STAGING_GATE10_ACCEPTANCE_ENABLED");
    expect(workflow).toContain("STAGING_GATE11_ACCEPTANCE_ENABLED");
    expect(workflow).toContain("STAGING_GATE12_ACCEPTANCE_ENABLED");
    expect(workflow).toContain("STAGING_GATE12_ACCEPTANCE_MANIFEST_SHA256");
    expect(workflow).toContain("STAGING_SUPABASE_SERVICE_ROLE_KEY");
    expect(workflow).toContain("retention-days: 90");
  });
});
