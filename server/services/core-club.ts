import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import Stripe from "stripe";
import {
  AvalaraClient,
  type AvalaraCredentials,
  type AvalaraTaxQuote,
  type AvalaraTaxRequest,
} from "../integrations/avalara";
import { decryptIntegrationCredentials } from "../integrations/security";
import {
  assertAvalaraBaseUrlEnvironment,
  assertStripeBillingAuthority,
  stripeCredentialMode,
  usesSecureCookies,
} from "../config";
import { assertStaffRole } from "../lib/authorization";
import {
  ANALYTICS_EVENT_TYPES,
  analyticsEventIdempotencyKey,
  runFailureIsolatedAnalyticsWrite,
} from "../lib/analytics-events";
import { encodeCsvCell } from "../lib/csv";
import { AppError, requireConfigured } from "../lib/errors";
import { assertUuid, camelKey, sha256 } from "../lib/utils";
import { assertEasyPostTarget } from "../provider-targets";
import {
  readMemberBrandContextCookie,
  verifyMemberBrandContext,
} from "../lib/member-brand-context";
import {
  mobileAccessSessionId,
  verifyMobileAccessTokenForOrganization,
} from "../integrations/mobile-auth";
import type {
  ComplianceStatus,
  ClubTierInput,
  CoreClubService,
  CsvMapping,
  CsvPreviewInput,
  MemberInput,
  MemberPrincipal,
  MemberStatus,
  PlanTier,
  PostalAddress,
  ReleaseInput,
  ReleasePatchInput,
  ReleaseStatus,
  ShipmentStatus,
  StaffPrincipal,
  StaffRole,
  WorkerEnv,
} from "../types";
import {
  complianceRequestFingerprint,
  createComplianceProvider,
  permitsLabelGeneration,
  withAuditableComplianceId,
  type ComplianceCheckRequest,
  type ComplianceCheckResult,
} from "./compliance";
import {
  executeStripeBillingAttempt,
  provisionStripeCustomer,
  supabaseStripeBillingAttemptStore,
  supabaseStripeCustomerProvisioningStore,
} from "./stripe-runtime";

const STRIPE_API_VERSION = "2026-02-25.clover";
const STAFF_COOKIE = "vinifera-staff-auth";
const MEMBER_COOKIE = "vinifera-member-auth";
const CSV_MAX_BYTES = 5 * 1024 * 1024;
const CSV_MAX_ROWS = 1_000;
const DEFAULT_ALLOWED_STATES = new Set([
  "AK",
  "AZ",
  "CA",
  "CO",
  "CT",
  "DC",
  "FL",
  "GA",
  "HI",
  "IA",
  "ID",
  "IL",
  "IN",
  "KS",
  "LA",
  "MA",
  "MD",
  "ME",
  "MI",
  "MN",
  "MO",
  "MT",
  "NC",
  "ND",
  "NE",
  "NH",
  "NJ",
  "NM",
  "NV",
  "NY",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "TN",
  "TX",
  "VA",
  "VT",
  "WA",
  "WI",
  "WV",
  "WY",
]);

interface StaffUserRow {
  email: string;
  id: string;
  organization_id: string;
  role: StaffRole;
}

interface OrganizationRow {
  access_status: string;
  grace_period_ends_at: string | null;
  id: string;
  name: string;
  plan_tier: PlanTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  suspended_at: string | null;
}

interface MemberRow {
  auth_user_id?: string | null;
  brand_id?: string;
  birthday?: string | null;
  club_tier_id?: string | null;
  email: string;
  first_name: string;
  id: string;
  last_name: string;
  organization_id: string;
  phone?: string | null;
  referred_by_member_id?: string | null;
  shipping_address_line1?: string | null;
  shipping_address_line2?: string | null;
  shipping_city?: string | null;
  shipping_country_code?: string | null;
  shipping_postal_code?: string | null;
  shipping_region?: string | null;
  status: MemberStatus;
  stripe_customer_id?: string | null;
  stripe_payment_method_id?: string | null;
}

export interface ShipmentPaymentRow {
  brand_id: string;
  charge_amount_cents: number;
  id: string;
  member_id: string;
  loyalty_discount_cents?: number;
  loyalty_redemption_id?: string | null;
  organization_id: string;
  release_id: string;
  retry_count: number;
  shipping_charge_cents?: number;
  status: ShipmentStatus;
  stripe_charge_id?: string | null;
  stripe_payment_intent_id?: string | null;
  tax_amount_cents?: number;
  members?: MemberRow | MemberRow[] | null;
}

interface ShipmentLabelRow extends ShipmentPaymentRow {
  club_tier_id?: string;
  shipping_address?: Record<string, unknown>;
  shipment_items?: Array<Record<string, unknown>>;
}

interface ShipmentComplianceContext {
  brandId: string;
  bottleCount: number;
  destination: PostalAddress;
  memberBirthday?: string | null;
  organizationId: string;
  origin: PostalAddress;
  recipientName: string;
  shipment: ShipmentLabelRow;
}

interface CsvRow {
  rowNumber: number;
  values: Record<string, string>;
}

interface NormalizedCsvMember {
  clubTierId: string | null;
  clubTierValue: string | null;
  email: string;
  firstName: string;
  joinDate: string | null;
  lastName: string;
  phone: string | null;
  rowNumber: number;
  shippingAddress: PostalAddress | null;
  status: MemberStatus;
}

interface CsvValidationError {
  fields?: Record<string, string>;
  reason: string;
  rowNumber: number;
}

const MEMBER_ACTIVITY_HISTORY_LIMIT = 20;
const MEMBER_COMMUNICATION_HISTORY_LIMIT = 10;
const MEMBER_ORDER_HISTORY_LIMIT = 20;
const MEMBER_PORTAL_HISTORY_LIMIT = 100;
const RELEASE_LIST_LIMIT = 100;
const RELEASE_SHIPMENT_DETAIL_LIMIT = 500;

export interface AddressValidationResult {
  address: PostalAddress;
  messages: string[];
  providerReference?: string;
  valid: boolean;
}

export interface LabelRequest {
  externalId: string;
  fromAddress: PostalAddress;
  fromContact: { company?: string; name: string; phone: string };
  parcel: {
    heightInches: number;
    lengthInches: number;
    weightOunces: number;
    widthInches: number;
  };
  toAddress: PostalAddress;
  toContact: { company?: string; name: string; phone: string };
}

export interface LabelResult {
  carrier: string;
  labelId: string;
  labelUrl: string;
  providerReference: string;
  rateId: string;
  rateCents: number;
  service: string;
  trackingNumber: string;
}

export interface LabelPurchaseRecovery {
  externalRateId?: string | null;
  externalShipmentId?: string | null;
  persistExternalShipment: (
    externalShipmentId: string,
    externalRateId: string,
  ) => Promise<void>;
}

export interface ShippingProvider {
  createLabel(
    input: LabelRequest,
    recovery?: LabelPurchaseRecovery,
  ): Promise<LabelResult>;
  validateAddress(address: PostalAddress): Promise<AddressValidationResult>;
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function createAdminClient(env: WorkerEnv): SupabaseClient {
  const url = requireConfigured(env.SUPABASE_URL, "SUPABASE_URL");
  const secret = requireConfigured(
    env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SECRET_KEY",
  );
  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function createSurfaceClient(
  env: WorkerEnv,
  request: Request,
  response: Response,
  surface: "staff" | "member",
): SupabaseClient {
  const url = requireConfigured(env.SUPABASE_URL, "SUPABASE_URL");
  const publicKey = requireConfigured(
    env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY,
    "SUPABASE_PUBLISHABLE_KEY",
  );
  const bearer =
    surface === "member"
      ? request.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1]
      : undefined;
  if (bearer) {
    return createClient(url, publicKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: { Authorization: `Bearer ${bearer}` },
      },
    });
  }
  const cookieName = surface === "staff" ? STAFF_COOKIE : MEMBER_COOKIE;

  return createServerClient(url, publicKey, {
    auth: { flowType: "pkce" },
    cookieOptions: {
      name: cookieName,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: usesSecureCookies(env),
    },
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.cookie ?? "").filter(
          (cookie): cookie is { name: string; value: string } =>
            typeof cookie.value === "string",
        );
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          response.append(
            "Set-Cookie",
            serializeCookieHeader(cookie.name, cookie.value, {
              ...cookie.options,
              httpOnly: true,
              path: "/",
              sameSite: "lax",
              secure: usesSecureCookies(env),
            }),
          );
        }
      },
    },
  });
}

function createStripe(env: WorkerEnv): Stripe {
  stripeCredentialMode(env);
  return new Stripe(requireConfigured(env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY"), {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: "Vinifera",
      url: "https://vinifera.edstratumlabs.ai",
      version: "0.2.0",
    },
  });
}

function authFailure(): AppError {
  return new AppError(401, "unauthorized", "A valid sign-in is required.");
}

export function assertStaffWorkspaceAccess(accessState?: string | null): void {
  if (accessState === "restricted") {
    throw new AppError(
      403,
      "forbidden",
      "This winery account is restricted to subscription recovery.",
    );
  }
  if (accessState === "suspended") {
    throw new AppError(403, "forbidden", "This winery account is suspended.");
  }
}

function databaseError(message: string): AppError {
  return new AppError(500, "upstream_error", message);
}

function commandError(
  error: { code?: string; message?: string } | null,
  fallback: string,
): AppError {
  const code = error?.code;
  const message = error?.message || fallback;
  if (code === "22023") {
    return new AppError(400, "invalid_request", message);
  }
  if (code === "P0002") {
    return new AppError(404, "not_found", message);
  }
  if (code === "23505") {
    return new AppError(409, "conflict", message);
  }
  if (code === "23514" || code === "55000") {
    return new AppError(409, "conflict", message);
  }
  if (code === "42501") {
    return new AppError(403, "forbidden", message);
  }
  return databaseError(fallback);
}

function commandResult(value: unknown): Record<string, unknown> {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") {
    throw databaseError("The transactional command returned an invalid result.");
  }
  return candidate as Record<string, unknown>;
}

function toPublicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPublicValue);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    result[camelKey(key)] = toPublicValue(nested);
  }
  return result;
}

function toPublicRecord(value: unknown): Record<string, unknown> {
  return (toPublicValue(value) ?? {}) as Record<string, unknown>;
}

function rpcRecord(value: unknown): Record<string, unknown> {
  const row = Array.isArray(value) ? value[0] : value;
  return toPublicRecord(row);
}

function toPublicMember(value: unknown): Record<string, unknown> {
  const row = (value ?? {}) as Record<string, unknown>;
  const address = getAddress({
    city: row.shipping_city,
    country_code: row.shipping_country_code,
    line1: row.shipping_address_line1,
    line2: row.shipping_address_line2,
    postal_code: row.shipping_postal_code,
    region: row.shipping_region,
  });
  const tier = oneRelation(
    row.club_tiers as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null
      | undefined,
  );
  const shipments =
    (row.shipments as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    activity: shipments.map((shipment) => ({
      detail:
        typeof shipment.tracking_number === "string"
          ? `Tracking ${shipment.tracking_number}`
          : null,
      id: shipment.id,
      kind: "shipment",
      occurredAt: shipment.created_at,
      title: `Shipment ${String(shipment.status ?? "").replaceAll("_", " ")}`,
    })),
    address,
    birthday: row.birthday,
    churnRisk: "not_scored",
    createdAt: row.created_at,
    email: row.email,
    firstName: row.first_name,
    id: row.id,
    joinedAt: row.joined_on,
    lastName: row.last_name,
    lifetimeValueCents: row.lifetime_value_cents,
    orderCount: shipments.length,
    phone: row.phone,
    referredByMemberId: row.referred_by_member_id,
    status: row.status,
    tier: tier ? { id: tier.id, name: tier.name } : null,
    updatedAt: row.updated_at,
  };
}

function memberHistoryTimestamp(row: Record<string, unknown>): string {
  return String(
    row.completed_at ??
      row.refunded_at ??
      row.paid_at ??
      row.updated_at ??
      row.created_at ??
      "",
  );
}

function memberOrderFromShipment(row: Record<string, unknown>): Record<string, unknown> {
  const release = oneRelation(
    row.releases as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null
      | undefined,
  );
  const items =
    (row.shipment_items as Array<Record<string, unknown>> | undefined) ?? [];
  const discountAmountCents = Math.max(
    0,
    Number(row.loyalty_discount_cents ?? 0),
  );
  const subtotalAmountCents = Math.max(
    0,
    Number(row.charge_amount_cents ?? 0) - discountAmountCents,
  );
  const taxAmountCents = Math.max(0, Number(row.tax_amount_cents ?? 0));
  return {
    createdAt: row.created_at,
    discountAmountCents,
    id: row.id,
    items: items.map((item) => ({
      name: item.wine_name,
      quantity: Number(item.quantity ?? 0),
    })),
    releaseName: release?.name ?? "Club release",
    status: row.status,
    subtotalAmountCents,
    taxAmountCents,
    totalAmountCents: subtotalAmountCents + taxAmountCents,
  };
}

function memberOrderActivity(row: Record<string, unknown>): Record<string, unknown> {
  const order = memberOrderFromShipment(row);
  const tracking =
    typeof row.tracking_number === "string" && row.tracking_number
      ? `Tracking ${row.tracking_number}`
      : null;
  return {
    detail: tracking,
    id: `order:${String(row.id)}`,
    kind: "order",
    occurredAt: memberHistoryTimestamp(row),
    title: `${String(order.releaseName)} order ${String(row.status).replaceAll("_", " ")}`,
  };
}

function memberPaymentActivity(row: Record<string, unknown>): Record<string, unknown> {
  const attemptKind =
    row.attempt_kind === "refund" ? "Refund" : "Payment";
  const amount = Number(row.amount_cents ?? 0);
  const amountLabel = new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount / 100);
  const declineReason =
    typeof row.decline_reason === "string" && row.decline_reason
      ? row.decline_reason
      : null;
  return {
    detail: [amountLabel, declineReason].filter(Boolean).join(" · "),
    id: `payment:${String(row.id)}`,
    kind: "payment",
    occurredAt: memberHistoryTimestamp(row),
    title: `${attemptKind} ${String(row.status).replaceAll("_", " ")}`,
  };
}

function auditMetadata(row: Record<string, unknown>): Record<string, unknown> {
  return row.metadata && typeof row.metadata === "object"
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function auditActionTitle(action: string): string {
  const titles: Record<string, string> = {
    "member.cancelled": "Membership cancelled",
    "member.created": "Member created",
    "member.paused": "Membership paused",
    "member.reactivated": "Membership reactivated",
    "member.updated": "Member profile updated",
  };
  return (
    titles[action] ??
    action
      .split(".")
      .slice(1)
      .join(" ")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (character) => character.toUpperCase())
  );
}

function memberAuditActivity(row: Record<string, unknown>): Record<string, unknown> {
  const metadata = auditMetadata(row);
  const changedFields = Array.isArray(metadata.changed_fields)
    ? metadata.changed_fields.map(String)
    : [];
  return {
    detail: changedFields.length
      ? `Updated ${changedFields.join(", ")}`
      : null,
    id: `audit:${String(row.id)}`,
    kind: "status",
    occurredAt: memberHistoryTimestamp(row),
    title: auditActionTitle(String(row.action ?? "member.updated")),
  };
}

function memberCommunicationActivity(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const metadata = auditMetadata(row);
  const subject =
    typeof metadata.subject === "string" && metadata.subject.trim()
      ? metadata.subject.trim()
      : auditActionTitle(String(row.action ?? "member.communication"));
  const channel =
    typeof metadata.channel === "string" && metadata.channel.trim()
      ? metadata.channel.trim()
      : "Communication";
  return {
    detail:
      typeof metadata.detail === "string" && metadata.detail.trim()
        ? metadata.detail.trim()
        : channel.replace(/\b\w/g, (character) => character.toUpperCase()),
    id: `communication:${String(row.id)}`,
    kind: "communication",
    occurredAt: memberHistoryTimestamp(row),
    title: subject,
  };
}

function newestMemberActivity(
  values: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return values.toSorted(
    (left, right) =>
      Date.parse(String(right.occurredAt ?? "")) -
      Date.parse(String(left.occurredAt ?? "")),
  );
}

function toPublicTier(value: unknown): Record<string, unknown> {
  const row = (value ?? {}) as Record<string, unknown>;
  const memberCounts =
    (row.members as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    active: row.active,
    billingInterval: row.billing_interval,
    bottleCount: row.bottle_count,
    createdAt: row.created_at,
    description: row.description,
    frequency: row.frequency,
    id: row.id,
    memberCount: Number(memberCounts[0]?.count ?? 0),
    name: row.name,
    priceCents: row.price_cents,
    updatedAt: row.updated_at,
    upgradePathId: row.upgrade_path_id,
  };
}

function toPublicRelease(value: unknown): Record<string, unknown> {
  const row = (value ?? {}) as Record<string, unknown>;
  const releaseTiers =
    (row.release_tiers as Array<Record<string, unknown>> | undefined) ?? [];
  const releaseWines =
    (row.release_wines as Array<Record<string, unknown>> | undefined) ?? [];
  const shipments =
    (row.shipments as Array<Record<string, unknown>> | undefined) ?? [];
  const tiers = releaseTiers.map((tier) => ({
    bottleCount: tier.bottle_count,
    id: tier.tier_id,
    name: tier.tier_name,
    priceCents: tier.price_cents,
    releaseTierId: tier.id,
  }));
  const wines = releaseWines.map((wine) => {
    const tierItems =
      (wine.release_tier_items as Array<Record<string, unknown>> | undefined) ??
      [];
    return {
      id: wine.id,
      name: wine.wine_name,
      priceCents: tierItems[0]?.unit_price_cents ?? 0,
      quantity: tierItems[0]?.quantity ?? 0,
    };
  });
  const successfulChargeCount = shipments.filter((shipment) =>
    ["charged", "label_created", "packed", "shipped", "delivered"].includes(
      String(shipment.status),
    ),
  ).length;
  const declinedChargeCount = shipments.filter(
    (shipment) => shipment.status === "declined",
  ).length;
  const grossAmountCents = shipments
    .filter((shipment) =>
      ["charged", "label_created", "packed", "shipped", "delivered"].includes(
        String(shipment.status),
      ),
    )
    .reduce((sum, shipment) => sum + Number(shipment.charge_amount_cents ?? 0), 0);
  return {
    createdAt: row.created_at,
    declinedChargeCount,
    description: row.description,
    embargoDate: row.embargo_date,
    grossAmountCents,
    id: row.id,
    memberCount: shipments.length,
    name: row.name,
    notificationLeadDays: row.notification_lead_days,
    processingDate: row.processing_date,
    status: row.status,
    successfulChargeCount,
    tiers,
    updatedAt: row.updated_at,
    wines,
  };
}

