import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertLiveBillingAuthority,
  parseWorkerVersionOutput,
  runStripeLiveBillingOperation,
  sha256,
  validateLiveBillingPolicy,
} from "../../scripts/stripe-live-billing.mjs";

const accountId = "acct_ViniferaLive123";
const testAccountId = "acct_ViniferaTest123";
const workerAccountId = "a".repeat(32);
const workerName = "vinifera-production";
const workerOrigin = "https://vinifera-production.example.workers.dev";
const webhookUrl = "https://vinifera.example/api/webhooks/stripe";
const confirmation = "ACTIVATE VINIFERA STRIPE LIVE BILLING";
const authority = "AUTHORIZE VINIFERA STRIPE LIVE BILLING CONTROL";
const events = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.deleted",
  "customer.subscription.updated",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
];
const plans = [
  {
    plan: "vine",
    productName: "Vinifera Vine",
    lookupKey: "vinifera_vine_monthly_usd_v1",
    unitAmount: 14900,
  },
  {
    plan: "cellar",
    productName: "Vinifera Cellar",
    lookupKey: "vinifera_cellar_monthly_usd_v1",
    unitAmount: 34900,
  },
  {
    plan: "estate",
    productName: "Vinifera Estate",
    lookupKey: "vinifera_estate_monthly_usd_v1",
    unitAmount: 74900,
  },
  {
    plan: "reserve",
    productName: "Vinifera Reserve",
    lookupKey: "vinifera_reserve_monthly_usd_v1",
    unitAmount: 150000,
  },
];

function rawPolicy(overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    independentAuthorityEnabled: true,
    apiVersion: "2026-02-25.clover",
    catalogVersion: "2026-07-26-v1",
    currency: "usd",
    interval: "month",
    confirmations: {
      activate: confirmation,
      revert: "REVERT VINIFERA STRIPE BILLING TO TEST MODE",
    },
    authorityPhrase: authority,
    targetHashes: {
      cloudflareAccountIdSha256: [sha256(workerAccountId)],
      workerNameSha256: [sha256(workerName)],
      workerOriginSha256: [sha256(workerOrigin)],
    },
    modes: {
      live: {
        accountIdSha256: [sha256(accountId)],
        webhookEndpointUrlSha256: [sha256(webhookUrl)],
      },
      test: {
        accountIdSha256: [sha256(testAccountId)],
        webhookEndpointUrlSha256: [sha256(webhookUrl)],
      },
    },
    requiredWebhookEvents: events,
    plans,
    ...overrides,
  };
}

function environment(overrides = {}) {
  return {
    PRODUCTION_CLOUDFLARE_ACCOUNT_ID: workerAccountId,
    PRODUCTION_LIVE_BILLING_AUTHORITY: authority,
    PRODUCTION_STRIPE_LIVE_PRICE_CELLAR: "price_livecellar",
    PRODUCTION_STRIPE_LIVE_PRICE_ESTATE: "price_liveestate",
    PRODUCTION_STRIPE_LIVE_PRICE_RESERVE: "price_livereserve",
    PRODUCTION_STRIPE_LIVE_PRICE_VINE: "price_livevine",
    PRODUCTION_STRIPE_LIVE_SECRET_KEY: "sk_live_vinifera_credential",
    PRODUCTION_STRIPE_LIVE_WEBHOOK_SECRET: "whsec_live_vinifera",
    PRODUCTION_STRIPE_TEST_PRICE_CELLAR: "price_testcellar",
    PRODUCTION_STRIPE_TEST_PRICE_ESTATE: "price_testestate",
    PRODUCTION_STRIPE_TEST_PRICE_RESERVE: "price_testreserve",
    PRODUCTION_STRIPE_TEST_PRICE_VINE: "price_testvine",
    PRODUCTION_STRIPE_TEST_SECRET_KEY: "sk_test_vinifera_credential",
    PRODUCTION_STRIPE_TEST_WEBHOOK_SECRET: "whsec_test_vinifera",
    PRODUCTION_WORKER_NAME: workerName,
    PRODUCTION_WORKER_ORIGIN: workerOrigin,
    STRIPE_LIVE_BILLING_CONFIRMATION: confirmation,
    STRIPE_LIVE_BILLING_GIT_SHA: "a".repeat(40),
    ...overrides,
  };
}

