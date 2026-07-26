import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowedAccount,
  assertCatalogPrice,
  assertOperationConfirmation,
  assertStripeTestSecret,
  renderStripeCatalogMarkdown,
  resolveStripeCredential,
  runStripeCatalogOperation,
  sanitizeStripeCatalogFailure,
  sha256,
  validateCatalogPolicy,
} from "../../scripts/stripe-test-catalog.mjs";

const ACCOUNT_ID = "acct_ViniferaTest123";
const ACCOUNT_HASH = sha256(ACCOUNT_ID);

function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    apiVersion: "2026-02-25.clover",
    catalogVersion: "2026-07-26-v1",
    currency: "usd",
    interval: "month",
    accountIdSha256: [ACCOUNT_HASH],
    plans: [
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
    ],
    ...overrides,
  };
}

function priceFor(plan, catalogPolicy = policy()) {
  return {
    active: true,
    currency: catalogPolicy.currency,
    id: `price_${plan.plan}`,
    livemode: false,
    lookup_key: plan.lookupKey,
    metadata: {
      vinifera_catalog_version: catalogPolicy.catalogVersion,
      vinifera_plan: plan.plan,
    },
    product: {
      active: true,
      id: `prod_${plan.plan}`,
      metadata: {
        vinifera_catalog_version: catalogPolicy.catalogVersion,
        vinifera_plan: plan.plan,
      },
      name: plan.productName,
    },
    recurring: {
      interval: catalogPolicy.interval,
      interval_count: 1,
      usage_type: "licensed",
    },
    type: "recurring",
    unit_amount: plan.unitAmount,
  };
}

function stripeMock(catalogPolicy = policy(), initialPrices = []) {
  const prices = [...initialPrices];
  const create = vi.fn(async (parameters) => {
    const plan = catalogPolicy.plans.find(
      (candidate) => candidate.lookupKey === parameters.lookup_key,
    );
    const created = priceFor(plan, catalogPolicy);
    prices.push(created);
    return created;
  });
  return {
    accounts: {
      retrieve: vi.fn(async () => ({ id: ACCOUNT_ID })),
    },
    prices: {
      create,
      list: vi.fn(async () => ({ data: [...prices] })),
    },
  };
}

function environment(overrides = {}) {
  return {
    GENERIC_STRIPE_SECRET_KEY: "sk_test_catalogcredential",
    STRIPE_CATALOG_GIT_SHA: "a".repeat(40),
    ...overrides,
  };
}

describe("Stripe test catalog policy", () => {
  it("accepts exactly the canonical four monthly plan contracts", () => {
    const normalized = validateCatalogPolicy(policy());
    expect(normalized.plans.map((plan) => plan.unitAmount)).toEqual([
      14900, 34900, 74900, 150000,
    ]);
  });

  it("rejects incomplete, duplicate, or non-monthly catalogs", () => {
    expect(() =>
      validateCatalogPolicy(policy({ interval: "year" })),
    ).toThrow(/interval must be month/);
    expect(() =>
      validateCatalogPolicy(policy({ plans: policy().plans.slice(0, 3) })),
    ).toThrow(/exactly four plans/);
    expect(() =>
      validateCatalogPolicy(
        policy({
          plans: policy().plans.map((plan) => ({
            ...plan,
            lookupKey: "vinifera_vine_monthly_usd_v1",
          })),
        }),
      ),
    ).toThrow(/lookup key is invalid|must be unique/);
  });

  it("rejects every currency, amount, product, and lookup-key drift", () => {
    expect(() =>
      validateCatalogPolicy(policy({ currency: "eur" })),
    ).toThrow(/currency must be usd/);
    const driftCases = [
      { unitAmount: 1 },
      { productName: "Different Product" },
      { lookupKey: "vinifera_vine_monthly_usd_v2" },
    ];
    for (const drift of driftCases) {
      expect(() =>
        validateCatalogPolicy(
          policy({
            plans: policy().plans.map((plan) =>
              plan.plan === "vine" ? { ...plan, ...drift } : plan,
            ),
          }),
        ),
      ).toThrow(/canonical for vine/);
    }
    expect(() =>
      validateCatalogPolicy(policy({ catalogVersion: "2026-07-26-v2" })),
    ).toThrow(/versions differ/);
  });

  it("prefers staging credentials and rejects every non-test key", () => {
    expect(
      resolveStripeCredential({
        GENERIC_STRIPE_SECRET_KEY: "sk_test_generic",
        STAGING_STRIPE_SECRET_KEY: "sk_test_staging",
      }),
    ).toEqual({ secret: "sk_test_staging", source: "staging" });
    expect(() => assertStripeTestSecret("sk_live_forbidden123")).toThrow(
      /sk_test_/,
    );
  });

  it("requires exact confirmations and an allowlisted account hash", () => {
    expect(() =>
      assertOperationConfirmation("bootstrap", "almost"),
    ).toThrow(/Exact bootstrap confirmation/);
    expect(() =>
      assertAllowedAccount(policy({ accountIdSha256: [] }), ACCOUNT_ID),
    ).toThrow(/allowlist/);
  });
});

