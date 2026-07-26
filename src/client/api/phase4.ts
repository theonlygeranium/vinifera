export type AnalyticsRangePreset =
  | "7d"
  | "30d"
  | "90d"
  | "12m"
  | "all"
  | "custom";

export interface AnalyticsRange {
  preset: AnalyticsRangePreset;
  from?: string | null;
  to?: string | null;
}

export interface AnalyticsSummary {
  mrrCents: number;
  arrCents: number;
  arpmCents: number;
  revenueChurnCents: number;
  activeMembers: number;
  memberGrowthRate: number;
  averageLtvCents: number;
  fulfillmentRate: number;
  averageShipmentValueCents: number;
  declineRate: number;
  shippingCostRatio: number;
  emailOpenRate: number;
  emailClickRate: number;
  portalLogins: number;
  portalLoginsPerMember: number;
  loyaltyPointsRedeemed: number;
  loyaltyRedemptionRate: number;
}

export interface AnalyticsWidgetLayout {
  id: string;
  enabled: boolean;
  order: number;
  size: "full" | "half";
}

export interface AnalyticsDashboard {
  range: AnalyticsRange;
  generatedAt?: string | null;
  summary: AnalyticsSummary;
  revenue: {
    byTier: Array<{
      tierId: string;
      tierName: string;
      mrrCents: number;
      arrCents: number;
      memberCount: number;
    }>;
    trend: Array<{
      period: string;
      mrrCents: number;
      arrCents: number;
      arpmCents: number;
      revenueChurnCents: number;
    }>;
  };
  members: {
    trend: Array<{
      period: string;
      active: number;
      newMembers: number;
      cancelled: number;
      netGrowth: number;
    }>;
    cohorts: Array<{ cohort: string; values: Array<number | null> }>;
    ltvByTier: Array<{ tierId: string; tierName: string; ltvCents: number }>;
    tenureDistribution: Array<{ bucket: string; members: number }>;
  };
  shipments: {
    trend: Array<{
      period: string;
      attempted: number;
      charged: number;
      declined: number;
      fulfillmentRate: number;
      averageValueCents: number;
      shippingCostCents: number;
      revenueCents: number;
    }>;
    declineReasons: Array<{ reason: string; count: number; rate: number }>;
  };
  engagement: {
    trend: Array<{
      period: string;
      emailOpenRate: number;
      emailClickRate: number;
      portalLoginsPerMember: number;
      loyaltyRedemptionRate: number;
    }>;
    acquisition: Array<{
      source: string;
      members: number;
      conversionRate: number;
      cacCents: number;
    }>;
  };
  availableWidgets: Array<{
    id: string;
    title: string;
    category: string;
    defaultSize: "full" | "half";
  }>;
  layout: { widgets: AnalyticsWidgetLayout[] };
}

export interface ScheduledReport {
  id: string;
  frequency: "weekly" | "monthly";
  recipientEmail: string;
  enabled: boolean;
  widgetIds: string[];
  lastSentAt?: string | null;
  nextSendAt?: string | null;
}

export type ChurnIntelligenceMode =
  | "ab_test"
  | "ml"
  | "rules_fallback";

export interface ChurnIntelligenceFactor {
  id: string;
  label: string;
  detail: string;
  impact: number;
  shapValue?: number | null;
  direction: "raises" | "lowers";
}

export interface ChurnIntelligenceItem {
  memberId: string;
  memberName: string;
  email?: string | null;
  tierName?: string | null;
  mlScore?: number | null;
  rulesScore: number;
  confidenceBandLow?: number | null;
  confidenceBandHigh?: number | null;
  riskLevel: "low" | "medium" | "high";
  source: "ml" | "rules";
  calculatedAt: string;
  topFeatures: ChurnIntelligenceFactor[];
  alert?: {
    id: string;
    status: "open" | "acknowledged";
    createdAt?: string | null;
    acknowledgedAt?: string | null;
    acknowledgedByName?: string | null;
  } | null;
}

