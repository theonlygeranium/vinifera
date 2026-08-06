import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";

const POLICY_PATH = resolve(
  import.meta.dirname,
  "../config/stripe-live-proof-policy.json",
);
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATIONS = new Set(["prepare", "finalize"]);
const PLANS = new Set(["vine", "cellar", "estate", "reserve"]);

export function sha256(value) {
  return createHash("sha256")
    .update(String(value).trim(), "utf8")
    .digest("hex");
}

function required(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function canonicalOrigin(value, label = "production Worker origin") {
  let parsed;
  try {
    parsed = new URL(required(value, label));
  } catch {
    throw new Error(`The ${label} is invalid.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`The ${label} must be a canonical HTTPS origin.`);
  }
  return parsed.origin.toLowerCase();
}

function exactHashList(value, label, ready) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !SHA256.test(entry)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} must be a unique SHA-256 allowlist.`);
  }
  if (ready && value.length !== 1) {
    throw new Error(`${label} must contain exactly one reviewed target hash.`);
  }
  return [...value];
}

export function validateLiveProofPolicy(rawPolicy, { ready = false } = {}) {
  if (!rawPolicy || rawPolicy.schemaVersion !== 1) {
    throw new Error("Stripe live-proof policy schema version is invalid.");
  }
  if (typeof rawPolicy.enabled !== "boolean") {
    throw new Error("Stripe live-proof policy enabled flag is invalid.");
  }
  if (
    rawPolicy.apiVersion !== "2026-02-25.clover" ||
    rawPolicy.currency !== "usd" ||
    rawPolicy.confirmation !== "AUTHORIZE ONE VINIFERA LIVE CHARGE AND REFUND"
  ) {
    throw new Error("Stripe live-proof provider contract is invalid.");
  }
  if (
    !Number.isInteger(rawPolicy.checkoutExpiresAfterSeconds) ||
    rawPolicy.checkoutExpiresAfterSeconds < 1800 ||
    rawPolicy.checkoutExpiresAfterSeconds > 86400 ||
    !Number.isInteger(rawPolicy.pollAttempts) ||
    rawPolicy.pollAttempts < 1 ||
    rawPolicy.pollAttempts > 60 ||
    !Number.isInteger(rawPolicy.pollIntervalMilliseconds) ||
    rawPolicy.pollIntervalMilliseconds < 1000 ||
    rawPolicy.pollIntervalMilliseconds > 60000
  ) {
    throw new Error("Stripe live-proof bounded timing policy is invalid.");
  }
  if (
    rawPolicy.metadata?.gate !== "19" ||
    rawPolicy.metadata?.proofVersion !== "2026-08-06-v1"
  ) {
    throw new Error("Stripe live-proof metadata contract is invalid.");
  }
  const targetHashes = Object.fromEntries(
    [
      "brandIdSha256",
      "liveAccountIdSha256",
      "customerIdSha256",
      "priceIdSha256",
      "planSha256",
      "maximumAmountCentsSha256",
      "organizationIdSha256",
      "supabaseOriginSha256",
      "workerOriginSha256",
    ].map((name) => [
      name,
      exactHashList(
        rawPolicy.targetHashes?.[name],
        `targetHashes.${name}`,
        ready,
      ),
    ]),
  );
  return { ...rawPolicy, targetHashes };
}

function assertHash(policy, kind, value) {
  const digest = sha256(value);
  if (!policy.targetHashes[kind]?.includes(digest)) {
    throw new Error(
      `The ${kind} target is not the exact reviewed live-proof target.`,
    );
  }
  return digest;
}

export function assertLiveProofAuthority(policy, operation, env = process.env) {
  if (!OPERATIONS.has(operation)) {
    throw new Error("Stripe live-proof operation is invalid.");
  }
  if (!policy.enabled) {
    throw new Error(
      "Stripe live-proof control is disabled by reviewed policy.",
    );
  }
  if (env.STRIPE_LIVE_PROOF_CONFIRMATION !== policy.confirmation) {
    throw new Error("The exact owner live-proof confirmation is required.");
  }
  const gitSha = required(
    env.STRIPE_LIVE_PROOF_GIT_SHA,
    "immutable main Git SHA",
  );
  if (!GIT_SHA.test(gitSha)) {
    throw new Error("A full immutable main-branch Git SHA is required.");
  }
  const nonce = required(
    env.STRIPE_LIVE_PROOF_NONCE,
    "proof nonce",
  ).toLowerCase();
  if (!UUID.test(nonce)) {
    throw new Error(
      "The proof nonce must be one UUID shared by prepare and finalize.",
    );
  }
  return { gitSha, nonce };
}

export function assertLiveProofTargets(policy, env = process.env) {
  const brandId = required(
    env.PRODUCTION_STRIPE_LIVE_PROOF_BRAND_ID,
    "live-proof brand",
  );
  const customerId = required(
    env.PRODUCTION_STRIPE_LIVE_PROOF_CUSTOMER_ID,
    "live-proof customer",
  );
  const priceId = required(
    env.PRODUCTION_STRIPE_LIVE_PROOF_PRICE_ID,
    "live-proof Price",
  );
  const plan = required(
    env.PRODUCTION_STRIPE_LIVE_PROOF_PLAN,
    "live-proof plan",
  );
  const maximumAmountCents = Number(
    required(
      env.PRODUCTION_STRIPE_LIVE_PROOF_MAX_AMOUNT_CENTS,
      "live-proof maximum amount",
    ),
  );
  const organizationId = required(
    env.PRODUCTION_STRIPE_LIVE_PROOF_ORGANIZATION_ID,
    "live-proof organization",
  );
  const workerOrigin = canonicalOrigin(env.PRODUCTION_WORKER_ORIGIN);
  const supabaseOrigin = canonicalOrigin(
    env.PRODUCTION_SUPABASE_URL,
    "production Supabase origin",
  );
  if (!UUID.test(brandId) || !UUID.test(organizationId)) {
    throw new Error(
      "The live-proof brand and organization identities must be UUIDs.",
    );
  }
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) {
    throw new Error("The live-proof customer identity is invalid.");
  }
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new Error("The live-proof Price identity is invalid.");
  }
  if (!PLANS.has(plan)) {
    throw new Error("The live-proof plan is invalid.");
  }
  if (!Number.isSafeInteger(maximumAmountCents) || maximumAmountCents < 1) {
    throw new Error(
      "The live-proof maximum amount must be a positive integer.",
    );
  }
  return {
    brandId,
    customerId,
    maximumAmountCents,
    organizationId,
    plan,
    priceId,
    supabaseOrigin,
    targetHashes: {
      brandIdSha256: assertHash(policy, "brandIdSha256", brandId),
      customerIdSha256: assertHash(policy, "customerIdSha256", customerId),
      maximumAmountCentsSha256: assertHash(
        policy,
        "maximumAmountCentsSha256",
        String(maximumAmountCents),
      ),
      organizationIdSha256: assertHash(
        policy,
        "organizationIdSha256",
        organizationId,
      ),
      planSha256: assertHash(policy, "planSha256", plan),
      priceIdSha256: assertHash(policy, "priceIdSha256", priceId),
      supabaseOriginSha256: assertHash(
        policy,
        "supabaseOriginSha256",
        supabaseOrigin,
      ),
      workerOriginSha256: assertHash(
        policy,
        "workerOriginSha256",
        workerOrigin,
      ),
    },
    workerOrigin,
  };
}

