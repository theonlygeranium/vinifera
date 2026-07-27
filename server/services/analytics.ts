import type { SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import { getConfigurationReport } from "../config";
import { encodeCsvRows } from "../lib/csv";
import { AppError } from "../lib/errors";
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { assertUuid, camelKey, numeric, sha256 } from "../lib/utils";
import {
  ANALYTICS_EVENT_TYPES,
  analyticsEventIdempotencyKey,
} from "../lib/analytics-events";
import type {
  AnalyticsRange,
  AnalyticsService,
  ComplianceStatus,
  StaffPrincipal,
  WorkerEnv,
} from "../types";
import {
  benchmarkSuppressionGuidance,
  createBenchmarkReportArtifact,
  type BenchmarkReportMetric,
} from "./benchmark-report";
import {
  decodeMlTrainingDatasetRow,
  trainTemporalLogisticModel,
} from "./ml-training";
import { ProductionRetentionService } from "./retention";

const NIGHTLY_ANALYTICS_UTC_HOUR = 9;
const MINIMUM_PRODUCTION_AUC = 0.82;
const MAX_ANALYTICS_EVENT_BYTES = 4_096;
const MAX_ANALYTICS_EVENT_FIELDS = 24;
const REPORT_WIDGETS = new Set([
  "revenue-by-tier",
  "member-growth",
  "member-cohorts",
  "ltv-by-tier",
  "shipment-operations",
  "engagement",
  "acquisition",
]);
const WIDGET_SIZES = new Set(["half", "full"]);
const PROHIBITED_ANALYTICS_KEYS =
  /(?:address|authorization|birthday|card|credential|dob|email|first.?name|ip(?:.?address)?|last.?name|name|password|phone|postal|secret|token)/i;
const AVAILABLE_WIDGETS = [
  { category: "revenue", defaultSize: "half", id: "revenue-by-tier", title: "Revenue by tier" },
  { category: "members", defaultSize: "half", id: "member-growth", title: "Member growth" },
  { category: "members", defaultSize: "full", id: "member-cohorts", title: "Member cohorts" },
  { category: "members", defaultSize: "half", id: "ltv-by-tier", title: "Lifetime value by tier" },
  { category: "shipments", defaultSize: "full", id: "shipment-operations", title: "Shipment operations" },
  { category: "engagement", defaultSize: "half", id: "engagement", title: "Engagement" },
  { category: "growth", defaultSize: "half", id: "acquisition", title: "Acquisition" },
] as const;
const DEFAULT_DASHBOARD_LAYOUT = AVAILABLE_WIDGETS.map((widget, order) => ({
  enabled: true,
  id: widget.id,
  order,
  size: widget.defaultSize,
}));

interface ResolvedAnalyticsRange {
  from: string | null;
  preset: AnalyticsRange;
  to: string;
}

interface DueBenchmarkReport {
  benchmark_available: boolean;
  organization_id: string;
  organization_name: string;
  period: string;
  peer_group?: Record<string, unknown> | null;
  peer_group_label?: string | null;
  recipient_email: string;
  sample_count_band?: string | null;
  schedule_id: string;
  staff_user_id: string;
}

function databaseError(message: string): AppError {
  return new AppError(500, "upstream_error", message);
}

function toPublicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPublicValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (
      /(?:access_token|api_key|api_secret|lease_token|provider_payload|raw_payload|secret)/i.test(
        key,
      )
    ) {
      continue;
    }
    result[camelKey(key)] = toPublicValue(nested);
  }
  return result;
}

function toPublicRecord(value: unknown): Record<string, unknown> {
  return (toPublicValue(value) ?? {}) as Record<string, unknown>;
}

function rpcRow(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : null;
}

function canonicalizeArtifactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeArtifactValue);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalizeArtifactValue(nested)]),
  );
}

export async function mlArtifactHash(
  immutableArtifact: Record<string, unknown>,
): Promise<string> {
  return sha256(JSON.stringify(canonicalizeArtifactValue(immutableArtifact)));
}

function benchmarkMetrics(value: unknown): BenchmarkReportMetric[] {
  const record = rpcRow(value) ?? {};
  const rows = Array.isArray(record.metrics) ? record.metrics : [];
  return rows
    .filter(
      (metric): metric is Record<string, unknown> =>
        Boolean(metric) && typeof metric === "object" && !Array.isArray(metric),
    )
    .map((metric) => {
      const id = String(metric.id ?? metric.key ?? "");
      const expectedUnit = BENCHMARK_METRIC_LABELS[id]?.unit;
      return {
      id,
      kAnonymous:
        metric.k_anonymous === true || metric.kAnonymous === true,
      label: String(
        metric.label ??
          BENCHMARK_METRIC_LABELS[id]?.label ??
          metric.id ??
          metric.key ??
          "Metric",
      ),
      organizationValue: Number(
        metric.organization_value ?? metric.organizationValue,
      ),
      peerMedian: Number(metric.peer_median ?? metric.peerMedian),
      peerP25: Number(metric.peer_p25 ?? metric.peerP25),
      peerP75: Number(metric.peer_p75 ?? metric.peerP75),
      percentile: Number(metric.percentile),
      sampleCountBand: String(
        metric.sample_count_band ?? metric.sampleCountBand ?? "",
      ),
      unit:
        metric.unit === "currency_cents" ||
        metric.unit === "cents" ||
        metric.unit === "percent" ||
        metric.unit === "ratio"
          ? metric.unit === "cents"
            ? "currency_cents"
            : metric.unit === "ratio" && expectedUnit === "percent"
              ? "percent"
              : metric.unit
          : "count",
      };
    });
}

function benchmarkPeriod(value: string): {
  end: string;
  label: string;
  start: string;
} {
  const start = parseDateOnly(value.slice(0, 10), "Benchmark period");
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 3);
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    end: dateOnly(end),
    label: `${start.getUTCFullYear()}-Q${Math.floor(start.getUTCMonth() / 3) + 1}`,
    start: dateOnly(start),
  };
}

export function priorQuarterStart(asOf: Date): string {
  const start = new Date(
    Date.UTC(
      asOf.getUTCFullYear(),
      Math.floor(asOf.getUTCMonth() / 3) * 3,
      1,
    ),
  );
  start.setUTCMonth(start.getUTCMonth() - 3);
  return dateOnly(start);
}

function benchmarkPeerGroupLabel(due: DueBenchmarkReport): string {
  if (due.peer_group_label?.trim()) return due.peer_group_label.trim();
  const group = objectValue(due.peer_group);
  const labels = [
    group.regionGroup ?? group.region_group,
    group.tierDistributionBand ?? group.tier_distribution_band,
    group.memberCountBand ?? group.member_count_band,
  ]
    .map(String)
    .filter((value) => value && value !== "*" && value !== "undefined");
  return labels.join(" | ") || "Comparable wine clubs";
}

const BENCHMARK_METRIC_LABELS: Record<
  string,
  { label: string; unit: "count" | "currency_cents" | "percent" | "ratio" }
> = {
  average_shipment_value_cents: {
    label: "Average shipment value",
    unit: "currency_cents",
  },
  decline_rate: { label: "Payment decline rate", unit: "percent" },
  email_engagement_rate: { label: "Email engagement", unit: "percent" },
  mrr_growth_rate: { label: "MRR growth", unit: "percent" },
  retention_rate: { label: "Member retention", unit: "percent" },
};

export function normalizeBenchmarkComparison(
  value: unknown,
  input: {
    optedIn: boolean;
    period: string;
    quarterlyReport: Record<string, unknown>;
    subscriptionTier: string;
  },
): Record<string, unknown> {
  const payload = toPublicRecord(rpcRow(value) ?? value);
  const rawMetrics = objectValue(payload.organizationMetrics);
  const rawPercentiles = objectValue(payload.peerPercentiles);
  const canonicalMetrics = objectRows(payload.metrics);
  const metrics = canonicalMetrics.length
    ? canonicalMetrics.map((metric) => {
        const id = String(metric.id ?? metric.key ?? "");
        const definition = BENCHMARK_METRIC_LABELS[id] ?? {
          label: id.replaceAll("_", " "),
          unit: "ratio" as const,
        };
        return {
          ...metric,
          id,
          label: metric.label ?? definition.label,
          sampleCountBand:
            metric.sampleCountBand ?? payload.sampleCountBand ?? null,
          unit:
            metric.unit === "currency_cents"
              ? "cents"
              : metric.unit === "ratio" && definition.unit === "percent"
                ? "percent"
                : metric.unit ?? definition.unit,
        };
      })
    : Object.keys(rawPercentiles).map((id) => {
        const peer = objectValue(rawPercentiles[id]);
        const definition = BENCHMARK_METRIC_LABELS[id] ?? {
          label: id.replaceAll("_", " "),
          unit: "ratio" as const,
        };
        return {
          id,
          kAnonymous: payload.kAnonymous === true,
          label: definition.label,
          organizationValue: numeric(rawMetrics[id], Number.NaN),
          peerMedian: numeric(peer.median, Number.NaN),
          peerP25: numeric(peer.p25, Number.NaN),
          peerP75: numeric(peer.p75, Number.NaN),
          percentile: null,
          sampleCountBand: payload.sampleCountBand ?? null,
          unit: definition.unit,
        };
      });
  return {
    eligible:
      input.subscriptionTier === "estate" ||
      input.subscriptionTier === "reserve",
    generatedAt: payload.generatedAt ?? null,
    guidance: payload.guidance ?? null,
    metrics,
    minimumPeerCount: numeric(payload.minimumPeerCount ?? payload.minimumPeers, 10),
    optedIn: payload.optedIn ?? input.optedIn,
    peerGroup: Object.keys(objectValue(payload.peerGroup)).length
      ? {
          memberCountBand:
            objectValue(payload.peerGroup).memberCountBand ?? null,
          region:
            objectValue(payload.peerGroup).region ??
            objectValue(payload.peerGroup).regionGroup ??
            null,
          tierDistribution:
            objectValue(payload.peerGroup).tierDistribution ??
            objectValue(payload.peerGroup).tierDistributionBand ??
            null,
        }
      : null,
    period: payload.period ?? input.period,
    quarterlyReport: input.quarterlyReport,
    subscriptionTier: input.subscriptionTier,
  };
}

async function enqueueBenchmarkReports(
  admin: SupabaseClient,
  asOf: Date,
): Promise<number> {
  const { data, error } = await admin.rpc(
    "get_due_benchmark_report_recipients",
    { p_as_of: asOf.toISOString() },
  );
  if (error) throw databaseError("Due benchmark report recipients could not be loaded.");
  let queued = 0;
  for (const due of (data ?? []) as DueBenchmarkReport[]) {
    const period = benchmarkPeriod(due.period);
    let subject: string;
    let html: string;
    let text: string;
    let attachments: Array<Record<string, string>> = [];
    if (!due.benchmark_available) {
      const guidance = benchmarkSuppressionGuidance({
        cohortBand: due.sample_count_band ?? undefined,
        organizationName: due.organization_name,
        period: period.label,
      });
      ({ html, subject, text } = guidance);
    } else {
      const { data: comparison, error: comparisonError } = await admin.rpc(
        "get_peer_benchmark",
        {
          p_actor_user_id: due.staff_user_id,
          p_organization_id: due.organization_id,
          p_period: due.period,
        },
      );
      if (comparisonError) {
        throw databaseError("The peer benchmark report could not be loaded.");
      }
      try {
        const artifact = createBenchmarkReportArtifact({
          generatedAt: asOf.toISOString(),
          metrics: benchmarkMetrics(comparison),
          organizationName: due.organization_name,
          peerGroupLabel: benchmarkPeerGroupLabel(due),
          period: period.label,
        });
        subject = `Vinifera peer benchmark report for ${period.label}`;
        html = artifact.html;
        text = artifact.text;
        attachments = [
          {
            content_base64: Buffer.from(artifact.pdf).toString("base64"),
            content_type: "application/pdf",
            filename: `${artifact.filenameBase}.pdf`,
          },
          {
            content_base64: Buffer.from(artifact.csv, "utf8").toString("base64"),
            content_type: "text/csv",
            filename: `${artifact.filenameBase}.csv`,
          },
        ];
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 409) throw error;
        const guidance = benchmarkSuppressionGuidance({
          cohortBand: due.sample_count_band ?? undefined,
          organizationName: due.organization_name,
          period: period.label,
        });
        ({ html, subject, text } = guidance);
      }
    }
    const { error: enqueueError } = await admin.rpc(
      "enqueue_analytics_report_artifact",
      {
        p_actor_user_id: due.staff_user_id,
        p_attachments: attachments,
        p_html_body: html,
        p_idempotency_key: `benchmark:${due.organization_id}:${period.start}:${due.schedule_id}`,
        p_organization_id: due.organization_id,
        p_period_end: period.end,
        p_period_start: period.start,
        p_schedule_id: due.schedule_id,
        p_subject: subject,
        p_text_body: text,
      },
    );
    if (enqueueError) {
      throw databaseError("The benchmark report artifact could not be queued.");
    }
    queued += 1;
  }
  return queued;
}

