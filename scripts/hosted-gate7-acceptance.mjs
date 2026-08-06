import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const STRIPE_API_VERSION = "2026-02-25.clover";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function splitSetCookieHeader(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/u).map((item) => item.trim());
}

export function setCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  return splitSetCookieHeader(response.headers.get("set-cookie"));
}

export function mergeCookieJar(jar, response) {
  for (const setCookie of setCookieHeaders(response)) {
    const pair = setCookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) {
      jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

export function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function plusAddress(base, tag) {
  const match = /^([^@+]+)(?:\+[^@]*)?@([^@]+)$/u.exec(base.trim().toLowerCase());
  if (!match) throw new Error("HOSTED_ACCEPTANCE_EMAIL_BASE must be an email address.");
  return `${match[1]}+${tag}@${match[2]}`;
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function expectStatus(result, expected, label) {
  if (result.response.status !== expected) {
    throw new Error(
      `${label}: expected HTTP ${expected}, received ${result.response.status}.`,
    );
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function accessHeaders(clientId, clientSecret) {
  return {
    "CF-Access-Client-Id": clientId,
    "CF-Access-Client-Secret": clientSecret,
  };
}

function hostedClient(url, key, headers) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers },
  });
}

async function findAuthUser(admin, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 100) return null;
  }
  throw new Error("Hosted Auth user scan exceeded 2,000 users.");
}

function stripeEvent({ created, customerId, eventId, organizationId, status, subscriptionId }) {
  return {
    api_version: STRIPE_API_VERSION,
    created,
    data: {
      object: {
        customer: customerId,
        id: subscriptionId,
        metadata: {
          billing_mode: "shared",
          organization_id: organizationId,
          plan_tier: "vine",
        },
        object: "subscription",
        status,
      },
    },
    id: eventId,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: "customer.subscription.updated",
  };
}

