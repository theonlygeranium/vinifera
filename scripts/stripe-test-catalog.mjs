import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";

const CATALOG_PATH = resolve(
  import.meta.dirname,
  "../config/stripe-test-catalog.json",
);
const OPERATIONS = new Set(["probe", "bootstrap", "verify"]);
const PLAN_NAMES = new Set(["vine", "cellar", "estate", "reserve"]);
const CONFIRMATIONS = Object.freeze({
  bootstrap: "BOOTSTRAP VINIFERA STRIPE TEST CATALOG",
  probe: "PROBE VINIFERA STRIPE TEST ACCOUNT",
  verify: "VERIFY VINIFERA STRIPE TEST CATALOG",
});
const PRICE_ENVIRONMENT_NAMES = Object.freeze({
  cellar: "STAGING_STRIPE_PRICE_CELLAR",
  estate: "STAGING_STRIPE_PRICE_ESTATE",
  reserve: "STAGING_STRIPE_PRICE_RESERVE",
  vine: "STAGING_STRIPE_PRICE_VINE",
});
const CANONICAL_CATALOG = Object.freeze({
  currency: "usd",
  interval: "month",
  plans: Object.freeze([
    Object.freeze({
      plan: "vine",
      productName: "Vinifera Vine",
      lookupKey: "vinifera_vine_monthly_usd_v1",
      unitAmount: 14900,
    }),
    Object.freeze({
      plan: "cellar",
      productName: "Vinifera Cellar",
      lookupKey: "vinifera_cellar_monthly_usd_v1",
      unitAmount: 34900,
    }),
    Object.freeze({
      plan: "estate",
      productName: "Vinifera Estate",
      lookupKey: "vinifera_estate_monthly_usd_v1",
      unitAmount: 74900,
    }),
    Object.freeze({
      plan: "reserve",
      productName: "Vinifera Reserve",
      lookupKey: "vinifera_reserve_monthly_usd_v1",
      unitAmount: 150000,
    }),
  ]),
});

class StripeCatalogOperationFailure extends Error {
  constructor(completedRecords, failedPlan) {
    super("Stripe test catalog operation failed closed.");
    this.name = "StripeCatalogOperationFailure";
    this.sanitizedPlanStates = [
      ...completedRecords.map((record) => ({
        plan: record.plan,
        disposition: record.disposition,
      })),
      ...(PLAN_NAMES.has(failedPlan)
        ? [{ plan: failedPlan, disposition: "failed_or_unknown" }]
        : []),
    ];
  }
}

