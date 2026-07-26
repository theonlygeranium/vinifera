import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import { AppError, requireConfigured } from "../lib/errors";
import { getConfigurationReport } from "../config";
import type {
  CancelFlowOutcome,
  EmailTemplateInput,
  EmailTriggerType,
  MemberPrincipal,
  RetentionService,
  StaffPrincipal,
  WorkerEnv,
} from "../types";
import { formatBrandSender } from "../integrations/resend-domains";
import { ProductionCoreClubService } from "./core-club";

const RESEND_API_ORIGIN = "https://api.resend.com";
const EMAIL_BATCH_LIMIT = 100;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const DAILY_JOB_UTC_HOUR = 8;
const EMAIL_TRIGGERS: readonly EmailTriggerType[] = [
  "welcome",
  "pre_shipment",
  "payment_decline",
  "shipped",
  "birthday",
  "re_engagement",
];

interface ClaimedEmail {
  attempt_count: number;
  brand_id?: string | null;
  body: string;
  email_log_id: string;
  member_id: string | null;
  organization_id: string;
  outbox_id: string;
  payload: Record<string, unknown> | null;
  sender_from_email?: string | null;
  sender_from_name?: string | null;
  sender_identity_id?: string | null;
  sender_status?: "disabled" | "failed" | "pending" | "verified" | null;
  subject: string;
  to_email: string;
  trigger_type: EmailTriggerType;
}

interface OutgoingEmail {
  attachments?: EmailAttachment[];
  from?: string;
  headers?: Record<string, string>;
  html: string;
  subject: string;
  to: string;
}

export interface EmailAttachment {
  contentBase64: string;
  contentType: "application/pdf" | "text/csv";
  filename: string;
}

export interface EmailBatchResult {
  id: string;
}

export interface TransactionalEmailProvider {
  sendBatch(
    messages: OutgoingEmail[],
    idempotencyKey: string,
  ): Promise<EmailBatchResult[]>;
}

export interface ChurnInputs {
  declinesLast12Months: number;
  daysSinceInteraction: number | null;
  daysSincePortalLogin: number | null;
  emailClickRate90Days: number | null;
  emailOpenRate90Days: number | null;
  membershipDays: number;
  tierDowngradesLast12Months: number;
}

export interface ChurnFactor {
  evidence: string;
  key: keyof ChurnInputs;
  label: string;
  points: number;
}

export interface ChurnScore {
  contributingFactors: ChurnFactor[];
  riskLevel: "low" | "medium" | "high";
  score: number;
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

function databaseError(message: string): AppError {
  return new AppError(500, "upstream_error", message);
}

function assertUuid(value: string, label: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new AppError(400, "invalid_request", `${label} is invalid.`);
  }
}

function camelKey(value: string): string {
  return value.replace(/_([a-z])/g, (_, character: string) =>
    character.toUpperCase(),
  );
}

function toPublicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPublicValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (
      /(?:secret|password|raw_payload|provider_payload|lease_token|access_token|refresh_token)/i.test(
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

function returnedRpcRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : null;
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function toPublicCancelStep(value: Record<string, unknown>): Record<string, unknown> {
  const stepType = String(value.step_type ?? "");
  return {
    body: value.body ?? null,
    description: value.body ?? null,
    enabled: Boolean(value.enabled),
    headline: value.headline ?? null,
    id: stepType,
    order: Number(value.position ?? 0),
    position: Number(value.position ?? 0),
    stepId: value.id,
    title: value.headline ?? null,
  };
}

function oneRelation(
  value: Record<string, unknown> | Array<Record<string, unknown>> | null | undefined,
): Record<string, unknown> | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function memberName(member: Record<string, unknown> | null): string {
  if (!member) return "Unknown member";
  return `${String(member.first_name ?? "")} ${String(
    member.last_name ?? "",
  )}`.trim() || "Unknown member";
}

function normalizeChurnFactors(value: unknown): Array<Record<string, unknown>> {
  const labels: Record<string, string> = {
    declined_charges_12m: "Payment declines",
    email_engagement_90d: "Email engagement",
    membership_tenure: "Membership tenure",
    portal_activity: "Portal activity",
    shipment_inactivity: "Shipment interaction",
    tier_downgrades_12m: "Tier downgrades",
  };
  const rawFactors = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>)
          .filter(([id]) => !["base_score", "rules_version"].includes(id))
          .map(([id, factor]) => ({
            ...(factor && typeof factor === "object"
              ? (factor as Record<string, unknown>)
              : { detail: String(factor ?? "") }),
            id,
          }))
      : [];
  return rawFactors.map((raw, index) => {
    const factor =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : { detail: String(raw) };
    const points = Number(factor.points ?? factor.weight ?? 0);
    const id = String(factor.id ?? factor.key ?? `factor-${index + 1}`);
    const detail =
      factor.detail ??
      factor.evidence ??
      (factor.days !== undefined
        ? `${factor.days} day(s)`
        : factor.count !== undefined
          ? `${factor.count} event(s) in the scoring window`
          : factor.last_login_at
            ? `Last portal login ${factor.last_login_at}`
            : factor.sent !== undefined
              ? `${factor.engaged ?? 0} engaged of ${factor.sent} sent`
              : "No recent activity was recorded");
    return {
      detail: String(detail),
      direction: points < 0 ? "lowers" : "raises",
      id,
      label: String(factor.label ?? labels[id] ?? id.replaceAll("_", " ")),
      points,
    };
  });
}

function toChurnDto(row: Record<string, unknown>): Record<string, unknown> {
  const member = oneRelation(
    row.members as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null,
  );
  const tier = oneRelation(
    member?.club_tiers as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | null,
  );
  return {
    calculatedAt: row.calculated_at,
    contributingFactors: normalizeChurnFactors(row.contributing_factors),
    email: member?.email ?? null,
    memberId: row.member_id,
    memberName: memberName(member),
    riskLevel: row.risk_level,
    score: Number(row.score ?? 0),
    tierName: tier?.name ?? null,
  };
}

function loyaltyEntryType(row: Record<string, unknown>): string {
  const source = String(row.source_event_type ?? "");
  if (
    [
      "shipment_delivered",
      "event_attendance",
      "referral_completed",
      "birthday",
      "anniversary",
    ].includes(source)
  ) {
    return source
      .replace("_delivered", "")
      .replace("_attendance", "")
      .replace("_completed", "");
  }
  const entry = String(row.entry_type ?? "");
  if (entry === "expiration") return "expiration";
  if (entry === "manual_adjustment") return "adjustment";
  if (entry === "reservation") return "redemption";
  if (entry === "reservation_release") return "redemption";
  return "adjustment";
}

function encodeBase64Url(value: Uint8Array | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AppError(400, "invalid_request", "The link is invalid.");
  }
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("hex");
}