function isoDateOffset(asOf: Date, days: number): string {
  const value = startOfUtcDate(asOf);
  value.setUTCDate(value.getUTCDate() + days);
  return dateOnly(value);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) /
    Math.max(1, values.length);
}

function populationStandardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      Math.max(1, values.length),
  );
}

function calibrationLine(
  bins: Array<{
    actualRate: number;
    averageProbability: number;
    count: number;
  }>,
): { intercept: number; slope: number } {
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  if (!total) return { intercept: 0, slope: 1 };
  const xMean =
    bins.reduce(
      (sum, bin) => sum + bin.averageProbability * bin.count,
      0,
    ) / total;
  const yMean =
    bins.reduce((sum, bin) => sum + bin.actualRate * bin.count, 0) / total;
  const covariance = bins.reduce(
    (sum, bin) =>
      sum +
      bin.count *
        (bin.averageProbability - xMean) *
        (bin.actualRate - yMean),
    0,
  );
  const variance = bins.reduce(
    (sum, bin) =>
      sum + bin.count * (bin.averageProbability - xMean) ** 2,
    0,
  );
  const slope = variance > 0 ? covariance / variance : 1;
  return {
    intercept: yMean - slope * xMean,
    slope,
  };
}

interface ProductionMlTrainingRunEvidence {
  cancellationCount: number;
  holdoutRowCount: number;
  memberCount: number;
  status: "insufficient_data" | "ready";
  trainingRowCount: number;
}

export function validateProductionMlTrainingRun(
  run: Record<string, unknown>,
  expected: {
    holdoutEnd: string;
    holdoutStart: string;
    trainingCutoff: string;
  },
): ProductionMlTrainingRunEvidence {
  const value = (snake: string, camel: string): unknown =>
    run[snake] ?? run[camel];
  const status = String(run.status ?? "");
  const source = String(run.source ?? "");
  const memberCount = Number(value("member_count", "memberCount"));
  const cancellationCount = Number(
    value("cancellation_count", "cancellationCount"),
  );
  const trainingRowCount = Number(
    value("training_row_count", "trainingRowCount"),
  );
  const holdoutRowCount = Number(
    value("holdout_row_count", "holdoutRowCount"),
  );
  const actualTrainingRatio = Number(
    value("actual_training_ratio", "actualTrainingRatio"),
  );
  const countsAreValid = [
    memberCount,
    cancellationCount,
    trainingRowCount,
    holdoutRowCount,
  ].every((count) => Number.isInteger(count) && count >= 0);
  const readyEvidenceIsValid =
    status !== "ready" ||
    (memberCount >= 500 &&
      cancellationCount >= 50 &&
      cancellationCount <= memberCount &&
      trainingRowCount + holdoutRowCount === memberCount &&
      actualTrainingRatio >= 0.79 &&
      actualTrainingRatio <= 0.81);
  if (
    source !== "production_history" ||
    (status !== "ready" && status !== "insufficient_data") ||
    value("training_cutoff", "trainingCutoff") !== expected.trainingCutoff ||
    value("holdout_start", "holdoutStart") !== expected.holdoutStart ||
    value("holdout_end", "holdoutEnd") !== expected.holdoutEnd ||
    value("feature_schema_version", "featureSchemaVersion") !==
      "vinifera-churn-v1" ||
    value("split_strategy", "splitStrategy") !==
      "temporal_80_20_member_disjoint" ||
    value("temporal_split", "temporalSplit") !== true ||
    Number(value("cross_validation_folds", "crossValidationFolds")) !== 5 ||
    !countsAreValid ||
    !readyEvidenceIsValid
  ) {
    throw databaseError(
      "The ML training run provenance did not match the requested production snapshot.",
    );
  }
  return {
    cancellationCount,
    holdoutRowCount,
    memberCount,
    status: status as ProductionMlTrainingRunEvidence["status"],
    trainingRowCount,
  };
}

export async function runProductionMlTraining(
  env: WorkerEnv,
  input: { actorUserId?: string | null; asOf?: Date } = {},
): Promise<{
  experimentId: string | null;
  modelId: string | null;
  registered: boolean;
  trainingRunId: string | null;
}> {
  const asOf = input.asOf ?? new Date();
  const admin = createSupabaseAdminClient(env);
  // Outcomes need a complete 90-day observation window. The holdout period is
  // therefore cut off 90 days before execution to prevent future leakage.
  const holdoutEnd = isoDateOffset(asOf, -90);
  const holdoutStart = isoDateOffset(asOf, -180);
  const trainingCutoff = isoDateOffset(asOf, -181);
  const configuredActorUserId =
    input.actorUserId ?? env.ML_PLATFORM_ACTOR_USER_ID;
  if (!configuredActorUserId) {
    throw new AppError(
      503,
      "activation_required",
      "ML_PLATFORM_ACTOR_USER_ID must identify an active platform super-admin before ML training can run.",
    );
  }
  const { data: activeActor, error: activeActorError } = await admin
    .from("platform_users")
    .select("id")
    .eq("role", "super_admin")
    .eq("active", true)
    .eq("id", configuredActorUserId)
    .maybeSingle();
  const actorUserId = String(activeActor?.id ?? "");
  if (activeActorError || !actorUserId) {
    throw new AppError(
      503,
      "activation_required",
      "An active platform super-admin must be configured for ML training attribution.",
    );
  }
  const { data: runData, error: runError } = await admin.rpc(
    "create_ml_training_run",
    {
      p_actor_user_id: actorUserId,
      p_holdout_end: holdoutEnd,
      p_holdout_start: holdoutStart,
      p_source: "production_history",
      p_training_cutoff: trainingCutoff,
    },
  );
  if (runError) throw databaseError("The ML training snapshot could not be created.");
  const run = rpcRow(runData);
  const trainingRunId = typeof run?.id === "string" ? run.id : null;
  if (!trainingRunId) {
    throw databaseError("The ML training run identifier is unavailable.");
  }
  const runEvidence = validateProductionMlTrainingRun(run ?? {}, {
    holdoutEnd,
    holdoutStart,
    trainingCutoff,
  });
  if (runEvidence.status === "insufficient_data") {
    return {
      experimentId: null,
      modelId: null,
      registered: false,
      trainingRunId,
    };
  }
  const datasetHash =
    typeof run?.dataset_hash === "string"
      ? run.dataset_hash
      : typeof run?.datasetHash === "string"
        ? run.datasetHash
        : null;
  if (!datasetHash || !/^[a-f0-9]{64}$/.test(datasetHash)) {
    throw databaseError("The immutable ML dataset hash is unavailable.");
  }
  const { data: qualificationData, error: qualificationError } =
    await admin.rpc("get_ml_training_source_qualification", {
      p_training_run_id: trainingRunId,
    });
  if (qualificationError) {
    throw databaseError(
      "The ML source reconciliation status could not be loaded.",
    );
  }
  const qualification = toPublicRecord(
    rpcRow(qualificationData) ?? qualificationData,
  );
  if (
    qualification.status !== "qualified" ||
    qualification.datasetHash !== datasetHash
  ) {
    return {
      experimentId: null,
      modelId: null,
      registered: false,
      trainingRunId,
    };
  }
  const { data: datasetData, error: datasetError } = await admin.rpc(
    "get_ml_training_dataset",
    { p_training_run_id: trainingRunId },
  );
  if (datasetError) throw databaseError("The immutable ML training data could not be loaded.");
  const examples = (datasetData ?? []).map(decodeMlTrainingDatasetRow);
  const result = trainTemporalLogisticModel(examples, "production_history");
  if (
    result.provenance.memberCount !== runEvidence.memberCount ||
    result.provenance.cancellationCount !== runEvidence.cancellationCount ||
    result.provenance.trainingCount !== runEvidence.trainingRowCount ||
    result.provenance.holdoutCount !== runEvidence.holdoutRowCount
  ) {
    throw databaseError(
      "The immutable ML dataset counts did not match the training run provenance.",
    );
  }
  const artifactHash = await mlArtifactHash({
    dataset: {
      featureSchemaVersion:
        run?.feature_schema_version ??
        run?.featureSchemaVersion ??
        "vinifera-churn-v1",
      hash: datasetHash,
      holdoutEnd: run?.holdout_end ?? run?.holdoutEnd ?? holdoutEnd,
      holdoutStart: run?.holdout_start ?? run?.holdoutStart ?? holdoutStart,
      source: run?.source ?? "production_history",
      splitStrategy:
        run?.split_strategy ??
        run?.splitStrategy ??
        "temporal_80_20_member_disjoint",
      trainingCutoff:
        run?.training_cutoff ?? run?.trainingCutoff ?? trainingCutoff,
    },
    model: result,
  });
  const featureImportance = Object.entries(result.coefficients)
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .map(([feature, coefficient]) => ({
      coefficient,
      feature,
      importance: Math.abs(coefficient),
    }));
  const foldAucs = result.folds
    .map((fold) => fold.metrics.aucRoc)
    .filter((value): value is number => value !== null);
  const calibration = calibrationLine(result.holdout.metrics.calibration);
  const holdoutAuc = result.holdout.metrics.aucRoc;
  const rulesAuc = result.holdout.rulesBaseline.aucRoc;
  if (
    holdoutAuc === null ||
    rulesAuc === null ||
    result.folds.length !== 5 ||
    foldAucs.length !== 5
  ) {
    return {
      experimentId: null,
      modelId: null,
      registered: false,
      trainingRunId,
    };
  }
  const confusion = result.holdout.metrics.confusionMatrix;
  const { data: modelData, error: modelError } = await admin.rpc(
    "register_ml_model_version",
    {
      p_actor_user_id: actorUserId,
      p_algorithm: "logistic_regression_l2",
      p_artifact_hash: artifactHash,
      p_coefficients: result.coefficients,
      p_feature_importance: featureImportance,
      p_high_risk_threshold: 0.7,
      p_hyperparameters: {
        cross_validation_folds: 5,
        feature_baseline_bins: result.featureBaselineBins,
        feature_means: result.featureMeans,
        feature_medians: result.featureMedians,
        feature_scales: result.featureStandardDeviations,
        iterations: 800,
        learning_rate: 0.08,
        regularization: 0.02,
        selected_decision_threshold: result.decisionThreshold,
        split_strategy: "temporal_80_20_member_disjoint",
      },
      p_intercept: result.intercept,
      p_metrics: {
        accuracy: result.holdout.metrics.accuracy,
        auc_roc: holdoutAuc,
        brier_score: result.holdout.metrics.brierScore,
        calibration_intercept: calibration.intercept,
        calibration_slope: calibration.slope,
        cv_auc_mean: mean(foldAucs),
        cv_auc_stddev: populationStandardDeviation(foldAucs),
        decision_threshold: result.decisionThreshold,
        f1: result.holdout.metrics.f1,
        false_negative: confusion.falseNegative,
        false_positive: confusion.falsePositive,
        folds: result.folds,
        precision: result.holdout.metrics.precision,
        provenance: result.provenance,
        recall: result.holdout.metrics.recall,
        rules_baseline_auc: rulesAuc,
        rules_baseline: result.holdout.rulesBaseline,
        temporal_holdout: {
          end_at: result.holdout.endAt,
          size: result.holdout.size,
          start_at: result.holdout.startAt,
        },
        true_negative: confusion.trueNegative,
        true_positive: confusion.truePositive,
      },
      p_trained_at: asOf.toISOString(),
      p_training_run_id: trainingRunId,
      p_version: `vinifera-${artifactHash.slice(0, 20)}`,
    },
  );
  if (modelError) throw databaseError("The trained ML candidate could not be registered.");
  const model = rpcRow(modelData);
  const modelId = typeof model?.id === "string" ? model.id : null;
  let experimentId: string | null = null;
  if (modelId && result.eligibility.eligibleForExperiment) {
    const { data: experimentData, error: experimentError } = await admin.rpc(
      "start_eligible_ml_experiment",
      {
        p_actor_user_id: actorUserId,
        p_model_version_id: modelId,
      },
    );
    if (experimentError) {
      throw databaseError(
        "The eligible ML candidate could not enter its 30-day experiment.",
      );
    }
    const experiment = rpcRow(experimentData);
    experimentId =
      typeof experiment?.id === "string" ? experiment.id : null;
  }
  return {
    experimentId,
    modelId,
    registered: true,
    trainingRunId,
  };
}

