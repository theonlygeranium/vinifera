import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const POLICY_PATH = resolve(import.meta.dirname, "../config/phase4-hosted-acceptance-policy.json");
const APPROVED_ORIGIN = "https://vinifera-staging.edstratum-labs-staging.workers.dev";
const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const QUARTER = /^20[0-9]{2}-Q[1-4]$/u;
const MAX_BODY = 64 * 1024;
const METRICS = Object.freeze([
  "recognizedRevenueCents", "refundCents", "discountCents", "taxCents", "mrrCents", "arrCents",
  "arpmCents", "revenueChurnCents", "ltvCents", "averageTenureDays",
  "activeMembers", "newMembers", "pausedMembers", "declinedMembers", "recoveredMembers", "cancelledMembers",
  "memberGrowthNet", "cohortRetainedMembers", "releasedShipments", "fulfilledShipments", "failedShipments",
  "shipmentFulfillmentBps", "averageShipmentCents", "declineRateBps", "shippingCostRatioBps",
  "emailsDelivered", "emailsOpened", "emailsClicked", "emailUnsubscribes", "emailOpenRateBps", "emailClickRateBps",
  "portalSessions", "portalLoginsPerMemberBps", "loyaltyAwards", "loyaltyRedemptions", "loyaltyRedemptionRateBps",
  "cancellationAttempts", "retainedOutcomes",
]);
const CHART_EXPORTS = Object.freeze(["revenueByTier", "activeMembersOverTime", "memberTenureDistribution", "cohortRetention", "declineReasons"]);
const SOURCES = Object.freeze(["shipments", "billing", "email_delivery", "portal_activity", "loyalty", "declines"]);
const BOUNDED_BPS_METRICS = new Set([
  "shipmentFulfillmentBps",
  "declineRateBps",
  "emailOpenRateBps",
  "emailClickRateBps",
  "loyaltyRedemptionRateBps",
]);