function assertLiveSecret(value, prefix, label) {
  const normalized = required(value, label);
  if (
    !normalized.startsWith(prefix) ||
    normalized.length < 16 ||
    /\s/.test(normalized)
  ) {
    throw new Error(`${label} format is invalid.`);
  }
  return normalized;
}

function assertAccount(policy, account) {
  if (!account || !/^acct_[A-Za-z0-9]+$/.test(account.id ?? "")) {
    throw new Error("Stripe live account identity is invalid.");
  }
  return assertHash(policy, "liveAccountIdSha256", account.id);
}

function assertCustomer(customer, expectedId) {
  if (
    !customer ||
    customer.deleted === true ||
    customer.id !== expectedId ||
    customer.livemode !== true
  ) {
    throw new Error("Stripe live-proof customer contract does not match.");
  }
}

function assertPrice(price, targets, policy) {
  const product = price?.product;
  if (
    !price ||
    price.id !== targets.priceId ||
    price.livemode !== true ||
    price.active !== true ||
    price.currency !== policy.currency ||
    !Number.isSafeInteger(price.unit_amount) ||
    price.unit_amount < 1 ||
    price.unit_amount > targets.maximumAmountCents ||
    price.type !== "recurring" ||
    price.recurring?.interval !== "month" ||
    price.recurring?.interval_count !== 1 ||
    price.metadata?.vinifera_plan !== targets.plan ||
    !product ||
    typeof product !== "object" ||
    product.deleted === true ||
    product.active !== true ||
    product.metadata?.vinifera_plan !== targets.plan
  ) {
    throw new Error(
      "Stripe live-proof Price, plan, or maximum amount contract does not match.",
    );
  }
  return price.unit_amount;
}

function exactMetadata(policy, authority, targets, metadata) {
  const expected = {
    billing_mode: "independent",
    brand_id: targets.brandId,
    organization_id: targets.organizationId,
    plan_tier: targets.plan,
    vinifera_git_sha: authority.gitSha,
    vinifera_gate: policy.metadata.gate,
    vinifera_proof_nonce: authority.nonce,
    vinifera_proof_version: policy.metadata.proofVersion,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (metadata?.[key] !== value) {
      throw new Error(`Stripe live-proof metadata mismatch for ${key}.`);
    }
  }
}

function stripeObjectId(value) {
  return typeof value === "string" ? value : (value?.id ?? null);
}

async function poll(check, policy, sleep) {
  let lastError;
  for (let attempt = 1; attempt <= policy.pollAttempts; attempt += 1) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      if (attempt < policy.pollAttempts) {
        await sleep(policy.pollIntervalMilliseconds);
      }
    }
  }
  throw lastError;
}

function supabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
}

function requestTimeout() {
  return AbortSignal.timeout(15000);
}