export async function recordMlTrainingSourceQualification(
  env: WorkerEnv,
  input: {
    actorUserId?: string;
    datasetHash: string;
    sourceCoverage: Record<string, unknown>;
    status: "qualified" | "rejected";
    trainingRunId: string;
  },
): Promise<Record<string, unknown>> {
  const actorUserId =
    input.actorUserId ?? env.ML_PLATFORM_ACTOR_USER_ID;
  if (!actorUserId) {
    throw new AppError(
      503,
      "activation_required",
      "ML_PLATFORM_ACTOR_USER_ID must identify the platform super-admin attesting the source reconciliation.",
    );
  }
  assertUuid(actorUserId, "ML platform actor");
  assertUuid(input.trainingRunId, "ML training run");
  if (
    !/^[a-f0-9]{64}$/.test(input.datasetHash)
  ) {
    throw new AppError(
      400,
      "invalid_request",
      "The ML dataset hash must be a lowercase SHA-256 value.",
    );
  }
  const admin = createSupabaseAdminClient(env);
  const { data: actor, error: actorError } = await admin
    .from("platform_users")
    .select("id")
    .eq("id", actorUserId)
    .eq("role", "super_admin")
    .eq("active", true)
    .maybeSingle();
  if (actorError || !actor) {
    throw new AppError(
      403,
      "forbidden",
      "An active platform super-admin must attest ML source reconciliation.",
    );
  }
  const { data, error } = await admin.rpc(
    "record_ml_training_source_qualification",
    {
      p_actor_user_id: actorUserId,
      p_dataset_hash: input.datasetHash,
      p_source_coverage: input.sourceCoverage,
      p_status: input.status,
      p_training_run_id: input.trainingRunId,
    },
  );
  if (error) {
    throw databaseError(
      "The ML source reconciliation evidence could not be recorded.",
    );
  }
  return toPublicRecord(rpcRow(data) ?? data);
}

export async function runScheduledMlTrainingIfNeeded(input: {
  lifecycle: Record<string, unknown>;
  monthly: boolean;
  train: () => Promise<void>;
}): Promise<boolean> {
  if (
    !input.monthly &&
    input.lifecycle.retrainingTriggered !== true
  ) {
    return false;
  }
  await input.train();
  return true;
}

export function shouldRunMlScoringAfterLifecycle(
  lifecycle: Record<string, unknown>,
): boolean {
  // The current lifecycle result reports aggregate breach state. Suppressing
  // the whole batch is intentionally conservative until model-specific
  // eligibility is returned by the scoring RPC.
  return lifecycle.retrainingRequired !== true;
}

function startOfUtcDate(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(value: string | undefined, label: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(
      400,
      "invalid_request",
      `${label} must use YYYY-MM-DD.`,
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || dateOnly(parsed) !== value) {
    throw new AppError(400, "invalid_request", `${label} is not a valid date.`);
  }
  return parsed;
}

export function resolveAnalyticsRange(
  preset: AnalyticsRange,
  input: { from?: string; to?: string },
  asOf = new Date(),
): ResolvedAnalyticsRange {
  const today = startOfUtcDate(asOf);
  if (preset === "custom") {
    const from = parseDateOnly(input.from, "from");
    const to = parseDateOnly(input.to, "to");
    if (from > to) {
      throw new AppError(
        400,
        "invalid_request",
        "The analytics start date must be on or before the end date.",
      );
    }
    if (to > today) {
      throw new AppError(
        400,
        "invalid_request",
        "Analytics ranges cannot end in the future.",
      );
    }
    return { from: dateOnly(from), preset, to: dateOnly(to) };
  }
  if (input.from || input.to) {
    throw new AppError(
      400,
      "invalid_request",
      "from and to can be used only with range=custom.",
    );
  }
  if (preset === "all") {
    return { from: null, preset, to: dateOnly(today) };
  }
  const daysByRange: Record<Exclude<AnalyticsRange, "all" | "custom">, number> =
    {
      "7d": 7,
      "30d": 30,
      "90d": 90,
      "12m": 365,
    };
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - daysByRange[preset] + 1);
  return { from: dateOnly(from), preset, to: dateOnly(today) };
}

function nestedRows(
  dashboard: Record<string, unknown>,
  path: string[],
): Array<Record<string, unknown>> {
  let value: unknown = dashboard;
  for (const segment of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    value = (value as Record<string, unknown>)[segment];
  }
  if (Array.isArray(value)) {
    return value
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
      .map((row) => toPublicRecord(row));
  }
  return value && typeof value === "object"
    ? [toPublicRecord(value)]
    : [];
}

function exportRows(
  widgetId: string,
  dashboard: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const paths: Record<string, string[]> = {
    acquisition: ["engagement", "acquisition"],
    engagement: ["engagement", "trend"],
    "ltv-by-tier": ["members", "ltvByTier"],
    "member-cohorts": ["members", "cohorts"],
    "member-growth": ["members", "trend"],
    "revenue-by-tier": ["revenue", "byTier"],
    "shipment-operations": ["shipments", "trend"],
  };
  const path = paths[widgetId];
  if (!path) {
    throw new AppError(400, "invalid_request", "The analytics widget is invalid.");
  }
  return nestedRows(dashboard, path);
}

export function sanitizeAnalyticsEventData(
  value: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> {
  const entries = Object.entries(value ?? {});
  if (entries.length > MAX_ANALYTICS_EVENT_FIELDS) {
    throw new AppError(
      400,
      "invalid_request",
      `Analytics events cannot exceed ${MAX_ANALYTICS_EVENT_FIELDS} fields.`,
    );
  }
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, nested] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key) || PROHIBITED_ANALYTICS_KEYS.test(key)) {
      throw new AppError(
        400,
        "invalid_request",
        "Analytics event properties must be non-identifying product metadata.",
      );
    }
    if (typeof nested === "string" && nested.length > 500) {
      throw new AppError(
        400,
        "invalid_request",
        "Analytics event string properties cannot exceed 500 characters.",
      );
    }
    sanitized[key] = nested;
  }
  if (Buffer.byteLength(JSON.stringify(sanitized), "utf8") > MAX_ANALYTICS_EVENT_BYTES) {
    throw new AppError(
      400,
      "invalid_request",
      `Analytics event data cannot exceed ${MAX_ANALYTICS_EVENT_BYTES} bytes.`,
    );
  }
  return sanitized;
}

export function enforceModelGuardrails(
  payload: Record<string, unknown>,
  asOf = new Date(),
): Record<string, unknown> {
  const mode = payload.mode;
  if (mode !== "ml") return payload;
  const model =
    payload.model && typeof payload.model === "object"
      ? (payload.model as Record<string, unknown>)
      : null;
  const metrics =
    model?.metrics && typeof model.metrics === "object"
      ? (model.metrics as Record<string, unknown>)
      : null;
  const auc = Number(metrics?.aucRoc ?? metrics?.auc_roc ?? 0);
  const experiment =
    payload.productionValidation &&
    typeof payload.productionValidation === "object"
      ? (payload.productionValidation as Record<string, unknown>)
      : payload.abTest && typeof payload.abTest === "object"
      ? (payload.abTest as Record<string, unknown>)
      : payload.ab_test && typeof payload.ab_test === "object"
        ? (payload.ab_test as Record<string, unknown>)
        : null;
  const drift =
    payload.drift && typeof payload.drift === "object"
      ? (payload.drift as Record<string, unknown>)
      : null;
  const deploymentStatus = String(
    model?.deploymentStatus ?? model?.deployment_status ?? "",
  );
  const source = String(
    model?.dataSource ??
      model?.data_source ??
      model?.provenance ??
      model?.trainingSource ??
      model?.training_source ??
      "",
  );
  const memberCount = Number(
    model?.memberCount ??
      model?.member_count ??
      model?.trainingDataSize ??
      model?.training_data_size ??
      0,
  );
  const cancellationCount = Number(
    model?.cancellationCount ?? model?.cancellation_count ?? 0,
  );
  const experimentStartedAt = Date.parse(
    String(experiment?.startedAt ?? experiment?.started_at ?? ""),
  );
  const experimentEndedAt = Date.parse(
    String(experiment?.endedAt ?? experiment?.ended_at ?? experiment?.endsAt ?? ""),
  );
  const experimentDays =
    Number.isFinite(experimentStartedAt) && Number.isFinite(experimentEndedAt)
      ? (experimentEndedAt - experimentStartedAt) / (24 * 60 * 60 * 1_000)
      : 0;
  const experimentSuperior =
    experiment?.mlSuperior === true ||
    experiment?.ml_superior === true ||
    experiment?.winner === "ml";
  const experimentComplete =
    experiment?.status === "completed" &&
    experimentDays >= 30 &&
    experimentSuperior;
  const modelId = String(model?.id ?? "");
  const experimentModelId = String(
    experiment?.modelVersionId ?? experiment?.model_version_id ?? "",
  );
  const driftModelId = String(
    drift?.modelVersionId ?? drift?.model_version_id ?? "",
  );
  const driftScore = Number(
    drift?.score ??
      drift?.populationStabilityIndex ??
      drift?.population_stability_index,
  );
  const driftCheckedAt = Date.parse(
    String(
      drift?.lastCheckedAt ??
        drift?.last_checked_at ??
        drift?.snapshotDate ??
        drift?.snapshot_date ??
        "",
    ),
  );
  const asOfDate = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
  );
  const driftDate = Number.isFinite(driftCheckedAt)
    ? new Date(driftCheckedAt)
    : null;
  const driftAgeDays = driftDate
    ? (asOfDate -
        Date.UTC(
          driftDate.getUTCFullYear(),
          driftDate.getUTCMonth(),
          driftDate.getUTCDate(),
        )) /
      (24 * 60 * 60 * 1_000)
    : Number.POSITIVE_INFINITY;
  const driftStable =
    drift?.status === "stable" &&
    drift?.retrainingRequired !== true &&
    drift?.retraining_required !== true &&
    drift?.degradationDetected !== true &&
    drift?.degradation_detected !== true &&
    Number.isFinite(driftScore) &&
    driftScore < 0.2 &&
    driftAgeDays >= 0 &&
    driftAgeDays <= 7;
  const productionReady =
    Boolean(modelId) &&
    experimentModelId === modelId &&
    driftModelId === modelId &&
    deploymentStatus === "production" &&
    source === "production_history" &&
    memberCount >= 500 &&
    cancellationCount >= 50 &&
    Number.isFinite(auc) &&
    auc >= MINIMUM_PRODUCTION_AUC &&
    experimentComplete &&
    driftStable;
  if (productionReady) return payload;
  const rulesFallback = (value: unknown): Record<string, unknown> => {
    const row =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const rulesScore =
      row.rulesScore ??
      row.rules_score ??
      row.effectiveScore ??
      row.effective_score ??
      row.score ??
      0;
    const numericRulesScore = Number(rulesScore);
    const riskLevel =
      Number.isFinite(numericRulesScore) && numericRulesScore <= 30
        ? "low"
        : Number.isFinite(numericRulesScore) && numericRulesScore <= 60
          ? "medium"
          : "high";
    return {
      ...row,
      effectiveScore: rulesScore,
      effectiveSource: "rules",
      fallbackActive: true,
      riskLevel,
      source: "rules",
    };
  };
  return {
    ...rulesFallback(payload),
    fallbackReason:
      "The candidate has not met every production gate: production-history provenance, data minimums, 0.82 temporal holdout AUC, a superior completed 30-day A/B test, active promotion, and stable drift.",
    ...(Array.isArray(payload.items)
      ? { items: payload.items.map(rulesFallback) }
      : {}),
    mode: "rules_fallback",
  };
}

function probabilityPercent(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) return null;
  return Math.round(numeric * 10_000) / 100;
}

function scorePercent(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  return Math.round(numeric * 100) / 100;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function objectRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : [];
}

function ratio(numerator: unknown, denominator: unknown): number {
  const divisor = numeric(denominator);
  return divisor > 0 ? numeric(numerator) / divisor : 0;
}

function canonicalLayout(value: unknown): {
  widgets: Array<{
    enabled: boolean;
    id: string;
    order: number;
    size: "half" | "full";
  }>;
} {
  const record = objectValue(value);
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(record.widgets)
      ? record.widgets
      : Array.isArray(record.layout)
        ? record.layout
        : [];
  const aliases: Record<string, string> = {
    cohort_retention: "member-cohorts",
    email_engagement: "engagement",
    member_growth: "member-growth",
    member_ltv: "ltv-by-tier",
    revenue_by_tier: "revenue-by-tier",
    shipment_fulfillment: "shipment-operations",
  };
  const widgets = objectRows(candidates)
    .map((widget, index) => ({
      enabled: widget.enabled !== false,
      id: aliases[String(widget.id ?? widget.widgetId ?? widget.widget_id)] ??
        String(widget.id ?? widget.widgetId ?? widget.widget_id ?? ""),
      order: numeric(widget.order ?? widget.position, index),
      size:
        widget.size === "full"
          ? ("full" as const)
          : ("half" as const),
    }))
    .filter((widget) => REPORT_WIDGETS.has(widget.id))
    .sort((left, right) => left.order - right.order);
  const unique = widgets.filter(
    (widget, index) =>
      widgets.findIndex((candidate) => candidate.id === widget.id) === index,
  );
  return {
    widgets: unique.length
      ? unique
      : DEFAULT_DASHBOARD_LAYOUT.map((widget) => ({ ...widget })),
  };
}