function toPublicShipment(value: unknown): Record<string, unknown> {
  const row = (value ?? {}) as Record<string, unknown>;
  const member = oneRelation(
    row.members as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null
      | undefined,
  );
  const release = oneRelation(
    row.releases as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null
      | undefined,
  );
  const releaseTier = oneRelation(
    row.release_tiers as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null
      | undefined,
  );
  const items =
    (row.shipment_items as Array<Record<string, unknown>> | undefined) ?? [];
  const subtotalAmountCents = Math.max(
    0,
    Number(row.charge_amount_cents ?? 0) -
      Number(row.loyalty_discount_cents ?? 0),
  );
  const taxAmountCents = Math.max(0, Number(row.tax_amount_cents ?? 0));
  const payableAmountCents = subtotalAmountCents + taxAmountCents;
  return {
    address: getAddress(row.shipping_address),
    carrier: row.carrier,
    chargeAmountCents: payableAmountCents,
    createdAt: row.created_at,
    declineReason: row.decline_reason,
    id: row.id,
    items: items.map((item) => ({
      id: item.id,
      name: item.wine_name,
      priceCents: item.price_cents,
      quantity: item.quantity,
    })),
    memberEmail: member?.email,
    memberId: row.member_id,
    memberName: member
      ? `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim()
      : "",
    nextRetryDate: row.next_retry_at,
    loyaltyDiscountCents: Number(row.loyalty_discount_cents ?? 0),
    payableAmountCents,
    releaseId: row.release_id,
    releaseName: release?.name ?? "",
    retryCount: row.retry_count,
    status: row.status,
    subtotalAmountCents,
    taxAmountCents,
    tierName: releaseTier?.tier_name,
    trackingNumber: row.tracking_number,
    updatedAt: row.updated_at,
  };
}

function addressToDatabase(address: PostalAddress | null | undefined):
  | Record<string, string | null>
  | null
  | undefined {
  if (address === undefined) return undefined;
  if (address === null) return null;
  return {
    shipping_address_line1: address.line1.trim(),
    shipping_address_line2: address.line2?.trim() || null,
    shipping_city: address.city.trim(),
    shipping_country_code: address.country.trim().toUpperCase(),
    shipping_postal_code: address.postalCode.trim(),
    shipping_region: address.state.trim().toUpperCase(),
  };
}

function memberToDatabase(input: Partial<MemberInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.birthday !== undefined) payload.birthday = input.birthday;
  if (input.clubTierId !== undefined) payload.club_tier_id = input.clubTierId;
  if (input.email !== undefined) payload.email = normalizeEmail(input.email);
  if (input.firstName !== undefined) payload.first_name = input.firstName.trim();
  if (input.joinDate !== undefined) payload.joined_on = input.joinDate;
  if (input.lastName !== undefined) payload.last_name = input.lastName.trim();
  if (input.phone !== undefined) payload.phone = input.phone?.trim() || null;
  if (input.referredByMemberId !== undefined) {
    payload.referred_by_member_id = input.referredByMemberId;
  }
  if (input.shippingAddress !== undefined) {
    if (input.shippingAddress === null) {
      Object.assign(payload, {
        shipping_address_line1: null,
        shipping_address_line2: null,
        shipping_city: null,
        shipping_country_code: "US",
        shipping_postal_code: null,
        shipping_region: null,
      });
    } else {
      Object.assign(payload, addressToDatabase(input.shippingAddress));
    }
  }
  if (input.status !== undefined) payload.status = input.status;
  return payload;
}

function tierToDatabase(input: Partial<ClubTierInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.billingInterval !== undefined) {
    payload.billing_interval = input.billingInterval;
  }
  if (input.bottleCount !== undefined) payload.bottle_count = input.bottleCount;
  if (input.description !== undefined) payload.description = input.description;
  if (input.frequency !== undefined) payload.frequency = input.frequency;
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.priceCents !== undefined) payload.price_cents = input.priceCents;
  if (input.upgradePathId !== undefined) {
    payload.upgrade_path_id = input.upgradePathId;
  }
  return payload;
}

function releaseToDatabase(input: Partial<ReleaseInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.description !== undefined) payload.description = input.description;
  if (input.embargoDate !== undefined) payload.embargo_date = input.embargoDate;
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.processingDate !== undefined) {
    payload.processing_date = input.processingDate;
  }
  return payload;
}

function oneRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function allowedStates(env: WorkerEnv): Set<string> {
  const configured = env.SHIPPING_ALLOWED_STATES?.split(",")
    .map((state) => state.trim().toUpperCase())
    .filter(Boolean);
  return configured?.length ? new Set(configured) : DEFAULT_ALLOWED_STATES;
}

/**
 * Phase 2's state whitelist is retained only as an explicitly inactive
 * emergency reference. It is not a legal compliance decision and is never
 * consulted by address validation, the compliance dashboard, or label
 * generation after the Phase 4 ShipCompliant gate was introduced.
 */
export function assessLegacyShippingWhitelist(
  env: WorkerEnv,
  address: PostalAddress,
): { allowed: boolean; reason: string | null } {
  const countryAllowed = address.country.toUpperCase() === "US";
  const stateAllowed = allowedStates(env).has(address.state.toUpperCase());
  return {
    allowed: countryAllowed && stateAllowed,
    reason: countryAllowed
      ? stateAllowed
        ? null
        : `The legacy Phase 2 whitelist did not include ${address.state.toUpperCase()}.`
      : "The legacy Phase 2 whitelist covered only United States destinations.",
  };
}

function deterministicDigits(hash: string, length: number): string {
  return hash
    .slice(0, length)
    .split("")
    .map((character) => (Number.parseInt(character, 16) % 10).toString())
    .join("");
}

export class SimulatedShippingProvider implements ShippingProvider {
  async validateAddress(address: PostalAddress): Promise<AddressValidationResult> {
    const valid =
      address.line1.trim().length >= 3 &&
      address.city.trim().length >= 2 &&
      /^[A-Z]{2}$/i.test(address.state) &&
      /^\d{5}(?:-\d{4})?$/.test(address.postalCode) &&
      address.country.toUpperCase() === "US";
    return {
      address: {
        ...address,
        country: address.country.toUpperCase(),
        state: address.state.toUpperCase(),
      },
      messages: valid ? [] : ["The address is incomplete or invalid."],
      valid,
    };
  }

  async createLabel(
    input: LabelRequest,
    recovery?: LabelPurchaseRecovery,
  ): Promise<LabelResult> {
    const hash = await sha256(JSON.stringify(input));
    const label = {
      carrier: "SIMULATED",
      labelId: `simlabel_${hash.slice(0, 18)}`,
      labelUrl: `https://example.invalid/labels/${hash.slice(0, 24)}.pdf`,
      providerReference:
        recovery?.externalShipmentId ?? `simshipment_${hash.slice(0, 18)}`,
      rateId: recovery?.externalRateId ?? `simrate_${hash.slice(0, 18)}`,
      rateCents: 1_595,
      service: "Ground",
      trackingNumber: `1ZSIM${deterministicDigits(hash, 12)}`,
    };
    if (!recovery) {
      throw new AppError(
        503,
        "activation_required",
        "Simulated label creation requires a durable database attempt lease.",
      );
    }
    if (!recovery.externalShipmentId) {
      await recovery.persistExternalShipment(
        label.providerReference,
        label.rateId,
      );
    }
    return label;
  }
}

interface EasyPostAddress {
  city?: string;
  country?: string;
  id?: string;
  message?: string;
  state?: string;
  street1?: string;
  street2?: string;
  verifications?: {
    delivery?: {
      errors?: Array<{ message?: string }>;
      success?: boolean;
    };
  };
  zip?: string;
}

interface EasyPostRate {
  carrier?: string;
  id?: string;
  rate?: string;
  service?: string;
}

interface EasyPostShipment {
  id?: string;
  lowest_rate?: EasyPostRate;
  postage_label?: { id?: string; label_file_type?: string; label_url?: string };
  rates?: EasyPostRate[];
  selected_rate?: EasyPostRate;
  tracker?: { tracking_code?: string };
  tracking_code?: string;
}

export class EasyPostShippingProvider implements ShippingProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    authority: {
      appEnvironment: WorkerEnv["APP_ENV"];
      liveLabelsEnabled?: WorkerEnv["EASYPOST_LIVE_LABELS_ENABLED"];
    } = {
      appEnvironment: "test",
      liveLabelsEnabled: "false",
    },
  ) {
    assertEasyPostTarget({
      apiKey,
      appEnvironment: authority.appEnvironment,
      liveLabelsEnabled: authority.liveLabelsEnabled,
    });
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(`https://api.easypost.com/v2${path}`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json()) as T & {
      error?: { message?: string };
    };
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "shipping.provider_request_failed",
          path,
          status: response.status,
        }),
      );
      throw new AppError(
        502,
        "upstream_error",
        "The shipping provider rejected the request.",
      );
    }
    return payload;
  }

  private async retrieve<T>(path: string): Promise<T> {
    const response = await this.fetcher(`https://api.easypost.com/v2${path}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`,
        Accept: "application/json",
      },
      method: "GET",
    });
    const payload = (await response.json()) as T & {
      error?: { message?: string };
    };
    if (!response.ok) {
      console.error(
        JSON.stringify({
          event: "shipping.provider_retrieval_failed",
          path,
          status: response.status,
        }),
      );
      throw new AppError(
        502,
        "upstream_error",
        "The stored carrier shipment could not be retrieved.",
      );
    }
    return payload;
  }

  async validateAddress(address: PostalAddress): Promise<AddressValidationResult> {
    const result = await this.request<EasyPostAddress>("/addresses", {
      address: {
        city: address.city,
        country: address.country,
        state: address.state,
        street1: address.line1,
        street2: address.line2 || undefined,
        zip: address.postalCode,
      },
      verify: true,
    });
    const delivery = result.verifications?.delivery;
    const messages = (delivery?.errors ?? [])
      .map((error) => error.message)
      .filter((message): message is string => Boolean(message));
    return {
      address: {
        city: result.city ?? address.city,
        country: result.country ?? address.country,
        line1: result.street1 ?? address.line1,
        line2: result.street2 ?? address.line2,
        postalCode: result.zip ?? address.postalCode,
        state: result.state ?? address.state,
      },
      messages,
      providerReference: result.id,
      valid: delivery?.success === true,
    };
  }

  async createLabel(
    input: LabelRequest,
    recovery?: LabelPurchaseRecovery,
  ): Promise<LabelResult> {
    let shipment = recovery?.externalShipmentId
      ? await this.retrieve<EasyPostShipment>(
          `/shipments/${encodeURIComponent(recovery.externalShipmentId)}`,
        )
      : await this.request<EasyPostShipment>("/shipments", {
          shipment: {
            from_address: toEasyPostAddress(input.fromAddress, input.fromContact),
            options: {
              alcohol: true,
              delivery_confirmation: "ADULT_SIGNATURE",
            },
            parcel: {
              height: input.parcel.heightInches,
              length: input.parcel.lengthInches,
              weight: input.parcel.weightOunces,
              width: input.parcel.widthInches,
            },
            reference: input.externalId,
            to_address: toEasyPostAddress(input.toAddress, input.toContact),
          },
        });
    const rate =
      shipment.rates?.find((candidate) =>
        recovery?.externalRateId
          ? candidate.id === recovery.externalRateId
          : false,
      ) ??
      shipment.selected_rate ??
      shipment.lowest_rate ??
      [...(shipment.rates ?? [])].sort(
        (left, right) => Number(left.rate ?? Infinity) - Number(right.rate ?? Infinity),
      )[0];
    if (!shipment.id || !rate?.id) {
      throw new AppError(502, "upstream_error", "No carrier rate is available.");
    }
    if (!recovery?.externalShipmentId) {
      if (!recovery) {
        throw new AppError(
          503,
          "activation_required",
          "EasyPost label purchases require a durable database attempt lease.",
        );
      }
      await recovery.persistExternalShipment(shipment.id, rate.id);
    }
    const alreadyPurchased =
      Boolean(shipment.postage_label?.label_url) &&
      Boolean(shipment.tracking_code ?? shipment.tracker?.tracking_code);
    const purchased = alreadyPurchased
      ? shipment
      : await this.request<EasyPostShipment>(
          `/shipments/${shipment.id}/buy`,
          { rate: { id: rate.id } },
        );
    const purchasedRate = purchased.selected_rate ?? rate;
    const trackingNumber =
      purchased.tracking_code ?? purchased.tracker?.tracking_code;
    const labelUrl = purchased.postage_label?.label_url;
    if (!trackingNumber || !labelUrl) {
      throw new AppError(502, "upstream_error", "The carrier did not return a label.");
    }
    return {
      carrier: purchasedRate.carrier ?? "unknown",
      labelId:
        purchased.postage_label?.id ??
        `easypost_label_${(purchased.id ?? shipment.id).slice(0, 20)}`,
      labelUrl,
      providerReference: purchased.id ?? shipment.id,
      rateId: purchasedRate.id ?? rate.id,
      rateCents: Math.round(Number(purchasedRate.rate ?? 0) * 100),
      service: purchasedRate.service ?? "unknown",
      trackingNumber,
    };
  }
}

function toEasyPostAddress(
  address: PostalAddress,
  contact?: { company?: string; name: string; phone: string },
): Record<string, string | undefined> {
  return {
    city: address.city,
    company: contact?.company,
    country: address.country,
    name: contact?.name,
    phone: contact?.phone,
    state: address.state,
    street1: address.line1,
    street2: address.line2 || undefined,
    zip: address.postalCode,
  };
}

export function createShippingProvider(env: WorkerEnv): ShippingProvider {
  if (env.SHIPPING_PROVIDER === "simulated") {
    if (
      env.APP_ENV !== "test" ||
      env.SHIPPING_SIMULATOR_ENABLED !== "true"
    ) {
      throw new AppError(
        503,
        "activation_required",
        "The shipping simulator requires APP_ENV=test and SHIPPING_SIMULATOR_ENABLED=true.",
      );
    }
    return new SimulatedShippingProvider();
  }
  if (env.SHIPPING_PROVIDER === "easypost") {
    return new EasyPostShippingProvider(
      requireConfigured(env.EASYPOST_API_KEY, "EASYPOST_API_KEY"),
      fetch,
      {
        appEnvironment: env.APP_ENV,
        liveLabelsEnabled: env.EASYPOST_LIVE_LABELS_ENABLED,
      },
    );
  }
  throw new AppError(
    503,
    "activation_required",
    "SHIPPING_PROVIDER must be connected before shipping operations can run.",
  );
}

function parseCsv(contents: string): { headers: string[]; rows: CsvRow[] } {
  if (Buffer.byteLength(contents, "utf8") > CSV_MAX_BYTES) {
    throw new AppError(413, "invalid_request", "CSV files cannot exceed 5 MB.");
  }
  if (contents.includes("\0")) {
    throw new AppError(400, "invalid_request", "The CSV file contains invalid bytes.");
  }

  const records: string[][] = [];
  let current = "";
  let quoted = false;
  let row: string[] = [];
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (character === '"') {
      if (quoted && contents[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === ",") {
      row.push(current);
      current = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && contents[index + 1] === "\n") index += 1;
      row.push(current);
      if (row.some((value) => value.length > 0)) records.push(row);
      row = [];
      current = "";
      continue;
    }
    current += character;
  }
  if (quoted) {
    throw new AppError(400, "invalid_request", "The CSV file has an unclosed quote.");
  }
  row.push(current);
  if (row.some((value) => value.length > 0)) records.push(row);
  const headerRecord = records.shift();
  if (!headerRecord?.length) {
    throw new AppError(400, "invalid_request", "The CSV file has no header row.");
  }
  const headers = headerRecord.map((header, index) => {
    const normalized = header.replace(/^\uFEFF/, "").trim();
    return normalized || `column_${index + 1}`;
  });
  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
    throw new AppError(400, "invalid_request", "CSV column names must be unique.");
  }
  if (records.length > CSV_MAX_ROWS) {
    throw new AppError(
      400,
      "invalid_request",
      `A single import cannot exceed ${CSV_MAX_ROWS} member rows.`,
    );
  }
  return {
    headers,
    rows: records.map((values, index) => ({
      rowNumber: index + 2,
      values: Object.fromEntries(
        headers.map((header, column) => [header, values[column]?.trim() ?? ""]),
      ),
    })),
  };
}

const FORMAT_MAPPINGS: Record<
  Exclude<CsvPreviewInput["format"], "generic">,
  CsvMapping
> = {
  commerce7: {
    city: "Ship To City",
    clubTier: "Club",
    country: "Ship To Country Code",
    email: "Customer Email",
    firstName: "Customer First Name",
    joinDate: "Signup Date",
    lastName: "Customer Last Name",
    line1: "Ship To Address",
    line2: "Ship To Address 2",
    phone: "Customer Phone",
    postalCode: "Ship To Zip Code",
    state: "Ship To State Code",
    status: "Status",
  },
  winedirect: {
    city: "Ship City",
    clubTier: "Club",
    country: "Ship Country",
    email: "Email",
    firstName: "FirstName",
    joinDate: "Club Signup Date",
    lastName: "LastName",
    line1: "Ship Address",
    line2: "Ship Address 2",
    phone: "Phone",
    postalCode: "Ship Zip",
    state: "Ship State",
    status: "Club Status",
  },
};

function inferGenericMapping(headers: string[]): CsvMapping {
  const normalized = new Map(
    headers.map((header) => [header.toLowerCase().replace(/[^a-z0-9]/g, ""), header]),
  );
  const find = (...aliases: string[]): string | undefined =>
    aliases.map((alias) => normalized.get(alias)).find(Boolean);
  const email = find("email", "emailaddress");
  const firstName = find("firstname", "givenname");
  const lastName = find("lastname", "surname", "familyname");
  if (!email || !firstName || !lastName) {
    throw new AppError(
      400,
      "invalid_request",
      "Map the email, first name, and last name columns before previewing.",
    );
  }
  return {
    city: find("city", "shipcity"),
    clubTier: find("clubtier", "club", "clubtitle"),
    country: find("country", "countrycode", "shipcountry"),
    email,
    firstName,
    joinDate: find("joindate", "signupdate", "clubsignupdate"),
    lastName,
    line1: find("address", "address1", "street", "shipaddress"),
    line2: find("address2", "street2", "shipaddress2"),
    phone: find("phone", "phonenumber"),
    postalCode: find("postalcode", "zipcode", "zip", "shipzip"),
    state: find("state", "statecode", "shipstate"),
    status: find("status", "clubstatus"),
  };
}

function valueFor(row: CsvRow, column: string | undefined): string {
  return column ? row.values[column]?.trim() ?? "" : "";
}

function normalizeCsvStatus(value: string): MemberStatus {
  const normalized = value.trim().toLowerCase();
  if (["paused", "hold", "onhold", "on hold"].includes(normalized)) return "paused";
  if (["cancelled", "canceled", "inactive", "terminated"].includes(normalized)) {
    return "cancelled";
  }
  return "active";
}

function normalizeCsvMember(row: CsvRow, mapping: CsvMapping): NormalizedCsvMember {
  const line1 = valueFor(row, mapping.line1);
  const city = valueFor(row, mapping.city);
  const state = valueFor(row, mapping.state);
  const postalCode = valueFor(row, mapping.postalCode);
  const hasAddress = Boolean(line1 || city || state || postalCode);
  return {
    clubTierId: null,
    clubTierValue: valueFor(row, mapping.clubTier) || null,
    email: normalizeEmail(valueFor(row, mapping.email)),
    firstName: valueFor(row, mapping.firstName),
    joinDate: valueFor(row, mapping.joinDate) || null,
    lastName: valueFor(row, mapping.lastName),
    phone: valueFor(row, mapping.phone) || null,
    rowNumber: row.rowNumber,
    shippingAddress: hasAddress
      ? {
          city,
          country: valueFor(row, mapping.country) || "US",
          line1,
          line2: valueFor(row, mapping.line2) || null,
          postalCode,
          state,
        }
      : null,
    status: normalizeCsvStatus(valueFor(row, mapping.status)),
  };
}

const IMPORT_TARGET_KEYS: Record<string, string> = {
  city: "shipping_city",
  clubTier: "club_tier_id",
  country: "shipping_country_code",
  email: "email",
  firstName: "first_name",
  joinDate: "joined_on",
  lastName: "last_name",
  line1: "shipping_address_line1",
  line2: "shipping_address_line2",
  phone: "phone",
  postalCode: "shipping_postal_code",
  state: "shipping_region",
  status: "status",
};

const REQUIRED_IMPORT_TARGETS = ["email", "first_name", "last_name"] as const;

export function canonicalizeCsvImportMapping(
  sourceToTarget: Record<string, string>,
): Record<string, string> {
  const canonical: Record<string, string> = {};
  for (const [sourceValue, targetValue] of Object.entries(sourceToTarget)) {
    const source = sourceValue.trim();
    const target = targetValue.trim();
    if (!target) continue;
    const databaseTarget = IMPORT_TARGET_KEYS[target];
    if (!databaseTarget) {
      throw new AppError(
        400,
        "invalid_request",
        `The CSV target "${target}" is not supported.`,
      );
    }
    if (!source) {
      throw new AppError(400, "invalid_request", "CSV source columns cannot be empty.");
    }
    if (canonical[databaseTarget]) {
      throw new AppError(
        400,
        "invalid_request",
        `Only one CSV column can map to ${target}.`,
      );
    }
    canonical[databaseTarget] = source;
  }
  if (REQUIRED_IMPORT_TARGETS.some((target) => !canonical[target])) {
    throw new AppError(
      400,
      "invalid_request",
      "Map the email, first name, and last name columns before importing.",
    );
  }
  return canonical;
}

function csvMappingToDatabase(mapping: CsvMapping): Record<string, string> {
  return canonicalizeCsvImportMapping(
    Object.fromEntries(
      Object.entries(mapping)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([target, source]) => [source, target]),
    ),
  );
}

export function buildCsvTierLookup(
  tiers: Array<{ id: string; name: string }>,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const tier of tiers) {
    lookup.set(tier.id.trim().toLowerCase(), tier.id);
    lookup.set(tier.name.trim().toLowerCase(), tier.id);
  }
  return lookup;
}

export function resolveCsvTierId(
  value: string | null,
  lookup: ReadonlyMap<string, string>,
): string | null {
  if (!value?.trim()) return null;
  return lookup.get(value.trim().toLowerCase()) ?? null;
}

function normalizedMemberToDatabase(
  member: NormalizedCsvMember,
): Record<string, unknown> {
  return {
    club_tier_id: member.clubTierId,
    email: member.email,
    first_name: member.firstName,
    joined_on: member.joinDate,
    last_name: member.lastName,
    phone: member.phone,
    ...(addressToDatabase(member.shippingAddress) ?? {}),
    status: member.status,
  };
}

function validateCsvMember(member: NormalizedCsvMember): CsvValidationError | null {
  const fields: Record<string, string> = {};
  if (!member.firstName) fields.firstName = "First name is required.";
  if (!member.lastName) fields.lastName = "Last name is required.";
  if (
    !member.email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email) ||
    member.email.length > 254
  ) {
    fields.email = "Enter a valid email address.";
  }
  if (member.joinDate && Number.isNaN(Date.parse(member.joinDate))) {
    fields.joinDate = "Enter a valid date.";
  }
  if (member.shippingAddress) {
    if (!member.shippingAddress.line1) fields.line1 = "Address line 1 is required.";
    if (!member.shippingAddress.city) fields.city = "City is required.";
    if (!/^[A-Za-z]{2}$/.test(member.shippingAddress.state)) {
      fields.state = "Use a two-letter state code.";
    }
    if (!member.shippingAddress.postalCode) {
      fields.postalCode = "Postal code is required.";
    }
  }
  return Object.keys(fields).length
    ? {
        fields,
        reason: "One or more fields are invalid.",
        rowNumber: member.rowNumber,
      }
    : null;
}

function getAddress(value: unknown): PostalAddress | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const line1 = input.line1;
  const city = input.city;
  const state = input.state ?? input.region ?? input.shipping_region;
  const postalCode = input.postal_code ?? input.postalCode;
  const country = input.country ?? input.country_code;
  if (
    typeof line1 !== "string" ||
    typeof city !== "string" ||
    typeof state !== "string" ||
    typeof postalCode !== "string" ||
    typeof country !== "string"
  ) {
    return null;
  }
  return {
    city,
    country,
    line1,
    line2:
      typeof input.line2 === "string" || input.line2 === null
        ? input.line2
        : null,
    postalCode,
    state,
  };
}

function parseOriginAddress(value: unknown): PostalAddress {
  const address = getAddress(value);
  if (!address) {
    throw new AppError(
      503,
      "activation_required",
      "A complete winery shipping origin must be configured before labels can be generated.",
    );
  }
  return address;
}

