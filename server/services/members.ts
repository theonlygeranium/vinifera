import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import {
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
import {
  readMemberBrandContextCookie,
  verifyMemberBrandContext,
} from "../lib/member-brand-context";
import {
  mobileAccessSessionId,
  verifyMobileAccessTokenForOrganization,
} from "../integrations/mobile-auth";
import type {
  ClubTierInput,
  CsvMapping,
  CsvPreviewInput,
  MemberInput,
  MemberPrincipal,
  MemberStatus,
  PlanTier,
  PostalAddress,
  ReleaseInput,
  ShipmentStatus,
  StaffPrincipal,
  StaffRole,
  WorkerEnv,
} from "../types";
import { createShippingProvider } from "./easypost";

const STAFF_COOKIE = "vinifera-staff-auth";
const MEMBER_COOKIE = "vinifera-member-auth";
const CSV_MAX_BYTES = 5 * 1024 * 1024;
const CSV_MAX_ROWS = 1_000;

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

export interface MemberRow {
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

export interface ShipmentLabelRow extends ShipmentPaymentRow {
  club_tier_id?: string;
  shipping_address?: Record<string, unknown>;
  shipment_items?: Array<Record<string, unknown>>;
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

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function createAdminClient(env: WorkerEnv): SupabaseClient {
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

export function databaseError(message: string): AppError {
  return new AppError(500, "upstream_error", message);
}

export function commandError(
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

export function commandResult(value: unknown): Record<string, unknown> {
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

export function toPublicRecord(value: unknown): Record<string, unknown> {
  return (toPublicValue(value) ?? {}) as Record<string, unknown>;
}

export function rpcRecord(value: unknown): Record<string, unknown> {
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

export function toPublicTier(value: unknown): Record<string, unknown> {
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

export function toPublicRelease(value: unknown): Record<string, unknown> {
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

export function toPublicShipment(value: unknown): Record<string, unknown> {
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

export function tierToDatabase(input: Partial<ClubTierInput>): Record<string, unknown> {
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

export function releaseToDatabase(input: Partial<ReleaseInput>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.description !== undefined) payload.description = input.description;
  if (input.embargoDate !== undefined) payload.embargo_date = input.embargoDate;
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.processingDate !== undefined) {
    payload.processing_date = input.processingDate;
  }
  return payload;
}

export function oneRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
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

export function getAddress(value: unknown): PostalAddress | null {
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

export class CoreClubMemberService {
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
