import { AppError } from "../lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRIPE_IDEMPOTENCY_KEY_LIMIT = 255;

export type StripeBillingOperation =
  | "checkout"
  | "member_portal"
  | "staff_portal";
export type StripeCustomerScope = "brand" | "member" | "organization";
export interface CanonicalStripeCustomerCreateParams {
  metadata: Record<string, string>;
}
export type StripeSubscriptionStatus =
  | "active"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "not_started"
  | "past_due"
  | "paused"
  | "trialing"
  | "unpaid";

export interface StripeCustomerClaim {
  customerId: string | null;
  leaseToken: string | null;
  state: "busy" | "claimed" | "ready";
}

export interface StripeCustomerProvisioningStore {
  claim(input: {
    brandId: string | null;
    leaseToken: string;
    memberId: string | null;
    organizationId: string;
    scope: StripeCustomerScope;
    subjectId: string;
  }): Promise<StripeCustomerClaim>;
  finalize(input: {
    customerId: string;
    leaseToken: string;
    organizationId: string;
    scope: StripeCustomerScope;
    subjectId: string;
  }): Promise<string>;
}

export interface StripeBillingAttemptClaim {
  attemptId: string;
  leaseToken: string | null;
  planTier: "cellar" | "estate" | "reserve" | "vine" | null;
  providerPayloadKey: string;
  providerSessionId: string | null;
  state:
    | "busy"
    | "claimed"
    | "closed"
    | "awaiting_reconciliation"
    | "open_attempt"
    | "recover"
    | "replay"
    | "subscription_exists";
}

export interface StripeBillingAttemptStore {
  claim(input: {
    attemptId: string;
    brandId: string;
    customerId: string;
    fingerprint: string;
    leaseToken: string;
    memberId: string | null;
    operation: StripeBillingOperation;
    organizationId: string;
    planTier: "cellar" | "estate" | "reserve" | "vine" | null;
    providerPayloadKey: string;
    subjectId: string;
  }): Promise<StripeBillingAttemptClaim>;
  close(input: {
    attemptId: string;
    status: "awaiting_webhook" | "expired" | "failed";
  }): Promise<void>;
  finalize(input: {
    attemptId: string;
    customerId: string;
    leaseToken: string;
    providerSessionId: string;
    status: "completed" | "open";
  }): Promise<void>;
}

function rpcRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object"
    ? (row as Record<string, unknown>)
    : null;
}

function databaseFailure(
  error: { code?: string } | null,
  message: string,
): AppError {
  if (error?.code === "23514") {
    return new AppError(
      409,
      "conflict",
      "A billing attempt identifier cannot be reused with changed input.",
    );
  }
  return new AppError(500, "upstream_error", message);
}

export function supabaseStripeCustomerProvisioningStore(
  admin: SupabaseClient,
): StripeCustomerProvisioningStore {
  return {
    async claim(input) {
      const { data, error } = await admin.rpc(
        "claim_stripe_customer_provisioning",
        {
          p_brand_id: input.brandId,
          p_lease_token: input.leaseToken,
          p_member_id: input.memberId,
          p_organization_id: input.organizationId,
          p_scope: input.scope,
          p_subject_id: input.subjectId,
        },
      );
      if (error) {
        throw databaseFailure(error, "Billing initialization could not be claimed.");
      }
      const row = rpcRow(data);
      if (
        !row ||
        !["busy", "claimed", "ready"].includes(String(row.state))
      ) {
        throw databaseFailure(null, "Billing initialization returned an invalid claim.");
      }
      return {
        customerId:
          typeof row.stripe_customer_id === "string"
            ? row.stripe_customer_id
            : null,
        leaseToken:
          typeof row.lease_token === "string" ? row.lease_token : null,
        state: String(row.state) as StripeCustomerClaim["state"],
      };
    },
    async finalize(input) {
      const { data, error } = await admin.rpc(
        "finalize_stripe_customer_provisioning",
        {
          p_lease_token: input.leaseToken,
          p_organization_id: input.organizationId,
          p_scope: input.scope,
          p_stripe_customer_id: input.customerId,
          p_subject_id: input.subjectId,
        },
      );
      if (error || typeof data !== "string") {
        throw databaseFailure(error, "Billing initialization could not be finalized.");
      }
      return data;
    },
  };
}

