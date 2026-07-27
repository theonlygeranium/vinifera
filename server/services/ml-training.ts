import { AppError } from "../lib/errors";

export type MlDataSource = "production_history" | "synthetic_fixture";

export interface MlTrainingExample {
  features: Record<string, number>;
  fold?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  memberId: string;
  observedAt: string;
  outcome: 0 | 1;
  rulesProbability: number;
  split?: "holdout" | "train";
  temporalOrderAt?: string;
}

export interface BinaryMetrics {
  accuracy: number;
  aucRoc: number | null;
  brierScore: number;
  calibration: Array<{
    actualRate: number;
    averageProbability: number;
    count: number;
    upperBound: number;
  }>;
  confusionMatrix: {
    falseNegative: number;
    falsePositive: number;
    trueNegative: number;
    truePositive: number;
  };
  f1: number;
  precision: number;
  recall: number;
}

export interface TemporalLogisticTrainingResult {
  algorithm: "deterministic_l2_logistic_regression";
  coefficients: Record<string, number>;
  dataSource: MlDataSource;
  decisionThreshold: number;
  eligibility: {
    eligibleForExperiment: boolean;
    eligibleForPromotion: false;
    reasons: string[];
  };
  featureMeans: Record<string, number>;
  featureBaselineBins: Record<string, [number, number, number, number]>;
  featureMedians: Record<string, number>;
  featureStandardDeviations: Record<string, number>;
  folds: Array<{
    metrics: BinaryMetrics;
    trainingEndAt: string;
    trainingSize: number;
    validationEndAt: string;
    validationSize: number;
  }>;
  holdout: {
    endAt: string;
    metrics: BinaryMetrics;
    rulesBaseline: BinaryMetrics;
    size: number;
    startAt: string;
  };
  intercept: number;
  provenance: {
    cancellationCount: number;
    featureNames: string[];
    memberCount: number;
    source: MlDataSource;
    temporalSplit: "80/20" | "temporal_80_20_member_disjoint";
    trainingCount: number;
    holdoutCount: number;
    trainerVersion: "vinifera-logistic-v1";
  };
  training: {
    endAt: string;
    size: number;
    startAt: string;
  };
}

interface Standardization {
  means: number[];
  standardDeviations: number[];
}

interface TrainedModel {
  intercept: number;
  weights: number[];
}

const EPSILON = 1e-12;
const FOLD_COUNT = 5;
const ITERATIONS = 800;
const LEARNING_RATE = 0.08;
const L2_PENALTY = 0.02;
export const CHURN_FEATURE_NAMES = [
  "average_shipment_value_cents",
  "days_since_last_email_open",
  "days_since_last_portal_login",
  "days_since_last_shipment",
  "decline_count",
  "decline_recovery_rate",
  "email_click_rate",
  "email_open_rate",
  "email_opens_per_month",
  "loyalty_point_balance",
  "observed_expected_shipment_ratio",
  "portal_logins_per_month",
  "shipments_per_year",
  "tenure_months",
  "tier_change_count",
  "total_lifetime_spend_cents",
] as const;

function upstreamDatasetError(message: string): AppError {
  return new AppError(500, "upstream_error", message);
}

