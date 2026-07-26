import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";

const POLICY_PATH = resolve(
  import.meta.dirname,
  "../config/stripe-live-billing-policy.json",
);
const OPERATIONS = new Set(["activate", "revert"]);
const PLAN_NAMES = ["vine", "cellar", "estate", "reserve"];
const PRICE_ENVIRONMENT_NAMES = Object.freeze({
  live: Object.freeze({
    cellar: "PRODUCTION_STRIPE_LIVE_PRICE_CELLAR",
    estate: "PRODUCTION_STRIPE_LIVE_PRICE_ESTATE",
    reserve: "PRODUCTION_STRIPE_LIVE_PRICE_RESERVE",
    vine: "PRODUCTION_STRIPE_LIVE_PRICE_VINE",
  }),
  test: Object.freeze({
    cellar: "PRODUCTION_STRIPE_TEST_PRICE_CELLAR",
    estate: "PRODUCTION_STRIPE_TEST_PRICE_ESTATE",
    reserve: "PRODUCTION_STRIPE_TEST_PRICE_RESERVE",
    vine: "PRODUCTION_STRIPE_TEST_PRICE_VINE",
  }),
});
const SECRET_ENVIRONMENT_NAMES = Object.freeze({
  live: Object.freeze({
    secretKey: "PRODUCTION_STRIPE_LIVE_SECRET_KEY",
    webhookSecret: "PRODUCTION_STRIPE_LIVE_WEBHOOK_SECRET",
  }),
  test: Object.freeze({
    secretKey: "PRODUCTION_STRIPE_TEST_SECRET_KEY",
    webhookSecret: "PRODUCTION_STRIPE_TEST_WEBHOOK_SECRET",
  }),
});
const CANONICAL_PLANS = Object.freeze([
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
]);