function isUsableShippingPhone(value: string): boolean {
  return value.replaceAll(/\D/g, "").length >= 10;
}

export function isCompleteShippingContact(
  contact: { company?: string; name: string; phone: string },
  requireCompany = false,
): boolean {
  return Boolean(
    contact.name.trim() &&
      isUsableShippingPhone(contact.phone) &&
      (!requireCompany || contact.company?.trim()),
  );
}

function paymentDeclineReason(error: unknown): string {
  if (error instanceof Stripe.errors.StripeCardError) {
    return error.decline_code ?? error.code ?? "card_declined";
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "payment_failed";
}

async function resolveStripePaymentMethod(
  stripe: Stripe,
  admin: SupabaseClient,
  member: MemberRow,
): Promise<string | null> {
  if (!member.stripe_customer_id) return null;
  const customer = await stripe.customers.retrieve(member.stripe_customer_id);
  if (customer.deleted) {
    throw new AppError(
      409,
      "conflict",
      "The member's Stripe customer has been deleted.",
    );
  }
  const configured = customer.invoice_settings.default_payment_method;
  const paymentMethodId =
    typeof configured === "string" ? configured : configured?.id ?? null;
  if (paymentMethodId !== member.stripe_payment_method_id) {
    let update = admin
      .from("members")
      .update({ stripe_payment_method_id: paymentMethodId })
      .eq("id", member.id)
      .eq("organization_id", member.organization_id);
    if (member.brand_id) update = update.eq("brand_id", member.brand_id);
    const { error } = await update;
    if (error) throw databaseError("The member payment method could not be synchronized.");
  }
  return paymentMethodId;
}

function paymentIdempotencyKey(
  shipment: ShipmentPaymentRow,
  source: "release_processing" | "manual_retry",
): string {
  return source === "release_processing"
    ? `shipment:${shipment.id}:charge`
    : `shipment:${shipment.id}:manual-retry:${shipment.retry_count + 1}`;
}

function shipmentSubtotalAmount(shipment: ShipmentPaymentRow): number {
  return Math.max(
    0,
    shipment.charge_amount_cents - Number(shipment.loyalty_discount_cents ?? 0),
  );
}

function payableShipmentAmount(shipment: ShipmentPaymentRow): number {
  return (
    shipmentSubtotalAmount(shipment) +
    Math.max(0, Number(shipment.tax_amount_cents ?? 0))
  );
}

export function brandAllowsOperationalAccess(input: {
  active: boolean;
  access_status: string;
  billing_mode: string;
  organization_access_status: string;
}): boolean {
  if (!input.active) return false;
  const permitsCharges = (status: string) =>
    status === "active" || status === "grace";
  return input.billing_mode === "independent"
    ? permitsCharges(input.access_status)
    : permitsCharges(input.organization_access_status);
}

async function assertBrandOperationalAccess(
  admin: SupabaseClient,
  organizationId: string,
  brandId: string,
): Promise<void> {
  const [{ data: brand, error: brandError }, { data: organization, error: orgError }] =
    await Promise.all([
      admin
        .from("brands")
        .select("id,active,billing_mode,access_status")
        .eq("organization_id", organizationId)
        .eq("id", brandId)
        .maybeSingle(),
      admin
        .from("organizations")
        .select("id,access_status")
        .eq("id", organizationId)
        .maybeSingle(),
    ]);
  if (
    brandError ||
    orgError ||
    !brand ||
    !organization ||
    !brandAllowsOperationalAccess({
      active: Boolean(brand.active),
      access_status: String(brand.access_status),
      billing_mode: String(brand.billing_mode),
      organization_access_status: String(organization.access_status),
    })
  ) {
    throw new AppError(403, "forbidden", "This wine club is suspended.");
  }
}

interface PreparedAvalaraTax {
  calculationId: string;
  client: AvalaraClient;
  connectionId: string;
  quote: AvalaraTaxQuote;
  requestHash: string;
  status: "committed" | "temporary";
}

async function persistAvalaraTaxStatus(
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
  prepared: PreparedAvalaraTax,
  status: "committed" | "temporary" | "voided",
): Promise<string> {
  const { data, error } = await admin.rpc("record_avalara_tax_calculation", {
    p_connection_id: prepared.connectionId,
    p_currency_code: prepared.quote.currencyCode,
    p_document_code: prepared.quote.code,
    p_document_status: status,
    p_exempt_amount_cents: prepared.quote.exemptAmountCents,
    p_jurisdiction_summary: prepared.quote.jurisdictionSummary,
    p_provider_transaction_code: prepared.quote.code,
    p_request_hash: prepared.requestHash,
    p_response_hash: await sha256(
      JSON.stringify({ quote: prepared.quote, status }),
    ),
    p_shipment_id: shipment.id,
    p_shipping_tax_cents: prepared.quote.shippingTaxCents,
    p_tax_amount_cents: prepared.quote.taxCents,
    p_taxable_basis_cents: shipmentSubtotalAmount(shipment),
  });
  if (error || typeof data !== "string") {
    throw databaseError("The Avalara tax ledger could not be persisted.");
  }
  return data;
}

export async function prepareAvalaraTax(
  env: WorkerEnv,
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
): Promise<PreparedAvalaraTax | null> {
  const { data: connection, error: connectionError } = await admin
    .from("integration_connections")
    .select("id,status,opted_in")
    .eq("organization_id", shipment.organization_id)
    .eq("brand_id", shipment.brand_id)
    .eq("integration_type", "avalara")
    .maybeSingle();
  if (connectionError) {
    throw databaseError("Avalara activation could not be checked.");
  }
  if (!connection || !connection.opted_in) return null;
  if (connection.status !== "active") {
    throw new AppError(
      503,
      "activation_required",
      "Avalara is enabled for this brand but its credentials are not active.",
    );
  }
  const { data: runtimeValue, error: runtimeError } = await admin.rpc(
    "get_integration_runtime",
    {
      p_brand_id: shipment.brand_id,
      p_integration_type: "avalara",
      p_organization_id: shipment.organization_id,
      p_include_credentials: true,
    },
  );
  const runtime = Array.isArray(runtimeValue) ? runtimeValue[0] : runtimeValue;
  if (
    runtimeError ||
    !runtime ||
    runtime.storage_mode !== "encrypted_envelope" ||
    runtime.algorithm !== "A256GCM" ||
    runtime.envelope_version !== 1
  ) {
    throw new AppError(
      503,
      "activation_required",
      "Avalara is enabled but its encrypted credentials are unavailable.",
    );
  }
  const credentials = await decryptIntegrationCredentials<AvalaraCredentials>(
    env,
    {
      integrationType: "avalara",
      organizationId: shipment.organization_id,
      targetId: String(runtime.connection_id),
    },
    {
      algorithm: "A256GCM",
      ciphertext: String(runtime.credential_ciphertext),
      iv: String(runtime.credential_iv),
      keyVersion: String(runtime.key_version),
      version: 1,
    },
  );
  assertAvalaraBaseUrlEnvironment(env, credentials.baseUrl);
  const { data: sourceValue, error: sourceError } = await admin.rpc(
    "get_avalara_shipment_source",
    {
      p_connection_id: connection.id,
      p_shipment_id: shipment.id,
    },
  );
  const source = Array.isArray(sourceValue) ? sourceValue[0] : sourceValue;
  const destination = getAddress(source?.shipping_address);
  const origin = getAddress(source?.shipping_origin_address);
  if (sourceError || !source || !destination || !origin) {
    throw new AppError(
      503,
      "activation_required",
      "Avalara requires complete origin and destination addresses.",
    );
  }
  const shipmentSubtotalCents = shipmentSubtotalAmount(shipment);
  const shippingChargeCents = Math.min(
    shipmentSubtotalCents,
    Math.max(0, Number(source.shipping_charge_cents ?? 0)),
  );
  const wineSubtotalCents = shipmentSubtotalCents - shippingChargeCents;
  const wineTaxCode =
    typeof source.wine_tax_code === "string" ? source.wine_tax_code : null;
  const wineItemCode =
    typeof source.wine_item_code === "string" ? source.wine_item_code : null;
  const shippingTaxCode =
    typeof source.shipping_tax_code === "string"
      ? source.shipping_tax_code
      : null;
  const shippingItemCode =
    typeof source.shipping_item_code === "string"
      ? source.shipping_item_code
      : null;
  if (!wineTaxCode || !wineItemCode) {
    throw new AppError(
      503,
      "activation_required",
      "Avalara requires a wine tax-code mapping for this brand and tier.",
    );
  }
  if (shippingChargeCents > 0 && (!shippingTaxCode || !shippingItemCode)) {
    throw new AppError(
      503,
      "activation_required",
      "Avalara requires a shipping tax-code mapping when shipping is charged.",
    );
  }
  const request: AvalaraTaxRequest = {
    currencyCode: "USD",
    customerCode:
      typeof source.provider_customer_code === "string"
        ? source.provider_customer_code
        : `member-${shipment.member_id}`,
    destination,
    entityUseCode:
      typeof source.entity_use_code === "string"
        ? source.entity_use_code
        : null,
    exemptionNumber:
      typeof source.provider_exemption_reference === "string"
        ? source.provider_exemption_reference
        : null,
    lines: [
      {
        amountCents: wineSubtotalCents,
        description: "Wine club shipment",
        itemCode: wineItemCode,
        kind: "wine",
        quantity: 1,
        taxCode: wineTaxCode,
      },
      ...(shippingChargeCents > 0
        ? [
            {
              amountCents: shippingChargeCents,
              description: "Wine club shipping",
              itemCode: shippingItemCode!,
              kind: "shipping" as const,
              quantity: 1,
              taxCode: shippingTaxCode!,
            },
          ]
        : []),
    ],
    origin,
    transactionCode:
      `VIN-${shipment.id}` +
      (shipment.retry_count > 0 ? `-R${shipment.retry_count}` : ""),
    transactionDate: new Date().toISOString().slice(0, 10),
  };
  const requestHash = await sha256(JSON.stringify(request));
  const client = new AvalaraClient(credentials);
  const { data: existing, error: existingError } = await admin
    .from("avalara_tax_calculations")
    .select(
      "id,provider_transaction_code,document_code,document_status,currency_code,tax_amount_cents,shipping_tax_cents,exempt_amount_cents,jurisdiction_summary,request_hash",
    )
    .eq("connection_id", connection.id)
    .eq("organization_id", shipment.organization_id)
    .eq("brand_id", shipment.brand_id)
    .eq("shipment_id", shipment.id)
    .in("document_status", ["temporary", "committed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    throw databaseError("The saved Avalara calculation could not be loaded.");
  }
  if (existing) {
    if (String(existing.request_hash) !== requestHash) {
      if (existing.document_status === "committed") {
        throw new AppError(
          409,
          "conflict",
          "A committed Avalara transaction cannot be replaced after shipment inputs change.",
        );
      }
    } else {
      if (
        existing.document_status === "committed" &&
        ["pending", "declined"].includes(shipment.status)
      ) {
        throw new AppError(
          409,
          "conflict",
          "A committed Avalara transaction cannot be reused for an uncharged shipment.",
        );
      }
      const prepared: PreparedAvalaraTax = {
        calculationId: String(existing.id),
        client,
        connectionId: String(connection.id),
        quote: {
          code: String(
            existing.provider_transaction_code ?? existing.document_code,
          ),
          currencyCode: String(existing.currency_code ?? "USD"),
          jurisdictionSummary: Array.isArray(existing.jurisdiction_summary)
            ? existing.jurisdiction_summary
            : [],
          providerId: null,
          exemptAmountCents: Number(existing.exempt_amount_cents ?? 0),
          shippingTaxCents: Number(existing.shipping_tax_cents ?? 0),
          status: "Saved",
          taxCents: Number(existing.tax_amount_cents ?? 0),
          totalCents:
            shipmentSubtotalAmount(shipment) +
            Number(existing.tax_amount_cents ?? 0),
        },
        requestHash: String(existing.request_hash),
        status:
          existing.document_status === "committed" ? "committed" : "temporary",
      };
      const { data: rebound, error: reboundError } = await admin
        .from("shipments")
        .update({
          avalara_tax_calculation_id: prepared.calculationId,
          tax_amount_cents: prepared.quote.taxCents,
        })
        .eq("id", shipment.id)
        .eq("organization_id", shipment.organization_id)
        .eq("brand_id", shipment.brand_id)
        .in("status", ["pending", "declined"])
        .select("id")
        .maybeSingle();
      if (reboundError || !rebound) {
        throw databaseError(
          "The saved Avalara calculation could not be rebound.",
        );
      }
      shipment.tax_amount_cents = prepared.quote.taxCents;
      return prepared;
    }
  }
  const quote = await client.createTaxQuote(request);
  const prepared: PreparedAvalaraTax = {
    calculationId: "",
    client,
    connectionId: String(connection.id),
    quote,
    requestHash,
    status: "temporary",
  };
  prepared.calculationId = await persistAvalaraTaxStatus(
    admin,
    shipment,
    prepared,
    "temporary",
  );
  const { data: bound, error: bindingError } = await admin
    .from("shipments")
    .update({
      avalara_tax_calculation_id: prepared.calculationId,
      tax_amount_cents: quote.taxCents,
    })
    .eq("id", shipment.id)
    .eq("organization_id", shipment.organization_id)
    .eq("brand_id", shipment.brand_id)
    .in("status", ["pending", "declined"])
    .select("id")
    .maybeSingle();
  if (bindingError || !bound) {
    await client.voidTransaction(quote.code).catch(() => undefined);
    await persistAvalaraTaxStatus(admin, shipment, prepared, "voided").catch(
      () => undefined,
    );
    throw databaseError("The saved Avalara calculation could not be bound.");
  }
  shipment.tax_amount_cents = quote.taxCents;
  return prepared;
}

async function finalizeAvalaraTax(
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
  prepared: PreparedAvalaraTax | null,
  outcome: "commit" | "void",
): Promise<void> {
  if (!prepared) return;
  if (outcome === "commit") {
    if (prepared.status === "committed") return;
    await prepared.client.commitTransaction(prepared.quote.code);
    await persistAvalaraTaxStatus(admin, shipment, prepared, "committed");
    prepared.status = "committed";
    return;
  }
  await prepared.client.voidTransaction(prepared.quote.code);
  await persistAvalaraTaxStatus(admin, shipment, prepared, "voided");
}

export class ProductionCoreClubService implements CoreClubService {
  protected readonly admin: SupabaseClient;

  constructor(
    protected readonly env: WorkerEnv,
    protected readonly request: Request,
    protected readonly response: Response,
  ) {
    this.admin = createAdminClient(env);
  }

  protected authenticatedSurfaceClient(
    surface: "member" | "staff",
  ): SupabaseClient {
    return createSurfaceClient(
      this.env,
      this.request,
      this.response,
      surface,
    );
  }

  protected async requireStaff(roles?: StaffRole[]): Promise<StaffPrincipal> {
    const client = this.authenticatedSurfaceClient("staff");
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) throw authFailure();
    const { data: staffData, error: staffError } = await client
      .from("staff_users")
      .select("id,email,role,organization_id")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (staffError || !staffData) throw authFailure();
    const staff = staffData as StaffUserRow;
    const { data: organizationData, error: organizationError } = await client
      .from("organizations")
      .select(
        "id,name,plan_tier,stripe_customer_id,stripe_subscription_id,subscription_status,access_status,grace_period_ends_at,suspended_at",
      )
      .eq("id", staff.organization_id)
      .single();
    if (organizationError || !organizationData) throw authFailure();
    const organization = organizationData as OrganizationRow;
    const principal: StaffPrincipal = {
      access: {
        graceEndsAt: organization.grace_period_ends_at,
        state: organization.access_status,
        suspendedAt: organization.suspended_at,
      },
      organization: {
        accessState: organization.access_status,
        id: organization.id,
        name: organization.name,
        planTier: organization.plan_tier,
        stripeCustomerId: organization.stripe_customer_id,
        stripeSubscriptionId: organization.stripe_subscription_id,
        subscriptionStatus: organization.subscription_status,
      },
      user: {
        email: staff.email,
        fullName:
          typeof authData.user.user_metadata?.full_name === "string"
            ? authData.user.user_metadata.full_name
            : null,
        id: staff.id,
        role: staff.role,
      },
    };
    if (roles) assertStaffRole(principal, roles);
    if (!principal.organization) throw authFailure();
    assertStaffWorkspaceAccess(principal.access?.state);
    return principal;
  }

  protected async requireMember(): Promise<MemberPrincipal> {
    const bearer = this.request
      .get("authorization")
      ?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    const mobileSessionId = bearer ? mobileAccessSessionId(bearer) : null;
    if (bearer && mobileSessionId) {
      const { data: session, error: sessionError } = await this.admin
        .from("mobile_refresh_sessions")
        .select(
          "id,auth_user_id,organization_id,brand_id,member_id,device_id,expires_at,revoked_at",
        )
        .eq("id", mobileSessionId)
        .maybeSingle();
      if (
        sessionError ||
        !session ||
        session.revoked_at ||
        Date.parse(session.expires_at) <= Date.now()
      ) {
        throw authFailure();
      }
      const identity = await verifyMobileAccessTokenForOrganization(
        this.env,
        bearer,
        session.organization_id,
      );
      if (
        identity.authUserId !== session.auth_user_id ||
        identity.brandId !== session.brand_id ||
        identity.deviceId !== session.device_id ||
        identity.memberId !== session.member_id
      ) {
        throw authFailure();
      }
      const [{ data: member }, { data: organization }, { data: brand }] =
        await Promise.all([
        this.admin
          .from("members")
          .select("id,organization_id,brand_id,email,first_name,last_name,status")
          .eq("id", session.member_id)
          .eq("organization_id", session.organization_id)
          .eq("brand_id", session.brand_id)
          .eq("auth_user_id", session.auth_user_id)
          .maybeSingle(),
        this.admin
          .from("organizations")
          .select("id,name,access_status")
          .eq("id", session.organization_id)
          .maybeSingle(),
        this.admin
          .from("brands")
          .select("id,active,billing_mode,access_status")
          .eq("organization_id", session.organization_id)
          .eq("id", session.brand_id)
          .maybeSingle(),
      ]);
      if (
        !member ||
        !organization ||
        !brand ||
        !brandAllowsOperationalAccess({
          active: Boolean(brand.active),
          access_status: String(brand.access_status),
          billing_mode: String(brand.billing_mode),
          organization_access_status: String(organization.access_status),
        })
      ) {
        throw authFailure();
      }
      return {
        brand: { id: session.brand_id },
        organization,
        user: {
          authUserId: session.auth_user_id,
          email: member.email,
          firstName: member.first_name,
          id: member.id,
          lastName: member.last_name,
          status: member.status,
        },
      };
    }
    const client = this.authenticatedSurfaceClient("member");
    const { data: authData, error: authError } = await client.auth.getUser(
      bearer,
    );
    if (authError || !authData.user) throw authFailure();
    const signedContext = await verifyMemberBrandContext(
      this.env,
      readMemberBrandContextCookie(this.request),
    );
    let brandId: string | null = signedContext?.brandId ?? null;
    const requestHost = (this.request.get("host") ?? "")
      .split(":")[0]
      ?.trim()
      .toLowerCase();
    if (requestHost) {
      const { data: domainData } = await this.admin.rpc(
        "resolve_custom_domain",
        { p_hostname: requestHost },
      );
      const domain = Array.isArray(domainData) ? domainData[0] : domainData;
      const domainBrandId =
        domain && typeof domain === "object" && "brand_id" in domain
          ? String(domain.brand_id)
          : null;
      if (
        domainBrandId &&
        signedContext &&
        signedContext.brandId !== domainBrandId
      ) {
        throw authFailure();
      }
      brandId = domainBrandId ?? brandId;
    }
    let memberQuery = client
      .from("members")
      .select("id,organization_id,brand_id,email,first_name,last_name,status")
      .eq("auth_user_id", authData.user.id);
    if (signedContext) {
      memberQuery = memberQuery
        .eq("id", signedContext.memberId)
        .eq("organization_id", signedContext.organizationId);
    }
    if (brandId) memberQuery = memberQuery.eq("brand_id", brandId);
    const { data: memberRows, error: memberError } = await memberQuery.limit(2);
    if (memberError || memberRows?.length !== 1) throw authFailure();
    const memberData = memberRows[0]!;
    const member = memberData as MemberRow;
    if (!member.brand_id) throw authFailure();
    const [
      { data: organization, error: organizationError },
      { data: brand, error: brandError },
    ] = await Promise.all([
      client
        .from("organizations")
        .select("id,name,access_status")
        .eq("id", member.organization_id)
        .single(),
      client
        .from("brands")
        .select("id,active,billing_mode,access_status")
        .eq("organization_id", member.organization_id)
        .eq("id", member.brand_id)
        .single(),
    ]);
    if (
      organizationError ||
      brandError ||
      !organization ||
      !brand ||
      !brandAllowsOperationalAccess({
        active: Boolean(brand.active),
        access_status: String(brand.access_status),
        billing_mode: String(brand.billing_mode),
        organization_access_status: String(organization.access_status),
      })
    ) {
      throw authFailure();
    }
    return {
      brand: { id: member.brand_id },
      organization: organization as { id: string; name: string },
      user: {
        authUserId: authData.user.id,
        email: member.email,
        firstName: member.first_name,
        id: member.id,
        lastName: member.last_name,
        status: member.status,
      },
    };
  }

  protected async audit(
    principal: StaffPrincipal,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const organizationId = principal.organization?.id;
    if (!organizationId) throw authFailure();
    const brandId = await this.activeBrandId(principal);
    const { error } = await this.admin.rpc("append_audit_entry", {
      p_action: action,
      p_brand_id: brandId,
      p_entity_id: entityId,
      p_entity_type: entityType,
      p_metadata: metadata,
      p_organization_id: organizationId,
      p_user_id: principal.user.id,
    });
    if (error) throw databaseError("The audit entry could not be persisted.");
  }

  protected async recordDomainAnalyticsEvent(
    principal: StaffPrincipal | MemberPrincipal,
    input: {
      eventData?: Record<string, string | number | boolean | null>;
      eventType: string;
      memberId?: string | null;
      requestKey: string;
    },
  ): Promise<void> {
    const organizationId = principal.organization?.id;
    if (!organizationId) throw authFailure();
    const brandId =
      "brand" in principal
        ? principal.brand.id
        : await this.activeBrandId(principal);
    const actorUserId =
      "authUserId" in principal.user
        ? principal.user.authUserId
        : principal.user.id;
    if (!ANALYTICS_EVENT_TYPES.has(input.eventType)) {
      console.error(
        JSON.stringify({
          event: "analytics.domain_event_rejected",
          eventType: input.eventType,
          organizationId,
        }),
      );
      return;
    }
    await runFailureIsolatedAnalyticsWrite(
      async () => {
        const { error } = await this.admin.rpc("record_analytics_event", {
          p_event_data: input.eventData ?? {},
          p_event_type: input.eventType,
          p_brand_id: brandId,
          p_idempotency_key: await analyticsEventIdempotencyKey({
            actorUserId,
            eventType: input.eventType,
            organizationId,
            requestKey: input.requestKey,
          }),
          p_member_id: input.memberId ?? null,
          p_occurred_at: new Date().toISOString(),
          p_organization_id: organizationId,
        });
        if (error) throw error;
      },
      () => {
        // The stable event key makes a later retry safe.
        console.error(
          JSON.stringify({
            event: "analytics.domain_event_failed",
            eventType: input.eventType,
            organizationId,
            requestKey: input.requestKey,
          }),
        );
      },
    );
  }

  protected organizationId(principal: StaffPrincipal): string {
    if (!principal.organization) throw authFailure();
    return principal.organization.id;
  }

  protected async activeBrandId(
    principal: StaffPrincipal,
    _supplied?: string | null,
    allowSuspended = false,
  ): Promise<string> {
    const organizationId = this.organizationId(principal);
    const header = this.request.get("x-vinifera-brand-id")?.trim();
    if (header === "all") {
      throw new AppError(
        400,
        "invalid_request",
        "This operation requires one active brand.",
      );
    }
    let candidate = header || null;
    if (!candidate) {
      const { data, error } = await this.authenticatedSurfaceClient("staff")
        .from("organizations")
        .select("default_brand_id")
        .eq("id", organizationId)
        .single();
      if (error || !data?.default_brand_id) {
        throw databaseError("The default brand could not be resolved.");
      }
      candidate = String(data.default_brand_id);
    }
    assertUuid(candidate, "Brand");
    const { data: brand, error: brandError } =
      await this.authenticatedSurfaceClient("staff")
        .from("brands")
        .select("id,billing_mode,access_status")
        .eq("organization_id", organizationId)
        .eq("id", candidate)
        .eq("active", true)
        .maybeSingle();
    if (brandError || !brand) {
      throw new AppError(403, "forbidden", "Brand access is not available.");
    }
    if (
      brand.billing_mode === "independent" &&
      brand.access_status === "suspended" &&
      !allowSuspended
    ) {
      throw new AppError(403, "forbidden", "This brand account is suspended.");
    }
    return candidate;
  }

  protected async assertLegacySingleBrandScope(
    principal: StaffPrincipal | MemberPrincipal,
    feature: string,
  ): Promise<void> {
    const organizationId = principal.organization?.id;
    if (!organizationId) throw authFailure();
    const { count, error } = await this.admin
      .from("brands")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("active", true);
    if (error) {
      throw databaseError("Brand scope could not be verified.");
    }
    if ((count ?? 0) > 1) {
      throw new AppError(
        503,
        "activation_required",
        `${feature} is disabled until its brand-specific database routine is activated.`,
      );
    }
  }

  private async yearToDateBottleCount(
    organizationId: string,
    brandId: string,
    memberId: string,
    checkedAt: Date,
  ): Promise<number> {
    const yearStart = new Date(
      Date.UTC(checkedAt.getUTCFullYear(), 0, 1),
    ).toISOString();
    const { data, error } = await this.admin
      .from("shipments")
      .select("shipment_items(quantity)")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("member_id", memberId)
      .gte("created_at", yearStart)
      .in("status", [
        "charged",
        "label_created",
        "packed",
        "shipped",
        "delivered",
      ]);
    if (error) {
      throw databaseError(
        "The member's year-to-date shipment volume could not be loaded.",
      );
    }
    return (data ?? []).reduce((shipmentTotal, shipment) => {
      const items = Array.isArray(shipment.shipment_items)
        ? shipment.shipment_items
        : shipment.shipment_items
          ? [shipment.shipment_items]
          : [];
      return (
        shipmentTotal +
        items.reduce(
          (itemTotal, item) =>
            itemTotal +
            Math.max(
              0,
              Number(
                item && typeof item === "object"
                  ? (item as Record<string, unknown>).quantity
                  : 0,
              ),
            ),
          0,
        )
      );
    }, 0);
  }

  protected async checkShipmentCompliance(
    principal: StaffPrincipal,
    context: ShipmentComplianceContext,
  ): Promise<{
    check: Record<string, unknown>;
    requestFingerprint: string;
    result: ComplianceCheckResult;
  }> {
    const checkedAt = new Date();
    const yearToDateBottleCount = await this.yearToDateBottleCount(
      context.organizationId,
      context.brandId,
      context.shipment.member_id,
      checkedAt,
    );
    const request: ComplianceCheckRequest = {
      destination: context.destination,
      organizationId: context.organizationId,
      origin: context.origin,
      recipient: {
        dateOfBirth: context.memberBirthday,
        name: context.recipientName,
      },
      shipment: {
        bottleCount: context.bottleCount,
        chargeAmountCents: payableShipmentAmount(context.shipment),
        id: context.shipment.id,
        yearToDateBottleCount,
      },
    };
    const requestFingerprint = await complianceRequestFingerprint(
      request,
      checkedAt,
    );
    let result: ComplianceCheckResult;
    try {
      result = await createComplianceProvider(this.env).checkShipment(request);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "activation_required"
      ) {
        throw error;
      }
      result = {
        checkedAt: checkedAt.toISOString(),
        evidence: {
          ageVerified: null,
          originToRecipientAllowed: null,
          recipientStateAllowed: null,
          rulesVersion: null,
          volumeWithinLimit: null,
        },
        provider:
          this.env.COMPLIANCE_PROVIDER === "simulated"
            ? "simulated"
            : "shipcompliant",
        providerResponseId: null,
        reason: "The compliance provider could not return a verified decision.",
        status: "unknown",
        taxEstimateCents: null,
      };
    }
    result = withAuditableComplianceId(
      result,
      () => requestFingerprint.slice(0, 32),
    );
    const { data, error } = await this.admin.rpc(
      "record_shipment_compliance_check",
      {
        p_actor_user_id: principal.user.id,
        p_brand_id: context.brandId,
        p_checked_at: result.checkedAt,
        p_metadata: {
          age_verified: result.evidence.ageVerified,
          bottle_count: context.bottleCount,
          contract_version:
            result.provider === "shipcompliant"
              ? this.env.SHIPCOMPLIANT_CONTRACT_VERSION
              : "test-simulator-v1",
          destination_country: context.destination.country.toUpperCase(),
          destination_region: context.destination.state.toUpperCase(),
          origin_to_recipient_allowed:
            result.evidence.originToRecipientAllowed,
          provider: result.provider,
          provider_response_is_local:
            result.providerResponseId?.startsWith("local-") ?? false,
          recipient_state_allowed:
            result.evidence.recipientStateAllowed,
          request_fingerprint_sha256: requestFingerprint,
          rules_version: result.evidence.rulesVersion,
          volume_within_limit: result.evidence.volumeWithinLimit,
          year_to_date_bottle_count: yearToDateBottleCount,
        },
        p_organization_id: context.organizationId,
        p_provider: result.provider,
        p_provider_response_id: result.providerResponseId,
        p_reason: result.reason,
        p_shipment_id: context.shipment.id,
        p_status: result.status,
        p_tax_estimate_cents: result.taxEstimateCents,
      },
    );
    if (error) {
      throw databaseError("The compliance decision could not be persisted.");
    }
    const row =
      Array.isArray(data) && data.length
        ? data[0]
        : data && typeof data === "object"
          ? data
          : {
              checked_at: result.checkedAt,
              provider: result.provider,
              provider_response_id: result.providerResponseId,
              reason: result.reason,
              shipment_id: context.shipment.id,
              status: result.status,
              tax_estimate_cents: result.taxEstimateCents,
            };
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        provider: result.provider,
        status: result.status,
        taxEstimateCents: result.taxEstimateCents,
      },
      eventType: "shipment.compliance_checked",
      memberId: context.shipment.member_id,
      requestKey: `compliance:${context.shipment.id}:${result.providerResponseId}`,
    });
    return {
      check: toPublicRecord(row),
      requestFingerprint,
      result,
    };
  }

  protected complianceBlock(
    status: Exclude<ComplianceStatus, "compliant">,
    reason: string | null,
  ): AppError {
    return new AppError(
      409,
      "conflict",
      status === "non_compliant"
        ? reason || "ShipCompliant blocked this alcohol shipment."
        : reason ||
            "No verified compliance decision is available, so the alcohol label is blocked.",
    );
  }

  protected async checkStoredShipmentCompliance(
    principal: StaffPrincipal,
    shipmentId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(shipmentId, "Shipment");
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const [{ data: organization, error: organizationError }, shipmentResult] =
      await Promise.all([
        this.admin
          .from("organizations")
          .select("name,shipping_origin_address")
          .eq("id", organizationId)
          .single(),
        this.admin
          .from("shipments")
          .select(
            "id,organization_id,brand_id,member_id,release_id,status,shipping_address,charge_amount_cents,loyalty_discount_cents,retry_count,members!inner(id,organization_id,brand_id,email,first_name,last_name,phone,birthday),shipment_items(*)",
          )
          .eq("id", shipmentId)
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId)
          .maybeSingle(),
      ]);
    if (organizationError || !organization) {
      throw databaseError("The winery shipping settings could not be loaded.");
    }
    if (shipmentResult.error) {
      throw databaseError("The shipment could not be loaded.");
    }
    if (!shipmentResult.data) {
      throw new AppError(404, "not_found", "Shipment not found.");
    }
    const shipment = shipmentResult.data as ShipmentLabelRow;
    if (shipment.status !== "charged") {
      throw new AppError(
        409,
        "conflict",
        "Operational compliance checks run only after charge and before label generation.",
      );
    }
    const destination = getAddress(shipment.shipping_address);
    if (!destination) {
      throw new AppError(
        409,
        "conflict",
        "A complete member shipping address is required.",
      );
    }
    const validation =
      await createShippingProvider(this.env).validateAddress(destination);
    if (!validation.valid) {
      throw new AppError(
        409,
        "conflict",
        validation.messages.join(" ") || "The shipping address is invalid.",
      );
    }
    const { data: preparedShipment, error: preparationError } =
      await this.admin.rpc("set_validated_shipment_address", {
        p_actor_user_id: principal.user.id,
        p_organization_id: organizationId,
        p_shipment_id: shipment.id,
        p_validated_address: {
          city: validation.address.city,
          country_code: validation.address.country,
          line1: validation.address.line1,
          line2: validation.address.line2,
          postal_code: validation.address.postalCode,
          region: validation.address.state,
        },
        p_validation_messages: validation.messages,
        p_validation_status: "valid",
      });
    if (preparationError) {
      throw databaseError(
        "The validated shipping address could not be persisted.",
      );
    }
    if (!preparedShipment) {
      throw new AppError(
        409,
        "conflict",
        "The shipment changed before its validated address could be prepared.",
      );
    }
    const origin = parseOriginAddress(organization.shipping_origin_address);
    const member = oneRelation(shipment.members);
    const recipientName =
      typeof shipment.shipping_address?.name === "string"
        ? shipment.shipping_address.name.trim()
        : `${member?.first_name ?? ""} ${member?.last_name ?? ""}`.trim();
    if (!recipientName) {
      throw new AppError(
        409,
        "conflict",
        "A recipient name is required for compliance verification.",
      );
    }
    const bottleCount = Math.max(
      1,
      (shipment.shipment_items ?? []).reduce(
        (total, item) => total + Math.max(0, Number(item.quantity ?? 0)),
        0,
      ),
    );
    const decision = await this.checkShipmentCompliance(principal, {
      brandId,
      bottleCount,
      destination: validation.address,
      memberBirthday: member?.birthday,
      organizationId,
      origin,
      recipientName,
      shipment,
    });
    return {
      ...decision.check,
      blocksLabel: decision.result.status !== "compliant",
      provider: decision.result.provider,
      providerResponseId: decision.result.providerResponseId,
      reason: decision.result.reason,
      requestFingerprint: decision.requestFingerprint,
      status: decision.result.status,
      taxEstimateCents: decision.result.taxEstimateCents,
    };
  }

  async listClubTiers(): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("club_tiers")
      .select("*,members(count)")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .order("created_at");
    if (error) throw databaseError("Club tiers could not be loaded.");
    return (data ?? []).map(toPublicTier);
  }

  async createClubTier(
    input: ClubTierInput,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .rpc("apply_club_tier_command", {
        p_actor_user_id: principal.user.id,
        p_brand_id: brandId,
        p_command_id: commandId,
        p_operation: "create",
        p_organization_id: organizationId,
        p_payload: tierToDatabase(input),
        p_tier_id: null,
      });
    if (error) {
      throw commandError(error, "The club tier could not be created.");
    }
    const result = commandResult(data);
    const tierId = String(result.entityId ?? "");
    assertUuid(tierId, "Club tier");
    const { data: tier, error: tierError } = await this.admin
      .from("club_tiers")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("id", tierId)
      .single();
    if (tierError || !tier) throw databaseError("The club tier could not be loaded.");
    return { ...toPublicTier(tier), command: result };
  }

  async updateClubTier(
    tierId: string,
    input: Partial<ClubTierInput>,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(tierId, "Club tier");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .rpc("apply_club_tier_command", {
        p_actor_user_id: principal.user.id,
        p_brand_id: brandId,
        p_command_id: commandId,
        p_operation: "update",
        p_organization_id: organizationId,
        p_payload: tierToDatabase(input),
        p_tier_id: tierId,
      });
    if (error) throw commandError(error, "The club tier could not be updated.");
    const result = commandResult(data);
    const { data: tier, error: tierError } = await this.admin
      .from("club_tiers")
      .select("*")
      .eq("id", tierId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .single();
    if (tierError || !tier) throw databaseError("The club tier could not be loaded.");
    return { ...toPublicTier(tier), command: result };
  }

  async deleteClubTier(tierId: string, commandId: string): Promise<void> {
    assertUuid(tierId, "Club tier");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { error } = await this.admin.rpc("apply_club_tier_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_operation: "delete",
      p_organization_id: organizationId,
      p_payload: {},
      p_tier_id: tierId,
    });
    if (error) throw commandError(error, "The club tier could not be deleted.");
  }

  async listMembers(input: {
    limit: number;
    offset: number;
    search?: string;
    status?: MemberStatus;
    tierId?: string;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    let query = this.admin
      .from("members")
      .select("*,club_tiers(id,name)", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId);
    if (input.status) query = query.eq("status", input.status);
    if (input.tierId) query = query.eq("club_tier_id", input.tierId);
    if (input.search) {
      const escaped = input.search.replaceAll("%", "\\%").replaceAll(",", "");
      query = query.or(
        `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,email.ilike.%${escaped}%`,
      );
    }
    const { count, data, error } = await query
      .order("last_name")
      .order("first_name")
      .range(input.offset, input.offset + input.limit - 1);
    if (error) throw databaseError("Members could not be loaded.");
    return { items: (data ?? []).map(toPublicMember), total: count ?? 0 };
  }

  async getMember(memberId: string): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const [
      memberResult,
      shipmentResult,
      paymentResult,
      auditResult,
      communicationResult,
      sideEffectResult,
    ] = await Promise.all([
      this.admin
        .from("members")
        .select("*,club_tiers(id,name)")
        .eq("id", memberId)
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .maybeSingle(),
      this.admin
        .from("shipments")
        .select(
          "id,status,charge_amount_cents,loyalty_discount_cents,tax_amount_cents,tracking_number,carrier,created_at,updated_at,paid_at,refunded_at,releases(name,processing_date),shipment_items(id,wine_name,quantity)",
          { count: "exact" },
        )
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(MEMBER_ORDER_HISTORY_LIMIT),
      this.admin
        .from("billing_attempts")
        .select(
          "id,shipment_id,attempt_kind,status,amount_cents,decline_reason,completed_at,created_at,shipments!inner(member_id)",
        )
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("shipments.member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(MEMBER_ACTIVITY_HISTORY_LIMIT + 1),
      this.admin
        .from("audit_log")
        .select("id,action,metadata,created_at")
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("entity_type", "member")
        .eq("entity_id", memberId)
        .not("action", "like", "member.communication.%")
        .order("created_at", { ascending: false })
        .limit(MEMBER_ACTIVITY_HISTORY_LIMIT + 1),
      this.admin
        .from("audit_log")
        .select("id,action,metadata,created_at", { count: "exact" })
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("entity_type", "member")
        .eq("entity_id", memberId)
        .like("action", "member.communication.%")
        .order("created_at", { ascending: false })
        .limit(MEMBER_COMMUNICATION_HISTORY_LIMIT + 1),
      this.admin.rpc("get_member_side_effect_status", {
        p_brand_id: brandId,
        p_member_id: memberId,
        p_organization_id: organizationId,
      }),
    ]);
    if (memberResult.error) throw databaseError("The member could not be loaded.");
    if (!memberResult.data) {
      throw new AppError(404, "not_found", "Member not found.");
    }
    if (
      shipmentResult.error ||
      paymentResult.error ||
      auditResult.error ||
      communicationResult.error ||
      sideEffectResult.error
    ) {
      throw databaseError("The member history could not be loaded.");
    }
    const shipmentRows = (shipmentResult.data ?? []) as Array<
      Record<string, unknown>
    >;
    const paymentRows = (paymentResult.data ?? []) as Array<
      Record<string, unknown>
    >;
    const auditRows = (auditResult.data ?? []) as Array<Record<string, unknown>>;
    const communicationRows = (communicationResult.data ?? []) as Array<
      Record<string, unknown>
    >;
    const activity = newestMemberActivity([
      ...shipmentRows.map(memberOrderActivity),
      ...paymentRows
        .slice(0, MEMBER_ACTIVITY_HISTORY_LIMIT)
        .map(memberPaymentActivity),
      ...auditRows
        .filter(
          (row) =>
            !String(row.action ?? "").startsWith("member.communication."),
        )
        .slice(0, MEMBER_ACTIVITY_HISTORY_LIMIT)
        .map(memberAuditActivity),
    ]);
    const communicationCount =
      communicationResult.count ?? communicationRows.length;
    const orderCount = shipmentResult.count ?? shipmentRows.length;
    return {
      ...toPublicMember(memberResult.data),
      activity: activity.slice(0, MEMBER_ACTIVITY_HISTORY_LIMIT),
      churnRisk: "not_scored",
      communicationCount,
      communications: communicationRows
        .slice(0, MEMBER_COMMUNICATION_HISTORY_LIMIT)
        .map(memberCommunicationActivity),
      externalSync:
        sideEffectResult.data && typeof sideEffectResult.data === "object"
          ? sideEffectResult.data
          : {
              deadLetterCount: 0,
              pendingCount: 0,
              state: "not_required",
              updatedAt: null,
            },
      historyMeta: {
        activityLimit: MEMBER_ACTIVITY_HISTORY_LIMIT,
        activityTruncated:
          paymentRows.length > MEMBER_ACTIVITY_HISTORY_LIMIT ||
          auditRows.length > MEMBER_ACTIVITY_HISTORY_LIMIT ||
          orderCount > MEMBER_ORDER_HISTORY_LIMIT ||
          activity.length > MEMBER_ACTIVITY_HISTORY_LIMIT,
        communicationLimit: MEMBER_COMMUNICATION_HISTORY_LIMIT,
        communicationsTruncated:
          communicationCount > MEMBER_COMMUNICATION_HISTORY_LIMIT,
        orderLimit: MEMBER_ORDER_HISTORY_LIMIT,
        ordersTruncated: orderCount > MEMBER_ORDER_HISTORY_LIMIT,
      },
      orderCount,
      orders: shipmentRows.map(memberOrderFromShipment),
    };
  }

  async createMember(
    input: MemberInput,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .rpc("apply_member_command", {
        p_actor_user_id: principal.user.id,
        p_brand_id: brandId,
        p_command_id: commandId,
        p_member_id: null,
        p_member_ids: null,
        p_operation: "create",
        p_organization_id: organizationId,
        p_payload: memberToDatabase(input),
        p_scope_all: false,
      });
    if (error) {
      throw commandError(error, "The member could not be created.");
    }
    const result = commandResult(data);
    const memberId = String(result.entityId ?? "");
    assertUuid(memberId, "Member");
    const { data: member, error: memberError } = await this.admin
      .from("members")
      .select("*")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .single();
    if (memberError || !member) {
      throw databaseError("The created member could not be loaded.");
    }
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        hasClubTier: Boolean(input.clubTierId),
        stripeCustomerCreated: false,
      },
      eventType: "member.created",
      memberId,
      requestKey: `member:${memberId}:created:${commandId}`,
    });
    return { ...toPublicMember(member), command: result };
  }

  async updateMember(
    memberId: string,
    input: Partial<MemberInput>,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .rpc("apply_member_command", {
        p_actor_user_id: principal.user.id,
        p_brand_id: brandId,
        p_command_id: commandId,
        p_member_id: memberId,
        p_member_ids: null,
        p_operation: "update",
        p_organization_id: organizationId,
        p_payload: memberToDatabase(input),
        p_scope_all: false,
      });
    if (error) throw commandError(error, "The member could not be updated.");
    const result = commandResult(data);
    const { data: member, error: memberError } = await this.admin
      .from("members")
      .select("*")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .single();
    if (memberError || !member) {
      throw databaseError("The updated member could not be loaded.");
    }
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: { changedFieldCount: Object.keys(input).length },
      eventType: "member.updated",
      memberId,
      requestKey: `member:${memberId}:updated:${commandId}`,
    });
    return { ...toPublicMember(member), command: result };
  }

  async deleteMember(memberId: string, commandId: string): Promise<void> {
    assertUuid(memberId, "Member");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { error } = await this.admin.rpc("apply_member_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_member_id: memberId,
      p_member_ids: null,
      p_operation: "delete",
      p_organization_id: organizationId,
      p_payload: {},
      p_scope_all: false,
    });
    if (error) throw commandError(error, "The member could not be deleted.");
  }

  async transitionMember(
    memberId: string,
    status: MemberStatus,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .rpc("apply_member_command", {
        p_actor_user_id: principal.user.id,
        p_brand_id: brandId,
        p_command_id: commandId,
        p_member_id: memberId,
        p_member_ids: null,
        p_operation: "transition",
        p_organization_id: organizationId,
        p_payload: { target_status: status },
        p_scope_all: false,
      });
    if (error) throw commandError(error, "The member status could not be updated.");
    const result = commandResult(data);
    const { data: member, error: memberError } = await this.admin
      .from("members")
      .select("*")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .single();
    if (memberError || !member) {
      throw databaseError("The transitioned member could not be loaded.");
    }
    if (status === "cancelled") {
      await this.recordDomainAnalyticsEvent(principal, {
        eventData: { source: "single" },
        eventType: "member.cancelled",
        memberId,
        requestKey: `member:${memberId}:cancelled:${commandId}`,
      });
    }
    return { ...toPublicMember(member), command: result };
  }

  async batchMembers(
    input: {
      ids?: string[];
      operation: "pause" | "resume" | "cancel" | "assign_tier";
      tierId?: string;
    },
    commandId: string,
  ): Promise<{ updated: number }> {
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    if (input.ids?.length && input.ids.length > 1_000) {
      throw new AppError(400, "invalid_request", "Batch operations are limited to 1,000 members.");
    }
    const { data, error } = await this.admin.rpc("apply_member_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_member_id: null,
      p_member_ids: input.ids ?? null,
      p_operation: `batch_${input.operation}`,
      p_organization_id: organizationId,
      p_payload:
        input.operation === "assign_tier"
          ? { club_tier_id: input.tierId ?? null }
          : {},
      p_scope_all: !input.ids?.length,
    });
    if (error) throw commandError(error, "The member batch operation failed.");
    const result = commandResult(data);
    const affected = Array.isArray(result.affected)
      ? result.affected as Array<Record<string, unknown>>
      : [];
    if (input.operation === "cancel") {
      await mapConcurrent(affected, 10, async (member) => {
        await this.recordDomainAnalyticsEvent(principal, {
          eventData: { source: "batch" },
          eventType: "member.cancelled",
          memberId: String(member.id),
          requestKey: `member:${String(member.id)}:cancelled:${commandId}`,
        });
      });
    }
    return { updated: Number(result.updated ?? 0) };
  }

  async exportMembers(input: {
    search?: string;
    status?: MemberStatus;
    tierId?: string;
  }): Promise<{ contents: string; filename: string }> {
    const result = await this.listMembers({
      ...input,
      limit: 1_000,
      offset: 0,
    });
    const headers = [
      "First Name",
      "Last Name",
      "Email",
      "Phone",
      "Status",
      "Club Tier",
      "Join Date",
      "Address",
      "City",
      "State",
      "Postal Code",
      "Country",
    ];
    const lines = [headers.map(encodeCsvCell).join(",")];
    for (const member of result.items) {
      const address = (member.address ?? {}) as Record<string, unknown>;
      const tier = member.tier as Record<string, unknown> | undefined;
      lines.push(
        [
          member.firstName,
          member.lastName,
          member.email,
          member.phone,
          member.status,
          tier?.name,
          member.joinedAt,
          address.line1,
          address.city,
          address.state,
          address.postalCode,
          address.country,
        ]
          .map(encodeCsvCell)
          .join(","),
      );
    }
    return {
      contents: `${lines.join("\r\n")}\r\n`,
      filename: `vinifera-members-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  }

  async listReleases(input: {
    from?: string;
    status?: ReleaseStatus;
    to?: string;
  }): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    let query = this.admin
      .from("releases")
      .select(
        "*,release_tiers(*),release_wines(*,release_tier_items(quantity,unit_price_cents,release_tier_id)),shipments(status,charge_amount_cents)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId);
    if (input.status) query = query.eq("status", input.status);
    if (input.from) query = query.gte("processing_date", input.from);
    if (input.to) query = query.lte("processing_date", input.to);
    const { data, error } = await query
      .order("processing_date", { ascending: false })
      .limit(RELEASE_LIST_LIMIT)
      .limit(RELEASE_SHIPMENT_DETAIL_LIMIT, {
        referencedTable: "shipments",
      });
    if (error) throw databaseError("Releases could not be loaded.");
    return (data ?? []).map(toPublicRelease);
  }

  async getRelease(releaseId: string): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("releases")
      .select(
        "*,release_tiers(*),release_wines(*,release_tier_items(quantity,unit_price_cents,release_tier_id)),shipments(*,members(id,first_name,last_name,email),shipment_items(*))",
      )
      .eq("id", releaseId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .limit(RELEASE_SHIPMENT_DETAIL_LIMIT, {
        referencedTable: "shipments",
      })
      .maybeSingle();
    if (error) throw databaseError("The release could not be loaded.");
    if (!data) throw new AppError(404, "not_found", "Release not found.");
    return toPublicRelease(data);
  }

  async createRelease(
    input: ReleaseInput,
    commandId: string,
    initialStatus: "draft" | "scheduled" = "draft",
  ): Promise<Record<string, unknown>> {
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin.rpc("apply_release_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_operation: "create",
      p_organization_id: organizationId,
      p_payload: {
        description: input.description ?? "",
        embargo_date: input.embargoDate,
        initial_status: initialStatus,
        name: input.name,
        processing_date: input.processingDate,
        tiers: input.tierPrices.map((tier) => ({
          price_cents: tier.priceCents,
          tier_id: tier.tierId,
        })),
        wines: input.wines.map((wine) => ({
          price_cents: wine.priceCents,
          quantity: wine.quantity,
          wine_name: wine.wineName,
        })),
      },
      p_release_id: null,
    });
    if (error) {
      throw commandError(error, "The release could not be created.");
    }
    const result = commandResult(data);
    const releaseId = String(result.entityId ?? "");
    assertUuid(releaseId, "Release");
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        initialStatus,
        tier_count: input.tierIds.length,
        wine_count: input.wines.length,
      },
      eventType: "release.created",
      requestKey: `release:${releaseId}:created:${commandId}`,
    });
    if (initialStatus === "scheduled") {
      console.info(
        JSON.stringify({
          event: "release.notification.stub",
          organizationId,
          processingDate: input.processingDate,
          releaseId,
        }),
      );
    }
    return { ...(await this.getRelease(releaseId)), command: result };
  }

  async updateRelease(
    releaseId: string,
    input: ReleasePatchInput,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const current = await this.getRelease(releaseId);
    const currentWines =
      (current.wines as Array<Record<string, unknown>> | undefined) ?? [];
    const currentWinePrices = new Map(
      currentWines
        .filter((wine) => typeof wine.id === "string")
        .map((wine) => [String(wine.id), Number(wine.priceCents)]),
    );
    const completeWines = input.wines
      ? input.wines.map((wine) => {
          const existingWineId =
            wine.id !== undefined && currentWinePrices.has(wine.id)
              ? wine.id
              : undefined;
          if (wine.priceCents !== undefined) {
            return {
              ...(existingWineId ? { id: existingWineId } : {}),
              priceCents: wine.priceCents,
              quantity: wine.quantity,
              wineName: wine.wineName,
            };
          }
          const storedPrice =
            existingWineId === undefined
              ? undefined
              : currentWinePrices.get(existingWineId);
          if (storedPrice === undefined) {
            throw new AppError(
              400,
              "invalid_request",
              "Each new or unknown wine needs an explicit price.",
            );
          }
          return {
            id: existingWineId,
            priceCents: storedPrice,
            quantity: wine.quantity,
            wineName: wine.wineName,
          };
        })
      : currentWines.map((row) => ({
          ...(typeof row.id === "string" ? { id: row.id } : {}),
          priceCents: Number(row.priceCents),
          quantity: Number(row.quantity),
          wineName: String(row.name),
        }));
    const completeInput = {
      description:
        Object.prototype.hasOwnProperty.call(input, "description")
          ? input.description ?? null
          : typeof current.description === "string"
            ? current.description
            : null,
      embargoDate:
        input.embargoDate ??
        (typeof current.embargoDate === "string" ? current.embargoDate : ""),
      name:
        input.name ?? (typeof current.name === "string" ? current.name : ""),
      processingDate:
        input.processingDate ??
        (typeof current.processingDate === "string" ? current.processingDate : ""),
      tierIds:
        input.tierIds ??
        (((current.tiers as Array<Record<string, unknown>> | undefined) ?? [])
          .map((row) => row.id)
          .filter((value): value is string => typeof value === "string")),
      tierPrices:
        input.tierPrices ??
        (((current.tiers as Array<Record<string, unknown>> | undefined) ?? []).map(
          (row) => ({
            priceCents: Number(row.priceCents),
            tierId: String(row.id),
          }),
        )),
      wines: completeWines,
    };
    const { data, error } = await this.admin.rpc("apply_release_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_operation: "update",
      p_organization_id: organizationId,
      p_payload: {
        description: completeInput.description ?? "",
        embargo_date: completeInput.embargoDate,
        name: completeInput.name,
        processing_date: completeInput.processingDate,
        tiers: completeInput.tierPrices.map((tier) => ({
          price_cents: tier.priceCents,
          tier_id: tier.tierId,
        })),
        wines: completeInput.wines.map((wine) => ({
          ...("id" in wine && wine.id ? { wine_id: wine.id } : {}),
          price_cents: wine.priceCents,
          quantity: wine.quantity,
          wine_name: wine.wineName,
        })),
      },
      p_release_id: releaseId,
    });
    if (error) throw commandError(error, "The release could not be updated.");
    const result = commandResult(data);
    return { ...(await this.getRelease(releaseId)), command: result };
  }

  async scheduleRelease(
    releaseId: string,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin.rpc("apply_release_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_operation: "schedule",
      p_organization_id: organizationId,
      p_payload: {},
      p_release_id: releaseId,
    });
    if (error) throw commandError(error, "The release could not be scheduled.");
    const result = commandResult(data);
    const release = await this.getRelease(releaseId);
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: { processingDate: String(release.processingDate) },
      eventType: "release.scheduled",
      requestKey: `release:${releaseId}:scheduled:${commandId}`,
    });
    console.info(
      JSON.stringify({
        event: "release.notification.stub",
        organizationId,
        processingDate: release.processingDate,
        releaseId,
      }),
    );
    return { ...release, command: result };
  }

  async processRelease(releaseId: string): Promise<{
    charged: number;
    declined: number;
    releaseId: string;
    skipped: number;
  }> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    await assertBrandOperationalAccess(this.admin, organizationId, brandId);
    assertStripeBillingAuthority(this.env);
    const stripe = createStripe(this.env);
    const { error: createError } = await this.admin.rpc("create_release_shipments", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_organization_id: organizationId,
      p_release_id: releaseId,
    });
    if (createError) {
      console.error(
        JSON.stringify({
          code: createError.code ?? "upstream_error",
          event: "release.shipment_preparation_failed",
          organizationId,
          releaseId,
          resumable: false,
        }),
      );
      throw commandError(
        createError,
        "Release shipments could not be prepared transactionally.",
      );
    }
    const { data: shipments, error } = await this.admin
      .from("shipments")
      .select(
        "id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("release_id", releaseId)
      .eq("status", "pending");
    if (error) throw databaseError("Release shipments could not be loaded.");

    const results = await mapConcurrent(
      (shipments ?? []) as ShipmentPaymentRow[],
      5,
      async (shipment) => {
        try {
          return await this.chargeShipment(
            stripe,
            shipment,
            principal,
            "release_processing",
          );
        } catch (error) {
          console.error(
            JSON.stringify({
              code: error instanceof AppError ? error.code : "upstream_error",
              event: "release.shipment_charge_failed",
              organizationId,
              releaseId,
              shipmentId: shipment.id,
            }),
          );
          return "skipped" as const;
        }
      },
    );
    const summary = {
      charged: results.filter((result) => result === "charged").length,
      declined: results.filter((result) => result === "declined").length,
      releaseId,
      skipped: results.filter((result) => result === "skipped").length,
    };
    await this.audit(principal, "release.processed", "release", releaseId, summary);
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        charged: summary.charged,
        declined: summary.declined,
        skipped: summary.skipped,
      },
      eventType: "release.processed",
      requestKey: `release:${releaseId}:processed`,
    });
    return summary;
  }

  async listRecoveryQueue(): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "*,members(id,first_name,last_name,email),releases(id,name),billing_attempts(*)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("status", "declined")
      .order("next_retry_at");
    if (error) throw databaseError("The recovery queue could not be loaded.");
    return (data ?? []).map(toPublicShipment);
  }

  async listShipments(input: {
    limit: number;
    offset: number;
    releaseId?: string;
    search?: string;
    status?: ShipmentStatus;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    let query = this.admin
      .from("shipments")
      .select(
        "id,member_id,release_id,status,shipping_address,tracking_number,carrier,charge_amount_cents,loyalty_discount_cents,tax_amount_cents,decline_reason,retry_count,next_retry_at,created_at,updated_at,members(first_name,last_name,email),releases(name),release_tiers(tier_name),shipment_items(id,wine_name,quantity,price_cents)",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId);
    if (input.releaseId) query = query.eq("release_id", input.releaseId);
    if (input.status) query = query.eq("status", input.status);
    if (input.search) {
      const search = input.search.replaceAll("%", "\\%").replaceAll(",", "");
      const [{ data: members }, { data: releases }] = await Promise.all([
        this.admin
          .from("members")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId)
          .or(
            `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`,
          )
          .limit(100),
        this.admin
          .from("releases")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId)
          .ilike("name", `%${search}%`)
          .limit(100),
      ]);
      const filters = [`tracking_number.ilike.%${search}%`];
      if (members?.length) {
        filters.push(`member_id.in.(${members.map((member) => member.id).join(",")})`);
      }
      if (releases?.length) {
        filters.push(
          `release_id.in.(${releases.map((release) => release.id).join(",")})`,
        );
      }
      query = query.or(filters.join(","));
    }
    const { count, data, error } = await query
      .order("created_at", { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);
    if (error) throw databaseError("Shipments could not be loaded.");
    return {
      items: (data ?? []).map(toPublicShipment),
      total: count ?? 0,
    };
  }

  async retryShipment(shipmentId: string): Promise<Record<string, unknown>> {
    assertUuid(shipmentId, "Shipment");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    assertStripeBillingAuthority(this.env);
    const shipment = await this.getPaymentShipment(
      shipmentId,
      organizationId,
      brandId,
      "declined",
    );
    const status = await this.chargeShipment(
      createStripe(this.env),
      shipment,
      principal,
      "manual_retry",
    );
    return { shipmentId, status };
  }

  async refundShipment(
    shipmentId: string,
    input: { amountCents?: number; reason?: string },
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(shipmentId, "Shipment");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    assertStripeBillingAuthority(this.env);
    const { data: shipment, error } = await this.admin
      .from("shipments")
      .select(
        "id,status,charge_amount_cents,loyalty_discount_cents,tax_amount_cents,refund_amount_cents,stripe_payment_intent_id,stripe_charge_id",
      )
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw databaseError("The shipment could not be loaded.");
    if (!shipment) throw new AppError(404, "not_found", "Shipment not found.");
    const idempotencyKey = `shipment:${shipmentId}:refund:${commandId}`;
    const { data: existingAttempt, error: existingAttemptError } =
      await this.admin
        .from("billing_attempts")
        .select("id,status,amount_cents,metadata,stripe_refund_id")
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("shipment_id", shipmentId)
        .eq("attempt_kind", "refund")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
    if (existingAttemptError) {
      throw databaseError("The existing refund attempt could not be loaded.");
    }
    if (existingAttempt) {
      const requestedReason = input.reason ?? "";
      const recordedReason =
        typeof existingAttempt.metadata === "object" &&
        existingAttempt.metadata !== null &&
        "reason" in existingAttempt.metadata &&
        typeof existingAttempt.metadata.reason === "string"
          ? existingAttempt.metadata.reason
          : "";
      if (
        (input.amountCents !== undefined &&
          input.amountCents !== Number(existingAttempt.amount_cents)) ||
        requestedReason !== recordedReason
      ) {
        throw new AppError(
          409,
          "conflict",
          "This refund command was already used with different details.",
        );
      }
      if (existingAttempt.status === "refunded") {
        return {
          amountCents: Number(existingAttempt.amount_cents),
          id: shipmentId,
          status: shipment.status,
        };
      }
      if (
        !["queued", "processing"].includes(existingAttempt.status as string)
      ) {
        throw new AppError(
          409,
          "conflict",
          "This refund command already reached a terminal result.",
        );
      }
    }
    if (
      !["charged", "label_created", "packed", "shipped", "delivered"].includes(
        shipment.status,
      )
    ) {
      throw new AppError(409, "conflict", "This shipment has no refundable payment.");
    }
    if (!shipment.stripe_payment_intent_id) {
      throw new AppError(409, "conflict", "The Stripe payment reference is missing.");
    }
    const capturedAmount = Math.max(
      0,
      Number(shipment.charge_amount_cents) -
        Number(shipment.loyalty_discount_cents ?? 0) +
        Number(shipment.tax_amount_cents ?? 0),
    );
    const alreadyRefunded = Number(shipment.refund_amount_cents ?? 0);
    const remainingRefundable = Math.max(0, capturedAmount - alreadyRefunded);
    const refundAmount = input.amountCents ?? remainingRefundable;
    if (
      !Number.isInteger(refundAmount) ||
      refundAmount <= 0 ||
      refundAmount > remainingRefundable
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Refund amount must be a positive number of cents no greater than the remaining captured amount.",
      );
    }
    const { data: attemptData, error: attemptError } = await this.admin.rpc(
      "record_billing_attempt",
      {
        p_actor_user_id: principal.user.id,
        p_amount_cents: refundAmount,
        p_attempt_kind: "refund",
        p_brand_id: brandId,
        p_idempotency_key: idempotencyKey,
        p_metadata: { reason: input.reason ?? "" },
        p_organization_id: organizationId,
        p_shipment_id: shipmentId,
        p_stripe_payment_intent_id: shipment.stripe_payment_intent_id,
      },
    );
    if (attemptError) throw databaseError("The refund attempt could not be recorded.");
    const billingAttemptId = Array.isArray(attemptData)
      ? attemptData[0]
      : attemptData;
    if (typeof billingAttemptId !== "string") {
      throw databaseError("The refund attempt is unavailable.");
    }
    let refund: Stripe.Refund;
    try {
      refund = await createStripe(this.env).refunds.create(
        {
          amount: refundAmount,
          metadata: {
            billing_attempt_id: billingAttemptId,
            brand_id: brandId,
            organization_id: organizationId,
            reason: input.reason ?? "",
            shipment_id: shipmentId,
          },
          payment_intent: shipment.stripe_payment_intent_id,
          reason: "requested_by_customer",
        },
        {
          idempotencyKey,
        },
      );
    } catch (error) {
      if (!isRetryableStripeRecoveryError(error)) {
        const { error: failureError } = await this.admin.rpc(
          "apply_shipment_payment_event",
          {
            p_billing_attempt_id: billingAttemptId,
            p_brand_id: brandId,
            p_decline_code: safeStripeRecoveryErrorCode(error),
            p_decline_reason: "Stripe rejected the refund request.",
            p_event_created_at: new Date().toISOString(),
            p_metadata: { reason: input.reason ?? "", source: "staff_refund" },
            p_organization_id: organizationId,
            p_shipment_id: shipmentId,
            p_status: "failed",
            p_stripe_charge_id: shipment.stripe_charge_id,
            p_stripe_event_id: null,
            p_stripe_refund_id: null,
          },
        );
        if (failureError) {
          throw databaseError(
            "Stripe rejected the refund and its failed ledger state could not be recorded.",
          );
        }
      }
      throw new AppError(
        502,
        "upstream_error",
        isRetryableStripeRecoveryError(error)
          ? "Stripe did not confirm the refund. Vinifera will safely reconcile the same request."
          : "Stripe rejected the refund request.",
      );
    }
    const { error: applyError } = await this.admin.rpc(
      "apply_shipment_payment_event",
      {
        p_billing_attempt_id: billingAttemptId,
        p_brand_id: brandId,
        p_decline_code: null,
        p_decline_reason: null,
        p_event_created_at: new Date().toISOString(),
        p_metadata: { reason: input.reason ?? "", source: "staff_refund" },
        p_organization_id: organizationId,
        p_shipment_id: shipmentId,
        p_status: "refunded",
        p_stripe_charge_id: shipment.stripe_charge_id,
        p_stripe_event_id: null,
        p_stripe_refund_id: refund.id,
      },
    );
    if (applyError) {
      throw databaseError("The refund succeeded but its local ledger did not update.");
    }
    return {
      amountCents: refund.amount,
      id: shipmentId,
      status:
        alreadyRefunded + refundAmount >= capturedAmount
          ? "refunded"
          : shipment.status,
    };
  }

  async createMemberPaymentMethodPortal(input: {
    attemptId: string;
  }): Promise<{ url: string }> {
    const principal = await this.requireMember();
    assertStripeBillingAuthority(this.env);
    const { data: member, error } = await this.admin
      .from("members")
      .select("id,organization_id,stripe_customer_id")
      .eq("id", principal.user.id)
      .eq("organization_id", principal.organization.id)
      .eq("brand_id", principal.brand.id)
      .single();
    if (error || !member) throw authFailure();
    const stripe = createStripe(this.env);
    let customerId = member.stripe_customer_id as string | null;
    if (!customerId) {
      customerId = await provisionStripeCustomer({
        brandId: principal.brand.id,
        createCustomer: (params, idempotencyKey) =>
          stripe.customers.create(params, { idempotencyKey }),
        memberId: member.id,
        organizationId: member.organization_id,
        scope: "member",
        store: supabaseStripeCustomerProvisioningStore(this.admin),
        subjectId: member.id,
      });
    }
    return executeStripeBillingAttempt({
      attemptId: input.attemptId,
      brandId: principal.brand.id,
      createSession: async ({ idempotencyKey }) => {
        const session = await stripe.billingPortal.sessions.create(
          {
            customer: customerId,
            flow_data: { type: "payment_method_update" },
            return_url: `${this.coreApplicationOrigin()}/portal/payment-method`,
          },
          { idempotencyKey },
        );
        return { id: session.id, url: session.url };
      },
      customerId,
      memberId: member.id,
      operation: "member_portal",
      organizationId: member.organization_id,
      planTier: null,
      providerPayloadKey: "member_portal:v1",
      reconcileOpenCheckout: async () => ({ status: "expired" as const }),
      store: supabaseStripeBillingAttemptStore(this.admin),
      subjectId: member.id,
    });
  }

  async validateShippingAddress(
    address: PostalAddress,
  ): Promise<{ address: PostalAddress; messages: string[]; valid: boolean }> {
    await this.requireStaff(["owner", "admin", "manager", "staff"]);
    return this.validateShippingAddressWithProvider(address);
  }

  private async validateShippingAddressWithProvider(
    address: PostalAddress,
  ): Promise<{ address: PostalAddress; messages: string[]; valid: boolean }> {
    const result = await createShippingProvider(this.env).validateAddress(address);
    return {
      address: result.address,
      messages: result.messages,
      valid: result.valid,
    };
  }

  async generateShipmentLabels(shipmentIds: string[]): Promise<{
    failed: number;
    generated: number;
    results: Array<Record<string, unknown>>;
  }> {
    if (!shipmentIds.length || shipmentIds.length > 100) {
      throw new AppError(
        400,
        "invalid_request",
        "Choose between 1 and 100 shipments for label generation.",
      );
    }
    shipmentIds.forEach((shipmentId) => assertUuid(shipmentId, "Shipment"));
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const provider = createShippingProvider(this.env);
    const { data: organization, error: organizationError } = await this.admin
      .from("organizations")
      .select("name,shipping_origin_address")
      .eq("id", organizationId)
      .single();
    if (organizationError || !organization) {
      throw databaseError("The winery shipping settings could not be loaded.");
    }
    const fromAddress = parseOriginAddress(organization.shipping_origin_address);
    const originConfig =
      organization.shipping_origin_address &&
      typeof organization.shipping_origin_address === "object"
        ? (organization.shipping_origin_address as Record<string, unknown>)
        : {};
    const originName =
      typeof originConfig.name === "string" && originConfig.name.trim()
        ? originConfig.name.trim()
        : String(organization.name ?? "").trim();
    const originCompany =
      typeof originConfig.company === "string" && originConfig.company.trim()
        ? originConfig.company.trim()
        : String(organization.name ?? "").trim();
    const originPhone =
      typeof originConfig.phone === "string" ? originConfig.phone.trim() : "";
    if (
      !isCompleteShippingContact(
        {
          company: originCompany,
          name: originName,
          phone: originPhone,
        },
        true,
      )
    ) {
      throw new AppError(
        503,
        "activation_required",
        "Complete the winery shipping origin name, company, and phone before generating alcohol labels.",
      );
    }
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "id,organization_id,brand_id,member_id,release_id,status,shipping_address,charge_amount_cents,loyalty_discount_cents,retry_count,members!inner(id,organization_id,brand_id,email,first_name,last_name,phone,birthday),shipment_items(*)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .in("id", shipmentIds);
    if (error) throw databaseError("Shipments could not be loaded.");
    const foundIds = new Set((data ?? []).map((shipment) => String(shipment.id)));
    const missingResults = shipmentIds
      .filter((shipmentId) => !foundIds.has(shipmentId))
      .map((shipmentId) => ({
        error: { code: "not_found", message: "Shipment not found." },
        shipmentId,
        success: false,
      }));
    const results = await mapConcurrent(
      (data ?? []) as ShipmentLabelRow[],
      5,
      async (shipment): Promise<Record<string, unknown>> => {
        try {
          if (shipment.status !== "charged") {
            throw new AppError(
              409,
              "conflict",
              "Only successfully charged shipments can receive labels.",
            );
          }
          const member = oneRelation(shipment.members);
          const toAddress = getAddress(shipment.shipping_address);
          if (!toAddress) {
            throw new AppError(
              409,
              "conflict",
              "A complete member shipping address is required.",
            );
          }
          const validation = await provider.validateAddress(toAddress);
          if (!validation.valid) {
            throw new AppError(
              409,
              "conflict",
              validation.messages.join(" ") || "The shipping address is invalid.",
            );
          }
          const validatedShippingAddress = {
            city: validation.address.city,
            country_code: validation.address.country,
            line1: validation.address.line1,
            line2: validation.address.line2,
            postal_code: validation.address.postalCode,
            region: validation.address.state,
          };
          // Persist the normalized address while the shipment is still charged.
          // The database invalidates any earlier decision here, then the
          // compliance RPC fingerprints this exact immutable pre-label state.
          const { data: preparedShipment, error: preparationError } =
            await this.admin.rpc("set_validated_shipment_address", {
              p_actor_user_id: principal.user.id,
              p_organization_id: organizationId,
              p_shipment_id: shipment.id,
              p_validated_address: validatedShippingAddress,
              p_validation_messages: validation.messages,
              p_validation_status: "valid",
            });
          if (preparationError) {
            throw databaseError(
              "The validated shipping address could not be persisted.",
            );
          }
          if (!preparedShipment) {
            throw new AppError(
              409,
              "conflict",
              "The shipment changed before its validated address could be prepared.",
            );
          }
          const items = shipment.shipment_items ?? [];
          const bottleCount = Math.max(
            1,
            items.reduce(
              (total, item) => total + Number(item.quantity ?? 0),
              0,
            ),
          );
          const recipientName =
            typeof shipment.shipping_address?.name === "string"
              ? shipment.shipping_address.name.trim()
              : `${member?.first_name ?? ""} ${member?.last_name ?? ""}`.trim();
          const recipientPhone =
            typeof shipment.shipping_address?.phone === "string"
              ? shipment.shipping_address.phone.trim()
              : String(member?.phone ?? "").trim();
          if (
            !isCompleteShippingContact({
              name: recipientName,
              phone: recipientPhone,
            })
          ) {
            throw new AppError(
              409,
              "conflict",
              "The member needs a recipient name and phone before an adult-signature label can be generated.",
            );
          }
          const compliance = await this.checkShipmentCompliance(principal, {
            brandId,
            bottleCount,
            destination: validation.address,
            memberBirthday: member?.birthday,
            organizationId,
            origin: fromAddress,
            recipientName,
            shipment,
          });
          if (!permitsLabelGeneration(compliance.result.status)) {
            const block = this.complianceBlock(
              compliance.result.status,
              compliance.result.reason,
            );
            return {
              compliance: compliance.check,
              error: {
                code: block.code,
                message: block.message,
                reason: compliance.result.reason,
                status: compliance.result.status,
              },
              shipmentId: shipment.id,
              success: false,
            };
          }
          const labelRequest: LabelRequest = {
            externalId: shipment.id,
            fromAddress,
            fromContact: {
              company: originCompany,
              name: originName,
              phone: originPhone,
            },
            parcel: {
              heightInches: 6,
              lengthInches: 14,
              weightOunces: bottleCount * 48,
              widthInches: 12,
            },
            toAddress: validation.address,
            toContact: {
              name: recipientName,
              phone: recipientPhone,
            },
          };
          {
            const { data: attemptData, error: attemptError } =
              await this.admin.rpc("acquire_shipping_label_attempt", {
                p_actor_user_id: principal.user.id,
                p_lease_seconds: 300,
                p_organization_id: organizationId,
                p_provider: this.env.SHIPPING_PROVIDER,
                p_shipment_id: shipment.id,
                p_worker_id: `staff:${principal.user.id}`,
              });
            if (attemptError) {
              throw databaseError(
                "A durable shipping label attempt could not be acquired.",
              );
            }
            const attempt = rpcRecord(attemptData);
            const disposition = String(attempt.disposition ?? "");
            if (disposition === "succeeded") {
              const providerMetadata =
                attempt.providerMetadata &&
                typeof attempt.providerMetadata === "object"
                  ? (attempt.providerMetadata as Record<string, unknown>)
                  : {};
              await this.recordDomainAnalyticsEvent(principal, {
                eventData: {
                  carrier: String(attempt.carrier ?? "unknown"),
                  provider: String(attempt.provider ?? "unknown"),
                  rateCents: Number(attempt.labelCostCents ?? 0),
                },
                eventType: "shipment.label_created",
                memberId: shipment.member_id,
                requestKey: `label:${shipment.id}:${String(attempt.externalLabelId)}`,
              });
              return {
                label: {
                  carrier: attempt.carrier,
                  labelId: attempt.externalLabelId,
                  labelUrl: attempt.labelUrl,
                  providerReference: attempt.externalShipmentId,
                  rateId: attempt.externalRateId,
                  rateCents: Number(attempt.labelCostCents ?? 0),
                  service:
                    typeof providerMetadata.service === "string"
                      ? providerMetadata.service
                      : "Recovered",
                  trackingNumber: attempt.trackingNumber,
                },
                recovered: true,
                shipmentId: shipment.id,
                success: true,
              };
            }
            if (disposition === "in_progress") {
              throw new AppError(
                409,
                "conflict",
                "Another worker is already purchasing this shipment label.",
              );
            }
            const attemptId = String(attempt.attemptId ?? "");
            const leaseToken = String(attempt.leaseToken ?? "");
            if (
              !attemptId ||
              !leaseToken ||
              ![
                "create_shipment",
                "recover_purchase",
                "reconcile",
              ].includes(disposition)
            ) {
              throw new AppError(
                409,
                "conflict",
                "The shipping label attempt requires reconciliation before another purchase.",
              );
            }
            let externalShipmentPersisted = Boolean(
              attempt.externalShipmentId,
            );
            try {
              const label = await provider.createLabel(
                {
                  ...labelRequest,
                  externalId: String(attempt.correlationReference),
                },
                {
                externalRateId:
                  typeof attempt.externalRateId === "string"
                    ? attempt.externalRateId
                    : null,
                externalShipmentId:
                  typeof attempt.externalShipmentId === "string"
                    ? attempt.externalShipmentId
                    : null,
                persistExternalShipment: async (
                  externalShipmentId,
                  externalRateId,
                ) => {
                  const { error: persistError } = await this.admin.rpc(
                    "persist_shipping_label_external_shipment",
                    {
                      p_attempt_id: attemptId,
                      p_external_rate_id: externalRateId,
                      p_external_shipment_id: externalShipmentId,
                      p_lease_token: leaseToken,
                    },
                  );
                  if (persistError) {
                    throw databaseError(
                      "The external carrier shipment could not be persisted before purchase.",
                    );
                  }
                  externalShipmentPersisted = true;
                },
                },
              );
              const { error: completionError } = await this.admin.rpc(
                "complete_shipping_label_attempt",
                {
                  p_attempt_id: attemptId,
                  p_carrier: label.carrier,
                  p_error_message: null,
                  p_external_label_id: label.labelId,
                  p_label_cost_cents: label.rateCents,
                  p_label_url: label.labelUrl,
                  p_lease_token: leaseToken,
                  p_outcome: "succeeded",
                  p_provider_metadata: {
                    label_format: "PDF",
                    service: label.service,
                  },
                  p_tracking_number: label.trackingNumber,
                },
              );
              if (completionError) {
                throw databaseError(
                  "The purchased carrier label could not be committed.",
                );
              }
              await this.recordDomainAnalyticsEvent(principal, {
                eventData: {
                  carrier: label.carrier,
                  provider: this.env.SHIPPING_PROVIDER ?? "unknown",
                  rateCents: label.rateCents,
                },
                eventType: "shipment.label_created",
                memberId: shipment.member_id,
                requestKey: `label:${shipment.id}:${label.labelId}`,
              });
              return { label, shipmentId: shipment.id, success: true };
            } catch (error) {
              await this.admin.rpc("complete_shipping_label_attempt", {
                p_attempt_id: attemptId,
                p_carrier: null,
                p_error_message: externalShipmentPersisted
                  ? "Carrier purchase outcome requires reconciliation."
                  : "Carrier shipment creation failed before persistence.",
                p_external_label_id: null,
                p_label_cost_cents: null,
                p_label_url: null,
                p_lease_token: leaseToken,
                p_outcome: externalShipmentPersisted
                  ? "indeterminate"
                  : "failed",
                p_provider_metadata: {},
                p_tracking_number: null,
              });
              throw error;
            }
          }
        } catch (error) {
          return {
            error:
              error instanceof AppError
                ? { code: error.code, message: error.message }
                : { code: "upstream_error", message: "Label generation failed." },
            shipmentId: shipment.id,
            success: false,
          };
        }
      },
    );
    results.push(...missingResults);
    const summary = {
      failed: results.filter((result) => !result.success).length,
      generated: results.filter((result) => result.success).length,
      results,
    };
    await this.audit(
      principal,
      "shipment.labels_generated",
      "organization",
      organizationId,
      {
      failed: summary.failed,
      generated: summary.generated,
      shipment_ids: shipmentIds,
      },
    );
    return summary;
  }

  async getPickList(releaseId: string): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "id,status,members(first_name,last_name),shipment_items(id,wine_name,quantity,packed_quantity,barcode)",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("release_id", releaseId)
      .in("status", ["charged", "label_created", "packed", "shipped"]);
    if (error) throw databaseError("The pick list could not be generated.");
    const shipments = (data ?? []).map(toPublicRecord);
    return {
      generatedAt: new Date().toISOString(),
      releaseId,
      shipmentCount: shipments.length,
      shipments,
    };
  }

  async confirmShipmentPack(
    shipmentId: string,
    input: { barcode: string },
  ): Promise<{ complete: boolean; packedItems: number; status: ShipmentStatus }> {
    assertUuid(shipmentId, "Shipment");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin.rpc("confirm_shipment_item_pack", {
      p_actor_user_id: principal.user.id,
      p_barcode: input.barcode,
      p_organization_id: organizationId,
      p_shipment_id: shipmentId,
    });
    if (error) {
      throw new AppError(
        error.code === "P0002" ? 404 : 409,
        error.code === "P0002" ? "not_found" : "conflict",
        "The barcode could not be confirmed for this shipment.",
      );
    }
    const result = Array.isArray(data) ? data[0] : data;
    return {
      complete: Boolean(result?.complete),
      packedItems: Number(result?.packed_items ?? 0),
      status: (result?.status ?? "label_created") as ShipmentStatus,
    };
  }

  async transitionShipment(
    shipmentId: string,
    input: {
      carrier?: string;
      status: "shipped" | "delivered" | "cancelled";
      trackingNumber?: string;
    },
  ): Promise<Record<string, unknown>> {
    assertUuid(shipmentId, "Shipment");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin.rpc("transition_shipment", {
      p_actor_user_id: principal.user.id,
      p_carrier: input.carrier ?? null,
      p_metadata: {},
      p_organization_id: organizationId,
      p_shipment_id: shipmentId,
      p_target_status: input.status,
      p_tracking_number: input.trackingNumber ?? null,
    });
    if (error) {
      throw new AppError(409, "conflict", "That shipment status change is not allowed.");
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (input.status === "shipped" || input.status === "delivered") {
      await this.recordDomainAnalyticsEvent(principal, {
        eventData: { status: input.status },
        eventType:
          input.status === "shipped"
            ? "shipment.shipped"
            : "shipment.delivered",
        requestKey: `shipment:${shipmentId}:${input.status}`,
      });
    }
    return { id: shipmentId, status: result };
  }

  async previewMemberImport(input: CsvPreviewInput): Promise<{
    columns: string[];
    rows: Array<Record<string, string>>;
    source: "commerce7" | "winedirect" | "generic";
    suggestedMapping: Record<string, string>;
    uploadToken: string;
    validation: {
      errors: Array<{ field?: string; message: string; row: number }>;
      invalidCount: number;
      validCount: number;
    };
  }> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const parsed = parseCsv(input.contents);
    const mapping =
      input.mapping ??
      (input.format === "generic"
        ? inferGenericMapping(parsed.headers)
        : FORMAT_MAPPINGS[input.format]);
    const normalized = parsed.rows.map((row) => normalizeCsvMember(row, mapping));
    const hasTierAssignments = normalized.some((member) => member.clubTierValue);
    const { data: tiers, error: tierError } = hasTierAssignments
      ? await this.admin
          .from("club_tiers")
          .select("id,name")
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId)
          .eq("active", true)
      : { data: [], error: null };
    if (tierError) throw databaseError("Club tiers could not be validated.");
    const tierLookup = buildCsvTierLookup(
      (tiers ?? []).map((tier) => ({
        id: String(tier.id),
        name: String(tier.name),
      })),
    );
    for (const member of normalized) {
      member.clubTierId = resolveCsvTierId(member.clubTierValue, tierLookup);
    }
    const validationErrors = normalized
      .map(validateCsvMember)
      .filter((error): error is CsvValidationError => Boolean(error));
    for (const member of normalized) {
      if (member.clubTierValue && !member.clubTierId) {
        validationErrors.push({
          fields: {
            clubTier:
              "Use an active club tier name or tier ID from this winery.",
          },
          reason: "The club tier could not be resolved.",
          rowNumber: member.rowNumber,
        });
      }
    }
    const duplicateRows = new Map<string, number[]>();
    for (const member of normalized) {
      const rows = duplicateRows.get(member.email) ?? [];
      rows.push(member.rowNumber);
      duplicateRows.set(member.email, rows);
    }
    const fileDuplicates = [...duplicateRows.entries()].filter(
      ([email, rows]) => email && rows.length > 1,
    );
    for (const [email, rows] of fileDuplicates) {
      for (const rowNumber of rows.slice(1)) {
        validationErrors.push({
          fields: { email: "Duplicate email in this file." },
          reason: `The email ${email} appears more than once.`,
          rowNumber,
        });
      }
    }
    const emails = [...new Set(normalized.map((member) => member.email).filter(Boolean))];
    const { data: existing, error } = emails.length
      ? await this.admin
          .from("members")
          .select("email")
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId)
          .in("email", emails)
      : { data: [], error: null };
    if (error) throw databaseError("Existing members could not be checked.");
    const existingEmails = new Set(
      (existing ?? []).map((member) => String(member.email).toLowerCase()),
    );
    for (const member of normalized) {
      if (existingEmails.has(member.email)) {
        validationErrors.push({
          fields: { email: "This member already exists." },
          reason: "Duplicate email in this winery.",
          rowNumber: member.rowNumber,
        });
      }
    }
    const invalidRows = new Set(validationErrors.map((error) => error.rowNumber));
    const uploadToken = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
    const importId = crypto.randomUUID();
    const normalizedByRow = new Map(
      normalized.map((member) => [member.rowNumber, member]),
    );
    const errorsByRow = new Map<number, CsvValidationError[]>();
    for (const validationError of validationErrors) {
      const rowErrors = errorsByRow.get(validationError.rowNumber) ?? [];
      rowErrors.push(validationError);
      errorsByRow.set(validationError.rowNumber, rowErrors);
    }
    const dbMapping = csvMappingToDatabase(mapping);
    const source = input.format === "winedirect" ? "wine_direct" : input.format;
    const { error: importError } = await this.admin.from("member_imports").insert({
      column_mapping: dbMapping,
      content_sha256: await sha256(input.contents),
      content_type: input.contentType ?? "text/csv",
      file_size_bytes: Buffer.byteLength(input.contents, "utf8"),
      headers: parsed.headers,
      id: importId,
      imported_by: principal.user.id,
      invalid_rows: invalidRows.size,
      brand_id: brandId,
      organization_id: organizationId,
      original_filename: input.filename ?? "members.csv",
      source,
      status: "previewed",
      total_rows: parsed.rows.length,
      upload_token_hash: await sha256(uploadToken),
      valid_rows: parsed.rows.length - invalidRows.size,
    });
    if (importError) throw databaseError("The member import preview could not be staged.");
    const stagedRows = parsed.rows.map((row) => {
      const member = normalizedByRow.get(row.rowNumber);
      const rowErrors = errorsByRow.get(row.rowNumber) ?? [];
      return {
        import_id: importId,
        brand_id: brandId,
        normalized_data: member ? normalizedMemberToDatabase(member) : {},
        organization_id: organizationId,
        raw_data: row.values,
        row_number: row.rowNumber,
        status: rowErrors.length ? "invalid" : "valid",
        validation_errors: rowErrors.map((rowError) => rowError.reason),
      };
    });
    const { error: rowsError } = await this.admin
      .from("member_import_rows")
      .insert(stagedRows);
    if (rowsError) {
      await this.admin.from("member_imports").delete().eq("id", importId);
      throw databaseError("The member import rows could not be staged.");
    }
    const publicErrors = validationErrors.flatMap((validationError) => {
      const fields = Object.entries(validationError.fields ?? {});
      return fields.length
        ? fields.map(([field, message]) => ({
            field,
            message,
            row: validationError.rowNumber,
          }))
        : [
            {
              message: validationError.reason,
              row: validationError.rowNumber,
            },
          ];
    });
    return {
      columns: parsed.headers,
      rows: parsed.rows.slice(0, 10).map((row) => row.values),
      source: input.format,
      suggestedMapping: Object.fromEntries(
        Object.entries(mapping)
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
          .map(([target, sourceHeader]) => [sourceHeader, target]),
      ),
      uploadToken,
      validation: {
        errors: publicErrors,
        invalidCount: invalidRows.size,
        validCount: parsed.rows.length - invalidRows.size,
      },
    };
  }

  async importMembers(input: {
    mapping?: Record<string, string>;
    uploadToken: string;
  }): Promise<{
    errors: Array<{ message: string; row: number }>;
    importedCount: number;
    skippedCount: number;
  }> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    if (!/^[0-9a-f-]{68}$/i.test(input.uploadToken)) {
      throw new AppError(400, "invalid_request", "The import token is invalid.");
    }
    const mapping = canonicalizeCsvImportMapping(input.mapping ?? {});
    const { data, error } = await this.admin.rpc("complete_member_import", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_column_mapping: mapping,
      p_organization_id: organizationId,
      p_upload_token: input.uploadToken,
    });
    if (error) {
      const mappingChanged =
        error.code === "22023" &&
        String(error.message ?? "").includes("Column mapping changed after preview");
      throw new AppError(
        error.code === "22023" || error.code === "P0002" ? 400 : 500,
        error.code === "22023" || error.code === "P0002"
          ? "invalid_request"
          : "upstream_error",
        mappingChanged
          ? "The column mapping changed after validation. Upload and preview the file again."
          : error.code === "22023"
          ? "The import token expired or has already been used."
          : "The member import could not be completed.",
      );
    }
    const result = Array.isArray(data) ? data[0] : data;
    const importedCount = Number(result?.inserted_count ?? 0);
    const skippedCount = Number(result?.failed_count ?? 0);
    const { data: failedRows } = await this.admin
      .from("member_import_rows")
      .select("row_number,validation_errors,member_imports!inner(upload_token_hash)")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("member_imports.upload_token_hash", await sha256(input.uploadToken))
      .in("status", ["invalid", "failed"])
      .order("row_number");
    const errors = (failedRows ?? []).map((row) => ({
      message: Array.isArray(row.validation_errors)
        ? row.validation_errors.map(String).join(" ")
        : "The member row could not be imported.",
      row: Number(row.row_number),
    }));
    return {
      errors,
      importedCount,
      skippedCount,
    };
  }

  async getMemberPortalHistory(): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireMember();
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "id,member_id,release_id,status,shipping_address,tracking_number,carrier,charge_amount_cents,loyalty_discount_cents,tax_amount_cents,created_at,updated_at,releases(id,name,description,processing_date,embargo_date),shipment_items(id,wine_name,quantity,price_cents)",
      )
      .eq("organization_id", principal.organization.id)
      .eq("brand_id", principal.brand.id)
      .eq("member_id", principal.user.id)
      .order("created_at", { ascending: false })
      .limit(MEMBER_PORTAL_HISTORY_LIMIT);
    if (error) throw databaseError("Shipment history could not be loaded.");
    const now = Date.now();
    return (data ?? []).map((shipment) => {
      const release = oneRelation(
        shipment.releases as
          | Record<string, unknown>
          | Array<Record<string, unknown>>
          | null,
      );
      const embargoDate =
        typeof release?.embargo_date === "string"
          ? Date.parse(release.embargo_date)
          : Number.NaN;
      const hidden = Number.isFinite(embargoDate) && embargoDate > now;
      return {
        ...toPublicShipment({
          ...shipment,
          shipment_items: hidden ? [] : shipment.shipment_items,
        }),
        displayContents: !hidden,
      };
    });
  }

  async updateMemberPortalAddress(
    address: PostalAddress,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(commandId, "Command");
    const principal = await this.requireMember();
    const validation = await this.validateShippingAddressWithProvider(address);
    if (!validation.valid) {
      throw new AppError(
        400,
        "invalid_request",
        validation.messages.join(" ") || "Enter a valid shipping address.",
      );
    }
    const { data, error } = await this.admin.rpc(
      "apply_member_portal_address_command",
      {
        p_auth_user_id: principal.user.id,
        p_brand_id: principal.brand.id,
        p_command_id: commandId,
        p_member_id: principal.user.id,
        p_organization_id: principal.organization.id,
        p_validated_address: validation.address,
      },
    );
    if (error) {
      throw commandError(error, "The shipping address could not be updated.");
    }
    const result = commandResult(data);
    const { data: member, error: memberError } = await this.admin
      .from("members")
      .select(
        "id,shipping_address_line1,shipping_address_line2,shipping_city,shipping_region,shipping_postal_code,shipping_country_code",
      )
      .eq("id", principal.user.id)
      .eq("organization_id", principal.organization.id)
      .eq("brand_id", principal.brand.id)
      .single();
    if (memberError || !member) {
      throw databaseError("The updated shipping address could not be loaded.");
    }
    return {
      address: toPublicMember(member).address,
      command: result,
      id: member.id,
    };
  }

  private coreApplicationOrigin(): string {
    const origin = this.request.get("origin");
    if (origin) {
      try {
        return new URL(origin).origin;
      } catch {
        // Origin validation middleware rejects malformed state-changing requests.
      }
    }
    const host = this.request.get("host");
    const protocol =
      this.request.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      this.request.protocol;
    return host ? `${protocol}://${host}` : this.env.APP_ORIGIN ?? "http://localhost:5173";
  }

  private async assertTenantEntity(
    table: string,
    id: string,
    organizationId: string,
    brandId: string,
    label: string,
  ): Promise<void> {
    assertUuid(id, label);
    const { data, error } = await this.admin
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw databaseError(`${label} could not be validated.`);
    if (!data) throw new AppError(404, "not_found", `${label} not found.`);
  }

  private async assertReleaseTiers(
    input: ReleaseInput,
    organizationId: string,
    brandId: string,
  ): Promise<void> {
    const uniqueTierIds = new Set(input.tierIds);
    if (uniqueTierIds.size !== input.tierIds.length) {
      throw new AppError(400, "invalid_request", "Release tiers must be unique.");
    }
    if (new Set(input.tierPrices.map((price) => price.tierId)).size !== uniqueTierIds.size) {
      throw new AppError(
        400,
        "invalid_request",
        "Each participating tier needs one release price.",
      );
    }
    if (
      input.tierPrices.some((price) => !uniqueTierIds.has(price.tierId))
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "Release prices must belong to participating tiers.",
      );
    }
    const { data, error } = await this.admin
      .from("club_tiers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .in("id", input.tierIds);
    if (error) throw databaseError("Release tiers could not be validated.");
    if ((data ?? []).length !== uniqueTierIds.size) {
      throw new AppError(404, "not_found", "One or more club tiers were not found.");
    }
  }

  private async replaceReleaseChildren(
    releaseId: string,
    organizationId: string,
    brandId: string,
    input: ReleaseInput,
  ): Promise<void> {
    const tables = ["release_tier_items", "release_wines", "release_tiers"];
    for (const table of tables) {
      const { error } = await this.admin
        .from(table)
        .delete()
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("release_id", releaseId);
      if (error) throw databaseError("Release details could not be replaced.");
    }
    const { data: releaseTiers, error: tiersError } = await this.admin
      .from("release_tiers")
      .insert(
        input.tierIds.map((tierId) => ({
          brand_id: brandId,
          organization_id: organizationId,
          release_id: releaseId,
          tier_id: tierId,
        })),
      )
      .select("id,tier_id");
    if (tiersError || !releaseTiers) {
      throw databaseError("Release tiers could not be saved.");
    }
    for (const price of input.tierPrices) {
      const { error } = await this.admin
        .from("release_tiers")
        .update({ price_cents: price.priceCents })
        .eq("release_id", releaseId)
        .eq("tier_id", price.tierId)
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId);
      if (error) throw databaseError("Release tier pricing could not be saved.");
    }
    const { data: releaseWines, error: winesError } = await this.admin
      .from("release_wines")
      .insert(
        input.wines.map((wine) => ({
          brand_id: brandId,
          organization_id: organizationId,
          release_id: releaseId,
          wine_name: wine.wineName,
        })),
      )
      .select("id,wine_name");
    if (winesError || !releaseWines) {
      throw databaseError("Release wines could not be saved.");
    }
    const tierItems = releaseTiers.flatMap((releaseTier) =>
      releaseWines.map((releaseWine, index) => ({
        brand_id: brandId,
        organization_id: organizationId,
        quantity: input.wines[index]?.quantity ?? 1,
        release_id: releaseId,
        release_tier_id: releaseTier.id,
        release_wine_id: releaseWine.id,
        unit_price_cents: input.wines[index]?.priceCents ?? 0,
      })),
    );
    const { error: itemError } = await this.admin
      .from("release_tier_items")
      .insert(tierItems);
    if (itemError) {
      throw databaseError("Release tier items could not be saved.");
    }
  }

  private async getPaymentShipment(
    shipmentId: string,
    organizationId: string,
    brandId: string,
    requiredStatus: ShipmentStatus,
  ): Promise<ShipmentPaymentRow> {
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id)",
      )
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw databaseError("The shipment could not be loaded.");
    if (!data) throw new AppError(404, "not_found", "Shipment not found.");
    if (data.status !== requiredStatus) {
      throw new AppError(
        409,
        "conflict",
        `The shipment must be ${requiredStatus} for this operation.`,
      );
    }
    return data as ShipmentPaymentRow;
  }

  private async chargeShipment(
    stripe: Stripe,
    shipment: ShipmentPaymentRow,
    principal: StaffPrincipal,
    source: "release_processing" | "manual_retry",
  ): Promise<"charged" | "declined" | "skipped"> {
    assertStripeBillingAuthority(this.env);
    if (!["pending", "declined"].includes(shipment.status)) return "skipped";
    const organizationId = this.organizationId(principal);
    const member = oneRelation(shipment.members);
    if (
      !member ||
      member.organization_id !== organizationId ||
      member.brand_id !== shipment.brand_id
    ) {
      throw new AppError(403, "forbidden", "Shipment tenant validation failed.");
    }
    await assertBrandOperationalAccess(
      this.admin,
      organizationId,
      shipment.brand_id,
    );
    const avalara = await prepareAvalaraTax(this.env, this.admin, shipment);
    const billingAttemptId = await this.ensureBillingAttempt(
      shipment,
      principal,
      source,
      null,
    );
    const payableAmount = payableShipmentAmount(shipment);
    if (payableAmount === 0) {
      await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
        chargeId: null,
        declineReason: null,
        paymentIntentId: null,
        source,
        status: "charged",
      });
      await finalizeAvalaraTax(this.admin, shipment, avalara, "commit");
      return "charged";
    }
    const paymentMethodId = await resolveStripePaymentMethod(
      stripe,
      this.admin,
      member,
    );
    if (!member.stripe_customer_id || !paymentMethodId) {
      await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
        chargeId: null,
        declineReason: "payment_method_missing",
        paymentIntentId: null,
        source,
        status: "declined",
      });
      await finalizeAvalaraTax(this.admin, shipment, avalara, "void");
      return "declined";
    }
    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: payableAmount,
          automatic_payment_methods: { enabled: true },
          confirm: true,
          currency: "usd",
          customer: member.stripe_customer_id,
          description: `Vinifera release ${shipment.release_id}`,
          metadata: {
            brand_id: shipment.brand_id,
            member_id: shipment.member_id,
            organization_id: organizationId,
            release_id: shipment.release_id,
            shipment_id: shipment.id,
          },
          off_session: true,
          payment_method: paymentMethodId,
        },
        {
          idempotencyKey: paymentIdempotencyKey(shipment, source),
        },
      );
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeCardError)) {
        await finalizeAvalaraTax(
          this.admin,
          shipment,
          avalara,
          "void",
        ).catch(() => undefined);
        throw new AppError(
          502,
          "upstream_error",
          "Stripe could not confirm this shipment payment.",
        );
      }
      await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
        chargeId: null,
        declineReason: paymentDeclineReason(error),
        paymentIntentId: error.payment_intent?.id ?? null,
        source,
        status: "declined",
      });
      await finalizeAvalaraTax(this.admin, shipment, avalara, "void");
      return "declined";
    }
    if (paymentIntent.status !== "succeeded") {
      await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
        chargeId:
          typeof paymentIntent.latest_charge === "string"
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge?.id ?? null,
        declineReason:
          paymentIntent.last_payment_error?.decline_code ?? paymentIntent.status,
        paymentIntentId: paymentIntent.id,
        source,
        status: "declined",
      });
      await finalizeAvalaraTax(this.admin, shipment, avalara, "void");
      return "declined";
    }
    // Never downgrade successful money movement when local persistence fails.
    // The signed Stripe webhook remains the convergence path for this state.
    await this.recordPaymentOutcome(shipment, principal, billingAttemptId, {
      chargeId:
        typeof paymentIntent.latest_charge === "string"
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge?.id ?? null,
      declineReason: null,
      paymentIntentId: paymentIntent.id,
      source,
      status: "charged",
    });
    await finalizeAvalaraTax(this.admin, shipment, avalara, "commit");
    return "charged";
  }

  private async recordPaymentOutcome(
    shipment: ShipmentPaymentRow,
    principal: StaffPrincipal,
    billingAttemptId: string,
    outcome: {
      chargeId: string | null;
      declineReason: string | null;
      paymentIntentId: string | null;
      source: "release_processing" | "manual_retry";
      status: "charged" | "declined";
    },
  ): Promise<void> {
    const organizationId = this.organizationId(principal);
    const persistedAttemptId = await this.ensureBillingAttempt(
      shipment,
      principal,
      outcome.source,
      outcome.paymentIntentId,
    );
    if (persistedAttemptId !== billingAttemptId) {
      throw databaseError("The billing attempt id changed during confirmation.");
    }
    const { error } = await this.admin.rpc("apply_shipment_payment_event", {
      p_billing_attempt_id: billingAttemptId,
      p_brand_id: shipment.brand_id,
      p_decline_code: outcome.declineReason,
      p_decline_reason: outcome.declineReason,
      p_event_created_at: new Date().toISOString(),
      p_metadata: { source: outcome.source },
      p_organization_id: organizationId,
      p_shipment_id: shipment.id,
      p_status: outcome.status === "charged" ? "succeeded" : "declined",
      p_stripe_charge_id: outcome.chargeId,
      p_stripe_event_id: null,
    });
    if (error) throw databaseError("The shipment payment state could not be persisted.");
    if (outcome.status === "charged" && shipment.loyalty_redemption_id) {
      const { error: loyaltyError } = await this.admin.rpc(
        "finalize_loyalty_redemption",
        {
          p_actor_user_id: principal.user.id,
          p_apply: true,
          p_organization_id: organizationId,
          p_redemption_id: shipment.loyalty_redemption_id,
        },
      );
      if (loyaltyError) {
        throw databaseError("The loyalty redemption could not be finalized.");
      }
    }
    await this.audit(
      principal,
      outcome.status === "charged" ? "shipment.charged" : "shipment.declined",
      "shipment",
      shipment.id,
      {
        amount_cents: payableShipmentAmount(shipment),
        loyalty_discount_cents: Number(shipment.loyalty_discount_cents ?? 0),
        decline_reason: outcome.declineReason,
        source: outcome.source,
        stripe_payment_intent_id: outcome.paymentIntentId,
      },
    );
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        amountCents: payableShipmentAmount(shipment),
        source: outcome.source,
      },
      eventType:
        outcome.status === "charged"
          ? "shipment.charged"
          : "shipment.declined",
      memberId: shipment.member_id,
      requestKey: `billing-attempt:${billingAttemptId}:${outcome.status}`,
    });
    if (outcome.status === "declined") {
      console.info(
        JSON.stringify({
          event: "member.decline_notification.queued_by_database",
          memberId: shipment.member_id,
          organizationId,
          shipmentId: shipment.id,
        }),
      );
    }
  }

  private async ensureBillingAttempt(
    shipment: ShipmentPaymentRow,
    principal: StaffPrincipal,
    source: "release_processing" | "manual_retry",
    paymentIntentId: string | null,
  ): Promise<string> {
    const organizationId = this.organizationId(principal);
    const { data, error } = await this.admin.rpc("record_billing_attempt", {
      p_actor_user_id: principal.user.id,
      p_amount_cents: payableShipmentAmount(shipment),
      p_attempt_kind: source === "release_processing" ? "charge" : "retry",
      p_brand_id: shipment.brand_id,
      p_idempotency_key: paymentIdempotencyKey(shipment, source),
      p_metadata: { source },
      p_organization_id: organizationId,
      p_shipment_id: shipment.id,
      p_stripe_payment_intent_id: paymentIntentId,
    });
    if (error) throw databaseError("The billing attempt could not be recorded.");
    const attemptId = Array.isArray(data) ? data[0] : data;
    if (typeof attemptId !== "string") {
      throw databaseError("The billing attempt id was not returned.");
    }
    return attemptId;
  }
}