export interface ChurnIntelligence {
  mode: ChurnIntelligenceMode;
  fallbackReason?: string | null;
  model?: {
    version: string;
    algorithm: string;
    trainedAt?: string | null;
    trainingDataSize: number;
    metrics: {
      aucRoc?: number | null;
      accuracy?: number | null;
      precision?: number | null;
      recall?: number | null;
      f1?: number | null;
    };
  } | null;
  abTest?: {
    startedAt?: string | null;
    endsAt?: string | null;
    mlAccuracy?: number | null;
    rulesAccuracy?: number | null;
    sampleSize: number;
  } | null;
  drift?: {
    status: "stable" | "warning" | "retraining";
    score?: number | null;
    lastCheckedAt?: string | null;
  } | null;
  items: ChurnIntelligenceItem[];
}

export interface BenchmarksDashboard {
  eligible: boolean;
  subscriptionTier: string;
  optedIn: boolean;
  minimumPeerCount: number;
  peerGroup?: {
    region?: string | null;
    tierDistribution?: string | null;
    memberCountBand?: string | null;
  } | null;
  period?: string | null;
  generatedAt?: string | null;
  metrics: Array<{
    id: string;
    label: string;
    unit: "cents" | "count" | "percent" | "months" | "number";
    organizationValue: number;
    peerMedian: number;
    percentile?: number | null;
    peerP25?: number | null;
    peerP75?: number | null;
    sampleCountBand: string;
  }>;
  quarterlyReport: {
    enabled: boolean;
    lastGeneratedAt?: string | null;
    nextScheduledAt?: string | null;
  };
}

export type ComplianceStatus =
  | "compliant"
  | "non_compliant"
  | "unknown";

