import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../server/lib/errors";
import {
  assertOpaqueBillingAttemptId,
  canonicalStripeCustomerCreateParams,
  classifyOrganizationStripeCustomerState,
  executeStripeBillingAttempt,
  isNonterminalSubscriptionStatus,
  provisionOrganizationStripeCustomerOnSignup,
  provisionStripeCustomer,
  resolveOrganizationStripeCustomerOnSignup,
  stripeBillingRequestFingerprint,
  stripeClientReferenceId,
  stripeCustomerIdempotencyKey,
  stripeSessionIdempotencyKey,
  type CanonicalStripeCustomerCreateParams,
  type StripeBillingAttemptStore,
  type StripeCustomerProvisioningStore,
} from "../../server/services/stripe-runtime";

const organizationId = "10000000-0000-4000-8000-000000000001";
const brandId = "20000000-0000-4000-8000-000000000001";
const memberId = "30000000-0000-4000-8000-000000000001";
const attemptId = "40000000-0000-4000-8000-000000000001";
type CreateSession = (input: {
  attemptId: string;
  idempotencyKey: string;
  planTier: "cellar" | "estate" | "reserve" | "vine" | null;
  providerPayloadKey: string;
}) => Promise<{ id: string; url: string | null }>;

function inMemoryAttemptStore(): StripeBillingAttemptStore {
  const attempts = new Map<
    string,
    {
      customerId: string;
      fingerprint: string;
      operation: "checkout" | "member_portal" | "staff_portal";
      organizationId: string;
      planTier: "cellar" | "estate" | "reserve" | "vine" | null;
      providerPayloadKey: string;
      providerSessionId: string | null;
      status:
        | "awaiting_webhook"
        | "claimed"
        | "completed"
        | "expired"
        | "failed"
        | "open";
      subjectId: string;
    }
  >();
  return {
    async claim(input) {
      const existing = attempts.get(input.attemptId);
      if (existing) {
        if (existing.fingerprint !== input.fingerprint) {
          throw new AppError(
            409,
            "conflict",
            "A billing attempt identifier cannot be reused with changed input.",
          );
        }
        return {
          attemptId: input.attemptId,
          leaseToken: input.leaseToken,
          planTier: existing.planTier,
          providerPayloadKey: existing.providerPayloadKey,
          providerSessionId: existing.providerSessionId,
          state:
            existing.status === "awaiting_webhook"
              ? "awaiting_reconciliation"
              : existing.status === "open" || existing.status === "completed"
                ? "replay"
                : "claimed",
        };
      }
      const activeCheckout = [...attempts.entries()].find(
        ([, attempt]) =>
          attempt.operation === "checkout" &&
          attempt.organizationId === input.organizationId &&
          attempt.subjectId === input.subjectId &&
          ["awaiting_webhook", "claimed", "open"].includes(attempt.status),
      );
      if (input.operation === "checkout" && activeCheckout) {
        const [activeAttemptId, active] = activeCheckout;
        return {
          attemptId: activeAttemptId,
          leaseToken: null,
          planTier: active.planTier,
          providerPayloadKey: active.providerPayloadKey,
          providerSessionId: active.providerSessionId,
          state:
            active.status === "awaiting_webhook"
              ? "awaiting_reconciliation"
              : active.status === "open"
                ? "open_attempt"
                : "busy",
        };
      }
      attempts.set(input.attemptId, {
        customerId: input.customerId,
        fingerprint: input.fingerprint,
        operation: input.operation,
        organizationId: input.organizationId,
        planTier: input.planTier,
        providerPayloadKey: input.providerPayloadKey,
        providerSessionId: null,
        status: "claimed",
        subjectId: input.subjectId,
      });
      return {
        attemptId: input.attemptId,
        leaseToken: input.leaseToken,
        planTier: input.planTier,
        providerPayloadKey: input.providerPayloadKey,
        providerSessionId: null,
        state: "claimed",
      };
    },
    async close(input) {
      const existing = attempts.get(input.attemptId);
      if (existing) existing.status = input.status;
    },
    async finalize(input) {
      const existing = attempts.get(input.attemptId);
      if (!existing) throw new Error("missing attempt");
      existing.customerId = input.customerId;
      existing.providerSessionId = input.providerSessionId;
      existing.status = input.status;
    },
  };
}

