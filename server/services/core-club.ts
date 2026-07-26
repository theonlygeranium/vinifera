import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import Stripe from "stripe";
import { isProduction } from "../config";
import { assertStaffRole } from "../lib/authorization";
import { AppError, requireConfigured } from "../lib/errors";
import type {
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
  ReleaseStatus,
  ShipmentStatus,
  StaffPrincipal,
  StaffRole,
  WorkerEnv,
} from "../types";

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
  id: string;
  name: string;
  plan_tier: PlanTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
}

interface MemberRow {
  auth_user_id?: string | null;
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

interface ShipmentPaymentRow {
  charge_amount_cents: number;
  id: string;
  member_id: string;
  loyalty_discount_cents?: number;
  loyalty_redemption_id?: string | null;
  organization_id: string;
  release_id: string;
  retry_count: number;
  status: ShipmentStatus;
  stripe_payment_intent_id?: string | null;
  members?: MemberRow | MemberRow[] | null;
}

interface ShipmentLabelRow extends ShipmentPaymentRow {
  club_tier_id?: string;
  shipping_address?: Record<string, unknown>;
  shipment_items?: Array<Record<string, unknown>>;
}

interface CsvRow {
  rowNumber: number;
  values: Record<string, string>;
}

interface NormalizedCsvMember {
  clubTierName: string | null;
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

export interface ShippingProvider {
  createLabel(input: LabelRequest): Promise<LabelResult>;
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
  const cookieName = surface === "staff" ? STAFF_COOKIE : MEMBER_COOKIE;

  return createServerClient(url, publicKey, {
    auth: { flowType: "pkce" },
    cookieOptions: {
      name: cookieName,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isProduction(env),
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
              secure: isProduction(env),
            }),
          );
        }
      },
    },
  });
}

