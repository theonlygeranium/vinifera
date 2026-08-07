import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  assertLiveProofAuthority,
  assertLiveProofTargets,
  createApplicationStore,
  finalizeLiveProof,
  prepareLiveProof,
  sha256,
  stripeSignature,
  validateLiveProofPolicy,
} from "../../scripts/stripe-live-proof.mjs";

const accountId = "acct_Gate19Live";
const customerId = "cus_Gate19Owner";
const priceId = "price_Gate19Vine";
const plan = "vine";
const maximumAmountCents = 14900;
const amountCents = 14900;
const brandId = "20000000-0000-4000-8000-000000000002";
const organizationId = "10000000-0000-4000-8000-000000000001";
const workerOrigin = "https://vinifera-live.edstratumlabs.ai";
const supabaseOrigin = "https://production-project.supabase.co";
const gitSha = "a".repeat(40);
const nonce = "11111111-1111-4111-8111-111111111111";
const sessionId = "cs_live_Gate19Session";
const subscriptionId = "sub_Gate19Subscription";
const paymentIntentId = "pi_Gate19Payment";
const refundId = "re_Gate19Refund";
const createdEventId = "evt_Gate19Created";
const deletedEventId = "evt_Gate19Deleted";
const webhookSecret = "whsec_gate19_live_secret";

function rawPolicy(overrides = {}) {
  return {
    apiVersion: "2026-02-25.clover",
    checkoutExpiresAfterSeconds: 3600,
    confirmation: "AUTHORIZE ONE VINIFERA LIVE CHARGE AND REFUND",
    currency: "usd",
    enabled: true,
    metadata: { gate: "19", proofVersion: "2026-08-06-v1" },
    pollAttempts: 2,
    pollIntervalMilliseconds: 1000,
    schemaVersion: 1,
    targetHashes: {
      brandIdSha256: [sha256(brandId)],
      customerIdSha256: [sha256(customerId)],
      liveAccountIdSha256: [sha256(accountId)],
      maximumAmountCentsSha256: [sha256(String(maximumAmountCents))],
      organizationIdSha256: [sha256(organizationId)],
      planSha256: [sha256(plan)],
      priceIdSha256: [sha256(priceId)],
      supabaseOriginSha256: [sha256(supabaseOrigin)],
      workerOriginSha256: [sha256(workerOrigin)],
    },
    ...overrides,
  };
}

function environment(overrides = {}) {
  return {
    PRODUCTION_STRIPE_LIVE_PROOF_BRAND_ID: brandId,
    PRODUCTION_STRIPE_LIVE_PROOF_CUSTOMER_ID: customerId,
    PRODUCTION_STRIPE_LIVE_PROOF_MAX_AMOUNT_CENTS: String(maximumAmountCents),
    PRODUCTION_STRIPE_LIVE_PROOF_ORGANIZATION_ID: organizationId,
    PRODUCTION_STRIPE_LIVE_PROOF_PLAN: plan,
    PRODUCTION_STRIPE_LIVE_PROOF_PRICE_ID: priceId,
    PRODUCTION_STRIPE_LIVE_WEBHOOK_SECRET: webhookSecret,
    PRODUCTION_SUPABASE_URL: supabaseOrigin,
    PRODUCTION_WORKER_ORIGIN: workerOrigin,
    STRIPE_LIVE_PROOF_CONFIRMATION:
      "AUTHORIZE ONE VINIFERA LIVE CHARGE AND REFUND",
    STRIPE_LIVE_PROOF_GIT_SHA: gitSha,
    STRIPE_LIVE_PROOF_NONCE: nonce,
    STRIPE_LIVE_PROOF_REQUEST_BINDING_REVERSION: "true",
    ...overrides,
  };
}

function price(overrides = {}) {
  return {
    active: true,
    currency: "usd",
    id: priceId,
    livemode: true,
    metadata: { vinifera_plan: plan },
    product: {
      active: true,
      id: "prod_Gate19Vine",
      livemode: true,
      metadata: { vinifera_plan: plan },
    },
    recurring: { interval: "month", interval_count: 1 },
    type: "recurring",
    unit_amount: amountCents,
    ...overrides,
  };
}

function metadata(overrides = {}) {
  return {
    billing_mode: "independent",
    brand_id: brandId,
    organization_id: organizationId,
    plan_tier: plan,
    vinifera_gate: "19",
    vinifera_git_sha: gitSha,
    vinifera_proof_nonce: nonce,
    vinifera_proof_version: "2026-08-06-v1",
    ...overrides,
  };
}

function paymentIntent(overrides = {}) {
  return {
    amount_received: amountCents,
    created: 1001,
    currency: "usd",
    customer: customerId,
    id: paymentIntentId,
    livemode: true,
    status: "succeeded",
    ...overrides,
  };
}

function charge(overrides = {}) {
  return {
    amount: amountCents,
    amount_captured: amountCents,
    amount_refunded: 0,
    captured: true,
    currency: "usd",
    customer: customerId,
    failure_code: null,
    id: "ch_Gate19Charge",
    invoice: "in_Gate19Invoice",
    livemode: true,
    paid: true,
    payment_intent: paymentIntentId,
    refunded: false,
    ...overrides,
  };
}

function subscription(overrides = {}) {
  return {
    customer: customerId,
    id: subscriptionId,
    latest_invoice: {
      customer: customerId,
      id: "in_Gate19Invoice",
      livemode: true,
      parent: {
        subscription_details: { subscription: subscriptionId },
        type: "subscription_details",
      },
      status: "paid",
    },
    livemode: true,
    metadata: metadata(),
    status: "active",
    ...overrides,
  };
}

function session(overrides = {}) {
  const initialSubscription = subscription();
  return {
    amount_total: amountCents,
    created: 1000,
    currency: "usd",
    client_reference_id: `gate19:${nonce}`,
    customer: customerId,
    id: sessionId,
    invoice: initialSubscription.latest_invoice,
    expires_at: 2_000_000_000,
    line_items: { data: [{ price: { id: priceId }, quantity: 1 }] },
    livemode: true,
    metadata: metadata(),
    mode: "subscription",
    payment_status: "paid",
    status: "complete",
    subscription: initialSubscription,
    url: "https://checkout.stripe.com/c/pay/gate19",
    ...overrides,
  };
}