function expect(value, message) { if (!value) throw new Error(message); }
function required(value, label) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(`${label} is required.`);
  return result;
}
export function sha256(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function uuid(value, label) { const result = required(value, label).toLowerCase(); expect(UUID.test(result), `${label} must be a UUID.`); return result; }
function integer(value, label, minimum = 0) { expect(Number.isSafeInteger(value) && value >= minimum, `${label} must be an integer >= ${minimum}.`); return value; }
function metricInteger(value, label, name) {
  if (name !== "memberGrowthNet") return integer(value, label);
  expect(Number.isSafeInteger(value), `${label} must be an integer.`);
  return value;
}
function instant(value, label) {
  const result = required(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(result);
  const parsed = Date.parse(result);
  expect(match && Number.isFinite(parsed), `${label} must be a timezone-qualified ISO/RFC3339 instant.`);
  const [, year, month, day, hour, minute, second, fraction = "", zone, sign, offsetHour = "00", offsetMinute = "00"] = match;
  const offsetMinutes = zone === "Z" ? 0 : (sign === "+" ? 1 : -1) * (Number(offsetHour) * 60 + Number(offsetMinute));
  expect(Number(offsetHour) <= 23 && Number(offsetMinute) <= 59 && Number(second) <= 59, `${label} must be a valid ISO/RFC3339 instant.`);
  const wall = new Date(parsed + offsetMinutes * 60_000);
  expect(
    wall.getUTCFullYear() === Number(year) && wall.getUTCMonth() + 1 === Number(month) && wall.getUTCDate() === Number(day)
      && wall.getUTCHours() === Number(hour) && wall.getUTCMinutes() === Number(minute) && wall.getUTCSeconds() === Number(second)
      && wall.getUTCMilliseconds() === Number(fraction.slice(0, 3).padEnd(3, "0")),
    `${label} must round-trip as a valid ISO/RFC3339 instant.`,
  );
  return result;
}
function calendarDate(value, label) {
  const result = required(value, label);
  const parsed = Date.parse(`${result}T00:00:00Z`);
  expect(
    /^\d{4}-\d{2}-\d{2}$/u.test(result) &&
      Number.isFinite(parsed) &&
      new Date(parsed).toISOString().slice(0, 10) === result,
    `${label} must be a valid ISO calendar date.`,
  );
  return result;
}
function hashList(value, label) {
  expect(Array.isArray(value) && value.every((item) => typeof item === "string" && SHA256.test(item)) && new Set(value).size === value.length, `${label} must contain unique SHA-256 values.`);
  return [...value];
}
function exactOrigin(value, label) {
  let url; try { url = new URL(required(value, label)); } catch { throw new Error(`${label} must be a canonical HTTPS origin.`); }
  expect(url.protocol === "https:" && !url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash, `${label} must be a canonical HTTPS origin.`);
  return url.origin;
}

export function validatePolicy(raw) {
  expect(raw?.schemaVersion === 1, "Phase 4 acceptance policy schema is invalid.");
  expect(Array.isArray(raw.enabledGates) && raw.enabledGates.every((gate) => [10, 11, 12].includes(gate)) && new Set(raw.enabledGates).size === raw.enabledGates.length, "enabledGates is invalid.");
  const policy = {
    schemaVersion: 1,
    enabledGates: [...raw.enabledGates],
    stagingWorkerOriginSha256: hashList(raw.stagingWorkerOriginSha256, "stagingWorkerOriginSha256"),
    stagingSupabaseUrlSha256: hashList(raw.stagingSupabaseUrlSha256, "stagingSupabaseUrlSha256"),
  };
  if (policy.enabledGates.length) {
    expect(policy.stagingWorkerOriginSha256.length === 1, "Enabled policy requires one Worker origin hash.");
    expect(policy.stagingSupabaseUrlSha256.length === 1, "Enabled policy requires one Supabase URL hash.");
  }
  return policy;
}

function commonManifest(raw, gate) {
  expect(raw?.schemaVersion === 1 && raw.gate === gate, `Gate ${gate} evidence manifest is invalid.`);
  const manifest = {
    candidateRevision: required(raw.candidateRevision, "candidateRevision").toLowerCase(),
    organizationId: uuid(raw.organizationId, "organizationId"),
    brandId: uuid(raw.brandId, "brandId"),
    observedAt: instant(raw.observedAt, "observedAt"),
    sourceWindowStart: instant(raw.sourceWindowStart, "sourceWindowStart"),
    sourceWindowEnd: instant(raw.sourceWindowEnd, "sourceWindowEnd"),
  };
  expect(Date.parse(manifest.sourceWindowEnd) > Date.parse(manifest.sourceWindowStart), `Gate ${gate} source window is invalid.`);
  return manifest;
}

function validateGate10(raw) {
  const base = commonManifest(raw, 10);
  const provenanceEvidenceSha256 = required(raw.provenanceEvidenceSha256, "provenanceEvidenceSha256");
  expect(raw.operationalProvenance === "active_winery_history" && raw.activeWinery === true && raw.syntheticDataAbsent === true && SHA256.test(provenanceEvidenceSha256), "Gate 10 requires hashed active-winery operational provenance with synthetic data excluded.");
  const metrics = {};
  for (const name of METRICS) {
    const row = raw.metrics?.[name];
    expect(row && typeof row === "object", `Gate 10 metric ${name} is missing.`);
    const source = metricInteger(row.source, `${name}.source`, name);
    const dashboard = metricInteger(row.dashboard, `${name}.dashboard`, name);
    const csv = metricInteger(row.csv, `${name}.csv`, name);
    if (BOUNDED_BPS_METRICS.has(name)) expect(source <= 10_000, `Gate 10 bounded proportion ${name} cannot exceed 10000 basis points.`);
    expect(source === dashboard && source === csv, `Gate 10 metric ${name} does not reconcile exactly.`);
    metrics[name] = { source, dashboard, csv };
  }
  expect(Object.keys(raw.metrics).length === METRICS.length, "Gate 10 manifest contains an unapproved metric set.");
  const chartExports = {};
  for (const chart of CHART_EXPORTS) {
    const row = raw.chartExports?.[chart];
    expect(row && typeof row === "object", `Gate 10 chart export ${chart} is missing.`);
    const sourceRowsSha256 = required(row.sourceRowsSha256, `${chart}.sourceRowsSha256`);
    const dashboardRowsSha256 = required(row.dashboardRowsSha256, `${chart}.dashboardRowsSha256`);
    const csvRowsSha256 = required(row.csvRowsSha256, `${chart}.csvRowsSha256`);
    expect([sourceRowsSha256, dashboardRowsSha256, csvRowsSha256].every((hash) => SHA256.test(hash)), `${chart} row digests must be lowercase SHA-256.`);
    expect(sourceRowsSha256 === dashboardRowsSha256 && sourceRowsSha256 === csvRowsSha256, `Gate 10 chart ${chart} does not reconcile exactly.`);
    chartExports[chart] = { sourceRowsSha256, dashboardRowsSha256, csvRowsSha256, rowCount: integer(row.rowCount, `${chart}.rowCount`, 1) };
  }
  expect(Object.keys(raw.chartExports).length === CHART_EXPORTS.length, "Gate 10 manifest contains an unapproved chart export set.");
  const csvExportSha256 = required(raw.csvExportSha256, "csvExportSha256");
  expect(SHA256.test(csvExportSha256), "csvExportSha256 must be lowercase SHA-256.");
  return { ...base, operationalProvenance: "active_winery_history", activeWinery: true, syntheticDataAbsent: true, provenanceEvidenceSha256, metrics, chartExports, sourceQueryVersion: required(raw.sourceQueryVersion, "sourceQueryVersion"), csvExportSha256, csvRowCount: integer(raw.csvRowCount, "csvRowCount", 1) };
}

function validateGate11(raw) {
  const base = commonManifest(raw, 11);
  const eligibleMembers = integer(raw.eligibleMembers, "eligibleMembers", 500);
  const cancellations = integer(raw.cancellations, "cancellations", 50);
  expect(cancellations <= eligibleMembers, "Gate 11 cancellations cannot exceed eligibleMembers.");
  const coverage = {};
  for (const source of SOURCES) {
    const row = raw.sourceCoverage?.[source];
    const eligible = integer(row?.eligibleMembers, `${source}.eligibleMembers`, 1);
    const reconciled = integer(row?.reconciledMembers, `${source}.reconciledMembers`, 0);
    expect(eligible === eligibleMembers && reconciled <= eligible && reconciled / eligible >= 0.95, `${source} must reconcile at least 95 percent of the exact denominator.`);
    coverage[source] = { eligibleMembers: eligible, reconciledMembers: reconciled };
  }
  const aucBps = integer(raw.heldOutAucBps, "heldOutAucBps", 8200);
  const rulesAucBps = integer(raw.rulesAucBps, "rulesAucBps");
  expect(aucBps <= 10_000 && rulesAucBps <= 10_000, "AUC basis points cannot exceed 10000.");
  expect(aucBps > rulesAucBps, "The candidate must outperform rules on the same holdout.");
  const modelAucBps = integer(raw.modelAucBps, "modelAucBps", 8200);
  expect(modelAucBps <= 10_000, "Model AUC basis points cannot exceed 10000.");
  expect(raw.modelDeploymentStatus === "ab_test", "Gate 11 requires the selected model to be in ab_test before promotion.");
  expect(raw.experimentStatus === "completed", "Gate 11 requires the exact experiment record to be completed.");
  const mlBrierBps = integer(raw.experimentMlBrierBps, "experimentMlBrierBps");
  const rulesBrierBps = integer(raw.experimentRulesBrierBps, "experimentRulesBrierBps");
  expect(mlBrierBps <= 10_000 && rulesBrierBps <= 10_000 && mlBrierBps < rulesBrierBps, "Gate 11 requires the exact completed experiment to outperform rules on Brier score.");
  const startedAt = instant(raw.experimentStartedAt, "experimentStartedAt");
  const completedAt = instant(raw.experimentCompletedAt, "experimentCompletedAt");
  expect(Date.parse(base.sourceWindowEnd) >= Date.parse(completedAt), "Gate 11 source reconciliation does not cover the completed outcome horizon.");
  const elapsedDays = (Date.parse(completedAt) - Date.parse(startedAt)) / 86_400_000;
  expect(elapsedDays >= 30, "Gate 11 requires at least 30 complete experiment days.");
  const firstCoverageDate = Date.parse(`${new Date(Date.parse(startedAt)).toISOString().slice(0, 10)}T00:00:00Z`);
  const finalCoverageDate = Date.parse(`${new Date(Date.parse(completedAt)).toISOString().slice(0, 10)}T00:00:00Z`);
  const coverageDayCount = (finalCoverageDate - firstCoverageDate) / 86_400_000 + 1;
  expect(Array.isArray(raw.dailyCoverage) && raw.dailyCoverage.length === coverageDayCount, "Gate 11 requires one coverage row for every UTC calendar date touched by the experiment.");
  const dailyCoverage = raw.dailyCoverage.map((row, index) => { const expectedDate = new Date(firstCoverageDate + index * 86_400_000).toISOString().slice(0, 10); expect(row?.date === expectedDate, "Gate 11 daily scoring coverage is not consecutive."); const eligibleActiveMembers = integer(row.eligibleActiveMembers, `dailyCoverage[${index}].eligibleActiveMembers`, 1); expect(integer(row.mlScoredMembers, `dailyCoverage[${index}].mlScoredMembers`) === eligibleActiveMembers && integer(row.rulesScoredMembers, `dailyCoverage[${index}].rulesScoredMembers`) === eligibleActiveMembers && integer(row.immutableAssignments, `dailyCoverage[${index}].immutableAssignments`) === eligibleActiveMembers, `Gate 11 day ${expectedDate} did not score and assign every eligible member.`); return { date: expectedDate, eligibleActiveMembers, mlScoredMembers: eligibleActiveMembers, rulesScoredMembers: eligibleActiveMembers, immutableAssignments: eligibleActiveMembers }; });
  const minimumRequiredOutcomes = integer(raw.minimumRequiredOutcomes, "minimumRequiredOutcomes", 50); const experimentEvaluatedOutcomes = integer(raw.experimentEvaluatedOutcomes, "experimentEvaluatedOutcomes", minimumRequiredOutcomes); const powerAnalysisSha256 = required(raw.powerAnalysisSha256, "powerAnalysisSha256"); expect(SHA256.test(powerAnalysisSha256) && raw.statisticalSufficiencyReviewed === true, "Gate 11 requires reviewed statistical-sufficiency evidence.");
  expect(raw.superior === true, "Gate 11 requires a superior completed experiment with sufficient outcomes.");
  expect(raw.actorActive === true && raw.actorPlatformSuperAdmin === true, "Gate 11 requires a dedicated active platform actor.");
  expect(raw.qualificationDryRunPassed === true && raw.qualificationExecuted === true, "Gate 11 requires dry-run and executed qualification evidence.");
  expect(raw.provenance === "production_history", "Gate 11 requires production_history provenance.");
  const datasetHash = required(raw.datasetHash, "datasetHash");
  expect(SHA256.test(datasetHash), "datasetHash must be lowercase SHA-256.");
  const trainingRunId = uuid(raw.trainingRunId, "trainingRunId");
  const qualificationTrainingRunId = uuid(raw.qualificationTrainingRunId, "qualificationTrainingRunId");
  const qualificationDatasetHash = required(raw.qualificationDatasetHash, "qualificationDatasetHash");
  const qualificationEvidenceSha256 = required(raw.qualificationEvidenceSha256, "qualificationEvidenceSha256");
  const qualificationEvidencePayload = required(raw.qualificationEvidencePayload, "qualificationEvidencePayload");
  let qualificationEvidence;
  try { qualificationEvidence = JSON.parse(qualificationEvidencePayload); } catch { throw new Error("Gate 11 qualification evidence payload is invalid JSON."); }
  const qualificationCoverage = qualificationEvidence?.source_coverage;
  const qualificationSources = qualificationCoverage?.sources;
  const reconciledThrough = calendarDate(qualificationCoverage?.reconciled_through, "qualificationEvidence.source_coverage.reconciled_through");
  const qualificationCoverageMatches = qualificationCoverage?.eligible_member_count === eligibleMembers && reconciledThrough === new Date(Date.parse(base.sourceWindowEnd)).toISOString().slice(0, 10) && qualificationSources && typeof qualificationSources === "object" && !Array.isArray(qualificationSources) && Object.keys(qualificationCoverage).sort().join(",") === "eligible_member_count,reconciled_through,sources" && Object.keys(qualificationSources).sort().join(",") === [...SOURCES].sort().join(",") && SOURCES.every((source) => qualificationSources[source]?.eligible_member_count === coverage[source].eligibleMembers && qualificationSources[source]?.reconciled_member_count === coverage[source].reconciledMembers && Object.keys(qualificationSources[source]).sort().join(",") === "eligible_member_count,reconciled_member_count");
  expect(qualificationTrainingRunId === trainingRunId && qualificationDatasetHash === datasetHash && SHA256.test(qualificationDatasetHash) && SHA256.test(qualificationEvidenceSha256) && raw.qualificationStatus === "qualified" && qualificationEvidenceSha256 === sha256(qualificationEvidencePayload) && qualificationEvidence?.training_run_id === trainingRunId && qualificationEvidence?.dataset_hash === datasetHash && qualificationEvidence?.status === "qualified" && qualificationCoverageMatches && Object.keys(qualificationEvidence).sort().join(",") === "dataset_hash,source_coverage,status,training_run_id", "Gate 11 database qualification evidence is not cryptographically bound to the same qualified training run, dataset, status, six-source coverage, denominator, and reconciliation horizon.");
  const modelVersionId = uuid(raw.modelVersionId, "modelVersionId");
  const experimentId = uuid(raw.experimentId, "experimentId");
  const promotionAuditId = uuid(raw.promotionAuditId, "promotionAuditId");
  expect(uuid(raw.experimentTrainingRunId, "experimentTrainingRunId") === trainingRunId && uuid(raw.experimentModelVersionId, "experimentModelVersionId") === modelVersionId, "Gate 11 experiment is not bound to the qualified training run and model version.");
  expect(uuid(raw.promotionAuditTrainingRunId, "promotionAuditTrainingRunId") === trainingRunId && uuid(raw.promotionAuditModelVersionId, "promotionAuditModelVersionId") === modelVersionId && uuid(raw.promotionAuditExperimentId, "promotionAuditExperimentId") === experimentId, "Gate 11 promotion audit is not bound to the same training run, model version, and experiment.");
  const driftReportId = uuid(raw.driftReportId, "driftReportId");
  const driftSnapshotDate = calendarDate(raw.driftSnapshotDate, "driftSnapshotDate");
  expect(uuid(raw.driftModelVersionId, "driftModelVersionId") === modelVersionId && raw.driftRetrainingRequired === false && raw.driftIsLatestForModel === true, "Gate 11 requires the latest non-retraining drift report for the exact model version.");
  return { ...base, actorUserId: uuid(raw.actorUserId, "actorUserId"), actorActive: true, actorPlatformSuperAdmin: true, trainingRunId, modelVersionId, modelDeploymentStatus: "ab_test", modelAucBps, experimentId, experimentStatus: "completed", promotionAuditId, datasetHash, provenance: "production_history", qualificationDryRunPassed: true, qualificationExecuted: true, qualificationTrainingRunId, qualificationDatasetHash, qualificationEvidenceSha256, qualificationStatus: "qualified", eligibleMembers, cancellations, sourceCoverage: coverage, heldOutAucBps: aucBps, rulesAucBps, experimentMlBrierBps: mlBrierBps, experimentRulesBrierBps: rulesBrierBps, experimentStartedAt: startedAt, experimentCompletedAt: completedAt, elapsedDays, coverageDayCount, dailyCoverage, experimentEvaluatedOutcomes, minimumRequiredOutcomes, powerAnalysisSha256, statisticalSufficiencyReviewed: true, driftReportId, driftSnapshotDate, driftRetrainingRequired: false, driftIsLatestForModel: true, superior: true };
}

function validateGate12(raw) {
  const base = commonManifest(raw, 12);
  expect(["estate", "reserve"].includes(raw.tier), "Gate 12 requires an Estate or Reserve winery.");
  expect(raw.optedIn === true, "Gate 12 requires explicit benchmark opt-in.");
  expect(raw.suppressionVerified === true && raw.differencingAttackDenied === true, "Gate 12 privacy controls are not proven.");
  const deliveredAt = instant(raw.deliveredAt, "deliveredAt");
  const cohortId = uuid(raw.cohortId, "cohortId");
  const contributorCount = integer(raw.contributorCount, "contributorCount", 10);
  expect(Array.isArray(raw.contributorOptIns) && raw.contributorOptIns.length === contributorCount, "Gate 12 requires one opt-in attestation for every contributor.");
  const contributorOptIns = raw.contributorOptIns.map((row, index) => {
    expect(row?.cohortId === cohortId && row?.optedIn === true, `Gate 12 contributor ${index} is not opted into the exact cohort.`);
    expect(row?.entitled === true && ["estate", "reserve"].includes(row?.tier), `Gate 12 contributor ${index} is not entitled at an Estate or Reserve tier.`);
    const brandIdSha256 = required(row.brandIdSha256, `contributorOptIns[${index}].brandIdSha256`);
    const organizationIdSha256 = required(row.organizationIdSha256, `contributorOptIns[${index}].organizationIdSha256`);
    const ownerOptInAuditSha256 = required(row.ownerOptInAuditSha256, `contributorOptIns[${index}].ownerOptInAuditSha256`);
    expect(SHA256.test(brandIdSha256) && SHA256.test(organizationIdSha256) && SHA256.test(ownerOptInAuditSha256), `Gate 12 contributor ${index} opt-in hashes are invalid.`);
    return { cohortId, organizationIdSha256, brandIdSha256, ownerOptInAuditSha256, tier: row.tier, entitled: true, optedIn: true };
  });
  expect(new Set(contributorOptIns.map((row) => row.organizationIdSha256)).size === contributorCount && new Set(contributorOptIns.map((row) => row.ownerOptInAuditSha256)).size === contributorCount, "Gate 12 contributor organizations and opt-in attestations must be unique.");
  expect(contributorOptIns.some((row) => row.organizationIdSha256 === sha256(base.organizationId) && row.brandIdSha256 === sha256(base.brandId)), "Gate 12 selected winery is absent from the cohort opt-in attestations.");
  expect(Date.parse(deliveredAt) >= Date.parse(base.sourceWindowEnd), "Quarterly delivery predates the source window end.");
  expect(Date.parse(deliveredAt) <= Date.parse(base.observedAt), "Quarterly delivery occurs after the observation time.");
  const sourceStart = new Date(base.sourceWindowStart);
  const sourceEnd = new Date(base.sourceWindowEnd);
  const expectedQuarter = `${sourceEnd.getUTCFullYear()}-Q${Math.floor(sourceEnd.getUTCMonth() / 3) + 1}`;
  const startQuarter = `${sourceStart.getUTCFullYear()}-Q${Math.floor(sourceStart.getUTCMonth() / 3) + 1}`;
  expect(raw.reportQuarter === expectedQuarter && startQuarter === expectedQuarter, "reportQuarter does not bound the entire source window.");
  const reportQuarter = QUARTER.test(raw.reportQuarter) ? raw.reportQuarter : (() => { throw new Error("reportQuarter is invalid."); })();
  const exactMonthStart = Date.UTC(sourceStart.getUTCFullYear(), sourceStart.getUTCMonth(), 1);
  const exactMonthEnd = Date.UTC(sourceStart.getUTCFullYear(), sourceStart.getUTCMonth() + 1, 1) - 1_000;
  const quarterNumber = Number(reportQuarter.slice(-1));
  const canonicalQuarterStart = Date.UTC(Number(reportQuarter.slice(0, 4)), (quarterNumber - 1) * 3, 1);
  expect(
    sourceStart.getTime() === exactMonthStart && sourceEnd.getTime() === exactMonthEnd && exactMonthStart === canonicalQuarterStart,
    "Gate 12 source window must describe the exact quarter-start benchmark month.",
  );
  const reportId = uuid(raw.reportId, "reportId");
  const deliveryProviderMessageId = required(raw.deliveryProviderMessageId, "deliveryProviderMessageId");
  const deliveryEmailLogId = uuid(raw.deliveryEmailLogId, "deliveryEmailLogId");
  const deliveryEventId = uuid(raw.deliveryEventId, "deliveryEventId");
  const deliveryProviderEventId = required(raw.deliveryProviderEventId, "deliveryProviderEventId");
  expect(raw.deliveryEmailLogStatus === "delivered" && raw.deliveryEventType === "delivered", "Gate 12 requires a persisted delivered email log and delivered provider event.");
  expect(raw.benchmarkAvailable === true, "Gate 12 requires an available generated benchmark, not a suppression notice.");
  const benchmarkContributionId = uuid(raw.benchmarkContributionId, "benchmarkContributionId");
  const benchmarkAggregateId = uuid(raw.benchmarkAggregateId, "benchmarkAggregateId");
  const benchmarkAggregateSha256 = required(raw.benchmarkAggregateSha256, "benchmarkAggregateSha256");
  const persistedReportContentSha256 = required(raw.persistedReportContentSha256, "persistedReportContentSha256");
  const pdfAttachmentSha256 = required(raw.pdfAttachmentSha256, "pdfAttachmentSha256");
  const csvAttachmentSha256 = required(raw.csvAttachmentSha256, "csvAttachmentSha256");
  expect(
    raw.attachmentCount === 2 &&
      [benchmarkAggregateSha256, persistedReportContentSha256, pdfAttachmentSha256, csvAttachmentSha256].every((hash) => SHA256.test(hash)),
    "Gate 12 requires the selected aggregate plus exactly two persisted benchmark attachment/content digests.",
  );
  return { ...base, tier: raw.tier, optedIn: true, cohortId, contributorCount, contributorOptIns, reportQuarter, reportId, benchmarkContributionId, benchmarkAggregateId, benchmarkAggregateSha256, persistedReportContentSha256, pdfAttachmentSha256, csvAttachmentSha256, attachmentCount: 2, deliveryProviderMessageId, deliveryEmailLogId, deliveryEventId, deliveryProviderEventId, deliveredAt, suppressionVerified: true, differencingAttackDenied: true };
}

export function validateManifest(raw, gate) {
  if (gate === 10) return validateGate10(raw);
  if (gate === 11) return validateGate11(raw);
  if (gate === 12) return validateGate12(raw);
  throw new Error("Phase 4 hosted acceptance supports only Gates 10, 11, and 12.");
}

export function authorize({ env, gate, manifestText, policy }) {
  expect(policy.enabledGates.includes(gate), `Gate ${gate} policy is disabled.`);
  expect(env[`STAGING_GATE${gate}_ACCEPTANCE_ENABLED`] === "true", `Gate ${gate} one-shot switch is disabled.`);
  expect(env.GATE_ACCEPTANCE_CONFIRMATION === `RUN VINIFERA GATE ${gate} HOSTED ACCEPTANCE`, `Gate ${gate} exact confirmation is required.`);
  const workerOrigin = exactOrigin(env.STAGING_WORKER_ORIGIN, "STAGING_WORKER_ORIGIN");
  expect(workerOrigin === APPROVED_ORIGIN, "Worker origin is not the isolated staging target.");
  const supabaseUrl = exactOrigin(env.SUPABASE_URL, "SUPABASE_URL");
  expect(policy.stagingWorkerOriginSha256.includes(sha256(workerOrigin)), "Worker origin hash is unauthorized.");
  expect(policy.stagingSupabaseUrlSha256.includes(sha256(supabaseUrl)), "Supabase target hash is unauthorized.");
  const manifestSha256 = required(env[`STAGING_GATE${gate}_ACCEPTANCE_MANIFEST_SHA256`], `STAGING_GATE${gate}_ACCEPTANCE_MANIFEST_SHA256`);
  expect(SHA256.test(manifestSha256) && manifestSha256 === sha256(manifestText), `Gate ${gate} protected manifest hash is unauthorized.`);
  return { workerOrigin, supabaseUrl };
}

async function boundedHealth(fetchImpl, origin, accessId, accessSecret) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${origin}/api/health`, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "application/json", "CF-Access-Client-Id": required(accessId, "CF_ACCESS_CLIENT_ID"), "CF-Access-Client-Secret": required(accessSecret, "CF_ACCESS_CLIENT_SECRET") } });
    expect(response.ok, "Staging health probe failed.");
    const text = await response.text(); expect(Buffer.byteLength(text) <= MAX_BODY, "Staging health response is oversized.");
    return JSON.parse(text)?.data;
  } finally { clearTimeout(timer); }
}

async function runtimeDatabaseHash(fetchImpl, origin, accessId, accessSecret) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${origin}/api/health/configuration`, { method: "GET", redirect: "error", signal: controller.signal, headers: { accept: "application/json", "CF-Access-Client-Id": required(accessId, "CF_ACCESS_CLIENT_ID"), "CF-Access-Client-Secret": required(accessSecret, "CF_ACCESS_CLIENT_SECRET") } });
    expect(response.ok, "Staging configuration probe failed.");
    const text = await response.text(); expect(Buffer.byteLength(text) <= MAX_BODY, "Staging configuration response is oversized.");
    const hash = JSON.parse(text)?.data?.database?.bindingHashes?.supabaseUrlSha256;
    expect(typeof hash === "string" && SHA256.test(hash), "Staging runtime did not report its database target hash.");
    return hash;
  } finally { clearTimeout(timer); }
}

