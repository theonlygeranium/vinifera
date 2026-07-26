import { apiRequest } from "./client";

export type MemberStatus = "active" | "paused" | "cancelled";
export type ReleaseStatus = "draft" | "scheduled" | "processing" | "completed";
export type ShipmentStatus =
  | "pending"
  | "charged"
  | "declined"
  | "label_created"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface Address {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
}

export interface ClubTier {
  id: string;
  name: string;
  description?: string | null;
  priceCents: number;
  billingInterval: "monthly" | "quarterly";
  bottleCount: number;
  frequency:
    | "monthly"
    | "bi_monthly"
    | "quarterly"
    | "semi_annual"
    | "annual";
  upgradePathId?: string | null;
  memberCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface MemberSummary {
  id: string;
  membershipNumber?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  birthday?: string | null;
  referredByMemberId?: string | null;
  status: MemberStatus;
  tier?: Pick<ClubTier, "id" | "name"> | null;
  joinedAt: string;
  lifetimeValueCents?: number;
  lastShipmentAt?: string | null;
  nextReleaseAt?: string | null;
}

export interface MemberActivity {
  id: string;
  kind: "order" | "status" | "communication" | "payment" | "shipment";
  title: string;
  detail?: string | null;
  occurredAt: string;
}

export interface MemberOrder {
  id: string;
  releaseName: string;
  status: ShipmentStatus;
  totalAmountCents: number;
  subtotalAmountCents: number;
  discountAmountCents: number;
  taxAmountCents: number;
  createdAt: string;
  items: Array<{ name: string; quantity: number }>;
}

export interface MemberHistoryMeta {
  activityLimit: number;
  activityTruncated: boolean;
  communicationLimit: number;
  communicationsTruncated: boolean;
  orderLimit: number;
  ordersTruncated: boolean;
}

export interface MemberExternalSync {
  deadLetterCount: number;
  pendingCount: number;
  state:
    | "not_required"
    | "pending"
    | "reconciliation_required"
    | "synchronized";
  updatedAt: string | null;
}

export interface MemberDetail extends MemberSummary {
  address?: Address | null;
  orderCount?: number;
  communicationCount: number;
  churnRisk?: "not_scored" | "low" | "medium" | "high";
  activity?: MemberActivity[];
  communications?: MemberActivity[];
  externalSync?: MemberExternalSync;
  historyMeta?: MemberHistoryMeta;
  orders?: MemberOrder[];
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
}

export interface ReleaseTier {
  id: string;
  name: string;
  priceCents: number;
  bottleCount: number;
}

export interface ReleaseWine {
  id?: string;
  name: string;
  quantity: number;
  priceCents?: number;
}

export interface Release {
  id: string;
  name: string;
  description?: string | null;
  processingDate: string;
  embargoDate: string;
  status: ReleaseStatus;
  tiers: ReleaseTier[];
  wines: ReleaseWine[];
  memberCount?: number;
  successfulChargeCount?: number;
  declinedChargeCount?: number;
  grossAmountCents?: number;
}

export interface Shipment {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail?: string;
  releaseId: string;
  releaseName: string;
  tierName?: string;
  status: ShipmentStatus;
  trackingNumber?: string | null;
  carrier?: string | null;
  chargeAmountCents: number;
  subtotalAmountCents?: number;
  taxAmountCents?: number;
  declineReason?: string | null;
  retryCount?: number;
  nextRetryDate?: string | null;
  address?: Address | null;
  items?: ReleaseWine[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ImportPreview {
  uploadToken: string;
  source: "commerce7" | "winedirect" | "generic";
  columns: string[];
  suggestedMapping: Record<string, string>;
  rows: Array<Record<string, string>>;
  validation: {
    validCount: number;
    invalidCount: number;
    errors: Array<{ row: number; field?: string; message: string }>;
  };
}

export interface ImportResult {
  importedCount: number;
  skippedCount: number;
  errors: Array<{ row: number; message: string }>;
}

export interface PortalShipment extends Shipment {
  displayContents: boolean;
}

export function asPageResult<T>(
  value: PageResult<T> | T[],
): PageResult<T> {
  return Array.isArray(value)
    ? { items: value, total: value.length }
    : value;
}

export function queryPath(
  base: `/api/${string}`,
  params: Record<string, string | undefined>,
): `/api/${string}` {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const query = search.toString();
  return `${base}${query ? `?${query}` : ""}` as `/api/${string}`;
}

export function uploadImportPreview(file: File, source: string) {
  const body = new FormData();
  body.set("file", file);
  body.set("source", source);
  return apiRequest<ImportPreview>("/api/members/import/preview", {
    method: "POST",
    body,
  });
}