function price(plan, liveMode = true) {
  return {
    active: true,
    currency: "usd",
    id: `price_${liveMode ? "live" : "test"}${plan.plan}`,
    livemode: liveMode,
    lookup_key: plan.lookupKey,
    metadata: {
      vinifera_catalog_version: "2026-07-26-v1",
      vinifera_plan: plan.plan,
    },
    product: {
      active: true,
      id: `prod_${liveMode ? "live" : "test"}${plan.plan}`,
      metadata: {
        vinifera_catalog_version: "2026-07-26-v1",
        vinifera_plan: plan.plan,
      },
      name: plan.productName,
    },
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
    },
    type: "recurring",
    unit_amount: plan.unitAmount,
  };
}

function stripeMock(liveMode = true) {
  return {
    accounts: {
      retrieve: vi.fn(async () => ({
        id: liveMode ? accountId : testAccountId,
      })),
    },
    prices: {
      retrieve: vi.fn(async (id) => {
        const plan = plans.find((candidate) => id.endsWith(candidate.plan));
        return price(plan, liveMode);
      }),
    },
    webhookEndpoints: {
      list: vi.fn(async () => ({
        data: [
          {
            enabled_events: events,
            livemode: liveMode,
            status: "enabled",
            url: webhookUrl,
          },
        ],
        has_more: false,
      })),
    },
  };
}

describe("Stripe live-billing default-deny authority", () => {
  it("ships disabled with empty target and provider allowlists", async () => {
    const checkedIn = JSON.parse(
      await readFile(
        resolve("config/stripe-live-billing-policy.json"),
        "utf8",
      ),
    );
    expect(checkedIn.enabled).toBe(false);
    expect(checkedIn.independentAuthorityEnabled).toBe(false);
    expect(checkedIn.targetHashes.cloudflareAccountIdSha256).toEqual([]);
    expect(checkedIn.modes.live.accountIdSha256).toEqual([]);
    expect(() => validateLiveBillingPolicy(checkedIn)).toThrow(/non-empty/);
  });

  it("requires reviewed flags, exact confirmation, independent authority, and a full SHA", () => {
    const policy = validateLiveBillingPolicy(rawPolicy());
    expect(() =>
      assertLiveBillingAuthority(
        { ...policy, enabled: false },
        "activate",
        environment(),
      ),
    ).toThrow(/disabled/);
    expect(() =>
      assertLiveBillingAuthority(policy, "activate", environment({
        PRODUCTION_LIVE_BILLING_AUTHORITY: "wrong",
      })),
    ).toThrow(/authority/);
    expect(() =>
      assertLiveBillingAuthority(policy, "activate", environment({
        STRIPE_LIVE_BILLING_CONFIRMATION: "almost",
      })),
    ).toThrow(/Exact activate/);
    expect(() =>
      assertLiveBillingAuthority(policy, "activate", environment({
        STRIPE_LIVE_BILLING_GIT_SHA: "a".repeat(39),
      })),
    ).toThrow(/immutable/);
  });
});

