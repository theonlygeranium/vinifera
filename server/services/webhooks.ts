import type { SupabaseClient } from "@supabase/supabase-js";
import mobileIdentity from "../../mobile/app-identity.json";
import { assertProviderEnvironment } from "../config";
import { AppError, requireConfigured } from "../lib/errors";
import {
  INTEGRATION_UUID_PATTERN,
  KLAVIYO_LIST_ID_PATTERN,
} from "../lib/integration-constants";
import { requireSecuritySecrets } from "../lib/security-secrets";
import { assertUuid, camelKey, sha256 } from "../lib/utils";
import type {
  IntegrationService,
  IntegrationType,
  StaffPrincipal,
  WorkerEnv,
} from "../types";
import { AvalaraClient, type AvalaraCredentials } from "../integrations/avalara";
import {
  CloudflareCustomHostnameClient,
  type CustomHostnameResult,
} from "../integrations/cloudflare-domains";
import {
  executeRetrySafeCustomHostnameDelete,
  type CustomHostnameDeleteClaim,
} from "../integrations/custom-hostname-deletes";
import {
  executeRetrySafeCustomHostnameWrite,
  type CustomHostnameWriteClaim,
} from "../integrations/custom-hostname-writes";
import {
  KlaviyoClient,
  parseKlaviyoWebhookBatch,
  verifyKlaviyoWebhook,
} from "../integrations/klaviyo";
import {
  exchangeQuickBooksAuthorizationCode,
  QuickBooksClient,
  quickBooksAuthorizationUrl,
} from "../integrations/quickbooks";
import {
  buildHashedMetaUserData,
  MetaConversionsClient,
  normalizeMetaBrowserData,
  normalizeMetaTestEventCode,
  type MetaBrowserData,
} from "../integrations/meta";
import {
  failedIntegrationJob,
  successfulIntegrationJob,
  type IntegrationJobCompletion,
} from "../integrations/jobs";
import {
  constantTimeEqual,
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  hmacSha256Hex,
  resolveExternalIntegrationCredentials,
  type EncryptedCredentialEnvelope,
} from "../integrations/security";
import { IntegrationProviderError } from "../integrations/http";
import { issueMobileAccessToken } from "../integrations/mobile-auth";
import {
  formatBrandSender,
  ResendDomainsClient,
} from "../integrations/resend-domains";
import { ProductionAnalyticsService } from "./analytics";
import {
  executeKlaviyoEngagement,
  executeKlaviyoProfiles,
} from "./comms";
import {
  databaseError,
  integrationAdmin,
  providerForJob,
  qboConfiguration,
  rpcRow,
  type ClaimedIntegrationJob,
} from "./integration-runtime";
import {
  prepareAvalaraTax,
  type ShipmentPaymentRow,
} from "./stripe";

const SAFE_FONT_FAMILIES = new Set([
  "Arial",
  "Georgia",
  "Inter",
  "Source Sans 3",
  "serif",
  "system-ui",
]);
const MOBILE_REDIRECT_URI =
  `${mobileIdentity.customScheme}://${mobileIdentity.mobileAuthRedirectPath.slice(1)}`;
const MOBILE_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const META_ATTRIBUTION_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1_000;
const META_ATTRIBUTION_QUERY_KEYS = new Set([
  "utm_campaign",
  "utm_id",
  "utm_medium",
  "utm_source",
]);

export interface MetaAttributionInput extends MetaBrowserData {
  campaignId?: string | null;
  campaignName?: string | null;
  eventSourceUrl: string;
  occurredAt: string;
  source?: string | null;
  medium?: string | null;
}

export interface NormalizedMetaAttribution {
  browserData: Record<"fbc" | "fbp", string | undefined>;
  campaignId: string | null;
  campaignName: string | null;
  eventSourceUrl: string;
  medium: string | null;
  occurredAt: string;
  source: string | null;
}

function normalizedAttributionText(
  value: string | null | undefined,
  maximum: number,
  label: string,
): string | null {
  const normalized = value?.normalize("NFKC").trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > maximum || /[\p{Cc}\p{Cf}<>]/u.test(normalized)) {
    throw new AppError(
      400,
      "invalid_request",
      `The Meta ${label} attribution value is invalid.`,
    );
  }
  return normalized;
}

export function normalizeMetaAttribution(
  input: MetaAttributionInput,
  allowedHostnames: string[],
  now = Date.now(),
): NormalizedMetaAttribution {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(input.eventSourceUrl);
  } catch {
    throw new AppError(
      400,
      "invalid_request",
      "The Meta event source URL is invalid.",
    );
  }
  const allowedHosts = new Set(
    allowedHostnames.map((hostname) => hostname.trim().toLowerCase()),
  );
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.username ||
    sourceUrl.password ||
    sourceUrl.port ||
    !allowedHosts.has(sourceUrl.hostname.toLowerCase())
  ) {
    throw new AppError(
      400,
      "invalid_request",
      "The Meta event source URL must be a first-party HTTPS page.",
    );
  }
  const occurredAtMs = Date.parse(input.occurredAt);
  if (
    !Number.isFinite(occurredAtMs) ||
    occurredAtMs > now + 5 * 60 * 1_000 ||
    occurredAtMs < now - META_ATTRIBUTION_LOOKBACK_MS
  ) {
    throw new AppError(
      400,
      "invalid_request",
      "The Meta attribution timestamp is invalid.",
    );
  }
  const safeQuery = new URLSearchParams();
  sourceUrl.hash = "";
  for (const [key, value] of sourceUrl.searchParams) {
    if (META_ATTRIBUTION_QUERY_KEYS.has(key) && value.length <= 200) {
      safeQuery.append(key, value);
    }
  }
  sourceUrl.search = safeQuery.toString();
  if (sourceUrl.toString().length > 2_048) {
    throw new AppError(
      400,
      "invalid_request",
      "The Meta event source URL is too long.",
    );
  }
  return {
    browserData: normalizeMetaBrowserData(input),
    campaignId: normalizedAttributionText(
      input.campaignId ?? sourceUrl.searchParams.get("utm_id"),
      120,
      "campaign ID",
    ),
    campaignName: normalizedAttributionText(
      input.campaignName ?? sourceUrl.searchParams.get("utm_campaign"),
      200,
      "campaign name",
    ),
    eventSourceUrl: sourceUrl.toString(),
    medium: normalizedAttributionText(
      input.medium ?? sourceUrl.searchParams.get("utm_medium"),
      120,
      "medium",
    ),
    occurredAt: new Date(occurredAtMs).toISOString(),
    source: normalizedAttributionText(
      input.source ?? sourceUrl.searchParams.get("utm_source"),
      120,
      "source",
    ),
  };
}

export function metaAttributionCustomData(
  customData: Record<string, string | number | boolean | null>,
  attribution: {
    campaign_id?: unknown;
    campaign_name?: unknown;
    medium?: unknown;
    source?: unknown;
  } | null,
): Record<string, string | number | boolean | null> {
  if (!attribution) return customData;
  const additions: Record<string, string> = {};
  for (const [sourceKey, targetKey] of [
    ["campaign_id", "campaign_id"],
    ["campaign_name", "campaign_name"],
    ["source", "utm_source"],
    ["medium", "utm_medium"],
  ] as const) {
    const value = attribution[sourceKey];
    if (typeof value === "string" && value) additions[targetKey] = value;
  }
  return { ...customData, ...additions };
}

export function normalizeMobileClubCode(value?: string): string | null {
  const normalized = value?.trim().toLocaleLowerCase("en-US") ?? "";
  if (!normalized) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new AppError(
      400,
      "invalid_request",
      "The wine club code is invalid.",
    );
  }
  return normalized;
}

export function uniqueMobileClubBrandId(
  brands: Array<{ id: unknown }>,
): string | null {
  if (!brands.length) return null;
  if (brands.length !== 1) {
    throw new AppError(
      409,
      "conflict",
      "This wine club code is ambiguous. Open the club's branded sign-in page or contact the club.",
    );
  }
  return String(brands[0]!.id);
}

interface IntegrationConnectionRow {
  brand_id: string | null;
  consented_at: string | null;
  id: string;
  integration_type: IntegrationType;
  last_error_at: string | null;
  last_error_code: string | null;
  last_synced_at: string | null;
  opted_in: boolean;
  status:
    | "activation_required"
    | "active"
    | "configured"
    | "degraded"
    | "disconnected";
  sync_config: Record<string, unknown>;
}

interface IntegrationRuntimeRow {
  brand_id: string | null;
  connection_id: string;
  credential_generation: number;
  credential_ciphertext: string | null;
  algorithm: "A256GCM" | null;
  credential_iv: string | null;
  envelope_version: 1 | null;
  external_account_id: string | null;
  external_secret_ref: string | null;
  integration_type: IntegrationType;
  key_version: string | null;
  organization_id: string;
  storage_mode: "encrypted_envelope" | "external_reference";
  sync_config: Record<string, unknown>;
}

function toRedactedPublicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toRedactedPublicValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          !/(?:access.?token|api.?key|ciphertext|credential|nonce|provider.?payload|refresh.?token|secret)/i.test(
            key,
          ),
      )
      .map(([key, nested]) => [camelKey(key), toRedactedPublicValue(nested)]),
  );
}

function toRedactedPublicRecord(value: unknown): Record<string, unknown> {
  return (toRedactedPublicValue(value) ?? {}) as Record<string, unknown>;
}

function hasSecretKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSecretKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) =>
      /(?:access.?token|api.?key|authorization|credential|license.?key|password|refresh.?token|secret)/i.test(
        key,
      ) || hasSecretKey(nested),
  );
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

const PROVIDER_MAPPING_ID = /^[A-Za-z0-9_.:-]{1,255}$/;
const KLAVIYO_PROPERTY = /^[A-Za-z_][A-Za-z0-9_.]{0,99}$/;
function configuredMappingValue(
  config: Record<string, unknown>,
  key: string,
  fallback: string,
  pattern: RegExp,
): string {
  const value =
    typeof config[key] === "string" ? config[key].trim() : fallback;
  if (!pattern.test(value)) {
    throw new AppError(
      400,
      "invalid_request",
      `The ${key} provider mapping is invalid.`,
    );
  }
  return value;
}

export function providerMappingsFromSyncConfig(
  type: IntegrationType,
  config: Record<string, unknown>,
): {
  accountMappings: Array<Record<string, unknown>>;
  fieldMappings: Array<Record<string, unknown>>;
  listMappings: Array<Record<string, unknown>>;
} {
  if (type === "klaviyo") {
    const email = configuredMappingValue(
      config,
      "memberEmailField",
      "email",
      KLAVIYO_PROPERTY,
    );
    const tier = configuredMappingValue(
      config,
      "memberTierField",
      "club_tier",
      KLAVIYO_PROPERTY,
    );
    const churn = configuredMappingValue(
      config,
      "churnRiskField",
      "churn_risk",
      KLAVIYO_PROPERTY,
    );
    const riskLevel = `${churn}_level`;
    if (!KLAVIYO_PROPERTY.test(riskLevel)) {
      throw new AppError(
        400,
        "invalid_request",
        "The churnRiskField provider mapping is too long.",
      );
    }
    const listId =
      typeof config.listId === "string" && config.listId.trim()
        ? config.listId.trim()
        : null;
    if (listId && !KLAVIYO_LIST_ID_PATTERN.test(listId)) {
      throw new AppError(
        400,
        "invalid_request",
        "The Klaviyo default member list ID is invalid.",
      );
    }
    return {
      accountMappings: [],
      fieldMappings: [
        ["email", email],
        ["first_name", "first_name"],
        ["last_name", "last_name"],
        ["club_tier_id", tier],
        ["joined_on", "joined_on"],
        ["lifetime_value_cents", "lifetime_value_cents"],
        ["membership_status", "membership_status"],
        ["churn_risk_score", churn],
        ["churn_risk_level", riskLevel],
        ["vinifera_deleted", "vinifera_deleted"],
      ].map(([vinifera_field, klaviyo_property]) => ({
        enabled: true,
        klaviyo_property,
        vinifera_field,
      })),
      listMappings: listId
        ? [
            {
              club_tier_id: null,
              enabled: true,
              list_id: listId,
              membership_status: null,
            },
          ]
        : [],
    };
  }
  if (type === "quickbooks") {
    const accountId = configuredMappingValue(
      config,
      "depositAccountRef",
      "",
      PROVIDER_MAPPING_ID,
    );
    const itemId = configuredMappingValue(
      config,
      "defaultItemRef",
      "",
      PROVIDER_MAPPING_ID,
    );
    return {
      accountMappings: ["membership", "shipping"].map((mapping_kind) => ({
        club_tier_id: null,
        mapping_kind,
        quickbooks_account_id: accountId,
        quickbooks_item_id: itemId,
      })),
      fieldMappings: [],
      listMappings: [],
    };
  }
  return {
    accountMappings: [],
    fieldMappings: [],
    listMappings: [],
  };
}