export interface ScheduledRetryRow {
  amount_cents: number;
  attempt_number: number;
  brand_id?: string;
  billing_attempt_id: string;
  member_id: string;
  organization_id: string;
  shipment_id: string;
}

export interface ProcessingReleaseRow {
  brand_id?: string;
  id: string;
  organization_id: string;
}

interface ProcessingAttemptRow {
  attempt_kind: "charge" | "retry";
  id: string;
  idempotency_key: string;
  shipments: ShipmentPaymentRow | ShipmentPaymentRow[] | null;
  status: "processing" | "queued";
}

interface ProcessingRefundAttemptRow {
  amount_cents: number;
  id: string;
  idempotency_key: string;
  metadata: Record<string, unknown> | null;
  recovery_lease_token: string;
  shipments: ShipmentPaymentRow | ShipmentPaymentRow[] | null;
}

interface RefundRecoveryClaimRow {
  billing_attempt_id: string;
  lease_token: string;
}

export interface MemberSideEffectRow {
  attempt_count: number;
  brand_id: string;
  command_id: string;
  effect_type: "auth_user_delete" | "stripe_customer_sync";
  lease_token: string;
  max_attempts: number;
  member_id: string;
  organization_id: string;
  outbox_id: string;
  payload: Record<string, unknown>;
  provider_subject_id: string;
}