describe("Stripe live-billing semantic verification", () => {
  it("performs only account, Price, and webhook reads before returning a seven-secret bundle", async () => {
    const stripe = stripeMock();
    const result = await runStripeLiveBillingOperation({
      env: environment(),
      now: () => new Date("2026-07-26T23:00:00.000Z"),
      operation: "activate",
      policy: validateLiveBillingPolicy(rawPolicy()),
      stripeFactory: () => stripe,
    });
    expect(stripe.accounts.retrieve).toHaveBeenCalledOnce();
    expect(stripe.prices.retrieve).toHaveBeenCalledTimes(4);
    expect(stripe.webhookEndpoints.list).toHaveBeenCalledOnce();
    expect(result.report).toEqual(
      expect.objectContaining({
        desiredLiveBillingEnabled: true,
        noFinancialMutation: true,
        providerMode: "live",
        verified: true,
      }),
    );
    expect(Object.keys(result.secretBundle).sort()).toEqual([
      "LIVE_BILLING_ENABLED",
      "STRIPE_PRICE_CELLAR",
      "STRIPE_PRICE_ESTATE",
      "STRIPE_PRICE_RESERVE",
      "STRIPE_PRICE_VINE",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    const serializedReport = JSON.stringify(result.report);
    expect(serializedReport).not.toContain("sk_live_");
    expect(serializedReport).not.toContain("whsec_");
    expect(serializedReport).not.toContain(accountId);
    expect(serializedReport).not.toContain(webhookUrl);
  });

  it("fails closed on account, Price, webhook, or target drift", async () => {
    const allowedPolicy = validateLiveBillingPolicy(rawPolicy());
    await expect(
      runStripeLiveBillingOperation({
        env: environment({ PRODUCTION_WORKER_NAME: "wrong-worker" }),
        operation: "activate",
        policy: allowedPolicy,
        stripeFactory: () => stripeMock(),
      }),
    ).rejects.toThrow(/not allowlisted/);

    const wrongPrice = stripeMock();
    wrongPrice.prices.retrieve = vi.fn(async (id) => ({
      ...price(plans.find((candidate) => id.endsWith(candidate.plan))),
      livemode: false,
    }));
    await expect(
      runStripeLiveBillingOperation({
        env: environment(),
        operation: "activate",
        policy: allowedPolicy,
        stripeFactory: () => wrongPrice,
      }),
    ).rejects.toThrow(/Price contract mismatch/);

    const missingEvent = stripeMock();
    missingEvent.webhookEndpoints.list = vi.fn(async () => ({
      data: [{
        enabled_events: ["invoice.payment_succeeded"],
        livemode: true,
        status: "enabled",
        url: webhookUrl,
      }],
      has_more: false,
    }));
    await expect(
      runStripeLiveBillingOperation({
        env: environment(),
        operation: "activate",
        policy: allowedPolicy,
        stripeFactory: () => missingEvent,
      }),
    ).rejects.toThrow(/missing required events/);
  });

  it("has an independently verified test-mode reversion path", async () => {
    const result = await runStripeLiveBillingOperation({
      env: environment({
        STRIPE_LIVE_BILLING_CONFIRMATION:
          "REVERT VINIFERA STRIPE BILLING TO TEST MODE",
      }),
      operation: "revert",
      policy: validateLiveBillingPolicy(rawPolicy()),
      stripeFactory: () => stripeMock(false),
    });
    expect(result.report).toEqual(
      expect.objectContaining({
        desiredLiveBillingEnabled: false,
        noFinancialMutation: true,
        providerMode: "test",
        verified: true,
      }),
    );
    expect(result.secretBundle.LIVE_BILLING_ENABLED).toBe("false");
    expect(result.secretBundle.STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  });

  it("parses exactly one immutable Worker Version ID", () => {
    expect(
      parseWorkerVersionOutput(
        "Worker Version ID: 123e4567-e89b-42d3-a456-426614174000",
      ),
    ).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(() => parseWorkerVersionOutput("no version")).toThrow(/exactly one/);
  });

  it("contains no Stripe financial mutation API surface", async () => {
    const source = await readFile(
      resolve("scripts/stripe-live-billing.mjs"),
      "utf8",
    );
    for (const forbidden of [
      ".charges.",
      ".refunds.",
      ".paymentIntents.create",
      ".checkout.sessions.create",
      ".subscriptions.create",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("uploads the reviewed SHA and fails closed unless rollback restores one healthy prior version", async () => {
    const workflow = await readFile(
      resolve(".github/workflows/stripe-live-billing-cutover.yml"),
      "utf8",
    );
    expect(workflow).toContain(
      '[[ "$(git rev-parse HEAD)" == "$STRIPE_LIVE_BILLING_GIT_SHA" ]]',
    );
    expect(workflow).toContain(
      "npx wrangler versions upload --env production --strict",
    );
    expect(workflow).toContain('--secrets-file "$LIVE_BILLING_SECRET_FILE"');
    expect(workflow).not.toContain("versions secret bulk");
    expect(workflow).toContain(
      'deployment.versions[0].version_id !== expected',
    );
    expect(workflow).toContain(
      'configuration?.data?.billing?.configured !== true',
    );
    const rollback = workflow.slice(
      workflow.indexOf(
        "- name: Automatically restore prior Worker version after a failed promotion",
      ),
      workflow.indexOf("- name: Remove ephemeral Stripe secret bundle"),
    );
    expect(rollback).toContain("set -euo pipefail");
    expect(rollback).not.toContain("set +e");
  });
});