function hexToRgb(value: string): [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new AppError(
      400,
      "invalid_request",
      "Brand colors must use six-digit hexadecimal values.",
    );
  }
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function luminance(value: string): number {
  const channels = hexToRgb(value).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const left = luminance(foreground);
  const right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

const BRAND_TEXT_COLORS = ["#FFFFFF", "#1A0009"] as const;

export function evaluateThemeColor(background: string): {
  foreground: (typeof BRAND_TEXT_COLORS)[number];
  ratio: number;
} {
  const candidates = BRAND_TEXT_COLORS.map((foreground) => ({
    foreground,
    ratio: contrastRatio(foreground, background),
  }));
  return candidates[0]!.ratio >= candidates[1]!.ratio
    ? candidates[0]!
    : candidates[1]!;
}

function normalizedHttpsAssetUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function validatedTheme(
  input: Record<string, unknown>,
  current?: { primaryColor?: string; secondaryColor?: string },
): {
  contrast?: Record<string, number | boolean | string | null>;
  update: Record<string, unknown>;
} {
  const update: Record<string, unknown> = {};
  const fields = [
    ["name", "name"],
    ["description", "description"],
    ["logoUrl", "logo_url"],
    ["primaryColor", "primary_color"],
    ["secondaryColor", "secondary_color"],
    ["accentColor", "accent_color"],
    ["fontFamily", "font_family"],
    ["billingMode", "billing_mode"],
    ["portalTitle", "portal_title"],
  ] as const;
  for (const [publicName, databaseName] of fields) {
    if (publicName in input) update[databaseName] = input[publicName];
  }
  if (typeof update.logo_url === "string") {
    const logoUrl = normalizedHttpsAssetUrl(update.logo_url);
    if (!logoUrl) {
      throw new AppError(
        400,
        "invalid_request",
        "Brand logos must use an HTTPS URL without credentials or a custom port.",
      );
    }
    update.logo_url = logoUrl;
  } else if (update.logo_url !== undefined && update.logo_url !== null) {
    throw new AppError(
      400,
      "invalid_request",
      "Brand logos must use an HTTPS URL without credentials or a custom port.",
    );
  }
  if (
    typeof update.font_family === "string" &&
    !SAFE_FONT_FAMILIES.has(update.font_family)
  ) {
    throw new AppError(
      400,
      "invalid_request",
      "Choose an approved, safely hosted brand font.",
    );
  }
  const primary =
    typeof update.primary_color === "string"
      ? update.primary_color
      : current?.primaryColor ?? null;
  const secondary =
    typeof update.secondary_color === "string"
      ? update.secondary_color
      : current?.secondaryColor ?? null;
  if (!primary && !secondary) return { update };
  const primaryText = primary ? evaluateThemeColor(primary) : null;
  const secondaryText = secondary ? evaluateThemeColor(secondary) : null;
  const pair =
    primary && secondary ? contrastRatio(primary, secondary) : null;
  if (
    (primaryText !== null && primaryText.ratio < 4.5) ||
    (secondaryText !== null && secondaryText.ratio < 4.5)
  ) {
    throw new AppError(
      400,
      "invalid_request",
      "Brand colors must preserve WCAG 2.1 AA contrast of at least 4.5:1.",
    );
  }
  return {
    contrast: {
      normalTextPasses:
        (primaryText?.ratio ?? Number.POSITIVE_INFINITY) >= 4.5 &&
        (secondaryText?.ratio ?? Number.POSITIVE_INFINITY) >= 4.5,
      primaryForeground: primaryText?.foreground ?? null,
      primaryTextRatio: primaryText?.ratio ?? 0,
      secondaryForeground: secondaryText?.foreground ?? null,
      secondaryTextRatio: secondaryText?.ratio ?? 0,
      primaryOnSecondaryPasses: (pair ?? 0) >= 4.5,
      primaryOnSecondaryRatio: pair ?? 0,
    },
    update,
  };
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .split(/[+-]/, 1)[0]
      ?.split(".")
      .map((part) => Number(part)) ?? [];
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

async function oauthState(
  env: WorkerEnv,
  payload: Record<string, unknown>,
): Promise<string> {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = requireConfigured(
    env.QUICKBOOKS_STATE_SIGNING_SECRET,
    "QUICKBOOKS_STATE_SIGNING_SECRET",
  );
  const signature = await hmacSha256Hex(
    secret,
    Uint8Array.from(new TextEncoder().encode(encoded)),
  );
  return `${encoded}.${signature}`;
}

async function verifyOauthState(
  env: WorkerEnv,
  state: string,
): Promise<Record<string, unknown>> {
  const [encoded, signature, extra] = state.split(".");
  if (!encoded || !signature || extra) {
    throw new AppError(401, "unauthorized", "The OAuth state is invalid.");
  }
  const expected = await hmacSha256Hex(
    requireConfigured(
      env.QUICKBOOKS_STATE_SIGNING_SECRET,
      "QUICKBOOKS_STATE_SIGNING_SECRET",
    ),
    Uint8Array.from(new TextEncoder().encode(encoded)),
  );
  if (!constantTimeEqual(expected, signature)) {
    throw new AppError(401, "unauthorized", "The OAuth state is invalid.");
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new AppError(401, "unauthorized", "The OAuth state is invalid.");
  }
  if (
    typeof payload.expiresAt !== "string" ||
    Date.parse(payload.expiresAt) < Date.now()
  ) {
    throw new AppError(401, "unauthorized", "The OAuth state has expired.");
  }
  return payload;
}

function assertMobileRedirectUri(value: string): void {
  if (value !== MOBILE_REDIRECT_URI) {
    throw new AppError(
      400,
      "invalid_request",
      "The mobile authentication redirect is invalid.",
    );
  }
}

async function mobileAuthState(
  env: WorkerEnv,
  payload: Record<string, unknown>,
): Promise<string> {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = await hmacSha256Hex(
    requireConfigured(
      env.MOBILE_AUTH_STATE_SIGNING_SECRET,
      "MOBILE_AUTH_STATE_SIGNING_SECRET",
    ),
    Uint8Array.from(new TextEncoder().encode(encoded)),
  );
  return `${encoded}.${signature}`;
}

async function verifyMobileAuthState(
  env: WorkerEnv,
  state: string,
): Promise<Record<string, unknown>> {
  const [encoded, signature, extra] = state.split(".");
  if (!encoded || !signature || extra) {
    throw new AppError(401, "unauthorized", "The mobile sign-in state is invalid.");
  }
  const expected = await hmacSha256Hex(
    requireConfigured(
      env.MOBILE_AUTH_STATE_SIGNING_SECRET,
      "MOBILE_AUTH_STATE_SIGNING_SECRET",
    ),
    Uint8Array.from(new TextEncoder().encode(encoded)),
  );
  if (!constantTimeEqual(expected, signature)) {
    throw new AppError(401, "unauthorized", "The mobile sign-in state is invalid.");
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new AppError(401, "unauthorized", "The mobile sign-in state is invalid.");
  }
  if (
    typeof payload.expiresAt !== "string" ||
    Date.parse(payload.expiresAt) <= Date.now()
  ) {
    throw new AppError(401, "unauthorized", "The mobile sign-in state has expired.");
  }
  return payload;
}

function randomOpaqueToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString(
    "base64url",
  );
}

export async function portalBrandIdentity(row: Record<string, unknown>): Promise<{
  brandIdSha256: string;
  organizationIdSha256: string;
}> {
  const brandId = String(row.brand_id ?? "");
  const organizationId = String(row.organization_id ?? "");
  assertUuid(brandId, "Resolved brand");
  assertUuid(organizationId, "Resolved organization");
  return {
    brandIdSha256: await sha256(brandId),
    organizationIdSha256: await sha256(organizationId),
  };
}

export class ProductionIntegrationService
  extends ProductionAnalyticsService
  implements IntegrationService
{
  private customHostnameClient(): CloudflareCustomHostnameClient {
    return new CloudflareCustomHostnameClient({
      appEnvironment: this.env.APP_ENV,
      apiToken: requireConfigured(
        this.env.CLOUDFLARE_CUSTOM_HOSTNAME_API_TOKEN,
        "CLOUDFLARE_CUSTOM_HOSTNAME_API_TOKEN",
      ),
      fallbackOrigin: requireConfigured(
        this.env.CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN,
        "CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN",
      ),
      zoneId: requireConfigured(
        this.env.CLOUDFLARE_ZONE_ID,
        "CLOUDFLARE_ZONE_ID",
      ),
    });
  }

  private staffClient(): SupabaseClient {
    return this.authenticatedSurfaceClient("staff");
  }

  async getPortalBranding(hostname: string): Promise<Record<string, unknown>> {
    let normalized: string;
    try {
      normalized = new URL(`https://${hostname}`).hostname.toLowerCase();
    } catch {
      normalized = "";
    }
    if (
      !normalized ||
      normalized.length > 253 ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        normalized,
      )
    ) {
      return { brand: null, mode: "canonical" };
    }
    const canonical = this.env.APP_ORIGIN
      ? new URL(this.env.APP_ORIGIN).hostname.toLowerCase()
      : null;
    if (normalized === canonical) {
      return { brand: null, mode: "canonical" };
    }
    const { data, error } = await this.admin.rpc("resolve_custom_domain", {
      p_hostname: normalized,
    });
    if (error) throw databaseError("Portal branding could not be resolved.");
    const row = rpcRow(data);
    if (!row) return { brand: null, mode: "canonical" };
    const logoUrl = normalizedHttpsAssetUrl(row.logo_url);
    if (row.logo_url && !logoUrl) {
      return { brand: null, mode: "canonical" };
    }
    const primaryText =
      typeof row.primary_color === "string"
        ? evaluateThemeColor(row.primary_color)
        : null;
    const secondaryText =
      typeof row.secondary_color === "string"
        ? evaluateThemeColor(row.secondary_color)
        : null;
    if (
      !primaryText ||
      !secondaryText ||
      primaryText.ratio < 4.5 ||
      secondaryText.ratio < 4.5
    ) {
      return { brand: null, mode: "canonical" };
    }
    return {
      brand: {
        fontFamily: row.font_family,
        logoUrl,
        name: row.brand_name,
        portalTitle: row.portal_title ?? row.brand_name,
        primaryColor: row.primary_color,
        secondaryColor: row.secondary_color,
      },
      identity: await portalBrandIdentity(row),
      mode: "custom",
    };
  }

  private requestHostname(): string {
    const raw =
      this.request.get("x-forwarded-host")?.split(",")[0] ??
      this.request.get("host") ??
      "";
    try {
      return new URL(`https://${raw.trim()}`).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  private async activeMemberAttributionHostname(
    organizationId: string,
    brandId: string,
  ): Promise<string> {
    const hostname = this.requestHostname();
    if (!hostname) {
      throw new AppError(
        400,
        "invalid_request",
        "The first-party attribution host is invalid.",
      );
    }
    let canonical: string | null = null;
    try {
      canonical = this.env.APP_ORIGIN
        ? new URL(this.env.APP_ORIGIN).hostname.toLowerCase()
        : null;
    } catch {
      canonical = null;
    }
    if (canonical === hostname) return hostname;
    const { data, error } = await this.admin.rpc("resolve_custom_domain", {
      p_hostname: hostname,
    });
    const domain = rpcRow(data);
    if (
      error ||
      domain?.organization_id !== organizationId ||
      domain.brand_id !== brandId
    ) {
      throw new AppError(
        403,
        "forbidden",
        "Meta attribution can be captured only on an active brand host.",
      );
    }
    return hostname;
  }

  async getMemberMetaPrivacy(): Promise<Record<string, unknown>> {
    const principal = await this.requireMember();
    const memberClient = this.authenticatedSurfaceClient("member");
    const { data, error } = await memberClient
      .from("member_integration_consents")
      .select(
        "consent_source,consented,consented_at,policy_version,revoked_at,updated_at",
      )
      .eq("organization_id", principal.organization.id)
      .eq("brand_id", principal.brand.id)
      .eq("member_id", principal.user.id)
      .eq("integration_type", "meta")
      .maybeSingle();
    if (error) {
      throw databaseError("The member Meta privacy preference is unavailable.");
    }
    return {
      consentSource: data?.consent_source ?? null,
      consented: data ? Boolean(data.consented) : null,
      consentedAt: data?.consented_at ?? null,
      policyVersion: data?.policy_version ?? null,
      revokedAt: data?.revoked_at ?? null,
      updatedAt: data?.updated_at ?? null,
    };
  }

  async updateMemberMetaPrivacy(input: {
    attribution?: MetaAttributionInput;
    clientEventId?: string;
    consentSource: string;
    consented: boolean;
    policyVersion: string;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireMember();
    if (!input.consented && input.attribution) {
      throw new AppError(
        400,
        "invalid_request",
        "Attribution cannot be captured when Meta consent is declined.",
      );
    }
    let normalized: NormalizedMetaAttribution | null = null;
    let envelope: EncryptedCredentialEnvelope | null = null;
    let payloadHash: string | null = null;
    if (input.attribution) {
      if (!input.clientEventId) {
        throw new AppError(
          400,
          "invalid_request",
          "A client event ID is required for Meta attribution.",
        );
      }
      assertUuid(input.clientEventId, "Meta attribution event");
      const hostname = await this.activeMemberAttributionHostname(
        principal.organization.id,
        principal.brand.id,
      );
      normalized = normalizeMetaAttribution(input.attribution, [hostname]);
      const encryptedBrowserData = {
        fbc: normalized.browserData.fbc ?? null,
        fbp: normalized.browserData.fbp ?? null,
      };
      envelope = await encryptIntegrationCredentials(
        this.env,
        {
          integrationType: "meta_attribution",
          organizationId: principal.organization.id,
          targetId: input.clientEventId,
        },
        encryptedBrowserData,
      );
      payloadHash = await sha256(
        JSON.stringify({
          ...normalized,
          browserData: encryptedBrowserData,
        }),
      );
    }
    const memberClient = this.authenticatedSurfaceClient("member");
    const { error: consentError } = await memberClient.rpc(
      "set_member_meta_consent",
      {
        p_brand_id: principal.brand.id,
        p_consent_source: input.consentSource,
        p_consented: input.consented,
        p_member_id: principal.user.id,
        p_organization_id: principal.organization.id,
        p_policy_version: input.policyVersion,
      },
    );
    if (consentError) {
      throw databaseError("The member Meta privacy preference could not be saved.");
    }
    if (
      normalized &&
      envelope &&
      payloadHash &&
      input.clientEventId
    ) {
      const { error: captureError } = await this.admin.rpc(
        "store_meta_attribution_touchpoint",
        {
          p_algorithm: envelope.algorithm,
          p_brand_id: principal.brand.id,
          p_browser_data_ciphertext: envelope.ciphertext,
          p_browser_data_iv: envelope.iv,
          p_campaign_id: normalized.campaignId,
          p_campaign_name: normalized.campaignName,
          p_envelope_version: envelope.version,
          p_event_source_url: normalized.eventSourceUrl,
          p_id: input.clientEventId,
          p_key_version: envelope.keyVersion,
          p_medium: normalized.medium,
          p_member_id: principal.user.id,
          p_occurred_at: normalized.occurredAt,
          p_organization_id: principal.organization.id,
          p_payload_hash: payloadHash,
          p_source: normalized.source,
        },
      );
      if (captureError) {
        throw databaseError("The first-party Meta attribution could not be saved.");
      }
    }
    return {
      attributionCaptured: Boolean(normalized),
      attributionId: normalized ? input.clientEventId : null,
      consented: input.consented,
    };
  }

  async getMetaAttributionReport(input: {
    from?: string;
    to?: string;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const to = input.to ? new Date(input.to) : new Date();
    const from = input.from
      ? new Date(input.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1_000);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from > to
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "The Meta attribution report range is invalid.",
      );
    }
    const { data, error } = await this.staffClient().rpc(
      "get_meta_attribution_report",
      {
        p_brand_id: brandId,
        p_from: from.toISOString(),
        p_organization_id: organizationId,
        p_to: to.toISOString(),
      },
    );
    if (error) {
      throw databaseError("The Meta attribution report could not be loaded.");
    }
    return toRedactedPublicRecord(data);
  }

  protected async activeBrandId(
    principal: StaffPrincipal,
    supplied?: string | null,
    allowSuspended = false,
  ): Promise<string> {
    const header = this.request.get("x-vinifera-brand-id");
    if (!supplied && header === "all") {
      throw new AppError(
        400,
        "invalid_request",
        "This operation requires one active brand.",
      );
    }
    let candidate =
      supplied ?? (header && header !== "all" ? header.trim() : null);
    if (!candidate) {
      const { data, error } = await this.admin.rpc(
        "resolve_default_brand_id",
        { p_organization_id: this.organizationId(principal) },
      );
      if (error || !data) {
        throw databaseError("The default brand could not be resolved.");
      }
      candidate = String(data);
    }
    assertUuid(candidate, "Brand");
    const { data: brand, error: brandError } = await this.staffClient()
      .from("brands")
      .select("id,billing_mode,access_status")
      .eq("organization_id", this.organizationId(principal))
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

  private async assertAllBrandAccess(principal: StaffPrincipal): Promise<void> {
    const organizationId = this.organizationId(principal);
    const { data, error } = await this.staffClient()
      .from("organization_staff_access")
      .select("scope")
      .eq("organization_id", organizationId)
      .eq("staff_user_id", principal.user.id)
      .maybeSingle();
    if (
      error ||
      (principal.user.role !== "super_admin" &&
        (!data || data.scope !== "all_brands"))
    ) {
      throw new AppError(
        403,
        "forbidden",
        "All-brand analytics access is not available.",
      );
    }
  }

  private async connection(
    principal: StaffPrincipal,
    type: IntegrationType,
  ): Promise<IntegrationConnectionRow | null> {
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.staffClient()
      .from("integration_connections")
      .select(
        "id,brand_id,integration_type,status,opted_in,consented_at,sync_config,last_synced_at,last_error_code,last_error_at",
      )
      .eq("organization_id", this.organizationId(principal))
      .eq("brand_id", brandId)
      .eq("integration_type", type)
      .maybeSingle();
    if (error) throw databaseError("The integration connection could not be loaded.");
    return data as IntegrationConnectionRow | null;
  }

  private async storeCredentials(
    organizationId: string,
    connectionId: string,
    type: IntegrationType | "mobile_push_token" | "mobile_session",
    credentials: Record<string, unknown>,
    target: "integration" | "mobile" = "integration",
  ): Promise<EncryptedCredentialEnvelope> {
    const envelope = await encryptIntegrationCredentials(
      this.env,
      { integrationType: type, organizationId, targetId: connectionId },
      credentials,
    );
    if (target === "integration") {
      const { error } = await this.admin.rpc("store_integration_credentials", {
        p_algorithm: envelope.algorithm,
        p_connection_id: connectionId,
        p_credential_ciphertext: envelope.ciphertext,
        p_credential_iv: envelope.iv,
        p_envelope_version: envelope.version,
        p_external_secret_ref: null,
        p_key_version: envelope.keyVersion,
        p_storage_mode: "encrypted_envelope",
      });
      if (error) throw databaseError("The integration credentials could not be stored.");
    }
    return envelope;
  }

  private validateCredentials(
    type: IntegrationType,
    credentials: Record<string, unknown>,
    syncConfig: Record<string, unknown>,
  ): Record<string, unknown> {
    if (type === "klaviyo") {
      new KlaviyoClient(credentials as unknown as { apiKey: string });
      return credentials;
    } else if (type === "avalara") {
      const environment = syncConfig.environment;
      if (environment !== "sandbox" && environment !== "production") {
        throw new AppError(
          400,
          "invalid_request",
          "Choose the Avalara sandbox or production environment.",
        );
      }
      assertProviderEnvironment(this.env, "Avalara", environment);
      const normalized = {
        accountId: syncConfig.accountId,
        baseUrl:
          environment === "production"
            ? "https://rest.avatax.com"
            : "https://sandbox-rest.avatax.com",
        companyCode: syncConfig.companyCode,
        licenseKey: credentials.licenseKey,
      };
      new AvalaraClient(normalized as AvalaraCredentials);
      return normalized;
    } else if (type === "meta") {
      const testEventCode = normalizeMetaTestEventCode(
        syncConfig.testEventCode,
        this.env.APP_ENV !== "production",
      );
      const normalized = {
        accessToken: credentials.accessToken,
        apiVersion: syncConfig.graphApiVersion,
        pixelId: syncConfig.pixelId,
        testEventCode,
      };
      new MetaConversionsClient(
        normalized as unknown as {
          accessToken: string;
          apiVersion: string;
          pixelId: string;
          testEventCode: string | null;
        },
      );
      return normalized;
    } else {
      throw new AppError(
        400,
        "invalid_request",
        "Connect QuickBooks through its OAuth authorization flow.",
      );
    }
  }

  private async persistProviderMappings(
    type: IntegrationType,
    connectionId: string,
    syncConfig: Record<string, unknown>,
  ): Promise<void> {
    const mappings = providerMappingsFromSyncConfig(type, syncConfig);
    if (type === "klaviyo") {
      const { error } = await this.admin.rpc("replace_klaviyo_mappings", {
        p_connection_id: connectionId,
        p_field_mappings: mappings.fieldMappings,
        p_list_mappings: mappings.listMappings,
      });
      if (error) {
        throw databaseError("The Klaviyo field and list mappings could not be saved.");
      }
    } else if (type === "quickbooks") {
      const { error } = await this.admin.rpc(
        "replace_quickbooks_account_mappings",
        {
          p_connection_id: connectionId,
          p_mappings: mappings.accountMappings,
        },
      );
      if (error) {
        throw databaseError("The QuickBooks account mappings could not be saved.");
      }
    }
  }

  async listIntegrations(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const organizationId = this.organizationId(principal);
    const { data: connections, error } = await this.staffClient()
      .from("integration_connections")
      .select(
        "id,brand_id,integration_type,status,opted_in,consented_at,sync_config,last_synced_at,last_error_code,last_error_at",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId);
    if (error) throw databaseError("Integration health could not be loaded.");
    const connectionIds = (connections ?? []).map((row) => row.id);
    const { data: secrets, error: secretsError } = connectionIds.length
      ? await this.admin
          .from("integration_secrets")
          .select("connection_id")
          .in("connection_id", connectionIds)
      : { data: [], error: null };
    if (secretsError) throw databaseError("Integration activation could not be loaded.");
    const configured = new Set((secrets ?? []).map((row) => row.connection_id));
    const rows = new Map(
      ((connections ?? []) as IntegrationConnectionRow[]).map((row) => [
        row.integration_type,
        row,
      ]),
    );
    const items = (
      ["klaviyo", "quickbooks", "avalara", "meta"] as IntegrationType[]
    ).map((type) => {
      const row = rows.get(type);
      const hasCredentials = row ? configured.has(row.id) : false;
      const status =
        !row || (!hasCredentials && row.status !== "disconnected")
          ? "activation_required"
          : row.status === "disconnected"
            ? "disconnected"
            : row.status;
      return {
        capabilities:
          type === "klaviyo"
            ? ["profiles", "lists", "engagement"]
            : type === "quickbooks"
              ? ["sales_receipts", "refunds", "reconciliation"]
              : type === "avalara"
                ? ["tax_calculation", "audit", "liability"]
                : ["conversions", "deduplication", "consent"],
        consentedAt: row?.consented_at ?? null,
        lastErrorCode: row?.last_error_code?.toLowerCase() ?? null,
        lastSuccessAt:
          row?.last_synced_at && !row.last_error_code
            ? row.last_synced_at
            : null,
        lastSyncAt: row?.last_synced_at ?? null,
        optedIn: row?.opted_in ?? false,
        status,
        syncConfig: row?.sync_config ?? {},
        type,
      };
    });
    return {
      health: {
        activationRequired: items.filter(
          (item) => item.status === "activation_required",
        ).length,
        active: items.filter((item) => item.status === "active").length,
        degraded: items.filter((item) =>
          ["degraded", "error"].includes(item.status),
        ).length,
      },
      items,
    };
  }

  async connectIntegration(
    type: IntegrationType,
    input: {
      brandId?: string | null;
      consentConfirmed: boolean;
      credentials?: Record<string, unknown>;
      optedIn: boolean;
      syncConfig?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal, input.brandId);
    if (input.optedIn && !input.consentConfirmed) {
      throw new AppError(
        400,
        "invalid_request",
        "Explicit consent confirmation is required before enabling an integration.",
      );
    }
    const config = { ...(input.syncConfig ?? {}) };
    if (type === "meta") {
      config.testEventCode = normalizeMetaTestEventCode(
        config.testEventCode,
        input.optedIn && this.env.APP_ENV !== "production",
      );
    }
    if (type === "avalara" && config.environment === "production") {
      assertProviderEnvironment(this.env, "Avalara", "production");
    }
    if (hasSecretKey(config) || byteLength(config) > 32_768) {
      throw new AppError(
        400,
        "invalid_request",
        "Integration configuration cannot contain credentials or exceed 32 KB.",
      );
    }
    const { data: configured, error } = await this.staffClient().rpc(
      "configure_integration_connection",
      {
        p_brand_id: brandId,
        p_display_name: null,
        p_external_account_id: null,
        p_integration_type: type,
        p_organization_id: organizationId,
        p_sync_config: config,
      },
    );
    if (error) throw databaseError("The integration connection could not be configured.");
    const row = rpcRow(configured);
    const connectionId = String(row?.id ?? "");
    assertUuid(connectionId, "Integration connection");
    await this.persistProviderMappings(type, connectionId, config);
    if (input.credentials && Object.keys(input.credentials).length) {
      const credentials = this.validateCredentials(
        type,
        input.credentials,
        config,
      );
      await this.storeCredentials(
        organizationId,
        connectionId,
        type,
        credentials,
      );
    }
    const { data: consent, error: consentError } = await this.staffClient().rpc(
      "set_integration_consent",
      {
        p_connection_id: connectionId,
        p_opted_in: input.optedIn,
      },
    );
    if (consentError) throw databaseError("The integration consent could not be saved.");
    if (
      input.optedIn &&
      input.credentials &&
      Object.keys(input.credentials).length
    ) {
      const { error: validationError } = await this.admin.rpc(
        "enqueue_integration_sync_job",
        {
          p_connection_id: connectionId,
          p_cursor_data: {},
          p_direction: "outbound",
          p_entity_id: connectionId,
          p_entity_type: "connection",
          p_idempotency_key: `validate:${connectionId}:${crypto.randomUUID()}`,
          p_max_attempts: 8,
          p_payload: {},
          p_sync_type: "connection.validate",
        },
      );
      if (validationError) {
        throw databaseError("The integration validation could not be queued.");
      }
    }
    await this.audit(principal, "integration.connected", "integration", connectionId, {
      brand_id: brandId,
      integration_type: type,
      credentials_configured: Boolean(input.credentials),
      opted_in: input.optedIn,
    });
    return toRedactedPublicRecord(rpcRow(consent) ?? {});
  }

  async updateIntegration(
    type: IntegrationType,
    input: {
      consentConfirmed?: boolean;
      credentials?: Record<string, unknown>;
      optedIn?: boolean;
      syncConfig?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin"]);
    const existing = await this.connection(principal, type);
    if (!existing) throw new AppError(404, "not_found", "Integration not found.");
    if (input.optedIn && input.consentConfirmed !== true) {
      throw new AppError(
        400,
        "invalid_request",
        "Explicit consent confirmation is required before enabling an integration.",
      );
    }
    const effectiveSyncConfig = {
      ...existing.sync_config,
      ...input.syncConfig,
    };
    if (type === "meta") {
      effectiveSyncConfig.testEventCode = normalizeMetaTestEventCode(
        effectiveSyncConfig.testEventCode,
        (input.optedIn ?? existing.opted_in) &&
          this.env.APP_ENV !== "production",
      );
    }
    if (input.syncConfig) {
      if (
        type === "avalara" &&
        effectiveSyncConfig.environment === "production"
      ) {
        assertProviderEnvironment(this.env, "Avalara", "production");
      }
      if (
        hasSecretKey(effectiveSyncConfig) ||
        byteLength(effectiveSyncConfig) > 32_768
      ) {
        throw new AppError(400, "invalid_request", "Integration configuration is unsafe.");
      }
      const { error } = await this.staffClient().rpc(
        "configure_integration_connection",
        {
          p_brand_id: existing.brand_id,
          p_display_name: null,
          p_external_account_id: null,
          p_integration_type: type,
          p_organization_id: this.organizationId(principal),
          p_sync_config: effectiveSyncConfig,
        },
      );
      if (error) throw databaseError("The integration configuration could not be updated.");
      await this.persistProviderMappings(
        type,
        existing.id,
        effectiveSyncConfig,
      );
    }
    if (input.credentials && Object.keys(input.credentials).length) {
      const credentials = this.validateCredentials(
        type,
        input.credentials,
        effectiveSyncConfig,
      );
      await this.storeCredentials(
        this.organizationId(principal),
        existing.id,
        type,
        credentials,
      );
    }
    if (input.optedIn !== undefined) {
      const { error } = await this.staffClient().rpc(
        "set_integration_consent",
        {
          p_connection_id: existing.id,
          p_opted_in: input.optedIn,
        },
      );
      if (error) throw databaseError("The integration consent could not be updated.");
    }
    const refreshed = await this.connection(principal, type);
    return toRedactedPublicRecord(refreshed ?? {});
  }

  async disconnectIntegration(type: IntegrationType): Promise<void> {
    const principal = await this.requireStaff(["owner", "admin"]);
    const existing = await this.connection(principal, type);
    if (!existing) return;
    const { error } = await this.staffClient().rpc("disconnect_integration", {
      p_connection_id: existing.id,
    });
    if (error) throw databaseError("The integration could not be disconnected.");
    await this.audit(principal, "integration.disconnected", "integration", existing.id, {
      integration_type: type,
    });
  }

  async queueIntegrationSync(
    type: IntegrationType,
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const existing = await this.connection(principal, type);
    if (
      !existing ||
      !["active", "configured", "degraded"].includes(existing.status) ||
      !existing.opted_in
    ) {
      throw new AppError(
        503,
        "activation_required",
        "Connect and consent to this integration before synchronization.",
      );
    }
    const validation = existing.status !== "active";
    const syncType = validation
      ? "connection.validate"
      : type === "klaviyo"
        ? "profiles.full"
        : type === "quickbooks"
          ? "transactions.full"
          : type === "meta"
            ? "conversions.pending"
            : "tax.reconcile";
    const { data, error } = await this.admin.rpc(
      "enqueue_integration_sync_job",
      {
        p_connection_id: existing.id,
        p_cursor_data: {},
        p_direction: type === "klaviyo" ? "outbound" : "inbound",
        p_entity_id: existing.brand_id,
        p_entity_type: "brand",
        p_idempotency_key: `manual:${existing.id}:${crypto.randomUUID()}`,
        p_max_attempts: type === "klaviyo" ? 20 : 8,
        p_payload: {},
        p_sync_type: syncType,
      },
    );
    if (error) throw databaseError("The integration sync could not be queued.");
    return {
      jobId: data,
      status: "queued",
      syncType,
    };
  }

  async queueAvalaraFilingVerification(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const existing = await this.connection(principal, "avalara");
    if (
      !existing ||
      existing.status !== "active" ||
      !existing.opted_in
    ) {
      throw new AppError(
        503,
        "activation_required",
        "Activate and authorize Avalara before verifying filing status.",
      );
    }
    if (existing.sync_config.filingEnabled !== true) {
      throw new AppError(
        409,
        "conflict",
        "Enable Avalara filing verification before queueing a check.",
      );
    }
    const { data, error } = await this.admin.rpc(
      "enqueue_integration_sync_job",
      {
        p_connection_id: existing.id,
        p_cursor_data: {},
        p_direction: "inbound",
        p_entity_id: existing.brand_id,
        p_entity_type: "brand",
        p_idempotency_key:
          `manual-filing:${existing.id}:${crypto.randomUUID()}`,
        p_max_attempts: 8,
        p_payload: {},
        p_sync_type: "filing.verify",
      },
    );
    if (error) {
      throw databaseError("Avalara filing verification could not be queued.");
    }
    return {
      jobId: data,
      status: "queued",
      syncType: "filing.verify",
    };
  }

  async listIntegrationLogs(
    type: IntegrationType,
    limit: number,
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.staffClient()
      .from("integration_sync_logs")
      .select(
        "id,outcome,records_read,records_written,records_failed,error_code,duration_ms,created_at,integration_sync_jobs(sync_type,status)",
      )
      .eq("organization_id", this.organizationId(principal))
      .eq("brand_id", brandId)
      .eq("integration_type", type)
      .order("created_at", { ascending: false })
      .limit(Math.min(100, Math.max(1, limit)));
    if (error) throw databaseError("Integration logs could not be loaded.");
    return {
      items: (data ?? []).map((row) => {
        const job = Array.isArray(row.integration_sync_jobs)
          ? row.integration_sync_jobs[0]
          : row.integration_sync_jobs;
        const outcome = String(row.outcome);
        return {
          createdAt: row.created_at,
          errorCode:
            typeof row.error_code === "string"
              ? row.error_code.toLowerCase()
              : null,
          id: String(row.id),
          recordsFailed: Number(row.records_failed ?? 0),
          recordsSynced: Number(row.records_written ?? 0),
          status:
            outcome === "synced"
              ? "succeeded"
              : outcome === "dead_letter"
                ? "failed"
                : outcome,
          syncType:
            job && typeof job === "object" && "sync_type" in job
              ? String(job.sync_type)
              : "sync",
        };
      }),
    };
  }

  async getQuickBooksAuthorizationUrl(
    brandId?: string | null,
  ): Promise<{ url: string }> {
    const principal = await this.requireStaff(["owner", "admin"]);
    const selectedBrandId = await this.activeBrandId(principal, brandId);
    const organizationId = this.organizationId(principal);
    const { data: existing, error: existingError } = await this.staffClient()
      .from("integration_connections")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("brand_id", selectedBrandId)
      .eq("integration_type", "quickbooks")
      .maybeSingle();
    if (existingError) throw databaseError("The QuickBooks connection could not be loaded.");
    let connectionId = existing?.id ? String(existing.id) : "";
    if (!connectionId) {
      const { data: configured, error } = await this.staffClient().rpc(
        "configure_integration_connection",
        {
          p_brand_id: selectedBrandId,
          p_display_name: null,
          p_external_account_id: null,
          p_integration_type: "quickbooks",
          p_organization_id: organizationId,
          p_sync_config: {},
        },
      );
      if (error) throw databaseError("The QuickBooks connection could not be configured.");
      connectionId = String(rpcRow(configured)?.id ?? "");
    }
    assertUuid(connectionId, "Integration connection");
    const configuration = qboConfiguration(this.env);
    const nonce = crypto.randomUUID();
    const state = await oauthState(this.env, {
      brandId: selectedBrandId,
      connectionId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
      nonce,
        organizationId,
    });
    const { error: stateError } = await this.admin
      .from("integration_sync_jobs")
      .insert({
        brand_id: selectedBrandId,
        connection_id: connectionId,
        direction: "inbound",
        entity_id: connectionId,
        entity_type: "oauth",
        idempotency_key: `qbo-oauth:${await sha256(nonce)}`,
        integration_type: "quickbooks",
        max_attempts: 1,
        next_attempt_at: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
        organization_id: organizationId,
        payload: {},
        status: "queued",
        sync_type: "oauth.state",
      });
    if (stateError) throw databaseError("The QuickBooks OAuth state could not be registered.");
    return {
      url: quickBooksAuthorizationUrl({
        clientId: configuration.clientId,
        redirectUri: configuration.redirectUri,
        state,
      }),
    };
  }

  async completeQuickBooksOAuth(input: {
    code: string;
    realmId: string;
    state: string;
  }): Promise<{ connected: boolean; redirectPath: string }> {
    const state = await verifyOauthState(this.env, input.state);
    const connectionId = String(state.connectionId ?? "");
    const organizationId = String(state.organizationId ?? "");
    const nonce = String(state.nonce ?? "");
    assertUuid(connectionId, "Integration connection");
    assertUuid(organizationId, "Organization");
    assertUuid(nonce, "OAuth nonce");
    const { data: consumedState, error: stateError } = await this.admin
      .from("integration_sync_jobs")
      .update({
        completed_at: new Date().toISOString(),
        status: "completed",
      })
      .eq("connection_id", connectionId)
      .eq("idempotency_key", `qbo-oauth:${await sha256(nonce)}`)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (stateError || !consumedState) {
      throw new AppError(
        401,
        "unauthorized",
        "The OAuth state was already used or is invalid.",
      );
    }
    const { data: connection, error } = await this.admin
      .from("integration_connections")
      .select("id,organization_id,integration_type")
      .eq("id", connectionId)
      .eq("organization_id", organizationId)
      .eq("integration_type", "quickbooks")
      .maybeSingle();
    if (error || !connection) {
      throw new AppError(401, "unauthorized", "The OAuth state is invalid.");
    }
    const credentials = await exchangeQuickBooksAuthorizationCode({
      code: input.code,
      configuration: qboConfiguration(this.env),
      realmId: input.realmId,
    });
    await this.storeCredentials(
      organizationId,
      connectionId,
      "quickbooks",
      credentials as unknown as Record<string, unknown>,
    );
    const { error: updateError } = await this.admin
      .from("integration_connections")
      .update({
        external_account_id: input.realmId,
        opted_in: true,
        consented_at: new Date().toISOString(),
        status: "configured",
      })
      .eq("id", connectionId)
      .eq("organization_id", organizationId);
    if (updateError) throw databaseError("QuickBooks OAuth could not be finalized.");
    const { error: healthError } = await this.admin.rpc(
      "set_integration_health",
      {
        p_connection_id: connectionId,
        p_error_code: null,
        p_status: "active",
      },
    );
    if (healthError) throw databaseError("QuickBooks activation could not be finalized.");
    const { error: queueError } = await this.admin.rpc(
      "enqueue_integration_sync_job",
      {
        p_connection_id: connectionId,
        p_cursor_data: {},
        p_direction: "outbound",
        p_entity_id: String(state.brandId ?? ""),
        p_entity_type: "brand",
        p_idempotency_key: `qbo-initial:${connectionId}`,
        p_max_attempts: 8,
        p_payload: {},
        p_sync_type: "transactions.full",
      },
    );
    if (queueError) throw databaseError("The initial QuickBooks sync could not be queued.");
    return {
      connected: true,
      redirectPath: "/app/integrations?quickbooks=connected",
    };
  }

  async getQuickBooksReconciliation(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.staffClient()
      .from("quickbooks_reconciliations")
      .select(
        "id,period_start,period_end,vinifera_total_cents,quickbooks_total_cents,variance_cents,reconciled,reconciled_at",
      )
      .eq("organization_id", this.organizationId(principal))
      .eq("brand_id", brandId)
      .order("period_end", { ascending: false })
      .limit(24);
    if (error) throw databaseError("QuickBooks reconciliation could not be loaded.");
    return { items: toRedactedPublicValue(data ?? []) };
  }

  async getAvalaraLiability(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.staffClient()
      .from("avalara_tax_calculations")
      .select(
        "currency_code,tax_amount_cents,jurisdiction_summary,document_status,document_type,created_at",
      )
      .eq("organization_id", this.organizationId(principal))
      .eq("brand_id", brandId)
      .eq("document_status", "committed")
      .order("created_at", { ascending: false })
      .limit(5_000);
    if (error) throw databaseError("Avalara liability could not be loaded.");
    const byJurisdiction = new Map<string, number>();
    for (const row of data ?? []) {
      const direction = row.document_type === "ReturnInvoice" ? -1 : 1;
      for (const summary of Array.isArray(row.jurisdiction_summary)
        ? row.jurisdiction_summary
        : []) {
        if (!summary || typeof summary !== "object") continue;
        const jurisdiction = String(
          (summary as Record<string, unknown>).jurisdictionName ?? "Unknown",
        );
        byJurisdiction.set(
          jurisdiction,
          (byJurisdiction.get(jurisdiction) ?? 0) +
            direction *
              Number((summary as Record<string, unknown>).taxCents ?? 0),
        );
      }
    }
    return {
      byJurisdiction: [...byJurisdiction].map(([jurisdiction, taxCents]) => ({
        jurisdiction,
        taxCents,
      })),
      totalTaxCents: (data ?? []).reduce(
        (total, row) =>
          total +
          (row.document_type === "ReturnInvoice" ? -1 : 1) *
            Number(row.tax_amount_cents ?? 0),
        0,
      ),
    };
  }

  async getAvalaraFilingStatus(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const existing = await this.connection(principal, "avalara");
    if (!existing) {
      return {
        configured: false,
        enabled: false,
        registered: false,
        registrations: [],
        stale: true,
        staleRegistrationCount: 0,
        verifiedAt: null,
      };
    }
    const [{ data: snapshot, error: snapshotError }, { data: staleRows, error: staleError }] =
      await Promise.all([
        this.staffClient()
          .from("avalara_filing_verification_snapshots")
          .select(
            "id,registered,registration_count,response_hash,verified_at",
          )
          .eq("organization_id", this.organizationId(principal))
          .eq("brand_id", existing.brand_id)
          .eq("connection_id", existing.id)
          .order("verified_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        this.staffClient()
          .from("avalara_filing_registration_statuses")
          .select("id")
          .eq("organization_id", this.organizationId(principal))
          .eq("brand_id", existing.brand_id)
          .eq("connection_id", existing.id)
          .not("stale_at", "is", null),
      ]);
    if (snapshotError || staleError) {
      throw databaseError("Avalara filing verification could not be loaded.");
    }
    const { data: registrationRows, error: registrationError } = snapshot
      ? await this.staffClient()
          .from("avalara_filing_registration_statuses")
          .select(
            "filing_calendar_id,region_code,filing_frequency,registration_status,verified_at",
          )
          .eq("organization_id", this.organizationId(principal))
          .eq("brand_id", existing.brand_id)
          .eq("connection_id", existing.id)
          .eq("snapshot_id", snapshot.id)
          .is("stale_at", null)
          .order("region_code")
      : { data: [], error: null };
    if (registrationError) {
      throw databaseError("Avalara filing registrations could not be loaded.");
    }
    const verifiedAt =
      snapshot && typeof snapshot.verified_at === "string"
        ? snapshot.verified_at
        : null;
    const stale =
      !verifiedAt ||
      Date.parse(verifiedAt) < Date.now() - 36 * 60 * 60 * 1_000 ||
      Number(snapshot?.registration_count ?? 0) !==
        (registrationRows ?? []).length;
    return {
      configured: true,
      enabled: existing.sync_config.filingEnabled === true,
      registered: snapshot?.registered === true,
      registrations: (registrationRows ?? []).map((row) => ({
        filingCalendarId: Number(row.filing_calendar_id),
        filingFrequency: row.filing_frequency,
        regionCode: row.region_code,
        status: row.registration_status,
      })),
      stale,
      staleRegistrationCount: (staleRows ?? []).length,
      verifiedAt,
    };
  }

  async handleKlaviyoWebhook(
    integrationId: string,
    payload: Uint8Array,
    headers: {
      signature?: string;
      timestamp?: string;
      webhookId?: string;
    },
  ): Promise<{
    accepted: boolean;
    duplicates: number;
    ignored: number;
    processed: number;
    queued: number;
  }> {
    assertUuid(integrationId, "Integration");
    const { data: connection, error } = await this.admin
      .from("integration_connections")
      .select("id,organization_id,brand_id,integration_type,status,opted_in")
      .eq("id", integrationId)
      .eq("integration_type", "klaviyo")
      .eq("status", "active")
      .eq("opted_in", true)
      .maybeSingle();
    if (error || !connection) throw new AppError(404, "not_found", "Integration not found.");
    const runtime = await this.integrationRuntime(
      connection.organization_id,
      "klaviyo",
      connection.brand_id,
    );
    const credentials = await this.decryptRuntime<{
      apiKey: string;
      webhookSecret?: string;
    }>(runtime);
    await verifyKlaviyoWebhook({
      payload,
      secret: credentials.webhookSecret,
      signature: headers.signature,
      timestamp: headers.timestamp,
    });
    const parsed = parseKlaviyoWebhookBatch(payload, headers.webhookId);
    const counts = {
      duplicates: 0,
      ignored: parsed.ignored,
      processed: 0,
      queued: 0,
    };
    for (const event of parsed.events) {
      const {
        datetime: occurredAt,
        eventId,
        eventType,
        profileExternalId,
      } = event;
      const { data: mapping, error: mappingError } = await this.admin
        .from("klaviyo_profile_mappings")
        .select("member_id")
        .eq("connection_id", integrationId)
        .eq("brand_id", connection.brand_id)
        .eq("external_profile_id", profileExternalId)
        .maybeSingle();
      if (mappingError) {
        throw databaseError("The Klaviyo profile mapping could not be loaded.");
      }
      if (!mapping) {
        const { error: queueError } = await this.admin.rpc(
          "enqueue_integration_sync_job",
          {
            p_connection_id: integrationId,
            p_cursor_data: { providerEventId: eventId },
            p_direction: "inbound",
            p_entity_id: eventId,
            p_entity_type: "engagement_event",
            p_idempotency_key: `klaviyo-webhook:${eventId}`,
            p_max_attempts: 8,
            p_payload: {},
            p_sync_type: "engagement.poll",
          },
        );
        if (queueError) {
          throw databaseError("The Klaviyo webhook could not be queued.");
        }
        counts.queued += 1;
        continue;
      }
      const { data: inserted, error: insertError } = await this.admin
        .from("klaviyo_engagement_events")
        .upsert(
          {
            brand_id: connection.brand_id,
            connection_id: integrationId,
            event_type: eventType,
            member_id: mapping.member_id,
            metrics: {},
            occurred_at: occurredAt,
            organization_id: connection.organization_id,
            provider_event_id: eventId,
          },
          {
            ignoreDuplicates: true,
            onConflict: "connection_id,provider_event_id",
          },
        )
        .select("id");
      if (insertError) {
        throw databaseError("The Klaviyo engagement event could not be saved.");
      }
      if ((inserted ?? []).length) counts.processed += 1;
      else counts.duplicates += 1;
    }
    return { accepted: true, ...counts };
  }

  private async integrationRuntime(
    organizationId: string,
    type: IntegrationType,
    brandId: string | null,
  ): Promise<IntegrationRuntimeRow> {
    const { data, error } = await this.admin.rpc("get_integration_runtime", {
      p_brand_id: brandId,
      p_integration_type: type,
      p_organization_id: organizationId,
      p_include_credentials: true,
    });
    const row = rpcRow(data) as IntegrationRuntimeRow | null;
    if (error || !row) {
      throw new AppError(
        503,
        "activation_required",
        "The integration credentials are not connected.",
      );
    }
    return row;
  }

  private decryptRuntime<T>(row: IntegrationRuntimeRow): Promise<T> {
    if (row.storage_mode === "external_reference") {
      return Promise.resolve(
        resolveExternalIntegrationCredentials<T>(
          this.env,
          row.external_secret_ref,
        ),
      );
    }
    if (
      row.algorithm !== "A256GCM" ||
      row.envelope_version !== 1 ||
      !row.credential_ciphertext ||
      !row.credential_iv ||
      !row.key_version
    ) {
      throw new AppError(
        503,
        "activation_required",
        "The stored integration credential format is unsupported.",
      );
    }
    return decryptIntegrationCredentials<T>(
      this.env,
      {
        integrationType: row.integration_type,
        organizationId: row.organization_id,
        targetId: row.connection_id,
      },
      {
        algorithm: "A256GCM",
        ciphertext: row.credential_ciphertext,
        iv: row.credential_iv,
        keyVersion: row.key_version,
        version: 1,
      },
    );
  }

  async listBrands(): Promise<{
    canViewAllBrands: boolean;
    items: Array<Record<string, unknown>>;
  }> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const { data, error } = await this.staffClient()
      .from("brands")
      .select(
        "id,name,description,logo_url,primary_color,secondary_color,font_family,billing_mode,default_shipping_charge_cents,is_default,active,brand_custom_domains(hostname,status,certificate_expires_at),brand_sender_identities(from_name,from_email,status,updated_at)",
      )
      .eq("organization_id", organizationId)
      .eq("active", true)
      .order("name");
    if (error) throw databaseError("Brands could not be loaded.");
    const { data: access } = await this.staffClient()
      .from("organization_staff_access")
      .select("scope")
      .eq("organization_id", organizationId)
      .eq("staff_user_id", principal.user.id)
      .maybeSingle();
    return {
      canViewAllBrands:
        principal.user.role === "super_admin" ||
        access?.scope === "all_brands",
      items: (data ?? []).map((row) => {
        const domain = Array.isArray(row.brand_custom_domains)
          ? row.brand_custom_domains[0]
          : row.brand_custom_domains;
        const senderRows = Array.isArray(row.brand_sender_identities)
          ? row.brand_sender_identities
          : row.brand_sender_identities
            ? [row.brand_sender_identities]
            : [];
        const sender = senderRows
          .filter((identity) => identity.status !== "disabled")
          .sort(
            (left, right) =>
              Date.parse(String(right.updated_at ?? "")) -
              Date.parse(String(left.updated_at ?? "")),
          )[0];
        return {
          billingMode: row.billing_mode,
          customDomain: domain?.hostname ?? null,
          defaultShippingChargeCents: row.default_shipping_charge_cents,
          description: row.description || null,
          domainStatus:
            domain?.status === "active"
              ? "active"
              : domain?.status === "failed"
                ? "error"
                : domain
                  ? "pending_validation"
                  : "unconfigured",
          emailDomainStatus:
            sender?.status === "failed"
              ? "error"
              : (sender?.status ?? "unconfigured"),
          emailSenderAddress: sender?.from_email ?? null,
          emailSenderName: sender?.from_name ?? null,
          fontFamily: row.font_family,
          id: row.id,
          isDefault: row.is_default,
          logoUrl: row.logo_url,
          name: row.name,
          primaryColor: row.primary_color,
          secondaryColor: row.secondary_color,
          sslStatus:
            domain?.status === "active"
              ? "active"
              : domain?.status === "failed"
                ? "error"
                : domain
                  ? "pending"
                  : "unconfigured",
        };
      }),
    };
  }

  async createBrand(input: {
    billingMode: "independent" | "shared";
    defaultShippingChargeCents?: number;
    description?: string | null;
    name: string;
    slug: string;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const { data: created, error: createError } = await this.staffClient().rpc(
      "create_brand_with_profile",
      {
        p_billing_mode: input.billingMode,
        p_default_shipping_charge_cents: input.defaultShippingChargeCents ?? 0,
        p_description: input.description ?? "",
        p_name: input.name,
        p_organization_id: organizationId,
        p_slug: input.slug,
      },
    );
    const data = rpcRow(created);
    if (createError || !data) throw databaseError("The brand could not be created.");
    const createdBrandId = String(data.id ?? "");
    assertUuid(createdBrandId, "Brand");
    await this.audit(principal, "brand.created", "brand", createdBrandId, {
      billing_mode: input.billingMode,
    });
    return toRedactedPublicRecord(data);
  }

  async updateBrand(
    brandId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin"]);
    assertUuid(brandId, "Brand");
    const { data: current, error: currentError } = await this.staffClient()
      .from("brands")
      .select("primary_color,secondary_color")
      .eq("organization_id", this.organizationId(principal))
      .eq("id", brandId)
      .single();
    if (currentError || !current) throw databaseError("The brand could not be loaded.");
    const theme = validatedTheme(input, {
      primaryColor: current.primary_color,
      secondaryColor: current.secondary_color,
    });
    const update = {
      ...theme.update,
      ...(Object.hasOwn(input, "defaultShippingChargeCents")
        ? {
            default_shipping_charge_cents:
              input.defaultShippingChargeCents,
          }
        : {}),
    };
    const { data, error } = await this.staffClient()
      .from("brands")
      .update(update)
      .eq("organization_id", this.organizationId(principal))
      .eq("id", brandId)
      .select("*")
      .single();
    if (error || !data) throw databaseError("The brand could not be updated.");
    if (Object.hasOwn(input, "emailSenderAddress") || Object.hasOwn(input, "emailSenderName")) {
      const { data: existingSender } = await this.staffClient()
        .from("brand_sender_identities")
        .select("id,from_name,from_email")
        .eq("organization_id", this.organizationId(principal))
        .eq("brand_id", brandId)
        .maybeSingle();
      if (input.emailSenderAddress === null) {
        if (existingSender) {
          const { error: disableError } = await this.staffClient()
            .from("brand_sender_identities")
            .update({
              provider_identity_id: null,
              status: "disabled",
              verified_at: null,
            })
            .eq("id", existingSender.id)
            .eq("organization_id", this.organizationId(principal))
            .eq("brand_id", brandId);
          if (disableError) {
            throw databaseError("The brand sender identity could not be disabled.");
          }
        }
      } else {
      const fromName =
        typeof input.emailSenderName === "string"
          ? input.emailSenderName.trim()
          : existingSender?.from_name;
      const fromEmail =
        typeof input.emailSenderAddress === "string"
          ? input.emailSenderAddress.trim().toLowerCase()
          : existingSender?.from_email;
      if (
        !fromName ||
        !fromEmail
      ) {
        throw new AppError(
          400,
          "invalid_request",
          "A valid sender name and email address are required.",
        );
      }
      formatBrandSender({ fromEmail, fromName });
      const { error: senderError } = await this.staffClient().rpc(
        "upsert_brand_sender_identity",
        {
          p_brand_id: brandId,
          p_from_email: fromEmail,
          p_from_name: fromName,
          p_organization_id: this.organizationId(principal),
        },
      );
      if (senderError) throw databaseError("The brand sender identity could not be updated.");
      }
    }
    await this.audit(principal, "brand.updated", "brand", brandId, {
      fields: [
        ...Object.keys(theme.update),
        ...(Object.hasOwn(input, "emailSenderAddress") ||
        Object.hasOwn(input, "emailSenderName")
          ? ["sender_identity"]
          : []),
      ],
    });
    return {
      ...toRedactedPublicRecord(data),
      contrast: theme.contrast ?? null,
    };
  }

  async activateBrandSender(
    brandId: string,
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin"]);
    assertUuid(brandId, "Brand");
    const organizationId = this.organizationId(principal);
    const { data: sender, error } = await this.staffClient()
      .from("brand_sender_identities")
      .select("id,from_name,from_email,status,provider_identity_id")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) {
      throw databaseError("The brand sender identity could not be loaded.");
    }
    if (!sender || sender.status === "disabled") {
      throw new AppError(
        503,
        "activation_required",
        "Save a brand sender identity before starting domain verification.",
      );
    }
    formatBrandSender({
      fromEmail: String(sender.from_email),
      fromName: String(sender.from_name),
    });
    const activation = await new ResendDomainsClient(
      requireConfigured(this.env.RESEND_API_KEY, "RESEND_API_KEY"),
    ).activate(
      String(sender.from_email),
      typeof sender.provider_identity_id === "string"
        ? sender.provider_identity_id
        : null,
    );
    const { data: saved, error: saveError } = await this.admin.rpc(
      "set_brand_sender_identity_verification",
      {
        p_brand_id: brandId,
        p_organization_id: organizationId,
        p_provider_identity_id: activation.providerIdentityId,
        p_status: activation.status,
      },
    );
    if (saveError) {
      throw databaseError("The brand sender verification could not be saved.");
    }
    await this.audit(
      principal,
      "brand_sender.verification_requested",
      "brand",
      brandId,
      {
        domain: activation.domain,
        status: activation.status,
      },
    );
    return {
      ...toRedactedPublicRecord(rpcRow(saved) ?? {}),
      dnsRecords: activation.dnsRecords,
      domain: activation.domain,
      status: activation.status,
    };
  }

  async getBrandOverview(
    brandId?: string | "all",
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    if (brandId === "all") {
      await this.assertAllBrandAccess(principal);
    }
    const selected =
      brandId === "all" ? null : await this.activeBrandId(principal, brandId);
    let query = this.staffClient()
      .from("brand_analytics_daily_metrics")
      .select("brand_id,active_members,revenue_cents,shipment_count,brands(name)")
      .eq("organization_id", organizationId)
      .gte(
        "metric_date",
        new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000)
          .toISOString()
          .slice(0, 10),
      );
    if (selected) query = query.eq("brand_id", selected);
    const { data, error } = await query;
    if (error) throw databaseError("The brand overview could not be loaded.");
    const brands = new Map<
      string,
      {
        activeMembers: number;
        id: string;
        monthlyRecurringRevenueCents: number;
        name: string;
        shipmentsThisPeriod: number;
      }
    >();
    for (const row of data ?? []) {
      const related = Array.isArray(row.brands) ? row.brands[0] : row.brands;
      const aggregate = brands.get(row.brand_id) ?? {
        activeMembers: 0,
        id: row.brand_id,
        monthlyRecurringRevenueCents: 0,
        name: related?.name ?? "",
        shipmentsThisPeriod: 0,
      };
      aggregate.activeMembers = Math.max(
        aggregate.activeMembers,
        Number(row.active_members ?? 0),
      );
      aggregate.monthlyRecurringRevenueCents += Number(row.revenue_cents ?? 0);
      aggregate.shipmentsThisPeriod += Number(row.shipment_count ?? 0);
      brands.set(row.brand_id, aggregate);
    }
    const items = [...brands.values()];
    return {
      activeMembers: items.reduce((sum, row) => sum + row.activeMembers, 0),
      brandCount: items.length,
      brands: items,
      monthlyRecurringRevenueCents: items.reduce(
        (sum, row) => sum + row.monthlyRecurringRevenueCents,
        0,
      ),
      shipmentsThisPeriod: items.reduce(
        (sum, row) => sum + row.shipmentsThisPeriod,
        0,
      ),
    };
  }

  async updateBrandDomain(
    brandId: string,
    hostname: string,
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin"]);
    assertUuid(brandId, "Brand");
    const normalized = hostname.trim().toLowerCase();
    if (
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        normalized,
      )
    ) {
      throw new AppError(400, "invalid_request", "The custom hostname is invalid.");
    }
    await this.activeBrandId(principal, brandId);
    const client = this.customHostnameClient();
    const store = {
      claim: async (): Promise<CustomHostnameWriteClaim> => {
        const { data, error } = await this.admin.rpc(
          "claim_custom_hostname_write_attempt",
          {
            p_brand_id: brandId,
            p_hostname: normalized,
            p_lease_owner: `hostname:${principal.user.id}`,
            p_lease_seconds: 120,
            p_organization_id: this.organizationId(principal),
          },
        );
        const row = Array.isArray(data) ? data[0] : data;
        if (
          error ||
          !row ||
          typeof row.attempt_id !== "string" ||
          !["busy", "completed", "create", "lookup", "reconcile"].includes(
            String(row.disposition),
          )
        ) {
          throw databaseError("The custom-hostname write could not be claimed.");
        }
        return {
          attemptId: row.attempt_id,
          disposition: row.disposition as CustomHostnameWriteClaim["disposition"],
          leaseToken:
            typeof row.lease_token === "string" ? row.lease_token : null,
          providerHostnameId:
            typeof row.provider_hostname_id === "string"
              ? row.provider_hostname_id
              : null,
        };
      },
      complete: async (attemptId: string, leaseToken: string): Promise<void> => {
        const { error } = await this.admin.rpc(
          "complete_custom_hostname_write_attempt",
          {
            p_attempt_id: attemptId,
            p_lease_token: leaseToken,
          },
        );
        if (error) throw databaseError("The custom-hostname write could not be completed.");
      },
      markLookupRequired: async (
        attemptId: string,
        leaseToken: string,
        errorCode: string,
      ): Promise<void> => {
        const { error } = await this.admin.rpc(
          "mark_custom_hostname_lookup_required",
          {
            p_attempt_id: attemptId,
            p_error_code: errorCode,
            p_lease_token: leaseToken,
          },
        );
        if (error) throw databaseError("The custom-hostname lookup state could not be saved.");
      },
      recordProviderResult: async (
        attemptId: string,
        leaseToken: string,
        providerHostnameId: string,
      ): Promise<void> => {
        const { error } = await this.admin.rpc(
          "record_custom_hostname_provider_result",
          {
            p_attempt_id: attemptId,
            p_lease_token: leaseToken,
            p_provider_hostname_id: providerHostnameId,
          },
        );
        if (error) throw databaseError("The custom-hostname provider result could not be saved.");
      },
      releaseLookup: async (
        attemptId: string,
        leaseToken: string,
        errorCode: string,
      ): Promise<void> => {
        const { error } = await this.admin.rpc(
          "release_custom_hostname_lookup",
          {
            p_attempt_id: attemptId,
            p_error_code: errorCode,
            p_lease_token: leaseToken,
          },
        );
        if (error) throw databaseError("The custom-hostname lookup could not be released.");
      },
    };
    const result = await executeRetrySafeCustomHostnameWrite({
      brandId,
      client,
      hostname: normalized,
      leaseOwner: `hostname:${principal.user.id}`,
      organizationId: this.organizationId(principal),
      persist: (providerResult) =>
        this.persistDomain(principal, brandId, providerResult),
      store,
    });
    return {
      hostname: result.hostname,
      sslStatus: result.sslStatus === "active" ? "active" : "pending",
      status:
        result.status === "active" && result.sslStatus === "active"
          ? "active"
          : "pending_validation",
      validation: result.ownershipVerification
        ? {
            name: result.ownershipVerification.name,
            type: "TXT",
            value: result.ownershipVerification.value,
          }
        : null,
    };
  }

  private async persistDomain(
    principal: StaffPrincipal,
    brandId: string,
    result: CustomHostnameResult,
  ): Promise<void> {
    const challenge = result.ownershipVerification?.value ?? result.externalId;
    const { error } = await this.admin.from("brand_custom_domains").upsert(
      {
        brand_id: brandId,
        dns_challenge_hash: await sha256(challenge),
        dns_record_name: result.ownershipVerification?.name ?? null,
        dns_record_type: result.ownershipVerification ? "TXT" : null,
        dns_record_value: result.ownershipVerification?.value ?? null,
        hostname: result.hostname,
        hostname_status:
          result.status === "active" ? "active" : "pending",
        organization_id: this.organizationId(principal),
        provider_hostname_id: result.externalId,
        ssl_status: result.sslStatus === "active" ? "active" : "pending",
        status:
          result.status === "active" && result.sslStatus === "active"
            ? "active"
            : "pending_dns",
        verified_at:
          result.status === "active" && result.sslStatus === "active"
            ? new Date().toISOString()
            : null,
      },
      { onConflict: "hostname" },
    );
    if (error) throw databaseError("The custom domain could not be persisted.");
  }

  async getBrandDomain(brandId: string): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin"]);
    assertUuid(brandId, "Brand");
    await this.activeBrandId(principal, brandId);
    const { data: domain, error } = await this.admin
      .from("brand_custom_domains")
      .select("hostname,provider_hostname_id,status")
      .eq("organization_id", this.organizationId(principal))
      .eq("brand_id", brandId)
      .neq("status", "disabled")
      .maybeSingle();
    if (error) throw databaseError("The custom domain could not be loaded.");
    if (!domain) {
      return {
        hostname: null,
        sslStatus: "unconfigured",
        status: "unconfigured",
        validation: null,
      };
    }
    if (!domain.provider_hostname_id) {
      throw new AppError(
        503,
        "activation_required",
        "The custom domain provider identity is missing.",
      );
    }
    const result = await this.customHostnameClient().getHostname(
      domain.provider_hostname_id,
    );
    await this.persistDomain(principal, brandId, result);
    const active =
      result.status === "active" && result.sslStatus === "active";
    return {
      hostname: result.hostname,
      sslStatus: active ? "active" : "pending",
      status: active ? "active" : "pending_validation",
      validation: result.ownershipVerification
        ? {
            name: result.ownershipVerification.name,
            type: "TXT",
            value: result.ownershipVerification.value,
          }
        : null,
    };
  }

  async deleteBrandDomain(brandId: string): Promise<void> {
    const principal = await this.requireStaff(["owner", "admin"]);
    assertUuid(brandId, "Brand");
    await this.activeBrandId(principal, brandId);
    const { data: domain, error: loadError } = await this.admin
      .from("brand_custom_domains")
      .select("hostname,provider_hostname_id")
      .eq("organization_id", this.organizationId(principal))
      .eq("brand_id", brandId)
      .neq("status", "disabled")
      .maybeSingle();
    if (loadError) throw databaseError("The custom domain could not be loaded.");
    if (!domain) return;
    if (!domain.provider_hostname_id) {
      throw new AppError(
        503,
        "activation_required",
        "The custom domain provider identity is missing.",
      );
    }
    if (typeof domain.hostname !== "string") {
      throw databaseError("The custom domain identity is invalid.");
    }
    const store = {
      authorizeDeleteAfterLookup: async (
        attemptId: string,
        leaseToken: string,
      ): Promise<void> => {
        const { error } = await this.admin.rpc(
          "authorize_custom_hostname_delete_after_lookup",
          {
            p_attempt_id: attemptId,
            p_lease_token: leaseToken,
          },
        );
        if (error) {
          throw databaseError(
            "The custom-hostname deletion retry could not be authorized.",
          );
        }
      },
      claim: async (): Promise<CustomHostnameDeleteClaim> => {
        const { data, error } = await this.admin.rpc(
          "claim_custom_hostname_delete_attempt",
          {
            p_brand_id: brandId,
            p_hostname: domain.hostname,
            p_lease_owner: `hostname-delete:${principal.user.id}`,
            p_lease_seconds: 120,
            p_organization_id: this.organizationId(principal),
            p_provider_hostname_id: domain.provider_hostname_id,
          },
        );
        const row = Array.isArray(data) ? data[0] : data;
        if (
          error ||
          !row ||
          typeof row.attempt_id !== "string" ||
          !["busy", "completed", "delete", "lookup", "reconcile"].includes(
            String(row.disposition),
          )
        ) {
          throw databaseError(
            "The custom-hostname deletion could not be claimed.",
          );
        }
        return {
          attemptId: row.attempt_id,
          disposition:
            row.disposition as CustomHostnameDeleteClaim["disposition"],
          leaseToken:
            typeof row.lease_token === "string" ? row.lease_token : null,
        };
      },
      complete: async (
        attemptId: string,
        leaseToken: string,
      ): Promise<void> => {
        const { error } = await this.admin.rpc(
          "complete_custom_hostname_delete_attempt",
          {
            p_attempt_id: attemptId,
            p_lease_token: leaseToken,
          },
        );
        if (error) {
          throw databaseError(
            "The custom-hostname deletion could not be completed.",
          );
        }
      },
      markLookupRequired: async (
        attemptId: string,
        leaseToken: string,
        errorCode: string,
      ): Promise<void> => {
        const { error } = await this.admin.rpc(
          "mark_custom_hostname_delete_lookup_required",
          {
            p_attempt_id: attemptId,
            p_error_code: errorCode,
            p_lease_token: leaseToken,
          },
        );
        if (error) {
          throw databaseError(
            "The custom-hostname deletion lookup state could not be saved.",
          );
        }
      },
      recordProviderAbsent: async (
        attemptId: string,
        leaseToken: string,
      ): Promise<void> => {
        const { error } = await this.admin.rpc(
          "record_custom_hostname_delete_provider_absent",
          {
            p_attempt_id: attemptId,
            p_lease_token: leaseToken,
          },
        );
        if (error) {
          throw databaseError(
            "The custom-hostname deletion result could not be saved.",
          );
        }
      },
      releaseLookup: async (
        attemptId: string,
        leaseToken: string,
        errorCode: string,
      ): Promise<void> => {
        const { error } = await this.admin.rpc(
          "release_custom_hostname_delete_lookup",
          {
            p_attempt_id: attemptId,
            p_error_code: errorCode,
            p_lease_token: leaseToken,
          },
        );
        if (error) {
          throw databaseError(
            "The custom-hostname deletion lookup could not be released.",
          );
        }
      },
    };
    await executeRetrySafeCustomHostnameDelete({
      brandId,
      client: this.customHostnameClient(),
      hostname: domain.hostname,
      leaseOwner: `hostname-delete:${principal.user.id}`,
      organizationId: this.organizationId(principal),
      providerHostnameId: domain.provider_hostname_id,
      store,
    });
  }

  async requestMobileMagicLink(input: {
    clubCode?: string;
    deviceFingerprint: string;
    email: string;
    ipAddress: string;
    redirectUri: string;
  }): Promise<void> {
    if (
      this.env.AUTH_EMAIL_ENABLED !== "true" ||
      this.env.MOBILE_AUTH_EMAIL_TEMPLATE_ENABLED !== "true"
    ) {
      throw new AppError(
        503,
        "activation_required",
        "The Supabase mobile token-hash email template must be activated.",
      );
    }
    assertMobileRedirectUri(input.redirectUri);
    const normalizedClubCode = normalizeMobileClubCode(input.clubCode);
    if (
      input.deviceFingerprint.length < 16 ||
      input.deviceFingerprint.length > 255
    ) {
      throw new AppError(400, "invalid_request", "The mobile device identity is invalid.");
    }
    const normalizedEmail = input.email.trim().toLocaleLowerCase("en-US");
    const { rateLimitPepper } = requireSecuritySecrets(this.env);
    const { data: rateRows, error: rateError } = await this.admin.rpc(
      "record_magic_link_request",
      {
        p_ip_hash: await sha256(
          `${rateLimitPepper}:${input.ipAddress}`,
        ),
        p_normalized_email: normalizedEmail,
      },
    );
    const rate = Array.isArray(rateRows) ? rateRows[0] : rateRows;
    if (rateError) throw databaseError("Mobile sign-in requests are unavailable.");
    if (!rate?.allowed) {
      throw new AppError(
        429,
        "rate_limited",
        "Too many sign-in requests. Try again later.",
      );
    }
    const requestHost = (this.request.get("host") ?? "")
      .split(":")[0]
      ?.trim()
      .toLowerCase();
    const { data: domainData, error: domainError } = requestHost
      ? await this.admin.rpc("resolve_custom_domain", {
          p_hostname: requestHost,
        })
      : { data: null, error: null };
    if (domainError) return;
    const domain = rpcRow(domainData);
    const domainBrandId =
      domain && typeof domain.brand_id === "string" ? domain.brand_id : null;
    let clubBrandIds: string[] | null = null;
    if (!domainBrandId && normalizedClubCode) {
      const { data: brands, error: brandError } = await this.admin
        .from("brands")
        .select("id")
        .eq("slug", normalizedClubCode)
        .eq("active", true)
        .limit(2);
      if (brandError) return;
      const clubBrandId = uniqueMobileClubBrandId(brands ?? []);
      if (!clubBrandId) return;
      clubBrandIds = [clubBrandId];
    }
    let memberQuery = this.admin
      .from("members")
      .select("id,organization_id,brand_id")
      .ilike("email", normalizedEmail)
      .is("deleted_at", null);
    if (domainBrandId) memberQuery = memberQuery.eq("brand_id", domainBrandId);
    if (clubBrandIds) memberQuery = memberQuery.in("brand_id", clubBrandIds);
    const { data: members, error: memberError } = await memberQuery.limit(3);
    if (memberError || !(members ?? []).length) return;
    const eligibleMembers = [];
    for (const member of members ?? []) {
      if (
        await this.mobileMemberBrandIsOperational(
          String(member.organization_id),
          String(member.brand_id),
        )
      ) {
        eligibleMembers.push(member);
      }
    }
    if (!eligibleMembers.length) return;
    if (eligibleMembers.length !== 1) {
      throw new AppError(
        409,
        "conflict",
        "Choose the wine club code associated with this membership.",
      );
    }
    const member = eligibleMembers[0]!;
    const state = await mobileAuthState(this.env, {
      brandId: member.brand_id,
      deviceFingerprintHash: await sha256(input.deviceFingerprint),
      expiresAt: new Date(Date.now() + 15 * 60 * 1_000).toISOString(),
      memberId: member.id,
      nonce: crypto.randomUUID(),
      organizationId: member.organization_id,
      redirectUri: input.redirectUri,
      redirectUriHash: await sha256(input.redirectUri),
    });
    const callback = new URL(
      "/api/auth/member/mobile/callback",
      requireConfigured(this.env.APP_ORIGIN, "APP_ORIGIN"),
    );
    callback.searchParams.set("state", state);
    const { error } = await this.authenticatedSurfaceClient(
      "member",
    ).auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: callback.toString(),
        shouldCreateUser: true,
      },
    });
    if (error) throw databaseError("The mobile sign-in email could not be requested.");
  }

  async completeMobileMagicLink(input: {
    state: string;
    tokenHash: string;
    type: "email";
  }): Promise<{ redirectUrl: string }> {
    const state = await verifyMobileAuthState(this.env, input.state);
    const redirectUri = String(state.redirectUri ?? "");
    const fingerprintHash = String(state.deviceFingerprintHash ?? "");
    const stateOrganizationId = String(state.organizationId ?? "");
    const stateBrandId = String(state.brandId ?? "");
    const stateMemberId = String(state.memberId ?? "");
    assertMobileRedirectUri(redirectUri);
    if (
      !/^[a-f0-9]{64}$/.test(fingerprintHash) ||
      !/^[A-Za-z0-9_-]{20,512}$/.test(input.tokenHash) ||
      !INTEGRATION_UUID_PATTERN.test(stateOrganizationId) ||
      !INTEGRATION_UUID_PATTERN.test(stateBrandId) ||
      !INTEGRATION_UUID_PATTERN.test(stateMemberId)
    ) {
      throw new AppError(401, "unauthorized", "The mobile sign-in link is invalid.");
    }
    const client = this.authenticatedSurfaceClient("member");
    const { data: verified, error } = await client.auth.verifyOtp({
      token_hash: input.tokenHash,
      type: input.type,
    });
    if (error || !verified.user?.id || !verified.user.email) {
      throw new AppError(401, "unauthorized", "The mobile sign-in link is invalid or expired.");
    }
    const normalizedEmail = verified.user.email
      .trim()
      .toLocaleLowerCase("en-US");
    const { data: member, error: memberError } = await this.admin
      .from("members")
      .select("id,organization_id,brand_id")
      .eq("id", stateMemberId)
      .eq("organization_id", stateOrganizationId)
      .eq("brand_id", stateBrandId)
      .ilike("email", normalizedEmail)
      .is("deleted_at", null)
      .maybeSingle();
    if (
      memberError ||
      !member ||
      !(await this.mobileMemberBrandIsOperational(
        stateOrganizationId,
        stateBrandId,
      ))
    ) {
      throw new AppError(403, "forbidden", "The member identity is ambiguous or unavailable.");
    }
    const { error: linkError } = await this.admin
      .from("members")
      .update({ auth_user_id: verified.user.id })
      .eq("id", member.id)
      .eq("organization_id", member.organization_id)
      .eq("brand_id", member.brand_id);
    if (linkError) throw databaseError("The mobile member identity could not be linked.");
    const exchange = randomOpaqueToken();
    const { error: exchangeError } = await this.admin.rpc(
      "register_mobile_auth_exchange",
      {
        p_auth_user_id: verified.user.id,
        p_brand_id: member.brand_id,
        p_device_fingerprint_hash: fingerprintHash,
        p_device_id: null,
        p_expires_at: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
        p_organization_id: member.organization_id,
        p_redirect_uri_hash: await sha256(redirectUri),
        p_token_hash: await sha256(exchange),
      },
    );
    if (exchangeError) throw databaseError("The mobile session exchange could not be registered.");
    const target = new URL(redirectUri);
    target.searchParams.set("code", exchange);
    return { redirectUrl: target.toString() };
  }

  private async mobileMemberBrandIsOperational(
    organizationId: string,
    brandId: string,
  ): Promise<boolean> {
    const [{ data: brand, error: brandError }, { data: organization, error: orgError }] =
      await Promise.all([
        this.admin
          .from("brands")
          .select("active,billing_mode,access_status")
          .eq("organization_id", organizationId)
          .eq("id", brandId)
          .maybeSingle(),
        this.admin
          .from("organizations")
          .select("access_status")
          .eq("id", organizationId)
          .maybeSingle(),
      ]);
    if (brandError || orgError || !brand || !organization || !brand.active) {
      return false;
    }
    return brand.billing_mode === "independent"
      ? brand.access_status !== "suspended"
      : organization.access_status !== "suspended";
  }

  async exchangeMobileSession(input: {
    appVersion: string;
    code: string;
    deviceFingerprint: string;
    platform: "android" | "ios";
    redirectUri: string;
  }): Promise<Record<string, unknown>> {
    assertMobileRedirectUri(input.redirectUri);
    const fingerprintHash = await sha256(input.deviceFingerprint);
    const { data, error } = await this.admin.rpc(
      "consume_mobile_auth_exchange",
      {
        p_as_of: new Date().toISOString(),
        p_device_fingerprint_hash: fingerprintHash,
        p_device_id: null,
        p_redirect_uri_hash: await sha256(input.redirectUri),
        p_token_hash: await sha256(input.code),
      },
    );
    const exchange = rpcRow(data);
    if (error || !exchange) {
      throw new AppError(
        401,
        "unauthorized",
        "The mobile exchange code is invalid, expired, or already used.",
      );
    }
    const organizationId = String(exchange.organization_id);
    const brandId = String(exchange.brand_id);
    const memberId = String(exchange.member_id);
    const authUserId = String(exchange.auth_user_id);
    for (const [label, value] of [
      ["Organization", organizationId],
      ["Brand", brandId],
      ["Member", memberId],
      ["Auth user", authUserId],
    ] as Array<[string, string]>) {
      assertUuid(value, label);
    }
    const { data: device, error: deviceError } = await this.admin
      .from("mobile_devices")
      .upsert(
        {
          active: true,
          app_version: input.appVersion,
          brand_id: brandId,
          device_fingerprint_hash: fingerprintHash,
          last_seen_at: new Date().toISOString(),
          member_id: memberId,
          notifications_enabled: false,
          organization_id: organizationId,
          platform: input.platform,
        },
        { onConflict: "member_id,device_fingerprint_hash" },
      )
      .select("id")
      .single();
    if (deviceError || !device) throw databaseError("The mobile device could not be bound.");
    const refreshToken = randomOpaqueToken();
    const refreshExpiresAt = new Date(
      Date.now() + MOBILE_REFRESH_TTL_MS,
    ).toISOString();
    const { data: sessionId, error: sessionError } = await this.admin.rpc(
      "register_mobile_refresh_session",
      {
        p_auth_user_id: authUserId,
        p_brand_id: brandId,
        p_device_id: device.id,
        p_expires_at: refreshExpiresAt,
        p_family_id: crypto.randomUUID(),
        p_member_id: memberId,
        p_organization_id: organizationId,
        p_refresh_token_hash: await sha256(refreshToken),
      },
    );
    if (sessionError || typeof sessionId !== "string") {
      throw databaseError("The mobile refresh session could not be registered.");
    }
    return this.mobileSessionResponse({
      authUserId,
      brandId,
      deviceId: device.id,
      memberId,
      organizationId,
      refreshToken,
      sessionId,
    });
  }

  private async mobileSessionResponse(input: {
    authUserId: string;
    brandId: string;
    deviceId: string;
    memberId: string;
    organizationId: string;
    refreshToken: string;
    sessionId: string;
  }): Promise<Record<string, unknown>> {
    const { data: member, error } = await this.admin
      .from("members")
      .select("id,email,first_name,last_name")
      .eq("id", input.memberId)
      .eq("organization_id", input.organizationId)
      .eq("brand_id", input.brandId)
      .eq("auth_user_id", input.authUserId)
      .single();
    if (error || !member) throw databaseError("The mobile member could not be loaded.");
    const access = await issueMobileAccessToken(this.env, {
      authUserId: input.authUserId,
      brandId: input.brandId,
      deviceId: input.deviceId,
      memberId: input.memberId,
      organizationId: input.organizationId,
      sessionId: input.sessionId,
    });
    return {
      accessToken: access.accessToken,
      expiresAt: access.expiresAt,
      member: {
        email: member.email,
        firstName: member.first_name,
        id: member.id,
        lastName: member.last_name,
      },
      refreshToken: input.refreshToken,
      tokenType: "bearer",
    };
  }

  async refreshMobileSession(input: {
    refreshToken: string;
  }): Promise<Record<string, unknown>> {
    const nextRefreshToken = randomOpaqueToken();
    const expiresAt = new Date(Date.now() + MOBILE_REFRESH_TTL_MS).toISOString();
    const { data, error } = await this.admin.rpc(
      "rotate_mobile_refresh_session",
      {
        p_as_of: new Date().toISOString(),
        p_current_refresh_token_hash: await sha256(input.refreshToken),
        p_new_expires_at: expiresAt,
        p_new_refresh_token_hash: await sha256(nextRefreshToken),
      },
    );
    const rotated = rpcRow(data);
    if (error || !rotated || rotated.reuse_detected === true) {
      throw new AppError(
        401,
        "unauthorized",
        rotated?.reuse_detected === true
          ? "Refresh token reuse was detected; this mobile session was revoked."
          : "The mobile refresh token is invalid or expired.",
      );
    }
    const sessionId = String(rotated.session_id ?? "");
    assertUuid(sessionId, "Mobile session");
    const { data: session, error: sessionError } = await this.admin
      .from("mobile_refresh_sessions")
      .select(
        "auth_user_id,organization_id,brand_id,member_id,device_id,revoked_at",
      )
      .eq("id", sessionId)
      .single();
    if (sessionError || !session || session.revoked_at) {
      throw new AppError(401, "unauthorized", "The mobile refresh session is unavailable.");
    }
    return this.mobileSessionResponse({
      authUserId: session.auth_user_id,
      brandId: session.brand_id,
      deviceId: session.device_id,
      memberId: session.member_id,
      organizationId: session.organization_id,
      refreshToken: nextRefreshToken,
      sessionId,
    });
  }

  async logoutMobileSession(input: { refreshToken: string }): Promise<void> {
    const { data: session, error } = await this.admin
      .from("mobile_refresh_sessions")
      .select("family_id")
      .eq("refresh_token_hash", await sha256(input.refreshToken))
      .maybeSingle();
    if (error) throw databaseError("The mobile session could not be loaded.");
    if (!session) return;
    const { error: revokeError } = await this.admin.rpc(
      "revoke_mobile_refresh_family",
      {
        p_as_of: new Date().toISOString(),
        p_family_id: session.family_id,
      },
    );
    if (revokeError) throw databaseError("The mobile session could not be revoked.");
  }

  async getMobileAppPolicy(input: {
    platform: "android" | "ios";
    version: string;
  }): Promise<Record<string, unknown>> {
    const prefix =
      input.platform === "ios" ? "MOBILE_IOS" : "MOBILE_ANDROID";
    const minimumVersion = requireConfigured(
      this.env[`${prefix}_MINIMUM_VERSION` as keyof WorkerEnv] as string,
      `${prefix}_MINIMUM_VERSION`,
    );
    const latestVersion = requireConfigured(
      this.env[`${prefix}_LATEST_VERSION` as keyof WorkerEnv] as string,
      `${prefix}_LATEST_VERSION`,
    );
    const semver = /^\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/;
    if (!semver.test(input.version)) {
      throw new AppError(400, "invalid_request", "The app version is invalid.");
    }
    if (
      !semver.test(minimumVersion) ||
      !semver.test(latestVersion) ||
      compareVersions(latestVersion, minimumVersion) < 0
    ) {
      throw new AppError(
        503,
        "activation_required",
        "The mobile app version policy is invalid.",
      );
    }
    const storeUrl =
      input.platform === "ios"
        ? this.env.MOBILE_IOS_STORE_URL ?? null
        : this.env.MOBILE_ANDROID_STORE_URL ?? null;
    if (storeUrl) {
      let parsed: URL;
      try {
        parsed = new URL(storeUrl);
      } catch {
        throw new AppError(
          503,
          "activation_required",
          "The mobile store URL is invalid.",
        );
      }
      const expectedHost =
        input.platform === "ios" ? "apps.apple.com" : "play.google.com";
      if (parsed.protocol !== "https:" || parsed.hostname !== expectedHost) {
        throw new AppError(
          503,
          "activation_required",
          "The mobile store URL is not on an approved marketplace.",
        );
      }
    }
    const update =
      compareVersions(input.version, minimumVersion) < 0
        ? "required"
        : compareVersions(input.version, latestVersion) < 0
          ? "recommended"
          : "none";
    return {
      latestVersion,
      message:
        update === "required"
          ? "Update Vinifera to continue securely."
          : update === "recommended"
            ? "A newer Vinifera version is available."
            : null,
      minimumVersion,
      storeUrl,
      update,
    };
  }

  async getMobileBootstrap(): Promise<Record<string, unknown>> {
    const principal = await this.requireMember();
    const memberClient = this.authenticatedSurfaceClient("member");
    const { data: member, error: memberError } = await memberClient
      .from("members")
      .select("id,brand_id,first_name,last_name,brands(id,name,logo_url,primary_color)")
      .eq("id", principal.user.id)
      .eq("organization_id", principal.organization.id)
      .eq("brand_id", principal.brand.id)
      .single();
    if (memberError || !member) throw databaseError("The mobile member profile could not be loaded.");
    const [{ data: shipments, error: shipmentError }, { data: ledger, error: ledgerError }] =
      await Promise.all([
        memberClient
          .from("shipments")
          .select(
            "id,status,charge_amount_cents,tracking_number,created_at,releases(name)",
          )
          .eq("member_id", principal.user.id)
          .eq("organization_id", principal.organization.id)
          .eq("brand_id", principal.brand.id)
          .order("created_at", { ascending: false })
          .limit(20),
        memberClient
          .from("loyalty_ledger")
          .select("id,description,points,created_at")
          .eq("member_id", principal.user.id)
          .eq("organization_id", principal.organization.id)
          .eq("brand_id", principal.brand.id)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
    if (shipmentError || ledgerError) {
      throw databaseError("The mobile offline snapshot could not be loaded.");
    }
    const brand = Array.isArray(member.brands) ? member.brands[0] : member.brands;
    return {
      brand: brand
        ? {
            id: brand.id,
            logoUrl: brand.logo_url,
            name: brand.name,
            primaryColor: brand.primary_color,
          }
        : null,
      cursor: (shipments ?? [])[0]?.created_at ?? null,
      generatedAt: new Date().toISOString(),
      loyaltyLedger: toRedactedPublicValue(ledger ?? []),
      member: {
        firstName: member.first_name,
        id: member.id,
        lastName: member.last_name,
      },
      pendingActions: [],
      recentShipments: (shipments ?? []).map((shipment) => {
        const release = Array.isArray(shipment.releases)
          ? shipment.releases[0]
          : shipment.releases;
        return {
          chargeAmountCents: shipment.charge_amount_cents,
          createdAt: shipment.created_at,
          id: shipment.id,
          releaseName: release?.name ?? "",
          status: shipment.status,
          trackingNumber: shipment.tracking_number,
        };
      }),
    };
  }

  async registerMobileDevice(input: {
    appVersion: string;
    brandId?: string | null;
    deviceFingerprint: string;
    permission: "denied" | "granted" | "prompt";
    platform: "android" | "ios";
    token: string;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireMember();
    if (input.token.length < 16 || input.token.length > 4_096) {
      throw new AppError(400, "invalid_request", "The push token is invalid.");
    }
    const { data: member, error: memberError } = await this.admin
      .from("members")
      .select("brand_id")
      .eq("id", principal.user.id)
      .eq("organization_id", principal.organization.id)
      .single();
    if (memberError || !member?.brand_id) throw databaseError("The member brand could not be loaded.");
    if (input.brandId && input.brandId !== member.brand_id) {
      throw new AppError(403, "forbidden", "The device brand does not match the member.");
    }
    const fingerprint = await sha256(input.deviceFingerprint);
    const { data: device, error } = await this.admin
      .from("mobile_devices")
      .upsert(
        {
          active: true,
          app_version: input.appVersion,
          brand_id: member.brand_id,
          device_fingerprint_hash: fingerprint,
          last_seen_at: new Date().toISOString(),
          member_id: principal.user.id,
          notifications_enabled: input.permission === "granted",
          organization_id: principal.organization.id,
          platform: input.platform,
        },
        { onConflict: "member_id,device_fingerprint_hash" },
      )
      .select("id,platform,app_version,notifications_enabled,last_seen_at")
      .single();
    if (error || !device) throw databaseError("The mobile device could not be registered.");
    const envelope = await this.storeCredentials(
      principal.organization.id,
      device.id,
      "mobile_push_token",
      { token: input.token },
      "mobile",
    );
    const { error: secretError } = await this.admin
      .from("mobile_device_secrets")
      .upsert({
        algorithm: envelope.algorithm,
        device_id: device.id,
        envelope_version: envelope.version,
        key_version: envelope.keyVersion,
        organization_id: principal.organization.id,
        push_token_ciphertext: envelope.ciphertext,
        push_token_iv: envelope.iv,
        storage_mode: "encrypted_envelope",
      });
    if (secretError) throw databaseError("The mobile push token could not be stored.");
    return toRedactedPublicRecord(device);
  }

  async unregisterMobileDevice(deviceFingerprint: string): Promise<void> {
    const principal = await this.requireMember();
    const { error } = await this.admin
      .from("mobile_devices")
      .update({ active: false, notifications_enabled: false })
      .eq("organization_id", principal.organization.id)
      .eq("member_id", principal.user.id)
      .eq("device_fingerprint_hash", await sha256(deviceFingerprint));
    if (error) throw databaseError("The mobile device could not be unregistered.");
  }
}

export function appleAppSiteAssociation(env: WorkerEnv): Record<string, unknown> {
  const teamId = requireConfigured(env.MOBILE_APPLE_TEAM_ID, "MOBILE_APPLE_TEAM_ID");
  const bundleId = requireConfigured(env.MOBILE_IOS_BUNDLE_ID, "MOBILE_IOS_BUNDLE_ID");
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundleId}`],
          components: mobileIdentity.externalDeepLinkPaths.map((path) => ({
            "/": path,
          })),
        },
      ],
    },
  };
}

export function androidAssetLinks(env: WorkerEnv): Array<Record<string, unknown>> {
  const packageName = requireConfigured(
    env.MOBILE_ANDROID_PACKAGE_NAME,
    "MOBILE_ANDROID_PACKAGE_NAME",
  );
  const fingerprint = requireConfigured(
    env.MOBILE_ANDROID_SIGNING_CERT_SHA256,
    "MOBILE_ANDROID_SIGNING_CERT_SHA256",
  );
  if (!/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/i.test(fingerprint)) {
    throw new AppError(
      503,
      "activation_required",
      "The Android signing certificate fingerprint is invalid.",
    );
  }
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: [fingerprint.toUpperCase()],
      },
    },
  ];
}

interface RefundDeliveryClaim {
  deltaAmountCents: number;
  leaseToken: string | null;
  outcome: "already_delivered" | "blocked" | "claimed";
  priorCumulativeAmountCents: number;
  providerRequestKey: string;
  reclaimed: boolean;
  retryAfter: string | null;
  targetCumulativeAmountCents: number;
}

async function claimRefundDelivery(
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
  shipmentId: string,
  targetCumulativeAmountCents: number,
): Promise<RefundDeliveryClaim> {
  const { data, error } = await admin.rpc(
    "claim_integration_refund_delivery",
    {
      p_connection_id: job.connection_id,
      p_lease_owner: `job:${job.job_id}`,
      p_lease_seconds: 120,
      p_shipment_id: shipmentId,
      p_target_cumulative_amount_cents: targetCumulativeAmountCents,
    },
  );
  const row = rpcRow(data);
  if (
    error ||
    !row ||
    !["already_delivered", "blocked", "claimed"].includes(
      String(row.outcome),
    )
  ) {
    throw databaseError("The refund delivery lease could not be claimed.");
  }
  const outcome = String(row.outcome) as RefundDeliveryClaim["outcome"];
  const claim = {
    deltaAmountCents: Number(row.delta_amount_cents ?? 0),
    leaseToken:
      typeof row.lease_token === "string" ? row.lease_token : null,
    outcome,
    priorCumulativeAmountCents: Number(
      row.prior_cumulative_amount_cents ?? 0,
    ),
    providerRequestKey: String(row.provider_request_key ?? ""),
    reclaimed: row.reclaimed === true,
    retryAfter:
      typeof row.retry_after === "string" ? row.retry_after : null,
    targetCumulativeAmountCents: Number(
      row.target_cumulative_amount_cents ?? 0,
    ),
  };
  if (
    !claim.providerRequestKey ||
    (claim.outcome === "claimed" &&
      (!claim.leaseToken ||
        claim.deltaAmountCents <= 0 ||
        claim.targetCumulativeAmountCents <=
          claim.priorCumulativeAmountCents))
  ) {
    throw databaseError("The refund delivery lease is invalid.");
  }
  return claim;
}

function blockedRefundDelivery(
  job: ClaimedIntegrationJob,
  retryAfter: string | null,
  processed = 0,
): IntegrationJobCompletion {
  const parsedRetry = retryAfter ? Date.parse(retryAfter) : Number.NaN;
  return {
    errorCode: null,
    failed: 0,
    nextAttemptAt: new Date(
      Number.isFinite(parsedRetry)
        ? Math.max(Date.now() + 1_000, parsedRetry)
        : Date.now() + 5_000,
    ).toISOString(),
    outcome: "retry",
    processed,
    providerCursor: job.cursor_data,
  };
}

async function releaseRefundDelivery(
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
  shipmentId: string,
  leaseToken: string,
): Promise<void> {
  const { data, error } = await admin.rpc(
    "release_integration_refund_delivery",
    {
      p_connection_id: job.connection_id,
      p_lease_token: leaseToken,
      p_shipment_id: shipmentId,
    },
  );
  if (error || data !== true) {
    throw databaseError("The refund delivery lease could not be released.");
  }
}

async function executeConnectionValidation(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const provider = await providerForJob(env, admin, job);
  if (job.integration_type === "quickbooks") {
    const required = [
      "depositAccountRef",
      "defaultItemRef",
      "defaultCustomerRef",
    ];
    const missing = required.filter(
      (field) =>
        typeof provider.syncConfig[field] !== "string" ||
        !String(provider.syncConfig[field]).trim(),
    );
    if (missing.length) {
      throw new AppError(
        503,
        "activation_required",
        `QuickBooks mappings are required: ${missing.join(", ")}.`,
      );
    }
  }
  await provider.client.validateConnection();
  const { error } = await admin.rpc("set_integration_health", {
    p_connection_id: job.connection_id,
    p_error_code: null,
    p_status: "active",
  });
  if (error) throw databaseError("The integration health could not be activated.");
  const initialType =
    job.integration_type === "klaviyo"
      ? "profiles.full"
      : job.integration_type === "quickbooks"
        ? "transactions.full"
        : job.integration_type === "meta"
          ? "conversions.pending"
          : "tax.reconcile";
  const { error: queueError } = await admin.rpc(
    "enqueue_integration_sync_job",
    {
      p_connection_id: job.connection_id,
      p_cursor_data: {},
      p_direction: "outbound",
      p_entity_id: job.brand_id,
      p_entity_type: "brand",
      p_idempotency_key: `initial:${job.connection_id}:${initialType}`,
      p_max_attempts: 8,
      p_payload: {},
      p_sync_type: initialType,
    },
  );
  if (queueError) throw databaseError("The initial integration sync could not be queued.");
  return successfulIntegrationJob({ processed: 1 });
}

interface QuickBooksAccountMapping {
  club_tier_id?: string | null;
  mapping_kind: string;
  quickbooks_account_id: string;
  quickbooks_item_id: string | null;
}

export function resolveQuickBooksAccountMapping(
  mappings: QuickBooksAccountMapping[],
  mappingKind: string,
  tierId: string | null,
): QuickBooksAccountMapping | null {
  const fallback = mappings.find(
    (mapping) =>
      mapping.mapping_kind === mappingKind && mapping.club_tier_id == null,
  );
  if (!tierId) return fallback ?? null;
  return (
    mappings.find(
      (mapping) =>
        mapping.mapping_kind === mappingKind &&
        mapping.club_tier_id === tierId,
    ) ??
    fallback ??
    null
  );
}

async function executeQuickBooksTransactions(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const { client, syncConfig } = await providerForJob(env, admin, job);
  const quickbooks = client as QuickBooksClient;
  const after =
    typeof job.cursor_data.afterShipmentId === "string"
      ? job.cursor_data.afterShipmentId
      : null;
  const deltaShipmentId =
    job.sync_type === "quickbooks.transaction.upsert" && job.entity_id
      ? job.entity_id
      : null;
  const sourceResult = deltaShipmentId
    ? await admin
        .from("shipments")
        .select(
          "id,member_id,tier_id,status,charge_amount_cents,shipping_charge_cents,loyalty_discount_cents,tax_amount_cents,refund_amount_cents,paid_at,updated_at",
        )
        .eq("id", deltaShipmentId)
        .eq("organization_id", job.organization_id)
        .eq("brand_id", job.brand_id)
        .in("status", [
          "charged",
          "label_created",
          "packed",
          "shipped",
          "delivered",
          "refunded",
        ])
        .maybeSingle()
    : await admin.rpc("get_quickbooks_transaction_source", {
        p_after_shipment_id: after,
        p_connection_id: job.connection_id,
        p_limit: 100,
      });
  if (sourceResult.error) {
    throw databaseError("The QuickBooks transaction source could not be loaded.");
  }
  const data = deltaShipmentId
    ? sourceResult.data
      ? [
          {
            ...(sourceResult.data as Record<string, unknown>),
            shipment_id: (sourceResult.data as Record<string, unknown>).id,
          },
        ]
      : []
    : sourceResult.data;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  let written = 0;
  for (const row of rows) {
    const shipmentId = String(row.shipment_id);
    const tierId = typeof row.tier_id === "string" ? row.tier_id : null;
    let mappingQuery = admin
      .from("quickbooks_account_mappings")
      .select(
        "club_tier_id,quickbooks_account_id,quickbooks_item_id,mapping_kind",
      )
      .eq("connection_id", job.connection_id)
      .eq("brand_id", job.brand_id);
    mappingQuery = tierId
      ? mappingQuery.or(`club_tier_id.eq.${tierId},club_tier_id.is.null`)
      : mappingQuery.is("club_tier_id", null);
    const { data: mappings, error: mappingError } = await mappingQuery;
    if (mappingError) throw databaseError("QuickBooks account mappings could not be loaded.");
    const membership = resolveQuickBooksAccountMapping(
      mappings ?? [],
      "membership",
      tierId,
    );
    const shipping = resolveQuickBooksAccountMapping(
      mappings ?? [],
      "shipping",
      tierId,
    );
    const depositAccountRef = String(
      syncConfig.depositAccountRef ?? membership?.quickbooks_account_id ?? "",
    );
    const itemRef = String(
      membership?.quickbooks_item_id ?? syncConfig.defaultItemRef ?? "",
    );
    const shippingAccountRef = String(
      shipping?.quickbooks_account_id ?? "",
    );
    const shippingItemRef = String(shipping?.quickbooks_item_id ?? "");
    const customerRef = String(syncConfig.defaultCustomerRef ?? "");
    if (!depositAccountRef || !itemRef || !customerRef) {
      throw new AppError(
        503,
        "activation_required",
        "QuickBooks account, item, and customer mappings are required.",
      );
    }
    const saleFinancials = quickBooksShipmentLineFinancials(row);
    if (
      saleFinancials.shippingCents > 0 &&
      (!shippingAccountRef || !shippingItemRef)
    ) {
      throw new AppError(
        503,
        "activation_required",
        "A separate QuickBooks shipping income account and item mapping are required.",
      );
    }
    const payableCents = saleFinancials.totalCents;
    const currentRefundCents = Math.min(
      payableCents,
      Math.max(0, Number(row.refund_amount_cents ?? 0)),
    );
    const payloadRefundCents = Number(job.payload.refund_amount_cents);
    const requestedRefundCents =
      Number.isFinite(payloadRefundCents) && payloadRefundCents >= 0
        ? Math.min(currentRefundCents, payloadRefundCents)
        : currentRefundCents;
    const explicitChangeType =
      job.payload.change_type === "refund" ||
      job.payload.change_type === "sale"
        ? job.payload.change_type
        : null;
    const operationKinds: Array<"refund" | "sale"> = deltaShipmentId
      ? [
          explicitChangeType === "refund" ||
          (!explicitChangeType && requestedRefundCents > 0)
            ? "refund"
            : "sale",
        ]
      : [
          "sale",
          ...(currentRefundCents > 0 ? (["refund"] as const) : []),
        ];
    for (const operationKind of operationKinds) {
      const refunded = operationKind === "refund";
      const refundTargetCents = deltaShipmentId
        ? requestedRefundCents
        : currentRefundCents;
      let deliveryClaim: RefundDeliveryClaim | null = null;
      let financials: QuickBooksLineFinancials;
      let receipt: {
        currencyCode: string;
        customerRef: string;
        depositAccountRef: string;
        docNumber: string;
        lines: Array<{
          amountCents: number;
          description: string;
          itemRef: string;
          taxCodeRef: string | null;
        }>;
        privateNote: string;
        taxCents: number;
        transactionDate: string;
      };
      try {
        if (refunded) {
          if (refundTargetCents <= 0) continue;
          deliveryClaim = await claimRefundDelivery(
            admin,
            job,
            shipmentId,
            refundTargetCents,
          );
          if (deliveryClaim.outcome === "blocked") {
            return blockedRefundDelivery(
              job,
              deliveryClaim.retryAfter,
              written,
            );
          }
          if (deliveryClaim.outcome === "already_delivered") continue;
        }
        financials =
          refunded && deliveryClaim
            ? quickBooksRefundDeltaLineFinancials(
                row,
                deliveryClaim.priorCumulativeAmountCents,
                deliveryClaim.targetCumulativeAmountCents,
              )
            : saleFinancials;
        if (financials.totalCents <= 0) {
          if (deliveryClaim?.leaseToken) {
            await releaseRefundDelivery(
              admin,
              job,
              shipmentId,
              deliveryClaim.leaseToken,
            );
          }
          continue;
        }
        const compactShipmentId = shipmentId.replaceAll("-", "");
        receipt = {
          currencyCode: String(syncConfig.currencyCode ?? "USD"),
          customerRef,
          depositAccountRef,
          docNumber: refunded
            ? `VIR-${compactShipmentId.slice(0, 8)}-${refundTargetCents.toString(36)}`
            : `VIN-${compactShipmentId.slice(0, 17)}`,
          lines: [
            ...(financials.wineCents > 0
              ? [{
              amountCents: financials.wineCents,
              description: `Vinifera shipment ${shipmentId}`,
              itemRef,
              taxCodeRef:
                typeof syncConfig.taxCodeRef === "string"
                  ? syncConfig.taxCodeRef
                  : null,
                }]
              : []),
            ...(financials.shippingCents > 0
              ? [{
                  amountCents: financials.shippingCents,
                  description: `Vinifera shipping ${shipmentId}`,
                  itemRef: shippingItemRef,
                  taxCodeRef:
                    typeof syncConfig.shippingTaxCodeRef === "string"
                      ? syncConfig.shippingTaxCodeRef
                      : typeof syncConfig.taxCodeRef === "string"
                        ? syncConfig.taxCodeRef
                        : null,
                }]
              : []),
          ],
          privateNote: `Vinifera shipment ${shipmentId}`,
          taxCents: financials.taxCents,
          transactionDate: String(row.paid_at ?? row.updated_at).slice(0, 10),
        };
      } catch (error) {
        if (deliveryClaim?.leaseToken) {
          await releaseRefundDelivery(
            admin,
            job,
            shipmentId,
            deliveryClaim.leaseToken,
          );
        }
        throw error;
      }

      const providerReceipt =
        refunded && deliveryClaim
          ? await quickbooks.createRefundReceipt(
              receipt,
              deliveryClaim.providerRequestKey,
            )
          : await quickbooks.createSalesReceipt(
              receipt,
              `qbo-${shipmentId}-sale`,
            );
      if (refunded && deliveryClaim?.leaseToken) {
        const { error: completeError } = await admin.rpc(
          "complete_quickbooks_refund_delivery",
          {
            p_amount_cents: financials.totalCents,
            p_connection_id: job.connection_id,
            p_currency_code: receipt.currencyCode,
            p_exchange_rate: Number(syncConfig.exchangeRate ?? 1),
            p_lease_token: deliveryClaim.leaseToken,
            p_provider_transaction_id: providerReceipt.id,
            p_shipment_id: shipmentId,
            p_tax_cents: receipt.taxCents,
            p_transaction_date: receipt.transactionDate,
          },
        );
        if (completeError) {
          throw databaseError(
            "The QuickBooks refund delivery could not be finalized.",
          );
        }
      } else {
        const { error: persistError } = await admin
          .from("quickbooks_transaction_mappings")
          .upsert(
            {
              amount_cents: financials.totalCents,
              brand_id: job.brand_id,
              connection_id: job.connection_id,
              currency_code: receipt.currencyCode,
              exchange_rate: Number(syncConfig.exchangeRate ?? 1),
              organization_id: job.organization_id,
              quickbooks_transaction_id: providerReceipt.id,
              shipment_id: shipmentId,
              source_cumulative_amount_cents: 0,
              tax_cents: receipt.taxCents,
              transaction_date: receipt.transactionDate,
              transaction_type: "sales_receipt",
            },
            {
              onConflict:
                "connection_id,shipment_id,transaction_type,source_cumulative_amount_cents",
            },
          );
        if (persistError) {
          throw databaseError(
            "The QuickBooks provider identity could not be persisted.",
          );
        }
      }
      written += 1;
    }
  }
  const lastShipmentId = rows.length
    ? String(rows.at(-1)?.shipment_id)
    : after;
  if (!deltaShipmentId && rows.length === 100 && lastShipmentId) {
    const { error: nextError } = await admin.rpc(
      "enqueue_integration_sync_job",
      {
        p_connection_id: job.connection_id,
        p_cursor_data: { afterShipmentId: lastShipmentId },
        p_direction: "outbound",
        p_entity_id: lastShipmentId,
        p_entity_type: "shipment_page",
        p_idempotency_key: `qbo-page:${job.connection_id}:${lastShipmentId}`,
        p_max_attempts: 8,
        p_payload: {},
        p_sync_type: "transactions.page",
      },
    );
    if (nextError) throw databaseError("The next QuickBooks page could not be queued.");
  }
  return successfulIntegrationJob({
    processed: written,
    providerCursor: {
      afterShipmentId: lastShipmentId,
    },
  });
}

export function quickBooksShipmentFinancials(
  row: Record<string, unknown>,
  refunded: boolean,
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const financials = quickBooksShipmentLineFinancials(
    row,
    refunded ? Number(row.refund_amount_cents ?? 0) : undefined,
  );
  return {
    subtotalCents: financials.wineCents + financials.shippingCents,
    taxCents: financials.taxCents,
    totalCents: financials.totalCents,
  };
}

export interface QuickBooksLineFinancials {
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  wineCents: number;
}

function allocateCumulativeRefund(
  components: [number, number, number],
  targetCents: number,
): [number, number, number] {
  const total = components.reduce((sum, value) => sum + value, 0);
  const target = Math.min(total, Math.max(0, Math.round(targetCents)));
  if (total === 0 || target === 0) return [0, 0, 0];
  if (target === total) return [...components];
  const exact = components.map((value) => (value * target) / total);
  const allocated = exact.map(Math.floor);
  let remainder = target - allocated.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ fraction: value - allocated[index]!, index }))
    .sort(
      (left, right) =>
        right.fraction - left.fraction || left.index - right.index,
    );
  for (const item of order) {
    if (remainder <= 0) break;
    allocated[item.index] = allocated[item.index]! + 1;
    remainder -= 1;
  }
  return allocated as [number, number, number];
}

export function quickBooksShipmentLineFinancials(
  row: Record<string, unknown>,
  cumulativeRefundCents?: number,
): QuickBooksLineFinancials {
  const subtotalCents = Math.max(
    0,
    Math.round(
      Number(row.charge_amount_cents ?? 0) -
        Number(row.loyalty_discount_cents ?? 0),
    ),
  );
  const shippingCents = Math.min(
    subtotalCents,
    Math.max(0, Math.round(Number(row.shipping_charge_cents ?? 0))),
  );
  const wineCents = subtotalCents - shippingCents;
  const taxCents = Math.max(
    0,
    Math.round(Number(row.tax_amount_cents ?? 0)),
  );
  const components: [number, number, number] = [
    wineCents,
    shippingCents,
    taxCents,
  ];
  const allocated =
    cumulativeRefundCents === undefined
      ? components
      : allocateCumulativeRefund(components, cumulativeRefundCents);
  return {
    shippingCents: allocated[1],
    taxCents: allocated[2],
    totalCents: allocated.reduce((sum, value) => sum + value, 0),
    wineCents: allocated[0],
  };
}

export function quickBooksRefundDeltaFinancials(
  row: Record<string, unknown>,
  priorRefundAmountCents: number,
  targetRefundAmountCents: number,
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const prior = quickBooksShipmentFinancials(
    { ...row, refund_amount_cents: priorRefundAmountCents },
    true,
  );
  const target = quickBooksShipmentFinancials(
    { ...row, refund_amount_cents: targetRefundAmountCents },
    true,
  );
  return {
    subtotalCents: target.subtotalCents - prior.subtotalCents,
    taxCents: target.taxCents - prior.taxCents,
    totalCents: target.totalCents - prior.totalCents,
  };
}

export function quickBooksRefundDeltaLineFinancials(
  row: Record<string, unknown>,
  priorRefundAmountCents: number,
  targetRefundAmountCents: number,
): QuickBooksLineFinancials {
  const prior = quickBooksShipmentLineFinancials(
    row,
    priorRefundAmountCents,
  );
  const target = quickBooksShipmentLineFinancials(
    row,
    targetRefundAmountCents,
  );
  return {
    shippingCents: target.shippingCents - prior.shippingCents,
    taxCents: target.taxCents - prior.taxCents,
    totalCents: target.totalCents - prior.totalCents,
    wineCents: target.wineCents - prior.wineCents,
  };
}

interface MetaAttributionRuntime {
  browserData: Record<"fbc" | "fbp", string | undefined>;
  customData: {
    campaign_id?: unknown;
    campaign_name?: unknown;
    medium?: unknown;
    source?: unknown;
  } | null;
  eventSourceUrl: string | null;
  id: string | null;
}

async function attributionForMetaEvent(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
  event: Record<string, unknown>,
): Promise<MetaAttributionRuntime> {
  const eventTime = Date.parse(String(event.event_time));
  if (!Number.isFinite(eventTime) || !job.brand_id) {
    return {
      browserData: { fbc: undefined, fbp: undefined },
      customData: null,
      eventSourceUrl: null,
      id: null,
    };
  }
  let query = admin
    .from("meta_attribution_touchpoints")
    .select(
      "id,event_source_url,campaign_id,campaign_name,source,medium,storage_mode,algorithm,envelope_version,key_version,browser_data_ciphertext,browser_data_iv",
    )
    .eq("organization_id", job.organization_id)
    .eq("brand_id", job.brand_id)
    .eq("member_id", event.member_id);
  const linkedId =
    typeof event.attribution_touchpoint_id === "string"
      ? event.attribution_touchpoint_id
      : null;
  query = linkedId
    ? query.eq("id", linkedId)
    : query
        .gte(
          "occurred_at",
          new Date(eventTime - META_ATTRIBUTION_LOOKBACK_MS).toISOString(),
        )
        .lte("occurred_at", new Date(eventTime + 5 * 60 * 1_000).toISOString())
        .order("occurred_at", { ascending: false })
        .limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw databaseError("Meta attribution could not be resolved.");
  }
  if (!data) {
    return {
      browserData: { fbc: undefined, fbp: undefined },
      customData: null,
      eventSourceUrl: null,
      id: null,
    };
  }
  let browserData: Record<"fbc" | "fbp", string | undefined> = {
    fbc: undefined,
    fbp: undefined,
  };
  if (data.storage_mode === "encrypted_envelope") {
    const decrypted = await decryptIntegrationCredentials<MetaBrowserData>(
      env,
      {
        integrationType: "meta_attribution",
        organizationId: job.organization_id,
        targetId: String(data.id),
      },
      {
        algorithm: data.algorithm,
        ciphertext: data.browser_data_ciphertext,
        iv: data.browser_data_iv,
        keyVersion: data.key_version,
        version: data.envelope_version,
      } as EncryptedCredentialEnvelope,
    );
    browserData = normalizeMetaBrowserData(decrypted);
  }
  return {
    browserData,
    customData: data,
    eventSourceUrl:
      typeof data.event_source_url === "string"
        ? data.event_source_url
        : null,
    id: String(data.id),
  };
}

async function executeMetaConversions(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const { client } = await providerForJob(env, admin, job);
  const meta = client as MetaConversionsClient;
  let pendingQuery = admin
    .from("meta_conversion_events")
    .select(
      "id,member_id,event_id,event_name,event_time,action_source,user_data_hashes,custom_data,attribution_touchpoint_id,event_source_url",
    )
    .eq("connection_id", job.connection_id)
    .in("status", ["queued", "retry"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("event_time");
  const oneEventId =
    typeof job.cursor_data.eventId === "string"
      ? job.cursor_data.eventId
      : null;
  if (oneEventId) pendingQuery = pendingQuery.eq("event_id", oneEventId);
  const { data, error } = await pendingQuery.limit(oneEventId ? 1 : 100);
  if (error) throw databaseError("Pending Meta conversions could not be loaded.");
  let sent = 0;
  for (const event of data ?? []) {
    const { data: consent, error: consentError } = await admin
      .from("member_integration_consents")
      .select("consented,revoked_at")
      .eq("organization_id", job.organization_id)
      .eq("brand_id", job.brand_id)
      .eq("member_id", event.member_id)
      .eq("integration_type", "meta")
      .maybeSingle();
    if (consentError) throw databaseError("Meta consent could not be revalidated.");
    if (!consent?.consented || consent.revoked_at) {
      await admin
        .from("meta_conversion_events")
        .update({ status: "dead_letter" })
        .eq("id", event.id)
        .in("status", ["queued", "retry"]);
      continue;
    }
    if (
      event.event_name !== "Lead" &&
      event.event_name !== "Purchase" &&
      event.event_name !== "referral" &&
      event.event_name !== "tier_upgrade"
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "The queued Meta event type is unsupported.",
      );
    }
    const attribution = await attributionForMetaEvent(
      env,
      admin,
      job,
      event,
    );
    const result = await meta.sendHashedConversion({
      browserData: attribution.browserData,
      consented: true,
      customData: metaAttributionCustomData(
        event.custom_data as Record<
          string,
          string | number | boolean | null
        >,
        attribution.customData,
      ),
      eventId: event.event_id,
      eventName: event.event_name,
      eventSourceUrl:
        attribution.eventSourceUrl ??
        (typeof event.event_source_url === "string"
          ? event.event_source_url
          : null),
      eventTime: event.event_time,
      userData: event.user_data_hashes as Record<string, string>,
    });
    const persistedAttributionId =
      attribution.id ??
      (typeof event.attribution_touchpoint_id === "string"
        ? event.attribution_touchpoint_id
        : null);
    const persistedSourceUrl =
      attribution.eventSourceUrl ??
      (typeof event.event_source_url === "string"
        ? event.event_source_url
        : null);
    const { error: persistError } = await admin
      .from("meta_conversion_events")
      .update({
        attribution_touchpoint_id: persistedAttributionId,
        event_source_url: persistedSourceUrl,
        provider_trace_id: result.traceId,
        sent_at: new Date().toISOString(),
        status: "completed",
      })
      .eq("id", event.id)
      .eq("connection_id", job.connection_id)
      .in("status", ["queued", "retry"]);
    if (persistError) {
      throw databaseError("The Meta provider acknowledgement could not be persisted.");
    }
    sent += 1;
  }
  if ((data ?? []).length === 100) {
    const lastId = String((data ?? []).at(-1)?.id ?? "");
    const { error: nextError } = await admin.rpc(
      "enqueue_integration_sync_job",
      {
        p_connection_id: job.connection_id,
        p_cursor_data: { afterEventId: lastId },
        p_direction: "outbound",
        p_entity_id: lastId,
        p_entity_type: "conversion_page",
        p_idempotency_key: `meta-page:${job.connection_id}:${lastId}`,
        p_max_attempts: 8,
        p_payload: {},
        p_sync_type: "conversions.pending",
      },
    );
    if (nextError) throw databaseError("The next Meta conversion page could not be queued.");
  }
  return successfulIntegrationJob({ processed: sent });
}

function previousCalendarMonth(asOf: Date): {
  periodEnd: string;
  periodStart: string;
} {
  const start = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 1, 1),
  );
  const end = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 0),
  );
  return {
    periodEnd: end.toISOString().slice(0, 10),
    periodStart: start.toISOString().slice(0, 10),
  };
}

async function executeQuickBooksReconciliation(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const { client } = await providerForJob(env, admin, job);
  const quickbooks = client as QuickBooksClient;
  const asOf =
    typeof job.cursor_data.asOf === "string" &&
    Number.isFinite(Date.parse(job.cursor_data.asOf))
      ? new Date(job.cursor_data.asOf)
      : new Date();
  const { periodEnd, periodStart } = previousCalendarMonth(asOf);
  let viniferaTotalCents = 0;
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await admin
      .from("quickbooks_transaction_mappings")
      .select("amount_cents,transaction_type")
      .eq("connection_id", job.connection_id)
      .eq("organization_id", job.organization_id)
      .eq("brand_id", job.brand_id)
      .gte("transaction_date", periodStart)
      .lte("transaction_date", periodEnd)
      .order("id")
      .range(offset, offset + 999);
    if (error) {
      throw databaseError("Vinifera reconciliation rows could not be loaded.");
    }
    for (const row of data ?? []) {
      const amount = Number(row.amount_cents ?? 0);
      viniferaTotalCents +=
        row.transaction_type === "refund" ||
        row.transaction_type === "credit_memo"
          ? -amount
          : amount;
    }
    if ((data ?? []).length < 1_000) break;
  }
  const quickbooksTotalCents = await quickbooks.getNetTransactionTotal(
    periodStart,
    periodEnd,
  );
  const { error } = await admin.from("quickbooks_reconciliations").upsert(
    {
      brand_id: job.brand_id,
      connection_id: job.connection_id,
      organization_id: job.organization_id,
      period_end: periodEnd,
      period_start: periodStart,
      quickbooks_total_cents: quickbooksTotalCents,
      vinifera_total_cents: viniferaTotalCents,
    },
    { onConflict: "connection_id,brand_id,period_start,period_end" },
  );
  if (error) {
    throw databaseError("QuickBooks reconciliation could not be persisted.");
  }
  return successfulIntegrationJob({ processed: 1 });
}

async function avalaraShipmentRows(
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<ShipmentPaymentRow[]> {
  let query = admin
    .from("shipments")
    .select(
      "id,organization_id,brand_id,member_id,release_id,status,charge_amount_cents,loyalty_discount_cents,loyalty_redemption_id,retry_count,stripe_payment_intent_id,tax_amount_cents",
    )
    .eq("organization_id", job.organization_id)
    .eq("brand_id", job.brand_id)
    .in("status", ["pending", "declined"])
    .order("id")
    .limit(job.sync_type === "avalara.tax.calculate" ? 1 : 100);
  if (job.sync_type === "avalara.tax.calculate" && job.entity_id) {
    query = query.eq("id", job.entity_id);
  } else if (typeof job.cursor_data.afterShipmentId === "string") {
    query = query.gt("id", job.cursor_data.afterShipmentId);
  }
  const { data, error } = await query;
  if (error) throw databaseError("Avalara shipment work could not be loaded.");
  return (data ?? []) as ShipmentPaymentRow[];
}

async function executeAvalaraCalculate(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const rows = await avalaraShipmentRows(admin, job);
  let processed = 0;
  for (const shipment of rows) {
    await prepareAvalaraTax(env, admin, shipment);
    processed += 1;
  }
  if (job.sync_type === "avalara.tax.bootstrap" && rows.length === 100) {
    const afterShipmentId = rows.at(-1)?.id;
    const { error } = await admin.rpc("enqueue_integration_sync_job", {
      p_connection_id: job.connection_id,
      p_cursor_data: { afterShipmentId },
      p_direction: "outbound",
      p_entity_id: afterShipmentId,
      p_entity_type: "shipment_page",
      p_idempotency_key: `avalara-bootstrap:${job.connection_id}:${afterShipmentId}`,
      p_max_attempts: 8,
      p_payload: {},
      p_sync_type: "avalara.tax.bootstrap",
    });
    if (error) {
      throw databaseError("The next Avalara bootstrap page could not be queued.");
    }
  }
  return successfulIntegrationJob({ processed });
}

async function executeAvalaraReconciliation(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const { client } = await providerForJob(env, admin, job);
  const avalara = client as AvalaraClient;
  const { data: calculations, error } = await admin
    .from("avalara_tax_calculations")
    .select(
      "id,shipment_id,provider_transaction_code,document_code,currency_code,taxable_basis_cents,exempt_amount_cents,tax_amount_cents,shipping_tax_cents,jurisdiction_summary,request_hash",
    )
    .eq("connection_id", job.connection_id)
    .eq("organization_id", job.organization_id)
    .eq("brand_id", job.brand_id)
    .eq("document_status", "temporary")
    .eq("document_type", "SalesInvoice")
    .order("created_at")
    .limit(100);
  if (error) {
    throw databaseError("Temporary Avalara calculations could not be loaded.");
  }
  const shipmentIds = (calculations ?? []).map((row) =>
    String(row.shipment_id),
  );
  const { data: shipments, error: shipmentError } = shipmentIds.length
    ? await admin
        .from("shipments")
        .select("id,status")
        .eq("organization_id", job.organization_id)
        .eq("brand_id", job.brand_id)
        .in("id", shipmentIds)
    : { data: [], error: null };
  if (shipmentError) {
    throw databaseError("Avalara shipment state could not be reconciled.");
  }
  const statusByShipment = new Map(
    (shipments ?? []).map((row) => [String(row.id), String(row.status)]),
  );
  let processed = 0;
  for (const calculation of calculations ?? []) {
    const shipmentStatus = statusByShipment.get(
      String(calculation.shipment_id),
    );
    const documentStatus =
      shipmentStatus &&
      [
        "charged",
        "label_created",
        "packed",
        "shipped",
        "delivered",
      ].includes(shipmentStatus)
        ? "committed"
        : shipmentStatus === "declined" || shipmentStatus === "cancelled"
          ? "voided"
          : null;
    if (!documentStatus) continue;
    const providerTransactionCode = String(
      calculation.provider_transaction_code,
    );
    const providerStatus = (
      await avalara.getTransactionStatus(providerTransactionCode)
    ).toLowerCase();
    if (
      documentStatus === "committed" &&
      providerStatus !== "committed"
    ) {
      await avalara.commitTransaction(providerTransactionCode);
    } else if (
      documentStatus === "voided" &&
      providerStatus !== "cancelled" &&
      providerStatus !== "voided"
    ) {
      await avalara.voidTransaction(providerTransactionCode);
    }
    const { error: persistError } = await admin.rpc(
      "record_avalara_tax_calculation",
      {
        p_connection_id: job.connection_id,
        p_currency_code: calculation.currency_code,
        p_document_code: calculation.document_code,
        p_document_status: documentStatus,
        p_exempt_amount_cents: calculation.exempt_amount_cents,
        p_jurisdiction_summary: calculation.jurisdiction_summary,
        p_provider_transaction_code:
          calculation.provider_transaction_code,
        p_request_hash: calculation.request_hash,
        p_response_hash: await sha256(
          JSON.stringify({
            calculationId: calculation.id,
            documentStatus,
          }),
        ),
        p_shipment_id: calculation.shipment_id,
        p_shipping_tax_cents: calculation.shipping_tax_cents,
        p_tax_amount_cents: calculation.tax_amount_cents,
        p_taxable_basis_cents: calculation.taxable_basis_cents,
      },
    );
    if (persistError) {
      throw databaseError("Avalara reconciliation could not be persisted.");
    }
    processed += 1;
  }
  return successfulIntegrationJob({ processed });
}

async function executeAvalaraFilingVerification(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const { client } = await providerForJob(env, admin, job);
  const result = await (client as AvalaraClient).getFilingRegistrationStatus();
  const registrations = result.registrations
    .map((registration) => ({
      filing_calendar_id: registration.filingCalendarId,
      filing_frequency: registration.filingFrequency,
      region_code: registration.regionCode,
      registration_status: registration.status,
    }))
    .sort(
      (left, right) =>
        left.filing_calendar_id - right.filing_calendar_id,
    );
  const { error } = await admin.rpc(
    "replace_avalara_filing_registration_snapshot",
    {
      p_connection_id: job.connection_id,
      p_registrations: registrations,
      p_response_hash: await sha256(JSON.stringify(registrations)),
      p_snapshot_id: job.job_id,
      p_verified_at: result.verifiedAt,
    },
  );
  if (error) {
    throw databaseError("Avalara filing verification could not be persisted.");
  }
  return successfulIntegrationJob({ processed: registrations.length });
}

async function executeAvalaraRefund(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  if (!job.entity_id) {
    throw new IntegrationProviderError(
      "provider_rejected_request",
      422,
      false,
    );
  }
  const { client } = await providerForJob(env, admin, job);
  const avalara = client as AvalaraClient;
  const [
    { data: shipment, error: shipmentError },
    { data: original, error: originalError },
  ] = await Promise.all([
    admin
      .from("shipments")
      .select(
        "id,charge_amount_cents,loyalty_discount_cents,tax_amount_cents,refund_amount_cents,refunded_at,updated_at",
      )
      .eq("id", job.entity_id)
      .eq("organization_id", job.organization_id)
      .eq("brand_id", job.brand_id)
      .maybeSingle(),
    admin
      .from("avalara_tax_calculations")
      .select("provider_transaction_code,currency_code")
      .eq("connection_id", job.connection_id)
      .eq("organization_id", job.organization_id)
      .eq("brand_id", job.brand_id)
      .eq("shipment_id", job.entity_id)
      .eq("document_type", "SalesInvoice")
      .eq("document_status", "committed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (shipmentError || originalError) {
    throw databaseError("The Avalara refund source could not be loaded.");
  }
  if (!shipment || !original) {
    throw new IntegrationProviderError("provider_not_found", 404, false);
  }
  const payableCents = Math.max(
    0,
    Number(shipment.charge_amount_cents ?? 0) -
      Number(shipment.loyalty_discount_cents ?? 0) +
      Number(shipment.tax_amount_cents ?? 0),
  );
  const currentRefundCents = Math.max(
    0,
    Math.min(payableCents, Number(shipment.refund_amount_cents ?? 0)),
  );
  const payloadRefundCents = Number(job.payload.refund_amount_cents);
  const targetRefundCents =
    Number.isFinite(payloadRefundCents) && payloadRefundCents >= 0
      ? Math.min(currentRefundCents, payloadRefundCents)
      : currentRefundCents;
  if (targetRefundCents === 0) {
    return successfulIntegrationJob({ processed: 0 });
  }
  const deliveryClaim = await claimRefundDelivery(
    admin,
    job,
    String(shipment.id),
    targetRefundCents,
  );
  if (deliveryClaim.outcome === "blocked") {
    return blockedRefundDelivery(job, deliveryClaim.retryAfter);
  }
  if (deliveryClaim.outcome === "already_delivered") {
    return successfulIntegrationJob({ processed: 0 });
  }
  if (!deliveryClaim.leaseToken) {
    throw databaseError("The Avalara refund delivery lease is invalid.");
  }

  let request: {
    refundDate: string;
    refundPercentage: number | undefined;
    refundTransactionCode: string;
    refundType: "Full" | "Percentage";
    referenceCode: string;
  };
  let requestHash: string;
  try {
    const fullRefund =
      deliveryClaim.priorCumulativeAmountCents === 0 &&
      deliveryClaim.targetCumulativeAmountCents >= payableCents;
    const compactShipmentId = String(shipment.id)
      .replaceAll("-", "")
      .slice(0, 24);
    const refundCode =
      `VINR-${compactShipmentId}-${deliveryClaim.targetCumulativeAmountCents}`;
    request = {
      refundDate: String(
        shipment.refunded_at ?? shipment.updated_at,
      ).slice(0, 10),
      refundPercentage: fullRefund
        ? undefined
        : Number(
            (
              (deliveryClaim.deltaAmountCents / payableCents) *
              100
            ).toFixed(6),
          ),
      refundTransactionCode: refundCode,
      refundType: fullRefund ? "Full" : "Percentage",
      referenceCode: `Vinifera shipment ${shipment.id}`,
    };
    requestHash = await sha256(
      JSON.stringify({
        originalTransactionCode: original.provider_transaction_code,
        providerRequestKey: deliveryClaim.providerRequestKey,
        request,
      }),
    );
  } catch (error) {
    await releaseRefundDelivery(
      admin,
      job,
      String(shipment.id),
      deliveryClaim.leaseToken,
    );
    throw error;
  }

  const result = await avalara.refundTransaction(
    String(original.provider_transaction_code),
    request,
    { reconcileFirst: deliveryClaim.reclaimed },
  );
  if (result.totalCents !== deliveryClaim.deltaAmountCents) {
    throw new IntegrationProviderError(
      "provider_refund_amount_mismatch",
      502,
      true,
    );
  }
  const { error: completeError } = await admin.rpc(
    "complete_avalara_refund_delivery",
    {
      p_connection_id: job.connection_id,
      p_currency_code: original.currency_code ?? "USD",
      p_document_code: result.code,
      p_jurisdiction_summary: result.jurisdictionSummary,
      p_lease_token: deliveryClaim.leaseToken,
      p_request_hash: requestHash,
      p_response_hash: await sha256(JSON.stringify(result)),
      p_shipment_id: shipment.id,
      p_tax_amount_cents: result.taxCents,
      p_taxable_basis_cents: Math.max(
        0,
        result.totalCents - result.taxCents,
      ),
    },
  );
  if (completeError) {
    throw databaseError("The Avalara refund delivery could not be finalized.");
  }
  return successfulIntegrationJob({ processed: 1 });
}

async function executeMetaEvent(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  const memberId =
    typeof job.payload.member_id === "string"
      ? job.payload.member_id
      : job.sync_type !== "meta.event.purchase"
        ? job.entity_id
        : null;
  let shipment: Record<string, unknown> | null = null;
  let resolvedMemberId = memberId;
  if (job.sync_type === "meta.event.purchase" && job.entity_id) {
    const { data, error } = await admin
      .from("shipments")
      .select(
        "id,member_id,charge_amount_cents,loyalty_discount_cents,tax_amount_cents,paid_at,updated_at",
      )
      .eq("id", job.entity_id)
      .eq("organization_id", job.organization_id)
      .eq("brand_id", job.brand_id)
      .maybeSingle();
    if (error) throw databaseError("The Meta purchase source could not be loaded.");
    shipment = data as Record<string, unknown> | null;
    resolvedMemberId =
      typeof shipment?.member_id === "string"
        ? shipment.member_id
        : resolvedMemberId;
  }
  if (!resolvedMemberId) {
    throw new IntegrationProviderError(
      "provider_rejected_request",
      422,
      false,
    );
  }
  const [{ data: consent, error: consentError }, { data: member, error }] =
    await Promise.all([
      admin
        .from("member_integration_consents")
        .select("consented,revoked_at,updated_at")
        .eq("organization_id", job.organization_id)
        .eq("brand_id", job.brand_id)
        .eq("member_id", resolvedMemberId)
        .eq("integration_type", "meta")
        .maybeSingle(),
      admin
        .from("members")
        .select(
          "id,email,phone,first_name,last_name,birthday,shipping_city,shipping_region,shipping_postal_code,shipping_country_code,updated_at",
        )
        .eq("id", resolvedMemberId)
        .eq("organization_id", job.organization_id)
        .eq("brand_id", job.brand_id)
        .maybeSingle(),
    ]);
  if (consentError || error) {
    throw databaseError("The Meta conversion source could not be loaded.");
  }
  if (!consent?.consented || consent.revoked_at || !member) {
    return successfulIntegrationJob({ processed: 0 });
  }
  const eventName =
    job.sync_type === "meta.event.purchase"
      ? "Purchase"
      : job.sync_type === "meta.event.lead"
        ? "Lead"
        : job.sync_type === "meta.event.referral"
          ? "referral"
          : "tier_upgrade";
  const eventIdentityHash = await sha256(job.idempotency_key);
  const eventId = `vinifera:${eventName}:${eventIdentityHash.slice(0, 40)}`;
  const hashesWithArrays = await buildHashedMetaUserData({
    city: member.shipping_city,
    country: member.shipping_country_code,
    dateOfBirth: member.birthday,
    email: member.email,
    externalId: member.id,
    firstName: member.first_name,
    lastName: member.last_name,
    phone: member.phone,
    state: member.shipping_region,
    zip: member.shipping_postal_code,
  });
  const userDataHashes = Object.fromEntries(
    Object.entries(hashesWithArrays).flatMap(([key, values]) =>
      values[0] ? [[key, values[0]]] : [],
    ),
  );
  const eventTime = String(
    shipment?.paid_at ??
      shipment?.updated_at ??
      (eventName === "Lead" ? consent.updated_at : null) ??
      member.updated_at,
  );
  const customData =
    eventName === "Purchase"
      ? {
          currency: "USD",
          value: metaPurchaseValue(shipment),
        }
      : {};
  const { error: insertError } = await admin
    .from("meta_conversion_events")
    .upsert(
      {
        action_source: "website",
        brand_id: job.brand_id,
        connection_id: job.connection_id,
        custom_data: customData,
        event_id: eventId,
        event_name: eventName,
        event_time: eventTime,
        member_id: resolvedMemberId,
        organization_id: job.organization_id,
        status: "queued",
        user_data_hashes: userDataHashes,
      },
      { ignoreDuplicates: true, onConflict: "connection_id,event_id" },
    );
  if (insertError) {
    throw databaseError("The Meta conversion could not be queued.");
  }
  return executeMetaConversions(env, admin, {
    ...job,
    cursor_data: { ...job.cursor_data, eventId },
  });
}

export function metaPurchaseValue(
  shipment: Record<string, unknown> | null,
): number {
  return (
    Math.max(
      0,
      Number(shipment?.charge_amount_cents ?? 0) -
        Number(shipment?.loyalty_discount_cents ?? 0),
    ) /
      100 +
    Math.max(0, Number(shipment?.tax_amount_cents ?? 0)) / 100
  );
}

export type IntegrationJobKind =
  | "avalara_calculate"
  | "avalara_filing_verify"
  | "avalara_refund"
  | "avalara_reconcile"
  | "connection_validate"
  | "klaviyo_engagement"
  | "klaviyo_profiles"
  | "meta_conversions"
  | "meta_event"
  | "quickbooks_reconciliation"
  | "quickbooks_transactions";

export function integrationJobKind(
  integrationType: IntegrationType,
  syncType: string,
): IntegrationJobKind {
  if (syncType === "connection.validate") return "connection_validate";
  if (
    integrationType === "klaviyo" &&
    [
      "klaviyo.profiles.bootstrap",
      "klaviyo.profile.upsert",
      "profiles.full",
      "profiles.page",
    ].includes(syncType)
  ) {
    return "klaviyo_profiles";
  }
  if (integrationType === "klaviyo" && syncType === "engagement.poll") {
    return "klaviyo_engagement";
  }
  if (
    integrationType === "quickbooks" &&
    [
      "quickbooks.transactions.bootstrap",
      "quickbooks.transaction.upsert",
      "transactions.full",
      "transactions.page",
    ].includes(syncType)
  ) {
    return "quickbooks_transactions";
  }
  if (
    integrationType === "quickbooks" &&
    syncType === "reconciliation.monthly"
  ) {
    return "quickbooks_reconciliation";
  }
  if (
    integrationType === "avalara" &&
    ["avalara.tax.bootstrap", "avalara.tax.calculate"].includes(syncType)
  ) {
    return "avalara_calculate";
  }
  if (integrationType === "avalara" && syncType === "tax.reconcile") {
    return "avalara_reconcile";
  }
  if (integrationType === "avalara" && syncType === "filing.verify") {
    return "avalara_filing_verify";
  }
  if (integrationType === "avalara" && syncType === "avalara.tax.refund") {
    return "avalara_refund";
  }
  if (integrationType === "meta" && syncType === "conversions.pending") {
    return "meta_conversions";
  }
  if (integrationType === "meta" && syncType.startsWith("meta.event.")) {
    if (
      ![
        "meta.event.lead",
        "meta.event.purchase",
        "meta.event.referral",
        "meta.event.tier_upgrade",
      ].includes(syncType)
    ) {
      throw new IntegrationProviderError(
        "provider_rejected_request",
        422,
        false,
      );
    }
    return "meta_event";
  }
  throw new IntegrationProviderError(
    "provider_rejected_request",
    422,
    false,
  );
}

export async function executeIntegrationJob(
  env: WorkerEnv,
  admin: SupabaseClient,
  job: ClaimedIntegrationJob,
): Promise<IntegrationJobCompletion> {
  switch (integrationJobKind(job.integration_type, job.sync_type)) {
    case "connection_validate":
      return executeConnectionValidation(env, admin, job);
    case "klaviyo_profiles":
      return executeKlaviyoProfiles(env, admin, job);
    case "klaviyo_engagement":
      return executeKlaviyoEngagement(env, admin, job);
    case "quickbooks_transactions":
      return executeQuickBooksTransactions(env, admin, job);
    case "quickbooks_reconciliation":
      return executeQuickBooksReconciliation(env, admin, job);
    case "avalara_calculate":
      return executeAvalaraCalculate(env, admin, job);
    case "avalara_reconcile":
      return executeAvalaraReconciliation(env, admin, job);
    case "avalara_filing_verify":
      return executeAvalaraFilingVerification(env, admin, job);
    case "avalara_refund":
      return executeAvalaraRefund(env, admin, job);
    case "meta_conversions":
      return executeMetaConversions(env, admin, job);
    case "meta_event":
      return executeMetaEvent(env, admin, job);
  }
}

async function enqueueScheduledIntegrationWork(
  admin: SupabaseClient,
  asOf: Date,
): Promise<void> {
  const { data, error } = await admin
    .from("integration_connections")
    .select("id,brand_id,integration_type,sync_config")
    .eq("status", "active")
    .eq("opted_in", true);
  if (error) throw databaseError("Active integrations could not be scheduled.");
  const hourKey = asOf.toISOString().slice(0, 13);
  const dayKey = asOf.toISOString().slice(0, 10);
  const monthKey = dayKey.slice(0, 7);
  for (const connection of data ?? []) {
    const type = connection.integration_type as IntegrationType;
    if (
      type !== "klaviyo" &&
      type !== "quickbooks" &&
      type !== "meta" &&
      type !== "avalara"
    ) {
      continue;
    }
    const jobs =
      type === "klaviyo"
        ? [
            {
              direction: "inbound",
              key: `engagement:${connection.id}:${hourKey}`,
              syncType: "engagement.poll",
            },
          ]
        : type === "quickbooks"
          ? [
              {
                direction: "outbound",
                key: `transactions:${connection.id}:${dayKey}`,
                syncType: "transactions.full",
              },
              ...(asOf.getUTCDate() === 1
                ? [
                    {
                      direction: "outbound",
                      key: `reconciliation:${connection.id}:${monthKey}`,
                      syncType: "reconciliation.monthly",
                    },
                  ]
                : []),
            ]
          : type === "meta"
            ? [
                {
                  direction: "outbound",
                  key: `conversions:${connection.id}:${hourKey}`,
                  syncType: "conversions.pending",
                },
              ]
            : [
                {
                  direction: "outbound",
                  key: `tax-reconcile:${connection.id}:${dayKey}`,
                  syncType: "tax.reconcile",
                },
                ...(
                  connection.sync_config &&
                  typeof connection.sync_config === "object" &&
                  !Array.isArray(connection.sync_config) &&
                  (connection.sync_config as Record<string, unknown>)
                    .filingEnabled === true
                    ? [
                        {
                          direction: "inbound",
                          key: `filing:${connection.id}:${dayKey}`,
                          syncType: "filing.verify",
                        },
                      ]
                    : []
                ),
              ];
    for (const job of jobs) {
      const { error: queueError } = await admin.rpc(
        "enqueue_integration_sync_job",
        {
          p_connection_id: connection.id,
          p_cursor_data:
            job.syncType === "reconciliation.monthly"
              ? { asOf: asOf.toISOString() }
              : {},
          p_direction: job.direction,
          p_entity_id: connection.brand_id,
          p_entity_type: "brand",
          p_idempotency_key: job.key,
          p_max_attempts: 8,
          p_payload: {},
          p_sync_type: job.syncType,
        },
      );
      if (queueError) throw databaseError("Scheduled integration work could not be queued.");
    }
  }
}

export async function runIntegrationSchedule(
  env: WorkerEnv,
  asOf = new Date(),
): Promise<IntegrationDrainReport> {
  const admin = integrationAdmin(env);
  await enqueueScheduledIntegrationWork(admin, asOf);
  return drainIntegrationJobs(env, asOf, admin);
}

export interface IntegrationDrainReport {
  claimed: number;
  continueImmediately: boolean;
  deadLettered: number;
  nextWakeDelaySeconds: number | null;
  processed: number;
  retried: number;
}

export const INTEGRATION_DRAIN_CLAIM_LIMIT = 1;

export function integrationWakeDelaySeconds(input: {
  asOf: Date;
  retryTimes: string[];
}): number | null {
  const nextRetryAt = input.retryTimes
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  if (nextRetryAt === undefined) return null;
  return Math.min(
    12 * 60 * 60,
    Math.max(0, Math.ceil((nextRetryAt - input.asOf.getTime()) / 1_000)),
  );
}

export function failedClaimedIntegrationJob(
  job: { attempt_count: number; max_attempts: number },
  error: unknown,
  asOf: Date,
): IntegrationJobCompletion {
  return failedIntegrationJob({
    asOf,
    attempt: job.attempt_count,
    error,
    maxAttempts: job.max_attempts,
  });
}

export async function drainIntegrationJobs(
  env: WorkerEnv,
  asOf = new Date(),
  admin = integrationAdmin(env),
  claimLimit = INTEGRATION_DRAIN_CLAIM_LIMIT,
): Promise<IntegrationDrainReport> {
  // Queue messages are intentionally only wake signals. Every invocation must
  // claim the authoritative PostgreSQL rows so duplicate delivery is harmless.
  // Claiming one provider job per invocation prevents a serial batch from
  // holding leases that can expire before later jobs begin.
  const { data, error } = await admin.rpc("claim_integration_sync_jobs", {
    p_as_of: asOf.toISOString(),
    p_lease_seconds: 120,
    p_limit: claimLimit,
    p_worker: "vinifera-phase5-integrations",
  });
  if (error) throw databaseError("Integration jobs could not be claimed.");
  const claimedJobs = (data ?? []) as ClaimedIntegrationJob[];
  const retryTimes: string[] = [];
  const report: IntegrationDrainReport = {
    claimed: claimedJobs.length,
    continueImmediately: false,
    deadLettered: 0,
    nextWakeDelaySeconds: null,
    processed: 0,
    retried: 0,
  };
  for (const job of claimedJobs) {
    const started = Date.now();
    let completion: IntegrationJobCompletion;
    try {
      completion = await executeIntegrationJob(env, admin, job);
    } catch (jobError) {
      completion = failedClaimedIntegrationJob(job, jobError, asOf);
      if (job.sync_type === "connection.validate") {
        const { error: healthError } = await admin.rpc(
          "set_integration_health",
          {
            p_connection_id: job.connection_id,
            p_error_code:
              completion.errorCode?.toUpperCase() ?? "UPSTREAM_ERROR",
            p_status: "degraded",
          },
        );
        if (healthError) {
          console.error(
            JSON.stringify({
              code: healthError.code ?? "upstream_error",
              connectionId: job.connection_id,
              event: "integration.health_update_failed",
              jobId: job.job_id,
            }),
          );
        }
      }
    }
    const { error: completeError } = await admin.rpc(
      "complete_integration_sync_job",
      {
        p_cursor_data: completion.providerCursor,
        p_duration_ms: Math.max(0, Date.now() - started),
        p_error_code: completion.errorCode?.toUpperCase() ?? null,
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_next_attempt_at: completion.nextAttemptAt,
        p_outcome: completion.outcome,
        p_records_failed: completion.failed,
        p_records_read: completion.processed + completion.failed,
        p_records_written: completion.processed,
      },
    );
    if (completeError) {
      throw databaseError("The integration job outcome could not be persisted.");
    }
    report.processed += completion.processed;
    if (completion.outcome === "retry") {
      report.retried += 1;
      if (completion.nextAttemptAt) retryTimes.push(completion.nextAttemptAt);
    }
    if (completion.outcome === "dead_letter") report.deadLettered += 1;
  }
  report.continueImmediately = claimedJobs.length >= claimLimit;
  report.nextWakeDelaySeconds = integrationWakeDelaySeconds({
    asOf: new Date(),
    retryTimes,
  });
  return report;
}