async function benchmarkDeliveryAttestation(fetchImpl, supabaseUrl, serviceRoleKey, manifest) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/get_benchmark_delivery_attestation`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { accept: "application/json", apikey: required(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"), authorization: `Bearer ${required(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ p_organization_id: manifest.organizationId, p_brand_id: manifest.brandId, p_email_log_id: manifest.deliveryEmailLogId, p_delivery_event_id: manifest.deliveryEventId }),
    });
    expect(response.ok, "Gate 12 protected database delivery attestation failed.");
    const text = await response.text(); expect(Buffer.byteLength(text) <= MAX_BODY, "Gate 12 database attestation response is oversized.");
    let attestation;
    try { attestation = JSON.parse(text); } catch { throw new Error("Gate 12 database attestation is invalid JSON."); }
    if (Array.isArray(attestation)) attestation = attestation[0];
    const deliveredAt = instant(attestation?.delivered_at, "databaseAttestation.delivered_at");
    const expectedStart = new Date(Date.parse(manifest.sourceWindowStart)).toISOString().slice(0, 10);
    const expectedEnd = new Date(Date.parse(manifest.sourceWindowEnd)).toISOString().slice(0, 10);
    const exact = attestation?.organization_id === manifest.organizationId && attestation?.brand_id === manifest.brandId && attestation?.cohort_id === manifest.cohortId && attestation?.report_id === manifest.reportId && attestation?.report_type === "quarterly_benchmark" && attestation?.source_window_start === expectedStart && attestation?.source_window_end === expectedEnd && attestation?.benchmark_available === true && attestation?.benchmark_contribution_id === manifest.benchmarkContributionId && attestation?.benchmark_aggregate_id === manifest.benchmarkAggregateId && attestation?.benchmark_aggregate_sha256 === manifest.benchmarkAggregateSha256 && attestation?.persisted_report_content_sha256 === manifest.persistedReportContentSha256 && attestation?.attachment_count === 2 && attestation?.pdf_attachment_sha256 === manifest.pdfAttachmentSha256 && attestation?.csv_attachment_sha256 === manifest.csvAttachmentSha256 && attestation?.email_log_id === manifest.deliveryEmailLogId && attestation?.email_log_status === "delivered" && attestation?.delivery_event_id === manifest.deliveryEventId && attestation?.delivery_event_type === "delivered" && attestation?.provider_event_id === manifest.deliveryProviderEventId && attestation?.provider_message_id === manifest.deliveryProviderMessageId && Date.parse(deliveredAt) === Date.parse(manifest.deliveredAt);
    expect(exact && [attestation.benchmark_aggregate_sha256, attestation.persisted_report_content_sha256, attestation.pdf_attachment_sha256, attestation.csv_attachment_sha256].every((hash) => SHA256.test(hash)), "Gate 12 database delivery attestation is not bound to the selected organization, brand, cohort, aggregate, stored content, attachments, and confirmed provider delivery.");
    return { attestation, sha256: sha256(text) };
  } finally { clearTimeout(timer); }
}