export function normalizeAnalyticsDashboard(
  rawValue: unknown,
  range: ResolvedAnalyticsRange,
  savedLayout?: unknown,
): Record<string, unknown> {
  const raw = toPublicRecord(rpcRow(rawValue) ?? rawValue);
  const rawRevenue = objectValue(raw.revenue);
  const rawMembers = objectValue(raw.members);
  const rawShipments = objectValue(raw.shipments);
  const rawEngagement = objectValue(raw.engagement);
  const tierDistribution = objectRows(
    rawRevenue.byTier ?? raw.tierDistribution,
  );
  const declineReasons = objectRows(raw.declineReasons);
  const canonicalRevenue = objectValue(rawRevenue);
  const canonicalMembers = objectValue(rawMembers);
  const canonicalShipments = objectValue(rawShipments);
  const canonicalEngagement = objectValue(rawEngagement);
  const revenueSeries = objectRows(canonicalRevenue.trend ?? raw.series);
  const memberSeries = objectRows(canonicalMembers.trend ?? raw.series);
  const shipmentSeries = objectRows(canonicalShipments.trend ?? raw.series);
  const engagementSeries = objectRows(canonicalEngagement.trend ?? raw.series);
  const activeMembers = numeric(
    objectValue(raw.summary).activeMembers ?? rawMembers.active,
  );
  const netGrowth = numeric(rawMembers.netGrowth);
  const attempted = numeric(rawShipments.attempted);
  const fulfilled = numeric(rawShipments.fulfilled);
  const declines = shipmentSeries.reduce(
    (total, row) => total + numeric(row.declinedAttempts),
    0,
  );
  const dashboard = {
    availableWidgets: AVAILABLE_WIDGETS.map((widget) => ({ ...widget })),
    engagement: {
      acquisition: Array.isArray(canonicalEngagement.acquisition)
        ? canonicalEngagement.acquisition
        : [],
      trend: engagementSeries.map((row) => ({
        emailClickRate: ratio(row.emailClicks, row.emailsSent),
        emailOpenRate: ratio(row.emailOpens, row.emailsSent),
        loyaltyRedemptionRate: row.loyaltyRedemptionRate ?? null,
        period: row.period ?? row.date ?? row.metricDate,
        portalLoginsPerMember: ratio(row.portalLogins, row.activeMembers),
      })),
    },
    generatedAt: raw.generatedAt ?? null,
    layout: canonicalLayout(savedLayout ?? raw.layout),
    members: {
      cohorts: Array.isArray(canonicalMembers.cohorts)
        ? canonicalMembers.cohorts
        : Object.entries(
            objectRows(
              canonicalMembers.cohortRetention ?? raw.cohortRetention,
            ).reduce<
              Record<string, Array<Record<string, unknown>>>
            >((groups, row) => {
              const cohort = String(row.cohortMonth ?? "");
              (groups[cohort] ??= []).push(row);
              return groups;
            }, {}),
          ).map(([cohort, rows]) => ({
            cohort,
            values: [...rows]
              .sort(
                (left, right) =>
                  numeric(left.monthsSinceJoin) -
                  numeric(right.monthsSinceJoin),
              )
              .map((row) => numeric(row.retentionRate)),
          })),
      ltvByTier: Array.isArray(canonicalMembers.ltvByTier)
        ? canonicalMembers.ltvByTier
        : tierDistribution.flatMap((tier) =>
            Number.isFinite(Number(tier.averageLtvCents))
              ? [
                  {
                    ltvCents: Number(tier.averageLtvCents),
                    tierId: tier.tierId,
                    tierName: tier.tierName,
                  },
                ]
              : [],
          ),
      tenureDistribution: objectRows(
        canonicalMembers.tenureDistribution ?? raw.tenureDistribution,
      ),
      trend: memberSeries.map((row) => ({
        active: numeric(row.active ?? row.activeMembers),
        cancelled: numeric(row.cancelled ?? row.cancelledMembers),
        netGrowth:
          row.netGrowth ??
          numeric(row.newMembers) - numeric(row.cancelledMembers),
        newMembers: numeric(row.newMembers),
        period: row.period ?? row.date ?? row.metricDate,
      })),
    },
    range,
    revenue: {
      byTier: tierDistribution.map((tier) => {
        const mrrCents = numeric(
          tier.mrrCents ?? tier.monthlyRevenueCents,
        );
        return {
          arrCents: tier.arrCents ?? mrrCents * 12,
          memberCount: numeric(tier.memberCount ?? tier.activeMembers),
          mrrCents,
          tierId: tier.tierId,
          tierName: tier.tierName,
        };
      }),
      trend: revenueSeries.map((row) => ({
        arpmCents:
          row.arpmCents ?? ratio(row.mrrCents, row.activeMembers),
        arrCents: row.arrCents ?? numeric(row.mrrCents) * 12,
        mrrCents: numeric(row.mrrCents),
        period: row.period ?? row.date ?? row.metricDate,
        revenueChurnCents: row.revenueChurnCents ?? null,
      })),
    },
    shipments: {
      declineReasons: objectRows(
        canonicalShipments.declineReasons ?? declineReasons,
      ).map((reason) => ({
            count: numeric(reason.attempts),
            rate: ratio(reason.attempts, declines),
            reason: reason.reason,
          })),
      trend: shipmentSeries.map((row) => {
            const rowAttempted = numeric(row.attemptedShipments);
            const rowDeclined = numeric(row.declinedAttempts);
            const rowFulfilled = numeric(row.fulfilledShipments);
            return {
              attempted: rowAttempted,
              averageValueCents: ratio(
                row.shipmentValueCents,
                rowFulfilled,
              ),
              charged: Math.max(0, rowAttempted - rowDeclined),
              declined: rowDeclined,
              fulfillmentRate: ratio(rowFulfilled, rowAttempted),
              period: row.period ?? row.date ?? row.metricDate,
              revenueCents: row.netRevenueCents ?? row.revenueCents ?? null,
              shippingCostCents: row.shippingCostCents ?? null,
            };
          }),
    },
    summary: {
      activeMembers,
      arpmCents: numeric(
        objectValue(raw.summary).arpmCents ?? rawRevenue.arpmCents,
      ),
      arrCents: numeric(
        objectValue(raw.summary).arrCents ?? rawRevenue.arrCents,
      ),
      averageLtvCents: numeric(
        objectValue(raw.summary).averageLtvCents ??
          rawMembers.averageLtvCents,
      ),
      averageShipmentValueCents: numeric(
        objectValue(raw.summary).averageShipmentValueCents ??
          rawShipments.averageValueCents,
      ),
      declineRate: numeric(
        objectValue(raw.summary).declineRate ?? rawShipments.declineRate,
      ),
      emailClickRate: numeric(
        objectValue(raw.summary).emailClickRate ??
          rawEngagement.emailClickRate,
      ),
      emailOpenRate: numeric(
        objectValue(raw.summary).emailOpenRate ??
          rawEngagement.emailOpenRate,
      ),
      fulfillmentRate: numeric(
        objectValue(raw.summary).fulfillmentRate ??
          rawShipments.fulfillmentRate ??
          ratio(fulfilled, attempted),
      ),
      loyaltyRedemptionRate:
        objectValue(raw.summary).loyaltyRedemptionRate ??
        rawEngagement.loyaltyRedemptionRate ??
        null,
      loyaltyPointsRedeemed: numeric(
        objectValue(raw.summary).loyaltyPointsRedeemed ??
          rawEngagement.loyaltyPointsRedeemed,
      ),
      memberGrowthRate:
        objectValue(raw.summary).memberGrowthRate ??
        ratio(netGrowth, Math.max(1, activeMembers - netGrowth)),
      mrrCents: numeric(
        objectValue(raw.summary).mrrCents ?? rawRevenue.mrrCents,
      ),
      portalLoginsPerMember:
        objectValue(raw.summary).portalLoginsPerMember ??
        ratio(rawEngagement.portalLogins, activeMembers),
      portalLogins: numeric(
        objectValue(raw.summary).portalLogins ??
          rawEngagement.portalLogins,
      ),
      revenueChurnCents: numeric(
        objectValue(raw.summary).revenueChurnCents ??
          rawRevenue.revenueChurnCents,
      ),
      shippingCostRatio: numeric(
        objectValue(raw.summary).shippingCostRatio ??
          rawShipments.shippingCostRatio,
      ),
    },
  };
  return dashboard;
}

interface BrandAnalyticsDashboardInput {
  brandId: string;
  brandName: string;
  payload: unknown;
}

interface WeightedValue {
  denominator: number;
  numerator: number;
}

function addWeightedValue(
  current: WeightedValue | undefined,
  value: unknown,
  weight: unknown,
): WeightedValue {
  const normalizedWeight = Math.max(0, numeric(weight));
  return {
    denominator: (current?.denominator ?? 0) + normalizedWeight,
    numerator:
      (current?.numerator ?? 0) + numeric(value) * normalizedWeight,
  };
}

function weightedAverage(value: WeightedValue | undefined): number {
  return value && value.denominator > 0
    ? value.numerator / value.denominator
    : 0;
}

function analyticsSection(
  dashboard: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return objectValue(dashboard[key]);
}

/**
 * Produces one privacy-safe, organization-level dashboard from already
 * authorized brand snapshots. Counts and money are additive; rates and
 * averages are weighted by the matching operational population.
 */
