import type { ClubTier, PageResult, ReleaseWine } from "./phase2";

export type EmailTrigger =
  | "welcome"
  | "pre_shipment"
  | "payment_decline"
  | "shipped"
  | "birthday"
  | "re_engagement";

export interface EmailTemplate {
  id: string;
  triggerType: EmailTrigger;
  subject: string;
  body: string;
  enabled: boolean;
  daysBefore?: number | null;
  updatedAt?: string;
  senderStatus?: "active" | "activation_required";
}

export interface EmailLogEntry {
  id: string;
  memberId?: string | null;
  recipient: string;
  templateId: string;
  templateName: string;
  status: "sent" | "failed" | "bounced";
  providerId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

export type RiskLevel = "low" | "medium" | "high";

export interface ChurnFactor {
  id: string;
  label: string;
  detail: string;
  points: number;
  direction: "raises" | "lowers";
}

export interface ChurnScore {
  memberId: string;
  memberName: string;
  email?: string;
  tierName?: string | null;
  score: number;
  riskLevel: RiskLevel;
  contributingFactors: ChurnFactor[];
  calculatedAt: string;
}

export interface ChurnSummary {
  items: ChurnScore[];
  total: number;
  scoredCount: number;
  lowCount: number;
  mediumCount: number;
  highCount: number;
  calculatedAt?: string | null;
}

export type CancelStepId = "pause" | "downgrade" | "swap" | "confirm";

export interface CancelFlowStepConfig {
  id: CancelStepId;
  stepId?: string;
  enabled: boolean;
  order: number;
  title: string;
  description?: string | null;
}

export interface CancelFlowConfig {
  id?: string;
  steps: CancelFlowStepConfig[];
  updatedAt?: string;
}

export interface CancelFlowStepAnalytics {
  step: CancelStepId;
  reached: number;
  intercepted: number;
  conversionRate: number;
}

export interface CancelFlowAnalytics {
  attempts: number;
  retained: number;
  cancelled: number;
  retentionRate: number;
  steps: CancelFlowStepAnalytics[];
  recentOutcomes: Array<{
    id: string;
    memberId: string;
    memberName: string;
    step: CancelStepId;
    outcome: "paused" | "downgraded" | "swapped" | "cancelled" | "abandoned";
    createdAt: string;
  }>;
}

export interface MemberCancelFlow {
  attemptId?: string;
  currentStepId?: string | null;
  steps: CancelFlowStepConfig[];
  currentTier: Pick<ClubTier, "id" | "name" | "priceCents"> | null;
  lowerTiers: Array<Pick<ClubTier, "id" | "name" | "priceCents" | "bottleCount">>;
  swapOptions: ReleaseWine[];
  loyaltyBalance: number;
  benefitsAtRisk: string[];
  nextShipmentId?: string | null;
}

export type LoyaltyEntryType =
  | "shipment"
  | "event"
  | "referral"
  | "birthday"
  | "anniversary"
  | "adjustment"
  | "redemption"
  | "expiration";

export interface LoyaltyLedgerEntry {
  id: string;
  points: number;
  reason: string;
  type: LoyaltyEntryType;
  expiresAt?: string | null;
  createdAt: string;
}

export interface LoyaltyLedgerPagination {
  nextCursor?: string | null;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface LoyaltyAccount {
  memberId: string;
  memberName: string;
  memberEmail?: string;
  tierName?: string | null;
  multiplier: number;
  availablePoints: number;
  pendingPoints?: number;
  expiringPoints?: number;
  nextExpirationAt?: string | null;
  redemptionRate: {
    points: number;
    discountCents: number;
  };
  ledger: LoyaltyLedgerEntry[];
  ledgerPagination: LoyaltyLedgerPagination;
}

export interface LoyaltyMemberSummary {
  memberId: string;
  memberName: string;
  memberEmail?: string;
  tierName?: string | null;
  availablePoints: number;
  multiplier: number;
}

export type LoyaltyMembersResult =
  | PageResult<LoyaltyMemberSummary>
  | LoyaltyMemberSummary[];

const cancelStepIds: CancelStepId[] = [
  "pause",
  "downgrade",
  "swap",
  "confirm",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function cancelStepId(value: unknown): CancelStepId | null {
  return cancelStepIds.includes(value as CancelStepId)
    ? (value as CancelStepId)
    : null;
}

export function normalizeCancelSteps(value: unknown): CancelFlowStepConfig[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const semanticId = cancelStepId(
      candidate.key ?? candidate.stepType ?? candidate.id,
    );
    if (!semanticId) return [];
    const rawId = stringValue(candidate.id);
    return [
      {
        id: semanticId,
        stepId:
          stringValue(candidate.stepId) ||
          (rawId && rawId !== semanticId ? rawId : undefined),
        enabled: candidate.enabled !== false,
        order: numberValue(candidate.order ?? candidate.position, index + 1),
        title:
          stringValue(candidate.title) ||
          `${semanticId[0]?.toUpperCase()}${semanticId.slice(1)}`,
        description: stringValue(candidate.description) || null,
      },
    ];
  });
}

export function normalizeCancelFlowConfig(value: unknown): CancelFlowConfig {
  const source = isRecord(value) ? value : {};
  return {
    id: stringValue(source.id) || undefined,
    steps: normalizeCancelSteps(source.steps),
    updatedAt: stringValue(source.updatedAt) || undefined,
  };
}

export function normalizeMemberCancelFlow(value: unknown): MemberCancelFlow {
  const source = isRecord(value) ? value : {};
  const currentTier = isRecord(source.currentTier)
    ? {
        id: stringValue(source.currentTier.id),
        name: stringValue(source.currentTier.name),
        priceCents: numberValue(source.currentTier.priceCents),
      }
    : null;
  const lowerTiers = Array.isArray(source.lowerTiers)
    ? source.lowerTiers.flatMap((candidate) => {
        if (!isRecord(candidate)) return [];
        return [
          {
            id: stringValue(candidate.id),
            name: stringValue(candidate.name),
            priceCents: numberValue(candidate.priceCents),
            bottleCount: numberValue(candidate.bottleCount),
          },
        ];
      })
    : [];
  const swapOptions = Array.isArray(source.swapOptions)
    ? (source.swapOptions as ReleaseWine[])
    : [];
  return {
    attemptId: stringValue(source.attemptId) || undefined,
    currentStepId: stringValue(source.currentStepId) || null,
    steps: normalizeCancelSteps(source.steps),
    currentTier,
    lowerTiers,
    swapOptions,
    loyaltyBalance: numberValue(source.loyaltyBalance),
    benefitsAtRisk: Array.isArray(source.benefitsAtRisk)
      ? source.benefitsAtRisk.filter(
          (benefit): benefit is string => typeof benefit === "string",
        )
      : [],
    nextShipmentId: stringValue(source.nextShipmentId) || null,
  };
}

export function normalizeChurnScore(value: unknown): ChurnScore {
  const source = isRecord(value) ? value : {};
  const member = isRecord(source.member) ? source.member : {};
  const members = isRecord(source.members) ? source.members : member;
  const tier =
    isRecord(members.clubTiers) || isRecord(members.clubTier)
      ? ((members.clubTiers ?? members.clubTier) as Record<string, unknown>)
      : {};
  const factors = Array.isArray(source.contributingFactors)
    ? source.contributingFactors
    : [];
  const score = Math.max(0, Math.min(100, numberValue(source.score)));
  const riskLevel =
    source.riskLevel === "low" ||
    source.riskLevel === "medium" ||
    source.riskLevel === "high"
      ? source.riskLevel
      : score > 60
        ? "high"
        : score > 30
          ? "medium"
          : "low";
  const firstName = stringValue(members.firstName);
  const lastName = stringValue(members.lastName);
  return {
    memberId: stringValue(source.memberId),
    memberName:
      stringValue(source.memberName) ||
      [firstName, lastName].filter(Boolean).join(" ") ||
      "Member",
    email: stringValue(source.email ?? members.email) || undefined,
    tierName:
      stringValue(source.tierName ?? tier.name) || null,
    score,
    riskLevel,
    contributingFactors: factors.flatMap((candidate, index) => {
      if (!isRecord(candidate)) return [];
      const points = numberValue(candidate.points);
      return [
        {
          id:
            stringValue(candidate.id ?? candidate.key) ||
            `factor-${index + 1}`,
          label: stringValue(candidate.label) || "Risk signal",
          detail:
            stringValue(candidate.detail ?? candidate.evidence) ||
            "Included in the latest rules-based score.",
          points,
          direction:
            candidate.direction === "lowers" || points < 0
              ? "lowers"
              : "raises",
        },
      ];
    }),
    calculatedAt: stringValue(source.calculatedAt),
  };
}

export function normalizeChurnSummary(value: unknown): ChurnSummary {
  const source = isRecord(value) ? value : {};
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(source.items)
      ? source.items
      : [];
  const items = rawItems.map(normalizeChurnScore);
  return {
    items,
    total: numberValue(source.total, items.length),
    scoredCount: numberValue(source.scoredCount, items.length),
    lowCount: numberValue(
      source.lowCount,
      items.filter((item) => item.riskLevel === "low").length,
    ),
    mediumCount: numberValue(
      source.mediumCount,
      items.filter((item) => item.riskLevel === "medium").length,
    ),
    highCount: numberValue(
      source.highCount,
      items.filter((item) => item.riskLevel === "high").length,
    ),
    calculatedAt: stringValue(source.calculatedAt) || null,
  };
}

export function normalizeLoyaltyAccount(value: unknown): LoyaltyAccount {
  const source = isRecord(value) ? value : {};
  const rate = isRecord(source.redemptionRate)
    ? source.redemptionRate
    : isRecord(source.redemption_rate)
      ? source.redemption_rate
      : {};
  const rawLedger = Array.isArray(source.ledger) ? source.ledger : [];
  const rawPagination = isRecord(
    source.ledgerPagination ?? source.ledger_pagination,
  )
    ? ((source.ledgerPagination ?? source.ledger_pagination) as Record<
        string,
        unknown
      >)
    : {};
  const paginationLimit = Math.max(
    0,
    numberValue(rawPagination.limit, rawLedger.length),
  );
  const paginationTotal = Math.max(
    rawLedger.length,
    numberValue(rawPagination.total, rawLedger.length),
  );

  return {
    memberId: stringValue(source.memberId ?? source.member_id),
    memberName:
      stringValue(source.memberName ?? source.member_name) || "Club member",
    memberEmail:
      stringValue(source.memberEmail ?? source.member_email) || undefined,
    tierName: stringValue(source.tierName ?? source.tier_name) || null,
    multiplier: numberValue(source.multiplier, 1),
    availablePoints: numberValue(
      source.availablePoints ?? source.available_points,
    ),
    pendingPoints: numberValue(source.pendingPoints ?? source.pending_points),
    expiringPoints: numberValue(
      source.expiringPoints ?? source.expiring_points,
    ),
    nextExpirationAt:
      stringValue(source.nextExpirationAt ?? source.next_expiration_at) || null,
    redemptionRate: {
      points: numberValue(rate.points, 100),
      discountCents: numberValue(
        rate.discountCents ?? rate.discount_cents,
        1_000,
      ),
    },
    ledger: rawLedger.flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      const rawType = stringValue(candidate.type);
      const type: LoyaltyEntryType = [
        "shipment",
        "event",
        "referral",
        "birthday",
        "anniversary",
        "adjustment",
        "redemption",
        "expiration",
      ].includes(rawType)
        ? (rawType as LoyaltyEntryType)
        : "adjustment";
      return [
        {
          id:
            stringValue(candidate.id) ||
            `${type}-${stringValue(candidate.createdAt ?? candidate.created_at)}`,
          points: numberValue(candidate.points),
          reason: stringValue(candidate.reason) || "Loyalty activity",
          type,
          expiresAt:
            stringValue(candidate.expiresAt ?? candidate.expires_at) || null,
          createdAt: stringValue(candidate.createdAt ?? candidate.created_at),
        },
      ];
    }),
    ledgerPagination: {
      hasMore: Boolean(
        rawPagination.nextCursor ?? rawPagination.next_cursor,
      ),
      limit: paginationLimit,
      nextCursor:
        stringValue(
          rawPagination.nextCursor ?? rawPagination.next_cursor,
        ) || null,
      total: paginationTotal,
    },
  };
}