export async function runAcceptance({ env = process.env, fetchImpl = fetch, now = () => new Date(), policyText, manifestText }) {
  const gate = Number(env.GATE_NUMBER);
  expect([10, 11, 12].includes(gate), "GATE_NUMBER must be 10, 11, or 12.");
  const policy = validatePolicy(JSON.parse(policyText));
  const manifest = validateManifest(JSON.parse(manifestText), gate);
  const targets = authorize({ env, gate, manifestText, policy });
  const revision = required(env.GATE_CANDIDATE_REVISION, "GATE_CANDIDATE_REVISION").toLowerCase();
  expect(SHA.test(revision), "Candidate revision is invalid.");
  expect(manifest.candidateRevision === revision, "Evidence manifest does not match the candidate revision.");
  const capturedAt = now();
  expect(Date.parse(manifest.observedAt) <= capturedAt.getTime(), "Evidence observation is future-dated.");
  expect(Date.parse(manifest.sourceWindowEnd) <= Date.parse(manifest.observedAt), "Evidence was observed before its source window closed.");
  if (gate === 11) expect(Date.parse(manifest.experimentCompletedAt) <= capturedAt.getTime(), "Gate 11 experiment completion is future-dated.");
  if (gate === 11) expect(Date.parse(manifest.experimentCompletedAt) <= Date.parse(manifest.observedAt), "Gate 11 experiment completed after its observation.");
  if (gate === 11) {
    const capturedDate = Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), capturedAt.getUTCDate());
    const driftDate = Date.parse(`${manifest.driftSnapshotDate}T00:00:00Z`);
    expect(driftDate <= capturedDate && driftDate >= capturedDate - 7 * 86_400_000, "Gate 11 drift report is future-dated or stale for the database promotion gate.");
  }
  if (gate === 12) expect(Date.parse(manifest.deliveredAt) <= capturedAt.getTime(), "Gate 12 delivery is future-dated.");
  expect(SHA.test(required(env.GATE_CONTROL_SHA, "GATE_CONTROL_SHA")) && env.GATE_CONTROL_SHA === env.GITHUB_SHA, "Control SHA is not the immutable workflow revision.");
  const health = await boundedHealth(fetchImpl, targets.workerOrigin, env.CF_ACCESS_CLIENT_ID, env.CF_ACCESS_CLIENT_SECRET);
  expect(health?.environment === "staging" && health?.service === "vinifera-api" && health?.status === "ok" && health?.revision === revision, "Staging runtime does not match the exact candidate.");
  const runtimeSupabaseHash = await runtimeDatabaseHash(fetchImpl, targets.workerOrigin, env.CF_ACCESS_CLIENT_ID, env.CF_ACCESS_CLIENT_SECRET);
  expect(runtimeSupabaseHash === sha256(targets.supabaseUrl), "Staging Worker database target differs from the authorized Supabase target.");
  const deliveryAttestation = gate === 12
    ? await benchmarkDeliveryAttestation(fetchImpl, targets.supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, manifest)
    : null;
  const finalHealth = await boundedHealth(fetchImpl, targets.workerOrigin, env.CF_ACCESS_CLIENT_ID, env.CF_ACCESS_CLIENT_SECRET);
  expect(finalHealth?.environment === "staging" && finalHealth?.service === "vinifera-api" && finalHealth?.status === "ok" && finalHealth?.revision === revision, "Staging runtime changed while database evidence was collected.");
  return { schemaVersion: 1, gate, passed: true, completionClaimed: false, evidenceLevel: "hosted-provider-acceptance", capturedAt: capturedAt.toISOString(), candidateRevision: revision, controlSha: env.GATE_CONTROL_SHA, organizationId: manifest.organizationId, brandId: manifest.brandId, sourceWindow: { start: manifest.sourceWindowStart, end: manifest.sourceWindowEnd }, evidenceManifestSha256: sha256(manifestText), policySha256: sha256(policyText), targetHashes: { workerOriginSha256: sha256(targets.workerOrigin), supabaseUrlSha256: runtimeSupabaseHash }, checks: gate === 10 ? { allMetricsAndCsvExact: true, metricCount: METRICS.length, chartExportCount: CHART_EXPORTS.length, csvRowCount: manifest.csvRowCount } : gate === 11 ? { actorAudited: true, qualificationEvidenceSha256: manifest.qualificationEvidenceSha256, eligibleMembers: manifest.eligibleMembers, cancellations: manifest.cancellations, sixSourceFamiliesReconciled: true, modelAucBps: manifest.modelAucBps, experimentMlAucBps: manifest.heldOutAucBps, experimentRulesAucBps: manifest.rulesAucBps, experimentMlBrierBps: manifest.experimentMlBrierBps, experimentRulesBrierBps: manifest.experimentRulesBrierBps, experimentElapsedDays: manifest.elapsedDays, driftReportId: manifest.driftReportId, driftSnapshotDate: manifest.driftSnapshotDate, superior: true } : { entitledAndOptedIn: true, allContributorsEntitled: true, contributorCount: manifest.contributorCount, privacyThresholdAndDifferencing: true, confirmedDeliveryEventId: manifest.deliveryEventId, databaseDeliveryAttestationSha256: deliveryAttestation.sha256, quarterlyDelivery: true }, blockers: [] };
}

async function main() {
  const outputIndex = process.argv.indexOf("--output");
  const output = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : "phase4-hosted-acceptance.json");
  const gate = Number(process.env.GATE_NUMBER);
  const manifestText = required(process.env[`STAGING_GATE${gate}_ACCEPTANCE_MANIFEST`], `STAGING_GATE${gate}_ACCEPTANCE_MANIFEST`);
  const policyText = await readFile(POLICY_PATH, "utf8");
  const report = await runAcceptance({ policyText, manifestText });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Gate ${gate} hosted acceptance passed; completion claimed: false\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`Phase 4 hosted acceptance failed: ${error.message}\n`); process.exitCode = 1; });