async function hmac(
  secret: string,
  value: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeHref(value: string): string | null {
  const candidate = value.trim();
  if (/^mailto:[^<>\s]+$/i.test(candidate)) return candidate;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A deliberately small HTML allowlist. Template authors can use basic semantic
 * markup, while scripts, remote assets, inline CSS and event handlers never
 * reach an email client.
 */
export function sanitizeTemplateHtml(input: string): string {
  const withoutBlockedContent = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|iframe|object|embed|form|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    );
  const allowed = new Set([
    "a",
    "blockquote",
    "br",
    "caption",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "li",
    "ol",
    "p",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
  ]);

  return withoutBlockedContent.replace(
    /<\/?([a-z][a-z0-9-]*)\b([^>]*)>/gi,
    (original: string, rawName: string, rawAttributes: string) => {
      const name = rawName.toLowerCase();
      if (!allowed.has(name)) return "";
      if (original.startsWith("</")) return `</${name}>`;
      if (name === "br") return "<br>";
      if (name !== "a") return `<${name}>`;
      const hrefMatch = rawAttributes.match(
        /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
      );
      const href = safeHref(
        hrefMatch?.slice(1).find((candidate) => candidate !== undefined) ?? "",
      );
      return href
        ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">`
        : "<a>";
    },
  );
}

function interpolate(
  value: string,
  variables: Record<string, string>,
): string {
  return value.replace(/\{\{([a-z][a-z0-9_]*)\}\}/gi, (_match, key: string) =>
    escapeHtml(variables[key] ?? ""),
  );
}

function safeSubject(
  value: string,
  variables: Record<string, string>,
): string {
  return value
    .replace(
      /\{\{([a-z][a-z0-9_]*)\}\}/gi,
      (_match, key: string) =>
        (variables[key] ?? "").replace(/[<>\r\n\0]/g, " "),
    )
    .replace(/[<>\r\n\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function sanitizeTemplateSubject(value: string): string {
  return value
    .replace(/[<>\r\n\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function renderTransactionalEmail(input: {
  body: string;
  organizationName: string;
  subject: string;
  unsubscribeUrl: string;
  variables?: Record<string, string>;
}): { html: string; subject: string } {
  const variables = input.variables ?? {};
  const body = interpolate(sanitizeTemplateHtml(input.body), variables);
  const organizationName = escapeHtml(input.organizationName);
  const unsubscribeUrl = escapeHtml(input.unsubscribeUrl);
  return {
    subject: safeSubject(input.subject, variables),
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${safeSubject(input.subject, variables)}</title>
</head>
<body style="margin:0;background:#f5f1e8;color:#231f20;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f1e8;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">
        <tr><td style="background:#4b1026;color:#ffffff;padding:24px;font-size:24px;font-weight:700">${organizationName}</td></tr>
        <tr><td style="padding:28px;font-size:16px;line-height:1.6">${body}</td></tr>
        <tr><td style="padding:20px 28px;border-top:1px solid #e2ddd3;color:#625c55;font-size:12px;line-height:1.5">
          This operational message was sent by ${organizationName}.
          <a href="${unsubscribeUrl}" style="color:#4b1026">Manage optional transactional email preferences</a>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

function fromDomain(from: string): string | null {
  const email = from.match(/(?:<)?([^<>\s]+@([^<>\s]+))(?:>)?$/)?.[1];
  return email?.split("@")[1]?.toLowerCase() ?? null;
}

function requireResendConfiguration(env: WorkerEnv): {
  apiKey: string;
  from?: string;
} {
  const apiKey = requireConfigured(env.RESEND_API_KEY, "RESEND_API_KEY");
  const from = env.RESEND_FROM?.trim();
  const domain = env.RESEND_SENDING_DOMAIN?.trim().toLowerCase();
  const verified =
    Boolean(from) &&
    Boolean(domain) &&
    env.RESEND_DOMAIN_VERIFIED === "true" &&
    fromDomain(from!) === domain;
  return { apiKey, from: verified ? from : undefined };
}

export class ResendEmailProvider implements TransactionalEmailProvider {
  readonly #apiKey: string;
  readonly #from: string | undefined;

  constructor(
    configuration: { apiKey: string; from?: string },
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.#apiKey = configuration.apiKey;
    this.#from = configuration.from;
  }

  async sendBatch(
    messages: OutgoingEmail[],
    idempotencyKey: string,
  ): Promise<EmailBatchResult[]> {
    if (!messages.length || messages.length > EMAIL_BATCH_LIMIT) {
      throw new AppError(
        400,
        "invalid_request",
        "Email batches must contain between 1 and 100 messages.",
      );
    }
    if (messages.some((message) => !(message.from ?? this.#from))) {
      throw new AppError(
        503,
        "activation_required",
        "A verified global or brand sender identity is required before email delivery.",
      );
    }
    const response = await this.fetcher(`${RESEND_API_ORIGIN}/emails/batch`, {
      body: JSON.stringify(
        messages.map((message) => ({
          attachments: message.attachments?.map((attachment) => ({
            content: attachment.contentBase64,
            content_type: attachment.contentType,
            filename: attachment.filename,
          })),
          from: message.from ?? this.#from,
          headers: message.headers,
          html: message.html,
          subject: message.subject,
          to: [message.to],
        })),
      ),
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey.slice(0, 256),
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: Array<{ id?: string }>;
    };
    if (!response.ok || !Array.isArray(payload.data)) {
      throw new AppError(
        502,
        "upstream_error",
        "Transactional email delivery is temporarily unavailable.",
      );
    }
    const results = payload.data.map((item) => ({ id: String(item.id ?? "") }));
    if (results.length !== messages.length || results.some((item) => !item.id)) {
      throw new AppError(
        502,
        "upstream_error",
        "The email provider returned an incomplete batch receipt.",
      );
    }
    return results;
  }
}

function emailAttachments(payload: Record<string, unknown> | null): EmailAttachment[] {
  const value = payload?.attachments;
  if (!Array.isArray(value) || value.length > 2) return [];
  const attachments: EmailAttachment[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    const contentBase64 =
      typeof record.content_base64 === "string"
        ? record.content_base64
        : typeof record.contentBase64 === "string"
          ? record.contentBase64
          : "";
    const contentType =
      record.content_type === "application/pdf" ||
      record.content_type === "text/csv"
        ? record.content_type
        : record.contentType === "application/pdf" ||
            record.contentType === "text/csv"
          ? record.contentType
          : null;
    const filename =
      typeof record.filename === "string"
        ? record.filename.replaceAll(/[^\w .-]/g, "_").slice(0, 160)
        : "";
    if (
      !contentType ||
      !filename ||
      contentBase64.length > 2_800_000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)
    ) {
      return [];
    }
    attachments.push({ contentBase64, contentType, filename });
  }
  return attachments;
}

export class SimulatedEmailProvider implements TransactionalEmailProvider {
  async sendBatch(
    messages: OutgoingEmail[],
    idempotencyKey: string,
  ): Promise<EmailBatchResult[]> {
    return Promise.all(
      messages.map(async (message, index) => ({
        id: `sim_${(await sha256(`${idempotencyKey}:${index}:${message.to}`)).slice(
          0,
          24,
        )}`,
      })),
    );
  }
}

export function createTransactionalEmailProvider(
  env: WorkerEnv,
): TransactionalEmailProvider {
  if (
    env.EMAIL_PROVIDER === "simulated" &&
    env.APP_ENV === "test" &&
    env.EMAIL_SIMULATOR_ENABLED === "true"
  ) {
    return new SimulatedEmailProvider();
  }
  if (env.EMAIL_PROVIDER === "resend") {
    return new ResendEmailProvider(requireResendConfiguration(env));
  }
  throw new AppError(
    503,
    "activation_required",
    env.EMAIL_PROVIDER === "simulated"
      ? "The email simulator is available only when APP_ENV=test and EMAIL_SIMULATOR_ENABLED=true."
      : "Set EMAIL_PROVIDER=resend and complete Resend domain activation before sending email.",
  );
}

export function calculateChurnScore(input: ChurnInputs): ChurnScore {
  const factors: ChurnFactor[] = [];
  const add = (
    key: keyof ChurnInputs,
    label: string,
    points: number,
    evidence: string,
  ) => {
    if (points) factors.push({ evidence, key, label, points });
  };

  const inactivity =
    input.daysSinceInteraction === null
      ? 30
      : input.daysSinceInteraction > 90
        ? 30
        : input.daysSinceInteraction > 60
          ? 20
          : input.daysSinceInteraction > 30
            ? 10
            : input.daysSinceInteraction <= 7
              ? -8
              : 0;
  add(
    "daysSinceInteraction",
    "Shipment interaction",
    inactivity,
    input.daysSinceInteraction === null
      ? "No shipment interaction recorded"
      : `${input.daysSinceInteraction} days since the last interaction`,
  );

  const declinePoints = Math.min(30, Math.max(0, input.declinesLast12Months) * 10);
  add(
    "declinesLast12Months",
    "Payment declines",
    declinePoints,
    `${input.declinesLast12Months} decline(s) in the last 12 months`,
  );

  const tenurePoints =
    input.membershipDays >= 730
      ? -15
      : input.membershipDays >= 365
        ? -10
        : input.membershipDays >= 180
          ? -5
          : input.membershipDays < 90
            ? 10
            : 0;
  add(
    "membershipDays",
    "Membership tenure",
    tenurePoints,
    `${input.membershipDays} days as a member`,
  );

  const openPoints =
    input.emailOpenRate90Days === null
      ? 5
      : input.emailOpenRate90Days < 0.1
        ? 15
        : input.emailOpenRate90Days < 0.25
          ? 8
          : input.emailOpenRate90Days >= 0.6
            ? -5
            : 0;
  add(
    "emailOpenRate90Days",
    "Email open rate",
    openPoints,
    input.emailOpenRate90Days === null
      ? "No email engagement recorded"
      : `${Math.round(input.emailOpenRate90Days * 100)}% open rate in 90 days`,
  );

  const clickPoints =
    input.emailClickRate90Days === null
      ? 3
      : input.emailClickRate90Days < 0.02
        ? 10
        : input.emailClickRate90Days < 0.05
          ? 5
          : input.emailClickRate90Days >= 0.2
            ? -4
            : 0;
  add(
    "emailClickRate90Days",
    "Email click rate",
    clickPoints,
    input.emailClickRate90Days === null
      ? "No click engagement recorded"
      : `${Math.round(input.emailClickRate90Days * 100)}% click rate in 90 days`,
  );

  const portalPoints =
    input.daysSincePortalLogin === null
      ? 10
      : input.daysSincePortalLogin <= 14
        ? -10
        : input.daysSincePortalLogin <= 30
          ? -5
          : input.daysSincePortalLogin > 90
            ? 10
            : 0;
  add(
    "daysSincePortalLogin",
    "Portal activity",
    portalPoints,
    input.daysSincePortalLogin === null
      ? "No member portal login recorded"
      : `${input.daysSincePortalLogin} days since portal login`,
  );

  const downgradePoints = Math.min(
    20,
    Math.max(0, input.tierDowngradesLast12Months) * 10,
  );
  add(
    "tierDowngradesLast12Months",
    "Tier downgrades",
    downgradePoints,
    `${input.tierDowngradesLast12Months} downgrade(s) in the last 12 months`,
  );

  const score = Math.max(
    0,
    Math.min(100, 20 + factors.reduce((sum, factor) => sum + factor.points, 0)),
  );
  return {
    contributingFactors: factors.sort(
      (left, right) => Math.abs(right.points) - Math.abs(left.points),
    ),
    riskLevel: score <= 30 ? "low" : score <= 60 ? "medium" : "high",
    score,
  };
}

export function loyaltyMultiplier(planTier: string): number {
  if (planTier === "estate" || planTier === "reserve") return 1.5;
  if (planTier === "cellar") return 1.25;
  return 1;
}

export function awardedPoints(basePoints: number, planTier: string): number {
  if (!Number.isInteger(basePoints) || basePoints <= 0) {
    throw new AppError(
      400,
      "invalid_request",
      "Base loyalty points must be a positive integer.",
    );
  }
  return Math.floor(basePoints * loyaltyMultiplier(planTier));
}

export function portalLoginIdempotencyKey(
  memberId: string,
  asOf = new Date(),
): string {
  return `activity:portal_login:${memberId}:${asOf.toISOString().slice(0, 10)}`;
}

interface UnsubscribeClaims {
  exp: number;
  memberId: string;
  organizationId: string;
  scope: "optional_transactional";
  triggerType: EmailTriggerType;
}

export async function createUnsubscribeToken(
  env: WorkerEnv,
  claims: Omit<UnsubscribeClaims, "exp" | "scope" | "triggerType"> & {
    triggerType?: EmailTriggerType;
  },
  expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
): Promise<string> {
  const secret = requireConfigured(
    env.UNSUBSCRIBE_SIGNING_SECRET,
    "UNSUBSCRIBE_SIGNING_SECRET",
  );
  const encoded = encodeBase64Url(
    JSON.stringify({
      ...claims,
      exp: Math.floor(expiresAt.getTime() / 1_000),
      scope: "optional_transactional",
      triggerType: claims.triggerType ?? "re_engagement",
    } satisfies UnsubscribeClaims),
  );
  return `${encoded}.${encodeBase64Url(await hmac(secret, encoded))}`;
}

export async function verifyUnsubscribeToken(
  env: WorkerEnv,
  token: string,
  asOf = new Date(),
): Promise<UnsubscribeClaims> {
  const [encoded, suppliedSignature, ...extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra.length) {
    throw new AppError(400, "invalid_request", "The unsubscribe link is invalid.");
  }
  const expected = await hmac(
    requireConfigured(
      env.UNSUBSCRIBE_SIGNING_SECRET,
      "UNSUBSCRIBE_SIGNING_SECRET",
    ),
    encoded,
  );
  const supplied = decodeBase64Url(suppliedSignature);
  if (
    supplied.length !== expected.length ||
    !(await crypto.subtle.verify(
      "HMAC",
      await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(
          requireConfigured(
            env.UNSUBSCRIBE_SIGNING_SECRET,
            "UNSUBSCRIBE_SIGNING_SECRET",
          ),
        ),
        { hash: "SHA-256", name: "HMAC" },
        false,
        ["verify"],
      ),
      toArrayBuffer(supplied),
      new TextEncoder().encode(encoded),
    ))
  ) {
    throw new AppError(400, "invalid_request", "The unsubscribe link is invalid.");
  }
  let claims: UnsubscribeClaims;
  try {
    claims = JSON.parse(
      Buffer.from(decodeBase64Url(encoded)).toString("utf8"),
    ) as UnsubscribeClaims;
  } catch {
    throw new AppError(400, "invalid_request", "The unsubscribe link is invalid.");
  }
  assertUuid(claims.memberId, "Member");
  assertUuid(claims.organizationId, "Organization");
  if (
    claims.scope !== "optional_transactional" ||
    !EMAIL_TRIGGERS.includes(claims.triggerType) ||
    !Number.isInteger(claims.exp) ||
    claims.exp < Math.floor(asOf.getTime() / 1_000)
  ) {
    throw new AppError(410, "invalid_request", "The unsubscribe link has expired.");
  }
  return claims;
}

export async function verifyResendSignature(
  env: WorkerEnv,
  payload: Buffer,
  headers: { id: string; signature: string; timestamp: string },
  asOf = new Date(),
): Promise<void> {
  const timestamp = Number(headers.timestamp);
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(Math.floor(asOf.getTime() / 1_000) - timestamp) >
      WEBHOOK_TOLERANCE_SECONDS
  ) {
    throw new AppError(400, "invalid_request", "The webhook timestamp is invalid.");
  }
  const secret = requireConfigured(
    env.RESEND_WEBHOOK_SECRET,
    "RESEND_WEBHOOK_SECRET",
  );
  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSecret) ||
    encodedSecret.length % 4 === 1
  ) {
    throw new AppError(503, "activation_required", "The webhook secret is invalid.");
  }
  let key: Uint8Array;
  try {
    key = new Uint8Array(Buffer.from(encodedSecret, "base64"));
  } catch {
    throw new AppError(503, "activation_required", "The webhook secret is invalid.");
  }
  if (key.byteLength < 16) {
    throw new AppError(503, "activation_required", "The webhook secret is invalid.");
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"],
  );
  const signedContent = `${headers.id}.${headers.timestamp}.${payload.toString(
    "utf8",
  )}`;
  const signatures = headers.signature
    .split(/\s+/)
    .map((part) => part.split(","))
    .filter(([version, signature]) => version === "v1" && Boolean(signature))
    .map(([, signature]) => signature as string);
  for (const signature of signatures) {
    try {
      if (
        await crypto.subtle.verify(
          "HMAC",
          cryptoKey,
          Buffer.from(signature, "base64"),
          new TextEncoder().encode(signedContent),
        )
      ) {
        return;
      }
    } catch {
      // Try every supplied v1 signature to support secret rotation.
    }
  }
  throw new AppError(400, "invalid_request", "The webhook signature is invalid.");
}

function canonicalProviderEventType(type: string): string | null {
  const event = type.replace(/^email\./, "");
  if (
    [
      "sent",
      "delivered",
      "delivery_delayed",
      "bounced",
      "opened",
      "clicked",
      "complained",
      "failed",
    ].includes(event)
  ) {
    return event;
  }
  if (event === "suppressed") return "failed";
  return null;
}

function providerEventStatus(type: string):
  | "sent"
  | "delivered"
  | "failed"
  | "bounced"
  | null {
  if (type === "sent") return "sent";
  if (type === "delivered") return "delivered";
  if (type === "bounced" || type === "complained") return "bounced";
  if (type === "failed") return "failed";
  return null;
}

async function markEmail(
  admin: SupabaseClient,
  row: ClaimedEmail,
  status: "sent" | "failed",
  providerId: string | null,
): Promise<void> {
  const { error } = await admin.rpc("mark_email_delivery", {
    p_email_log_id: row.email_log_id,
    p_error: status === "failed" ? "provider_delivery_failed" : null,
    p_organization_id: row.organization_id,
    p_resend_id: providerId,
    p_status: status,
  });
  if (error) throw databaseError("The email delivery receipt could not be recorded.");
}

export function resolveBrandSenderIdentity(
  identity:
    | {
        fromEmail: string | null | undefined;
        fromName: string | null | undefined;
        id: string | null | undefined;
        status: string | null | undefined;
      }
    | null
    | undefined,
): string | undefined {
  if (!identity?.id) return undefined;
  if (
    identity.status !== "verified" ||
    !identity.fromEmail ||
    !identity.fromName
  ) {
    throw new AppError(
      503,
      "activation_required",
      "The configured brand sender must be verified before email delivery.",
    );
  }
  try {
    return formatBrandSender({
      fromEmail: identity.fromEmail,
      fromName: identity.fromName,
    });
  } catch {
    throw new AppError(
      503,
      "activation_required",
      "The configured brand sender is unsafe and cannot be used.",
    );
  }
}

export async function deliverClaimedEmails(input: {
  appOrigin: string;
  env: WorkerEnv;
  mark: (
    row: ClaimedEmail,
    status: "sent" | "failed",
    providerId: string | null,
  ) => Promise<void>;
  registerUnsubscribe?: (
    row: ClaimedEmail,
    token: string,
    signedAt: Date,
    expiresAt: Date,
  ) => Promise<void>;
  provider: TransactionalEmailProvider;
  rows: ClaimedEmail[];
}): Promise<{ failed: number; sent: number }> {
  if (input.rows.length > EMAIL_BATCH_LIMIT) {
    throw new AppError(400, "invalid_request", "At most 100 emails can be delivered.");
  }
  if (!input.rows.length) return { failed: 0, sent: 0 };
  const deliveryRows: Array<{ from?: string; row: ClaimedEmail }> = [];
  const rejectedRows: ClaimedEmail[] = [];
  for (const row of input.rows) {
    try {
      const from = resolveBrandSenderIdentity(
        row.sender_identity_id
          ? {
              fromEmail: row.sender_from_email,
              fromName: row.sender_from_name,
              id: row.sender_identity_id,
              status: row.sender_status,
            }
          : null,
      );
      deliveryRows.push({ from, row });
    } catch {
      rejectedRows.push(row);
    }
  }
  await Promise.allSettled(
    rejectedRows.map((row) => input.mark(row, "failed", null)),
  );
  if (!deliveryRows.length) {
    return { failed: rejectedRows.length, sent: 0 };
  }
  const prepared = await Promise.all(
    deliveryRows.map(async ({ from, row }) => {
      const variables = Object.fromEntries(
        Object.entries(row.payload ?? {})
          .filter((entry): entry is [string, string | number | boolean] =>
            ["string", "number", "boolean"].includes(typeof entry[1]),
          )
          .map(([key, value]) => [key, String(value)]),
      );
      let unsubscribeUrl = new URL("/portal/preferences", input.appOrigin);
      if (row.member_id) {
        const signedAt = new Date();
        const expiresAt = new Date(
          signedAt.getTime() + 30 * 24 * 60 * 60 * 1_000,
        );
        const token = await createUnsubscribeToken(
          input.env,
          {
            memberId: row.member_id,
            organizationId: row.organization_id,
            triggerType: row.trigger_type,
          },
          expiresAt,
        );
        await input.registerUnsubscribe?.(row, token, signedAt, expiresAt);
        unsubscribeUrl = new URL(
          "/api/communications/unsubscribe",
          input.appOrigin,
        );
        unsubscribeUrl.searchParams.set("token", token);
      }
      const rendered = renderTransactionalEmail({
        body: row.body,
        organizationName: variables.organization_name ?? "Your wine club",
        subject: row.subject,
        unsubscribeUrl: unsubscribeUrl.toString(),
        variables,
      });
      return {
        attachments: emailAttachments(row.payload),
        from,
        headers: row.member_id
          ? {
              "List-Unsubscribe": `<${unsubscribeUrl.toString()}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            }
          : undefined,
        html: rendered.html,
        subject: rendered.subject,
        to: row.to_email,
      };
    }),
  );
  const idempotencyKey = `outbox:${await sha256(
    deliveryRows.map(({ row }) => row.outbox_id).sort().join(":"),
  )}`;
  try {
    const receipts = await input.provider.sendBatch(prepared, idempotencyKey);
    await Promise.all(
      deliveryRows.map(({ row }, index) =>
        input.mark(row, "sent", receipts[index]?.id ?? null),
      ),
    );
    return { failed: rejectedRows.length, sent: deliveryRows.length };
  } catch (error) {
    await Promise.allSettled(
      deliveryRows.map(({ row }) => input.mark(row, "failed", null)),
    );
    throw error;
  }
}

export async function deliverLoggedTestEmail(input: {
  enqueue: () => Promise<string>;
  mark: (
    emailLogId: string,
    status: "sent" | "failed",
    providerId: string | null,
  ) => Promise<void>;
  message: OutgoingEmail;
  provider: TransactionalEmailProvider;
}): Promise<{ deliveryId: string; emailLogId: string }> {
  const emailLogId = await input.enqueue();
  try {
    const [receipt] = await input.provider.sendBatch(
      [input.message],
      `email:test-delivery:${emailLogId}`,
    );
    if (!receipt) {
      throw databaseError("The email provider did not accept the test.");
    }
    await input.mark(emailLogId, "sent", receipt.id);
    return { deliveryId: receipt.id, emailLogId };
  } catch (error) {
    await input.mark(emailLogId, "failed", null).catch(() => undefined);
    throw error;
  }
}

export class ProductionRetentionService
  extends ProductionCoreClubService
  implements RetentionService
{
  protected async recordMemberPortalLogin(
    principal: MemberPrincipal,
    asOf = new Date(),
  ): Promise<void> {
    const { error } = await this.admin.rpc("record_member_activity_event", {
      p_event_type: "portal_login",
      p_idempotency_key: portalLoginIdempotencyKey(principal.user.id, asOf),
      p_member_id: principal.user.id,
      p_metadata: { source: "member_session" },
      p_occurred_at: asOf.toISOString(),
      p_organization_id: principal.organization.id,
      p_source_entity_id: principal.user.id,
      p_source_entity_type: "member",
    });
    if (error) {
      throw databaseError("Member portal activity could not be recorded.");
    }
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: { source: "member_session" },
      eventType: "portal.login",
      memberId: principal.user.id,
      requestKey: portalLoginIdempotencyKey(principal.user.id, asOf),
    });
  }

  async listEmailTemplates(): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("email_templates")
      .select(
        "id,trigger_type,subject,body,enabled,days_before,created_at,updated_at",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .order("trigger_type");
    if (error) throw databaseError("Email templates could not be loaded.");
    const { data: sender, error: senderError } = await this.admin
      .from("brand_sender_identities")
      .select("id,from_name,from_email,status")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .neq("status", "disabled")
      .maybeSingle();
    if (senderError) {
      throw databaseError("The brand sender identity could not be loaded.");
    }
    let senderStatus: "active" | "activation_required";
    if (sender) {
      try {
        resolveBrandSenderIdentity({
          fromEmail: sender.from_email,
          fromName: sender.from_name,
          id: sender.id,
          status: sender.status,
        });
        senderStatus = "active";
      } catch {
        senderStatus = "activation_required";
      }
    } else {
      senderStatus = getConfigurationReport(this.env).communications.configured
        ? "active"
        : "activation_required";
    }
    return (data ?? []).map((template) => ({
      ...toPublicRecord(template),
      senderStatus,
    }));
  }

  async upsertEmailTemplate(
    input: EmailTemplateInput,
  ): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const subject = sanitizeTemplateSubject(input.subject);
    const body = sanitizeTemplateHtml(input.body);
    if (!subject || !body.trim()) {
      throw new AppError(
        400,
        "invalid_request",
        "Email templates require a subject and body.",
      );
    }
    const { data, error } = await this.admin
      .from("email_templates")
      .upsert(
        {
          body,
          days_before:
            input.triggerType === "pre_shipment"
              ? (input.daysBefore ?? 3)
              : null,
          enabled: input.enabled,
          brand_id: brandId,
          organization_id: organizationId,
          subject,
          trigger_type: input.triggerType,
        },
        { onConflict: "organization_id,brand_id,trigger_type" },
      )
      .select(
        "id,trigger_type,subject,body,enabled,days_before,created_at,updated_at",
      )
      .single();
    if (error || !data) throw databaseError("The email template could not be saved.");
    await this.audit(principal, "email_template.saved", "email_template", data.id, {
      enabled: input.enabled,
      trigger_type: input.triggerType,
    });
    return toPublicRecord(data);
  }

  async updateEmailTemplate(
    templateId: string,
    input: Partial<EmailTemplateInput>,
  ): Promise<Record<string, unknown>> {
    assertUuid(templateId, "Email template");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const changes: Record<string, unknown> = {};
    if (input.body !== undefined) {
      const body = sanitizeTemplateHtml(input.body);
      if (!body.trim()) {
        throw new AppError(
          400,
          "invalid_request",
          "The email template body cannot be empty.",
        );
      }
      changes.body = body;
    }
    if (input.subject !== undefined) {
      const subject = sanitizeTemplateSubject(input.subject);
      if (!subject) {
        throw new AppError(
          400,
          "invalid_request",
          "The email template subject cannot be empty.",
        );
      }
      changes.subject = subject;
    }
    if (input.enabled !== undefined) changes.enabled = input.enabled;
    if (input.triggerType !== undefined) {
      changes.trigger_type = input.triggerType;
      changes.days_before =
        input.triggerType === "pre_shipment" ? (input.daysBefore ?? 3) : null;
    }
    if (input.daysBefore !== undefined) changes.days_before = input.daysBefore;
    const { data, error } = await this.admin
      .from("email_templates")
      .update(changes)
      .eq("id", templateId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .select(
        "id,trigger_type,subject,body,enabled,days_before,created_at,updated_at",
      )
      .maybeSingle();
    if (error) throw databaseError("The email template could not be updated.");
    if (!data) throw new AppError(404, "not_found", "Email template not found.");
    await this.audit(
      principal,
      "email_template.updated",
      "email_template",
      templateId,
      { changed_fields: Object.keys(changes) },
    );
    return toPublicRecord(data);
  }

  async deleteEmailTemplate(templateId: string): Promise<void> {
    assertUuid(templateId, "Email template");
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("email_templates")
      .delete()
      .eq("id", templateId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .select("id")
      .maybeSingle();
    if (error) throw databaseError("The email template could not be deleted.");
    if (!data) throw new AppError(404, "not_found", "Email template not found.");
    await this.audit(
      principal,
      "email_template.deleted",
      "email_template",
      templateId,
    );
  }

  private async getTemplate(
    templateId: string,
    organizationId: string,
    brandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(templateId, "Email template");
    const { data, error } = await this.admin
      .from("email_templates")
      .select("id,trigger_type,subject,body,enabled")
      .eq("id", templateId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw databaseError("The email template could not be loaded.");
    if (!data) throw new AppError(404, "not_found", "Email template not found.");
    return data;
  }

  async previewEmailTemplate(
    templateId: string,
    input: {
      body?: string;
      subject?: string;
      variables?: Record<string, string>;
    },
  ): Promise<{ body: string; html: string; subject: string }> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const template = await this.getTemplate(templateId, organizationId, brandId);
    const rendered = renderTransactionalEmail({
      body: input.body ?? String(template.body ?? ""),
      organizationName: principal.organization?.name ?? "Your wine club",
      subject: input.subject ?? String(template.subject ?? ""),
      unsubscribeUrl: "#email-preferences",
      variables: input.variables,
    });
    return {
      ...rendered,
      body: sanitizeTemplateHtml(
        input.body ?? String(template.body ?? ""),
      )
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:p|div|h1|h2|h3|li)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim(),
    };
  }

  async sendEmailTemplateTest(
    templateId: string,
    input: { email: string; variables?: Record<string, string> },
  ): Promise<{ accepted: boolean; deliveryId: string }> {
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const template = await this.getTemplate(templateId, organizationId, brandId);
    const rendered = renderTransactionalEmail({
      body: String(template.body ?? ""),
      organizationName: principal.organization?.name ?? "Your wine club",
      subject: `[TEST] ${String(template.subject ?? "")}`,
      unsubscribeUrl: "#email-preferences",
      variables: input.variables,
    });
    const { data: sender, error: senderError } = await this.admin
      .from("brand_sender_identities")
      .select("id,from_name,from_email,status")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .neq("status", "disabled")
      .maybeSingle();
    if (senderError) {
      throw databaseError("The brand sender identity could not be loaded.");
    }
    const from = resolveBrandSenderIdentity(
      sender
        ? {
            fromEmail: sender.from_email,
            fromName: sender.from_name,
            id: sender.id,
            status: sender.status,
          }
        : null,
    );
    const idempotencyKey = `email:test:${crypto.randomUUID()}`;
    const delivery = await deliverLoggedTestEmail({
      enqueue: async () => {
        const { data, error } = await this.admin.rpc("enqueue_test_email", {
          p_actor_user_id: principal.user.id,
          p_body: interpolate(
            sanitizeTemplateHtml(String(template.body ?? "")),
            input.variables ?? {},
          ),
          p_idempotency_key: idempotencyKey,
          p_organization_id: organizationId,
          p_subject: rendered.subject,
          p_template_id: templateId,
          p_to_email: input.email,
        });
        if (error || typeof data !== "string") {
          throw databaseError("The test email could not be queued.");
        }
        return data;
      },
      mark: async (emailLogId, status, providerId) => {
        const { error } = await this.admin.rpc("mark_email_delivery", {
          p_email_log_id: emailLogId,
          p_error: status === "failed" ? "provider_delivery_failed" : null,
          p_organization_id: organizationId,
          p_resend_id: providerId,
          p_status: status,
        });
        if (error) {
          throw databaseError("The test email receipt could not be recorded.");
        }
      },
      message: { ...rendered, from, to: input.email },
      provider: createTransactionalEmailProvider(this.env),
    });
    return { accepted: true, deliveryId: delivery.deliveryId };
  }

  async listEmailLog(input: {
    limit: number;
    offset: number;
    status?: string;
    triggerType?: EmailTriggerType;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    let query = this.admin
      .from("email_log")
      .select(
        "id,member_id,template_id,trigger_type,is_test,to_email,status,resend_id,error_message,created_at,sent_at,delivered_at,members(first_name,last_name,email)",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId);
    if (input.status) query = query.eq("status", input.status);
    if (input.triggerType) query = query.eq("trigger_type", input.triggerType);
    const { count, data, error } = await query
      .order("created_at", { ascending: false })
      .range(input.offset, input.offset + input.limit - 1);
    if (error) throw databaseError("Email delivery history could not be loaded.");
    return {
      items: (data ?? []).map((row) => ({
        createdAt: row.created_at,
        errorMessage: row.error_message,
        id: row.id,
        memberId: row.member_id,
        providerId: row.resend_id,
        recipient: row.to_email,
        status: row.status,
        templateId: row.template_id,
        templateName: `${String(row.trigger_type)
          .replaceAll("_", " ")
          .replace(/\b\w/g, (character) =>
            character.toUpperCase(),
          )}${row.is_test ? " (Test)" : ""}`,
      })),
      total: count ?? 0,
    };
  }

  async handleResendWebhook(
    payload: Buffer,
    headers: { id: string; signature: string; timestamp: string },
  ): Promise<{ duplicate: boolean; ignored?: boolean }> {
    await verifyResendSignature(this.env, payload, headers);
    let event: {
      created_at?: string;
      data?: { email_id?: string };
      type?: string;
    };
    try {
      event = JSON.parse(payload.toString("utf8")) as typeof event;
    } catch {
      throw new AppError(400, "invalid_request", "The webhook payload is invalid.");
    }
    const providerId = event.data?.email_id;
    const type = event.type;
    if (!providerId || !type) {
      throw new AppError(400, "invalid_request", "The webhook payload is incomplete.");
    }
    const canonicalType = canonicalProviderEventType(type);
    if (!canonicalType) {
      return { duplicate: false, ignored: true };
    }
    const { data: log, error: logError } = await this.admin
      .from("email_log")
      .select("id,organization_id,brand_id")
      .eq("resend_id", providerId)
      .maybeSingle();
    if (logError) throw databaseError("The email delivery event could not be matched.");
    if (!log) return { duplicate: false };
    const occurred = event.created_at ? new Date(event.created_at) : new Date();
    if (!Number.isFinite(occurred.getTime())) {
      throw new AppError(
        400,
        "invalid_request",
        "The webhook event timestamp is invalid.",
      );
    }
    const occurredAt = occurred.toISOString();
    const { data: recorded, error: eventError } = await this.admin.rpc(
      "record_email_delivery_event",
      {
        p_email_log_id: log.id,
        p_event_type: canonicalType,
        p_occurred_at: occurredAt,
        p_organization_id: log.organization_id,
        p_payload: { email_id: providerId, type: canonicalType },
        p_provider_event_id: headers.id,
      },
    );
    if (eventError) throw databaseError("The email delivery event could not be recorded.");
    if (recorded === false) return { duplicate: true };
    const status = providerEventStatus(canonicalType);
    if (status) {
      const { error } = await this.admin.rpc("mark_email_delivery", {
        p_email_log_id: log.id,
        p_error: status === "failed" || status === "bounced" ? type : null,
        p_organization_id: log.organization_id,
        p_resend_id: providerId,
        p_status: status,
      });
      if (error) throw databaseError("The email delivery status could not be updated.");
    }
    return { duplicate: false };
  }

  async listChurnScores(input: {
    limit: number;
    offset: number;
    riskLevel?: "low" | "medium" | "high";
    search?: string;
  }): Promise<{
    calculatedAt: string | null;
    highCount: number;
    items: Array<Record<string, unknown>>;
    lowCount: number;
    mediumCount: number;
    scoredCount: number;
    total: number;
  }> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data: latest } = await this.admin
      .from("churn_scores")
      .select("score_date")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .order("score_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    let query = this.admin
      .from("churn_scores")
      .select(
        "id,member_id,score,risk_level,contributing_factors,calculated_at,members(first_name,last_name,email,club_tier_id,club_tiers(name))",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId);
    if (latest?.score_date) query = query.eq("score_date", latest.score_date);
    if (input.riskLevel) query = query.eq("risk_level", input.riskLevel);
    if (input.search) {
      const escaped = input.search.replaceAll("%", "\\%").replaceAll(",", "");
      query = query.or(
        `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,email.ilike.%${escaped}%`,
        { referencedTable: "members" },
      );
    }
    const [result, allCurrent] = await Promise.all([
      query
        .order("score", { ascending: false })
        .range(input.offset, input.offset + input.limit - 1),
      latest?.score_date
        ? this.admin
            .from("churn_scores")
            .select("risk_level,calculated_at")
            .eq("organization_id", organizationId)
            .eq("brand_id", brandId)
            .eq("score_date", latest.score_date)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const { count, data, error } = result;
    if (error) throw databaseError("Churn scores could not be loaded.");
    if (allCurrent.error) throw databaseError("Churn summary could not be loaded.");
    const current = allCurrent.data ?? [];
    return {
      calculatedAt: current[0]?.calculated_at ?? null,
      highCount: current.filter((score) => score.risk_level === "high").length,
      items: (data ?? []).map((row) =>
        toChurnDto(row as Record<string, unknown>),
      ),
      lowCount: current.filter((score) => score.risk_level === "low").length,
      mediumCount: current.filter((score) => score.risk_level === "medium").length,
      scoredCount: current.length,
      total: count ?? 0,
    };
  }

  async getChurnScore(memberId: string): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("churn_scores")
      .select(
        "id,member_id,score,risk_level,contributing_factors,calculated_at,members(first_name,last_name,email,club_tiers(name))",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("member_id", memberId)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw databaseError("The churn score could not be loaded.");
    if (!data) throw new AppError(404, "not_found", "Churn score not found.");
    return toChurnDto(data as Record<string, unknown>);
  }

  async getCancelFlowConfiguration(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    return this.loadCancelFlowConfiguration(organizationId, brandId);
  }

  private async loadCancelFlowConfiguration(
    organizationId: string,
    brandId: string,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.admin
      .from("cancel_flow_steps")
      .select(
        "id,step_type,headline,body,enabled,position,configuration,updated_at",
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .order("position");
    if (error) throw databaseError("Cancel-flow configuration could not be loaded.");
    return {
      steps: (data ?? []).map((step) =>
        toPublicCancelStep(step as Record<string, unknown>),
      ),
    };
  }

  async updateCancelFlowConfiguration(input: {
    steps: Array<{
      enabled: boolean;
      id: "pause" | "downgrade" | "swap" | "confirm";
      position: number;
      stepId?: string;
    }>;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    await this.assertLegacySingleBrandScope(
      principal,
      "Cancel-flow configuration",
    );
    input.steps
      .filter((step) => step.stepId)
      .forEach((step) => assertUuid(step.stepId as string, "Cancel-flow step"));
    const { data: existingSteps, error: stepError } = await this.admin
      .from("cancel_flow_steps")
      .select("id,step_type,headline,body,configuration")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId);
    if (stepError) throw databaseError("Cancel-flow configuration could not be loaded.");
    const stepsByType = new Map(
      (existingSteps ?? []).map((step) => [
        String(step.step_type),
        step as Record<string, unknown>,
      ]),
    );
    const databaseSteps = input.steps.map((step) => {
      const existing = stepsByType.get(step.id);
      if (!existing) {
        throw new AppError(
          409,
          "conflict",
          `The ${step.id} cancel-flow step is unavailable.`,
        );
      }
      return {
        body: existing.body,
        configuration: existing.configuration ?? {},
        enabled: step.enabled,
        headline: existing.headline,
        position: step.position,
        step_type: step.id,
      };
    });
    const { data, error } = await this.admin.rpc(
      "update_cancel_flow_configuration",
      {
        p_actor_user_id: principal.user.id,
        p_organization_id: organizationId,
        p_steps: databaseSteps,
      },
    );
    if (error) throw databaseError("Cancel-flow configuration could not be updated.");
    await this.audit(
      principal,
      "cancel_flow.configuration_updated",
      "organization",
      organizationId,
      { step_count: input.steps.length },
    );
    return this.loadCancelFlowConfiguration(organizationId, brandId);
  }

  async getCancelFlowAnalytics(): Promise<Record<string, unknown>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const [{ data, error }, { count: attemptCount, error: attemptError }] =
      await Promise.all([
        this.admin
          .from("cancel_flow_events")
          .select(
            "id,attempt_id,member_id,step_position,outcome,created_at,members(first_name,last_name,email),cancel_flow_steps(step_type)",
          )
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId)
          .order("created_at", { ascending: false })
          .limit(1_000),
        this.admin
          .from("cancel_flow_attempts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("brand_id", brandId),
      ]);
    if (error) throw databaseError("Cancel-flow analytics could not be loaded.");
    if (attemptError) {
      throw databaseError("Cancel-flow attempt totals could not be loaded.");
    }
    const events = data ?? [];
    const steps = new Map<
      string,
      { attempts: number; intercepts: number; outcomes: Record<string, number> }
    >();
    for (const event of events) {
      const stepRelation = oneRelation(
        event.cancel_flow_steps as
          | Record<string, unknown>
          | Array<Record<string, unknown>>
          | null,
      );
      const step = String(stepRelation?.step_type ?? "confirm");
      const entry = steps.get(step) ?? {
        attempts: 0,
        intercepts: 0,
        outcomes: {},
      };
      entry.attempts += 1;
      const outcome = String(event.outcome);
      entry.outcomes[outcome] = (entry.outcomes[outcome] ?? 0) + 1;
      if (["paused", "downgraded", "swapped"].includes(outcome)) {
        entry.intercepts += 1;
      }
      steps.set(step, entry);
    }
    const terminalByAttempt = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      if (
        ["paused", "downgraded", "swapped", "cancelled"].includes(
          String(event.outcome),
        ) &&
        !terminalByAttempt.has(String(event.attempt_id))
      ) {
        terminalByAttempt.set(String(event.attempt_id), event);
      }
    }
    const terminal = [...terminalByAttempt.values()];
    const retained = terminal.filter((event) =>
      ["paused", "downgraded", "swapped"].includes(String(event.outcome)),
    ).length;
    const cancelled = terminal.filter(
      (event) => event.outcome === "cancelled",
    ).length;
    return {
      attempts: attemptCount ?? 0,
      cancelled,
      recentOutcomes: terminal.slice(0, 50).map((event) => {
        const member = oneRelation(
          event.members as
            | Record<string, unknown>
            | Array<Record<string, unknown>>
            | null,
        );
        const step = oneRelation(
          event.cancel_flow_steps as
            | Record<string, unknown>
            | Array<Record<string, unknown>>
            | null,
        );
        return {
          createdAt: event.created_at,
          id: event.id,
          memberId: event.member_id,
          memberName: memberName(member),
          outcome: event.outcome,
          step: step?.step_type ?? "confirm",
        };
      }),
      retained,
      retentionRate:
        retained + cancelled > 0 ? (retained / (retained + cancelled)) * 100 : 0,
      steps: [...steps.entries()]
        .sort(
          ([left], [right]) =>
            ["pause", "downgrade", "swap", "confirm"].indexOf(left) -
            ["pause", "downgrade", "swap", "confirm"].indexOf(right),
        )
        .map(([step, metrics]) => ({
          conversionRate:
            metrics.attempts > 0
              ? (metrics.intercepts / metrics.attempts) * 100
              : 0,
          intercepted: metrics.intercepts,
          reached: metrics.attempts,
          step,
        })),
    };
  }

  async getMemberCancelFlow(): Promise<Record<string, unknown>> {
    const principal = await this.requireMember();
    const organizationId = principal.organization.id;
    const memberId = principal.user.id;
    const [
      configuration,
      memberResult,
      shipmentResult,
      loyaltyResult,
      attemptResult,
    ] = await Promise.all([
      this.loadCancelFlowConfiguration(organizationId, principal.brand.id),
      this.admin
        .from("members")
        .select(
          "id,club_tier_id,club_tiers(id,name,price_cents,bottle_count)",
        )
        .eq("organization_id", organizationId)
        .eq("brand_id", principal.brand.id)
        .eq("id", memberId)
        .single(),
      this.admin
        .from("shipments")
        .select(
          "id,release_id,status,shipment_items(id,release_wine_id,wine_name,quantity,price_cents,packed_quantity)",
        )
        .eq("organization_id", organizationId)
        .eq("brand_id", principal.brand.id)
        .eq("member_id", memberId)
        .in("status", ["pending", "charged"])
        .order("created_at")
        .limit(1)
        .maybeSingle(),
      this.admin.rpc("get_loyalty_balance", {
        p_actor_user_id: principal.user.authUserId,
        p_member_id: memberId,
        p_organization_id: organizationId,
      }),
      this.admin
        .from("cancel_flow_attempts")
        .select("id,current_step_id")
        .eq("organization_id", organizationId)
        .eq("brand_id", principal.brand.id)
        .eq("member_id", memberId)
        .eq("status", "in_progress")
        .maybeSingle(),
    ]);
    if (memberResult.error || !memberResult.data) {
      throw databaseError("Membership details could not be loaded.");
    }
    if (shipmentResult.error) {
      throw databaseError("The upcoming shipment could not be loaded.");
    }
    if (loyaltyResult.error) {
      throw databaseError("The loyalty balance could not be loaded.");
    }
    if (attemptResult.error) {
      throw databaseError("The active cancellation attempt could not be loaded.");
    }
    const currentTier = oneRelation(
      memberResult.data.club_tiers as
        | Record<string, unknown>
        | Array<Record<string, unknown>>
        | null,
    );
    let lowerTiers: Array<Record<string, unknown>> = [];
    if (currentTier) {
      const { data, error } = await this.admin
        .from("club_tiers")
        .select("id,name,price_cents,bottle_count")
        .eq("organization_id", organizationId)
        .eq("brand_id", principal.brand.id)
        .lt("price_cents", Number(currentTier.price_cents ?? 0))
        .order("price_cents", { ascending: false });
      if (error) throw databaseError("Lower club tiers could not be loaded.");
      lowerTiers = (data ?? []).map(toPublicRecord);
    }
    const shipment = shipmentResult.data as Record<string, unknown> | null;
    const shipmentItems = Array.isArray(shipment?.shipment_items)
      ? (shipment.shipment_items as Array<Record<string, unknown>>)
      : [];
    let swapOptions: Array<Record<string, unknown>> = [];
    if (shipment?.release_id) {
      const currentWineIds = shipmentItems
        .map((item) => item.release_wine_id)
        .filter((id): id is string => typeof id === "string");
      let wineQuery = this.admin
        .from("release_wines")
        .select("id,wine_name,vintage,sku,description")
        .eq("organization_id", organizationId)
        .eq("brand_id", principal.brand.id)
        .eq("release_id", shipment.release_id);
      if (currentWineIds.length) {
        wineQuery = wineQuery.not(
          "id",
          "in",
          `(${currentWineIds.join(",")})`,
        );
      }
      const { data: alternatives, error: alternativesError } = await wineQuery
        .order("wine_name")
        .limit(24);
      if (alternativesError) {
        throw databaseError("Shipment swap options could not be loaded.");
      }
      swapOptions = (alternatives ?? []).map((wine) => ({
        description: wine.description,
        id: wine.id,
        name: wine.wine_name,
        priceCents: 0,
        quantity: 1,
        sku: wine.sku,
        vintage: wine.vintage,
      }));
    }
    const loyaltyBalance = Number(
      returnedRpcRow(loyaltyResult.data)?.available_points ?? 0,
    );
    return {
      ...configuration,
      attemptId: attemptResult.data?.id ?? null,
      benefitsAtRisk: [
        ...(currentTier?.name
          ? [`${String(currentTier.name)} tier benefits`]
          : []),
        ...(loyaltyBalance > 0 ? ["Available loyalty points"] : []),
        "Priority access to future club releases",
      ],
      currentTier: currentTier
        ? {
            bottleCount: currentTier.bottle_count,
            id: currentTier.id,
            name: currentTier.name,
            priceCents: currentTier.price_cents,
          }
        : null,
      lowerTiers,
      loyaltyBalance,
      nextShipmentId: shipment?.id ?? null,
      swapOptions,
    };
  }

  async startMemberCancelFlow(): Promise<Record<string, unknown>> {
    const principal = await this.requireMember();
    await this.assertLegacySingleBrandScope(principal, "Cancellation flow");
    const { data, error } = await this.admin.rpc("start_cancel_flow", {
      p_actor_user_id: principal.user.authUserId,
      p_member_id: principal.user.id,
      p_organization_id: principal.organization.id,
    });
    const attempt = returnedRpcRow(data);
    if (error || typeof attempt?.id !== "string") {
      throw databaseError("The cancellation flow could not be started.");
    }
    return {
      ...(await this.getMemberCancelFlow()),
      attemptId: attempt.id,
    };
  }

  async processCancelFlowEvent(input: {
    action: CancelFlowOutcome;
    attemptId?: string;
    details?: Record<string, unknown>;
    stepId: string;
  }): Promise<Record<string, unknown>> {
    const principal = await this.requireMember();
    await this.assertLegacySingleBrandScope(principal, "Cancellation flow");
    let stepId = input.stepId;
    if (!/^[0-9a-f-]{36}$/i.test(stepId)) {
      const { data: step, error: stepError } = await this.admin
        .from("cancel_flow_steps")
        .select("id")
        .eq("organization_id", principal.organization.id)
        .eq("brand_id", principal.brand.id)
        .eq("step_type", stepId)
        .eq("enabled", true)
        .maybeSingle();
      if (stepError) throw databaseError("The cancellation step could not be loaded.");
      if (!step) {
        throw new AppError(409, "conflict", "That cancellation step is unavailable.");
      }
      stepId = String(step.id);
    }
    assertUuid(stepId, "Cancel-flow step");
    let attemptId = input.attemptId;
    if (!attemptId) {
      const { data: activeAttempt, error: activeError } = await this.admin
        .from("cancel_flow_attempts")
        .select("id")
        .eq("organization_id", principal.organization.id)
        .eq("brand_id", principal.brand.id)
        .eq("member_id", principal.user.id)
        .eq("status", "in_progress")
        .maybeSingle();
      if (activeError) {
        throw databaseError("The cancellation attempt could not be loaded.");
      }
      attemptId =
        typeof activeAttempt?.id === "string" ? activeAttempt.id : undefined;
    }
    if (!attemptId) {
      const { data, error } = await this.admin.rpc("start_cancel_flow", {
        p_actor_user_id: principal.user.authUserId,
        p_member_id: principal.user.id,
        p_organization_id: principal.organization.id,
      });
      const attempt = returnedRpcRow(data);
      if (error || typeof attempt?.id !== "string") {
        throw databaseError("The cancellation flow could not be started.");
      }
      attemptId = attempt.id;
    }
    assertUuid(attemptId, "Cancellation attempt");
    const details = { ...(input.details ?? {}) };
    if (input.action === "paused" && details.pause_months === undefined) {
      details.pause_months = details.months;
    }
    if (
      input.action === "downgraded" &&
      details.target_tier_id === undefined
    ) {
      details.target_tier_id = details.offer_id;
    }
    if (input.action === "swapped") {
      const targetWineId =
        typeof details.target_release_wine_id === "string"
          ? details.target_release_wine_id
          : typeof details.offer_id === "string"
            ? details.offer_id
            : null;
      if (!targetWineId) {
        throw new AppError(
          400,
          "invalid_request",
          "Choose a wine for the shipment swap.",
        );
      }
      assertUuid(targetWineId, "Swap wine");
      const { data: shipment, error: shipmentError } = await this.admin
        .from("shipments")
        .select(
          "id,release_id,status,shipment_items(id,release_wine_id,packed_quantity)",
        )
        .eq("organization_id", principal.organization.id)
        .eq("brand_id", principal.brand.id)
        .eq("member_id", principal.user.id)
        .in("status", ["pending", "charged"])
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (shipmentError) {
        throw databaseError("The upcoming shipment could not be loaded.");
      }
      if (!shipment) {
        throw new AppError(
          409,
          "conflict",
          "There is no eligible upcoming shipment to swap.",
        );
      }
      const { data: targetWine, error: targetError } = await this.admin
        .from("release_wines")
        .select("id")
        .eq("organization_id", principal.organization.id)
        .eq("brand_id", principal.brand.id)
        .eq("release_id", shipment.release_id)
        .eq("id", targetWineId)
        .maybeSingle();
      if (targetError) throw databaseError("The swap wine could not be checked.");
      if (!targetWine) {
        throw new AppError(
          409,
          "conflict",
          "That wine is not available for the upcoming release.",
        );
      }
      const sourceItem = (
        (shipment.shipment_items ?? []) as Array<Record<string, unknown>>
      ).find(
        (item) =>
          Number(item.packed_quantity ?? 0) === 0 &&
          item.release_wine_id !== targetWineId,
      );
      if (!sourceItem) {
        throw new AppError(
          409,
          "conflict",
          "Every eligible shipment item is already packed or uses that wine.",
        );
      }
      details.shipment_id = shipment.id;
      details.shipment_item_id = sourceItem.id;
      details.target_release_wine_id = targetWineId;
    }
    const { data, error } = await this.admin.rpc("record_cancel_flow_step", {
      p_actor_user_id: principal.user.authUserId,
      p_attempt_id: attemptId,
      p_details: details,
      p_organization_id: principal.organization.id,
      p_outcome: input.action,
      p_step_id: stepId,
    });
    if (error) {
      throw new AppError(
        409,
        "conflict",
        "The cancellation action could not be applied.",
      );
    }
    const outcome = toPublicRecord(data);
    if (input.action === "cancelled") {
      await this.recordDomainAnalyticsEvent(principal, {
        eventData: {
          source: "cancel_flow",
          stepId,
        },
        eventType: "member.cancelled",
        memberId: principal.user.id,
        requestKey: `cancel-flow:${attemptId}:${stepId}:cancelled`,
      });
    }
    return {
      ...outcome,
      message:
        input.action === "paused"
          ? "Your membership pause is confirmed."
          : input.action === "downgraded"
            ? "Your club tier change is confirmed."
            : input.action === "swapped"
              ? "Your next shipment swap is confirmed."
              : input.action === "cancelled"
                ? "Your membership has been cancelled."
                : "Continue to the next retention option.",
    };
  }

  async listLoyaltyMembers(input: {
    limit: number;
    offset: number;
    search?: string;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    let query = this.admin
      .from("members")
      .select(
        "id,first_name,last_name,email,club_tier_id,club_tiers(name)",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .is("deleted_at", null);
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
    if (error) throw databaseError("Loyalty balances could not be loaded.");
    const members = (data ?? []) as Array<Record<string, unknown>>;
    const memberIds = members.map((member) => String(member.id));
    const tierIds = members
      .map((member) => member.club_tier_id)
      .filter((id): id is string => typeof id === "string");
    const [lots, multipliers] = await Promise.all([
      memberIds.length
        ? this.admin
            .from("loyalty_point_lots")
            .select("member_id,remaining_points,reserved_points,expires_at")
            .eq("organization_id", organizationId)
            .eq("brand_id", brandId)
            .in("member_id", memberIds)
            .gt("expires_at", new Date().toISOString())
        : Promise.resolve({ data: [], error: null }),
      tierIds.length
        ? this.admin
            .from("loyalty_tier_multipliers")
            .select("club_tier_id,multiplier")
            .eq("organization_id", organizationId)
            .eq("brand_id", brandId)
            .in("club_tier_id", tierIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (lots.error || multipliers.error) {
      throw databaseError("Loyalty balances could not be summarized.");
    }
    const balances = new Map<string, number>();
    for (const lot of lots.data ?? []) {
      const id = String(lot.member_id);
      balances.set(
        id,
        (balances.get(id) ?? 0) +
          Math.max(
            0,
            Number(lot.remaining_points ?? 0) -
              Number(lot.reserved_points ?? 0),
          ),
      );
    }
    const multiplierByTier = new Map(
      (multipliers.data ?? []).map((row) => [
        String(row.club_tier_id),
        Number(row.multiplier ?? 1),
      ]),
    );
    return {
      items: members.map((member) => {
        const tier = oneRelation(
          member.club_tiers as
            | Record<string, unknown>
            | Array<Record<string, unknown>>
            | null,
        );
        return {
          availablePoints: balances.get(String(member.id)) ?? 0,
          memberEmail: member.email,
          memberId: member.id,
          memberName: memberName(member),
          multiplier: multiplierByTier.get(String(member.club_tier_id)) ?? 1,
          tierName: tier?.name ?? null,
        };
      }),
      total: count ?? 0,
    };
  }

  async adjustLoyaltyPoints(
    memberId: string,
    input: { points: number; reason: string },
  ): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data: member, error: memberError } = await this.admin
      .from("members")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("id", memberId)
      .is("deleted_at", null)
      .maybeSingle();
    if (memberError) {
      throw databaseError("The loyalty member could not be checked.");
    }
    if (!member) {
      throw new AppError(
        404,
        "not_found",
        "The loyalty member is not available for this brand.",
      );
    }
    const { data, error } = await this.admin.rpc("adjust_loyalty_points", {
      p_actor_user_id: principal.user.id,
      p_idempotency_key: `loyalty:manual:${crypto.randomUUID()}`,
      p_member_id: memberId,
      p_organization_id: organizationId,
      p_points: input.points,
      p_reason: input.reason,
    });
    if (error) {
      throw new AppError(
        409,
        "conflict",
        "The loyalty adjustment could not be applied.",
      );
    }
    await this.audit(
      principal,
      "loyalty.adjusted",
      "member",
      memberId,
      { points: input.points, reason: input.reason },
    );
    return {
      ledgerId: data,
      memberId,
      points: input.points,
    };
  }

  async recordLoyaltyEvent(
    memberId: string,
    input: {
      eventId: string;
      eventType: "event_attendance";
      occurredAt?: string;
      reason?: string;
    },
  ): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    assertUuid(input.eventId, "Event");
    const principal = await this.requireStaff(["owner", "admin", "manager", "staff"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data: member, error: memberError } = await this.admin
      .from("members")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("id", memberId)
      .is("deleted_at", null)
      .maybeSingle();
    if (memberError) throw databaseError("The loyalty member could not be checked.");
    if (!member) throw new AppError(404, "not_found", "Member not found.");
    const { data, error } = await this.admin.rpc("record_member_activity_event", {
      p_event_type: input.eventType,
      p_idempotency_key: `activity:event_attendance:${input.eventId}:${memberId}`,
      p_member_id: memberId,
      p_metadata: {
        actor_user_id: principal.user.id,
        reason: input.reason ?? "Event attendance award",
      },
      p_occurred_at: input.occurredAt ?? new Date().toISOString(),
      p_organization_id: organizationId,
      p_source_entity_id: input.eventId,
      p_source_entity_type: "winery_event",
    });
    if (error || typeof data !== "string") {
      throw databaseError("Event attendance points could not be awarded.");
    }
    await this.audit(
      principal,
      "loyalty.event_attendance_recorded",
      "member",
      memberId,
      {
        activity_event_id: data,
        event_id: input.eventId,
      },
    );
    return {
      activityEventId: data,
      awarded: true,
      basePoints: 50,
      eventId: input.eventId,
      memberId,
    };
  }

  async getMemberLoyalty(): Promise<Record<string, unknown>> {
    const principal = await this.requireMember();
    return this.loadMemberLoyalty(
      principal.organization.id,
      principal.brand.id,
      principal.user.id,
    );
  }

  async getStaffMemberLoyalty(
    memberId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(memberId, "Member");
    const principal = await this.requireStaff();
    return this.loadMemberLoyalty(
      this.organizationId(principal),
      await this.activeBrandId(principal),
      memberId,
    );
  }

  private async loadMemberLoyalty(
    organizationId: string,
    brandId: string,
    memberId: string,
  ): Promise<Record<string, unknown>> {
    const [member, lots, ledger, organization, multiplier] = await Promise.all([
      this.admin
        .from("members")
        .select(
          "id,first_name,last_name,email,club_tier_id,club_tiers(name)",
        )
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("id", memberId)
        .maybeSingle(),
      this.admin
        .from("loyalty_point_lots")
        .select("remaining_points,reserved_points,expires_at")
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("member_id", memberId)
        .gt("expires_at", new Date().toISOString())
        .order("expires_at"),
      this.admin
        .from("loyalty_ledger")
        .select(
          "id,entry_type,points,reason,source_event_type,expires_at,created_at",
        )
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(250),
      this.admin
        .from("organizations")
        .select("loyalty_points_per_unit,loyalty_discount_unit_cents")
        .eq("id", organizationId)
        .single(),
      this.admin
        .from("loyalty_tier_multipliers")
        .select("multiplier")
        .eq("organization_id", organizationId)
        .eq("brand_id", brandId)
        .eq(
          "club_tier_id",
          (
            await this.admin
              .from("members")
              .select("club_tier_id")
              .eq("organization_id", organizationId)
              .eq("brand_id", brandId)
              .eq("id", memberId)
              .maybeSingle()
          ).data?.club_tier_id ?? "00000000-0000-0000-0000-000000000000",
        )
        .maybeSingle(),
    ]);
    if (member.error || !member.data) {
      throw new AppError(404, "not_found", "Member not found.");
    }
    if (lots.error || ledger.error || organization.error || multiplier.error) {
      throw databaseError("The loyalty account could not be loaded.");
    }
    const availablePoints = (lots.data ?? []).reduce(
      (sum, lot) =>
        sum +
        Math.max(
          0,
          Number(lot.remaining_points ?? 0) -
            Number(lot.reserved_points ?? 0),
        ),
      0,
    );
    const pendingPoints = (lots.data ?? []).reduce(
      (sum, lot) => sum + Number(lot.reserved_points ?? 0),
      0,
    );
    const ninetyDays = Date.now() + 90 * 24 * 60 * 60 * 1_000;
    const expiringLots = (lots.data ?? []).filter(
      (lot) => new Date(String(lot.expires_at)).getTime() <= ninetyDays,
    );
    const tier = oneRelation(
      member.data.club_tiers as
        | Record<string, unknown>
        | Array<Record<string, unknown>>
        | null,
    );
    return {
      availablePoints,
      expiringPoints: expiringLots.reduce(
        (sum, lot) =>
          sum +
          Math.max(
            0,
            Number(lot.remaining_points ?? 0) -
              Number(lot.reserved_points ?? 0),
          ),
        0,
      ),
      ledger: (ledger.data ?? []).map((row) => ({
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        id: row.id,
        points: Number(row.points ?? 0),
        reason: row.reason,
        type: loyaltyEntryType(row as Record<string, unknown>),
      })),
      memberEmail: member.data.email,
      memberId: member.data.id,
      memberName: memberName(member.data as Record<string, unknown>),
      multiplier: Number(multiplier.data?.multiplier ?? 1),
      nextExpirationAt: expiringLots[0]?.expires_at ?? null,
      pendingPoints,
      redemptionRate: {
        discountCents: Number(
          organization.data?.loyalty_discount_unit_cents ?? 1_000,
        ),
        points: Number(organization.data?.loyalty_points_per_unit ?? 100),
      },
      tierName: tier?.name ?? null,
    };
  }

  async redeemMemberLoyalty(input: {
    idempotencyKey: string;
    points: number;
    shipmentId: string;
  }): Promise<Record<string, unknown>> {
    assertUuid(input.shipmentId, "Shipment");
    const principal = await this.requireMember();
    const { data, error } = await this.admin.rpc("reserve_loyalty_discount", {
      p_actor_user_id: principal.user.authUserId,
      p_idempotency_key: input.idempotencyKey,
      p_member_id: principal.user.id,
      p_organization_id: principal.organization.id,
      p_points: input.points,
      p_shipment_id: input.shipmentId,
    });
    if (error) {
      throw new AppError(
        409,
        "conflict",
        "Those points cannot be applied to the upcoming shipment.",
      );
    }
    await this.recordDomainAnalyticsEvent(principal, {
      eventData: {
        points: input.points,
        shipmentId: input.shipmentId,
      },
      eventType: "loyalty.redeemed",
      memberId: principal.user.id,
      requestKey: `loyalty:${input.idempotencyKey}`,
    });
    return toPublicRecord(data);
  }

  async applyUnsubscribe(token: string): Promise<void> {
    const claims = await verifyUnsubscribeToken(this.env, token);
    const { data, error } = await this.admin.rpc("apply_email_unsubscribe", {
      p_signed_token: token,
    });
    const applied = returnedRpcRow(data);
    if (
      error ||
      applied?.member_id !== claims.memberId ||
      applied?.organization_id !== claims.organizationId ||
      applied?.trigger_type !== claims.triggerType
    ) {
      throw databaseError("The email preference could not be updated.");
    }
  }
}

async function runEmailOutbox(
  env: WorkerEnv,
  admin: SupabaseClient,
): Promise<{ failed: number; sent: number }> {
  const workerId = crypto.randomUUID();
  const { data, error } = await admin.rpc("claim_email_outbox_batch", {
    p_lease_seconds: 300,
    p_limit: EMAIL_BATCH_LIMIT,
    p_worker_id: workerId,
  });
  if (error) throw databaseError("The email outbox could not be claimed.");
  const rows = (data ?? []) as ClaimedEmail[];
  return deliverClaimedEmails({
    appOrigin: requireConfigured(env.APP_ORIGIN, "APP_ORIGIN"),
    env,
    mark: (row, status, providerId) =>
      markEmail(admin, row, status, providerId),
    provider: createTransactionalEmailProvider(env),
    registerUnsubscribe: async (row, token, signedAt, expiresAt) => {
      if (!row.member_id) return;
      const { error } = await admin.rpc("issue_email_unsubscribe_token", {
        p_expires_at: expiresAt.toISOString(),
        p_member_id: row.member_id,
        p_organization_id: row.organization_id,
        p_signed_at: signedAt.toISOString(),
        p_signed_token: token,
        p_signing_key_id: "v1",
        p_trigger_type: row.trigger_type,
      });
      if (error) {
        throw databaseError("The email preference link could not be issued.");
      }
    },
    rows,
  });
}

export async function runRetentionSchedule(
  env: WorkerEnv,
  asOf = new Date(),
): Promise<{
  churnScoresUpdated: number;
  email: { failed: number; sent: number };
  loyaltyExpired: number;
  loyaltyEventsProcessed: number;
}> {
  const admin = createAdminClient(env);
  const { error: enqueueError } = await admin.rpc("enqueue_due_email_triggers", {
    p_as_of: asOf.toISOString(),
  });
  if (enqueueError) {
    throw databaseError("Due transactional emails could not be queued.");
  }
  const email = getConfigurationReport(env).communications.configured
    ? await runEmailOutbox(env, admin)
    : { failed: 0, sent: 0 };
  let churnScoresUpdated = 0;
  let loyaltyExpired = 0;
  let loyaltyEventsProcessed = 0;
  if (asOf.getUTCHours() === DAILY_JOB_UTC_HOUR) {
    const [churn, expired, awards] = await Promise.all([
      admin.rpc("calculate_nightly_churn_scores", {
        p_calculated_at: asOf.toISOString(),
        p_organization_id: null,
      }),
      admin.rpc("expire_loyalty_points", {
        p_as_of: asOf.toISOString(),
        p_organization_id: null,
      }),
      admin.rpc("process_daily_loyalty_awards", {
        p_as_of: asOf.toISOString().slice(0, 10),
        p_organization_id: null,
      }),
    ]);
    if (churn.error) throw databaseError("Nightly churn scoring failed.");
    if (expired.error) throw databaseError("Loyalty expiration failed.");
    if (awards.error) throw databaseError("Daily loyalty awards failed.");
    churnScoresUpdated = Number(churn.data ?? 0);
    loyaltyExpired = Number(expired.data ?? 0);
    loyaltyEventsProcessed = Number(awards.data ?? 0);
  }
  return {
    churnScoresUpdated,
    email,
    loyaltyExpired,
    loyaltyEventsProcessed,
  };
}

export function isEmailTrigger(value: string): value is EmailTriggerType {
  return (EMAIL_TRIGGERS as readonly string[]).includes(value);
}