export function createApplicationStore({
  fetcher,
  serviceRoleKey,
  supabaseUrl,
}) {
  const origin = canonicalOrigin(supabaseUrl, "production Supabase origin");
  async function select(table, parameters) {
    const url = new URL(`/rest/v1/${table}`, origin);
    for (const [name, value] of Object.entries(parameters)) {
      url.searchParams.set(name, value);
    }
    const response = await fetcher(url, {
      headers: supabaseHeaders(serviceRoleKey),
      signal: requestTimeout(),
    });
    if (!response.ok) {
      throw new Error(`Application lifecycle query failed for ${table}.`);
    }
    const result = await response.json();
    if (!Array.isArray(result)) {
      throw new Error(
        `Application lifecycle response for ${table} is ambiguous.`,
      );
    }
    return result;
  }
  return {
    async event(eventId, subject, expectedType) {
      const rows = await select("subscription_events", {
        select:
          "id,organization_id,brand_id,event_type,stripe_event_id,livemode,payload,processing_status,processed_at",
        brand_id: `eq.${subject.id}`,
        organization_id: `eq.${subject.organization_id}`,
        stripe_event_id: `eq.${eventId}`,
      });
      if (rows.length !== 1) {
        throw new Error(
          "The signed live webhook has not converged exactly once.",
        );
      }
      const row = rows[0];
      if (
        row.livemode !== true ||
        row.event_type !== expectedType ||
        row.processing_status !== "applied" ||
        !row.processed_at
      ) {
        throw new Error("The signed live webhook is not durably applied.");
      }
      return row;
    },
    async subject(targets) {
      const [brands, organizations] = await Promise.all([
        select("brands", {
          select:
            "id,organization_id,billing_mode,plan_tier,stripe_customer_id,stripe_subscription_id,subscription_status,access_status,stripe_state_updated_at",
          id: `eq.${targets.brandId}`,
          organization_id: `eq.${targets.organizationId}`,
          stripe_customer_id: `eq.${targets.customerId}`,
        }),
        select("organizations", {
          select:
            "id,plan_tier,stripe_customer_id,stripe_subscription_id,subscription_status,access_status,stripe_state_updated_at,brands!inner(id,organization_id,billing_mode,stripe_customer_id)",
          "brands.billing_mode": "eq.independent",
          "brands.id": `eq.${targets.brandId}`,
          "brands.organization_id": `eq.${targets.organizationId}`,
          "brands.stripe_customer_id": `eq.${targets.customerId}`,
          id: `eq.${targets.organizationId}`,
          stripe_customer_id: `eq.${targets.customerId}`,
        }),
      ]);
      if (brands.length + organizations.length !== 1 || brands.length !== 1) {
        throw new Error(
          "The approved customer must map to exactly one independent-billing brand.",
        );
      }
      if (brands[0].billing_mode !== "independent") {
        throw new Error(
          "The approved live-proof brand is not independently billed.",
        );
      }
      if (
        brands[0].id !== targets.brandId ||
        brands[0].organization_id !== targets.organizationId
      ) {
        throw new Error(
          "The approved live-proof tenant does not match the reviewed target.",
        );
      }
      return brands[0];
    },
  };
}

async function verifyWorkerHealth(fetcher, origin, expectedRevision) {
  const [healthResponse, configurationResponse] = await Promise.all([
    fetcher(new URL("/api/health", origin), { signal: requestTimeout() }),
    fetcher(new URL("/api/health/configuration", origin), {
      signal: requestTimeout(),
    }),
  ]);
  if (!healthResponse.ok || !configurationResponse.ok) {
    throw new Error("Production Worker health is unavailable.");
  }
  const [health, configuration] = await Promise.all([
    healthResponse.json(),
    configurationResponse.json(),
  ]);
  if (
    health?.data?.service !== "vinifera-api" ||
    health?.data?.status !== "ok" ||
    health?.data?.environment !== "production" ||
    health?.data?.revision !== expectedRevision ||
    configuration?.data?.billing?.configured !== true ||
    configuration?.data?.webhook?.configured !== true
  ) {
    throw new Error(
      "Production Worker live billing and webhook capabilities are not ready.",
    );
  }
}

function assertBoundedInventory(result, label) {
  if (!result || !Array.isArray(result.data) || result.has_more === true) {
    throw new Error(`${label} inventory is unbounded or invalid.`);
  }
  return result.data;
}

function sessionMetadata(policy, authority, targets, subject) {
  return {
    billing_mode: "independent",
    brand_id: subject.id,
    organization_id: subject.organization_id,
    plan_tier: targets.plan,
    vinifera_git_sha: authority.gitSha,
    vinifera_gate: policy.metadata.gate,
    vinifera_proof_nonce: authority.nonce,
    vinifera_proof_version: policy.metadata.proofVersion,
  };
}

function assertOpenSession(
  session,
  policy,
  authority,
  targets,
  subject,
  amountCents,
  now,
) {
  exactMetadata(policy, authority, targets, session?.metadata);
  assertSubjectMetadata(subject, session?.metadata);
  const items = assertBoundedInventory(
    session?.line_items,
    "Stripe Checkout line-item",
  );
  let checkoutUrl;
  try {
    checkoutUrl = new URL(session.url);
  } catch {
    throw new Error("Stripe did not return a valid hosted Checkout URL.");
  }
  if (
    !/^cs_live_[A-Za-z0-9]+$/.test(session.id ?? "") ||
    session.livemode !== true ||
    session.mode !== "subscription" ||
    session.status !== "open" ||
    session.payment_status !== "unpaid" ||
    stripeObjectId(session.customer) !== targets.customerId ||
    session.client_reference_id !== `gate19:${authority.nonce}` ||
    items.length !== 1 ||
    stripeObjectId(items[0]?.price) !== targets.priceId ||
    items[0]?.quantity !== 1 ||
    session.amount_total !== amountCents ||
    session.currency !== policy.currency ||
    !Number.isInteger(session.expires_at) ||
    session.expires_at <= Math.floor(now().getTime() / 1000) ||
    checkoutUrl.protocol !== "https:" ||
    checkoutUrl.hostname !== "checkout.stripe.com" ||
    checkoutUrl.username ||
    checkoutUrl.password
  ) {
    throw new Error(
      "Stripe did not return the exact open hosted live Checkout handoff.",
    );
  }
}