export function supabaseStripeBillingAttemptStore(
  admin: SupabaseClient,
): StripeBillingAttemptStore {
  return {
    async claim(input) {
      const { data, error } = await admin.rpc("claim_stripe_billing_attempt", {
        p_attempt_id: input.attemptId,
        p_billing_subject_id: input.subjectId,
        p_brand_id: input.brandId,
        p_lease_token: input.leaseToken,
        p_member_id: input.memberId,
        p_operation: input.operation,
        p_organization_id: input.organizationId,
        p_plan_tier: input.planTier,
        p_provider_payload_key: input.providerPayloadKey,
        p_request_fingerprint: input.fingerprint,
        p_stripe_customer_id: input.customerId,
      });
      if (error) {
        throw databaseFailure(error, "The billing request could not be claimed.");
      }
      const row = rpcRow(data);
      const state = String(row?.state ?? "");
      if (
        !row ||
        ![
          "busy",
          "claimed",
          "closed",
          "awaiting_reconciliation",
          "open_attempt",
          "recover",
          "replay",
          "subscription_exists",
        ].includes(state)
      ) {
        throw databaseFailure(null, "The billing request returned an invalid claim.");
      }
      return {
        attemptId: String(row.attempt_id),
        leaseToken:
          typeof row.lease_token === "string" ? row.lease_token : null,
        planTier:
          typeof row.plan_tier === "string"
            ? (row.plan_tier as StripeBillingAttemptClaim["planTier"])
            : null,
        providerPayloadKey: String(row.provider_payload_key),
        providerSessionId:
          typeof row.provider_session_id === "string"
            ? row.provider_session_id
            : null,
        state: state as StripeBillingAttemptClaim["state"],
      };
    },
    async close(input) {
      const { error } = await admin.rpc("close_stripe_billing_attempt", {
        p_attempt_id: input.attemptId,
        p_status: input.status,
      });
      if (error) {
        throw databaseFailure(error, "The billing request could not be reconciled.");
      }
    },
    async finalize(input) {
      const { error } = await admin.rpc("finalize_stripe_billing_attempt", {
        p_attempt_id: input.attemptId,
        p_lease_token: input.leaseToken,
        p_provider_session_id: input.providerSessionId,
        p_status: input.status,
        p_stripe_customer_id: input.customerId,
      });
      if (error) {
        throw databaseFailure(error, "The billing request could not be finalized.");
      }
    },
  };
}

export function assertOpaqueBillingAttemptId(attemptId: string): void {
  if (!UUID.test(attemptId)) {
    throw new AppError(
      400,
      "invalid_request",
      "The billing attempt identifier is invalid.",
    );
  }
}

function assertIdempotencyKey(key: string): string {
  if (
    key.length >= STRIPE_IDEMPOTENCY_KEY_LIMIT ||
    /@|\s|email|name|phone|address/i.test(key)
  ) {
    throw new AppError(
      500,
      "configuration_error",
      "The billing retry key is invalid.",
    );
  }
  return key;
}

export function stripeCustomerIdempotencyKey(input: {
  organizationId: string;
  scope: StripeCustomerScope;
  subjectId: string;
}): string {
  return assertIdempotencyKey(
    `vinifera:customer:v1:${input.scope}:${input.organizationId}:${input.subjectId}`,
  );
}

export function canonicalStripeCustomerCreateParams(input: {
  brandId: string | null;
  memberId: string | null;
  organizationId: string;
  scope: StripeCustomerScope;
  subjectId: string;
}): CanonicalStripeCustomerCreateParams {
  for (const [label, value] of [
    ["organization", input.organizationId],
    ["subject", input.subjectId],
    ...(input.brandId ? ([["brand", input.brandId]] as const) : []),
    ...(input.memberId ? ([["member", input.memberId]] as const) : []),
  ] as const) {
    if (!UUID.test(value)) {
      throw new AppError(
        500,
        "configuration_error",
        `The Stripe customer ${label} identity is invalid.`,
      );
    }
  }
  const validScope =
    (input.scope === "organization" &&
      input.subjectId === input.organizationId &&
      input.brandId === null &&
      input.memberId === null) ||
    (input.scope === "brand" &&
      input.subjectId === input.brandId &&
      input.brandId !== null &&
      input.memberId === null) ||
    (input.scope === "member" &&
      input.subjectId === input.memberId &&
      input.brandId !== null &&
      input.memberId !== null);
  if (!validScope) {
    throw new AppError(
      500,
      "configuration_error",
      "The Stripe customer scope does not match its immutable identity.",
    );
  }
  return {
    metadata: {
      customer_scope: input.scope,
      organization_id: input.organizationId,
      ...(input.brandId ? { brand_id: input.brandId } : {}),
      ...(input.memberId ? { member_id: input.memberId } : {}),
    },
  };
}