export interface CoreClubScheduleReport {
  charged: number;
  claimedReleases: number;
  declined: number;
  failed: number;
  memberSideEffectFailures: number;
  memberSideEffects: number;
  recoveredAttempts: number;
  refundsRecovered: number;
  retryAttempts: number;
}

function safeMemberSideEffectErrorCode(error: unknown): string {
  if (error instanceof AppError && error.code === "activation_required") {
    return "ACTIVATION_REQUIRED";
  }
  if (error instanceof Stripe.errors.StripeError) {
    return `STRIPE_${error.type.replaceAll(/[^A-Za-z0-9_.:-]/g, "_").toUpperCase()}`;
  }
  return "PROVIDER_ERROR";
}

function safeStripeRecoveryErrorCode(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return `STRIPE_${error.type
      .replaceAll(/[^A-Za-z0-9_.:-]/g, "_")
      .toUpperCase()}`.slice(0, 100);
  }
  return "PROVIDER_ERROR";
}

function isRetryableStripeRecoveryError(error: unknown): boolean {
  return (
    !(error instanceof Stripe.errors.StripeError) ||
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError
  );
}

export async function executeMemberSideEffect(
  admin: SupabaseClient,
  stripe: Stripe,
  effect: MemberSideEffectRow,
): Promise<"applied" | "superseded"> {
  if (effect.effect_type === "stripe_customer_sync") {
    const payload = effect.payload ?? {};
    const address =
      payload.address && typeof payload.address === "object"
        ? (payload.address as Stripe.AddressParam)
        : payload.address === null
          ? ""
          : undefined;
    const phone =
      typeof payload.phone === "string"
        ? payload.phone
        : payload.phone === null
          ? ""
          : undefined;
    await stripe.customers.update(
      effect.provider_subject_id,
      {
        address,
        email: typeof payload.email === "string" ? payload.email : undefined,
        name: typeof payload.name === "string" ? payload.name : undefined,
        phone,
      },
      {
        idempotencyKey: [
          "member-side-effect",
          effect.organization_id,
          effect.brand_id,
          effect.member_id,
          effect.effect_type,
          effect.command_id,
        ].join(":"),
      },
    );
    return "applied";
  }

  const [memberReference, staffReference, platformReference] = await Promise.all([
    admin
      .from("members")
      .select("id")
      .eq("auth_user_id", effect.provider_subject_id)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle(),
    admin
      .from("staff_users")
      .select("id")
      .eq("id", effect.provider_subject_id)
      .limit(1)
      .maybeSingle(),
    admin
      .from("platform_users")
      .select("id")
      .eq("id", effect.provider_subject_id)
      .limit(1)
      .maybeSingle(),
  ]);
  if (
    memberReference.error ||
    staffReference.error ||
    platformReference.error
  ) {
    throw databaseError(
      "Auth identity references could not be verified before deletion.",
    );
  }
  if (
    memberReference.data ||
    staffReference.data ||
    platformReference.data
  ) {
    return "superseded";
  }

  const { error } = await admin.auth.admin.deleteUser(effect.provider_subject_id);
  if (error && error.status !== 404) {
    throw error;
  }
  return "applied";
}