export function aggregateAnalyticsDashboards(
  inputs: BrandAnalyticsDashboardInput[],
  range: ResolvedAnalyticsRange,
  savedLayout?: unknown,
): Record<string, unknown> {
  const dashboards = inputs.map((input) => ({
    ...input,
    dashboard: normalizeAnalyticsDashboard(input.payload, range),
    raw: toPublicRecord(rpcRow(input.payload) ?? input.payload),
  }));
  const summaryTotals = {
    activeMembers: 0,
    arrCents: 0,
    loyaltyPointsRedeemed: 0,
    mrrCents: 0,
    portalLogins: 0,
    revenueChurnCents: 0,
  };
  let averageLtv: WeightedValue | undefined;
  let averageShipmentValue: WeightedValue | undefined;
  let declineRate: WeightedValue | undefined;
  let emailClickRate: WeightedValue | undefined;
  let emailOpenRate: WeightedValue | undefined;
  let fulfillmentRate: WeightedValue | undefined;
  let loyaltyRedemptionRate: WeightedValue | undefined;
  let memberGrowthRate: WeightedValue | undefined;
  let shippingCostRatio: WeightedValue | undefined;

  const revenueByTier = new Map<
    string,
    {
      arrCents: number;
      ltv: WeightedValue;
      memberCount: number;
      mrrCents: number;
      tierName: string;
    }
  >();
  const revenueTrend = new Map<
    string,
    {
      activeMembers: number;
      arrCents: number;
      mrrCents: number;
      revenueChurnCents: number;
    }
  >();
  const memberTrend = new Map<
    string,
    {
      active: number;
      cancelled: number;
      netGrowth: number;
      newMembers: number;
    }
  >();
  const tenureDistribution = new Map<string, number>();
  const shipmentTrend = new Map<
    string,
    {
      attempted: number;
      charged: number;
      declined: number;
      fulfilled: number;
      grossRevenueCents: number;
      revenueCents: number;
      shipmentValueCents: number;
      shippingCostCents: number;
    }
  >();
  const declineReasons = new Map<string, number>();
  const engagementTrend = new Map<
    string,
    {
      activeMembers: number;
      emailClicks: number;
      emailOpens: number;
      emailsSent: number;
      loyaltyPointsEarned: number;
      loyaltyPointsRedeemed: number;
      portalLogins: number;
    }
  >();
  const acquisition = new Map<
    string,
    {
      cac: WeightedValue;
      conversion: WeightedValue;
      members: number;
    }
  >();
  const cohorts: Array<Record<string, unknown>> = [];

  for (const entry of dashboards) {
    const summary = analyticsSection(entry.dashboard, "summary");
    const activeMembers = numeric(summary.activeMembers);
    summaryTotals.activeMembers += activeMembers;
    summaryTotals.arrCents += numeric(summary.arrCents);
    summaryTotals.loyaltyPointsRedeemed += numeric(
      summary.loyaltyPointsRedeemed,
    );
    summaryTotals.mrrCents += numeric(summary.mrrCents);
    summaryTotals.portalLogins += numeric(summary.portalLogins);
    summaryTotals.revenueChurnCents += numeric(summary.revenueChurnCents);
    averageLtv = addWeightedValue(
      averageLtv,
      summary.averageLtvCents,
      activeMembers,
    );
    averageShipmentValue = addWeightedValue(
      averageShipmentValue,
      summary.averageShipmentValueCents,
      activeMembers,
    );
    declineRate = addWeightedValue(
      declineRate,
      summary.declineRate,
      activeMembers,
    );
    emailClickRate = addWeightedValue(
      emailClickRate,
      summary.emailClickRate,
      activeMembers,
    );
    emailOpenRate = addWeightedValue(
      emailOpenRate,
      summary.emailOpenRate,
      activeMembers,
    );
    fulfillmentRate = addWeightedValue(
      fulfillmentRate,
      summary.fulfillmentRate,
      activeMembers,
    );
    loyaltyRedemptionRate = addWeightedValue(
      loyaltyRedemptionRate,
      summary.loyaltyRedemptionRate,
      activeMembers,
    );
    memberGrowthRate = addWeightedValue(
      memberGrowthRate,
      summary.memberGrowthRate,
      activeMembers,
    );
    shippingCostRatio = addWeightedValue(
      shippingCostRatio,
      summary.shippingCostRatio,
      numeric(summary.arrCents),
    );

    const revenue = analyticsSection(entry.dashboard, "revenue");
    const members = analyticsSection(entry.dashboard, "members");
    const shipments = analyticsSection(entry.dashboard, "shipments");
    const engagement = analyticsSection(entry.dashboard, "engagement");
    const rawRevenue = objectValue(entry.raw.revenue);
    const rawMetricsByPeriod = new Map<string, Record<string, unknown>>();
    for (const section of [
      rawRevenue,
      objectValue(entry.raw.members),
      objectValue(entry.raw.shipments),
      objectValue(entry.raw.engagement),
    ]) {
      for (const row of objectRows(section.trend)) {
        const period = String(
          row.period ?? row.metricDate ?? row.date ?? "",
        );
        if (!period) continue;
        rawMetricsByPeriod.set(period, {
          ...(rawMetricsByPeriod.get(period) ?? {}),
          ...row,
        });
      }
    }
    const ltvRows = objectRows(members.ltvByTier);
    const ltvByTier = new Map(
      ltvRows.map((row) => [
        String(row.tierName ?? row.tierId ?? ""),
        numeric(row.ltvCents),
      ]),
    );
    for (const row of objectRows(revenue.byTier)) {
      const tierName = String(row.tierName ?? "Unassigned");
      const key = tierName.trim().toLocaleLowerCase("en-US");
      const memberCount = numeric(row.memberCount);
      const current = revenueByTier.get(key) ?? {
        arrCents: 0,
        ltv: { denominator: 0, numerator: 0 },
        memberCount: 0,
        mrrCents: 0,
        tierName,
      };
      current.arrCents += numeric(row.arrCents);
      current.memberCount += memberCount;
      current.mrrCents += numeric(row.mrrCents);
      current.ltv = addWeightedValue(
        current.ltv,
        ltvByTier.get(tierName) ?? ltvByTier.get(String(row.tierId ?? "")),
        memberCount,
      );
      revenueByTier.set(key, current);
    }

    const activeByPeriod = new Map(
      objectRows(members.trend).map((row) => [
        String(row.period ?? ""),
        numeric(row.active),
      ]),
    );
    for (const row of objectRows(revenue.trend)) {
      const period = String(row.period ?? "");
      if (!period) continue;
      const current = revenueTrend.get(period) ?? {
        activeMembers: 0,
        arrCents: 0,
        mrrCents: 0,
        revenueChurnCents: 0,
      };
      current.activeMembers += activeByPeriod.get(period) ?? 0;
      current.arrCents += numeric(row.arrCents);
      current.mrrCents += numeric(row.mrrCents);
      current.revenueChurnCents += numeric(row.revenueChurnCents);
      revenueTrend.set(period, current);
    }
    for (const row of objectRows(members.trend)) {
      const period = String(row.period ?? "");
      if (!period) continue;
      const current = memberTrend.get(period) ?? {
        active: 0,
        cancelled: 0,
        netGrowth: 0,
        newMembers: 0,
      };
      current.active += numeric(row.active);
      current.cancelled += numeric(row.cancelled);
      current.netGrowth += numeric(row.netGrowth);
      current.newMembers += numeric(row.newMembers);
      memberTrend.set(period, current);
    }
    for (const row of objectRows(members.cohorts)) {
      cohorts.push({
        ...row,
        brandId: entry.brandId,
        brandName: entry.brandName,
        cohort: `${entry.brandName} · ${String(row.cohort ?? "")}`,
      });
    }
    for (const row of objectRows(members.tenureDistribution)) {
      const bucket = String(row.bucket ?? "Unassigned");
      tenureDistribution.set(
        bucket,
        (tenureDistribution.get(bucket) ?? 0) + numeric(row.members),
      );
    }

    for (const row of objectRows(shipments.trend)) {
      const period = String(row.period ?? "");
      if (!period) continue;
      const attempted = numeric(row.attempted);
      const rawMetric = rawMetricsByPeriod.get(period) ?? {};
      const fulfilled =
        rawMetric.fulfilledShipments === undefined
          ? numeric(row.fulfillmentRate) * attempted
          : numeric(rawMetric.fulfilledShipments);
      const current = shipmentTrend.get(period) ?? {
        attempted: 0,
        charged: 0,
        declined: 0,
        fulfilled: 0,
        grossRevenueCents: 0,
        revenueCents: 0,
        shipmentValueCents: 0,
        shippingCostCents: 0,
      };
      current.attempted += attempted;
      current.charged += numeric(row.charged);
      current.declined += numeric(row.declined);
      current.fulfilled += fulfilled;
      current.grossRevenueCents += numeric(rawMetric.grossRevenueCents);
      current.revenueCents += numeric(
        rawMetric.netRevenueCents ?? row.revenueCents,
      );
      current.shipmentValueCents += numeric(
        rawMetric.shipmentValueCents,
        numeric(row.averageValueCents) * fulfilled,
      );
      current.shippingCostCents += numeric(
        rawMetric.shippingCostCents ?? row.shippingCostCents,
      );
      shipmentTrend.set(period, current);
    }
    for (const row of objectRows(shipments.declineReasons)) {
      const reason = String(row.reason ?? "unknown");
      declineReasons.set(
        reason,
        (declineReasons.get(reason) ?? 0) + numeric(row.count),
      );
    }

    for (const row of objectRows(engagement.trend)) {
      const period = String(row.period ?? "");
      if (!period) continue;
      const rawMetric = rawMetricsByPeriod.get(period) ?? {};
      const active = numeric(
        rawMetric.activeMembers,
        activeByPeriod.get(period) ?? activeMembers,
      );
      const emailsSent = numeric(rawMetric.emailsSent);
      const current = engagementTrend.get(period) ?? {
        activeMembers: 0,
        emailClicks: 0,
        emailOpens: 0,
        emailsSent: 0,
        loyaltyPointsEarned: 0,
        loyaltyPointsRedeemed: 0,
        portalLogins: 0,
      };
      current.activeMembers += active;
      current.emailClicks += numeric(
        rawMetric.emailClicks,
        numeric(row.emailClickRate) * emailsSent,
      );
      current.emailOpens += numeric(
        rawMetric.emailOpens,
        numeric(row.emailOpenRate) * emailsSent,
      );
      current.emailsSent += emailsSent;
      current.loyaltyPointsEarned += numeric(
        rawMetric.loyaltyPointsEarned,
      );
      current.loyaltyPointsRedeemed += numeric(
        rawMetric.loyaltyPointsRedeemed,
        numeric(row.loyaltyRedemptionRate) *
          numeric(rawMetric.loyaltyPointsEarned),
      );
      current.portalLogins += numeric(
        rawMetric.portalLogins,
        numeric(row.portalLoginsPerMember) * active,
      );
      engagementTrend.set(period, current);
    }
    for (const row of objectRows(engagement.acquisition)) {
      const source = String(row.source ?? "Unattributed");
      const membersAcquired = numeric(row.members);
      const current = acquisition.get(source) ?? {
        cac: { denominator: 0, numerator: 0 },
        conversion: { denominator: 0, numerator: 0 },
        members: 0,
      };
      current.members += membersAcquired;
      current.cac = addWeightedValue(
        current.cac,
        row.cacCents,
        membersAcquired,
      );
      current.conversion = addWeightedValue(
        current.conversion,
        row.conversionRate,
        membersAcquired,
      );
      acquisition.set(source, current);
    }
  }

  const totalDeclines = [...declineReasons.values()].reduce(
    (total, count) => total + count,
    0,
  );
  const shipmentTotals = [...shipmentTrend.values()].reduce(
    (totals, row) => ({
      attempted: totals.attempted + row.attempted,
      declined: totals.declined + row.declined,
      fulfilled: totals.fulfilled + row.fulfilled,
      grossRevenueCents:
        totals.grossRevenueCents + row.grossRevenueCents,
      revenueCents: totals.revenueCents + row.revenueCents,
      shipmentValueCents:
        totals.shipmentValueCents + row.shipmentValueCents,
      shippingCostCents:
        totals.shippingCostCents + row.shippingCostCents,
    }),
    {
      attempted: 0,
      declined: 0,
      fulfilled: 0,
      grossRevenueCents: 0,
      revenueCents: 0,
      shipmentValueCents: 0,
      shippingCostCents: 0,
    },
  );
  const engagementTotals = [...engagementTrend.values()].reduce(
    (totals, row) => ({
      activeMembers: totals.activeMembers + row.activeMembers,
      emailClicks: totals.emailClicks + row.emailClicks,
      emailOpens: totals.emailOpens + row.emailOpens,
      emailsSent: totals.emailsSent + row.emailsSent,
      loyaltyPointsEarned:
        totals.loyaltyPointsEarned + row.loyaltyPointsEarned,
      loyaltyPointsRedeemed:
        totals.loyaltyPointsRedeemed + row.loyaltyPointsRedeemed,
      portalLogins: totals.portalLogins + row.portalLogins,
    }),
    {
      activeMembers: 0,
      emailClicks: 0,
      emailOpens: 0,
      emailsSent: 0,
      loyaltyPointsEarned: 0,
      loyaltyPointsRedeemed: 0,
      portalLogins: 0,
    },
  );
  const generatedAt = dashboards
    .map(({ dashboard }) => String(dashboard.generatedAt ?? ""))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  return {
    availableWidgets: AVAILABLE_WIDGETS.map((widget) => ({ ...widget })),
    engagement: {
      acquisition: [...acquisition.entries()]
        .map(([source, row]) => ({
          cacCents: weightedAverage(row.cac),
          conversionRate: weightedAverage(row.conversion),
          members: row.members,
          source,
        }))
        .sort((left, right) => right.members - left.members),
      trend: [...engagementTrend.entries()]
        .map(([period, row]) => ({
          emailClickRate: ratio(row.emailClicks, row.emailsSent),
          emailOpenRate: ratio(row.emailOpens, row.emailsSent),
          loyaltyRedemptionRate: ratio(
            row.loyaltyPointsRedeemed,
            row.loyaltyPointsEarned,
          ),
          period,
          portalLoginsPerMember: ratio(
            row.portalLogins,
            row.activeMembers,
          ),
        }))
        .sort((left, right) => left.period.localeCompare(right.period)),
    },
    generatedAt,
    layout: canonicalLayout(savedLayout),
    members: {
      cohorts,
      ltvByTier: [...revenueByTier.entries()].map(([key, row]) => ({
        ltvCents: weightedAverage(row.ltv),
        tierId: `all:${key}`,
        tierName: row.tierName,
      })),
      tenureDistribution: [...tenureDistribution.entries()].map(
        ([bucket, members]) => ({ bucket, members }),
      ),
      trend: [...memberTrend.entries()]
        .map(([period, row]) => ({ period, ...row }))
        .sort((left, right) => left.period.localeCompare(right.period)),
    },
    range,
    revenue: {
      byTier: [...revenueByTier.entries()].map(([key, row]) => ({
        arrCents: row.arrCents,
        memberCount: row.memberCount,
        mrrCents: row.mrrCents,
        tierId: `all:${key}`,
        tierName: row.tierName,
      })),
      trend: [...revenueTrend.entries()]
        .map(([period, row]) => ({
          arpmCents: ratio(row.mrrCents, row.activeMembers),
          arrCents: row.arrCents,
          mrrCents: row.mrrCents,
          period,
          revenueChurnCents: row.revenueChurnCents,
        }))
        .sort((left, right) => left.period.localeCompare(right.period)),
    },
    scope: {
      brandCount: dashboards.length,
      brands: dashboards.map(({ brandId, brandName }) => ({
        id: brandId,
        name: brandName,
      })),
      type: "all",
    },
    shipments: {
      declineReasons: [...declineReasons.entries()].map(([reason, count]) => ({
        count,
        rate: ratio(count, totalDeclines),
        reason,
      })),
      trend: [...shipmentTrend.entries()]
        .map(([period, row]) => ({
          attempted: row.attempted,
          averageValueCents: ratio(
            row.shipmentValueCents,
            row.fulfilled,
          ),
          charged: row.charged,
          declined: row.declined,
          fulfillmentRate: ratio(row.fulfilled, row.attempted),
          period,
          revenueCents: row.revenueCents,
          shippingCostCents: row.shippingCostCents,
        }))
        .sort((left, right) => left.period.localeCompare(right.period)),
    },
    summary: {
      ...summaryTotals,
      arpmCents: ratio(
        summaryTotals.mrrCents,
        summaryTotals.activeMembers,
      ),
      averageLtvCents: weightedAverage(averageLtv),
      averageShipmentValueCents:
        shipmentTotals.fulfilled > 0
          ? ratio(
              shipmentTotals.shipmentValueCents,
              shipmentTotals.fulfilled,
            )
          : weightedAverage(averageShipmentValue),
      declineRate:
        shipmentTotals.attempted > 0
          ? ratio(shipmentTotals.declined, shipmentTotals.attempted)
          : weightedAverage(declineRate),
      emailClickRate:
        engagementTotals.emailsSent > 0
          ? ratio(engagementTotals.emailClicks, engagementTotals.emailsSent)
          : weightedAverage(emailClickRate),
      emailOpenRate:
        engagementTotals.emailsSent > 0
          ? ratio(engagementTotals.emailOpens, engagementTotals.emailsSent)
          : weightedAverage(emailOpenRate),
      fulfillmentRate:
        shipmentTotals.attempted > 0
          ? ratio(shipmentTotals.fulfilled, shipmentTotals.attempted)
          : weightedAverage(fulfillmentRate),
      loyaltyRedemptionRate:
        engagementTotals.loyaltyPointsEarned > 0
          ? ratio(
              engagementTotals.loyaltyPointsRedeemed,
              engagementTotals.loyaltyPointsEarned,
            )
          : weightedAverage(loyaltyRedemptionRate),
      memberGrowthRate: weightedAverage(memberGrowthRate),
      portalLoginsPerMember: ratio(
        summaryTotals.portalLogins,
        summaryTotals.activeMembers,
      ),
      shippingCostRatio:
        shipmentTotals.grossRevenueCents > 0
          ? ratio(
              shipmentTotals.shippingCostCents,
              shipmentTotals.grossRevenueCents,
            )
          : weightedAverage(shippingCostRatio),
    },
  };
}