export function decodeMlTrainingDatasetRow(
  value: unknown,
): MlTrainingExample {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw upstreamDatasetError("The ML training dataset row is malformed.");
  }
  const row = value as Record<string, unknown>;
  const featuresValue = row.features;
  if (
    !featuresValue ||
    typeof featuresValue !== "object" ||
    Array.isArray(featuresValue)
  ) {
    throw upstreamDatasetError(
      "The ML training dataset feature vector is malformed.",
    );
  }
  const features: Record<string, number> = {};
  for (const [feature, featureValue] of Object.entries(featuresValue)) {
    if (!(CHURN_FEATURE_NAMES as readonly string[]).includes(feature)) {
      throw upstreamDatasetError(
        `The ML training feature ${feature} is outside vinifera-churn-v1.`,
      );
    }
    if (featureValue === null) continue;
    if (typeof featureValue !== "number" || !Number.isFinite(featureValue)) {
      throw upstreamDatasetError(
        `The ML training feature ${feature} is not a finite number.`,
      );
    }
    features[feature] = featureValue;
  }
  const memberId =
    typeof row.member_id === "string" && row.member_id
      ? row.member_id
      : typeof row.row_id === "string" && row.row_id
        ? row.row_id
        : null;
  const observedAt =
    typeof row.observed_at === "string" ? row.observed_at : null;
  const temporalOrderAt =
    typeof row.temporal_order_at === "string"
      ? row.temporal_order_at
      : null;
  const split =
    row.split === "train" || row.split === "holdout" ? row.split : null;
  const fold =
    row.fold === null || row.fold === undefined
      ? null
      : typeof row.fold === "number" &&
          Number.isInteger(row.fold) &&
          row.fold >= 0 &&
          row.fold <= FOLD_COUNT
        ? (row.fold as 0 | 1 | 2 | 3 | 4 | 5)
        : undefined;
  const rulesProbability = row.rules_probability;
  if (
    !memberId ||
    !observedAt ||
    !temporalOrderAt ||
    !split ||
    fold === undefined ||
    (split === "holdout" && fold !== null) ||
    (split === "train" && fold === null) ||
    typeof row.churned_within_90_days !== "boolean" ||
    typeof rulesProbability !== "number" ||
    !Number.isFinite(rulesProbability) ||
    rulesProbability < 0 ||
    rulesProbability > 1
  ) {
    throw upstreamDatasetError(
      "The ML training dataset provenance is malformed.",
    );
  }
  if (
    !Number.isFinite(Date.parse(observedAt)) ||
    !Number.isFinite(Date.parse(temporalOrderAt))
  ) {
    throw upstreamDatasetError(
      "The ML training dataset timestamps are malformed.",
    );
  }
  return {
    features,
    fold,
    memberId,
    observedAt,
    outcome: row.churned_within_90_days ? 1 : 0,
    rulesProbability,
    split,
    temporalOrderAt,
  };
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function parseTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new AppError(
      400,
      "invalid_request",
      `${label} must be a valid ISO timestamp.`,
    );
  }
  return timestamp;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exponential = Math.exp(-Math.min(value, 40));
    return 1 / (1 + exponential);
  }
  const exponential = Math.exp(Math.max(value, -40));
  return exponential / (1 + exponential);
}

function rawFeatureVector(
  row: MlTrainingExample,
  featureNames: string[],
): Array<number | null> {
  return featureNames.map((name) => {
    const value = row.features[name];
    if (value === undefined || value === null) return null;
    if (!Number.isFinite(value)) {
      throw new AppError(
        400,
        "invalid_request",
        `ML feature ${name} must be finite.`,
      );
    }
    return value;
  });
}

function featureMedians(matrix: Array<Array<number | null>>): number[] {
  const width = matrix[0]?.length ?? 0;
  return Array.from({ length: width }, (_, column) => {
    const values = matrix
      .map((row) => row[column])
      .filter((value): value is number => value !== null && value !== undefined)
      .sort((left, right) => left - right);
    if (!values.length) {
      throw new AppError(
        400,
        "invalid_request",
        `ML feature ${CHURN_FEATURE_NAMES[column] ?? column} has no training values.`,
      );
    }
    const middle = Math.floor(values.length / 2);
    return values.length % 2
      ? (values[middle] ?? 0)
      : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
  });
}

function impute(
  matrix: Array<Array<number | null>>,
  medians: number[],
): number[][] {
  return matrix.map((row) =>
    row.map((value, column) => value ?? medians[column] ?? 0),
  );
}

function standardization(matrix: number[][]): Standardization {
  const width = matrix[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, column) =>
    matrix.reduce((sum, row) => sum + (row[column] ?? 0), 0) /
    Math.max(1, matrix.length),
  );
  const standardDeviations = means.map((mean, column) => {
    const variance =
      matrix.reduce((sum, row) => {
        const difference = (row[column] ?? 0) - mean;
        return sum + difference * difference;
      }, 0) / Math.max(1, matrix.length);
    const deviation = Math.sqrt(variance);
    return deviation > EPSILON ? deviation : 1;
  });
  return { means, standardDeviations };
}

function normalize(
  vector: number[],
  parameters: Standardization,
): number[] {
  return vector.map(
    (value, index) =>
      (value - (parameters.means[index] ?? 0)) /
      (parameters.standardDeviations[index] ?? 1),
  );
}