export async function processMemberSideEffects(
  admin: SupabaseClient,
  stripe: Stripe,
  asOf: Date,
): Promise<{ failed: number; processed: number }> {
  const { data, error } = await admin.rpc("claim_member_side_effects", {
    p_lease_seconds: 300,
    p_limit: 50,
    p_worker_id: `core-club:${asOf.toISOString()}`,
  });
  if (error) {
    throw databaseError("Member provider side effects could not be claimed.");
  }
  const effects = (data ?? []) as MemberSideEffectRow[];
  const results = await mapConcurrent(effects, 5, async (effect) => {
    let errorCode: string | null = null;
    let succeeded = true;
    try {
      const outcome = await executeMemberSideEffect(admin, stripe, effect);
      errorCode = outcome === "superseded" ? "SUPERSEDED" : null;
    } catch (error) {
      succeeded = false;
      errorCode = safeMemberSideEffectErrorCode(error);
    }
    const { error: completionError } = await admin.rpc(
      "complete_member_side_effect",
      {
        p_error_code: errorCode,
        p_lease_token: effect.lease_token,
        p_outbox_id: effect.outbox_id,
        p_succeeded: succeeded,
      },
    );
    if (completionError) {
      throw databaseError("A member provider side effect could not be finalized.");
    }
    return succeeded;
  });
  return {
    failed: results.filter((succeeded) => !succeeded).length,
    processed: results.length,
  };
}