export function normalizeChurnBrowserDto(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeMemberChurnDto)
    : payload.items;
  return {
    ...payload,
    ...(items === undefined ? {} : { items }),
  };
}

export function normalizeMemberChurnDto(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const member = value as Record<string, unknown>;
  const rawTopFeatures = member.topFeatures ?? member.top_features;
  const topFeatures = Array.isArray(rawTopFeatures)
    ? rawTopFeatures.map(
        (featureValue, index) => {
          const feature = objectValue(featureValue);
          const contribution = numeric(
            feature.shapValue ??
              feature.shap_value ??
              feature.contribution ??
              feature.impact,
          );
          const id = String(feature.id ?? feature.feature ?? `feature-${index + 1}`);
          const direction =
            feature.direction === "lowers" ||
            feature.direction === "decrease" ||
            contribution < 0
              ? "lowers"
              : "raises";
          return {
            detail:
              feature.detail ??
              `${id.replaceAll("_", " ")} = ${String(feature.value ?? "unavailable")}`,
            direction,
            id,
            impact: Math.abs(contribution),
            label:
              feature.label ??
              id
                .replaceAll("_", " ")
                .replace(/\b\w/g, (character) => character.toUpperCase()),
            shapValue: contribution,
          };
        },
      )
    : [];
  const rawAlert = objectValue(member.alert);
  const alertId = member.alertId ?? member.alert_id ?? rawAlert.id;
  const acknowledgedAt =
    member.alertAcknowledgedAt ??
    member.alert_acknowledged_at ??
    rawAlert.acknowledgedAt;
  const normalized: Record<string, unknown> = {
    ...member,
    alert: alertId
      ? {
          acknowledgedAt: acknowledgedAt ?? null,
          acknowledgedByName:
            member.alertAcknowledgedByName ??
            member.alert_acknowledged_by_name ??
            rawAlert.acknowledgedByName ??
            null,
          createdAt:
            member.alertCreatedAt ??
            member.alert_created_at ??
            rawAlert.createdAt ??
            null,
          id: alertId,
          status: acknowledgedAt ? "acknowledged" : "open",
        }
      : null,
    calculatedAt:
      member.calculatedAt ??
      member.predictedAt ??
      member.predicted_at ??
      null,
    confidenceBandHigh: probabilityPercent(
      member.confidenceHighProbability ??
        member.confidence_high_probability ??
        member.confidenceHigh ??
        member.confidence_high ??
        member.confidenceIntervalHigh ??
        objectValue(member.confidenceInterval).high,
    ),
    email: member.email ?? member.memberEmail ?? member.member_email ?? null,
    confidenceBandLow: probabilityPercent(
      member.confidenceLowProbability ??
        member.confidence_low_probability ??
        member.confidenceLow ??
        member.confidence_low ??
        member.confidenceIntervalLow ??
        objectValue(member.confidenceInterval).low,
    ),
    mlScore:
      scorePercent(member.mlScore ?? member.ml_score) ??
      probabilityPercent(member.mlProbability ?? member.ml_probability),
    rulesScore:
      scorePercent(member.rulesScore ?? member.rules_score) ??
      probabilityPercent(
        member.rulesProbability ??
          member.rules_probability ??
          member.rulesScoreProbability ??
          member.rules_score_probability,
      ),
    source: member.source ?? member.effectiveSource ?? member.effective_source,
    topFeatures,
  };
  for (const legacyKey of [
    "confidenceHigh",
    "confidenceHighProbability",
    "confidenceInterval",
    "confidenceIntervalHigh",
    "confidenceIntervalLow",
    "confidenceLow",
    "confidenceLowProbability",
  ]) {
    delete normalized[legacyKey];
  }
  return normalized;
}

export function normalizeMlOperationsDto(
  value: unknown,
): Record<string, unknown> {
  const payload = toPublicRecord(rpcRow(value) ?? value);
  const productionModel = objectValue(payload.productionModel);
  const abTestModel = objectValue(payload.abTestModel);
  const hasProductionModel = Boolean(productionModel.id);
  const hasAbTestModel = Boolean(abTestModel.id);
  const legacyExperiment = objectValue(payload.experiment);
  const productionExperiment = objectValue(payload.productionExperiment);
  const abTestExperiment = objectValue(payload.abTestExperiment);
  const displayedExperiment = hasAbTestModel
    ? Object.keys(abTestExperiment).length
      ? abTestExperiment
      : legacyExperiment
    : Object.keys(productionExperiment).length
      ? productionExperiment
      : legacyExperiment;
  const validationExperiment = hasProductionModel
    ? Object.keys(productionExperiment).length
      ? productionExperiment
      : legacyExperiment
    : {};
  const legacyDrift = objectValue(payload.latestDrift);
  const productionDrift = objectValue(payload.productionDrift);
  const abTestDrift = objectValue(payload.abTestDrift);
  const effectiveDrift = hasProductionModel
    ? Object.keys(productionDrift).length
      ? productionDrift
      : legacyDrift
    : Object.keys(abTestDrift).length
      ? abTestDrift
      : legacyDrift;
  const normalizeExperiment = (
    experiment: Record<string, unknown>,
  ): Record<string, unknown> | null => {
    if (!Object.keys(experiment).length) return null;
    const completedAt = experiment.completedAt;
    const mlAuc = numeric(experiment.mlAuc, Number.NaN);
    const rulesAuc = numeric(experiment.rulesAuc, Number.NaN);
    return {
      endedAt: completedAt ?? experiment.plannedEndAt ?? null,
      mlAuc: Number.isFinite(mlAuc) ? mlAuc : null,
      mlSuperior:
        experiment.status === "completed" &&
        experiment.mlSuperior === true &&
        Number.isFinite(mlAuc) &&
        Number.isFinite(rulesAuc) &&
        mlAuc > rulesAuc,
      rulesAuc: Number.isFinite(rulesAuc) ? rulesAuc : null,
      startedAt: experiment.startedAt ?? null,
      status: experiment.status ?? "scheduled",
      modelVersionId: experiment.modelVersionId ?? null,
      ...(experiment.id ? { id: experiment.id } : {}),
    };
  };
  const normalizedDisplayedExperiment = normalizeExperiment(
    displayedExperiment,
  );
  const normalizedValidationExperiment = normalizeExperiment(
    validationExperiment,
  );
  const retrainingRequired = effectiveDrift.retrainingRequired === true;
  const stability = numeric(
    effectiveDrift.populationStabilityIndex,
    Number.NaN,
  );
  const hasDriftEvidence = Boolean(
    effectiveDrift.modelVersionId && effectiveDrift.snapshotDate,
  );
  const driftStatus =
    retrainingRequired || effectiveDrift.status === "degraded"
      ? "retraining"
      : !hasDriftEvidence ||
          effectiveDrift.status === "warning" ||
          (Number.isFinite(stability) && stability >= 0.2)
        ? "warning"
        : "stable";
  return {
    abTest: normalizedDisplayedExperiment,
    drift: {
      lastCheckedAt: effectiveDrift.snapshotDate ?? null,
      modelVersionId: effectiveDrift.modelVersionId ?? null,
      score: Number.isFinite(stability) ? stability : null,
      status: driftStatus,
    },
    fallbackReason:
      payload.fallback === true
        ? "No production ML model is active; deterministic rules remain authoritative."
        : null,
    mode: hasProductionModel
      ? "ml"
      : hasAbTestModel
        ? "ab_test"
        : "rules_fallback",
    model: hasProductionModel
      ? productionModel
      : hasAbTestModel
        ? abTestModel
        : null,
    productionValidation: normalizedValidationExperiment,
  };
}

export function composeChurnIntelligenceDto(
  rowsValue: unknown,
  operationsValue: unknown,
): Record<string, unknown> {
  const rows = Array.isArray(rowsValue)
    ? rowsValue.map((row) => toPublicRecord(row))
    : [];
  return normalizeChurnBrowserDto(
    enforceModelGuardrails({
      ...normalizeMlOperationsDto(operationsValue),
      items: rows,
      total: numeric(rows[0]?.totalCount),
    }),
  );
}