function featureBaselineBins(
  matrix: number[][],
  featureNames: string[],
): Record<string, [number, number, number, number]> {
  return Object.fromEntries(
    featureNames.map((feature, column) => {
      const counts = [0, 0, 0, 0];
      for (const row of matrix) {
        const value = row[column] ?? 0;
        const bin = value < -1 ? 0 : value < 0 ? 1 : value < 1 ? 2 : 3;
        counts[bin] = (counts[bin] ?? 0) + 1;
      }
      // Jeffreys smoothing prevents a zero training share from making PSI
      // undefined while preserving the observed training distribution.
      const denominator = matrix.length + counts.length * 0.5;
      return [
        feature,
        counts.map((count) => round((count + 0.5) / denominator)) as [
          number,
          number,
          number,
          number,
        ],
      ];
    }),
  );
}

function train(
  matrix: number[][],
  labels: number[],
  options: {
    iterations?: number;
    l2Penalty?: number;
    learningRate?: number;
  } = {},
): TrainedModel {
  const width = matrix[0]?.length ?? 0;
  let weights = Array.from({ length: width }, () => 0);
  let intercept = 0;
  const count = Math.max(1, matrix.length);
  const iterations = options.iterations ?? ITERATIONS;
  const learningRate = options.learningRate ?? LEARNING_RATE;
  const l2Penalty = options.l2Penalty ?? L2_PENALTY;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const weightGradient = Array.from({ length: width }, () => 0);
    let interceptGradient = 0;
    for (const [rowIndex, row] of matrix.entries()) {
      const linear = row.reduce(
        (sum, value, column) => sum + value * (weights[column] ?? 0),
        intercept,
      );
      const error = sigmoid(linear) - (labels[rowIndex] ?? 0);
      interceptGradient += error;
      for (let column = 0; column < width; column += 1) {
        weightGradient[column] =
          (weightGradient[column] ?? 0) + error * (row[column] ?? 0);
      }
    }
    intercept -= learningRate * (interceptGradient / count);
    weights = weights.map(
      (weight, column) =>
        weight -
        learningRate *
          ((weightGradient[column] ?? 0) / count + l2Penalty * weight),
    );
  }
  return { intercept, weights };
}

function predict(model: TrainedModel, matrix: number[][]): number[] {
  return matrix.map((row) =>
    sigmoid(
      row.reduce(
        (sum, value, column) =>
          sum + value * (model.weights[column] ?? 0),
        model.intercept,
      ),
    ),
  );
}

export function rocAuc(labels: number[], probabilities: number[]): number | null {
  const positives = labels.filter((label) => label === 1).length;
  const negatives = labels.length - positives;
  if (!positives || !negatives || labels.length !== probabilities.length) {
    return null;
  }
  const sorted = probabilities
    .map((probability, index) => ({
      label: labels[index] ?? 0,
      probability,
    }))
    .sort((left, right) => left.probability - right.probability);
  let positiveRankSum = 0;
  let position = 0;
  while (position < sorted.length) {
    let end = position + 1;
    while (
      end < sorted.length &&
      sorted[end]?.probability === sorted[position]?.probability
    ) {
      end += 1;
    }
    const averageRank = (position + 1 + end) / 2;
    for (let index = position; index < end; index += 1) {
      if (sorted[index]?.label === 1) positiveRankSum += averageRank;
    }
    position = end;
  }
  return round(
    (positiveRankSum - (positives * (positives + 1)) / 2) /
      (positives * negatives),
  );
}

