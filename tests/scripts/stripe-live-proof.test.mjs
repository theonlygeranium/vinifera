import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  assertLiveProofAuthority,
  assertLiveProofTargets,
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
  return {
    amount_total: amountCents,
    created: 1000,
    currency: "usd",
    client_reference_id: `gate19:${nonce}`,
    customer: customerId,
    id: sessionId,
    expires_at: 2_000_000_000,
    line_items: { data: [{ price: { id: priceId }, quantity: 1 }] },
    livemode: true,
    metadata: metadata(),
    mode: "subscription",
    payment_status: "paid",
    status: "complete",
    subscription: subscription(),
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
            status: "open",
            subscription: null,
          });
          return preparedSession;
        }),
        list: vi.fn(async () => ({
          data: overrides.sessions ?? [],
          has_more: false,
        })),
        retrieve: vi.fn(async () =>
          preparedSession ?? session(overrides.session),
        ),
      },
    },
    customers: {
      retrieve: vi.fn(async () => ({ id: customerId, livemode: true })),
    },
    events: {
      list: vi.fn(async ({ type }) => ({
        data: [
          type === "customer.subscription.created"
            ? createdEvent
            : deletedEvent,
        ],
        has_more: false,
      })),
    },
    invoices: {
      retrieve: vi.fn(async () => currentSubscription.latest_invoice),
    },
    invoicePayments: {
      list: vi.fn(async () => ({
        data:
          overrides.invoicePayments ??
          [
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
      list: vi.fn(async () => ({
        data: overrides.paymentIntents ?? [paymentIntent()],
        has_more: false,
      })),
      retrieve: vi.fn(async () => paymentIntent()),
    },
    prices: { retrieve: vi.fn(async () => price(overrides.price)) },
    charges: {
      list: vi.fn(async () => ({
        data:
          overrides.charges ??
          [charge({
            amount_refunded: refunds.length === 1 ? amountCents : 0,
            refunded: refunds.length === 1,
          })],
        has_more: false,
      })),
      retrieve: vi.fn(async () =>
        charge({ amount_refunded: amountCents, refunded: true }),
      ),
    },
    refunds: {
      create: vi.fn(async (input) => {
        const created = {
          amount: input.amount,
          currency: "usd",
          id: refundId,
          livemode: true,
          metadata: input.metadata,
          status: "succeeded",
        };
        refunds.push(created);
        return created;
      }),
      list: vi.fn(async () => ({ data: refunds, has_more: false })),
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

function applicationStore({ createdStatus = "active" } = {}) {
  let status = "active";
  return {
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
            status: eventId === createdEventId ? createdStatus : "canceled",
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

function fetcher({ duplicate = true } = {}) {
  return vi.fn(async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({ data: { service: "vinifera-api", status: "ok" } }),
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

  it("fails closed before refund on wrong proof metadata", async () => {
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
    expect(stripe.refunds.create).not.toHaveBeenCalled();
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
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("fails closed when the completed amount differs from the reviewed Price", async () => {
    const { authority, env, policy, targets } = ready();
    const stripe = stripeMock({
      session: { amount_total: amountCents - 1 },
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
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("fails closed before refund when a second proof-window payment exists", async () => {
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
    ).rejects.toThrow(/more than one proof-window payment/);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
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
    ).rejects.toThrow(/exactly one Charge/);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
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
    ).rejects.toThrow(/existing refund does not match/);
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

  it("refuses to claim prior activation when durable created-event state is not active", async () => {
    const { authority, env, policy, targets } = ready();
    const store = applicationStore({ createdStatus: "canceled" });
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
    ).rejects.toThrow(/does not prove the expected application lifecycle/);
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
      metadata: { vinifera_gate: "19", vinifera_proof_nonce: nonce },
      status: "succeeded",
    };
    const stripe = stripeMock({
      refunds: [
        { ...matchingRefund, id: refundId },
        { ...matchingRefund, id: "re_SecondRefund" },
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
    ).rejects.toThrow(/second financial mutation/);
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
    expect(workflow).toContain("environment:\n      name: production");
    expect(workflow).toContain("checkout.stripe.com");
    expect(workflow).toContain("timeout-minutes: 60");
    expect(workflow).toContain("Stripe live billing cutover");
    expect(workflow).not.toMatch(/card(number|_number)|payment_method_data/i);
    expect(workflow).not.toContain("wrangler versions upload");
    expect(workflow).not.toContain("stripe-live-billing.mjs execute");
    expect(workflow).not.toContain('"${{ inputs.checkout_session_id }}"');
    expect(workflow).toContain("PRODUCTION_STRIPE_LIVE_PROOF_BRAND_ID");
    expect(workflow).toContain("PRODUCTION_STRIPE_LIVE_PROOF_ORGANIZATION_ID");
    const controller = await readFile(
      "scripts/stripe-live-proof.mjs",
      "utf8",
    );
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