export function sha256(value) {
  return createHash("sha256").update(value.trim()).digest("hex");
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

export function validateCatalogPolicy(rawPolicy) {
  if (
    rawPolicy === null ||
    typeof rawPolicy !== "object" ||
    rawPolicy.schemaVersion !== 1
  ) {
    throw new Error("Stripe catalog policy schema version is invalid.");
  }

  const apiVersion = requiredString(rawPolicy.apiVersion, "apiVersion");
  if (apiVersion !== "2026-02-25.clover") {
    throw new Error("Stripe catalog policy must use 2026-02-25.clover.");
  }

  const catalogVersion = requiredString(
    rawPolicy.catalogVersion,
    "catalogVersion",
  );
  const catalogVersionMatch = catalogVersion.match(/-v([0-9]+)$/);
  if (!catalogVersionMatch) {
    throw new Error("Stripe catalog version must end in -v<number>.");
  }
  const currency = requiredString(rawPolicy.currency, "currency").toLowerCase();
  if (currency !== CANONICAL_CATALOG.currency) {
    throw new Error("Vinifera subscription catalog currency must be usd.");
  }
  const interval = requiredString(rawPolicy.interval, "interval");
  if (interval !== CANONICAL_CATALOG.interval) {
    throw new Error("Vinifera subscription catalog interval must be month.");
  }

  if (
    !Array.isArray(rawPolicy.accountIdSha256) ||
    rawPolicy.accountIdSha256.some(
      (hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash),
    )
  ) {
    throw new Error("Stripe account allowlist must contain SHA-256 values.");
  }

  if (!Array.isArray(rawPolicy.plans) || rawPolicy.plans.length !== 4) {
    throw new Error("Stripe catalog must define exactly four plans.");
  }

  const providedPlans = rawPolicy.plans.map((plan) => {
    if (plan === null || typeof plan !== "object") {
      throw new Error("Stripe catalog plan is invalid.");
    }
    const planName = requiredString(plan.plan, "plan");
    if (!PLAN_NAMES.has(planName)) {
      throw new Error(`Unsupported Vinifera plan: ${planName}.`);
    }
    const lookupKey = requiredString(plan.lookupKey, "lookupKey");
    if (!/^vinifera_[a-z]+_monthly_usd_v[0-9]+$/.test(lookupKey)) {
      throw new Error(`Stripe lookup key is invalid for ${planName}.`);
    }
    return {
      plan: planName,
      productName: requiredString(plan.productName, "productName"),
      lookupKey,
      unitAmount: positiveInteger(plan.unitAmount, "unitAmount"),
    };
  });

  if (
    new Set(providedPlans.map((plan) => plan.plan)).size !==
      providedPlans.length ||
    new Set(providedPlans.map((plan) => plan.lookupKey)).size !==
      providedPlans.length
  ) {
    throw new Error("Stripe catalog plan names and lookup keys must be unique.");
  }
  if (
    [...PLAN_NAMES].some(
      (planName) => !providedPlans.some((plan) => plan.plan === planName),
    )
  ) {
    throw new Error("Stripe catalog is missing a Vinifera plan.");
  }
  for (const canonicalPlan of CANONICAL_CATALOG.plans) {
    const provided = providedPlans.find(
      (plan) => plan.plan === canonicalPlan.plan,
    );
    if (
      !provided ||
      provided.productName !== canonicalPlan.productName ||
      provided.lookupKey !== canonicalPlan.lookupKey ||
      provided.unitAmount !== canonicalPlan.unitAmount
    ) {
      throw new Error(
        `Stripe catalog contract must remain canonical for ${canonicalPlan.plan}.`,
      );
    }
    if (!provided.lookupKey.endsWith(`_v${catalogVersionMatch[1]}`)) {
      throw new Error(
        `Stripe catalog and lookup-key versions differ for ${canonicalPlan.plan}.`,
      );
    }
  }

  return {
    schemaVersion: 1,
    apiVersion,
    catalogVersion,
    currency,
    interval,
    accountIdSha256: [...new Set(rawPolicy.accountIdSha256)],
    plans: CANONICAL_CATALOG.plans.map((plan) => ({ ...plan })),
  };
}

export function resolveStripeCredential(env = process.env) {
  const staging = env.STAGING_STRIPE_SECRET_KEY?.trim();
  const generic = env.GENERIC_STRIPE_SECRET_KEY?.trim();
  const legacy = env.STRIPE_SECRET_KEY?.trim();
  if (staging) return { secret: staging, source: "staging" };
  if (generic) return { secret: generic, source: "generic" };
  if (legacy) return { secret: legacy, source: "legacy" };
  throw new Error("A Stripe test secret key is required.");
}

export function assertStripeTestSecret(secret) {
  if (!secret.startsWith("sk_test_")) {
    throw new Error("Stripe catalog operations require an sk_test_ key.");
  }
  if (secret.length < 16 || /\s/.test(secret)) {
    throw new Error("Stripe test credential format is invalid.");
  }
}

export function assertOperationConfirmation(operation, confirmation) {
  if (!OPERATIONS.has(operation)) {
    throw new Error("Stripe catalog operation is invalid.");
  }
  if (confirmation !== CONFIRMATIONS[operation]) {
    throw new Error(`Exact ${operation} confirmation is required.`);
  }
}

function canonicalGitSha(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error("Stripe catalog operation requires an immutable Git SHA.");
  }
  return value;
}

function assertAccountId(accountId) {
  if (typeof accountId !== "string" || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
    throw new Error("Stripe account identity is invalid.");
  }
}