export function stripeSessionIdempotencyKey(input: {
  attemptId: string;
  brandId: string;
  operation: StripeBillingOperation;
  organizationId: string;
  subjectId: string;
}): string {
  assertOpaqueBillingAttemptId(input.attemptId);
  return assertIdempotencyKey(
    `vinifera:billing:v1:${input.operation}:${input.organizationId}:${input.brandId}:${input.subjectId}:${input.attemptId}`,
  );
}

export function stripeClientReferenceId(input: {
  brandId: string;
  organizationId: string;
}): string {
  return `vinifera:${input.organizationId}:${input.brandId}`;
}

export function isNonterminalSubscriptionStatus(
  status: string | null | undefined,
): boolean {
  return Boolean(
    status &&
      status !== "not_started" &&
      status !== "canceled" &&
      status !== "incomplete_expired",
  );
}

export async function stripeBillingRequestFingerprint(input: {
  attemptId: string;
  brandId: string;
  customerId: string;
  operation: StripeBillingOperation;
  organizationId: string;
  planTier?: string | null;
  providerPayloadKey: string;
  subjectId: string;
}): Promise<string> {
  assertOpaqueBillingAttemptId(input.attemptId);
  const canonical = [
    "v1",
    input.operation,
    input.organizationId,
    input.brandId,
    input.subjectId,
    input.customerId,
    input.planTier ?? "-",
    input.providerPayloadKey,
  ].join(":");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Buffer.from(digest).toString("hex");
}

export async function provisionStripeCustomer(input: {
  brandId: string | null;
  createCustomer: (
    params: CanonicalStripeCustomerCreateParams,
    idempotencyKey: string,
  ) => Promise<{ id: string }>;
  memberId: string | null;
  organizationId: string;
  scope: StripeCustomerScope;
  store: StripeCustomerProvisioningStore;
  subjectId: string;
}): Promise<string> {
  const leaseToken = crypto.randomUUID();
  const claim = await input.store.claim({
    brandId: input.brandId,
    leaseToken,
    memberId: input.memberId,
    organizationId: input.organizationId,
    scope: input.scope,
    subjectId: input.subjectId,
  });
  if (claim.state === "ready" && claim.customerId) return claim.customerId;
  if (claim.state === "busy" || !claim.leaseToken) {
    throw new AppError(
      409,
      "conflict",
      "Billing initialization is already in progress. Retry this request shortly.",
    );
  }

  const created = await input.createCustomer(
    canonicalStripeCustomerCreateParams(input),
    stripeCustomerIdempotencyKey({
      organizationId: input.organizationId,
      scope: input.scope,
      subjectId: input.subjectId,
    }),
  );
  try {
    return await input.store.finalize({
      customerId: created.id,
      leaseToken: claim.leaseToken,
      organizationId: input.organizationId,
      scope: input.scope,
      subjectId: input.subjectId,
    });
  } catch {
    throw new AppError(
      502,
      "upstream_error",
      "Billing initialization will reconcile safely when this request is retried.",
    );
  }
}