export class ProductionAnalyticsService
  extends ProductionRetentionService
  implements AnalyticsService
{
  private async callRpc(
    name: string,
    args: Record<string, unknown>,
    failureMessage: string,
  ): Promise<unknown> {
    const { data, error } = await this.admin.rpc(name, args);
    if (error) throw databaseError(failureMessage);
    return data;
  }

  private async organizationReportRecipient(
    organizationId: string,
    recipientEmail: string,
  ): Promise<string> {
    const normalized = recipientEmail.trim().toLocaleLowerCase("en-US");
    const { data, error } = await this.admin
      .from("staff_users")
      .select("email")
      .eq("organization_id", organizationId)
      .ilike("email", normalized)
      .maybeSingle();
    if (error) throw databaseError("The report recipient could not be verified.");
    if (!data) {
      throw new AppError(
        400,
        "invalid_request",
        "Scheduled analytics reports can be sent only to staff in this winery.",
      );
    }
    return normalized;
  }

  private async loadAnalyticsLayout(
    principal: StaffPrincipal,
  ): Promise<Record<string, unknown> | null> {
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("dashboard_layout_preferences")
      .select("layout,updated_at")
      .eq("organization_id", this.organizationId(principal))
      .eq("brand_id", brandId)
      .eq("staff_user_id", principal.user.id)
      .maybeSingle();
    if (error) throw databaseError("The analytics layout could not be loaded.");
    return data ? toPublicRecord(data) : null;
  }

  private async requireAllBrandBenchmarkAccess(
    principal: StaffPrincipal,
  ): Promise<void> {
    if (principal.user.role === "super_admin") {
      const { data: platformUser, error: platformError } = await this.admin
        .from("platform_users")
        .select("id")
        .eq("id", principal.user.id)
        .eq("active", true)
        .maybeSingle();
      if (!platformError && platformUser) return;
      throw new AppError(
        403,
        "forbidden",
        "Active platform administrator authorization is required.",
      );
    }
    const organizationId = this.organizationId(principal);
    const [staffResult, accessResult] = await Promise.all([
      this.admin
        .from("staff_users")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("id", principal.user.id)
        .eq("status", "active")
        .maybeSingle(),
      this.admin
        .from("organization_staff_access")
        .select("scope")
        .eq("organization_id", organizationId)
        .eq("staff_user_id", principal.user.id)
        .maybeSingle(),
    ]);
    if (
      staffResult.error ||
      accessResult.error ||
      !staffResult.data ||
      accessResult.data?.scope !== "all_brands"
    ) {
      throw new AppError(
        403,
        "forbidden",
        "All-brand benchmark access is not available.",
      );
    }
  }

  async getAnalyticsDashboard(input: {
    from?: string;
    range: AnalyticsRange;
    scope?: "brand" | "all";
    to?: string;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const range = resolveAnalyticsRange(input.range, input);
    if (input.scope === "all") {
      await this.requireAllBrandBenchmarkAccess(principal);
      const organizationId = this.organizationId(principal);
      const { data: brands, error: brandsError } = await this.admin
        .from("brands")
        .select("id,name")
        .eq("organization_id", organizationId)
        .eq("active", true)
        .order("name");
      if (brandsError) {
        throw databaseError("The organization analytics scope could not be loaded.");
      }
      const snapshots = await Promise.all(
        (brands ?? []).map(async (brand) => ({
          brandId: brand.id,
          brandName: brand.name,
          payload: await this.callRpc(
            "get_brand_analytics_dashboard",
            {
              p_brand_id: brand.id,
              p_from: range.from,
              p_organization_id: organizationId,
              p_to: range.to,
            },
            "The organization analytics dashboard could not be loaded.",
          ),
        })),
      );
      const dashboard = aggregateAnalyticsDashboards(snapshots, range);
      await this.recordDomainAnalyticsEvent(principal, {
        eventData: {
          brand_count: snapshots.length,
          range: range.preset,
          scope: "all",
        },
        eventType: "analytics.dashboard_viewed",
        requestKey: `dashboard:all:${range.preset}:${range.from ?? "all"}:${range.to}`,
      });
      return dashboard;
    }
    const brandId = await this.activeBrandId(principal);
    const [payload, layout] = await Promise.all([
      this.callRpc(
        "get_brand_analytics_dashboard",
        {
          p_brand_id: brandId,
          p_from: range.from,
          p_organization_id: this.organizationId(principal),
          p_to: range.to,
        },
        "The analytics dashboard could not be loaded.",
      ),
      this.loadAnalyticsLayout(principal),
    ]);
    const dashboard = normalizeAnalyticsDashboard(payload, range, layout);
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: { range: range.preset },
      eventType: "analytics.dashboard_viewed",
      requestKey: `dashboard:${range.preset}:${range.from ?? "all"}:${range.to}`,
    });
    return dashboard;
  }

  async exportAnalyticsWidget(
    widget: string,
    input: {
      from?: string;
      range: AnalyticsRange;
      scope?: "brand" | "all";
      to?: string;
    },
  ): Promise<{ contents: string; filename: string }> {
    if (!REPORT_WIDGETS.has(widget)) {
      throw new AppError(400, "invalid_request", "The analytics widget is invalid.");
    }
    const dashboard = await this.getAnalyticsDashboard(input);
    const range = resolveAnalyticsRange(input.range, input);
    const principal = await this.requireStaff();
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        range: range.preset,
        scope: input.scope ?? "brand",
        widget,
      },
      eventType: "analytics.widget_exported",
      requestKey: `export:${input.scope ?? "brand"}:${widget}:${range.from ?? "all"}:${range.to}`,
    });
    return {
      contents: encodeCsvRows(exportRows(widget, dashboard)),
      filename: `vinifera-${input.scope === "all" ? "all-brands-" : ""}${widget}-${range.to}.csv`,
    };
  }

  async getAnalyticsLayout(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    return canonicalLayout(await this.loadAnalyticsLayout(principal));
  }

  async saveAnalyticsLayout(input: {
    widgets: Array<{
      enabled: boolean;
      id: string;
      order: number;
      size: "half" | "full";
    }>;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const widgetIds = input.widgets.map((widget) => widget.id);
    if (
      widgetIds.length !== new Set(widgetIds).size ||
      input.widgets.some(
        (widget) =>
          !REPORT_WIDGETS.has(widget.id) ||
          !Number.isInteger(widget.order) ||
          widget.order < 0 ||
          !WIDGET_SIZES.has(widget.size),
      )
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "The dashboard layout contains an invalid or duplicate widget.",
      );
    }
    const payload = await this.callRpc(
      "save_analytics_dashboard_layout",
      {
        p_brand_id: brandId,
        p_organization_id: this.organizationId(principal),
        p_staff_user_id: principal.user.id,
        p_layout: input.widgets.map((widget) => ({
          enabled: widget.enabled,
          order: widget.order,
          size: widget.size,
          widget_id: widget.id,
        })),
      },
      "The analytics layout could not be saved.",
    );
    return canonicalLayout(toPublicRecord(rpcRow(payload) ?? payload));
  }

  async listScheduledAnalyticsReports(): Promise<
    Array<Record<string, unknown>>
  > {
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("analytics_report_schedules")
      .select(
        "id,report_type,frequency,day_of_week,day_of_month,send_hour_utc,enabled,widget_ids,last_enqueued_at,next_report_at,created_at,updated_at",
      )
      .eq("organization_id", this.organizationId(principal))
      .eq("brand_id", brandId)
      .eq("staff_user_id", principal.user.id)
      .eq("report_type", "analytics_summary")
      .order("created_at");
    if (error) throw databaseError("Scheduled analytics reports could not be loaded.");
    return (data ?? []).map((row) => ({
      ...toPublicRecord(row),
      nextSendAt: row.next_report_at,
      recipientEmail: principal.user.email,
    }));
  }

  async upsertScheduledAnalyticsReport(input: {
    enabled: boolean;
    frequency: "weekly" | "monthly";
    id?: string;
    recipientEmail: string;
    widgetIds: string[];
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const recipientEmail = input.recipientEmail
      .trim()
      .toLocaleLowerCase("en-US");
    if (
      recipientEmail !== principal.user.email.trim().toLocaleLowerCase("en-US")
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Scheduled analytics reports can be sent only to your signed-in staff email.",
      );
    }
    if (
      !input.widgetIds.length ||
      input.widgetIds.length !== new Set(input.widgetIds).size ||
      input.widgetIds.some((widgetId) => !REPORT_WIDGETS.has(widgetId))
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Choose one or more unique analytics widgets for this report.",
      );
    }
    const payload = await this.callRpc(
      "upsert_analytics_report_schedule",
      {
        p_day_of_month: input.frequency === "monthly" ? 1 : null,
        p_day_of_week: input.frequency === "weekly" ? 1 : null,
        p_brand_id: brandId,
        p_enabled: input.enabled,
        p_frequency: input.frequency,
        p_organization_id: organizationId,
        p_report_type: "analytics_summary",
        p_send_hour_utc: 8,
        p_staff_user_id: principal.user.id,
        p_widget_ids: input.widgetIds,
      },
      "The analytics report schedule could not be saved.",
    );
    const schedule = toPublicRecord(rpcRow(payload) ?? payload);
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        enabled: input.enabled,
        frequency: input.frequency,
        widgetCount: input.widgetIds.length,
      },
      eventType: "analytics.report_scheduled",
      requestKey: `report:${String(schedule.id ?? principal.user.id)}:${String(
        schedule.updatedAt ?? schedule.createdAt ?? input.frequency,
      )}`,
    });
    return {
      ...schedule,
      recipientEmail,
    };
  }

  async updateScheduledAnalyticsReport(
    reportId: string,
    input: Partial<{
      enabled: boolean;
      frequency: "weekly" | "monthly";
      recipientEmail: string;
      widgetIds: string[];
    }>,
  ): Promise<Record<string, unknown>> {
    assertUuid(reportId, "Report schedule");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data: existing, error } = await this.admin
      .from("analytics_report_schedules")
      .select("id,frequency,enabled,widget_ids")
      .eq("id", reportId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("staff_user_id", principal.user.id)
      .eq("report_type", "analytics_summary")
      .maybeSingle();
    if (error) throw databaseError("The analytics report schedule could not be loaded.");
    if (!existing) {
      throw new AppError(404, "not_found", "Report schedule not found.");
    }
    return this.upsertScheduledAnalyticsReport({
      enabled: input.enabled ?? Boolean(existing.enabled),
      frequency:
        input.frequency ??
        (existing.frequency as "weekly" | "monthly"),
      id: reportId,
      recipientEmail:
        input.recipientEmail ?? principal.user.email,
      widgetIds:
        input.widgetIds ??
        (Array.isArray(existing.widget_ids)
          ? existing.widget_ids.map(String)
          : []),
    });
  }

  async recordAnalyticsEvent(input: {
    eventData?: Record<string, string | number | boolean | null>;
    eventType: string;
    idempotencyKey: string;
    memberId?: string;
  }): Promise<{ accepted: boolean }> {
    void input;
    throw new AppError(
      403,
      "forbidden",
      "Client-authored analytics events are disabled. Analytics facts are recorded only by trusted server-side domain workflows.",
    );
  }

  async acknowledgeHighRiskAlert(
    alertId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(alertId, "High-risk alert");
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const payload = await this.callRpc(
      "acknowledge_ml_high_risk_alert",
      {
        p_actor_user_id: principal.user.id,
        p_alert_id: alertId,
        p_brand_id: brandId,
        p_organization_id: this.organizationId(principal),
      },
      "The high-risk alert could not be acknowledged.",
    );
    const alert = toPublicRecord(rpcRow(payload) ?? payload);
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: { status: "acknowledged" },
      eventType: "churn.alert_acknowledged",
      memberId:
        typeof alert.memberId === "string" ? alert.memberId : null,
      requestKey: `churn-alert:${alertId}:acknowledged`,
    });
    return {
      ...alert,
      status: alert.acknowledgedAt ? "acknowledged" : "open",
    };
  }

  async getMlOperations(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const payload = await this.callRpc(
      "get_ml_operations_status",
      {},
      "ML operations status could not be loaded.",
    );
    return enforceModelGuardrails(normalizeMlOperationsDto(payload));
  }

  async getChurnIntelligence(input: {
    limit: number;
    offset: number;
    riskLevel?: "low" | "medium" | "high";
    search?: string;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const [payload, operationsPayload] = await Promise.all([
      this.callRpc(
        "list_churn_intelligence",
        {
          p_brand_id: brandId,
          p_limit: input.limit,
          p_offset: input.offset,
          p_organization_id: this.organizationId(principal),
          p_risk_level: input.riskLevel ?? null,
          p_search: input.search ?? null,
        },
        "Churn intelligence could not be loaded.",
      ),
      this.callRpc(
        "get_ml_operations_status",
        {},
        "ML operations status could not be loaded.",
      ),
    ]);
    const intelligence = composeChurnIntelligenceDto(
      payload,
      operationsPayload,
    );
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        hasRiskFilter: Boolean(input.riskLevel),
        resultCount: objectRows(intelligence.items).length,
      },
      eventType: "churn.dashboard_viewed",
      requestKey: `churn:${input.riskLevel ?? "all"}:${input.offset}:${dateOnly(
        new Date(),
      )}`,
    });
    return intelligence;
  }

  async getMemberChurnIntelligence(
    memberId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const [payload, operationsPayload] = await Promise.all([
      this.callRpc(
        "get_member_churn_intelligence",
        {
          p_brand_id: brandId,
          p_member_id: memberId,
          p_organization_id: this.organizationId(principal),
        },
        "Member churn intelligence could not be loaded.",
      ),
      this.callRpc(
        "get_ml_operations_status",
        {},
        "ML operations status could not be loaded.",
      ),
    ]);
    const row = rpcRow(payload);
    if (!row) throw new AppError(404, "not_found", "Member not found.");
    return normalizeMemberChurnDto(
      enforceModelGuardrails({
        ...normalizeMlOperationsDto(operationsPayload),
        ...toPublicRecord(row),
      }),
    );
  }

  async getBenchmarkComparison(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    await this.requireAllBrandBenchmarkAccess(principal);
    const planTier = principal.organization?.planTier;
    if (planTier !== "estate" && planTier !== "reserve") {
      await this.recordDomainAnalyticsEvent(principal, {
        eventData: { eligible: false },
        eventType: "benchmark.dashboard_viewed",
        requestKey: `benchmark-view:ineligible:${dateOnly(new Date())}`,
      });
      return {
        eligible: false,
        metrics: [],
        optedIn: false,
        subscriptionTier: planTier,
      };
    }
    const organizationId = this.organizationId(principal);
    const currentQuarter = new Date();
    currentQuarter.setUTCDate(1);
    currentQuarter.setUTCHours(0, 0, 0, 0);
    currentQuarter.setUTCMonth(
      Math.floor(currentQuarter.getUTCMonth() / 3) * 3 - 3,
    );
    const period = dateOnly(currentQuarter);
    const [payload, preferenceResult, reportResult] = await Promise.all([
      this.callRpc(
        "get_benchmark_comparison",
        {
          p_actor_user_id: principal.user.id,
          p_organization_id: organizationId,
          p_period: period,
        },
        "The benchmark comparison could not be loaded.",
      ),
      this.admin
        .from("benchmark_preferences")
        .select("opted_in")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      this.admin
        .from("analytics_report_schedules")
        .select("enabled,last_enqueued_at,next_report_at")
        .eq("organization_id", organizationId)
        .eq("staff_user_id", principal.user.id)
        .eq("report_type", "benchmark")
        .maybeSingle(),
    ]);
    if (preferenceResult.error || reportResult.error) {
      throw databaseError("Benchmark preferences could not be loaded.");
    }
    const comparison = normalizeBenchmarkComparison(payload, {
      optedIn: Boolean(preferenceResult.data?.opted_in),
      period: `${currentQuarter.getUTCFullYear()}-Q${Math.floor(
        currentQuarter.getUTCMonth() / 3,
      ) + 1}`,
      quarterlyReport: {
        enabled: Boolean(reportResult.data?.enabled),
        lastGeneratedAt: reportResult.data?.last_enqueued_at ?? null,
        nextScheduledAt: reportResult.data?.next_report_at ?? null,
      },
      subscriptionTier: planTier,
    });
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        eligible: true,
        optedIn: Boolean(preferenceResult.data?.opted_in),
      },
      eventType: "benchmark.dashboard_viewed",
      requestKey: `benchmark-view:${period}:${dateOnly(new Date())}`,
    });
    return comparison;
  }

  async setBenchmarkOptIn(input: {
    optedIn: boolean;
    quarterlyReportEnabled: boolean;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin"]);
    await this.requireAllBrandBenchmarkAccess(principal);
    const planTier = principal.organization?.planTier;
    if (planTier !== "estate" && planTier !== "reserve") {
      throw new AppError(
        403,
        "forbidden",
        "Peer benchmarks require an Estate or Reserve subscription.",
      );
    }
    const payload = await this.callRpc(
      "set_orgwide_benchmark_preferences",
      {
        p_actor_user_id: principal.user.id,
        p_opted_in: input.optedIn,
        p_organization_id: this.organizationId(principal),
        p_quarterly_report_enabled:
          input.optedIn && input.quarterlyReportEnabled,
      },
      "Benchmark preferences could not be saved.",
    );
    const preference = toPublicRecord(rpcRow(payload) ?? payload);
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        optedIn: input.optedIn,
        quarterlyReportEnabled:
          input.optedIn && input.quarterlyReportEnabled,
      },
      eventType: "benchmark.opted_in",
      requestKey: `benchmark:${this.organizationId(principal)}:${String(
        preference.updatedAt ?? input.optedIn,
      )}`,
    });
    return preference;
  }

  async listComplianceChecks(input: {
    limit: number;
    offset: number;
    releaseId?: string;
    status?: ComplianceStatus;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const payload = await this.callRpc(
      "get_compliance_dashboard",
      {
        p_brand_id: brandId,
        p_limit: input.limit,
        p_offset: input.offset,
        p_organization_id: this.organizationId(principal),
        p_release_id: input.releaseId ?? null,
        p_status: input.status ?? null,
      },
      "The compliance dashboard could not be loaded.",
    );
    const report = getConfigurationReport(this.env).compliance;
    const rawRows = Array.isArray(payload) ? payload.map(toPublicRecord) : null;
    const dashboard = rawRows
      ? {
          items: rawRows.map((row) => ({
            ...row,
            reason:
              row.reason ??
              (row.status ? null : "No compliance check has been completed."),
            responseId: row.providerResponseId ?? null,
            state: row.recipientState ?? null,
            status: row.status ?? "unknown",
          })),
          summary: {
            compliant: rawRows.filter((row) => row.status === "compliant").length,
            nonCompliant: rawRows.filter(
              (row) => row.status === "non_compliant",
            ).length,
            partial:
              numeric(rawRows[0]?.totalCount) > rawRows.length,
            taxEstimateCents: rawRows.reduce(
              (total, row) => total + numeric(row.taxEstimateCents),
              0,
            ),
            totalChecks: numeric(rawRows[0]?.totalCount),
            unknown: rawRows.filter(
              (row) => !row.status || row.status === "unknown",
            ).length,
          },
          total: numeric(rawRows[0]?.totalCount),
        }
      : toPublicRecord(rpcRow(payload) ?? payload);
    const provider = {
      ...objectValue(dashboard.providerStatus),
      ...objectValue(dashboard.provider),
    };
    const latestCheckAt = Date.parse(String(provider.lastCheckedAt ?? ""));
    const lastSuccessfulCheckAt = Date.parse(
      String(provider.lastSuccessfulCheckAt ?? ""),
    );
    const providerStatus = !report.configured
      ? "activation_required"
      : !Number.isFinite(lastSuccessfulCheckAt)
        ? "configured"
        : Number.isFinite(latestCheckAt) &&
            latestCheckAt > lastSuccessfulCheckAt
          ? "degraded"
          : "active";
    const result = {
      ...dashboard,
      provider: {
        ...provider,
        lastSuccessfulCheckAt:
          provider.lastSuccessfulCheckAt ?? null,
        lastRulesRefreshAt:
          provider.lastRulesRefreshAt ?? null,
        lastRulesVersionAt: provider.lastRulesVersionAt ?? null,
        name:
          this.env.COMPLIANCE_PROVIDER === "simulated"
            ? "Test simulator"
            : "ShipCompliant",
        status: providerStatus,
      },
    };
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        hasReleaseFilter: Boolean(input.releaseId),
        hasStatusFilter: Boolean(input.status),
      },
      eventType: "compliance.dashboard_viewed",
      requestKey: `compliance-dashboard:${input.releaseId ?? "all"}:${input.status ?? "all"}:${input.offset}:${dateOnly(new Date())}`,
    });
    return result;
  }

  async getComplianceCheck(
    checkId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(checkId, "Compliance check");
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("compliance_checks")
      .select(
        "id,organization_id,shipment_id,status,reason,tax_estimate_cents,provider_response_id,provider,checked_at,created_at",
      )
      .eq("id", checkId)
      .eq("organization_id", this.organizationId(principal))
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw databaseError("The compliance check could not be loaded.");
    if (!data) {
      throw new AppError(404, "not_found", "Compliance check not found.");
    }
    return toPublicRecord(data);
  }

  async runShipmentComplianceCheck(
    shipmentId: string,
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff([
      "owner",
      "admin",
      "manager",
      "staff",
    ]);
    return this.checkStoredShipmentCompliance(principal, shipmentId);
  }

  async runReleaseComplianceChecks(
    releaseId: string,
  ): Promise<{
    compliant: number;
    nonCompliant: number;
    results: Array<Record<string, unknown>>;
    unknown: number;
  }> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff([
      "owner",
      "admin",
      "manager",
      "staff",
    ]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("shipments")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("release_id", releaseId)
      .eq("status", "charged")
      .order("created_at");
    if (error) throw databaseError("Release shipments could not be loaded.");
    const results: Array<Record<string, unknown>> = [];
    for (const shipment of data ?? []) {
      try {
        results.push(
          await this.checkStoredShipmentCompliance(principal, String(shipment.id)),
        );
      } catch (error) {
        if (error instanceof AppError && error.code === "activation_required") {
          throw error;
        }
        results.push({
          blocksLabel: true,
          reason: "The compliance check could not be completed.",
          shipmentId: shipment.id,
          status: "unknown",
        });
      }
    }
    return {
      compliant: results.filter((row) => row.status === "compliant").length,
      nonCompliant: results.filter((row) => row.status === "non_compliant")
        .length,
      results,
      unknown: results.filter((row) => row.status === "unknown").length,
    };
  }
}