export function sha256(value) {
  return createHash("sha256").update(String(value).trim(), "utf8").digest("hex");
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function checkedHashList(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) => typeof entry !== "string" || !/^[a-f0-9]{64}$/.test(entry),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} must be a non-empty unique SHA-256 allowlist.`);
  }
  return [...value];
}

function normalizeWorkerOrigin(value) {
  let parsed;
  try {
    parsed = new URL(requiredString(value, "PRODUCTION_WORKER_ORIGIN"));
  } catch {
    throw new Error("The production Worker origin is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.toLowerCase().endsWith(".workers.dev")
  ) {
    throw new Error("The production Worker origin must be a canonical workers.dev origin.");
  }
  return parsed.origin.toLowerCase();
}

function normalizeWorkerName(value) {
  const normalized = requiredString(value, "PRODUCTION_WORKER_NAME").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(normalized)) {
    throw new Error("The production Worker name is invalid.");
  }
  return normalized;
}

function normalizeCloudflareAccountId(value) {
  const normalized = requiredString(
    value,
    "PRODUCTION_CLOUDFLARE_ACCOUNT_ID",
  ).toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) {
    throw new Error("The production Cloudflare account identity is invalid.");
  }
  return normalized;
}

export function validateLiveBillingPolicy(rawPolicy) {
  if (
    rawPolicy === null ||
    typeof rawPolicy !== "object" ||
    rawPolicy.schemaVersion !== 1
  ) {
    throw new Error("Stripe live-billing policy schema version is invalid.");
  }
  if (
    typeof rawPolicy.enabled !== "boolean" ||
    typeof rawPolicy.independentAuthorityEnabled !== "boolean"
  ) {
    throw new Error("Stripe live-billing policy authority flags are invalid.");
  }
  if (rawPolicy.apiVersion !== "2026-02-25.clover") {
    throw new Error("Stripe live-billing policy API version is invalid.");
  }
  if (
    rawPolicy.catalogVersion !== "2026-07-26-v1" ||
    rawPolicy.currency !== "usd" ||
    rawPolicy.interval !== "month"
  ) {
    throw new Error("Stripe live-billing catalog contract is invalid.");
  }
  if (
    rawPolicy.confirmations?.activate !==
      "ACTIVATE VINIFERA STRIPE LIVE BILLING" ||
    rawPolicy.confirmations?.revert !==
      "REVERT VINIFERA STRIPE BILLING TO TEST MODE" ||
    rawPolicy.authorityPhrase !==
      "AUTHORIZE VINIFERA STRIPE LIVE BILLING CONTROL"
  ) {
    throw new Error("Stripe live-billing confirmation contract is invalid.");
  }
  if (
    !Array.isArray(rawPolicy.requiredWebhookEvents) ||
    rawPolicy.requiredWebhookEvents.length === 0 ||
    rawPolicy.requiredWebhookEvents.some(
      (event) =>
        typeof event !== "string" ||
        !/^[a-z0-9_*]+(?:\.[a-z0-9_*]+)+$/.test(event),
    ) ||
    new Set(rawPolicy.requiredWebhookEvents).size !==
      rawPolicy.requiredWebhookEvents.length
  ) {
    throw new Error("Required Stripe webhook events are invalid.");
  }
  if (
    !Array.isArray(rawPolicy.plans) ||
    JSON.stringify(rawPolicy.plans) !== JSON.stringify(CANONICAL_PLANS)
  ) {
    throw new Error("Stripe live-billing plans must match the canonical catalog.");
  }
  const targetHashes = {
    cloudflareAccountIdSha256: checkedHashList(
      rawPolicy.targetHashes?.cloudflareAccountIdSha256,
      "targetHashes.cloudflareAccountIdSha256",
    ),
    workerNameSha256: checkedHashList(
      rawPolicy.targetHashes?.workerNameSha256,
      "targetHashes.workerNameSha256",
    ),
    workerOriginSha256: checkedHashList(
      rawPolicy.targetHashes?.workerOriginSha256,
      "targetHashes.workerOriginSha256",
    ),
  };
  const modes = Object.fromEntries(
    ["live", "test"].map((mode) => [
      mode,
      {
        accountIdSha256: checkedHashList(
          rawPolicy.modes?.[mode]?.accountIdSha256,
          `modes.${mode}.accountIdSha256`,
        ),
        webhookEndpointUrlSha256: checkedHashList(
          rawPolicy.modes?.[mode]?.webhookEndpointUrlSha256,
          `modes.${mode}.webhookEndpointUrlSha256`,
        ),
      },
    ]),
  );
  return {
    ...rawPolicy,
    targetHashes,
    modes,
    plans: CANONICAL_PLANS.map((plan) => ({ ...plan })),
  };
}

export function assertLiveBillingAuthority(policy, operation, env = process.env) {
  if (!OPERATIONS.has(operation)) {
    throw new Error("Stripe live-billing operation is invalid.");
  }
  if (!policy.enabled || !policy.independentAuthorityEnabled) {
    throw new Error("Stripe live-billing control is disabled by reviewed policy.");
  }
  if (env.STRIPE_LIVE_BILLING_CONFIRMATION !== policy.confirmations[operation]) {
    throw new Error(`Exact ${operation} confirmation phrase is required.`);
  }
  if (env.PRODUCTION_LIVE_BILLING_AUTHORITY !== policy.authorityPhrase) {
    throw new Error("Independent live-billing authority is absent.");
  }
  const gitSha = requiredString(env.STRIPE_LIVE_BILLING_GIT_SHA, "git SHA");
  if (!/^[a-f0-9]{40}$/.test(gitSha)) {
    throw new Error("A full immutable main-branch Git SHA is required.");
  }
  return gitSha;
}

export function assertLiveBillingTargets(policy, env = process.env) {
  const normalized = {
    cloudflareAccountId: normalizeCloudflareAccountId(
      env.PRODUCTION_CLOUDFLARE_ACCOUNT_ID,
    ),
    workerName: normalizeWorkerName(env.PRODUCTION_WORKER_NAME),
    workerOrigin: normalizeWorkerOrigin(env.PRODUCTION_WORKER_ORIGIN),
  };
  const hashes = {
    cloudflareAccountIdSha256: sha256(normalized.cloudflareAccountId),
    workerNameSha256: sha256(normalized.workerName),
    workerOriginSha256: sha256(normalized.workerOrigin),
  };
  for (const [kind, hash] of Object.entries(hashes)) {
    if (!policy.targetHashes[kind].includes(hash)) {
      throw new Error(`The ${kind} target is not allowlisted.`);
    }
  }
  return { hashes, normalized };
}

function selectedMode(operation) {
  return operation === "activate" ? "live" : "test";
}

export function selectStripeSecrets(operation, env = process.env) {
  const mode = selectedMode(operation);
  const secretNames = SECRET_ENVIRONMENT_NAMES[mode];
  const priceNames = PRICE_ENVIRONMENT_NAMES[mode];
  const secretKey = requiredString(env[secretNames.secretKey], secretNames.secretKey);
  const webhookSecret = requiredString(
    env[secretNames.webhookSecret],
    secretNames.webhookSecret,
  );
  const requiredPrefix = mode === "live" ? "sk_live_" : "sk_test_";
  if (
    !secretKey.startsWith(requiredPrefix) ||
    secretKey.length < 16 ||
    /\s/.test(secretKey)
  ) {
    throw new Error(`Stripe ${mode} secret-key format is invalid.`);
  }
  if (
    !webhookSecret.startsWith("whsec_") ||
    webhookSecret.length < 16 ||
    /\s/.test(webhookSecret)
  ) {
    throw new Error(`Stripe ${mode} webhook-secret format is invalid.`);
  }
  const priceIds = Object.fromEntries(
    PLAN_NAMES.map((plan) => {
      const environmentName = priceNames[plan];
      const priceId = requiredString(env[environmentName], environmentName);
      if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
        throw new Error(`Stripe ${mode} Price identity is invalid for ${plan}.`);
      }
      return [plan, priceId];
    }),
  );
  if (new Set(Object.values(priceIds)).size !== PLAN_NAMES.length) {
    throw new Error(`Stripe ${mode} Price identities must be unique.`);
  }
  return { mode, priceIds, secretKey, webhookSecret };
}

function assertAccount(policy, mode, account) {
  if (!account || typeof account.id !== "string" || !/^acct_[A-Za-z0-9]+$/.test(account.id)) {
    throw new Error("Stripe account identity is invalid.");
  }
  const accountIdSha256 = sha256(account.id);
  if (!policy.modes[mode].accountIdSha256.includes(accountIdSha256)) {
    throw new Error(`Stripe ${mode} account is not allowlisted.`);
  }
  return accountIdSha256;
}

function expandedProduct(price, plan) {
  if (
    !price.product ||
    typeof price.product !== "object" ||
    typeof price.product.id !== "string"
  ) {
    throw new Error(`Stripe Product was not expanded for ${plan}.`);
  }
  return price.product;
}

export function assertSemanticPrice(
  price,
  plan,
  policy,
  mode,
  expectedPriceId = null,
) {
  const liveMode = mode === "live";
  if (
    !price ||
    typeof price.id !== "string" ||
    !/^price_[A-Za-z0-9]+$/.test(price.id) ||
    (expectedPriceId !== null && price.id !== expectedPriceId) ||
    price.livemode !== liveMode ||
    price.active !== true ||
    price.currency !== policy.currency ||
    price.unit_amount !== plan.unitAmount ||
    price.lookup_key !== plan.lookupKey ||
    price.type !== "recurring" ||
    price.recurring?.interval !== policy.interval ||
    price.recurring?.interval_count !== 1 ||
    price.recurring?.usage_type !== "licensed"
  ) {
    throw new Error(`Stripe ${mode} Price contract mismatch for ${plan.plan}.`);
  }
  const product = expandedProduct(price, plan.plan);
  if (
    !/^prod_[A-Za-z0-9]+$/.test(product.id) ||
    product.active !== true ||
    product.name !== plan.productName ||
    product.metadata?.vinifera_plan !== plan.plan ||
    product.metadata?.vinifera_catalog_version !== policy.catalogVersion ||
    price.metadata?.vinifera_plan !== plan.plan ||
    price.metadata?.vinifera_catalog_version !== policy.catalogVersion
  ) {
    throw new Error(`Stripe ${mode} Product contract mismatch for ${plan.plan}.`);
  }
  return {
    plan: plan.plan,
    priceIdSha256: sha256(price.id),
    productIdSha256: sha256(product.id),
    semanticMatch: true,
  };
}

export function assertSemanticWebhook(webhookEndpoints, policy, mode) {
  const expectedLiveMode = mode === "live";
  const matching = webhookEndpoints.filter((endpoint) => {
    if (
      !endpoint ||
      endpoint.status !== "enabled" ||
      endpoint.livemode !== expectedLiveMode ||
      typeof endpoint.url !== "string"
    ) {
      return false;
    }
    return policy.modes[mode].webhookEndpointUrlSha256.includes(
      sha256(endpoint.url),
    );
  });
  if (matching.length !== 1) {
    throw new Error(
      `Exactly one enabled allowlisted Stripe ${mode} webhook endpoint is required.`,
    );
  }
  const endpoint = matching[0];
  const enabledEvents = new Set(endpoint.enabled_events ?? []);
  if (
    !policy.requiredWebhookEvents.every(
      (event) => enabledEvents.has(event) || enabledEvents.has("*"),
    )
  ) {
    throw new Error(`Stripe ${mode} webhook endpoint is missing required events.`);
  }
  return {
    enabled: true,
    endpointUrlSha256: sha256(endpoint.url),
    requiredEventCount: policy.requiredWebhookEvents.length,
    semanticMatch: true,
  };
}

export async function runStripeLiveBillingOperation({
  env = process.env,
  now = () => new Date(),
  operation,
  policy,
  stripeFactory = (secretKey) =>
    new Stripe(secretKey, {
      apiVersion: policy.apiVersion,
      maxNetworkRetries: 0,
      timeout: 15_000,
    }),
}) {
  const gitSha = assertLiveBillingAuthority(policy, operation, env);
  const targets = assertLiveBillingTargets(policy, env);
  const selected = selectStripeSecrets(operation, env);
  const stripe = stripeFactory(selected.secretKey);
  const account = await stripe.accounts.retrieve();
  const accountIdSha256 = assertAccount(policy, selected.mode, account);
  const prices = [];
  for (const plan of policy.plans) {
    const price = await stripe.prices.retrieve(selected.priceIds[plan.plan], {
      expand: ["product"],
    });
    prices.push(
      assertSemanticPrice(
        price,
        plan,
        policy,
        selected.mode,
        selected.priceIds[plan.plan],
      ),
    );
  }
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  if (endpoints.has_more) {
    throw new Error("Stripe webhook inventory exceeds the bounded verification page.");
  }
  const webhook = assertSemanticWebhook(endpoints.data, policy, selected.mode);
  return {
    report: {
      accountIdSha256,
      desiredLiveBillingEnabled: operation === "activate",
      generatedAt: now().toISOString(),
      gitSha,
      noFinancialMutation: true,
      operation,
      prices,
      providerMode: selected.mode,
      schemaVersion: 1,
      targetHashes: targets.hashes,
      verified: true,
      webhook,
    },
    secretBundle: {
      LIVE_BILLING_ENABLED: operation === "activate" ? "true" : "false",
      STRIPE_PRICE_CELLAR: selected.priceIds.cellar,
      STRIPE_PRICE_ESTATE: selected.priceIds.estate,
      STRIPE_PRICE_RESERVE: selected.priceIds.reserve,
      STRIPE_PRICE_VINE: selected.priceIds.vine,
      STRIPE_SECRET_KEY: selected.secretKey,
      STRIPE_WEBHOOK_SECRET: selected.webhookSecret,
    },
  };
}

export function parseWorkerVersionOutput(output) {
  const matches = [
    ...String(output).matchAll(
      /(?:Worker )?Version ID:\s*([0-9a-f]{8}-[0-9a-f-]{27,})/gi,
    ),
  ].map((match) => match[1].toLowerCase());
  if (
    matches.length !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      matches[0],
    )
  ) {
    throw new Error("Wrangler did not return exactly one valid Worker Version ID.");
  }
  return matches[0];
}

async function writeJson(path, value, secret = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: secret ? 0o600 : 0o644,
  });
  if (secret) await chmod(path, 0o600);
}

async function main(arguments_, env = process.env) {
  const [command, operation, ...rest] = arguments_;
  const option = (name) => {
    const index = rest.indexOf(name);
    return index === -1 ? null : rest[index + 1];
  };
  if (command === "parse-version") {
    const inputPath = requiredString(operation, "Wrangler output path");
    const outputPath = requiredString(option("--output"), "version output path");
    await writeJson(outputPath, {
      versionId: parseWorkerVersionOutput(await readFile(inputPath, "utf8")),
    });
    return;
  }
  if (command !== "execute" || !OPERATIONS.has(operation)) {
    throw new Error(
      "Usage: stripe-live-billing.mjs execute <activate|revert> --report <path> --secret-file <path>, or parse-version <input> --output <path>.",
    );
  }
  const reportPath = requiredString(option("--report"), "report path");
  const secretPath = requiredString(option("--secret-file"), "secret-file path");
  try {
    const rawPolicy = JSON.parse(await readFile(POLICY_PATH, "utf8"));
    const policy = validateLiveBillingPolicy(rawPolicy);
    const result = await runStripeLiveBillingOperation({
      env,
      operation,
      policy,
    });
    await writeJson(reportPath, result.report);
    await writeJson(secretPath, result.secretBundle, true);
  } catch (error) {
    await writeJson(reportPath, {
      errorCode: "live_billing_control_failed",
      operation,
      schemaVersion: 1,
      verified: false,
    });
    throw error;
  }
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "Live-billing control failed.");
    process.exitCode = 1;
  });
}