function stripeMock(overrides = {}) {
  const refunds = [...(overrides.refunds ?? [])];
  let currentSubscription = subscription(overrides.subscription);
  let preparedSession = null;
  const createdEvent = {
    created: 1002,
    data: {
      object: {
        id: subscriptionId,
        metadata: metadata(),
        status: "active",
      },
    },
    id: createdEventId,
    livemode: true,
    type: "customer.subscription.created",
    ...overrides.createdEvent,
  };
  const deletedEvent = {
    created: 1003,
    data: {
      object: {
        id: subscriptionId,
        metadata: metadata(),
        status: "canceled",
      },
    },
    id: deletedEventId,
    livemode: true,
    type: "customer.subscription.deleted",
  };
  return {
    accounts: { retrieve: vi.fn(async () => ({ id: accountId })) },
    checkout: {
      sessions: {
        create: vi.fn(async (input) => {
          preparedSession = session({
            amount_total: amountCents,
            client_reference_id: input.client_reference_id,
            expires_at: input.expires_at,
            metadata: input.metadata,
            payment_status: "unpaid",
            invoice: null,
            status: "open",
            subscription: null,
          });
          return preparedSession;
        }),
        list: vi.fn(async () => ({
          data: overrides.sessions ?? [],
          has_more: false,
        })),
        retrieve: vi.fn(
          async () => preparedSession ?? session(overrides.session),
        ),
      },
    },
    customers: {
      retrieve: vi.fn(async () =>
        overrides.customer ?? { id: customerId, livemode: true },
      ),
    },
    events: {
      list: vi.fn(async (input) =>
        overrides.eventList
          ? overrides.eventList(input, { createdEvent, deletedEvent })
          : {
              data: [
                input.type === "customer.subscription.created"
                  ? createdEvent
                  : deletedEvent,
              ],
              has_more: false,
            },
      ),
    },
    invoices: {
      retrieve: vi.fn(async (id) =>
        overrides.invoiceRetrieve
          ? overrides.invoiceRetrieve(id)
          : currentSubscription.latest_invoice,
      ),
    },
    invoicePayments: {
      list: vi.fn(async () => ({
        data: overrides.invoicePayments ?? [
          {
            amount_paid: amountCents,
            id: "inpay_Gate19",
            livemode: true,
            payment: {
              payment_intent: paymentIntent(),
              type: "payment_intent",
            },
            status: "paid",
          },
        ],
        has_more: false,
      })),
    },
    paymentIntents: {
      list: vi.fn(async (input) =>
        overrides.paymentIntentList
          ? overrides.paymentIntentList(input)
          : {
              data: overrides.paymentIntents ?? [paymentIntent()],
              has_more: false,
            },
      ),
      retrieve: vi.fn(async () => paymentIntent()),
    },
    prices: { retrieve: vi.fn(async () => price(overrides.price)) },
    charges: {
      list: vi.fn(async (input) =>
        overrides.chargeList
          ? overrides.chargeList(input)
          : {
              data: overrides.charges ?? [
                charge({
                  amount_refunded: refunds.some(
                    (refund) =>
                      refund.status === "succeeded" &&
                      (!refund.payment_intent ||
                        refund.payment_intent === paymentIntentId),
                  )
                    ? amountCents
                    : 0,
                  refunded: refunds.some(
                    (refund) =>
                      refund.status === "succeeded" &&
                      (!refund.payment_intent ||
                        refund.payment_intent === paymentIntentId),
                  ),
                }),
              ],
              has_more: false,
            },
      ),
      retrieve: vi.fn(async () =>
        charge({ amount_refunded: amountCents, refunded: true }),
      ),
    },
    refunds: {
      create: vi.fn(async (input) => {
        const created = {
          amount: input.amount,
          currency: "usd",
          id:
            input.payment_intent === paymentIntentId
              ? refundId
              : `re_${input.payment_intent}`,
          livemode: true,
          metadata: input.metadata,
          payment_intent: input.payment_intent,
          status: "succeeded",
        };
        refunds.push(created);
        return created;
      }),
      list: vi.fn(async (input) =>
        overrides.refundList
          ? overrides.refundList(input, refunds)
          : {
              data: refunds.filter(
                (refund) =>
                  !refund.payment_intent ||
                  refund.payment_intent === input.payment_intent,
              ),
              has_more: false,
            },
      ),
      retrieve: vi.fn(async (id) => refunds.find((refund) => refund.id === id)),
    },
    subscriptions: {
      cancel: vi.fn(async () => {
        currentSubscription = { ...currentSubscription, status: "canceled" };
        return currentSubscription;
      }),
      list: vi.fn(async () => ({
        data: overrides.subscriptions ?? [],
        has_more: false,
      })),
      retrieve: vi.fn(async () => currentSubscription),
    },
  };
}

function applicationStore({
  activationStatus = "active",
  activationType = "customer.subscription.created",
} = {}) {
  let status = "active";
  const activationObject =
    activationType === "invoice.payment_succeeded"
      ? {
          customer: customerId,
          id: "in_Gate19Activation",
          object: "invoice",
          parent: {
            subscription_details: { subscription: subscriptionId },
            type: "subscription_details",
          },
          status: activationStatus === "active" ? "paid" : activationStatus,
        }
      : {
          id: subscriptionId,
          metadata: metadata(),
          status: activationStatus,
        };
  return {
    activationEvents: vi.fn(async () => [{
      brand_id: brandId,
      event_type: activationType,
      id: createdEventId,
      livemode: true,
      organization_id: organizationId,
      payload: {
        data: { object: activationObject },
        id: createdEventId,
        livemode: true,
        type: activationType,
      },
      processed_at: "2026-08-06T00:00:00.000Z",
      processing_status: "applied",
      stripe_created_at: "2026-08-06T00:00:00.000Z",
      stripe_event_id: createdEventId,
    }]),
    event: vi.fn(async (eventId) => ({
      brand_id: brandId,
      event_type:
        eventId === createdEventId
          ? "customer.subscription.created"
          : "customer.subscription.deleted",
      id: eventId,
      livemode: true,
      organization_id: organizationId,
      payload: {
        data: {
          object: {
            id: subscriptionId,
            metadata: metadata(),
            status: "canceled",
          },
        },
      },
      processed_at: "2026-08-06T00:00:00.000Z",
      processing_status: "applied",
    })),
    setCanceled() {
      status = "canceled";
    },
    subject: vi.fn(async () => ({
      access_status: status === "active" ? "active" : "suspended",
      billing_mode: "independent",
      id: brandId,
      organization_id: organizationId,
      plan_tier: plan,
      stripe_state_updated_at: "2026-08-06T00:00:00.000Z",
      stripe_subscription_id: subscriptionId,
      subscription_status: status,
    })),
  };
}