async function main() {
  const origin = new URL(required("STAGING_WORKER_ORIGIN"));
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    !/^vinifera-staging\.[a-z0-9-]+\.workers\.dev$/u.test(origin.hostname)
  ) {
    throw new Error("STAGING_WORKER_ORIGIN must be the isolated staging workers.dev origin.");
  }

  const outputIndex = process.argv.indexOf("--output");
  const outputPath =
    outputIndex >= 0 && process.argv[outputIndex + 1]
      ? resolve(process.argv[outputIndex + 1])
      : resolve("hosted-gate7-acceptance.json");
  const access = accessHeaders(
    required("CF_ACCESS_CLIENT_ID"),
    required("CF_ACCESS_CLIENT_SECRET"),
  );
  const supabaseUrl = required("SUPABASE_URL");
  const publicKey = required("SUPABASE_ANON_KEY");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecret = required("STRIPE_SECRET_KEY");
  const stripeWebhookSecret = required("STRIPE_WEBHOOK_SECRET");
  const priceId = required("STRIPE_PRICE_VINE");
  const suffix = `${process.env.GITHUB_RUN_ID ?? "local"}${randomBytes(4).toString("hex")}`;
  const password = `${randomBytes(18).toString("base64url")}Aa1!`;
  const emailBase = required("HOSTED_ACCEPTANCE_EMAIL_BASE");
  const accounts = {
    a: {
      memberEmail: plusAddress(emailBase, `vinifera-g7-${suffix}-member-a`),
      organizationName: `Vinifera Gate 7 A ${suffix}`,
      ownerEmail: plusAddress(emailBase, `vinifera-g7-${suffix}-owner-a`),
    },
    b: {
      memberEmail: plusAddress(emailBase, `vinifera-g7-${suffix}-member-b`),
      organizationName: `Vinifera Gate 7 B ${suffix}`,
      ownerEmail: plusAddress(emailBase, `vinifera-g7-${suffix}-owner-b`),
    },
  };
  const admin = hostedClient(supabaseUrl, serviceKey, access);
  const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION });
  const created = { authUserIds: [], checkoutSessionId: null, organizationIds: [], stripeCustomerIds: [] };
  const evidence = {
    checks: {},
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    success: false,
    targetClass: "isolated-staging-workers-dev",
  };

  async function request(path, init = {}, jar = null) {
    const headers = {
      origin: origin.origin,
      ...init.headers,
    };
    if (jar?.size) headers.cookie = cookieHeader(jar);
    const response = await fetch(new URL(path, origin), { ...init, headers });
    if (jar) mergeCookieJar(jar, response);
    return { body: await responseBody(response), response };
  }

  async function signup(account, label) {
    const result = await request("/api/auth/staff/signup", {
      body: JSON.stringify({
        email: account.ownerEmail,
        fullName: `Gate Seven Owner ${label}`,
        organizationName: account.organizationName,
        password,
        planTier: "vine",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expectStatus(result, 201, `tenant ${label} signup`);
    const user = await findAuthUser(admin, account.ownerEmail);
    expect(user, `Tenant ${label} owner was not created in Auth.`);
    created.authUserIds.push(user.id);
    const { error: confirmError } = await admin.auth.admin.updateUserById(user.id, {
      email_confirm: true,
      password,
    });
    if (confirmError) throw confirmError;
    const { data: staff, error: staffError } = await admin
      .from("staff_users")
      .select("organization_id")
      .eq("id", user.id)
      .single();
    if (staffError) throw staffError;
    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .select("id,default_brand_id,stripe_customer_id")
      .eq("id", staff.organization_id)
      .single();
    if (organizationError) throw organizationError;
    expect(organization.default_brand_id, `Tenant ${label} has no default brand.`);
    expect(organization.stripe_customer_id, `Tenant ${label} has no Stripe test customer.`);
    created.organizationIds.push(organization.id);
    created.stripeCustomerIds.push(organization.stripe_customer_id);
    return { ...account, brandId: organization.default_brand_id, organizationId: organization.id, ownerUserId: user.id };
  }

  async function login(account, label) {
    const jar = new Map();
    const result = await request(
      "/api/auth/staff/login",
      {
        body: JSON.stringify({ email: account.ownerEmail, password }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      jar,
    );
    expectStatus(result, 200, `tenant ${label} login`);
    expect(jar.has("vinifera-staff-auth"), `Tenant ${label} login omitted the staff cookie.`);
    return jar;
  }

  async function createMember(account, label) {
    const { data: auth, error: authError } = await admin.auth.admin.createUser({
      email: account.memberEmail,
      email_confirm: true,
      password,
      user_metadata: { auth_surface: "member", hosted_acceptance: true },
    });
    if (authError || !auth.user) throw authError ?? new Error(`Tenant ${label} member Auth failed.`);
    created.authUserIds.push(auth.user.id);
    const { data: member, error: memberError } = await admin
      .from("members")
      .insert({
        auth_user_id: auth.user.id,
        brand_id: account.brandId,
        email: account.memberEmail,
        first_name: "Hosted",
        last_name: `Member ${label}`,
        organization_id: account.organizationId,
        status: "active",
      })
      .select("id")
      .single();
    if (memberError) throw memberError;
    return { ...account, memberId: member.id, memberUserId: auth.user.id };
  }

  async function nativeRows(email, table) {
    const client = hostedClient(supabaseUrl, publicKey, access);
    const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password });
    if (authError || !auth.session) throw authError ?? new Error("Native Auth returned no session.");
    const { data, error } = await client.from(table).select("id,organization_id");
    if (error) throw error;
    return data ?? [];
  }

  async function deliver(event) {
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: stripeWebhookSecret });
    return request("/api/billing/webhook", {
      body: payload,
      headers: { "content-type": "application/json", "stripe-signature": signature },
      method: "POST",
    });
  }

  try {
    const health = await request("/api/health");
    expectStatus(health, 200, "Worker health");
    expect(health.body?.data?.environment === "staging", "Worker is not staging.");
    const configuration = await request("/api/health/configuration");
    expectStatus(configuration, 200, "Worker configuration");
    expect(configuration.body?.data?.email?.configured === true, "Auth email is not activated.");
    evidence.checks.runtime = true;

    let tenantA = await signup(accounts.a, "A");
    let tenantB = await signup(accounts.b, "B");
    const jarA = await login(tenantA, "A");
    const jarB = await login(tenantB, "B");
    tenantA = await createMember(tenantA, "A");
    tenantB = await createMember(tenantB, "B");
    evidence.checks.staffAuth = true;

    const membersA = await request("/api/members?limit=100", {
      headers: { "x-vinifera-brand-id": tenantA.brandId },
    }, jarA);
    expectStatus(membersA, 200, "tenant A member list");
    const idsA = membersA.body?.data?.items?.map((member) => member.id) ?? [];
    expect(idsA.includes(tenantA.memberId), "Tenant A cannot see its own member.");
    expect(!idsA.includes(tenantB.memberId), "Tenant A received Tenant B member data.");
    const crossA = await request("/api/members", {
      headers: { "x-vinifera-brand-id": tenantB.brandId },
    }, jarA);
    const crossB = await request("/api/members", {
      headers: { "x-vinifera-brand-id": tenantA.brandId },
    }, jarB);
    expectStatus(crossA, 403, "tenant A cross-brand denial");
    expectStatus(crossB, 403, "tenant B cross-brand denial");

    const [staffRowsA, staffRowsB, memberRowsA] = await Promise.all([
      nativeRows(tenantA.ownerEmail, "members"),
      nativeRows(tenantB.ownerEmail, "members"),
      nativeRows(tenantA.memberEmail, "members"),
    ]);
    expect(staffRowsA.some((row) => row.id === tenantA.memberId), "Staff A native RLS omitted its member.");
    expect(staffRowsA.every((row) => row.organization_id === tenantA.organizationId), "Staff A native RLS leaked another tenant.");
    expect(staffRowsB.some((row) => row.id === tenantB.memberId), "Staff B native RLS omitted its member.");
    expect(staffRowsB.every((row) => row.organization_id === tenantB.organizationId), "Staff B native RLS leaked another tenant.");
    expect(memberRowsA.length === 1 && memberRowsA[0].id === tenantA.memberId, "Member native RLS did not isolate the member.");
    evidence.checks.twoTenantRls = true;

    const memberJar = new Map();
    const magicRequest = await request(
      "/api/auth/member/magic-link",
      {
        body: JSON.stringify({ brandId: tenantA.brandId, email: tenantA.memberEmail }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      memberJar,
    );
    expectStatus(magicRequest, 200, "member magic-link request");
    const linkState = memberJar.get("vinifera-member-auth-link");
    expect(linkState, "Member magic-link request omitted its state cookie.");
    const callback = new URL("/api/auth/member/callback", origin);
    callback.searchParams.set("state", linkState);
    const { data: generated, error: generateError } = await admin.auth.admin.generateLink({
      email: tenantA.memberEmail,
      options: { redirectTo: callback.toString() },
      type: "magiclink",
    });
    if (generateError || !generated.properties?.action_link) {
      throw generateError ?? new Error("Supabase did not generate a member action link.");
    }
    const verifyResponse = await fetch(generated.properties.action_link, {
      headers: access,
      redirect: "manual",
    });
    expect([302, 303].includes(verifyResponse.status), "Supabase magic link did not redirect.");
    const callbackLocation = verifyResponse.headers.get("location");
    expect(callbackLocation, "Supabase magic link omitted its callback location.");
    const callbackResult = await request(new URL(callbackLocation).toString(), { redirect: "manual" }, memberJar);
    expectStatus(callbackResult, 303, "member magic-link callback");
    expect(memberJar.has("vinifera-member-auth"), "Member callback omitted its Auth cookie.");
    const memberSession = await request("/api/auth/member/session", {}, memberJar);
    expectStatus(memberSession, 200, "member cookie session");
    expect(memberSession.body?.data?.user?.id === tenantA.memberId, "Member callback resolved the wrong tenant member.");
    evidence.checks.memberMagicLink = true;

    const checkout = await request(
      "/api/billing/checkout",
      {
        body: JSON.stringify({ attemptId: randomUUID(), planTier: "vine" }),
        headers: { "content-type": "application/json", "x-vinifera-brand-id": tenantA.brandId },
        method: "POST",
      },
      jarA,
    );
    expectStatus(checkout, 200, "Stripe test Checkout");
    const checkoutUrl = new URL(checkout.body?.data?.url);
    expect(checkoutUrl.hostname.endsWith("stripe.com"), "Checkout did not return a Stripe URL.");
    const sessionMatch = /\/(cs_test_[A-Za-z0-9_]+)$/u.exec(checkoutUrl.pathname);
    if (sessionMatch) created.checkoutSessionId = sessionMatch[1];
    evidence.checks.checkout = true;

    const { data: billingOrg, error: billingError } = await admin
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", tenantA.organizationId)
      .single();
    if (billingError || !billingOrg.stripe_customer_id) throw billingError ?? new Error("Stripe customer is missing.");
    const baseCreated = Math.floor(Date.now() / 1000);
    const subscriptionId = `sub_gate7${suffix}`;
    const activeEvent = stripeEvent({
      created: baseCreated,
      customerId: billingOrg.stripe_customer_id,
      eventId: `evt_gate7${suffix}active`,
      organizationId: tenantA.organizationId,
      status: "active",
      subscriptionId,
    });
    const firstActive = await deliver(activeEvent);
    expectStatus(firstActive, 200, "signed active subscription webhook");
    const duplicateActive = await deliver(activeEvent);
    expectStatus(duplicateActive, 200, "duplicate subscription webhook");
    expect(duplicateActive.body?.data?.duplicate === true, "Duplicate webhook was not identified.");
    const forged = await request("/api/billing/webhook", {
      body: JSON.stringify(activeEvent),
      headers: { "content-type": "application/json", "stripe-signature": "forged" },
      method: "POST",
    });
    expectStatus(forged, 400, "forged webhook denial");

    const pastDueEvent = stripeEvent({
      created: baseCreated + 1,
      customerId: billingOrg.stripe_customer_id,
      eventId: `evt_gate7${suffix}pastdue`,
      organizationId: tenantA.organizationId,
      status: "past_due",
      subscriptionId,
    });
    expectStatus(await deliver(pastDueEvent), 200, "signed past-due webhook");
    const { data: grace, error: graceError } = await admin
      .from("organizations")
      .select("access_status,grace_period_ends_at,suspension_at")
      .eq("id", tenantA.organizationId)
      .single();
    if (graceError) throw graceError;
    expect(grace.access_status === "grace", "Past-due webhook did not begin grace access.");
    expect(grace.grace_period_ends_at && grace.suspension_at, "Grace lifecycle timestamps are missing.");
    const restrictedAt = new Date(new Date(grace.grace_period_ends_at).getTime() + 1_000).toISOString();
    const suspendedAt = new Date(new Date(grace.suspension_at).getTime() + 1_000).toISOString();
    const { error: restrictError } = await admin.rpc("reconcile_subscription_access", { p_as_of: restrictedAt });
    if (restrictError) throw restrictError;
    const { data: restricted, error: restrictedError } = await admin
      .from("organizations")
      .select("access_status")
      .eq("id", tenantA.organizationId)
      .single();
    if (restrictedError) throw restrictedError;
    expect(restricted.access_status === "restricted", "Day-eight reconciliation did not restrict access.");
    const { error: suspendError } = await admin.rpc("reconcile_subscription_access", { p_as_of: suspendedAt });
    if (suspendError) throw suspendError;
    const { data: suspended, error: suspendedError } = await admin
      .from("organizations")
      .select("access_status")
      .eq("id", tenantA.organizationId)
      .single();
    if (suspendedError) throw suspendedError;
    expect(suspended.access_status === "suspended", "Day-fifteen reconciliation did not suspend access.");

    const recoveredEvent = stripeEvent({
      created: baseCreated + 2,
      customerId: billingOrg.stripe_customer_id,
      eventId: `evt_gate7${suffix}recovered`,
      organizationId: tenantA.organizationId,
      status: "active",
      subscriptionId,
    });
    expectStatus(await deliver(recoveredEvent), 200, "signed recovery webhook");
    const { data: recovered, error: recoveredError } = await admin
      .from("organizations")
      .select("access_status,grace_period_ends_at,suspended_at")
      .eq("id", tenantA.organizationId)
      .single();
    if (recoveredError) throw recoveredError;
    expect(recovered.access_status === "active", "Recovery webhook did not restore active access.");
    expect(!recovered.grace_period_ends_at && !recovered.suspended_at, "Recovery left stale access timestamps.");
    evidence.checks.webhookLifecycle = true;
    evidence.success = true;
  } catch (error) {
    evidence.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    const cleanupErrors = [];
    if (created.checkoutSessionId) {
      try {
        await stripe.checkout.sessions.expire(created.checkoutSessionId);
      } catch (error) {
        cleanupErrors.push(`checkout:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const customerId of created.stripeCustomerIds) {
      try {
        await stripe.customers.del(customerId);
      } catch (error) {
        cleanupErrors.push(`customer:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (created.organizationIds.length) {
      const { error } = await admin.from("organizations").delete().in("id", created.organizationIds);
      if (error) cleanupErrors.push(`organizations:${error.message}`);
    }
    for (const userId of created.authUserIds) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) cleanupErrors.push(`auth:${error.message}`);
    }
    evidence.cleanup = { attempted: true, passed: cleanupErrors.length === 0 };
    if (cleanupErrors.length) evidence.cleanup.failureCount = cleanupErrors.length;
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