async function attachSystemPaymentIntent(
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
  options: {
    attemptId?: string;
    attemptKind: "charge" | "retry";
    idempotencyKey: string;
    paymentIntentId: string | null;
  },
): Promise<string> {
  const { data, error } = await admin.rpc("record_billing_attempt", {
    p_actor_user_id: null,
    p_amount_cents: payableShipmentAmount(shipment),
    p_attempt_kind: options.attemptKind,
    p_brand_id: shipment.brand_id,
    p_idempotency_key: options.idempotencyKey,
    p_metadata: { automatic: true },
    p_organization_id: shipment.organization_id,
    p_shipment_id: shipment.id,
    p_stripe_payment_intent_id: options.paymentIntentId,
  });
  if (error) throw databaseError("The scheduled billing attempt could not be recorded.");
  const attemptId = Array.isArray(data) ? data[0] : data;
  if (typeof attemptId !== "string") {
    throw databaseError("The scheduled billing attempt id is unavailable.");
  }
  if (options.attemptId && options.attemptId !== attemptId) {
    throw databaseError("The claimed billing attempt changed unexpectedly.");
  }
  return attemptId;
}

async function applySystemPaymentOutcome(
  admin: SupabaseClient,
  shipment: ShipmentPaymentRow,
  attemptId: string,
  outcome: {
    chargeId: string | null;
    declineCode: string | null;
    declineReason: string | null;
    paymentIntentId: string | null;
    status: "succeeded" | "declined";
  },
): Promise<void> {
  const { error } = await admin.rpc("apply_shipment_payment_event", {
    p_billing_attempt_id: attemptId,
    p_brand_id: shipment.brand_id,
    p_decline_code: outcome.declineCode,
    p_decline_reason: outcome.declineReason,
    p_event_created_at: new Date().toISOString(),
    p_metadata: { automatic: true },
    p_organization_id: shipment.organization_id,
    p_shipment_id: shipment.id,
    p_status: outcome.status,
    p_stripe_charge_id: outcome.chargeId,
    p_stripe_event_id: null,
    p_stripe_refund_id: null,
  });
  if (error) {
    throw databaseError(
      outcome.status === "succeeded"
        ? "The scheduled charge moved money but its local ledger did not update."
        : "The scheduled decline could not be recorded.",
    );
  }
}