function fetcher({ duplicate = true, revision = gitSha } = {}) {
  return vi.fn(async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({
          data: {
            environment: "production",
            revision,
            service: "vinifera-api",
            status: "ok",
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.pathname === "/api/health/configuration") {
      return new Response(
        JSON.stringify({
          data: {
            billing: { configured: true },
            webhook: { configured: true },
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.pathname === "/api/billing/webhook") {
      return new Response(JSON.stringify({ data: { duplicate } }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 404 });
  });
}

function ready() {
  const policy = validateLiveProofPolicy(rawPolicy(), { ready: true });
  const env = environment();
  return {
    authority: assertLiveProofAuthority(policy, "finalize", env),
    env,
    policy,
    targets: assertLiveProofTargets(policy, env),
  };
}

describe("Gate 19 reviewed authority", () => {
  it("ships disabled with every live financial target hash empty", async () => {
    const checkedIn = JSON.parse(
      await readFile("config/stripe-live-proof-policy.json", "utf8"),
    );
    expect(validateLiveProofPolicy(checkedIn).enabled).toBe(false);
    expect(
      Object.values(checkedIn.targetHashes).every(
        (hashes) => hashes.length === 0,
      ),
    ).toBe(true);
    expect(() => validateLiveProofPolicy(checkedIn, { ready: true })).toThrow(
      /exactly one reviewed target hash/,
    );
  });

  it("requires an exact owner confirmation, immutable main SHA, UUID, and targets", () => {
    const policy = validateLiveProofPolicy(rawPolicy(), { ready: true });
    expect(() =>
      assertLiveProofAuthority(
        policy,
        "prepare",
        environment({
          STRIPE_LIVE_PROOF_CONFIRMATION: "almost",
        }),
      ),
    ).toThrow(/exact owner/);
    expect(() =>
      assertLiveProofAuthority(
        policy,
        "prepare",
        environment({
          STRIPE_LIVE_PROOF_NONCE: "not-a-uuid",
        }),
      ),
    ).toThrow(/UUID/);
    expect(() =>
      assertLiveProofAuthority(
        policy,
        "prepare",
        environment({ STRIPE_LIVE_PROOF_GIT_SHA: "abc123" }),
      ),
    ).toThrow(/immutable main-branch Git SHA/);
    expect(() =>
      assertLiveProofTargets(
        policy,
        environment({
          PRODUCTION_STRIPE_LIVE_PROOF_MAX_AMOUNT_CENTS: "14901",
        }),
      ),
    ).toThrow(/maximumAmountCentsSha256/);
    expect(() =>
      assertLiveProofTargets(
        policy,
        environment({
          PRODUCTION_STRIPE_LIVE_PROOF_BRAND_ID:
            "30000000-0000-4000-8000-000000000003",
        }),
      ),
    ).toThrow(/brandIdSha256/);
  });
});

describe("Gate 19 hosted Checkout preparation", () => {
  it("creates one hosted Checkout handoff without charging or refunding", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    store.subject.mockResolvedValueOnce({
      billing_mode: "independent",
      id: "20000000-0000-4000-8000-000000000002",
      organization_id: "10000000-0000-4000-8000-000000000001",
      subscription_status: "not_started",
    });
    const stripe = stripeMock();
    const result = await prepareLiveProof({
      applicationStore: store,
      authority,
      env,
      fetcher: fetcher(),
      now: () => new Date("2026-08-06T00:00:00.000Z"),
      policy,
      stripe,
      targets,
    });
    expect(result.handoff).toMatchObject({ sessionId });
    expect(result.report).toMatchObject({
      financialMutationCount: 0,
      humanHostedPaymentRequired: true,
      verified: true,
    });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("fails before Checkout when the Price exceeds the exact maximum", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({ price: { unit_amount: amountCents + 1 } });
    await expect(
      prepareLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        stripe,
        targets,
      }),
    ).rejects.toThrow(/Price, plan, or maximum amount/);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("fails before Checkout when production health is not the authorized release", async () => {
    const { authority, env, policy, targets } = ready();
    const staleHealth = fetcher();
    staleHealth.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              environment: "production",
              revision: "b".repeat(40),
              service: "vinifera-api",
              status: "ok",
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    const stripe = stripeMock();
    await expect(
      prepareLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: staleHealth,
        policy,
        stripe,
        targets,
      }),
    ).rejects.toThrow(/billing and webhook capabilities are not ready/);
    expect(stripe.accounts.retrieve).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects a reused open Session whose line item is not the reviewed Price", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    store.subject.mockResolvedValueOnce({
      billing_mode: "independent",
      id: brandId,
      organization_id: organizationId,
      subscription_status: "not_started",
    });
    const stripe = stripeMock({
      session: {
        line_items: {
          data: [{ price: { id: "price_Unreviewed" }, quantity: 1 }],
        },
        payment_status: "unpaid",
        status: "open",
        subscription: null,
      },
      sessions: [{ id: sessionId, metadata: metadata() }],
    });
    await expect(
      prepareLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        now: () => new Date("2026-08-06T00:00:00.000Z"),
        policy,
        stripe,
        targets,
      }),
    ).rejects.toThrow(/exact open hosted live Checkout handoff/);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rejects another open Gate 19 Session for the approved customer", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    store.subject.mockResolvedValueOnce({
      billing_mode: "independent",
      id: brandId,
      organization_id: organizationId,
      subscription_status: "not_started",
    });
    const stripe = stripeMock({
      sessions: [
        {
          id: "cs_live_OtherNonce",
          metadata: metadata({
            vinifera_proof_nonce: "22222222-2222-4222-8222-222222222222",
          }),
          status: "open",
        },
      ],
    });
    await expect(
      prepareLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        stripe,
        targets,
      }),
    ).rejects.toThrow(/Another open Gate 19 Checkout Session/);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe("Gate 19 tenant-scoped application lookup", () => {
  it("binds the applied activation event to the exact tenant and state timestamp", async () => {
    let request;
    const activationRow = {
      brand_id: brandId,
      event_type: "invoice.payment_succeeded",
      organization_id: organizationId,
      processing_status: "applied",
      stripe_event_id: createdEventId,
    };
    const store = createApplicationStore({
      fetcher: vi.fn(async (input) => {
        request = new URL(input);
        return new Response(JSON.stringify([activationRow]), {
          headers: { "Content-Type": "application/json" },
        });
      }),
      serviceRoleKey: "service-role-test",
      supabaseUrl: supabaseOrigin,
    });
    const subject = {
      id: brandId,
      organization_id: organizationId,
      stripe_state_updated_at: "2026-08-06T00:00:00.000Z",
    };
    await expect(store.activationEvents(subject)).resolves.toEqual([
      activationRow,
    ]);
    expect(request.pathname).toMatch(/\/subscription_events$/u);
    expect(request.searchParams.get("brand_id")).toBe(`eq.${brandId}`);
    expect(request.searchParams.get("organization_id")).toBe(
      `eq.${organizationId}`,
    );
    expect(request.searchParams.get("processing_status")).toBe("eq.applied");
    expect(request.searchParams.get("stripe_created_at")).toBe(
      "eq.2026-08-06T00:00:00.000Z",
    );
    expect(request.searchParams.get("limit")).toBe("100");
    await expect(
      store.activationEvents(subject, { recoveryMode: true }),
    ).resolves.toEqual([activationRow]);
    expect(request.searchParams.get("stripe_created_at")).toBe(
      "lte.2026-08-06T00:00:00.000Z",
    );
  });

  it("binds the organization billing collision check through the approved brand", async () => {
    const requests = [];
    const store = createApplicationStore({
      fetcher: vi.fn(async (input) => {
        const url = new URL(input);
        requests.push(url);
        if (url.pathname.endsWith("/brands")) {
          return new Response(
            JSON.stringify([
              {
                billing_mode: "independent",
                id: brandId,
                organization_id: organizationId,
              },
            ]),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify([]), {
          headers: { "Content-Type": "application/json" },
        });
      }),
      serviceRoleKey: "service-role-test",
      supabaseUrl: supabaseOrigin,
    });

    await expect(
      store.subject({ brandId, customerId, organizationId }),
    ).resolves.toMatchObject({ id: brandId, organization_id: organizationId });
    const organizationRequest = requests.find((url) =>
      url.pathname.endsWith("/organizations"),
    );
    expect(organizationRequest.searchParams.get("select")).toContain(
      "brands!inner",
    );
    expect(organizationRequest.searchParams.get("brands.id")).toBe(
      `eq.${brandId}`,
    );
    expect(organizationRequest.searchParams.get("brands.organization_id")).toBe(
      `eq.${organizationId}`,
    );
    expect(
      organizationRequest.searchParams.get("brands.stripe_customer_id"),
    ).toBe(`eq.${customerId}`);
  });
});

describe("Gate 19 one-charge and one-refund finalization", () => {
  it("proves signed idempotency, refunds once, cancels renewal, and records hashes", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    const stripe = stripeMock();
    stripe.subscriptions.cancel.mockImplementation(async () => {
      store.setCanceled();
      return subscription({ status: "canceled" });
    });
    const result = await finalizeLiveProof({
      applicationStore: store,
      authority,
      env,
      fetcher: fetcher(),
      now: () => new Date("2026-08-06T01:00:00.000Z"),
      policy,
      sessionId,
      sleep: vi.fn(),
      stripe,
      targets,
    });
    expect(result).toMatchObject({
      chargeCount: 1,
      financialMutationCount: 2,
      finalApplicationState: "canceled",
      finalSubscriptionState: "canceled",
      refundCount: 1,
      refundState: "succeeded",
      signedWebhookReplayCount: 4,
      verified: true,
    });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(customerId);
    expect(JSON.stringify(result)).not.toContain(paymentIntentId);
  });

  it("selects the applied invoice activation from a tied incomplete creation event", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore({
      activationType: "invoice.payment_succeeded",
    });
    const [invoiceActivation] = await store.activationEvents();
    store.activationEvents.mockResolvedValue([
      {
        ...invoiceActivation,
        event_type: "customer.subscription.created",
        payload: {
          data: {
            object: {
              id: subscriptionId,
              metadata: metadata(),
              status: "incomplete",
            },
          },
          id: "evt_Gate19IncompleteCreated",
          livemode: true,
          type: "customer.subscription.created",
        },
        stripe_event_id: "evt_Gate19IncompleteCreated",
      },
      invoiceActivation,
    ]);
    const stripe = stripeMock();
    stripe.subscriptions.cancel.mockImplementation(async () => {
      store.setCanceled();
      return subscription({ status: "canceled" });
    });
    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).resolves.toMatchObject({ activeApplicationProven: true, verified: true });
  });

  it("binds recovery to the Checkout initial invoice after a renewal exists", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    const renewalSubscription = subscription({
      latest_invoice: {
        customer: customerId,
        id: "in_LaterRenewal",
        livemode: true,
        parent: {
          subscription_details: { subscription: subscriptionId },
          type: "subscription_details",
        },
        status: "open",
      },
    });
    const stripe = stripeMock({
      session: { subscription: renewalSubscription },
      subscription: renewalSubscription,
    });
    stripe.subscriptions.cancel.mockImplementation(async () => {
      store.setCanceled();
      return subscription({ status: "canceled" });
    });
    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).resolves.toMatchObject({ verified: true });
    expect(stripe.invoicePayments.list).toHaveBeenCalledWith(
      expect.objectContaining({ invoice: "in_Gate19Invoice" }),
    );
  });

  it("refunds and cancels after payment when the production revision advances", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock();
    let failure;
    try {
      await finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher({ revision: "b".repeat(40) }),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/capabilities are not ready/u);
    expect(failure.gate19Recovery).toEqual({
      cancellationAttempted: true,
      refundAttempted: true,
      refundSucceeded: true,
      subscriptionCanceled: true,
    });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("re-scans after failure-path cancellation and refunds a boundary renewal", async () => {
    const { authority, env, policy, targets } = ready();
    const renewalPayment = paymentIntent({
      created: 2_593_001,
      id: "pi_Gate19Renewal",
    });
    const renewalInvoice = {
      customer: customerId,
      id: "in_Gate19Renewal",
      livemode: true,
      parent: {
        subscription_details: { subscription: subscriptionId },
        type: "subscription_details",
      },
      status: "paid",
    };
    let inventoryCalls = 0;
    const stripe = stripeMock({
      chargeList: async (input) => ({
        data: [
          input.payment_intent === renewalPayment.id
            ? charge({
                id: "ch_Gate19Renewal",
                invoice: renewalInvoice.id,
                payment_intent: renewalPayment.id,
              })
            : charge(),
        ],
        has_more: false,
      }),
      invoiceRetrieve: async (id) =>
        id === renewalInvoice.id
          ? renewalInvoice
          : subscription().latest_invoice,
      paymentIntentList: async () => {
        inventoryCalls += 1;
        return {
          data:
            inventoryCalls === 1
              ? [paymentIntent()]
              : [paymentIntent(), renewalPayment],
          has_more: false,
        };
      },
    });

    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher({ revision: "b".repeat(40) }),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/capabilities are not ready/);
    expect(stripe.paymentIntents.list).toHaveBeenCalledTimes(2);
    expect(
      stripe.refunds.create.mock.calls.map(([input]) => input.payment_intent),
    ).toEqual([paymentIntentId, renewalPayment.id]);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("re-scans an already-canceled recovery and refunds a retained renewal", async () => {
    const { authority, env, policy, targets } = ready();
    const canceledSubscription = subscription({ status: "canceled" });
    const renewalPayment = paymentIntent({
      created: 2_593_001,
      id: "pi_Gate19RetainedRenewal",
    });
    const renewalInvoice = {
      customer: customerId,
      id: "in_Gate19RetainedRenewal",
      livemode: true,
      parent: {
        subscription_details: { subscription: subscriptionId },
        type: "subscription_details",
      },
      status: "paid",
    };
    let inventoryCalls = 0;
    const stripe = stripeMock({
      chargeList: async (input) => ({
        data: [
          input.payment_intent === renewalPayment.id
            ? charge({
                id: "ch_Gate19RetainedRenewal",
                invoice: renewalInvoice.id,
                payment_intent: renewalPayment.id,
              })
            : charge(),
        ],
        has_more: false,
      }),
      invoiceRetrieve: async (id) =>
        id === renewalInvoice.id
          ? renewalInvoice
          : canceledSubscription.latest_invoice,
      paymentIntentList: async () => {
        inventoryCalls += 1;
        return {
          data:
            inventoryCalls === 1
              ? [paymentIntent()]
              : [paymentIntent(), renewalPayment],
          has_more: false,
        };
      },
      session: { subscription: canceledSubscription },
      subscription: canceledSubscription,
    });

    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/lacks the exact prior refund/);
    expect(stripe.paymentIntents.list).toHaveBeenCalledTimes(2);
    expect(
      stripe.refunds.create.mock.calls.map(([input]) => input.payment_intent),
    ).toEqual([paymentIntentId, renewalPayment.id]);
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("fails recovery closed when a boundary renewal cannot be validated", async () => {
    const { authority, env, policy, targets } = ready();
    const renewalPayment = paymentIntent({
      created: 2_593_001,
      id: "pi_Gate19UnvalidatedRenewal",
    });
    let inventoryCalls = 0;
    const stripe = stripeMock({
      chargeList: async (input) => ({
        data: input.payment_intent === renewalPayment.id ? [] : [charge()],
        has_more: false,
      }),
      paymentIntentList: async () => {
        inventoryCalls += 1;
        return {
          data:
            inventoryCalls === 1
              ? [paymentIntent()]
              : [paymentIntent(), renewalPayment],
          has_more: false,
        };
      },
    });

    let failure;
    try {
      await finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher({ revision: "b".repeat(40) }),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.message).toMatch(/financial recovery did not fully reconcile/);
    expect(failure.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/one exact captured invoice Charge/),
        }),
      ]),
    );
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("blocks certification and recovers a processing renewal that settles", async () => {
    const { authority, env, policy, targets } = ready();
    const processingRenewal = paymentIntent({
      created: 2_593_001,
      id: "pi_Gate19ProcessingRenewal",
      status: "processing",
    });
    const settledRenewal = { ...processingRenewal, status: "succeeded" };
    const renewalInvoice = {
      customer: customerId,
      id: "in_Gate19ProcessingRenewal",
      livemode: true,
      parent: {
        subscription_details: { subscription: subscriptionId },
        type: "subscription_details",
      },
      status: "paid",
    };
    let inventoryCalls = 0;
    const stripe = stripeMock({
      chargeList: async (input) => ({
        data: [
          input.payment_intent === settledRenewal.id
            ? charge({
                id: "ch_Gate19ProcessingRenewal",
                invoice: renewalInvoice.id,
                payment_intent: settledRenewal.id,
              })
            : charge(),
        ],
        has_more: false,
      }),
      invoiceRetrieve: async (id) =>
        id === renewalInvoice.id
          ? renewalInvoice
          : subscription().latest_invoice,
      paymentIntentList: async () => {
        inventoryCalls += 1;
        return {
          data:
            inventoryCalls === 1
              ? [paymentIntent()]
              : [
                  paymentIntent(),
                  inventoryCalls === 2 ? processingRenewal : settledRenewal,
                ],
          has_more: false,
        };
      },
    });

    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/capable of settling/);
    expect(stripe.paymentIntents.list).toHaveBeenCalledTimes(3);
    expect(
      stripe.refunds.create.mock.calls.map(([input]) => input.payment_intent),
    ).toEqual([paymentIntentId, settledRenewal.id]);
  });

  it("blocks a proof-window PaymentIntent awaiting a payment method", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      paymentIntents: [
        paymentIntent(),
        paymentIntent({
          id: "pi_Gate19RequiresPaymentMethod",
          status: "requires_payment_method",
        }),
      ],
    });

    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/capable of settling/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("repeats payment inventory immediately before certification", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    const lateRenewal = paymentIntent({
      created: 2_593_001,
      id: "pi_Gate19LateRenewal",
    });
    const renewalInvoice = {
      customer: customerId,
      id: "in_Gate19LateRenewal",
      livemode: true,
      parent: {
        subscription_details: { subscription: subscriptionId },
        type: "subscription_details",
      },
      status: "paid",
    };
    let inventoryCalls = 0;
    const stripe = stripeMock({
      chargeList: async (input) => ({
        data: [
          input.payment_intent === lateRenewal.id
            ? charge({
                id: "ch_Gate19LateRenewal",
                invoice: renewalInvoice.id,
                payment_intent: lateRenewal.id,
              })
            : charge(),
        ],
        has_more: false,
      }),
      invoiceRetrieve: async (id) =>
        id === renewalInvoice.id
          ? renewalInvoice
          : subscription().latest_invoice,
      paymentIntentList: async () => {
        inventoryCalls += 1;
        return {
          data:
            inventoryCalls < 3
              ? [paymentIntent()]
              : [paymentIntent(), lateRenewal],
          has_more: false,
        };
      },
    });
    stripe.subscriptions.cancel.mockImplementation(async () => {
      store.setCanceled();
      return subscription({ status: "canceled" });
    });

    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/Final reconciliation found another proof-window payment/);
    expect(stripe.paymentIntents.list).toHaveBeenCalledTimes(4);
    expect(
      stripe.refunds.create.mock.calls.map(([input]) => input.payment_intent),
    ).toEqual([paymentIntentId, lateRenewal.id]);
  });

  it("refunds and cancels when paid subscription metadata drifts", async () => {
    const { authority, env, policy, targets } = ready();
    const driftedSubscription = subscription({
      metadata: metadata({ vinifera_proof_nonce: "drifted" }),
    });
    const stripe = stripeMock({
      session: { subscription: driftedSubscription },
      subscription: driftedSubscription,
    });
    let failure;
    try {
      await finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/metadata mismatch/u);
    expect(failure.gate19Recovery).toMatchObject({
      refundAttempted: true,
      refundSucceeded: true,
      subscriptionCanceled: true,
    });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("pages bounded account event inventory to find exact proof events", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    const stripe = stripeMock({
      eventList: async (input, events) => {
        if (!input.starting_after) {
          return {
            data: Array.from({ length: 100 }, (_, index) => ({
              data: { object: { id: `sub_Other${index}` } },
              id: `evt_Other${index}`,
              livemode: true,
              type: input.type,
            })),
            has_more: true,
          };
        }
        return {
          data: [
            input.type === "customer.subscription.created"
              ? events.createdEvent
              : events.deletedEvent,
          ],
          has_more: false,
        };
      },
    });
    stripe.subscriptions.cancel.mockImplementation(async () => {
      store.setCanceled();
      return subscription({ status: "canceled" });
    });
    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).resolves.toMatchObject({ verified: true });
    expect(stripe.events.list).toHaveBeenCalledTimes(2);
  });

  it("stops event pagination as soon as the exact proof event is found", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    const stripe = stripeMock({
      eventList: async (input, events) => ({
        data: [
          input.type === "customer.subscription.created"
            ? events.createdEvent
            : events.deletedEvent,
        ],
        has_more: true,
      }),
    });
    stripe.subscriptions.cancel.mockImplementation(async () => {
      store.setCanceled();
      return subscription({ status: "canceled" });
    });
    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).resolves.toMatchObject({ verified: true });
    expect(stripe.events.list).toHaveBeenCalledTimes(1);
  });

  it("refunds and cancels after paid Session metadata drifts", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      session: { metadata: metadata({ vinifera_gate: "18" }) },
    });
    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/metadata mismatch/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("refunds and cancels after a paid Session proof-reference drift", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      session: {
        client_reference_id:
          "gate19:22222222-2222-4222-8222-222222222222",
      },
    });
    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/does not match the proof nonce/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("arms payment recovery before refund inventory can fail", async () => {
    const { authority, env, policy, targets } = ready();
    let calls = 0;
    const stripe = stripeMock({
      refundList: async () => {
        calls += 1;
        if (calls === 1) throw new Error("refund inventory unavailable");
        return { data: [], has_more: false };
      },
    });
    let failure;
    try {
      await finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/refund inventory unavailable/u);
    expect(failure.gate19Recovery).toMatchObject({
      refundAttempted: true,
      refundSucceeded: true,
      subscriptionCanceled: true,
    });
  });

  it("refunds and cancels a paid Session when the dedicated customer was deleted", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      customer: { deleted: true, id: customerId },
    });
    let failure;
    try {
      await finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/customer contract does not match/u);
    expect(failure.gate19Recovery).toMatchObject({
      refundAttempted: true,
      refundSucceeded: true,
      subscriptionCanceled: true,
    });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects a Session prepared by a different immutable main SHA", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      session: { metadata: metadata({ vinifera_git_sha: "b".repeat(40) }) },
    });
    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/vinifera_git_sha/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the completed amount differs from the reviewed Price", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      price: { unit_amount: amountCents - 1 },
    });
    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/does not equal the reviewed Price/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("refunds and cancels when the reviewed Price drifts after payment", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({ price: { active: false } });
    let failure;
    try {
      await finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/Price, plan, or maximum amount/);
    expect(failure.gate19Recovery).toEqual({
      cancellationAttempted: true,
      refundAttempted: true,
      refundSucceeded: true,
      subscriptionCanceled: true,
    });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("refunds the proof payment and cancels when another customer payment exists", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      paymentIntents: [
        paymentIntent(),
        paymentIntent({ id: "pi_SecondCharge" }),
      ],
    });
    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/exactly one captured Charge/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("retains captured renewal recovery when another customer payment is invalid", async () => {
    const { authority, env, policy, targets } = ready();
    const renewalPayment = paymentIntent({
      amount_received: amountCents,
      created: 2_593_001,
      id: "pi_Gate19Renewal",
    });
    const renewalInvoice = {
      customer: customerId,
      id: "in_Gate19Renewal",
      livemode: true,
      parent: {
        subscription_details: { subscription: subscriptionId },
        type: "subscription_details",
      },
      status: "paid",
    };
    const unrelatedPayment = paymentIntent({
      created: 2_593_002,
      id: "pi_UnrelatedLaterPayment",
    });
    const unrelatedInvoice = {
      ...renewalInvoice,
      id: "in_UnrelatedLaterPayment",
      parent: {
        subscription_details: { subscription: "sub_Unrelated" },
        type: "subscription_details",
      },
    };
    const stripe = stripeMock({
      chargeList: async (input) => ({
        data: [
          input.payment_intent === renewalPayment.id
            ? charge({
                id: "ch_Gate19Renewal",
                invoice: renewalInvoice.id,
                payment_intent: renewalPayment.id,
              })
            : input.payment_intent === unrelatedPayment.id
              ? charge({
                  id: "ch_UnrelatedLaterPayment",
                  invoice: unrelatedInvoice.id,
                  payment_intent: unrelatedPayment.id,
                })
            : charge(),
        ],
        has_more: false,
      }),
      invoiceRetrieve: async (id) =>
        id === renewalInvoice.id
          ? renewalInvoice
          : id === unrelatedInvoice.id
            ? unrelatedInvoice
          : subscription().latest_invoice,
      paymentIntents: [paymentIntent(), unrelatedPayment, renewalPayment],
    });
    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/does not belong to the exact proof subscription/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(2);
    expect(stripe.refunds.create.mock.calls.map(([input]) => input.payment_intent)).toEqual(
      expect.arrayContaining([paymentIntentId, renewalPayment.id]),
    );
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("preserves the initial refund when renewal discovery is transiently unavailable", async () => {
    const { authority, env, policy, targets } = ready();
    const renewalPayment = paymentIntent({
      created: 2_593_001,
      id: "pi_Gate19Renewal",
    });
    const stripe = stripeMock({
      chargeList: async (input) => {
        if (input.payment_intent === renewalPayment.id) {
          throw new Error("transient renewal Charge lookup failure");
        }
        return { data: [charge()], has_more: false };
      },
      paymentIntents: [paymentIntent(), renewalPayment],
    });

    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/transient renewal Charge lookup failure/);
    expect(
      stripe.refunds.create.mock.calls.map(([input]) => input.payment_intent),
    ).toEqual([paymentIntentId]);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("pages the proof window and retains a later captured renewal for recovery", async () => {
    const { authority, env, policy, targets } = ready();
    const renewalPayment = paymentIntent({
      created: 2_593_001,
      id: "pi_Gate19Renewal",
    });
    const renewalInvoice = {
      customer: customerId,
      id: "in_Gate19Renewal",
      livemode: true,
      parent: {
        subscription_details: { subscription: subscriptionId },
        type: "subscription_details",
      },
      status: "paid",
    };
    const firstPageTail = "pi_PageOneTail";
    const stripe = stripeMock({
      chargeList: async (input) => ({
        data: [
          input.payment_intent === renewalPayment.id
            ? charge({
                id: "ch_Gate19Renewal",
                invoice: renewalInvoice.id,
                payment_intent: renewalPayment.id,
              })
            : charge(),
        ],
        has_more: false,
      }),
      invoiceRetrieve: async (id) =>
        id === renewalInvoice.id
          ? renewalInvoice
          : subscription().latest_invoice,
      paymentIntentList: async (input) =>
        input.starting_after
          ? { data: [renewalPayment], has_more: false }
          : {
              data: [
                paymentIntent(),
                ...Array.from({ length: 99 }, (_, index) => ({
                  id: index === 98 ? firstPageTail : `pi_Failed${index}`,
                  status: "canceled",
                })),
              ],
              has_more: true,
            },
    });

    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/more than one proof-window payment/);
    expect(stripe.paymentIntents.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ starting_after: firstPageTail }),
    );
    expect(
      stripe.refunds.create.mock.calls.map(([input]) => input.payment_intent),
    ).toEqual([paymentIntentId, renewalPayment.id]);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("re-scans after cancellation and refunds a renewal that won the boundary race", async () => {
    const { authority, env, policy, targets } = ready();
    const renewalPayment = paymentIntent({
      created: 2_593_001,
      id: "pi_Gate19Renewal",
    });
    const renewalInvoice = {
      customer: customerId,
      id: "in_Gate19Renewal",
      livemode: true,
      parent: {
        subscription_details: { subscription: subscriptionId },
        type: "subscription_details",
      },
      status: "paid",
    };
    let inventoryCalls = 0;
    const stripe = stripeMock({
      chargeList: async (input) => ({
        data: [
          input.payment_intent === renewalPayment.id
            ? charge({
                id: "ch_Gate19Renewal",
                invoice: renewalInvoice.id,
                payment_intent: renewalPayment.id,
              })
            : charge(),
        ],
        has_more: false,
      }),
      invoiceRetrieve: async (id) =>
        id === renewalInvoice.id
          ? renewalInvoice
          : subscription().latest_invoice,
      paymentIntentList: async () => {
        inventoryCalls += 1;
        return {
          data:
            inventoryCalls === 1
              ? [paymentIntent()]
              : [paymentIntent(), renewalPayment],
          has_more: false,
        };
      },
      paymentIntents: [paymentIntent(), renewalPayment],
    });

    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/canceled live-proof subscription has more than one/);
    expect(stripe.paymentIntents.list).toHaveBeenCalledTimes(3);
    expect(
      stripe.refunds.create.mock.calls.map(([input]) => input.payment_intent),
    ).toEqual([paymentIntentId, renewalPayment.id]);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("bounds proof-window pagination while preserving known recovery", async () => {
    const { authority, env, policy, targets } = ready();
    let page = 0;
    const stripe = stripeMock({
      paymentIntentList: async () => {
        page += 1;
        return {
          data: [
            ...(page === 1 ? [paymentIntent()] : []),
            { id: `pi_PageTail${page}`, status: "requires_payment_method" },
          ],
          has_more: true,
        };
      },
    });

    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/PaymentIntent inventory exceeded its bound/);
    expect(stripe.paymentIntents.list).toHaveBeenCalledTimes(20);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("attempts every captured-payment refund when an earlier refund remains pending", async () => {
    const { authority, env, policy, targets } = ready();
    const renewalPayment = paymentIntent({
      created: 2_593_001,
      id: "pi_Gate19Renewal",
    });
    const renewalInvoice = {
      customer: customerId,
      id: "in_Gate19Renewal",
      livemode: true,
      parent: {
        subscription_details: { subscription: subscriptionId },
        type: "subscription_details",
      },
      status: "paid",
    };
    const stripe = stripeMock({
      chargeList: async (input) => ({
        data: [
          input.payment_intent === renewalPayment.id
            ? charge({
                id: "ch_Gate19Renewal",
                invoice: renewalInvoice.id,
                payment_intent: renewalPayment.id,
              })
            : charge(),
        ],
        has_more: false,
      }),
      invoiceRetrieve: async (id) =>
        id === renewalInvoice.id
          ? renewalInvoice
          : subscription().latest_invoice,
      paymentIntents: [paymentIntent(), renewalPayment],
    });
    stripe.refunds.create.mockImplementation(async (input) => ({
      amount: input.amount,
      currency: "usd",
      id:
        input.payment_intent === paymentIntentId
          ? refundId
          : `re_${input.payment_intent}`,
      livemode: true,
      metadata: input.metadata,
      payment_intent: input.payment_intent,
      status:
        input.payment_intent === paymentIntentId ? "pending" : "succeeded",
    }));
    stripe.refunds.retrieve.mockImplementation(async (id) => ({
      amount: amountCents,
      currency: "usd",
      id,
      livemode: true,
      metadata: {
        vinifera_gate: "19",
        vinifera_proof_nonce: nonce,
        vinifera_proof_version: "2026-08-06-v1",
      },
      payment_intent: id === refundId ? paymentIntentId : renewalPayment.id,
      status: id === refundId ? "pending" : "succeeded",
    }));

    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/financial recovery did not fully reconcile/);
    expect(
      stripe.refunds.create.mock.calls.map(([input]) => input.payment_intent),
    ).toEqual([paymentIntentId, renewalPayment.id]);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("bounds PaymentIntent inventory to the exact Checkout proof window", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    const stripe = stripeMock({
      paymentIntentList: async (input) => {
        // session().created is 1000; the proof window includes a 60s margin.
        expect(input.created).toEqual({ gte: 940, lte: 2_600_000 });
        return { data: [paymentIntent()], has_more: false };
      },
    });
    stripe.subscriptions.cancel.mockImplementation(async () => {
      store.setCanceled();
      return subscription({ status: "canceled" });
    });
    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
        now: () => new Date(2_600_000 * 1000),
      }),
    ).resolves.toMatchObject({ verified: true });
    expect(stripe.paymentIntents.list).toHaveBeenCalledWith(
      expect.objectContaining({ created: { gte: 940, lte: 2_600_000 } }),
    );
  });

  it("fails closed when the initial invoice has multiple paid payment objects", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      invoicePayments: [
        {
          amount_paid: amountCents,
          id: "inpay_Gate19",
          livemode: true,
          payment: {
            payment_intent: paymentIntent(),
            type: "payment_intent",
          },
          status: "paid",
        },
        {
          amount_paid: amountCents,
          id: "inpay_Second",
          livemode: true,
          payment: {
            payment_intent: paymentIntent({ id: "pi_SecondInvoicePayment" }),
            type: "payment_intent",
          },
          status: "paid",
        },
      ],
    });
    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/exactly one paid live Invoice Payment/);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("derives the Charge count and cancels when one PaymentIntent has two Charges", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      charges: [charge(), charge({ id: "ch_SecondAttempt" })],
    });
    await expect(
      finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/exactly one successful captured Charge/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("refunds the one captured Charge after an earlier failed Charge attempt", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    const stripe = stripeMock({
      charges: [
        charge({
          amount_captured: 0,
          captured: false,
          failure_code: "card_declined",
          id: "ch_Gate19Declined",
          paid: false,
        }),
        charge(),
      ],
    });
    stripe.subscriptions.cancel.mockImplementation(async () => {
      store.setCanceled();
      return subscription({ status: "canceled" });
    });

    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).resolves.toMatchObject({
      chargeCount: 1,
      chargeFullyRefunded: true,
      refundCount: 1,
      verified: true,
    });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });

  it("refuses an unrelated existing refund instead of issuing another", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      refunds: [
        {
          amount: amountCents,
          currency: "usd",
          id: "re_Unrelated",
          livemode: true,
          metadata: { vinifera_gate: "other" },
          status: "succeeded",
        },
      ],
    });
    let failure;
    try {
      await finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors.some((error) =>
      /existing refund does not match/u.test(error.message),
    )).toBe(true);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("resumes after refund and cancellation without issuing a second refund", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    store.setCanceled();
    const stripe = stripeMock({
      refunds: [
        {
          amount: amountCents,
          currency: "usd",
          id: refundId,
          livemode: true,
          metadata: {
            vinifera_gate: "19",
            vinifera_proof_nonce: nonce,
            vinifera_proof_version: "2026-08-06-v1",
          },
          status: "succeeded",
        },
      ],
      session: { subscription: subscription({ status: "canceled" }) },
    });
    const result = await finalizeLiveProof({
      applicationStore: store,
      authority,
      env,
      fetcher: fetcher(),
      policy,
      sessionId,
      sleep: vi.fn(),
      stripe,
      targets,
    });
    expect(result).toMatchObject({
      refundCount: 1,
      refundCreatedThisRun: false,
      verified: true,
    });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it("replaces one exact terminally failed refund during recovery", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    const stripe = stripeMock({
      refunds: [
        {
          amount: amountCents,
          currency: "usd",
          id: "re_Gate19Failed",
          livemode: true,
          metadata: {
            vinifera_gate: "19",
            vinifera_proof_nonce: nonce,
            vinifera_proof_version: "2026-08-06-v1",
          },
          status: "failed",
        },
      ],
    });
    stripe.subscriptions.cancel.mockImplementation(async () => {
      store.setCanceled();
      return subscription({ status: "canceled" });
    });
    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).resolves.toMatchObject({ refundCount: 1, verified: true });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("refuses to claim prior activation when the durable applied event is not active", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore({ activationStatus: "canceled" });
    store.setCanceled();
    const stripe = stripeMock({
      refunds: [
        {
          amount: amountCents,
          currency: "usd",
          id: refundId,
          livemode: true,
          metadata: {
            vinifera_gate: "19",
            vinifera_proof_nonce: nonce,
            vinifera_proof_version: "2026-08-06-v1",
          },
          status: "succeeded",
        },
      ],
      session: { subscription: subscription({ status: "canceled" }) },
    });
    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/active application transition/);
  });

  it("fails a canceled no-refund state but recovers the exact full refund", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore();
    store.setCanceled();
    const stripe = stripeMock({
      session: { subscription: subscription({ status: "canceled" }) },
    });
    await expect(
      finalizeLiveProof({
        applicationStore: store,
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      }),
    ).rejects.toThrow(/lacks the exact prior refund/);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("fails when two refunds already exist for the proof payment", async () => {
    const { authority, env, policy, targets } = ready();
    const matchingRefund = {
      amount: amountCents,
      currency: "usd",
      livemode: true,
      metadata: {
        vinifera_gate: "19",
        vinifera_proof_nonce: nonce,
        vinifera_proof_version: "2026-08-06-v1",
      },
      status: "succeeded",
    };
    const stripe = stripeMock({
      refunds: [
        { ...matchingRefund, id: refundId },
        { ...matchingRefund, id: "re_SecondRefund" },
      ],
    });
    let failure;
    try {
      await finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher(),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors.some((error) =>
      /ambiguous proof mutations/u.test(error.message),
    )).toBe(true);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("refunds and cancels during recovery when signed replay is not idempotent", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock();
    let failure;
    try {
      await finalizeLiveProof({
        applicationStore: applicationStore(),
        authority,
        env,
        fetcher: fetcher({ duplicate: false }),
        policy,
        sessionId,
        sleep: vi.fn(),
        stripe,
        targets,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/did not remain idempotent/);
    expect(failure.gate19Recovery).toEqual({
      cancellationAttempted: true,
      refundAttempted: true,
      refundSucceeded: true,
      subscriptionCanceled: true,
    });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("Gate 19 workflow isolation", () => {
  it("is trusted main-only, separate from binding cutover, and has no raw card path", async () => {
    const workflow = await readFile(
      ".github/workflows/stripe-live-proof.yml",
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain(
      'if [[ "${{ inputs.operation }}" == "prepare" ]]',
    );
    expect(workflow).toContain("git merge-base --is-ancestor");
    expect(workflow).toContain("environment:\n      name: production");
    expect(workflow).toContain("checkout.stripe.com");
    expect(workflow).toContain("timeout-minutes: 60");
    expect(workflow).toContain("openssl cms");
    expect(workflow).toContain("owner-handoff.p7m");
    expect(workflow).not.toContain("[Open Stripe Checkout]($checkout_url)");
    expect(workflow).not.toContain("Finalize Session: \\`$session_id\\`");
    expect(workflow).toContain("Stripe live billing cutover");
    expect(workflow).not.toMatch(/card(number|_number)|payment_method_data/i);
    expect(workflow).not.toContain("wrangler versions upload");
    expect(workflow).not.toContain("stripe-live-billing.mjs execute");
    expect(workflow).not.toContain('"${{ inputs.checkout_session_id }}"');
    expect(workflow).toContain("PRODUCTION_STRIPE_LIVE_PROOF_BRAND_ID");
    expect(workflow).toContain("PRODUCTION_STRIPE_LIVE_PROOF_ORGANIZATION_ID");
    const controller = await readFile("scripts/stripe-live-proof.mjs", "utf8");
    expect(controller).toContain("brand_id: `eq.${subject.id}`");
    expect(controller).toContain(
      "organization_id: `eq.${subject.organization_id}`",
    );
  });

  it("creates deterministic Stripe webhook signatures", () => {
    expect(stripeSignature('{"id":"evt_1"}', "whsec_secret", 123)).toBe(
      stripeSignature('{"id":"evt_1"}', "whsec_secret", 123),
    );
    expect(stripeSignature('{"id":"evt_1"}', "whsec_secret", 123)).not.toBe(
      stripeSignature('{"id":"evt_2"}', "whsec_secret", 123),
    );
  });
});