export interface ComplianceDashboard {
  provider: {
    name: string;
    status: "active" | "configured" | "activation_required" | "degraded";
    lastSuccessfulCheckAt?: string | null;
  };
  summary: {
    totalChecks: number;
    compliant: number;
    nonCompliant: number;
    unknown: number;
    taxEstimateCents: number;
  };
  items: Array<{
    id: string;
    shipmentId: string;
    shipmentStatus?: string | null;
    memberId?: string | null;
    memberName: string;
    releaseId?: string | null;
    releaseName?: string | null;
    state?: string | null;
    status: ComplianceStatus;
    reason?: string | null;
    taxEstimateCents?: number | null;
    responseId?: string | null;
    checkedAt?: string | null;
  }>;
  total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : {};
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function optionalString(value: unknown) {
  const result = stringValue(value);
  return result || null;
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeRate(value: unknown) {
  const parsed = numberValue(value);
  return parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
}

function normalizeSize(value: unknown): "full" | "half" {
  return value === "full" ? "full" : "half";
}

export function normalizeAnalyticsDashboard(
  value: unknown,
): AnalyticsDashboard {
  const source = recordValue(value);
  const range = recordValue(source.range ?? source.period);
  const summary = recordValue(source.summary);
  const revenue = recordValue(source.revenue);
  const members = recordValue(source.members);
  const shipments = recordValue(source.shipments);
  const engagement = recordValue(source.engagement);
  const layout = recordValue(source.layout);
  const series = arrayValue(source.series);
  const tierDistribution = arrayValue(source.tierDistribution);
  const cohortRetention = arrayValue(
    members.cohortRetention ?? source.cohortRetention,
  );
  const tenureDistribution = arrayValue(
    members.tenureDistribution ?? source.tenureDistribution,
  );
  const groupedCohorts = new Map<string, Array<number | null>>();
  for (const candidate of cohortRetention) {
    const item = recordValue(candidate);
    const cohort = stringValue(item.cohort ?? item.cohortMonth);
    const month = numberValue(item.monthsSinceJoin, -1);
    if (!cohort || month < 0) continue;
    const values = groupedCohorts.get(cohort) ?? [];
    while (values.length <= month) values.push(null);
    values[month] =
      item.retentionRate == null ? null : normalizeRate(item.retentionRate);
    groupedCohorts.set(cohort, values);
  }
  const preset = stringValue(range.preset ?? source.rangePreset, "30d");
  const activeMembers = numberValue(
    summary.activeMembers ?? members.activeMembers ?? members.active,
  );
  const netGrowth = numberValue(members.netGrowth);

  return {
    range: {
      preset: ["7d", "30d", "90d", "12m", "all", "custom"].includes(preset)
        ? (preset as AnalyticsRangePreset)
        : "30d",
      from: optionalString(range.from),
      to: optionalString(range.to),
    },
    generatedAt: optionalString(source.generatedAt),
    summary: {
      mrrCents: numberValue(summary.mrrCents ?? revenue.mrrCents),
      arrCents: numberValue(summary.arrCents ?? revenue.arrCents),
      arpmCents: numberValue(summary.arpmCents ?? revenue.arpmCents),
      revenueChurnCents: numberValue(
        summary.revenueChurnCents ?? revenue.revenueChurnCents,
      ),
      activeMembers,
      memberGrowthRate:
        summary.memberGrowthRate == null
          ? activeMembers > netGrowth
            ? netGrowth / (activeMembers - netGrowth)
            : 0
          : normalizeRate(summary.memberGrowthRate),
      averageLtvCents: numberValue(
        summary.averageLtvCents ?? members.averageLtvCents,
      ),
      fulfillmentRate: normalizeRate(
        summary.fulfillmentRate ?? shipments.fulfillmentRate,
      ),
      averageShipmentValueCents: numberValue(
        summary.averageShipmentValueCents ?? shipments.averageValueCents,
      ),
      declineRate: normalizeRate(summary.declineRate ?? shipments.declineRate),
      shippingCostRatio: normalizeRate(
        summary.shippingCostRatio ?? shipments.shippingCostRatio,
      ),
      emailOpenRate: normalizeRate(
        summary.emailOpenRate ?? engagement.emailOpenRate,
      ),
      emailClickRate: normalizeRate(
        summary.emailClickRate ?? engagement.emailClickRate,
      ),
      portalLogins: numberValue(
        summary.portalLogins ?? engagement.portalLogins,
      ),
      portalLoginsPerMember:
        summary.portalLoginsPerMember == null
          ? activeMembers
            ? numberValue(engagement.portalLogins) / activeMembers
            : 0
          : numberValue(summary.portalLoginsPerMember),
      loyaltyPointsRedeemed: numberValue(
        summary.loyaltyPointsRedeemed ?? engagement.loyaltyPointsRedeemed,
      ),
      loyaltyRedemptionRate:
        summary.loyaltyRedemptionRate == null
          ? activeMembers
            ? numberValue(
                engagement.loyaltyPointsRedeemed,
              ) / activeMembers
            : 0
          : normalizeRate(summary.loyaltyRedemptionRate),
    },
    revenue: {
      byTier: arrayValue(revenue.byTier ?? tierDistribution).flatMap((candidate) => {
        const item = recordValue(candidate);
        const tierName = stringValue(item.tierName ?? item.name);
        if (!tierName) return [];
        const mrrCents = numberValue(
          item.mrrCents ?? item.monthlyRevenueCents,
        );
        return [{
          tierId: stringValue(item.tierId ?? item.id, tierName),
          tierName,
          mrrCents,
          arrCents: numberValue(item.arrCents, mrrCents * 12),
          memberCount: numberValue(item.memberCount ?? item.activeMembers),
        }];
      }),
      trend: arrayValue(revenue.trend ?? series).flatMap((candidate) => {
        const item = recordValue(candidate);
        const period = stringValue(item.period ?? item.label ?? item.date);
        if (!period) return [];
        const mrrCents = numberValue(item.mrrCents);
        const active = numberValue(item.activeMembers);
        return [{
          period,
          mrrCents,
          arrCents: numberValue(item.arrCents, mrrCents * 12),
          arpmCents: numberValue(
            item.arpmCents,
            active ? mrrCents / active : 0,
          ),
          revenueChurnCents: numberValue(item.revenueChurnCents),
        }];
      }),
    },
    members: {
      trend: arrayValue(members.trend ?? series).flatMap((candidate) => {
        const item = recordValue(candidate);
        const period = stringValue(item.period ?? item.label ?? item.date);
        if (!period) return [];
        const newMembers = numberValue(item.newMembers);
        const cancelled = numberValue(
          item.cancelled ?? item.cancelledMembers,
        );
        return [{
          period,
          active: numberValue(item.active ?? item.activeMembers),
          newMembers,
          cancelled,
          netGrowth: numberValue(item.netGrowth, newMembers - cancelled),
        }];
      }),
      cohorts: (
        Array.isArray(members.cohorts)
          ? members.cohorts
          : Array.from(groupedCohorts, ([cohort, values]) => ({ cohort, values }))
      ).flatMap((candidate) => {
        const item = recordValue(candidate);
        const cohort = stringValue(item.cohort ?? item.label);
        if (!cohort) return [];
        return [{
          cohort,
          values: arrayValue(item.values).map((entry) =>
            entry === null ? null : normalizeRate(entry),
          ),
        }];
      }),
      ltvByTier: arrayValue(
        members.ltvByTier ?? tierDistribution,
      ).flatMap((candidate) => {
        const item = recordValue(candidate);
        const tierName = stringValue(item.tierName ?? item.name);
        if (!tierName) return [];
        return [{
          tierId: stringValue(item.tierId ?? item.id, tierName),
          tierName,
          ltvCents: numberValue(item.ltvCents ?? item.averageLtvCents),
        }];
      }),
      tenureDistribution: tenureDistribution.flatMap((candidate) => {
        const item = recordValue(candidate);
        const bucket = stringValue(item.bucket ?? item.label);
        if (!bucket) return [];
        return [{
          bucket,
          members: numberValue(item.members ?? item.count),
        }];
      }),
    },
    shipments: {
      trend: arrayValue(shipments.trend ?? series).flatMap((candidate) => {
        const item = recordValue(candidate);
        const period = stringValue(item.period ?? item.label ?? item.date);
        if (!period) return [];
        const attempted = numberValue(
          item.attempted ?? item.attemptedShipments,
        );
        const charged = numberValue(
          item.charged ?? item.fulfilledShipments,
        );
        const declined = numberValue(
          item.declined ?? item.declinedAttempts,
        );
        return [{
          period,
          attempted,
          charged,
          declined,
          fulfillmentRate:
            item.fulfillmentRate == null
              ? attempted ? charged / attempted : 0
              : normalizeRate(item.fulfillmentRate),
          averageValueCents: numberValue(
            item.averageValueCents,
            charged ? numberValue(item.shipmentValueCents) / charged : 0,
          ),
          shippingCostCents: numberValue(item.shippingCostCents),
          revenueCents: numberValue(
            item.revenueCents ?? item.netRevenueCents,
          ),
        }];
      }),
      declineReasons: (() => {
        const reasons = arrayValue(
          shipments.declineReasons ?? source.declineReasons,
        );
        const totalDeclines = reasons.reduce(
          (total, candidate) => {
            const item = recordValue(candidate);
            return total + numberValue(item.count ?? item.attempts);
          },
          0,
        );
        return reasons.flatMap((candidate) => {
        const item = recordValue(candidate);
        const reason = stringValue(item.reason ?? item.label);
        if (!reason) return [];
        const count = numberValue(item.count ?? item.attempts);
        return [{
          reason,
          count,
          rate:
            item.rate == null
              ? totalDeclines ? count / totalDeclines : 0
              : normalizeRate(item.rate),
        }];
        });
      })(),
    },
    engagement: {
      trend: arrayValue(engagement.trend ?? series).flatMap((candidate) => {
        const item = recordValue(candidate);
        const period = stringValue(item.period ?? item.label ?? item.date);
        if (!period) return [];
        const emailsSent = numberValue(item.emailsSent);
        return [{
          period,
          emailOpenRate:
            item.emailOpenRate == null
              ? emailsSent ? numberValue(item.emailOpens) / emailsSent : 0
              : normalizeRate(item.emailOpenRate),
          emailClickRate:
            item.emailClickRate == null
              ? emailsSent ? numberValue(item.emailClicks) / emailsSent : 0
              : normalizeRate(item.emailClickRate),
          portalLoginsPerMember:
            item.portalLoginsPerMember == null
              ? numberValue(item.activeMembers)
                ? numberValue(item.portalLogins) /
                  numberValue(item.activeMembers)
                : 0
              : numberValue(item.portalLoginsPerMember),
          loyaltyRedemptionRate:
            item.loyaltyRedemptionRate == null
              ? numberValue(item.activeMembers)
                ? numberValue(item.loyaltyPointsRedeemed) /
                  numberValue(item.activeMembers)
                : 0
              : normalizeRate(item.loyaltyRedemptionRate),
        }];
      }),
      acquisition: arrayValue(engagement.acquisition).flatMap((candidate) => {
        const item = recordValue(candidate);
        const sourceName = stringValue(item.source ?? item.label);
        if (!sourceName) return [];
        return [{
          source: sourceName,
          members: numberValue(item.members),
          conversionRate: normalizeRate(item.conversionRate),
          cacCents: numberValue(item.cacCents),
        }];
      }),
    },
    availableWidgets: arrayValue(source.availableWidgets).flatMap((candidate) => {
      const item = recordValue(candidate);
      const id = stringValue(item.id);
      if (!id) return [];
      return [{
        id,
        title: stringValue(item.title, id),
        category: stringValue(item.category, "Analytics"),
        defaultSize: normalizeSize(item.defaultSize),
      }];
    }),
    layout: {
      widgets: arrayValue(layout.widgets).flatMap((candidate, index) => {
        const item = recordValue(candidate);
        const id = stringValue(item.id);
        if (!id) return [];
        return [{
          id,
          enabled: booleanValue(item.enabled, true),
          order: numberValue(item.order, index),
          size: normalizeSize(item.size),
        }];
      }),
    },
  };
}

export function normalizeScheduledReports(value: unknown): ScheduledReport[] {
  const source = isRecord(value) && Array.isArray(value.items) ? value.items : value;
  return arrayValue(source).flatMap((candidate) => {
    const item = recordValue(candidate);
    const id = stringValue(item.id);
    if (!id) return [];
    return [{
      id,
      frequency: item.frequency === "monthly" ? "monthly" : "weekly",
      recipientEmail: stringValue(item.recipientEmail ?? item.email),
      enabled: booleanValue(item.enabled, true),
      widgetIds: arrayValue(item.widgetIds).filter(
        (entry): entry is string => typeof entry === "string",
      ),
      lastSentAt: optionalString(item.lastSentAt),
      nextSendAt: optionalString(item.nextSendAt ?? item.nextRunAt),
    }];
  });
}

function normalizeRiskLevel(
  value: unknown,
  score: number,
): "low" | "medium" | "high" {
  if (value === "high" || value === "medium" || value === "low") return value;
  if (score > 60) return "high";
  if (score > 30) return "medium";
  return "low";
}

export function normalizeChurnIntelligence(
  value: unknown,
): ChurnIntelligence {
  const source = recordValue(value);
  const model = recordValue(source.model);
  const modelMetrics = recordValue(model.metrics);
  const abTest = recordValue(source.abTest);
  const drift = recordValue(source.drift);
  const rawMode = stringValue(source.mode);
  const mode: ChurnIntelligenceMode =
    rawMode === "ab_test" || rawMode === "ml"
      ? rawMode
      : "rules_fallback";
  return {
    mode,
    fallbackReason: optionalString(source.fallbackReason),
    model: Object.keys(model).length
      ? {
          version: stringValue(model.version, "Unversioned"),
          algorithm: stringValue(model.algorithm, "Not reported"),
          trainedAt: optionalString(model.trainedAt),
          trainingDataSize: numberValue(model.trainingDataSize),
          metrics: {
            aucRoc: modelMetrics.aucRoc == null ? null : normalizeRate(modelMetrics.aucRoc),
            accuracy: modelMetrics.accuracy == null ? null : normalizeRate(modelMetrics.accuracy),
            precision: modelMetrics.precision == null ? null : normalizeRate(modelMetrics.precision),
            recall: modelMetrics.recall == null ? null : normalizeRate(modelMetrics.recall),
            f1: modelMetrics.f1 == null ? null : normalizeRate(modelMetrics.f1),
          },
        }
      : null,
    abTest: Object.keys(abTest).length
      ? {
          startedAt: optionalString(abTest.startedAt),
          endsAt: optionalString(abTest.endsAt),
          mlAccuracy: abTest.mlAccuracy == null ? null : normalizeRate(abTest.mlAccuracy),
          rulesAccuracy: abTest.rulesAccuracy == null ? null : normalizeRate(abTest.rulesAccuracy),
          sampleSize: numberValue(abTest.sampleSize),
        }
      : null,
    drift: Object.keys(drift).length
      ? {
          status:
            drift.status === "warning" || drift.status === "retraining"
              ? drift.status
              : "stable",
          score: drift.score == null ? null : normalizeRate(drift.score),
          lastCheckedAt: optionalString(drift.lastCheckedAt),
        }
      : null,
    items: arrayValue(source.items).flatMap((candidate) => {
      const item = recordValue(candidate);
      const alert = recordValue(item.alert);
      const memberId = stringValue(item.memberId);
      if (!memberId) return [];
      const rulesScore = numberValue(item.rulesScore ?? item.score);
      const sourceType = item.source === "ml" ? "ml" : "rules";
      const mlScore = item.mlScore == null ? null : numberValue(item.mlScore);
      const displayScore = sourceType === "ml" ? (mlScore ?? rulesScore) : rulesScore;
      return [{
        memberId,
        memberName: stringValue(item.memberName ?? item.name, "Unnamed member"),
        email: optionalString(item.email),
        tierName: optionalString(item.tierName),
        mlScore,
        rulesScore,
        confidenceBandLow:
          item.confidenceBandLow == null && item.confidenceLow == null
            ? null
            : numberValue(item.confidenceBandLow ?? item.confidenceLow),
        confidenceBandHigh:
          item.confidenceBandHigh == null && item.confidenceHigh == null
            ? null
            : numberValue(item.confidenceBandHigh ?? item.confidenceHigh),
        riskLevel: normalizeRiskLevel(item.riskLevel, displayScore),
        source: sourceType,
        calculatedAt: stringValue(item.calculatedAt),
        alert: Object.keys(alert).length && stringValue(alert.id)
          ? {
              id: stringValue(alert.id),
              status:
                alert.status === "acknowledged"
                  ? "acknowledged"
                  : "open",
              createdAt: optionalString(alert.createdAt),
              acknowledgedAt: optionalString(alert.acknowledgedAt),
              acknowledgedByName: optionalString(alert.acknowledgedByName),
            }
          : null,
        topFeatures: arrayValue(item.topFeatures ?? item.contributingFactors).flatMap(
          (candidateFactor, index) => {
            const factor = recordValue(candidateFactor);
            const label = stringValue(factor.label);
            if (!label) return [];
            const impact = numberValue(factor.impact ?? factor.points);
            return [{
              id: stringValue(factor.id, `${memberId}-${index}`),
              label,
              detail: stringValue(factor.detail),
              impact,
              shapValue:
                factor.shapValue == null ? null : numberValue(factor.shapValue),
              direction:
                factor.direction === "lowers" || impact < 0 ? "lowers" : "raises",
            }];
          },
        ),
      }];
    }),
  };
}

export function normalizeChurnIntelligenceItem(
  value: unknown,
): ChurnIntelligenceItem | null {
  const source = isRecord(value) && Array.isArray(value.items)
    ? value
    : { items: [value] };
  return normalizeChurnIntelligence(source).items[0] ?? null;
}

export function normalizeBenchmarksDashboard(
  value: unknown,
): BenchmarksDashboard {
  const source = recordValue(value);
  const peerGroup = recordValue(source.peerGroup);
  const quarterlyReport = recordValue(source.quarterlyReport);
  return {
    eligible: booleanValue(source.eligible),
    subscriptionTier: stringValue(source.subscriptionTier),
    optedIn: booleanValue(source.optedIn),
    minimumPeerCount: Math.max(10, numberValue(source.minimumPeerCount, 10)),
    peerGroup: Object.keys(peerGroup).length
      ? {
          region: optionalString(peerGroup.region),
          tierDistribution: optionalString(peerGroup.tierDistribution),
          memberCountBand: optionalString(peerGroup.memberCountBand),
        }
      : null,
    period: optionalString(source.period),
    generatedAt: optionalString(source.generatedAt),
    metrics: arrayValue(source.metrics).flatMap((candidate) => {
      const item = recordValue(candidate);
      const id = stringValue(item.id);
      if (!id) return [];
      const rawUnit = stringValue(item.unit);
      const unit =
        rawUnit === "cents" ||
        rawUnit === "count" ||
        rawUnit === "percent" ||
        rawUnit === "months"
          ? rawUnit
          : "number";
      return [{
        id,
        label: stringValue(item.label, id),
        unit,
        organizationValue: numberValue(item.organizationValue),
        peerMedian: numberValue(item.peerMedian),
        percentile: item.percentile == null ? null : numberValue(item.percentile),
        peerP25: item.peerP25 == null ? null : numberValue(item.peerP25),
        peerP75: item.peerP75 == null ? null : numberValue(item.peerP75),
        sampleCountBand: stringValue(
          item.sampleCountBand ?? item.cohortBand,
          "10+",
        ),
      }];
    }),
    quarterlyReport: {
      enabled: booleanValue(quarterlyReport.enabled),
      lastGeneratedAt: optionalString(quarterlyReport.lastGeneratedAt),
      nextScheduledAt: optionalString(quarterlyReport.nextScheduledAt),
    },
  };
}

function normalizeComplianceStatus(value: unknown): ComplianceStatus {
  if (value === "compliant" || value === "non_compliant") return value;
  return "unknown";
}

export function normalizeComplianceDashboard(
  value: unknown,
): ComplianceDashboard {
  const source = recordValue(value);
  const provider = recordValue(source.provider);
  const summary = recordValue(source.summary);
  return {
    provider: {
      name: stringValue(provider.name, "ShipCompliant"),
      status:
        provider.status === "active" ||
        provider.status === "configured" ||
        provider.status === "degraded"
          ? provider.status
          : "activation_required",
      lastSuccessfulCheckAt: optionalString(
        provider.lastSuccessfulCheckAt ?? provider.lastRulesRefreshAt,
      ),
    },
    summary: {
      totalChecks: numberValue(summary.totalChecks),
      compliant: numberValue(summary.compliant),
      nonCompliant: numberValue(summary.nonCompliant),
      unknown: numberValue(summary.unknown),
      taxEstimateCents: numberValue(summary.taxEstimateCents),
    },
    items: arrayValue(source.items).flatMap((candidate) => {
      const item = recordValue(candidate);
      const id = stringValue(item.id);
      if (!id) return [];
      return [{
        id,
        shipmentId: stringValue(item.shipmentId),
        shipmentStatus: optionalString(item.shipmentStatus),
        memberId: optionalString(item.memberId),
        memberName: stringValue(item.memberName, "Unknown member"),
        releaseId: optionalString(item.releaseId),
        releaseName: optionalString(item.releaseName),
        state: optionalString(item.state),
        status: normalizeComplianceStatus(item.status),
        reason: optionalString(item.reason),
        taxEstimateCents:
          item.taxEstimateCents == null ? null : numberValue(item.taxEstimateCents),
        responseId: optionalString(item.responseId),
        checkedAt: optionalString(item.checkedAt),
      }];
    }),
    total: numberValue(source.total),
  };
}