describe("Stripe test catalog operations", () => {
  it("probes the account fingerprint without requiring or emitting the account ID", async () => {
    const stripe = stripeMock(policy({ accountIdSha256: [] }));
    const report = await runStripeCatalogOperation({
      operation: "probe",
      confirmation: "PROBE VINIFERA STRIPE TEST ACCOUNT",
      env: environment(),
      policy: policy({ accountIdSha256: [] }),
      stripeFactory: () => stripe,
      now: () => new Date("2026-07-26T20:00:00.000Z"),
    });
    expect(report).toEqual(
      expect.objectContaining({
        accountAllowed: false,
        accountIdSha256: ACCOUNT_HASH,
        credentialSource: "generic",
        gitSha: "a".repeat(40),
        readOnly: true,
        testMode: true,
      }),
    );
    expect(JSON.stringify(report)).not.toContain(ACCOUNT_ID);
    expect(stripe.prices.list).not.toHaveBeenCalled();
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("fails before Price access when the account is not allowlisted", async () => {
    const stripe = stripeMock(policy({ accountIdSha256: [] }));
    await expect(
      runStripeCatalogOperation({
        operation: "bootstrap",
        confirmation: "BOOTSTRAP VINIFERA STRIPE TEST CATALOG",
        env: environment(),
        policy: policy({ accountIdSha256: [] }),
        stripeFactory: () => stripe,
      }),
    ).rejects.toThrow(/allowlist/);
    expect(stripe.prices.list).not.toHaveBeenCalled();
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("creates the exact four missing Prices with stable idempotency keys", async () => {
    const catalogPolicy = policy();
    const stripe = stripeMock(catalogPolicy);
    const report = await runStripeCatalogOperation({
      operation: "bootstrap",
      confirmation: "BOOTSTRAP VINIFERA STRIPE TEST CATALOG",
      env: environment(),
      policy: catalogPolicy,
      stripeFactory: () => stripe,
    });
    expect(report.complete).toBe(true);
    expect(report.prices).toHaveLength(4);
    expect(report.prices.every((price) => price.disposition === "created")).toBe(
      true,
    );
    expect(stripe.prices.create).toHaveBeenCalledTimes(4);
    const calls = stripe.prices.create.mock.calls;
    expect(calls.map(([parameters]) => parameters.unit_amount)).toEqual([
      14900, 34900, 74900, 150000,
    ]);
    expect(
      new Set(calls.map(([, options]) => options.idempotencyKey)).size,
    ).toBe(4);
    expect(calls[0][1].idempotencyKey).toBe(
      `vinifera:stripe-test-catalog:${ACCOUNT_HASH}:2026-07-26-v1:vine`,
    );
    expect(
      calls.every(
        ([parameters]) =>
          parameters.expand?.length === 1 &&
          parameters.expand[0] === "product" &&
          parameters.recurring.interval === "month" &&
          parameters.recurring.usage_type === "licensed",
      ),
    ).toBe(true);
  });

  it("requests an expanded Product on every newly created Price", async () => {
    const catalogPolicy = policy();
    const stripe = stripeMock(catalogPolicy);
    stripe.prices.create = vi.fn(async (parameters) => {
      const plan = catalogPolicy.plans.find(
        (candidate) => candidate.lookupKey === parameters.lookup_key,
      );
      const created = priceFor(plan, catalogPolicy);
      return {
        ...created,
        product: parameters.expand?.includes("product")
          ? created.product
          : created.product.id,
      };
    });

    const report = await runStripeCatalogOperation({
      operation: "bootstrap",
      confirmation: "BOOTSTRAP VINIFERA STRIPE TEST CATALOG",
      env: environment(),
      policy: catalogPolicy,
      stripeFactory: () => stripe,
    });

    expect(report.complete).toBe(true);
    expect(report.prices).toHaveLength(4);
    expect(
      stripe.prices.create.mock.calls.every(([parameters]) =>
        parameters.expand?.includes("product"),
      ),
    ).toBe(true);
  });

  it("reuses a complete catalog without creating duplicates", async () => {
    const catalogPolicy = policy();
    const stripe = stripeMock(
      catalogPolicy,
      catalogPolicy.plans.map((plan) => priceFor(plan, catalogPolicy)),
    );
    const report = await runStripeCatalogOperation({
      operation: "bootstrap",
      confirmation: "BOOTSTRAP VINIFERA STRIPE TEST CATALOG",
      env: environment(),
      policy: catalogPolicy,
      stripeFactory: () => stripe,
    });
    expect(report.prices.every((price) => price.disposition === "reused")).toBe(
      true,
    );
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("fails closed on catalog drift and missing verify records", async () => {
    const catalogPolicy = policy();
    const drifted = priceFor(catalogPolicy.plans[0], catalogPolicy);
    drifted.unit_amount = 1;
    expect(() =>
      assertCatalogPrice(drifted, catalogPolicy.plans[0], catalogPolicy),
    ).toThrow(/contract mismatch/);
    const wrongProduct = priceFor(catalogPolicy.plans[0], catalogPolicy);
    wrongProduct.product = {
      ...wrongProduct.product,
      id: "prod_wrong",
      metadata: {
        ...wrongProduct.product.metadata,
        vinifera_plan: "cellar",
      },
    };
    expect(() =>
      assertCatalogPrice(
        wrongProduct,
        catalogPolicy.plans[0],
        catalogPolicy,
      ),
    ).toThrow(/Product metadata mismatch/);

    const stripe = stripeMock(catalogPolicy, []);
    let verifyFailure;
    try {
      await runStripeCatalogOperation({
        operation: "verify",
        confirmation: "VERIFY VINIFERA STRIPE TEST CATALOG",
        env: environment(),
        policy: catalogPolicy,
        stripeFactory: () => stripe,
      });
    } catch (error) {
      verifyFailure = error;
    }
    expect(
      sanitizeStripeCatalogFailure({
        operation: "verify",
        error: verifyFailure,
      }).planStates,
    ).toEqual([{ plan: "vine", disposition: "failed_or_unknown" }]);
    expect(stripe.prices.create).not.toHaveBeenCalled();
  });

  it("recovers idempotently after a partial provider-side create", async () => {
    const catalogPolicy = policy();
    const stripe = stripeMock(catalogPolicy);
    const originalCreate = stripe.prices.create;
    let firstAttempt = true;
    stripe.prices.create = vi.fn(async (parameters, options) => {
      const created = await originalCreate(parameters, options);
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error(`provider detail ${created.id} ${ACCOUNT_ID}`);
      }
      return created;
    });

    let providerFailure;
    try {
      await runStripeCatalogOperation({
        operation: "bootstrap",
        confirmation: "BOOTSTRAP VINIFERA STRIPE TEST CATALOG",
        env: environment(),
        policy: catalogPolicy,
        stripeFactory: () => stripe,
      });
    } catch (error) {
      providerFailure = error;
    }
    expect(providerFailure).toBeInstanceOf(Error);
    const sanitizedFailure = sanitizeStripeCatalogFailure({
      operation: "bootstrap",
      error: providerFailure,
    });
    expect(sanitizedFailure.planStates).toEqual([
      { plan: "vine", disposition: "failed_or_unknown" },
    ]);
    expect(JSON.stringify(sanitizedFailure)).not.toContain(ACCOUNT_ID);

    const report = await runStripeCatalogOperation({
      operation: "bootstrap",
      confirmation: "BOOTSTRAP VINIFERA STRIPE TEST CATALOG",
      env: environment(),
      policy: catalogPolicy,
      stripeFactory: () => stripe,
    });
    expect(report.complete).toBe(true);
    expect(report.prices[0].disposition).toBe("reused");
    expect(report.prices.slice(1).every((price) => price.disposition === "created"))
      .toBe(true);
  });

  it("renders sanitized success and failure reports without provider identifiers", () => {
    const markdown = renderStripeCatalogMarkdown({
      success: true,
      operation: "probe",
      readOnly: true,
      testMode: true,
      credentialSource: "generic",
      accountAllowed: false,
      catalogVersion: "2026-07-26-v1",
      apiVersion: "2026-02-25.clover",
      gitSha: "a".repeat(40),
    });
    expect(markdown).toContain("contains no API key");
    expect(markdown).not.toContain(ACCOUNT_ID);

    const failure = sanitizeStripeCatalogFailure({
      operation: "bootstrap",
      now: () => new Date("2026-07-26T20:00:00.000Z"),
    });
    const failureOutput = `${JSON.stringify(failure)}${renderStripeCatalogMarkdown(
      failure,
    )}`;
    expect(failureOutput).toContain("stripe_test_catalog_failed");
    expect(failureOutput).not.toContain(ACCOUNT_ID);
    expect(failureOutput).not.toContain("price_");
  });

  it("checks configured staging Price IDs during semantic verification", async () => {
    const catalogPolicy = policy();
    const prices = catalogPolicy.plans.map((plan) =>
      priceFor(plan, catalogPolicy),
    );
    const stripe = stripeMock(catalogPolicy, prices);
    const configured = Object.fromEntries(
      prices.map((price) => [
        `STAGING_STRIPE_PRICE_${price.metadata.vinifera_plan.toUpperCase()}`,
        price.id,
      ]),
    );
    const report = await runStripeCatalogOperation({
      operation: "verify",
      confirmation: "VERIFY VINIFERA STRIPE TEST CATALOG",
      env: environment(configured),
      policy: catalogPolicy,
      stripeFactory: () => stripe,
    });
    expect(report.configuredPriceIdsChecked).toBe(true);
    expect(report.configuredPriceIdsMatch).toBe(true);

    await expect(
      runStripeCatalogOperation({
        operation: "verify",
        confirmation: "VERIFY VINIFERA STRIPE TEST CATALOG",
        env: environment({
          ...configured,
          STAGING_STRIPE_PRICE_VINE: "price_wrong",
        }),
        policy: catalogPolicy,
        stripeFactory: () => stripe,
      }),
    ).rejects.toThrow(/Price ID mismatch for vine/);
  });
});

describe("Stripe test catalog workflow source", () => {
  it("is manual, immutable, minimally permissioned, pinned, and non-canceling", async () => {
    const workflow = await readFile(
      resolve(
        import.meta.dirname,
        "../../.github/workflows/stripe-test-catalog.yml",
      ),
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+(push|pull_request):/m);
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("deployments: none");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain('"$(git rev-parse origin/main)"');
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toMatch(/uses:\s+[^#\n]+@(main|master|v[0-9]+)(\s|$)/);
    expect(workflow.match(/secrets\.STRIPE_SECRET_KEY/g)).toHaveLength(1);
  });

  it("is a semantic fail-closed gate before staging Worker deployment", async () => {
    const workflow = await readFile(
      resolve(import.meta.dirname, "../../.github/workflows/ci.yml"),
      "utf8",
    );
    const verificationIndex = workflow.indexOf(
      "Verify configured Stripe test catalog semantics",
    );
    const deploymentIndex = workflow.indexOf(
      "Deploy isolated staging Worker",
    );
    expect(verificationIndex).toBeGreaterThan(0);
    expect(deploymentIndex).toBeGreaterThan(verificationIndex);
    const verificationBlock = workflow.slice(
      verificationIndex,
      deploymentIndex,
    );
    expect(verificationBlock).toContain(
      "STAGING_STRIPE_SECRET_KEY: ${{ secrets.STAGING_STRIPE_SECRET_KEY }}",
    );
    expect(verificationBlock).not.toContain("GENERIC_STRIPE_SECRET_KEY");
    expect(verificationBlock).toContain(
      "VERIFY VINIFERA STRIPE TEST CATALOG",
    );
  });
});