export async function prepareLiveProof({
  applicationStore,
  authority,
  env,
  fetcher = fetch,
  now = () => new Date(),
  policy,
  stripe,
  targets,
}) {
  await verifyWorkerHealth(fetcher, targets.workerOrigin, authority.gitSha);
  const accountHash = assertAccount(policy, await stripe.accounts.retrieve());
  const customer = await stripe.customers.retrieve(targets.customerId);
  assertCustomer(customer, targets.customerId);
  const price = await stripe.prices.retrieve(targets.priceId, {
    expand: ["product"],
  });
  const amountCents = assertPrice(price, targets, policy);
  const subject = await applicationStore.subject(targets);
  if (
    !["not_started", "canceled", "incomplete_expired"].includes(
      subject.subscription_status,
    )
  ) {
    throw new Error(
      "The approved live-proof subject already has an active lifecycle.",
    );
  }
  const subscriptions = assertBoundedInventory(
    await stripe.subscriptions.list({
      customer: targets.customerId,
      limit: 100,
      status: "all",
    }),
    "Stripe subscription",
  );
  if (
    subscriptions.some((subscription) => subscription.status !== "canceled")
  ) {
    throw new Error(
      "The approved customer already has a non-canceled subscription.",
    );
  }
  const gateSessions = assertBoundedInventory(
    await stripe.checkout.sessions.list({
      customer: targets.customerId,
      limit: 100,
    }),
    "Stripe Checkout Session",
  ).filter(
    (session) => session.metadata?.vinifera_gate === policy.metadata.gate,
  );
  const sessions = gateSessions.filter(
    (session) => session.metadata?.vinifera_proof_nonce === authority.nonce,
  );
  const foreignOpenSession = gateSessions.find(
    (session) =>
      session.status === "open" &&
      session.metadata?.vinifera_proof_nonce !== authority.nonce,
  );
  if (foreignOpenSession) {
    throw new Error(
      "Another open Gate 19 Checkout Session already exists for this customer.",
    );
  }
  if (sessions.length > 1) {
    throw new Error(
      "More than one Checkout Session exists for this proof nonce.",
    );
  }
  let session = sessions[0];
  let createdThisRun = false;
  if (!session) {
    const metadata = sessionMetadata(policy, authority, targets, subject);
    const idempotencyKey = `vinifera-gate19-prepare-${sha256(
      `${authority.gitSha}:${authority.nonce}`,
    ).slice(0, 40)}`;
    session = await stripe.checkout.sessions.create(
      {
        cancel_url: `${targets.workerOrigin}/app/billing/cancel`,
        client_reference_id: `gate19:${authority.nonce}`,
        customer: targets.customerId,
        expires_at:
          Math.floor(now().getTime() / 1000) +
          policy.checkoutExpiresAfterSeconds,
        line_items: [{ price: targets.priceId, quantity: 1 }],
        metadata,
        mode: "subscription",
        subscription_data: { metadata },
        success_url: `${targets.workerOrigin}/app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      },
      { idempotencyKey },
    );
    createdThisRun = true;
  }
  session = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items.data.price"],
  });
  assertOpenSession(
    session,
    policy,
    authority,
    targets,
    subject,
    amountCents,
    now,
  );
  return {
    handoff: { checkoutUrl: session.url, sessionId: session.id },
    report: {
      accountIdSha256: accountHash,
      amountCents,
      applicationSubjectSha256: sha256(subject.id),
      checkoutSessionCreatedThisRun: createdThisRun,
      checkoutSessionIdSha256: sha256(session.id),
      checkoutState: "open",
      financialMutationCount: 0,
      generatedAt: now().toISOString(),
      gitSha: authority.gitSha,
      humanHostedPaymentRequired: true,
      operation: "prepare",
      proofNonceSha256: sha256(authority.nonce),
      schemaVersion: 1,
      targetHashes: targets.targetHashes,
      verified: true,
    },
  };
}

function assertSession(session, policy, authority, targets, sessionId) {
  exactMetadata(policy, authority, targets, session.metadata);
  const items = session.line_items?.data ?? [];
  if (
    session.id !== sessionId ||
    session.livemode !== true ||
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    stripeObjectId(session.customer) !== targets.customerId ||
    items.length !== 1 ||
    stripeObjectId(items[0]?.price) !== targets.priceId ||
    items[0]?.quantity !== 1 ||
    !Number.isSafeInteger(session.amount_total) ||
    session.amount_total < 1 ||
    session.amount_total > targets.maximumAmountCents ||
    session.currency !== policy.currency
  ) {
    throw new Error(
      "The completed live Checkout Session is ambiguous or outside policy.",
    );
  }
  return session.amount_total;
}

function eventObject(event) {
  return event?.data?.object;
}

async function exactStripeEvent(stripe, type, subscriptionId, createdAfter) {
  const inventory = assertBoundedInventory(
    await stripe.events.list({
      created: { gte: Math.max(0, createdAfter - 60) },
      limit: 100,
      type,
    }),
    `Stripe ${type} event`,
  ).filter(
    (event) =>
      event.livemode === true && eventObject(event)?.id === subscriptionId,
  );
  if (inventory.length !== 1) {
    throw new Error(
      `Exactly one ${type} event is required for the proof subscription.`,
    );
  }
  return inventory[0];
}

export function stripeSignature(payload, secret, timestamp) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function replayAppliedEvent({
  event,
  fetcher,
  webhookSecret,
  workerOrigin,
}) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = stripeSignature(payload, webhookSecret, timestamp);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetcher(
      new URL("/api/billing/webhook", workerOrigin),
      {
        body: payload,
        headers: {
          "Content-Type": "application/json",
          "Stripe-Signature": signature,
        },
        method: "POST",
        signal: requestTimeout(),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.data?.duplicate !== true) {
      throw new Error("Signed live webhook replay did not remain idempotent.");
    }
  }
}

async function assertApplicationState(
  applicationStore,
  targets,
  subscriptionId,
  plan,
  status,
) {
  const subject = await applicationStore.subject(targets);
  const expectedAccessStatus = status === "active" ? "active" : "suspended";
  if (
    subject.stripe_subscription_id !== subscriptionId ||
    subject.plan_tier !== plan ||
    subject.subscription_status !== status ||
    subject.access_status !== expectedAccessStatus ||
    !subject.stripe_state_updated_at
  ) {
    throw new Error(`Application lifecycle has not converged to ${status}.`);
  }
  return subject;
}

function assertEventLifecycle(eventRow, expectedType, subject, expectedStatus) {
  const object = eventRow?.payload?.data?.object;
  if (
    eventRow.event_type !== expectedType ||
    !object ||
    object.id !== subject.stripe_subscription_id ||
    object.status !== expectedStatus ||
    object.metadata?.organization_id !== subject.organization_id ||
    object.metadata?.brand_id !== subject.id ||
    object.metadata?.billing_mode !== "independent"
  ) {
    throw new Error(
      `The durable ${expectedType} event does not prove the expected application lifecycle.`,
    );
  }
}

function assertSubjectMetadata(subject, metadata) {
  if (
    metadata?.organization_id !== subject.organization_id ||
    metadata?.brand_id !== subject.id ||
    metadata?.billing_mode !== "independent"
  ) {
    throw new Error(
      "Stripe proof metadata does not match the approved application subject.",
    );
  }
}

function assertEventSubject(eventRow, subject) {
  if (
    eventRow.organization_id !== subject.organization_id ||
    eventRow.brand_id !== subject.id
  ) {
    throw new Error(
      "The signed webhook converged to the wrong application subject.",
    );
  }
}

function assertExactCharge(
  charge,
  paymentIntent,
  invoice,
  targets,
  policy,
  amountCents,
  { fullyRefunded = false } = {},
) {
  if (
    !charge ||
    charge.livemode !== true ||
    charge.paid !== true ||
    charge.captured !== true ||
    charge.failure_code != null ||
    stripeObjectId(charge.customer) !== targets.customerId ||
    stripeObjectId(charge.payment_intent) !== paymentIntent.id ||
    stripeObjectId(charge.invoice) !== invoice.id ||
    charge.amount !== amountCents ||
    charge.amount_captured !== amountCents ||
    charge.currency !== policy.currency ||
    charge.refunded !== fullyRefunded ||
    charge.amount_refunded !== (fullyRefunded ? amountCents : 0)
  ) {
    throw new Error(
      fullyRefunded
        ? "The exact proof Charge is not fully refunded."
        : "The proof PaymentIntent does not contain exactly one captured Charge.",
    );
  }
  return charge;
}

function assertExactRefund(refund, authority, policy, amountCents) {
  if (
    refund.livemode !== true ||
    refund.amount !== amountCents ||
    refund.currency !== policy.currency ||
    refund.metadata?.vinifera_proof_nonce !== authority.nonce ||
    refund.metadata?.vinifera_gate !== policy.metadata.gate ||
    refund.metadata?.vinifera_proof_version !== policy.metadata.proofVersion
  ) {
    throw new Error(
      "An existing refund does not match the exact proof contract.",
    );
  }
  return refund;
}

async function refundInventory(stripe, paymentIntentId) {
  const refunds = assertBoundedInventory(
    await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 2 }),
    "Stripe refund",
  );
  if (refunds.length > 1) {
    throw new Error(
      "A second financial mutation already exists for this proof payment.",
    );
  }
  return refunds;
}

async function ensureExactRefund({
  amountCents,
  authority,
  paymentIntent,
  policy,
  sleep,
  stripe,
}) {
  const refunds = await refundInventory(stripe, paymentIntent.id);
  let refund = refunds[0];
  let createdThisRun = false;
  if (refund) {
    assertExactRefund(refund, authority, policy, amountCents);
  } else {
    refund = await stripe.refunds.create(
      {
        amount: amountCents,
        metadata: {
          vinifera_gate: policy.metadata.gate,
          vinifera_proof_nonce: authority.nonce,
          vinifera_proof_version: policy.metadata.proofVersion,
        },
        payment_intent: paymentIntent.id,
        reason: "requested_by_customer",
      },
      {
        idempotencyKey: `vinifera-gate19-refund-${sha256(
          `${authority.gitSha}:${authority.nonce}:${paymentIntent.id}`,
        ).slice(0, 40)}`,
      },
    );
    createdThisRun = true;
  }
  refund = await poll(
    async () => {
      const current = await stripe.refunds.retrieve(refund.id);
      assertExactRefund(current, authority, policy, amountCents);
      if (current.status !== "succeeded") {
        throw new Error(
          "The exact proof refund has not reconciled successfully.",
        );
      }
      return current;
    },
    policy,
    sleep,
  );
  return { createdThisRun, refund };
}

async function ensureSubscriptionCanceled(stripe, subscription) {
  if (subscription.status === "canceled") {
    return { cleanupPerformed: false, subscription };
  }
  const canceled = await stripe.subscriptions.cancel(subscription.id, {
    invoice_now: false,
    prorate: false,
  });
  if (canceled.status !== "canceled") {
    throw new Error("The proof subscription cleanup did not cancel renewal.");
  }
  return { cleanupPerformed: true, subscription: canceled };
}

function attachRecoveryEvidence(error, recovery) {
  if (error && typeof error === "object") {
    Object.defineProperty(error, "gate19Recovery", {
      configurable: true,
      enumerable: false,
      value: recovery,
    });
  }
}

export async function finalizeLiveProof({
  applicationStore,
  authority,
  env,
  fetcher = fetch,
  now = () => new Date(),
  policy,
  sessionId,
  sleep = (milliseconds) =>
    new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  stripe,
  targets,
}) {
  if (!/^cs_live_[A-Za-z0-9]+$/.test(sessionId ?? "")) {
    throw new Error(
      "A valid live Checkout Session ID is required for finalize.",
    );
  }
  await verifyWorkerHealth(fetcher, targets.workerOrigin, authority.gitSha);
  const accountHash = assertAccount(policy, await stripe.accounts.retrieve());
  assertCustomer(
    await stripe.customers.retrieve(targets.customerId),
    targets.customerId,
  );
  const priceAmountCents = assertPrice(
    await stripe.prices.retrieve(targets.priceId, { expand: ["product"] }),
    targets,
    policy,
  );
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price", "subscription.latest_invoice"],
  });
  const amountCents = assertSession(
    session,
    policy,
    authority,
    targets,
    sessionId,
  );
  if (amountCents !== priceAmountCents) {
    throw new Error(
      "The completed live Checkout amount does not equal the reviewed Price.",
    );
  }
  let subscription = session.subscription;
  if (typeof subscription === "string") {
    subscription = await stripe.subscriptions.retrieve(subscription, {
      expand: ["latest_invoice"],
    });
  }
  if (!subscription || typeof subscription !== "object") {
    throw new Error("The proof subscription was not expanded or retrievable.");
  }
  exactMetadata(policy, authority, targets, subscription.metadata);
  if (
    subscription.livemode !== true ||
    stripeObjectId(subscription.customer) !== targets.customerId ||
    !["active", "canceled"].includes(subscription.status)
  ) {
    throw new Error(
      "The proof subscription is not the expected live lifecycle object.",
    );
  }

  let paymentIntent;
  let proofCompleted = false;
  let refundRecoveryEligible = false;
  let failure;
  try {
    let invoice = subscription.latest_invoice;
    if (typeof invoice === "string") {
      invoice = await stripe.invoices.retrieve(invoice);
    }
    if (
      !invoice ||
      typeof invoice !== "object" ||
      !invoice.id ||
      invoice.livemode !== true ||
      invoice.status !== "paid" ||
      stripeObjectId(invoice.customer) !== targets.customerId ||
      stripeObjectId(
        invoice.parent?.subscription_details?.subscription ??
          invoice.subscription,
      ) !== subscription.id
    ) {
      throw new Error(
        "The proof subscription has no unambiguous paid initial invoice.",
      );
    }
    const invoicePayments = assertBoundedInventory(
      await stripe.invoicePayments.list({
        expand: ["data.payment.payment_intent"],
        invoice: invoice.id,
        limit: 100,
        status: "paid",
      }),
      "Stripe Invoice Payment",
    ).filter(
      (candidate) =>
        candidate.livemode === true &&
        candidate.status === "paid" &&
        candidate.payment?.type === "payment_intent" &&
        candidate.amount_paid === amountCents,
    );
    if (invoicePayments.length !== 1) {
      throw new Error(
        "The proof invoice does not have exactly one paid live Invoice Payment.",
      );
    }
    paymentIntent = invoicePayments[0].payment.payment_intent;
    if (typeof paymentIntent === "string") {
      paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
    }
    if (
      !paymentIntent ||
      typeof paymentIntent !== "object" ||
      paymentIntent.livemode !== true ||
      paymentIntent.status !== "succeeded" ||
      stripeObjectId(paymentIntent.customer) !== targets.customerId ||
      paymentIntent.amount_received !== amountCents ||
      paymentIntent.currency !== policy.currency
    ) {
      throw new Error(
        "The proof PaymentIntent is ambiguous, unpaid, or over policy.",
      );
    }
    const succeededPayments = assertBoundedInventory(
      await stripe.paymentIntents.list({
        customer: targets.customerId,
        limit: 100,
      }),
      "Stripe PaymentIntent",
    ).filter(
      (candidate) =>
        candidate.status === "succeeded" &&
        candidate.created >= session.created - 60,
    );
    if (
      succeededPayments.length !== 1 ||
      succeededPayments[0].id !== paymentIntent.id
    ) {
      throw new Error(
        "The live-proof customer has more than one proof-window payment.",
      );
    }
    const existingRefunds = await refundInventory(stripe, paymentIntent.id);
    if (existingRefunds[0]) {
      assertExactRefund(existingRefunds[0], authority, policy, amountCents);
    }
    const chargeAttempts = assertBoundedInventory(
      await stripe.charges.list({
        payment_intent: paymentIntent.id,
        limit: 100,
      }),
      "Stripe Charge",
    );
    const charges = chargeAttempts.filter(
      (candidate) =>
        candidate.livemode === true &&
        candidate.paid === true &&
        candidate.captured === true &&
        candidate.failure_code == null,
    );
    if (charges.length !== 1) {
      throw new Error(
        "The proof PaymentIntent does not contain exactly one successful captured Charge.",
      );
    }
    const charge = assertExactCharge(
      charges[0],
      paymentIntent,
      invoice,
      targets,
      policy,
      amountCents,
      { fullyRefunded: existingRefunds.length === 1 },
    );
    refundRecoveryEligible = true;
    if (subscription.status === "canceled" && !existingRefunds[0]) {
      throw new Error(
        "A canceled proof subscription lacks the exact prior refund required for recovery.",
      );
    }
    const recoveryMode =
      subscription.status === "canceled" || existingRefunds.length === 1;
    const preRefundStatus =
      subscription.status === "canceled" ? "canceled" : "active";
    const preRefundSubject = await poll(
      () =>
        assertApplicationState(
          applicationStore,
          targets,
          subscription.id,
          targets.plan,
          preRefundStatus,
        ),
      policy,
      sleep,
    );
    assertSubjectMetadata(preRefundSubject, session.metadata);
    assertSubjectMetadata(preRefundSubject, subscription.metadata);
    const createdEvent = await poll(
      () =>
        exactStripeEvent(
          stripe,
          "customer.subscription.created",
          subscription.id,
          session.created,
        ),
      policy,
      sleep,
    );
    const appliedCreatedEvent = await poll(
      () =>
        applicationStore.event(
          createdEvent.id,
          preRefundSubject,
          "customer.subscription.created",
        ),
      policy,
      sleep,
    );
    assertEventSubject(appliedCreatedEvent, preRefundSubject);
    assertEventLifecycle(
      appliedCreatedEvent,
      "customer.subscription.created",
      preRefundSubject,
      "active",
    );
    const webhookSecret = assertLiveSecret(
      env.PRODUCTION_STRIPE_LIVE_WEBHOOK_SECRET,
      "whsec_",
      "live webhook secret",
    );
    await replayAppliedEvent({
      event: createdEvent,
      fetcher,
      webhookSecret,
      workerOrigin: targets.workerOrigin,
    });

    const refundResult = await ensureExactRefund({
      amountCents,
      authority,
      paymentIntent,
      policy,
      sleep,
      stripe,
    });
    const refund = refundResult.refund;
    const cleanup = await ensureSubscriptionCanceled(stripe, subscription);
    subscription = cleanup.subscription;
    const canceledSubject = await poll(
      () =>
        assertApplicationState(
          applicationStore,
          targets,
          subscription.id,
          targets.plan,
          "canceled",
        ),
      policy,
      sleep,
    );
    const deletedEvent = await poll(
      () =>
        exactStripeEvent(
          stripe,
          "customer.subscription.deleted",
          subscription.id,
          session.created,
        ),
      policy,
      sleep,
    );
    const appliedDeletedEvent = await poll(
      () =>
        applicationStore.event(
          deletedEvent.id,
          canceledSubject,
          "customer.subscription.deleted",
        ),
      policy,
      sleep,
    );
    assertEventSubject(appliedDeletedEvent, canceledSubject);
    assertEventLifecycle(
      appliedDeletedEvent,
      "customer.subscription.deleted",
      canceledSubject,
      "canceled",
    );
    await replayAppliedEvent({
      event: deletedEvent,
      fetcher,
      webhookSecret,
      workerOrigin: targets.workerOrigin,
    });
    const finalRefunds = await refundInventory(stripe, paymentIntent.id);
    if (finalRefunds.length !== 1 || finalRefunds[0].id !== refund.id) {
      throw new Error(
        "Final reconciliation did not retain exactly one full refund.",
      );
    }
    assertExactRefund(finalRefunds[0], authority, policy, amountCents);
    const finalCharge = assertExactCharge(
      await stripe.charges.retrieve(charge.id),
      paymentIntent,
      invoice,
      targets,
      policy,
      amountCents,
      { fullyRefunded: true },
    );
    proofCompleted = true;
    return {
      accountIdSha256: accountHash,
      activeApplicationProven: true,
      amountCents,
      applicationActivationEvidenceSha256: sha256(
        `${appliedCreatedEvent.id}:${eventObject(appliedCreatedEvent.payload)?.status}:${appliedCreatedEvent.processed_at}`,
      ),
      applicationCanceledStateSha256: sha256(
        `${canceledSubject.id}:canceled:${canceledSubject.stripe_state_updated_at}`,
      ),
      bindingReversionRequested:
        env.STRIPE_LIVE_PROOF_REQUEST_BINDING_REVERSION === "true",
      chargeCount: charges.length,
      chargeFullyRefunded:
        finalCharge.refunded === true &&
        finalCharge.amount_refunded === amountCents,
      chargeIdSha256: sha256(finalCharge.id),
      checkoutSessionIdSha256: sha256(session.id),
      cleanupPerformed: cleanup.cleanupPerformed,
      completedAt: now().toISOString(),
      createdWebhookEventIdSha256: sha256(createdEvent.id),
      deletedWebhookEventIdSha256: sha256(deletedEvent.id),
      financialMutationCount: charges.length + finalRefunds.length,
      finalApplicationState: "canceled",
      finalSubscriptionState: "canceled",
      gitSha: authority.gitSha,
      operation: "finalize",
      paymentIntentIdSha256: sha256(paymentIntent.id),
      proofNonceSha256: sha256(authority.nonce),
      recoveryMode,
      refundCount: finalRefunds.length,
      refundCreatedThisRun: refundResult.createdThisRun,
      refundIdSha256: sha256(refund.id),
      refundState: "succeeded",
      schemaVersion: 1,
      signedWebhookReplayCount: 4,
      subscriptionIdSha256: sha256(subscription.id),
      targetHashes: targets.targetHashes,
      verified: true,
    };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!proofCompleted) {
      const recovery = {
        cancellationAttempted: true,
        refundAttempted: refundRecoveryEligible,
        refundSucceeded: false,
        subscriptionCanceled: false,
      };
      const recoveryErrors = [];
      if (refundRecoveryEligible) {
        try {
          await ensureExactRefund({
            amountCents,
            authority,
            paymentIntent,
            policy,
            sleep,
            stripe,
          });
          recovery.refundSucceeded = true;
        } catch (error) {
          recoveryErrors.push(error);
        }
      }
      try {
        const cleanup = await ensureSubscriptionCanceled(stripe, subscription);
        subscription = cleanup.subscription;
        recovery.subscriptionCanceled = subscription.status === "canceled";
      } catch (error) {
        recoveryErrors.push(error);
      }
      attachRecoveryEvidence(failure, recovery);
      if (recoveryErrors.length > 0) {
        const aggregate = new AggregateError(
          failure ? [failure, ...recoveryErrors] : recoveryErrors,
          "Gate 19 failed and its financial recovery did not fully reconcile.",
        );
        attachRecoveryEvidence(aggregate, recovery);
        throw aggregate;
      }
    }
  }
}

async function writeJson(path, value, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode,
  });
}

async function main(arguments_, env = process.env) {
  const [operation, ...rest] = arguments_;
  const option = (name) => {
    const index = rest.indexOf(name);
    return index === -1 ? null : rest[index + 1];
  };
  if (!OPERATIONS.has(operation)) {
    throw new Error(
      "Usage: stripe-live-proof.mjs <prepare|finalize> --report <path> [--handoff <path>] [--session-id <cs_live_...>].",
    );
  }
  const reportPath = required(option("--report"), "sanitized report path");
  const handoffPath = option("--handoff");
  const sessionId = option("--session-id");
  try {
    const policy = validateLiveProofPolicy(
      JSON.parse(await readFile(POLICY_PATH, "utf8")),
      { ready: true },
    );
    const authority = assertLiveProofAuthority(policy, operation, env);
    const targets = assertLiveProofTargets(policy, env);
    const secretKey = assertLiveSecret(
      env.PRODUCTION_STRIPE_LIVE_SECRET_KEY,
      "sk_live_",
      "live Stripe secret key",
    );
    const serviceRoleKey = required(
      env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY,
      "production Supabase service role",
    );
    const applicationStore = createApplicationStore({
      fetcher: fetch,
      serviceRoleKey,
      supabaseUrl: targets.supabaseOrigin,
    });
    const stripe = new Stripe(secretKey, {
      apiVersion: policy.apiVersion,
      maxNetworkRetries: 0,
      timeout: 15000,
    });
    if (operation === "prepare") {
      if (!handoffPath) throw new Error("A private handoff path is required.");
      const result = await prepareLiveProof({
        applicationStore,
        authority,
        env,
        policy,
        stripe,
        targets,
      });
      await writeJson(reportPath, result.report, 0o644);
      await writeJson(handoffPath, result.handoff);
    } else {
      const report = await finalizeLiveProof({
        applicationStore,
        authority,
        env,
        policy,
        sessionId,
        stripe,
        targets,
      });
      await writeJson(reportPath, report, 0o644);
    }
  } catch (error) {
    await writeJson(
      reportPath,
      {
        errorCode: "stripe_live_proof_failed",
        operation,
        recovery: error?.gate19Recovery ?? {
          cancellationAttempted: false,
          refundAttempted: false,
          refundSucceeded: false,
          subscriptionCanceled: false,
        },
        schemaVersion: 1,
        verified: false,
      },
      0o644,
    );
    throw error;
  }
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Stripe live proof failed.",
    );
    process.exitCode = 1;
  });
}