export function assertAllowedAccount(policy, accountId) {
  assertAccountId(accountId);
  const accountHash = sha256(accountId);
  if (!policy.accountIdSha256.includes(accountHash)) {
    throw new Error(
      "Stripe test account is not present in the reviewed SHA-256 allowlist.",
    );
  }
  return accountHash;
}

function productIdentity(price) {
  if (
    price.product === null ||
    typeof price.product !== "object" ||
    typeof price.product.id !== "string"
  ) {
    throw new Error(`Stripe Price ${price.id} did not expand its Product.`);
  }
  return price.product;
}

export function assertCatalogPrice(price, plan, policy) {
  if (
    typeof price.id !== "string" ||
    !/^price_[A-Za-z0-9]+$/.test(price.id)
  ) {
    throw new Error(`Stripe Price identity is invalid for ${plan.plan}.`);
  }
  if (price.livemode !== false) {
    throw new Error(`Stripe Price for ${plan.plan} is not test-mode.`);
  }
  if (
    price.active !== true ||
    price.lookup_key !== plan.lookupKey ||
    price.currency !== policy.currency ||
    price.unit_amount !== plan.unitAmount ||
    price.type !== "recurring" ||
    price.recurring?.interval !== policy.interval ||
    price.recurring?.interval_count !== 1 ||
    price.recurring?.usage_type !== "licensed"
  ) {
    throw new Error(`Stripe Price contract mismatch for ${plan.plan}.`);
  }

  const product = productIdentity(price);
  if (
    !/^prod_[A-Za-z0-9]+$/.test(product.id) ||
    product.active !== true ||
    product.name !== plan.productName ||
    product.metadata?.vinifera_plan !== plan.plan ||
    product.metadata?.vinifera_catalog_version !== policy.catalogVersion ||
    price.metadata?.vinifera_plan !== plan.plan ||
    price.metadata?.vinifera_catalog_version !== policy.catalogVersion
  ) {
    throw new Error(`Stripe Product metadata mismatch for ${plan.plan}.`);
  }
  return {
    plan: plan.plan,
    lookupKey: plan.lookupKey,
    priceId: price.id,
    productId: product.id,
    unitAmount: plan.unitAmount,
    currency: policy.currency,
    interval: policy.interval,
  };
}

function configuredPriceIds(env) {
  return Object.fromEntries(
    Object.entries(PRICE_ENVIRONMENT_NAMES).map(([plan, environmentName]) => [
      plan,
      env[environmentName]?.trim() || null,
    ]),
  );
}

function assertConfiguredPriceIds(env, records) {
  const configured = configuredPriceIds(env);
  const configuredCount = Object.values(configured).filter(Boolean).length;
  if (configuredCount === 0) {
    return { checked: false, match: null };
  }
  if (configuredCount !== Object.keys(PRICE_ENVIRONMENT_NAMES).length) {
    throw new Error("Configured Stripe staging Price IDs are incomplete.");
  }
  for (const record of records) {
    if (configured[record.plan] !== record.priceId) {
      throw new Error(`Configured Stripe Price ID mismatch for ${record.plan}.`);
    }
  }
  return { checked: true, match: true };
}

function createPriceParameters(plan, policy) {
  const metadata = {
    vinifera_catalog_version: policy.catalogVersion,
    vinifera_plan: plan.plan,
  };
  return {
    active: true,
    currency: policy.currency,
    expand: ["product"],
    lookup_key: plan.lookupKey,
    metadata,
    nickname: `${plan.productName} monthly`,
    product_data: {
      active: true,
      metadata,
      name: plan.productName,
    },
    recurring: {
      interval: policy.interval,
      interval_count: 1,
      usage_type: "licensed",
    },
    unit_amount: plan.unitAmount,
  };
}

function idempotencyKey(accountHash, plan, policy) {
  return [
    "vinifera",
    "stripe-test-catalog",
    accountHash,
    policy.catalogVersion,
    plan.plan,
  ].join(":");
}