export async function runAnalyticsSchedule(
  env: WorkerEnv,
  asOf = new Date(),
): Promise<{
  benchmarkReportsQueued: number;
  benchmarkSnapshots: number;
  brandSnapshots: number;
  featureSnapshots: number;
  lifecycle: Record<string, unknown>;
  predictions: number;
  reportsQueued: number;
}> {
  const admin = createSupabaseAdminClient(env);
  let reportsQueued = 0;
  let featureSnapshots = 0;
  let predictions = 0;
  let benchmarkSnapshots = 0;
  let brandSnapshots = 0;
  let lifecycleResult: Record<string, unknown> = {};
  const nightly =
    asOf.getUTCHours() === NIGHTLY_ANALYTICS_UTC_HOUR;
  const quarterly =
    asOf.getUTCDate() === 1 &&
    [0, 3, 6, 9].includes(asOf.getUTCMonth()) &&
    nightly;
  const monthly =
    asOf.getUTCDate() === 1 &&
    nightly;
  const failures: Array<{ error: unknown; name: string }> = [];
  await observeScheduleTasks(
    [
      {
        name: "scheduled analytics report queue",
        run: async () => {
          const { data, error } = await admin.rpc(
            "enqueue_due_analytics_reports",
            { p_as_of: asOf.toISOString() },
          );
          if (error) {
            throw databaseError(
              "Scheduled analytics reports could not be queued.",
            );
          }
          reportsQueued = Number(data ?? 0);
        },
      },
      ...(nightly
        ? [
            {
              name: "ordered nightly analytics, drift, and scoring refresh",
              run: async () => {
                const { error: snapshotError } = await admin.rpc(
                  "refresh_analytics_snapshots",
                  {
                    p_as_of: asOf.toISOString(),
                    p_organization_id: null,
                  },
                );
                if (snapshotError) {
                  throw databaseError(
                    "Daily analytics snapshot refresh failed.",
                  );
                }
                const completedMetricDate = dateOnly(
                  new Date(asOf.getTime() - 24 * 60 * 60 * 1_000),
                );
                const { data: brandSnapshotData, error: brandSnapshotError } =
                  await admin.rpc("refresh_brand_analytics_snapshots", {
                    p_brand_id: null,
                    p_metric_date: completedMetricDate,
                    p_organization_id: null,
                  });
                if (brandSnapshotError) {
                  throw databaseError(
                    "Daily brand analytics snapshot refresh failed.",
                  );
                }
                brandSnapshots = Number(brandSnapshotData ?? 0);
                const { data: featureData, error: featureError } =
                  await admin.rpc("refresh_ml_feature_store", {
                    p_organization_id: null,
                    p_snapshot_date: dateOnly(asOf),
                  });
                if (featureError) {
                  throw databaseError("Churn feature refresh failed.");
                }
                featureSnapshots = Number(featureData ?? 0);
                const { data: lifecycleData, error: lifecycleError } =
                  await admin.rpc(
                    "run_ml_lifecycle",
                    { p_as_of: asOf.toISOString() },
                  );
                if (lifecycleError) {
                  throw databaseError("The ML lifecycle run failed.");
                }
                lifecycleResult = toPublicRecord(
                  rpcRow(lifecycleData) ?? lifecycleData,
                );
                if (!shouldRunMlScoringAfterLifecycle(lifecycleResult)) {
                  predictions = 0;
                  return;
                }
                const { data: predictionData, error: predictionError } =
                  await admin.rpc("score_ml_churn_batch", {
                    p_organization_id: null,
                    p_prediction_date: dateOnly(asOf),
                  });
                if (predictionError) {
                  throw databaseError(
                    "Churn prediction scoring failed.",
                  );
                }
                predictions = Number(predictionData ?? 0);
              },
            },
          ]
        : []),
      ...(quarterly
        ? [
            {
              name: "quarterly benchmark aggregate refresh",
              run: async () => {
                const { data, error } = await admin.rpc(
                  "refresh_benchmark_aggregates",
                  { p_period: priorQuarterStart(asOf) },
                );
                if (error) {
                  throw databaseError(
                    "Quarterly benchmark refresh failed.",
                  );
                }
                benchmarkSnapshots = Number(data ?? 0);
              },
            },
          ]
        : []),
    ],
    failures,
  );
  let benchmarkReportsQueued = 0;
  await observeScheduleTasks(
    [
      {
        name: "benchmark report queue",
        run: async () => {
          benchmarkReportsQueued = await enqueueBenchmarkReports(admin, asOf);
        },
      },
    ],
    failures,
  );
  const shouldTrain =
    monthly || lifecycleResult.retrainingTriggered === true;
  await observeScheduleTasks(
    shouldTrain
      ? [
          {
            name: "scheduled ML training and experiment start",
            run: async () => {
              await runScheduledMlTrainingIfNeeded({
                lifecycle: lifecycleResult,
                monthly,
                train: async () => {
                  if (!env.ML_PLATFORM_ACTOR_USER_ID) {
                    lifecycleResult = {
                      ...lifecycleResult,
                      trainingActivationRequired: true,
                    };
                    return;
                  }
                  await runProductionMlTraining(env, {
                    actorUserId: env.ML_PLATFORM_ACTOR_USER_ID,
                    asOf,
                  });
                },
              });
            },
          },
        ]
      : [],
    failures,
  );
  if (failures.length) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `Analytics schedule failures: ${failures
        .map((failure) => failure.name)
        .join(", ")}.`,
    );
  }
  return {
    benchmarkReportsQueued,
    benchmarkSnapshots,
    brandSnapshots,
    featureSnapshots,
    lifecycle: lifecycleResult,
    predictions,
    reportsQueued,
  };
}

export async function observeScheduleTasks(
  tasks: Array<{ name: string; run: () => Promise<void> }>,
  failures: Array<{ error: unknown; name: string }> = [],
): Promise<Array<{ error: unknown; name: string }>> {
  const results = await Promise.allSettled(tasks.map((task) => task.run()));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      failures.push({
        error: result.reason,
        name: tasks[index]?.name ?? `task-${index + 1}`,
      });
    }
  });
  return failures;
}