function checkoutInput(
  store: StripeBillingAttemptStore,
  createSession: CreateSession,
  overrides: Partial<{
    attemptId: string;
    planTier: "cellar" | "estate" | "reserve" | "vine";
    providerPayloadKey: string;
  }> = {},
) {
  return {
    attemptId: overrides.attemptId ?? attemptId,
    brandId,
    createSession,
    customerId: "cus_runtime1",
    memberId: null,
    operation: "checkout" as const,
    organizationId,
    planTier: overrides.planTier ?? ("vine" as const),
    providerPayloadKey: overrides.providerPayloadKey ?? "price_runtime1",
    reconcileOpenCheckout: vi.fn().mockResolvedValue({
      status: "open" as const,
      url: "https://checkout.stripe.test/runtime1",
    }),
    store,
    subjectId: organizationId,
  };
}

describe("Stripe billing runtime retry safety", () => {
  it("defers signup Customer provisioning without invoking Stripe when disconnected", async () => {
    const store: StripeCustomerProvisioningStore = {
      claim: vi.fn(),
      finalize: vi.fn(),
    };
    const createCustomer = vi.fn();

    await expect(
      provisionOrganizationStripeCustomerOnSignup({
        configured: false,
        createCustomer,
        organizationId,
        store,
      }),
    ).resolves.toBeNull();
    expect(store.claim).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("creates the organization Customer as an idempotent signup consequence when connected", async () => {
    const store: StripeCustomerProvisioningStore = {
      claim: vi.fn(async ({ leaseToken }) => ({
        customerId: null,
        leaseToken,
        state: "claimed" as const,
      })),
      finalize: vi.fn(async ({ customerId }) => customerId),
    };
    const createCustomer = vi.fn().mockResolvedValue({ id: "cus_signup1" });

    await expect(
      provisionOrganizationStripeCustomerOnSignup({
        configured: true,
        createCustomer,
        organizationId,
        store,
      }),
    ).resolves.toBe("cus_signup1");
    expect(createCustomer).toHaveBeenCalledWith(
      {
        metadata: {
          customer_scope: "organization",
          organization_id: organizationId,
        },
      },
      `vinifera:customer:v1:organization:${organizationId}:${organizationId}`,
    );
  });

  it("keeps an existing durable signup Customer ready after credentials are disconnected", async () => {
    const store: StripeCustomerProvisioningStore = {
      claim: vi.fn(),
      finalize: vi.fn(),
    };
    const createCustomer = vi.fn();

    await expect(
      resolveOrganizationStripeCustomerOnSignup({
        configured: false,
        createCustomer,
        currentCustomerId: "cus_signupExisting1",
        organizationId,
        readError: null,
        store,
      }),
    ).resolves.toBe("ready");
    expect(store.claim).not.toHaveBeenCalled();
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("reports uncertain signup Customer state for safe reconciliation", async () => {
    const store: StripeCustomerProvisioningStore = {
      claim: vi.fn(async ({ leaseToken }) => ({
        customerId: null,
        leaseToken,
        state: "claimed" as const,
      })),
      finalize: vi.fn(),
    };
    const createCustomer = vi.fn().mockRejectedValue(new Error("provider timeout"));

    await expect(
      resolveOrganizationStripeCustomerOnSignup({
        configured: true,
        createCustomer,
        currentCustomerId: null,
        organizationId,
        readError: null,
        store,
      }),
    ).resolves.toBe("reconciliation_required");
    expect(
      classifyOrganizationStripeCustomerState(
        undefined,
        new Error("database timeout"),
      ),
    ).toBe("reconciliation_required");
  });

  it("replays the same checkout attempt from its stored open session", async () => {
    const store = inMemoryAttemptStore();
    const sessions = new Map<string, { id: string; url: string }>();
    const createSession = vi.fn(
      async ({ idempotencyKey }: { idempotencyKey: string }) => {
        const session = sessions.get(idempotencyKey) ?? {
          id: "cs_test_runtime1",
          url: "https://checkout.stripe.test/runtime1",
        };
        sessions.set(idempotencyKey, session);
        return session;
      },
    );

    const first = await executeStripeBillingAttempt(
      checkoutInput(store, createSession),
    );
    const retry = await executeStripeBillingAttempt(
      checkoutInput(store, createSession),
    );

    expect(retry).toEqual(first);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sessions.size).toBe(1);
  });

  it("rejects one attempt UUID reused with changed checkout input", async () => {
    const store = inMemoryAttemptStore();
    const createSession = vi.fn().mockResolvedValue({
      id: "cs_test_runtime1",
      url: "https://checkout.stripe.test/runtime1",
    });
    await executeStripeBillingAttempt(checkoutInput(store, createSession));

    await expect(
      executeStripeBillingAttempt(
        checkoutInput(store, createSession, {
          providerPayloadKey: "price_changed_runtime2",
        }),
      ),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("uses one customer identity across parallel provisioning claims", async () => {
    const canonical = new Map<string, string>();
    const store: StripeCustomerProvisioningStore = {
      claim: vi.fn(async ({ leaseToken }) => ({
        customerId: null,
        leaseToken,
        state: "claimed" as const,
      })),
      finalize: vi.fn(async ({ customerId }) => customerId),
    };
    const createCustomer = vi.fn(async (
      _params: CanonicalStripeCustomerCreateParams,
      idempotencyKey: string,
    ) => {
      const id = canonical.get(idempotencyKey) ?? "cus_parallel1";
      canonical.set(idempotencyKey, id);
      return { id };
    });
    const provision = () =>
      provisionStripeCustomer({
        brandId,
        createCustomer,
        memberId,
        organizationId,
        scope: "member",
        store,
        subjectId: memberId,
      });

    const customers = await Promise.all([provision(), provision()]);

    expect(customers).toEqual(["cus_parallel1", "cus_parallel1"]);
    expect(canonical.size).toBe(1);
    expect(createCustomer.mock.calls[0]![1]).toBe(
      createCustomer.mock.calls[1]![1],
    );
    expect(createCustomer.mock.calls[0]![0]).toEqual({
      metadata: {
        brand_id: brandId,
        customer_scope: "member",
        member_id: memberId,
        organization_id: organizationId,
      },
    });
  });

  it("reconciles a provider Customer after a database finalize failure", async () => {
    let finalizeAttempts = 0;
    const store: StripeCustomerProvisioningStore = {
      claim: vi.fn(async ({ leaseToken }) => ({
        customerId: null,
        leaseToken,
        state: "claimed" as const,
      })),
      finalize: vi.fn(async ({ customerId }) => {
        finalizeAttempts += 1;
        if (finalizeAttempts === 1) throw new Error("transient database failure");
        return customerId;
      }),
    };
    const providerObjects = new Map<string, string>();
    const createCustomer = vi.fn(async (
      _params: CanonicalStripeCustomerCreateParams,
      idempotencyKey: string,
    ) => {
      const id = providerObjects.get(idempotencyKey) ?? "cus_reconciled1";
      providerObjects.set(idempotencyKey, id);
      return { id };
    });
    const provision = () =>
      provisionStripeCustomer({
        brandId: null,
        createCustomer,
        memberId: null,
        organizationId,
        scope: "organization",
        store,
        subjectId: organizationId,
      });

    await expect(provision()).rejects.toMatchObject({
      code: "upstream_error",
      status: 502,
    });
    await expect(provision()).resolves.toBe("cus_reconciled1");
    expect(providerObjects.size).toBe(1);
    expect(createCustomer.mock.calls[0]![1]).toBe(
      createCustomer.mock.calls[1]![1],
    );
  });

  it("keeps Customer payloads canonical when mutable owner, name, and plan data changes", () => {
    const mutableRetries = [
      {
        ownerEmail: "first-owner@example.test",
        organizationName: "First Winery Name",
        planTier: "vine",
      },
      {
        ownerEmail: "replacement-owner@example.test",
        organizationName: "Renamed Winery",
        planTier: "reserve",
      },
    ];
    const payloads = mutableRetries.map(() =>
      canonicalStripeCustomerCreateParams({
        brandId: null,
        memberId: null,
        organizationId,
        scope: "organization",
        subjectId: organizationId,
      }),
    );

    expect(payloads[0]).toEqual(payloads[1]);
    expect(payloads[0]).toEqual({
      metadata: {
        customer_scope: "organization",
        organization_id: organizationId,
      },
    });
    expect(JSON.stringify(payloads)).not.toMatch(
      /@|owner|winery|plan|email|name|phone|address/i,
    );
  });

  it("retries a checkout database finalize without creating a second provider session", async () => {
    const baseStore = inMemoryAttemptStore();
    let finalizeAttempts = 0;
    const store: StripeBillingAttemptStore = {
      ...baseStore,
      async finalize(input) {
        finalizeAttempts += 1;
        if (finalizeAttempts === 1) {
          throw new Error("transient database failure");
        }
        await baseStore.finalize(input);
      },
    };
    const providerSessions = new Map<
      string,
      { id: string; url: string }
    >();
    const createSession = vi.fn(
      async ({ idempotencyKey }: { idempotencyKey: string }) => {
        const session = providerSessions.get(idempotencyKey) ?? {
          id: "cs_test_finalize1",
          url: "https://checkout.stripe.test/finalize1",
        };
        providerSessions.set(idempotencyKey, session);
        return session;
      },
    );

    await expect(
      executeStripeBillingAttempt(checkoutInput(store, createSession)),
    ).rejects.toMatchObject({ code: "upstream_error", status: 502 });
    await expect(
      executeStripeBillingAttempt(checkoutInput(store, createSession)),
    ).resolves.toEqual({ url: "https://checkout.stripe.test/finalize1" });
    expect(providerSessions.size).toBe(1);
    expect(createSession.mock.calls[0]![0].idempotencyKey).toBe(
      createSession.mock.calls[1]![0].idempotencyKey,
    );
  });

  it("blocks a checkout when the database reports an existing subscription", async () => {
    const store: StripeBillingAttemptStore = {
      claim: vi.fn(async (input) => ({
        attemptId: input.attemptId,
        leaseToken: null,
        planTier: input.planTier,
        providerPayloadKey: input.providerPayloadKey,
        providerSessionId: null,
        state: "subscription_exists" as const,
      })),
      close: vi.fn(),
      finalize: vi.fn(),
    };
    const createSession = vi.fn(async () => ({
      id: "cs_test_unreachable",
      url: "https://checkout.stripe.test/unreachable",
    }));

    await expect(
      executeStripeBillingAttempt(checkoutInput(store, createSession)),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(createSession).not.toHaveBeenCalled();
    expect(isNonterminalSubscriptionStatus("incomplete")).toBe(true);
    expect(isNonterminalSubscriptionStatus("active")).toBe(true);
    expect(isNonterminalSubscriptionStatus("canceled")).toBe(false);
    expect(isNonterminalSubscriptionStatus("incomplete_expired")).toBe(false);
  });

  it("reconciles and blocks another nonterminal open checkout attempt", async () => {
    const store: StripeBillingAttemptStore = {
      claim: vi.fn(async (input) => ({
        attemptId: "40000000-0000-4000-8000-000000000009",
        leaseToken: null,
        planTier: "vine" as const,
        providerPayloadKey: input.providerPayloadKey,
        providerSessionId: "cs_test_existing9",
        state: "open_attempt" as const,
      })),
      close: vi.fn(),
      finalize: vi.fn(),
    };
    const createSession = vi.fn(async () => ({
      id: "cs_test_unreachable",
      url: "https://checkout.stripe.test/unreachable",
    }));
    const input = checkoutInput(store, createSession);

    await expect(executeStripeBillingAttempt(input)).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
    expect(input.reconcileOpenCheckout).toHaveBeenCalledWith(
      "cs_test_existing9",
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(store.close).not.toHaveBeenCalled();
  });

  it("blocks every checkout for the billing subject until its completed session is reconciled by webhook", async () => {
    const store = inMemoryAttemptStore();
    const createSession = vi.fn().mockResolvedValue({
      id: "cs_test_awaiting1",
      url: "https://checkout.stripe.test/awaiting1",
    });
    await executeStripeBillingAttempt(checkoutInput(store, createSession));

    const completedRetry = checkoutInput(store, createSession);
    completedRetry.reconcileOpenCheckout.mockResolvedValue({
      status: "complete",
      url: null,
    });
    await expect(
      executeStripeBillingAttempt(completedRetry),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });

    await expect(
      executeStripeBillingAttempt(
        checkoutInput(store, createSession, {
          attemptId: "40000000-0000-4000-8000-000000000002",
        }),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed UUIDs and keeps retry keys PII-free and below Stripe limits", async () => {
    expect(() => assertOpaqueBillingAttemptId("owner@example.com")).toThrowError(
      expect.objectContaining({ code: "invalid_request", status: 400 }),
    );
    const customerKey = stripeCustomerIdempotencyKey({
      organizationId,
      scope: "member",
      subjectId: memberId,
    });
    const sessionKey = stripeSessionIdempotencyKey({
      attemptId,
      brandId,
      operation: "member_portal",
      organizationId,
      subjectId: memberId,
    });
    const reference = stripeClientReferenceId({ brandId, organizationId });
    const fingerprint = await stripeBillingRequestFingerprint({
      attemptId,
      brandId,
      customerId: "cus_runtime1",
      operation: "member_portal",
      organizationId,
      providerPayloadKey: "member_portal:v1",
      subjectId: memberId,
    });

    for (const value of [customerKey, sessionKey, reference]) {
      expect(value.length).toBeLessThan(255);
      expect(value).not.toMatch(/@|owner|member\.example|name|phone|address/i);
    }
    expect(reference).toBe(stripeClientReferenceId({ brandId, organizationId }));
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