async function listCatalogPrices(stripe, policy) {
  const response = await stripe.prices.list({
    expand: ["data.product"],
    limit: 100,
    lookup_keys: policy.plans.map((plan) => plan.lookupKey),
  });
  if (!Array.isArray(response.data)) {
    throw new Error("Stripe Price list response is invalid.");
  }
  const byLookupKey = new Map();
  for (const price of response.data) {
    if (!price.lookup_key) continue;
    if (byLookupKey.has(price.lookup_key)) {
      throw new Error(`Stripe lookup key is duplicated: ${price.lookup_key}.`);
    }
    byLookupKey.set(price.lookup_key, price);
  }
  return byLookupKey;
}

async function accountIdentity(stripe) {
  const account = await stripe.accounts.retrieve();
  assertAccountId(account.id);
  return account.id;
}

export async function runStripeCatalogOperation({
  operation,
  confirmation,
  env = process.env,
  policy,
  stripeFactory = (secret, apiVersion) =>
    new Stripe(secret, {
      apiVersion,
      appInfo: {
        name: "Vinifera Catalog Activation",
        url: "https://vinifera.edstratumlabs.ai",
        version: policy.catalogVersion,
      },
      maxNetworkRetries: 2,
      timeout: 20_000,
    }),
  now = () => new Date(),
}) {
  assertOperationConfirmation(operation, confirmation);
  const normalizedPolicy = validateCatalogPolicy(policy);
  const gitSha = canonicalGitSha(env.STRIPE_CATALOG_GIT_SHA);
  const credential = resolveStripeCredential(env);
  assertStripeTestSecret(credential.secret);
  const stripe = stripeFactory(credential.secret, normalizedPolicy.apiVersion);
  const accountId = await accountIdentity(stripe);
  const accountHash = sha256(accountId);

  if (operation === "probe") {
    return {
      schemaVersion: 1,
      generatedAt: now().toISOString(),
      success: true,
      operation,
      readOnly: true,
      credentialSource: credential.source,
      testMode: true,
      accountIdSha256: accountHash,
      accountAllowed: normalizedPolicy.accountIdSha256.includes(accountHash),
      catalogVersion: normalizedPolicy.catalogVersion,
      apiVersion: normalizedPolicy.apiVersion,
      gitSha,
    };
  }

  assertAllowedAccount(normalizedPolicy, accountId);
  const existing = await listCatalogPrices(stripe, normalizedPolicy);
  const records = [];

  for (const plan of normalizedPolicy.plans) {
    try {
      let price = existing.get(plan.lookupKey);
      let disposition = operation === "verify" ? "verified" : "reused";
      if (!price) {
        if (operation === "verify") {
          throw new Error(`Stripe test Price is missing for ${plan.plan}.`);
        }
        price = await stripe.prices.create(
          createPriceParameters(plan, normalizedPolicy),
          {
            idempotencyKey: idempotencyKey(
              accountHash,
              plan,
              normalizedPolicy,
            ),
          },
        );
        disposition = "created";
      }
      records.push({
        ...assertCatalogPrice(price, plan, normalizedPolicy),
        disposition,
      });
    } catch {
      throw new StripeCatalogOperationFailure(records, plan.plan);
    }
  }
  const configuredPriceIds =
    operation === "verify"
      ? assertConfiguredPriceIds(env, records)
      : { checked: false, match: null };

  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    success: true,
    operation,
    readOnly: operation === "verify",
    credentialSource: credential.source,
    testMode: true,
    accountIdSha256: accountHash,
    accountAllowed: true,
    catalogVersion: normalizedPolicy.catalogVersion,
    apiVersion: normalizedPolicy.apiVersion,
    gitSha,
    complete: true,
    configuredPriceIdsChecked: configuredPriceIds.checked,
    configuredPriceIdsMatch: configuredPriceIds.match,
    prices: records,
  };
}