export function evaluateBinaryPredictions(
  labels: number[],
  probabilities: number[],
  threshold = 0.5,
): BinaryMetrics {
  if (!labels.length || labels.length !== probabilities.length) {
    throw new AppError(
      400,
      "invalid_request",
      "Evaluation labels and probabilities must have equal non-zero length.",
    );
  }
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let brier = 0;
  const bins = Array.from({ length: 10 }, () => ({
    count: 0,
    outcomes: 0,
    probabilities: 0,
  }));
  for (const [index, label] of labels.entries()) {
    const probability = probabilities[index] ?? 0;
    if (
      (label !== 0 && label !== 1) ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Binary evaluation values are invalid.",
      );
    }
    const predicted = probability >= threshold ? 1 : 0;
    if (predicted === 1 && label === 1) truePositive += 1;
    if (predicted === 0 && label === 0) trueNegative += 1;
    if (predicted === 1 && label === 0) falsePositive += 1;
    if (predicted === 0 && label === 1) falseNegative += 1;
    brier += (probability - label) ** 2;
    const bin = bins[Math.min(9, Math.floor(probability * 10))];
    if (bin) {
      bin.count += 1;
      bin.outcomes += label;
      bin.probabilities += probability;
    }
  }
  const precision =
    truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  return {
    accuracy: round(
      (truePositive + trueNegative) / Math.max(1, labels.length),
    ),
    aucRoc: rocAuc(labels, probabilities),
    brierScore: round(brier / labels.length),
    calibration: bins
      .map((bin, index) => ({
        actualRate: round(bin.outcomes / Math.max(1, bin.count)),
        averageProbability: round(
          bin.probabilities / Math.max(1, bin.count),
        ),
        count: bin.count,
        upperBound: (index + 1) / 10,
      }))
      .filter((bin) => bin.count > 0),
    confusionMatrix: {
      falseNegative,
      falsePositive,
      trueNegative,
      truePositive,
    },
    f1: round((2 * precision * recall) / Math.max(EPSILON, precision + recall)),
    precision: round(precision),
    recall: round(recall),
  };
}

export function selectDecisionThreshold(
  labels: number[],
  probabilities: number[],
): number {
  if (!labels.length || labels.length !== probabilities.length) {
    throw new AppError(
      400,
      "invalid_request",
      "Threshold labels and probabilities must have equal non-zero length.",
    );
  }
  const sortedProbabilities = [...new Set(probabilities)]
    .filter(
      (probability) =>
        Number.isFinite(probability) && probability >= 0 && probability <= 1,
    )
    .sort((left, right) => left - right);
  if (sortedProbabilities.length !== probabilities.length) {
    for (const probability of probabilities) {
      if (
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1
      ) {
        throw new AppError(
          400,
          "invalid_request",
          "Threshold probabilities must be between 0 and 1.",
        );
      }
    }
  }
  const candidates = [
    0.5,
    ...sortedProbabilities,
    ...sortedProbabilities.slice(0, -1).map(
      (probability, index) =>
        (probability + (sortedProbabilities[index + 1] ?? probability)) / 2,
    ),
  ].filter((threshold) => threshold >= 0.05 && threshold <= 0.95);
  let bestThreshold = 0.5;
  let bestF1 = -1;
  let bestBalancedAccuracy = -1;
  for (const threshold of candidates) {
    const metrics = evaluateBinaryPredictions(
      labels,
      probabilities,
      threshold,
    );
    const { falseNegative, falsePositive, trueNegative, truePositive } =
      metrics.confusionMatrix;
    const sensitivity =
      truePositive / Math.max(1, truePositive + falseNegative);
    const specificity =
      trueNegative / Math.max(1, trueNegative + falsePositive);
    const balancedAccuracy = (sensitivity + specificity) / 2;
    if (
      metrics.f1 > bestF1 + EPSILON ||
      (Math.abs(metrics.f1 - bestF1) <= EPSILON &&
        balancedAccuracy > bestBalancedAccuracy + EPSILON) ||
      (Math.abs(metrics.f1 - bestF1) <= EPSILON &&
        Math.abs(balancedAccuracy - bestBalancedAccuracy) <= EPSILON &&
        Math.abs(threshold - 0.5) < Math.abs(bestThreshold - 0.5))
    ) {
      bestF1 = metrics.f1;
      bestBalancedAccuracy = balancedAccuracy;
      bestThreshold = threshold;
    }
  }
  return round(bestThreshold);
}

function rulesProbabilities(rows: MlTrainingExample[]): number[] {
  return rows.map((row) => {
    const probability =
      row.rulesProbability > 1
        ? row.rulesProbability / 100
        : row.rulesProbability;
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new AppError(
        400,
        "invalid_request",
        "Rules probabilities must be between 0 and 1 or scores between 0 and 100.",
      );
    }
    return probability;
  });
}