async function applyRefundRecoveryFailure(
  admin: SupabaseClient,
  attempt: ProcessingRefundAttemptRow,
  shipment: ShipmentPaymentRow,
  errorCode: string,
): Promise<void> {
  const { error } = await admin.rpc("apply_shipment_payment_event", {
    p_billing_attempt_id: attempt.id,
    p_brand_id: shipment.brand_id,
    p_decline_code: errorCode,
    p_decline_reason: "Stripe rejected the refund request.",
    p_event_created_at: new Date().toISOString(),
    p_metadata: {
      automatic: true,
      recovery: true,
    },
    p_organization_id: shipment.organization_id,
    p_shipment_id: shipment.id,
    p_status: "failed",
    p_stripe_charge_id: shipment.stripe_charge_id,
    p_stripe_event_id: null,
    p_stripe_refund_id: null,
  });
  if (error) {
    throw databaseError("The failed refund attempt could not be finalized.");
  }
}

export async function recoverRefundAttempt(
  admin: SupabaseClient,
  stripe: Stripe,
  attempt: ProcessingRefundAttemptRow,
): Promise<"failed" | "refunded" | "retry"> {
  const shipment = oneRelation(attempt.shipments);
  if (!shipment) {
    throw databaseError("The refund recovery shipment is unavailable.");
  }
  if (
    !shipment.stripe_payment_intent_id ||
    shipment.organization_id.length === 0 ||
    shipment.brand_id.length === 0
  ) {
    await applyRefundRecoveryFailure(
      admin,
      attempt,
      shipment,
      "LOCAL_REFERENCE_MISSING",
    );
    return "failed";
  }
  try {
    const refund = await stripe.refunds.create(
      {
        amount: attempt.amount_cents,
        metadata: {
          billing_attempt_id: attempt.id,
          brand_id: shipment.brand_id,
          organization_id: shipment.organization_id,
          reason:
            typeof attempt.metadata?.reason === "string"
              ? attempt.metadata.reason
              : "",
          shipment_id: shipment.id,
        },
        payment_intent: shipment.stripe_payment_intent_id,
        reason: "requested_by_customer",
      },
      { idempotencyKey: attempt.idempotency_key },
    );
    const { error } = await admin.rpc("apply_shipment_payment_event", {
      p_billing_attempt_id: attempt.id,
      p_brand_id: shipment.brand_id,
      p_decline_code: null,
      p_decline_reason: null,
      p_event_created_at: new Date().toISOString(),
      p_metadata: {
        automatic: true,
        recovery: true,
      },
      p_organization_id: shipment.organization_id,
      p_shipment_id: shipment.id,
      p_status: "refunded",
      p_stripe_charge_id: shipment.stripe_charge_id,
      p_stripe_event_id: null,
      p_stripe_refund_id: refund.id,
    });
    if (error) {
      throw databaseError(
        "The recovered refund succeeded but its local ledger did not update.",
      );
    }
    return "refunded";
  } catch (error) {
    if (isRetryableStripeRecoveryError(error)) return "retry";
    await applyRefundRecoveryFailure(
      admin,
      attempt,
      shipment,
      safeStripeRecoveryErrorCode(error),
    );
    return "failed";
  }
}

async function chargeSystemShipment(
  env: WorkerEnv,
  admin: SupabaseClient,
  stripe: Stripe,
  shipment: ShipmentPaymentRow,
  options: {
    attemptId?: string;
    attemptKind: "charge" | "retry";
    idempotencyKey: string;
  },
): Promise<"charged" | "declined"> {
  assertStripeBillingAuthority(env);
  const member = oneRelation(shipment.members);
  if (
    !member ||
    member.organization_id !== shipment.organization_id ||
    member.brand_id !== shipment.brand_id
  ) {
    throw new AppError(403, "forbidden", "Scheduled shipment tenant validation failed.");
  }
  await assertBrandOperationalAccess(
    admin,
    shipment.organization_id,
    shipment.brand_id,
  );
  const avalara = await prepareAvalaraTax(env, admin, shipment);
  let attemptId =
    options.attemptId ??
    (await attachSystemPaymentIntent(admin, shipment, {
      ...options,
      paymentIntentId: null,
    }));
  const payableAmount = payableShipmentAmount(shipment);
  if (payableAmount === 0) {
    await applySystemPaymentOutcome(admin, shipment, attemptId, {
      chargeId: null,
      declineCode: null,
      declineReason: null,
      paymentIntentId: null,
      status: "succeeded",
    });
    await finalizeAvalaraTax(admin, shipment, avalara, "commit");
    return "charged";
  }
  const paymentMethodId = await resolveStripePaymentMethod(stripe, admin, member);
  if (!member.stripe_customer_id || !paymentMethodId) {
    await applySystemPaymentOutcome(admin, shipment, attemptId, {
      chargeId: null,
      declineCode: "payment_method_missing",
      declineReason: "The member has no saved payment method.",
      paymentIntentId: null,
      status: "declined",
    });
    await finalizeAvalaraTax(admin, shipment, avalara, "void");
    return "declined";
  }

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: payableAmount,
        automatic_payment_methods: { enabled: true },
        confirm: true,
        currency: "usd",
        customer: member.stripe_customer_id,
        description: `Vinifera release ${shipment.release_id}`,
        metadata: {
          brand_id: shipment.brand_id,
          member_id: shipment.member_id,
          organization_id: shipment.organization_id,
          release_id: shipment.release_id,
          shipment_id: shipment.id,
        },
        off_session: true,
        payment_method: paymentMethodId,
      },
      { idempotencyKey: options.idempotencyKey },
    );
  } catch (error) {
    if (!(error instanceof Stripe.errors.StripeCardError)) {
      await finalizeAvalaraTax(admin, shipment, avalara, "void").catch(
        () => undefined,
      );
      throw new AppError(
        502,
        "upstream_error",
        "Stripe could not confirm a scheduled shipment payment.",
      );
    }
    const paymentIntentId = error.payment_intent?.id ?? null;
    attemptId = await attachSystemPaymentIntent(admin, shipment, {
      ...options,
      attemptId,
      paymentIntentId,
    });
    await applySystemPaymentOutcome(admin, shipment, attemptId, {
      chargeId: null,
      declineCode: paymentDeclineReason(error),
      declineReason: error.message,
      paymentIntentId,
      status: "declined",
    });
    await finalizeAvalaraTax(admin, shipment, avalara, "void");
    return "declined";
  }
  attemptId = await attachSystemPaymentIntent(admin, shipment, {
    ...options,
    attemptId,
    paymentIntentId: paymentIntent.id,
  });
  const chargeId =
    typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id ?? null;
  if (paymentIntent.status !== "succeeded") {
    await applySystemPaymentOutcome(admin, shipment, attemptId, {
      chargeId,
      declineCode:
        paymentIntent.last_payment_error?.decline_code ?? paymentIntent.status,
      declineReason:
        paymentIntent.last_payment_error?.message ??
        "Stripe did not complete the payment.",
      paymentIntentId: paymentIntent.id,
      status: "declined",
    });
    await finalizeAvalaraTax(admin, shipment, avalara, "void");
    return "declined";
  }
  await applySystemPaymentOutcome(admin, shipment, attemptId, {
    chargeId,
    declineCode: null,
    declineReason: null,
    paymentIntentId: paymentIntent.id,
    status: "succeeded",
  });
  await finalizeAvalaraTax(admin, shipment, avalara, "commit");
  return "charged";
}

function scheduledBackoff(asOf: Date): string {
  return new Date(asOf.getTime() + 15 * 60 * 1_000).toISOString();
}

async function requeueSystemAttempt(
  admin: SupabaseClient,
  attemptId: string,
  shipmentId: string,
  asOf: Date,
): Promise<void> {
  const retryAt = scheduledBackoff(asOf);
  const [{ error: attemptError }, { error: shipmentError }] = await Promise.all([
    admin
      .from("billing_attempts")
      .update({
        scheduled_for: retryAt,
        started_at: null,
        status: "queued",
      })
      .eq("id", attemptId)
      .eq("status", "processing"),
    admin
      .from("shipments")
      .update({ next_retry_at: retryAt })
      .eq("id", shipmentId)
      .eq("status", "declined"),
  ]);
  if (attemptError || shipmentError) {
    throw databaseError("The scheduled payment attempt could not be requeued.");
  }
}

export async function resumeProcessingReleaseShipments(
  releases: ProcessingReleaseRow[],
  createShipments: (release: ProcessingReleaseRow) => Promise<void>,
): Promise<number> {
  let failed = 0;
  for (const release of releases) {
    try {
      await createShipments(release);
    } catch {
      failed += 1;
    }
  }
  return failed;
}

export async function executeScheduledRetry(
  retry: ScheduledRetryRow,
  charge: () => Promise<"charged" | "declined">,
  requeue: (retry: ScheduledRetryRow) => Promise<void>,
): Promise<"charged" | "declined" | "failed"> {
  try {
    return await charge();
  } catch {
    await requeue(retry);
    return "failed";
  }
}

export async function runCoreClubSchedule(
  env: WorkerEnv,
  asOf = new Date(),
): Promise<CoreClubScheduleReport> {
  assertStripeBillingAuthority(env);
  const admin = createAdminClient(env);
  const stripe = createStripe(env);
  const report: CoreClubScheduleReport = {
    charged: 0,
    claimedReleases: 0,
    declined: 0,
    failed: 0,
    memberSideEffectFailures: 0,
    memberSideEffects: 0,
    recoveredAttempts: 0,
    refundsRecovered: 0,
    retryAttempts: 0,
  };
  const sideEffects = await processMemberSideEffects(
    admin,
    stripe,
    asOf,
  );
  report.memberSideEffects = sideEffects.processed;
  report.memberSideEffectFailures = sideEffects.failed;
  report.failed += sideEffects.failed;
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_due_releases",
    {
      p_as_of: asOf.toISOString().slice(0, 10),
      p_limit: 25,
    },
  );
  if (claimError) throw databaseError("Due releases could not be claimed.");
  const claimedReleases = (claimed ?? []) as Array<{
    organization_id: string;
    release_id: string;
  }>;
  report.claimedReleases = claimedReleases.length;
  const { data: processingReleases, error: processingReleaseError } = await admin
    .from("releases")
    .select("id,organization_id,brand_id")
    .eq("status", "processing")
    .lte("processing_date", asOf.toISOString().slice(0, 10))
    .limit(100);
  if (processingReleaseError) {
    throw databaseError("Processing releases could not be resumed.");
  }
  report.failed += await resumeProcessingReleaseShipments(
    (processingReleases ?? []) as ProcessingReleaseRow[],
    async (release) => {
      const { error } = await admin.rpc("create_release_shipments", {
        p_actor_user_id: null,
        p_brand_id: release.brand_id,
        p_organization_id: release.organization_id,
        p_release_id: release.id,
      });
      if (error) {
        console.error(
          JSON.stringify({
            code: "upstream_error",
            event: "release.schedule_shipment_creation_failed",
            organizationId: release.organization_id,
            releaseId: release.id,
          }),
        );
        throw databaseError("Release shipments could not be resumed.");
      }
    },
  );

  // Include all resumable pending shipments from processing releases, not just
  // this invocation's claims, so a transient Stripe failure is retried safely.
  const { data: pending, error: pendingError } = await admin
    .from("shipments")
    .select(
      "id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id),releases!inner(status)",
    )
    .eq("status", "pending")
    .eq("releases.status", "processing")
    .limit(500);
  if (pendingError) throw databaseError("Scheduled release shipments could not be loaded.");
  const initialResults = await mapConcurrent(
    (pending ?? []) as ShipmentPaymentRow[],
    5,
    async (shipment) => {
      try {
        return await chargeSystemShipment(env, admin, stripe, shipment, {
          attemptKind: "charge",
          idempotencyKey: paymentIdempotencyKey(
            shipment,
            "release_processing",
          ),
        });
      } catch {
        return "failed" as const;
      }
    },
  );
  report.charged += initialResults.filter((result) => result === "charged").length;
  report.declined += initialResults.filter((result) => result === "declined").length;
  report.failed += initialResults.filter((result) => result === "failed").length;

  const { data: processingAttempts, error: processingAttemptsError } = await admin
    .from("billing_attempts")
    .select(
      "id,idempotency_key,attempt_kind,status,shipments!inner(id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id))",
    )
    .in("attempt_kind", ["charge", "retry"])
    .in("status", ["processing", "queued"])
    .lte("scheduled_for", asOf.toISOString())
    .limit(100);
  if (processingAttemptsError) {
    throw databaseError("In-flight billing attempts could not be recovered.");
  }
  const recoveryResults = await mapConcurrent(
    (processingAttempts ?? []) as ProcessingAttemptRow[],
    5,
    async (attempt) => {
      const shipment = oneRelation(attempt.shipments);
      if (!shipment) return "failed" as const;
      try {
        if (attempt.status === "queued") {
          const { data: claimedAttempt, error: claimAttemptError } = await admin
            .from("billing_attempts")
            .update({ started_at: asOf.toISOString(), status: "processing" })
            .eq("id", attempt.id)
            .eq("status", "queued")
            .select("id")
            .maybeSingle();
          if (claimAttemptError || !claimedAttempt) return "skipped" as const;
        }
        return await chargeSystemShipment(env, admin, stripe, shipment, {
          attemptId: attempt.id,
          attemptKind: attempt.attempt_kind,
          idempotencyKey: attempt.idempotency_key,
        });
      } catch {
        if (attempt.attempt_kind === "retry") {
          await requeueSystemAttempt(admin, attempt.id, shipment.id, asOf).catch(
            () => undefined,
          );
        }
        return "failed" as const;
      }
    },
  );
  report.recoveredAttempts = recoveryResults.length;
  report.charged += recoveryResults.filter((result) => result === "charged").length;
  report.declined += recoveryResults.filter(
    (result) => result === "declined",
  ).length;
  report.failed += recoveryResults.filter((result) => result === "failed").length;

  const { data: refundClaims, error: refundClaimsError } = await admin.rpc(
    "claim_stale_refund_attempts",
    {
      p_as_of: asOf.toISOString(),
      p_lease_seconds: 300,
      p_limit: 100,
      p_stale_seconds: 300,
      p_worker_id: `core-club-refund:${asOf.toISOString()}`,
    },
  );
  if (refundClaimsError) {
    throw databaseError("Stale refund attempts could not be claimed.");
  }
  const claimedRefunds = (refundClaims ?? []) as RefundRecoveryClaimRow[];
  const refundLeaseByAttempt = new Map(
    claimedRefunds.map((claim) => [
      claim.billing_attempt_id,
      claim.lease_token,
    ]),
  );
  let processingRefunds: ProcessingRefundAttemptRow[] = [];
  if (claimedRefunds.length > 0) {
    const { data, error } = await admin
      .from("billing_attempts")
      .select(
        "id,amount_cents,idempotency_key,metadata,shipments!inner(id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,stripe_charge_id)",
      )
      .in(
        "id",
        claimedRefunds.map((claim) => claim.billing_attempt_id),
      )
      .eq("attempt_kind", "refund")
      .eq("status", "processing");
    if (error) {
      throw databaseError("Claimed refund attempts could not be loaded.");
    }
    processingRefunds = ((data ?? []) as Omit<
      ProcessingRefundAttemptRow,
      "recovery_lease_token"
    >[]).map((attempt) => ({
      ...attempt,
      recovery_lease_token:
        refundLeaseByAttempt.get(attempt.id) ?? "",
    }));
  }
  const refundRecoveryResults = await mapConcurrent(
    processingRefunds,
    5,
    async (attempt) => {
      let outcome: "failed" | "refunded" | "retry";
      try {
        outcome = await recoverRefundAttempt(admin, stripe, attempt);
      } catch {
        outcome = "retry";
      }
      const { error } = await admin.rpc(
        "complete_refund_recovery_claim",
        {
          p_billing_attempt_id: attempt.id,
          p_error_code:
            outcome === "retry" ? "RECOVERY_RETRY_REQUIRED" : null,
          p_lease_token: attempt.recovery_lease_token,
          p_retry: outcome === "retry",
        },
      );
      if (error) {
        throw databaseError("A refund recovery lease could not be finalized.");
      }
      return outcome;
    },
  );
  report.recoveredAttempts += refundRecoveryResults.length;
  report.refundsRecovered += refundRecoveryResults.filter(
    (result) => result === "refunded",
  ).length;
  report.failed += refundRecoveryResults.filter(
    (result) => result !== "refunded",
  ).length;

  const { data: retries, error: retryError } = await admin.rpc(
    "schedule_due_shipment_retries",
    {
      p_as_of: asOf.toISOString(),
      p_limit: 100,
    },
  );
  if (retryError) throw databaseError("Due shipment retries could not be claimed.");
  const retryRows = (retries ?? []) as ScheduledRetryRow[];
  report.retryAttempts = retryRows.length;
  const retryResults = await mapConcurrent(retryRows, 5, async (retry) =>
    executeScheduledRetry(
      retry,
      async () => {
        if (!retry.brand_id) {
          throw databaseError("The claimed retry is missing its brand scope.");
        }
        const { data, error } = await admin
          .from("shipments")
          .select(
            "id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,brand_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id)",
          )
          .eq("id", retry.shipment_id)
          .eq("organization_id", retry.organization_id)
          .eq("brand_id", retry.brand_id)
          .maybeSingle();
        if (error || !data) {
          throw databaseError("The claimed retry shipment could not be loaded.");
        }
        return chargeSystemShipment(env, admin, stripe, data as ShipmentPaymentRow, {
          attemptId: retry.billing_attempt_id,
          attemptKind: "retry",
          idempotencyKey: `auto-retry:${retry.shipment_id}:${retry.attempt_number}`,
        });
      },
      async () => {
        await requeueSystemAttempt(
          admin,
          retry.billing_attempt_id,
          retry.shipment_id,
          asOf,
        );
      },
    ),
  );
  report.charged += retryResults.filter((result) => result === "charged").length;
  report.declined += retryResults.filter((result) => result === "declined").length;
  report.failed += retryResults.filter((result) => result === "failed").length;
  console.info(JSON.stringify({ event: "core_club.schedule_completed", ...report }));
  return report;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value === undefined) return;
      results[index] = await operation(value);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}