export function renderStripeCatalogMarkdown(report) {
  if (report.success === false) {
    return `## Stripe test catalog activation

The operation failed closed. This report contains no provider response body, API key, account ID, object ID, or webhook secret.

| Property | Result |
| --- | --- |
| Operation | ${report.operation} |
| Result | failed closed |
| Error code | ${report.error.code} |
| Catalog version | ${report.catalogVersion} |
| API version | ${report.apiVersion} |
| Immutable Git SHA | ${report.gitSha} |
`;
  }
  const priceRows = Array.isArray(report.prices)
    ? report.prices
        .map(
          (price) =>
            `| ${price.plan} | ${price.lookupKey} | ${price.disposition} |`,
        )
        .join("\n")
    : "| not inspected | n/a | n/a |";
  return `## Stripe test catalog activation

This report is sanitized. It contains no API key, account ID, webhook secret, customer, payment method, or provider response body.

| Property | Result |
| --- | --- |
| Operation | ${report.operation} |
| Read only | ${report.readOnly ? "yes" : "no"} |
| Test mode enforced | ${report.testMode ? "yes" : "no"} |
| Credential source | ${report.credentialSource} |
| Account fingerprint allowlisted | ${report.accountAllowed ? "yes" : "no"} |
| Catalog version | ${report.catalogVersion} |
| API version | ${report.apiVersion} |
| Immutable Git SHA | ${report.gitSha} |

| Plan | Lookup key | Result |
| --- | --- | --- |
${priceRows}
`;
}

export function sanitizeStripeCatalogFailure({
  operation = "unknown",
  error,
  apiVersion = "unknown",
  catalogVersion = "unknown",
  gitSha = "unknown",
  now = () => new Date(),
} = {}) {
  const planStates =
    error instanceof StripeCatalogOperationFailure
      ? error.sanitizedPlanStates
      : [];
  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    success: false,
    operation: OPERATIONS.has(operation) ? operation : "unknown",
    apiVersion,
    catalogVersion,
    gitSha: /^[a-f0-9]{40}$/.test(gitSha) ? gitSha : "unknown",
    readOnly: operation !== "bootstrap",
    testMode: true,
    planStates,
    error: {
      code: "stripe_test_catalog_failed",
      message:
        "Stripe test catalog operation failed closed. Inspect private provider logs before retrying.",
    },
  };
}

function parseArguments(argv) {
  const operation = argv[0];
  const options = { outputPath: null, markdownPath: null };
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--output") {
      options.outputPath = argv[index + 1] ?? null;
      index += 1;
    } else if (argv[index] === "--markdown") {
      options.markdownPath = argv[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error("Unsupported Stripe catalog argument.");
    }
  }
  if (!OPERATIONS.has(operation) || !options.outputPath) {
    throw new Error(
      "Usage: stripe-test-catalog.mjs <probe|bootstrap|verify> --output <path> [--markdown <path>]",
    );
  }
  return { operation, ...options };
}

async function writePrivateFile(path, contents) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, { encoding: "utf8", mode: 0o600 });
}

async function main() {
  let options;
  let policy;
  try {
    options = parseArguments(process.argv.slice(2));
    policy = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
    const report = await runStripeCatalogOperation({
      operation: options.operation,
      confirmation: process.env.STRIPE_CATALOG_CONFIRMATION,
      policy,
    });
    await writePrivateFile(
      options.outputPath,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    if (options.markdownPath) {
      await writePrivateFile(
        options.markdownPath,
        renderStripeCatalogMarkdown(report),
      );
    }
  } catch (error) {
    const failure = sanitizeStripeCatalogFailure({
      operation: options?.operation,
      error,
      apiVersion: policy?.apiVersion,
      catalogVersion: policy?.catalogVersion,
      gitSha: process.env.STRIPE_CATALOG_GIT_SHA,
    });
    if (options?.outputPath) {
      await writePrivateFile(
        options.outputPath,
        `${JSON.stringify(failure, null, 2)}\n`,
      );
    }
    if (options?.markdownPath) {
      await writePrivateFile(
        options.markdownPath,
        renderStripeCatalogMarkdown(failure),
      );
    }
    console.error("Stripe test catalog operation failed closed.");
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  await main();
}