function sortedTrainingRows(rows: MlTrainingExample[]): MlTrainingExample[] {
  if (rows.length < 30) {
    throw new AppError(
      400,
      "invalid_request",
      "At least 30 labeled temporal examples are required to evaluate a model.",
    );
  }
  const memberIds = new Set<string>();
  const hasAssignedSplit = rows.some((row) => row.split !== undefined);
  return [...rows]
    .map((row) => {
      if (!row.memberId || memberIds.has(row.memberId)) {
        throw new AppError(
          400,
          "invalid_request",
          "Each ML training row must represent one unique member.",
        );
      }
      memberIds.add(row.memberId);
      parseTimestamp(row.observedAt, "ML observation timestamp");
      if (hasAssignedSplit && !row.temporalOrderAt) {
        throw new AppError(
          400,
          "invalid_request",
          "Assigned ML rows require an explicit temporal cohort timestamp.",
        );
      }
      parseTimestamp(
        row.temporalOrderAt ?? row.observedAt,
        "ML temporal cohort timestamp",
      );
      if (
        Date.parse(row.temporalOrderAt ?? row.observedAt) >
        Date.parse(row.observedAt)
      ) {
        throw new AppError(
          400,
          "invalid_request",
          "ML temporal cohort timestamps cannot follow feature observations.",
        );
      }
      if (row.outcome !== 0 && row.outcome !== 1) {
        throw new AppError(
          400,
          "invalid_request",
          "ML outcomes must be binary.",
        );
      }
      if (
        hasAssignedSplit &&
        (row.split === undefined ||
          (row.split === "holdout" && row.fold != null) ||
          (row.split === "train" &&
            (!Number.isInteger(row.fold) ||
              Number(row.fold) < 0 ||
              Number(row.fold) > FOLD_COUNT)))
      ) {
        throw new AppError(
          400,
          "invalid_request",
          "Assigned ML rows require holdout/fold-null or train/fold-0-through-5 provenance.",
        );
      }
      const unknownFeatures = Object.keys(row.features).filter(
        (feature) =>
          !(CHURN_FEATURE_NAMES as readonly string[]).includes(feature),
      );
      if (unknownFeatures.length) {
        throw new AppError(
          400,
          "invalid_request",
          `The ML row contains features outside vinifera-churn-v1: ${unknownFeatures.join(", ")}.`,
        );
      }
      return row;
    })
    .sort(
      (left, right) =>
        Date.parse(left.temporalOrderAt ?? left.observedAt) -
          Date.parse(right.temporalOrderAt ?? right.observedAt) ||
        Date.parse(left.observedAt) - Date.parse(right.observedAt) ||
        left.memberId.localeCompare(right.memberId),
    );
}

function requireAssignedTemporalProvenance(
  trainingRows: MlTrainingExample[],
  holdoutRows: MlTrainingExample[],
): void {
  const latestTrainingObservation = Math.max(
    ...trainingRows.map((row) => Date.parse(row.observedAt)),
  );
  const earliestHoldoutObservation = Math.min(
    ...holdoutRows.map((row) => Date.parse(row.observedAt)),
  );
  if (latestTrainingObservation >= earliestHoldoutObservation) {
    throw new AppError(
      400,
      "invalid_request",
      "Assigned ML training observations must strictly precede holdout observations.",
    );
  }
  const latestTrainingCohort = Math.max(
    ...trainingRows.map((row) =>
      Date.parse(row.temporalOrderAt ?? row.observedAt),
    ),
  );
  const earliestHoldoutCohort = Math.min(
    ...holdoutRows.map((row) =>
      Date.parse(row.temporalOrderAt ?? row.observedAt),
    ),
  );
  if (latestTrainingCohort > earliestHoldoutCohort) {
    throw new AppError(
      400,
      "invalid_request",
      "Assigned ML holdout cohorts must not precede training cohorts.",
    );
  }
  const assignedFolds = new Set(trainingRows.map((row) => Number(row.fold)));
  if (
    assignedFolds.size !== FOLD_COUNT + 1 ||
    !Array.from({ length: FOLD_COUNT + 1 }, (_, fold) => fold).every((fold) =>
      assignedFolds.has(fold),
    )
  ) {
    throw new AppError(
      400,
      "invalid_request",
      "Assigned ML provenance requires contiguous temporal cohorts 0 through 5.",
    );
  }
  for (let validationFold = 1; validationFold <= FOLD_COUNT; validationFold += 1) {
    const earlier = trainingRows.filter(
      (row) => Number(row.fold) < validationFold,
    );
    const validation = trainingRows.filter(
      (row) => Number(row.fold) === validationFold,
    );
    const latestEarlierCohort = Math.max(
      ...earlier.map((row) =>
        Date.parse(row.temporalOrderAt ?? row.observedAt),
      ),
    );
    const earliestValidationCohort = Math.min(
      ...validation.map((row) =>
        Date.parse(row.temporalOrderAt ?? row.observedAt),
      ),
    );
    if (latestEarlierCohort > earliestValidationCohort) {
      throw new AppError(
        400,
        "invalid_request",
        "Assigned ML folds must preserve expanding temporal-cohort order.",
      );
    }
  }
}