function createStripe(env: WorkerEnv): Stripe {
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

function databaseError(message: string): AppError {
  return new AppError(500, "upstream_error", message);
}

function camelKey(value: string): string {
  return value.replace(/_([a-z])/g, (_match, character: string) =>
    character.toUpperCase(),
  );
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
  return {
    address: getAddress(row.shipping_address),
    carrier: row.carrier,
    chargeAmountCents: row.charge_amount_cents,
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
    payableAmountCents: Math.max(
      0,
      Number(row.charge_amount_cents ?? 0) -
        Number(row.loyalty_discount_cents ?? 0),
    ),
    releaseId: row.release_id,
    releaseName: release?.name ?? "",
    retryCount: row.retry_count,
    status: row.status,
    tierName: releaseTier?.tier_name,
    trackingNumber: row.tracking_number,
    updatedAt: row.updated_at,
  };
}

function assertUuid(value: string, entity: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new AppError(400, "invalid_request", `${entity} id is invalid.`);
  }
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

function assertShippingCompliance(env: WorkerEnv, address: PostalAddress): void {
  if (address.country.toUpperCase() !== "US") {
    throw new AppError(
      409,
      "conflict",
      "International alcohol shipments require a compliance integration.",
    );
  }
  if (!allowedStates(env).has(address.state.toUpperCase())) {
    throw new AppError(
      409,
      "conflict",
      `Shipping alcohol to ${address.state.toUpperCase()} is not enabled for this winery.`,
    );
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
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

  async createLabel(input: LabelRequest): Promise<LabelResult> {
    const hash = await sha256(JSON.stringify(input));
    return {
      carrier: "SIMULATED",
      labelId: `simlabel_${hash.slice(0, 18)}`,
      labelUrl: `https://example.invalid/labels/${hash.slice(0, 24)}.pdf`,
      providerReference: `simshipment_${hash.slice(0, 18)}`,
      rateId: `simrate_${hash.slice(0, 18)}`,
      rateCents: 1_595,
      service: "Ground",
      trackingNumber: `1ZSIM${deterministicDigits(hash, 12)}`,
    };
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
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://api.easypost.com/v2${path}`, {
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

  async createLabel(input: LabelRequest): Promise<LabelResult> {
    const shipment = await this.request<EasyPostShipment>("/shipments", {
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
      shipment.lowest_rate ??
      [...(shipment.rates ?? [])].sort(
        (left, right) => Number(left.rate ?? Infinity) - Number(right.rate ?? Infinity),
      )[0];
    if (!shipment.id || !rate?.id) {
      throw new AppError(502, "upstream_error", "No carrier rate is available.");
    }
    const purchased = await this.request<EasyPostShipment>(
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
    clubTierName: valueFor(row, mapping.clubTier) || null,
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
  clubTier: "club_tier",
  club_tier: "club_tier",
  country: "shipping_country_code",
  email: "email",
  firstName: "first_name",
  first_name: "first_name",
  joinDate: "joined_on",
  joined_on: "joined_on",
  lastName: "last_name",
  last_name: "last_name",
  line1: "shipping_address_line1",
  line2: "shipping_address_line2",
  phone: "phone",
  postalCode: "shipping_postal_code",
  shipping_address_line1: "shipping_address_line1",
  shipping_address_line2: "shipping_address_line2",
  shipping_city: "shipping_city",
  shipping_country_code: "shipping_country_code",
  shipping_postal_code: "shipping_postal_code",
  shipping_region: "shipping_region",
  state: "shipping_region",
  status: "status",
};

function importTargetDatabaseKey(target: string): string {
  return IMPORT_TARGET_KEYS[target] ?? target;
}

function normalizedMemberToDatabase(
  member: NormalizedCsvMember,
): Record<string, unknown> {
  return {
    club_tier: member.clubTierName,
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

function escapeCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
    const { error } = await admin
      .from("members")
      .update({ stripe_payment_method_id: paymentMethodId })
      .eq("id", member.id)
      .eq("organization_id", member.organization_id);
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

function payableShipmentAmount(shipment: ShipmentPaymentRow): number {
  return Math.max(
    0,
    shipment.charge_amount_cents - Number(shipment.loyalty_discount_cents ?? 0),
  );
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

  protected async requireStaff(roles?: StaffRole[]): Promise<StaffPrincipal> {
    const client = createSurfaceClient(
      this.env,
      this.request,
      this.response,
      "staff",
    );
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
        "id,name,plan_tier,stripe_customer_id,stripe_subscription_id,subscription_status,access_status",
      )
      .eq("id", staff.organization_id)
      .single();
    if (organizationError || !organizationData) throw authFailure();
    const organization = organizationData as OrganizationRow;
    const principal: StaffPrincipal = {
      access: {
        graceEndsAt: null,
        state: organization.access_status,
        suspendedAt: null,
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
    if (principal.access?.state === "suspended") {
      throw new AppError(403, "forbidden", "This winery account is suspended.");
    }
    return principal;
  }

  protected async requireMember(): Promise<MemberPrincipal> {
    const client = createSurfaceClient(
      this.env,
      this.request,
      this.response,
      "member",
    );
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) throw authFailure();
    const { data: memberData, error: memberError } = await client
      .from("members")
      .select("id,organization_id,email,first_name,last_name,status")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();
    if (memberError || !memberData) throw authFailure();
    const member = memberData as MemberRow;
    const { data: organization, error: organizationError } = await client
      .from("organizations")
      .select("id,name")
      .eq("id", member.organization_id)
      .single();
    if (organizationError || !organization) throw authFailure();
    return {
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
    const { error } = await this.admin.rpc("append_audit_entry", {
      p_action: action,
      p_entity_id: entityId,
      p_entity_type: entityType,
      p_metadata: metadata,
      p_organization_id: organizationId,
      p_user_id: principal.user.id,
    });
    if (error) throw databaseError("The audit entry could not be persisted.");
  }

  protected organizationId(principal: StaffPrincipal): string {
    if (!principal.organization) throw authFailure();
    return principal.organization.id;
  }

  async listClubTiers(): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const { data, error } = await this.admin
      .from("club_tiers")
      .select("*,members(count)")
      .eq("organization_id", organizationId)
      .order("created_at");
    if (error) throw databaseError("Club tiers could not be loaded.");
    return (data ?? []).map(toPublicTier);
  }

  async createClubTier(input: ClubTierInput): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    if (input.upgradePathId) {
      await this.assertTenantEntity(
        "club_tiers",
        input.upgradePathId,
        organizationId,
        "Upgrade tier",
      );
    }
    const { data, error } = await this.admin
      .from("club_tiers")
      .insert({ ...tierToDatabase(input), organization_id: organizationId })
      .select("*")
      .single();
    if (error || !data) {
      throw new AppError(409, "conflict", "The club tier could not be created.");
    }
    await this.audit(principal, "club_tier.created", "club_tier", data.id, {
      frequency: input.frequency,
      price_cents: input.priceCents,
    });
    return toPublicTier(data);
  }

  async updateClubTier(
    tierId: string,
    input: Partial<ClubTierInput>,
  ): Promise<Record<string, unknown>> {
    assertUuid(tierId, "Club tier");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    if (input.upgradePathId === tierId) {
      throw new AppError(400, "invalid_request", "A tier cannot upgrade to itself.");
    }
    if (input.upgradePathId) {
      await this.assertTenantEntity(
        "club_tiers",
        input.upgradePathId,
        organizationId,
        "Upgrade tier",
      );
    }
    const { data, error } = await this.admin
      .from("club_tiers")
      .update(tierToDatabase(input))
      .eq("id", tierId)
      .eq("organization_id", organizationId)
      .select("*")
      .maybeSingle();
    if (error) throw databaseError("The club tier could not be updated.");
    if (!data) throw new AppError(404, "not_found", "Club tier not found.");
    await this.audit(principal, "club_tier.updated", "club_tier", tierId, {
      changed_fields: Object.keys(input),
    });
    return toPublicTier(data);
  }

  async deleteClubTier(tierId: string): Promise<void> {
    assertUuid(tierId, "Club tier");
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const { count } = await this.admin
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("club_tier_id", tierId);
    if ((count ?? 0) > 0) {
      throw new AppError(
        409,
        "conflict",
        "Move members to another tier before deleting this tier.",
      );
    }
    const { data, error } = await this.admin
      .from("club_tiers")
      .delete()
      .eq("id", tierId)
      .eq("organization_id", organizationId)
      .select("id")
      .maybeSingle();
    if (error) throw new AppError(409, "conflict", "The club tier is in use.");
    if (!data) throw new AppError(404, "not_found", "Club tier not found.");
    await this.audit(principal, "club_tier.deleted", "club_tier", tierId);
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
    let query = this.admin
      .from("members")
      .select(
        "*,club_tiers(id,name),shipments(charge_amount_cents,status,created_at)",
        { count: "exact" },
      )
      .eq("organization_id", organizationId);
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
    const { data, error } = await this.admin
      .from("members")
      .select(
        "*,club_tiers(id,name),shipments(id,status,charge_amount_cents,tracking_number,carrier,created_at,shipment_items(id,wine_name,quantity,price_cents),releases(name,processing_date))",
      )
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw databaseError("The member could not be loaded.");
    if (!data) throw new AppError(404, "not_found", "Member not found.");
    return toPublicMember(data);
  }

  async createMember(input: MemberInput): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    if (input.clubTierId) {
      await this.assertTenantEntity(
        "club_tiers",
        input.clubTierId,
        organizationId,
        "Club tier",
      );
    }
    if (input.referredByMemberId) {
      await this.assertTenantEntity(
        "members",
        input.referredByMemberId,
        organizationId,
        "Referring member",
      );
    }
    let stripeCustomerId: string | null = null;
    if (this.env.STRIPE_SECRET_KEY) {
      const customer = await createStripe(this.env).customers.create(
        {
          address: input.shippingAddress
            ? {
                city: input.shippingAddress.city,
                country: input.shippingAddress.country,
                line1: input.shippingAddress.line1,
                line2: input.shippingAddress.line2 ?? undefined,
                postal_code: input.shippingAddress.postalCode,
                state: input.shippingAddress.state,
              }
            : undefined,
          email: normalizeEmail(input.email),
          metadata: { organization_id: organizationId },
          name: `${input.firstName.trim()} ${input.lastName.trim()}`,
          phone: input.phone ?? undefined,
        },
        { idempotencyKey: `member:${organizationId}:${normalizeEmail(input.email)}` },
      );
      stripeCustomerId = customer.id;
    }
    const { data, error } = await this.admin
      .from("members")
      .insert({
        ...memberToDatabase(input),
        organization_id: organizationId,
        stripe_customer_id: stripeCustomerId,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new AppError(409, "conflict", "A member with this email already exists.");
    }
    await this.audit(principal, "member.created", "member", data.id, {
      club_tier_id: input.clubTierId ?? null,
      stripe_customer_created: Boolean(stripeCustomerId),
    });
    return toPublicMember(data);
  }

  async updateMember(
    memberId: string,
    input: Partial<MemberInput>,
  ): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    if (input.clubTierId) {
      await this.assertTenantEntity(
        "club_tiers",
        input.clubTierId,
        organizationId,
        "Club tier",
      );
    }
    if (input.referredByMemberId === memberId) {
      throw new AppError(
        400,
        "invalid_request",
        "A member cannot refer themselves.",
      );
    }
    if (input.referredByMemberId) {
      await this.assertTenantEntity(
        "members",
        input.referredByMemberId,
        organizationId,
        "Referring member",
      );
    }
    const { data, error } = await this.admin
      .from("members")
      .update(memberToDatabase(input))
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .select("*")
      .maybeSingle();
    if (error) throw new AppError(409, "conflict", "The member could not be updated.");
    if (!data) throw new AppError(404, "not_found", "Member not found.");
    if (data.stripe_customer_id && this.env.STRIPE_SECRET_KEY) {
      await createStripe(this.env).customers.update(data.stripe_customer_id, {
        address: input.shippingAddress
          ? {
              city: input.shippingAddress.city,
              country: input.shippingAddress.country,
              line1: input.shippingAddress.line1,
              line2: input.shippingAddress.line2 ?? undefined,
              postal_code: input.shippingAddress.postalCode,
              state: input.shippingAddress.state,
            }
          : undefined,
        email: input.email ? normalizeEmail(input.email) : undefined,
        name:
          input.firstName || input.lastName
            ? `${data.first_name} ${data.last_name}`
            : undefined,
        phone: input.phone === null ? "" : input.phone,
      });
    }
    await this.audit(principal, "member.updated", "member", memberId, {
      changed_fields: Object.keys(input),
    });
    return toPublicMember(data);
  }

  async deleteMember(memberId: string): Promise<void> {
    assertUuid(memberId, "Member");
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const { data: member, error: memberError } = await this.admin
      .from("members")
      .select("id,auth_user_id")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (memberError) throw databaseError("The member could not be loaded.");
    if (!member) throw new AppError(404, "not_found", "Member not found.");
    const { count, error: shipmentError } = await this.admin
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("member_id", memberId);
    if (shipmentError) throw databaseError("Member shipments could not be checked.");
    if ((count ?? 0) > 0) {
      throw new AppError(
        409,
        "conflict",
        "Members with shipment history must be cancelled instead of deleted.",
      );
    }
    await this.audit(principal, "member.deleted", "member", memberId);
    const { error } = await this.admin
      .from("members")
      .delete()
      .eq("id", memberId)
      .eq("organization_id", organizationId);
    if (error) throw databaseError("The member could not be deleted.");
    if (member.auth_user_id) {
      await this.admin.auth.admin
        .deleteUser(member.auth_user_id)
        .catch(() => undefined);
    }
  }

  async transitionMember(
    memberId: string,
    status: MemberStatus,
  ): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const { data: existing, error: existingError } = await this.admin
      .from("members")
      .select("id,status")
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (existingError) throw databaseError("The member could not be loaded.");
    if (!existing) throw new AppError(404, "not_found", "Member not found.");
    const allowed: Record<MemberStatus, MemberStatus[]> = {
      active: ["paused", "cancelled"],
      cancelled: ["active"],
      paused: ["active", "cancelled"],
    };
    if (existing.status !== status && !allowed[existing.status as MemberStatus].includes(status)) {
      throw new AppError(
        409,
        "conflict",
        `A ${existing.status} member cannot transition to ${status}.`,
      );
    }
    const { data, error } = await this.admin
      .from("members")
      .update({ status })
      .eq("id", memberId)
      .eq("organization_id", organizationId)
      .select("*")
      .single();
    if (error || !data) throw databaseError("The member status could not be updated.");
    await this.audit(principal, `member.${status}`, "member", memberId, {
      previous_status: existing.status,
    });
    return toPublicMember(data);
  }

  async batchMembers(input: {
    ids?: string[];
    operation: "pause" | "resume" | "cancel" | "assign_tier";
    tierId?: string;
  }): Promise<{ updated: number }> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    if (input.ids?.length && input.ids.length > 1_000) {
      throw new AppError(400, "invalid_request", "Batch operations are limited to 1,000 members.");
    }
    if (input.operation === "assign_tier") {
      if (!input.tierId) {
        throw new AppError(400, "invalid_request", "Choose a club tier.");
      }
      await this.assertTenantEntity(
        "club_tiers",
        input.tierId,
        organizationId,
        "Club tier",
      );
    }
    const updates =
      input.operation === "assign_tier"
        ? { club_tier_id: input.tierId }
        : {
            status:
              input.operation === "pause"
                ? "paused"
                : input.operation === "cancel"
                  ? "cancelled"
                  : "active",
          };
    let query = this.admin
      .from("members")
      .update(updates)
      .eq("organization_id", organizationId);
    if (input.ids?.length) query = query.in("id", input.ids);
    const { data, error } = await query.select("id");
    if (error) throw databaseError("The member batch operation failed.");
    await this.audit(
      principal,
      `member.batch.${input.operation}`,
      "organization",
      organizationId,
      { count: data?.length ?? 0, tier_id: input.tierId ?? null },
    );
    return { updated: data?.length ?? 0 };
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
    const lines = [headers.map(escapeCsvCell).join(",")];
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
          .map(escapeCsvCell)
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
    let query = this.admin
      .from("releases")
      .select(
        "*,release_tiers(*),release_wines(*,release_tier_items(quantity,unit_price_cents,release_tier_id)),shipments(status,charge_amount_cents)",
      )
      .eq("organization_id", organizationId);
    if (input.status) query = query.eq("status", input.status);
    if (input.from) query = query.gte("processing_date", input.from);
    if (input.to) query = query.lte("processing_date", input.to);
    const { data, error } = await query.order("processing_date", {
      ascending: false,
    });
    if (error) throw databaseError("Releases could not be loaded.");
    return (data ?? []).map(toPublicRelease);
  }

  async getRelease(releaseId: string): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const { data, error } = await this.admin
      .from("releases")
      .select(
        "*,release_tiers(*),release_wines(*,release_tier_items(quantity,unit_price_cents,release_tier_id)),shipments(*,members(id,first_name,last_name,email),shipment_items(*))",
      )
      .eq("id", releaseId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw databaseError("The release could not be loaded.");
    if (!data) throw new AppError(404, "not_found", "Release not found.");
    return toPublicRelease(data);
  }

  async createRelease(input: ReleaseInput): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    await this.assertReleaseTiers(input, organizationId);
    const { data: release, error: releaseError } = await this.admin
      .from("releases")
      .insert({
        ...releaseToDatabase(input),
        created_by: principal.user.id,
        organization_id: organizationId,
        status: "draft",
      })
      .select("*")
      .single();
    if (releaseError || !release) {
      throw new AppError(409, "conflict", "The release could not be created.");
    }
    try {
      await this.replaceReleaseChildren(release.id, organizationId, input);
      await this.audit(principal, "release.created", "release", release.id, {
        tier_count: input.tierIds.length,
        wine_count: input.wines.length,
      });
    } catch (error) {
      await this.admin
        .from("releases")
        .delete()
        .eq("id", release.id)
        .eq("organization_id", organizationId);
      throw error;
    }
    return this.getRelease(release.id);
  }

  async updateRelease(
    releaseId: string,
    input: Partial<ReleaseInput>,
  ): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const { data: existing, error: existingError } = await this.admin
      .from("releases")
      .select("id,status")
      .eq("id", releaseId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (existingError) throw databaseError("The release could not be loaded.");
    if (!existing) throw new AppError(404, "not_found", "Release not found.");
    if (existing.status !== "draft") {
      throw new AppError(
        409,
        "conflict",
        "Only draft releases can be edited; scheduled prices are immutable snapshots.",
      );
    }
    if (input.tierIds || input.tierPrices || input.wines) {
      const current = await this.getRelease(releaseId);
      const completeInput: ReleaseInput = {
        description:
          input.description ??
          (typeof current.description === "string" ? current.description : null),
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
        wines:
          input.wines ??
          (((current.wines as Array<Record<string, unknown>> | undefined) ?? [])
            .map((row) => ({
              priceCents: Number(row.priceCents),
              quantity: Number(row.quantity),
              wineName: String(row.wineName),
            }))),
      };
      await this.assertReleaseTiers(completeInput, organizationId);
      await this.replaceReleaseChildren(releaseId, organizationId, completeInput);
    }
    const { data, error } = await this.admin
      .from("releases")
      .update(releaseToDatabase(input))
      .eq("id", releaseId)
      .eq("organization_id", organizationId)
      .select("*")
      .single();
    if (error || !data) throw databaseError("The release could not be updated.");
    await this.audit(principal, "release.updated", "release", releaseId, {
      changed_fields: Object.keys(input),
    });
    return this.getRelease(releaseId);
  }

  async scheduleRelease(releaseId: string): Promise<Record<string, unknown>> {
    assertUuid(releaseId, "Release");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const { data, error } = await this.admin
      .from("releases")
      .update({ status: "scheduled" })
      .eq("id", releaseId)
      .eq("organization_id", organizationId)
      .eq("status", "draft")
      .select("*")
      .maybeSingle();
    if (error) throw databaseError("The release could not be scheduled.");
    if (!data) {
      throw new AppError(409, "conflict", "Only a draft release can be scheduled.");
    }
    await this.audit(principal, "release.scheduled", "release", releaseId, {
      processing_date: data.processing_date,
    });
    console.info(
      JSON.stringify({
        event: "release.notification.stub",
        organizationId,
        processingDate: data.processing_date,
        releaseId,
      }),
    );
    return this.getRelease(releaseId);
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
    const stripe = createStripe(this.env);
    const { data: processingRelease, error: processingError } = await this.admin
      .from("releases")
      .update({ status: "processing" })
      .eq("id", releaseId)
      .eq("organization_id", organizationId)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (processingError) throw databaseError("The release could not begin processing.");
    if (!processingRelease) {
      throw new AppError(
        409,
        "conflict",
        "Only a scheduled release can begin processing.",
      );
    }
    const { error: createError } = await this.admin.rpc("create_release_shipments", {
      p_actor_user_id: principal.user.id,
      p_organization_id: organizationId,
      p_release_id: releaseId,
    });
    if (createError) {
      await this.admin
        .from("releases")
        .update({ status: "scheduled" })
        .eq("id", releaseId)
        .eq("organization_id", organizationId)
        .eq("status", "processing");
      throw new AppError(
        createError.code === "23505" ? 409 : 500,
        createError.code === "23505" ? "conflict" : "upstream_error",
        "Release shipments could not be prepared.",
      );
    }
    const { data: shipments, error } = await this.admin
      .from("shipments")
      .select(
        "id,organization_id,member_id,release_id,status,charge_amount_cents,loyalty_discount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id)",
      )
      .eq("organization_id", organizationId)
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
    return summary;
  }

  async listRecoveryQueue(): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "*,members(id,first_name,last_name,email),releases(id,name),billing_attempts(*)",
      )
      .eq("organization_id", organizationId)
      .eq("status", "declined")
      .order("next_retry_date");
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
    let query = this.admin
      .from("shipments")
      .select(
        "id,member_id,release_id,status,shipping_address,tracking_number,carrier,charge_amount_cents,loyalty_discount_cents,decline_reason,retry_count,next_retry_at,created_at,updated_at,members(first_name,last_name,email),releases(name),release_tiers(tier_name),shipment_items(id,wine_name,quantity,price_cents)",
        { count: "exact" },
      )
      .eq("organization_id", organizationId);
    if (input.releaseId) query = query.eq("release_id", input.releaseId);
    if (input.status) query = query.eq("status", input.status);
    if (input.search) {
      const search = input.search.replaceAll("%", "\\%").replaceAll(",", "");
      const [{ data: members }, { data: releases }] = await Promise.all([
        this.admin
          .from("members")
          .select("id")
          .eq("organization_id", organizationId)
          .or(
            `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`,
          )
          .limit(100),
        this.admin
          .from("releases")
          .select("id")
          .eq("organization_id", organizationId)
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
    const shipment = await this.getPaymentShipment(
      shipmentId,
      organizationId,
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
  ): Promise<Record<string, unknown>> {
    assertUuid(shipmentId, "Shipment");
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const { data: shipment, error } = await this.admin
      .from("shipments")
      .select(
        "id,status,charge_amount_cents,loyalty_discount_cents,refund_amount_cents,stripe_payment_intent_id,stripe_charge_id",
      )
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw databaseError("The shipment could not be loaded.");
    if (!shipment) throw new AppError(404, "not_found", "Shipment not found.");
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
        Number(shipment.loyalty_discount_cents ?? 0),
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
    const idempotencyKey = `shipment:${shipmentId}:refund:${Number(
      shipment.refund_amount_cents ?? 0,
    )}:${refundAmount}`;
    const { data: attemptData, error: attemptError } = await this.admin.rpc(
      "record_billing_attempt",
      {
        p_actor_user_id: principal.user.id,
        p_amount_cents: refundAmount,
        p_attempt_kind: "refund",
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
    const refund = await createStripe(this.env).refunds.create(
      {
        amount: refundAmount,
        metadata: {
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
    const { error: applyError } = await this.admin.rpc(
      "apply_shipment_payment_event",
      {
        p_billing_attempt_id: billingAttemptId,
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

  async createMemberPaymentMethodPortal(): Promise<{ url: string }> {
    const principal = await this.requireMember();
    const { data: member, error } = await this.admin
      .from("members")
      .select("id,organization_id,email,first_name,last_name,stripe_customer_id")
      .eq("id", principal.user.id)
      .eq("organization_id", principal.organization.id)
      .single();
    if (error || !member) throw authFailure();
    const stripe = createStripe(this.env);
    let customerId = member.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: member.email,
          metadata: {
            member_id: member.id,
            organization_id: member.organization_id,
          },
          name: `${member.first_name} ${member.last_name}`,
        },
        { idempotencyKey: `member:${member.organization_id}:${member.id}` },
      );
      customerId = customer.id;
      const { error: updateError } = await this.admin
        .from("members")
        .update({ stripe_customer_id: customerId })
        .eq("id", member.id)
        .eq("organization_id", member.organization_id);
      if (updateError) {
        await stripe.customers.del(customerId).catch(() => undefined);
        throw databaseError("Member billing could not be initialized.");
      }
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      flow_data: { type: "payment_method_update" },
      return_url: `${this.coreApplicationOrigin()}/portal/payment-method`,
    });
    return { url: session.url };
  }

  async validateShippingAddress(
    address: PostalAddress,
  ): Promise<{ address: PostalAddress; messages: string[]; valid: boolean }> {
    assertShippingCompliance(this.env, address);
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
        "id,organization_id,member_id,release_id,status,shipping_address,charge_amount_cents,retry_count,members!inner(id,organization_id,email,first_name,last_name,phone),shipment_items(*)",
      )
      .eq("organization_id", organizationId)
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
          assertShippingCompliance(this.env, toAddress);
          const validation = await provider.validateAddress(toAddress);
          if (!validation.valid) {
            throw new AppError(
              409,
              "conflict",
              validation.messages.join(" ") || "The shipping address is invalid.",
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
          const label = await provider.createLabel({
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
          });
          const { error: transitionError } = await this.admin.rpc(
            "transition_shipment",
            {
              p_actor_user_id: principal.user.id,
              p_carrier: label.carrier,
              p_metadata: {
                address_validation_messages: validation.messages,
                address_validation_status: "valid",
                external_label_id: label.labelId,
                external_rate_id: label.rateId,
                external_shipment_id: label.providerReference,
                label_cost_cents: label.rateCents,
                label_format: "PDF",
                label_url: label.labelUrl,
                provider_metadata: { service: label.service },
                shipping_provider: this.env.SHIPPING_PROVIDER,
                validated_shipping_address: {
                  city: validation.address.city,
                  country_code: validation.address.country,
                  line1: validation.address.line1,
                  line2: validation.address.line2,
                  postal_code: validation.address.postalCode,
                  region: validation.address.state,
                },
              },
              p_organization_id: organizationId,
              p_shipment_id: shipment.id,
              p_target_status: "label_created",
              p_tracking_number: label.trackingNumber,
            },
          );
          if (transitionError) {
            throw databaseError("The shipment status could not be updated.");
          }
          return { label, shipmentId: shipment.id, success: true };
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
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "id,status,members(first_name,last_name),shipment_items(id,wine_name,quantity,packed_quantity,barcode)",
      )
      .eq("organization_id", organizationId)
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
    const parsed = parseCsv(input.contents);
    const mapping =
      input.mapping ??
      (input.format === "generic"
        ? inferGenericMapping(parsed.headers)
        : FORMAT_MAPPINGS[input.format]);
    const normalized = parsed.rows.map((row) => normalizeCsvMember(row, mapping));
    const validationErrors = normalized
      .map(validateCsvMember)
      .filter((error): error is CsvValidationError => Boolean(error));
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
    const dbMapping = Object.fromEntries(
      Object.entries(mapping)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([target, source]) => [importTargetDatabaseKey(target), source]),
    );
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
    if (!/^[0-9a-f-]{68}$/i.test(input.uploadToken)) {
      throw new AppError(400, "invalid_request", "The import token is invalid.");
    }
    const mapping = Object.fromEntries(
      Object.entries(input.mapping ?? {}).map(([sourceHeader, target]) => [
        importTargetDatabaseKey(target),
        sourceHeader,
      ]),
    );
    const { data, error } = await this.admin.rpc("complete_member_import", {
      p_actor_user_id: principal.user.id,
      p_column_mapping: mapping,
      p_organization_id: organizationId,
      p_upload_token: input.uploadToken,
    });
    if (error) {
      throw new AppError(
        error.code === "22023" || error.code === "P0002" ? 400 : 500,
        error.code === "22023" || error.code === "P0002"
          ? "invalid_request"
          : "upstream_error",
        error.code === "22023"
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
        "id,member_id,release_id,status,shipping_address,tracking_number,carrier,charge_amount_cents,loyalty_discount_cents,created_at,updated_at,releases(id,name,description,processing_date,embargo_date),shipment_items(id,wine_name,quantity,price_cents)",
      )
      .eq("organization_id", principal.organization.id)
      .eq("member_id", principal.user.id)
      .order("created_at", { ascending: false });
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
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireMember();
    const validation = await this.validateShippingAddress(address);
    if (!validation.valid) {
      throw new AppError(
        400,
        "invalid_request",
        validation.messages.join(" ") || "Enter a valid shipping address.",
      );
    }
    const { data, error } = await this.admin
      .from("members")
      .update({
        ...(addressToDatabase(validation.address) ?? {}),
        shipping_validated_at: new Date().toISOString(),
      })
      .eq("id", principal.user.id)
      .eq("organization_id", principal.organization.id)
      .select(
        "id,shipping_address_line1,shipping_address_line2,shipping_city,shipping_region,shipping_postal_code,shipping_country_code",
      )
      .single();
    if (error || !data) throw databaseError("The shipping address could not be updated.");
    return { id: data.id, address: toPublicMember(data).address };
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
    label: string,
  ): Promise<void> {
    assertUuid(id, label);
    const { data, error } = await this.admin
      .from(table)
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw databaseError(`${label} could not be validated.`);
    if (!data) throw new AppError(404, "not_found", `${label} not found.`);
  }

  private async assertReleaseTiers(
    input: ReleaseInput,
    organizationId: string,
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
      .in("id", input.tierIds);
    if (error) throw databaseError("Release tiers could not be validated.");
    if ((data ?? []).length !== uniqueTierIds.size) {
      throw new AppError(404, "not_found", "One or more club tiers were not found.");
    }
  }

  private async replaceReleaseChildren(
    releaseId: string,
    organizationId: string,
    input: ReleaseInput,
  ): Promise<void> {
    const tables = ["release_tier_items", "release_wines", "release_tiers"];
    for (const table of tables) {
      const { error } = await this.admin.from(table).delete().eq("release_id", releaseId);
      if (error) throw databaseError("Release details could not be replaced.");
    }
    const { data: releaseTiers, error: tiersError } = await this.admin
      .from("release_tiers")
      .insert(
        input.tierIds.map((tierId) => ({
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
        .eq("organization_id", organizationId);
      if (error) throw databaseError("Release tier pricing could not be saved.");
    }
    const { data: releaseWines, error: winesError } = await this.admin
      .from("release_wines")
      .insert(
        input.wines.map((wine) => ({
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
    requiredStatus: ShipmentStatus,
  ): Promise<ShipmentPaymentRow> {
    const { data, error } = await this.admin
      .from("shipments")
      .select(
        "id,organization_id,member_id,release_id,status,charge_amount_cents,loyalty_discount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id)",
      )
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
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
    if (!["pending", "declined"].includes(shipment.status)) return "skipped";
    const organizationId = this.organizationId(principal);
    const member = oneRelation(shipment.members);
    if (!member || member.organization_id !== organizationId) {
      throw new AppError(403, "forbidden", "Shipment tenant validation failed.");
    }
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
  billing_attempt_id: string;
  member_id: string;
  organization_id: string;
  shipment_id: string;
}

export interface ProcessingReleaseRow {
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

export interface CoreClubScheduleReport {
  charged: number;
  claimedReleases: number;
  declined: number;
  failed: number;
  recoveredAttempts: number;
  retryAttempts: number;
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

async function chargeSystemShipment(
  admin: SupabaseClient,
  stripe: Stripe,
  shipment: ShipmentPaymentRow,
  options: {
    attemptId?: string;
    attemptKind: "charge" | "retry";
    idempotencyKey: string;
  },
): Promise<"charged" | "declined"> {
  const member = oneRelation(shipment.members);
  if (!member || member.organization_id !== shipment.organization_id) {
    throw new AppError(403, "forbidden", "Scheduled shipment tenant validation failed.");
  }
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
    return "declined";
  }
  await applySystemPaymentOutcome(admin, shipment, attemptId, {
    chargeId,
    declineCode: null,
    declineReason: null,
    paymentIntentId: paymentIntent.id,
    status: "succeeded",
  });
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
  const admin = createAdminClient(env);
  const stripe = createStripe(env);
  const report: CoreClubScheduleReport = {
    charged: 0,
    claimedReleases: 0,
    declined: 0,
    failed: 0,
    recoveredAttempts: 0,
    retryAttempts: 0,
  };
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
    .select("id,organization_id")
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
      "id,organization_id,member_id,release_id,status,charge_amount_cents,loyalty_discount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id),releases!inner(status)",
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
        return await chargeSystemShipment(admin, stripe, shipment, {
          attemptKind: "charge",
          idempotencyKey: `shipment:${shipment.id}:scheduled-charge`,
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
      "id,idempotency_key,attempt_kind,status,shipments!inner(id,organization_id,member_id,release_id,status,charge_amount_cents,loyalty_discount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id))",
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
        return await chargeSystemShipment(admin, stripe, shipment, {
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
        const { data, error } = await admin
          .from("shipments")
          .select(
            "id,organization_id,member_id,release_id,status,charge_amount_cents,loyalty_discount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,members!inner(id,organization_id,email,first_name,last_name,status,stripe_customer_id,stripe_payment_method_id)",
          )
          .eq("id", retry.shipment_id)
          .eq("organization_id", retry.organization_id)
          .maybeSingle();
        if (error || !data) {
          throw databaseError("The claimed retry shipment could not be loaded.");
        }
        return chargeSystemShipment(admin, stripe, data as ShipmentPaymentRow, {
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