export async function executeStripeBillingAttempt(input: {
  attemptId: string;
  brandId: string;
  createSession: (input: {
    attemptId: string;
    idempotencyKey: string;
    planTier: "cellar" | "estate" | "reserve" | "vine" | null;
    providerPayloadKey: string;
  }) => Promise<{ id: string; url: string | null }>;
  customerId: string;
  memberId: string | null;
  operation: StripeBillingOperation;
  organizationId: string;
  planTier: "cellar" | "estate" | "reserve" | "vine" | null;
  providerPayloadKey: string;
  reconcileOpenCheckout: (
    providerSessionId: string,
  ) => Promise<{
    status: "complete" | "expired" | "open";
    url?: string | null;
  }>;
  store: StripeBillingAttemptStore;
  subjectId: string;
}): Promise<{ url: string }> {
  assertOpaqueBillingAttemptId(input.attemptId);
  const fingerprint = await stripeBillingRequestFingerprint(input);
  let claim = await input.store.claim({
    attemptId: input.attemptId,
    brandId: input.brandId,
    customerId: input.customerId,
    fingerprint,
    leaseToken: crypto.randomUUID(),
    memberId: input.memberId,
    operation: input.operation,
    organizationId: input.organizationId,
    planTier: input.planTier,
    providerPayloadKey: input.providerPayloadKey,
    subjectId: input.subjectId,
  });

  if (claim.state === "subscription_exists") {
    throw new AppError(
      409,
      "conflict",
      "An existing subscription must be managed in the billing portal.",
    );
  }
  if (claim.state === "busy") {
    throw new AppError(
      409,
      "conflict",
      "A billing request is already in progress. Retry this request shortly.",
    );
  }
  if (claim.state === "awaiting_reconciliation") {
    throw new AppError(
      409,
      "conflict",
      "The completed checkout is awaiting durable subscription reconciliation.",
    );
  }
  if (claim.state === "closed") {
    throw new AppError(
      409,
      "conflict",
      "The previous billing attempt is closed. Start a new billing attempt.",
    );
  }
  if (
    claim.state === "replay" &&
    input.operation === "checkout" &&
    claim.providerSessionId
  ) {
    const remote = await input.reconcileOpenCheckout(claim.providerSessionId);
    if (remote.status === "open" && remote.url) {
      return { url: remote.url };
    }
    await input.store.close({
      attemptId: claim.attemptId,
      status:
        remote.status === "expired" ? "expired" : "awaiting_webhook",
    });
    throw new AppError(
      409,
      "conflict",
      remote.status === "expired"
        ? "The previous checkout expired. Start a new billing attempt."
        : "The checkout completed and is awaiting subscription reconciliation.",
    );
  }
  if (claim.state === "open_attempt") {
    if (!claim.providerSessionId) {
      throw new AppError(
        409,
        "conflict",
        "A billing request is already in progress. Retry this request shortly.",
      );
    }
    const remote = await input.reconcileOpenCheckout(claim.providerSessionId);
    if (remote.status !== "expired") {
      if (remote.status === "complete") {
        await input.store.close({
          attemptId: claim.attemptId,
          status: "awaiting_webhook",
        });
      }
      throw new AppError(
        409,
        "conflict",
        remote.status === "open"
          ? "An existing checkout is still open."
          : "An existing checkout completed and is awaiting subscription reconciliation.",
      );
    }
    await input.store.close({
      attemptId: claim.attemptId,
      status: "expired",
    });
    claim = await input.store.claim({
      attemptId: input.attemptId,
      brandId: input.brandId,
      customerId: input.customerId,
      fingerprint,
      leaseToken: crypto.randomUUID(),
      memberId: input.memberId,
      operation: input.operation,
      organizationId: input.organizationId,
      planTier: input.planTier,
      providerPayloadKey: input.providerPayloadKey,
      subjectId: input.subjectId,
    });
  }

  if (
    (claim.state !== "claimed" &&
      claim.state !== "recover" &&
      claim.state !== "replay") ||
    !claim.leaseToken
  ) {
    throw new AppError(
      409,
      "conflict",
      "The billing request could not be claimed safely.",
    );
  }
  const claimedPlan = claim.planTier ?? input.planTier;
  const recoveredDifferentAttempt =
    claim.state === "recover" && claim.attemptId !== input.attemptId;
  const session = await input.createSession({
    attemptId: claim.attemptId,
    idempotencyKey: stripeSessionIdempotencyKey({
      attemptId: claim.attemptId,
      brandId: input.brandId,
      operation: input.operation,
      organizationId: input.organizationId,
      subjectId: input.subjectId,
    }),
    planTier: claimedPlan,
    providerPayloadKey: claim.providerPayloadKey,
  });
  if (!session.url) {
    throw new AppError(
      502,
      "upstream_error",
      "Stripe did not return a billing URL.",
    );
  }
  try {
    await input.store.finalize({
      attemptId: claim.attemptId,
      customerId: input.customerId,
      leaseToken: claim.leaseToken,
      providerSessionId: session.id,
      status: input.operation === "checkout" ? "open" : "completed",
    });
  } catch {
    throw new AppError(
      502,
      "upstream_error",
      "The billing session will reconcile safely when this request is retried.",
    );
  }
  if (recoveredDifferentAttempt) {
    throw new AppError(
      409,
      "conflict",
      "A previous checkout was recovered and is still open.",
    );
  }
  return { url: session.url };
}