export function trainTemporalLogisticModel(
  inputRows: MlTrainingExample[],
  dataSource: MlDataSource,
): TemporalLogisticTrainingResult {
  const rows = sortedTrainingRows(inputRows);
  const featureNames = [...CHURN_FEATURE_NAMES];
  const hasAssignedSplit = rows.some((row) => row.split !== undefined);
  const splitIndex = Math.max(
    1,
    Math.min(rows.length - 1, Math.floor(rows.length * 0.8)),
  );
  const trainingRows = hasAssignedSplit
    ? rows.filter((row) => row.split === "train")
    : rows.slice(0, splitIndex);
  const holdoutRows = hasAssignedSplit
    ? rows.filter((row) => row.split === "holdout")
    : rows.slice(splitIndex);
  if (!trainingRows.length || !holdoutRows.length) {
    throw new AppError(
      400,
      "invalid_request",
      "ML provenance must include non-empty training and holdout partitions.",
    );
  }
  if (hasAssignedSplit) {
    requireAssignedTemporalProvenance(trainingRows, holdoutRows);
  }
  const trainingNullable = trainingRows.map((row) =>
    rawFeatureVector(row, featureNames),
  );
  const medians = featureMedians(trainingNullable);
  const trainingRaw = impute(trainingNullable, medians);
  const parameters = standardization(trainingRaw);
  const trainingMatrix = trainingRaw.map((row) => normalize(row, parameters));
  const baselineBins = featureBaselineBins(trainingMatrix, featureNames);
  const holdoutMatrix = holdoutRows
    .map((row) => rawFeatureVector(row, featureNames))
    .map((row) => row.map((value, column) => value ?? medians[column] ?? 0))
    .map((row) => normalize(row, parameters));
  const model = train(
    trainingMatrix,
    trainingRows.map((row) => row.outcome),
  );
  const holdoutLabels = holdoutRows.map((row) => row.outcome);
  const holdoutProbabilities = predict(model, holdoutMatrix);

  const foldEvaluations: Array<{
    probabilities: number[];
    trainingEndAt: string;
    trainingSize: number;
    validationEndAt: string;
    validationLabels: number[];
    validationSize: number;
  }> = [];
  const blockSize = Math.max(
    1,
    Math.floor(trainingRows.length / (FOLD_COUNT + 1)),
  );
  for (let fold = 0; fold < FOLD_COUNT; fold += 1) {
    const assignedFold = fold + 1;
    const validationStart = Math.min(
      trainingRows.length - 1,
      blockSize * assignedFold,
    );
    const validationEnd =
      fold === FOLD_COUNT - 1
        ? trainingRows.length
        : Math.min(trainingRows.length, validationStart + blockSize);
    const foldTraining = hasAssignedSplit
      ? trainingRows.filter((row) => Number(row.fold) < assignedFold)
      : trainingRows.slice(0, validationStart);
    const foldValidation = hasAssignedSplit
      ? trainingRows.filter((row) => row.fold === assignedFold)
      : trainingRows.slice(validationStart, validationEnd);
    if (!foldTraining.length || !foldValidation.length) continue;
    const foldNullable = foldTraining.map((row) =>
      rawFeatureVector(row, featureNames),
    );
    const foldMedians = featureMedians(foldNullable);
    const foldRaw = impute(foldNullable, foldMedians);
    const foldParameters = standardization(foldRaw);
    const foldModel = train(
      foldRaw.map((row) => normalize(row, foldParameters)),
      foldTraining.map((row) => row.outcome),
    );
    const probabilities = predict(
      foldModel,
      foldValidation
        .map((row) => rawFeatureVector(row, featureNames))
        .map((row) =>
          row.map(
            (value, column) => value ?? foldMedians[column] ?? 0,
          ),
        )
        .map((row) => normalize(row, foldParameters)),
    );
    foldEvaluations.push({
      probabilities,
      trainingEndAt: foldTraining.at(-1)?.observedAt ?? "",
      trainingSize: foldTraining.length,
      validationEndAt: foldValidation.at(-1)?.observedAt ?? "",
      validationLabels: foldValidation.map((row) => row.outcome),
      validationSize: foldValidation.length,
    });
  }
  const outOfFoldLabels = foldEvaluations.flatMap(
    (fold) => fold.validationLabels,
  );
  const outOfFoldProbabilities = foldEvaluations.flatMap(
    (fold) => fold.probabilities,
  );
  const decisionThreshold = outOfFoldLabels.length
    ? selectDecisionThreshold(outOfFoldLabels, outOfFoldProbabilities)
    : 0.5;
  const folds: TemporalLogisticTrainingResult["folds"] = foldEvaluations.map(
    (fold) => ({
      metrics: evaluateBinaryPredictions(
        fold.validationLabels,
        fold.probabilities,
        decisionThreshold,
      ),
      trainingEndAt: fold.trainingEndAt,
      trainingSize: fold.trainingSize,
      validationEndAt: fold.validationEndAt,
      validationSize: fold.validationSize,
    }),
  );
  const holdoutMetrics = evaluateBinaryPredictions(
    holdoutLabels,
    holdoutProbabilities,
    decisionThreshold,
  );
  const rulesBaseline = evaluateBinaryPredictions(
    holdoutLabels,
    rulesProbabilities(holdoutRows),
  );
  const cancellationCount = rows.reduce(
    (sum, row) => sum + row.outcome,
    0,
  );
  const reasons: string[] = [];
  if (dataSource !== "production_history") {
    reasons.push("Synthetic fixture provenance can never activate a production model.");
  }
  if (rows.length < 500) reasons.push("At least 500 members are required.");
  if (cancellationCount < 50) {
    reasons.push("At least 50 observed cancellations are required.");
  }
  if (
    folds.length !== FOLD_COUNT ||
    folds.some((fold) => fold.metrics.aucRoc === null)
  ) {
    reasons.push("Exactly five evaluable temporal validation folds are required.");
  }
  if (
    holdoutMetrics.aucRoc === null ||
    holdoutMetrics.aucRoc < 0.82
  ) {
    reasons.push("Temporal holdout ROC AUC is below 0.82.");
  }
  if (
    rulesBaseline.aucRoc !== null &&
    holdoutMetrics.aucRoc !== null &&
    holdoutMetrics.aucRoc <= rulesBaseline.aucRoc
  ) {
    reasons.push("The candidate did not outperform the rules baseline.");
  }
  return {
    algorithm: "deterministic_l2_logistic_regression",
    coefficients: Object.fromEntries(
      featureNames.map((name, index) => [
        name,
        round(model.weights[index] ?? 0),
      ]),
    ),
    dataSource,
    decisionThreshold,
    eligibility: {
      eligibleForExperiment: reasons.length === 0,
      eligibleForPromotion: false,
      reasons: [
        ...reasons,
        "Production promotion additionally requires a completed 30-day A/B test with superior validated outcomes.",
      ],
    },
    featureMeans: Object.fromEntries(
      featureNames.map((name, index) => [
        name,
        round(parameters.means[index] ?? 0),
      ]),
    ),
    featureBaselineBins: baselineBins,
    featureMedians: Object.fromEntries(
      featureNames.map((name, index) => [name, round(medians[index] ?? 0)]),
    ),
    featureStandardDeviations: Object.fromEntries(
      featureNames.map((name, index) => [
        name,
        round(parameters.standardDeviations[index] ?? 1),
      ]),
    ),
    folds,
    holdout: {
      endAt: holdoutRows.at(-1)?.observedAt ?? "",
      metrics: holdoutMetrics,
      rulesBaseline,
      size: holdoutRows.length,
      startAt: holdoutRows[0]?.observedAt ?? "",
    },
    intercept: round(model.intercept),
    provenance: {
      cancellationCount,
      featureNames,
      memberCount: rows.length,
      source: dataSource,
      temporalSplit: hasAssignedSplit
        ? "temporal_80_20_member_disjoint"
        : "80/20",
      trainingCount: trainingRows.length,
      holdoutCount: holdoutRows.length,
      trainerVersion: "vinifera-logistic-v1",
    },
    training: {
      endAt: trainingRows.at(-1)?.observedAt ?? "",
      size: trainingRows.length,
      startAt: trainingRows[0]?.observedAt ?? "",
    },
  };
}
