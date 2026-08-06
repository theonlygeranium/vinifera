import {
  constants,
  createDecipheriv,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";
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
    return response.headers.getSetCookie().flatMap(splitSetCookieHeader);
  }
  return splitSetCookieHeader(response.headers.get("set-cookie"));
}

export function mergeCookieJar(jar, response) {
  for (const setCookie of setCookieHeaders(response)) {
    const parts = setCookie.split(";");
    const pair = parts[0];
    const separator = pair.indexOf("=");
    if (separator > 0) {
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const deleted = parts.slice(1).some((rawAttribute) => {
        const attribute = rawAttribute.trim();
        const maxAge = /^max-age\s*=\s*(-?\d+)$/iu.exec(attribute);
        if (maxAge) return Number(maxAge[1]) <= 0;
        const expires = /^expires\s*=\s*(.+)$/iu.exec(attribute);
        return expires ? Date.parse(expires[1]) <= Date.now() : false;
      });
      if (deleted) jar.delete(name);
      else jar.set(name, value);
    }
  }
}

export function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function hasCookieFamily(jar, baseName) {
  return [...jar.entries()].some(
    ([name, value]) =>
      Boolean(value) &&
      (name === baseName ||
        (name.startsWith(`${baseName}.`) &&
          /^\d+$/u.test(name.slice(baseName.length + 1)))),
  );
}

export function plusAddress(base, tag) {
  const match = /^([^@+]+)(?:\+[^@]*)?@([^@]+)$/u.exec(base.trim().toLowerCase());
  if (!match) throw new Error("HOSTED_ACCEPTANCE_EMAIL_BASE must be an email address.");
  return `${match[1]}+${tag}@${match[2]}`;
}

export function validateMagicActionLink(rawLink, { callback, state, supabaseUrl }) {
  const link = new URL(rawLink);
  const expectedSupabase = new URL(supabaseUrl);
  const redirect = new URL(link.searchParams.get("redirect_to") ?? "");
  const expectedCallback = new URL(callback);
  if (
    link.origin !== expectedSupabase.origin ||
    link.pathname !== `${expectedSupabase.pathname.replace(/\/$/u, "")}/auth/v1/verify` ||
    link.searchParams.get("type") !== "magiclink" ||
    redirect.origin !== expectedCallback.origin ||
    redirect.pathname !== expectedCallback.pathname ||
    redirect.searchParams.get("state") !== state
  ) {
    throw new Error("The supplied magic link does not match this Gate 7 PKCE request.");
  }
  return link;
}

export function decryptMagicLinkEnvelope(envelope, privateKey, handoffId) {
  const parsed = JSON.parse(envelope);
  if (
    parsed.handoffId !== handoffId ||
    ![parsed.ciphertext, parsed.encryptedKey, parsed.iv, parsed.tag].every(
      (value) => typeof value === "string",
    )
  ) {
    throw new Error("The magic-link handoff envelope does not match this run.");
  }
  const key = privateDecrypt(
    {
      key: privateKey,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    Buffer.from(parsed.encryptedKey, "base64"),
  );
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
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

export function expectStatus(result, expected, label) {
  if (result.response.status !== expected) {
    const errorCode = result.body?.error?.code;
    const errorMessage = result.body?.error?.message;
    const detail =
      typeof errorCode === "string" && typeof errorMessage === "string"
        ? ` ${errorCode}: ${errorMessage}`
        : "";
    throw new Error(
      `${label}: expected HTTP ${expected}, received ${result.response.status}.${detail}`,
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
  const eventSuffix = `${process.env.GITHUB_RUN_ID ?? "local"}${randomBytes(4).toString("hex")}`;
  const password = `${randomBytes(18).toString("base64url")}Aa1!`;
  const emailBase = required("HOSTED_ACCEPTANCE_EMAIL_BASE");
  const accounts = {
    a: {
      memberEmail: plusAddress(emailBase, "vinifera-g7-member-a"),
      organizationName: "Vinifera Hosted Gate 7 A",
      ownerEmail: plusAddress(emailBase, "vinifera-g7-owner-a"),
    },
    b: {
      memberEmail: plusAddress(emailBase, "vinifera-g7-member-b"),
      organizationName: "Vinifera Hosted Gate 7 B",
      ownerEmail: plusAddress(emailBase, "vinifera-g7-owner-b"),
    },
  };
  const admin = hostedClient(supabaseUrl, serviceKey, access);
  const stripe = new Stripe(stripeSecret, { apiVersion: STRIPE_API_VERSION });
  const runtime = { checkoutSessionId: null, fixtureOrganizationId: null };
  const evidence = {
    checks: {},
    generatedAt: new Date().toISOString(),
    fixtureMode: "reusable-dedicated-staging",
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

  async function ensureTenant(account, label) {
    let user = await findAuthUser(admin, account.ownerEmail);
    if (!user) {
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
      user = await findAuthUser(admin, account.ownerEmail);
    }
    expect(user, `Tenant ${label} owner was not created in Auth.`);
    const { error: confirmError } = await admin.auth.admin.updateUserById(user.id, {
      email_confirm: true,
      password,
      user_metadata: { auth_surface: "staff", hosted_acceptance: true },
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
    expect(
      hasCookieFamily(jar, "vinifera-staff-auth"),
      `Tenant ${label} login omitted the staff cookie.`,
    );
    return jar;
  }

  async function verifyStaffSessionJar(jar, label) {
    const direct = createServerClient(supabaseUrl, publicKey, {
      auth: { flowType: "pkce" },
      global: { headers: access },
      cookieOptions: { name: "vinifera-staff-auth" },
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: () => undefined,
      },
    });
    const { data, error } = await direct.auth.getUser();
    if (error || !data.user) {
      throw new Error(
        `Tenant ${label} cookie jar failed direct Supabase validation (${error?.code ?? "missing_user"}).`,
      );
    }
    const session = await request("/api/auth/staff/session", {}, jar);
    expectStatus(session, 200, `tenant ${label} staff session`);
    expect(session.body?.data?.authenticated === true, `Tenant ${label} Worker session was not authenticated.`);
  }

  async function ensureMember(account, label) {
    let user = await findAuthUser(admin, account.memberEmail);
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: account.memberEmail,
        email_confirm: true,
        password,
        user_metadata: { auth_surface: "member", hosted_acceptance: true },
      });
      if (error || !data.user) throw error ?? new Error(`Tenant ${label} member Auth failed.`);
      user = data.user;
    } else {
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        email_confirm: true,
        password,
        user_metadata: { auth_surface: "member", hosted_acceptance: true },
      });
      if (error) throw error;
    }
    const { data: existing, error: existingError } = await admin
      .from("members")
      .select("id,organization_id,brand_id")
      .eq("email", account.memberEmail)
      .maybeSingle();
    if (existingError) throw existingError;
    if (
      existing &&
      (existing.organization_id !== account.organizationId || existing.brand_id !== account.brandId)
    ) {
      throw new Error(`Tenant ${label} reusable member belongs to another tenant.`);
    }
    const memberResult = existing
      ? await admin
          .from("members")
          .update({ auth_user_id: user.id, status: "active" })
          .eq("id", existing.id)
          .select("id")
          .single()
      : await admin
          .from("members")
          .insert({
            auth_user_id: user.id,
            brand_id: account.brandId,
            email: account.memberEmail,
            first_name: "Hosted",
            last_name: `Member ${label}`,
            organization_id: account.organizationId,
            status: "active",
          })
          .select("id")
          .single();
    const { data: member, error: memberError } = memberResult;
    if (memberError) throw memberError;
    return { ...account, memberId: member.id, memberUserId: user.id };
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

  async function waitForMagicActionLink(callback, state) {
    const repository = required("GITHUB_REPOSITORY");
    const token = required("HOSTED_ACCEPTANCE_GITHUB_TOKEN");
    const environment = process.env.HOSTED_ACCEPTANCE_ENVIRONMENT?.trim() || "staging";
    const variableName =
      process.env.HOSTED_ACCEPTANCE_LINK_ENVELOPE_VARIABLE?.trim() ||
      "STAGING_HOSTED_ACCEPTANCE_MAGIC_LINK_ENVELOPE";
    const handoffId = `${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}-${randomBytes(8).toString("hex")}`;
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "der", type: "spki" },
    });
    const handoff = JSON.stringify({
      handoffId,
      publicKeySpkiBase64: publicKey.toString("base64"),
    });
    console.log(`HOSTED_GATE7_MAGIC_LINK_HANDOFF ${handoff}`);
    console.log(`::notice title=Hosted Gate 7 magic-link handoff::${handoff}`);
    const endpoint = `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repository}/environments/${encodeURIComponent(environment)}/variables/${encodeURIComponent(variableName)}`;
    for (let attempt = 1; attempt <= 72; attempt += 1) {
      const response = await fetch(endpoint, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      });
      if (response.ok) {
        const body = await response.json();
        try {
          const rawLink = decryptMagicLinkEnvelope(body.value, privateKey, handoffId);
          return validateMagicActionLink(rawLink, {
            callback,
            state,
            supabaseUrl,
          });
        } catch (error) {
          if (!String(error).includes("does not match this run")) throw error;
        }
      } else if (response.status !== 404) {
        throw new Error(`Magic-link handoff variable returned HTTP ${response.status}.`);
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
    }
    throw new Error("Timed out waiting for the encrypted Gate 7 magic-link handoff.");
  }

  let runError = null;
  try {
    const health = await request("/api/health");
    expectStatus(health, 200, "Worker health");
    expect(health.body?.data?.environment === "staging", "Worker is not staging.");
    const configuration = await request("/api/health/configuration");
    expectStatus(configuration, 200, "Worker configuration");
    expect(configuration.body?.data?.email?.configured === true, "Auth email is not activated.");
    evidence.checks.runtime = true;

    let tenantA = await ensureTenant(accounts.a, "A");
    let tenantB = await ensureTenant(accounts.b, "B");
    runtime.fixtureOrganizationId = tenantA.organizationId;
    const jarA = await login(tenantA, "A");
    const jarB = await login(tenantB, "B");
    await verifyStaffSessionJar(jarA, "A");
    await verifyStaffSessionJar(jarB, "B");
    tenantA = await ensureMember(tenantA, "A");
    tenantB = await ensureMember(tenantB, "B");
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
    const actionLink = await waitForMagicActionLink(callback, linkState);
    const verifyResponse = await fetch(actionLink, {
      headers: access,
      redirect: "manual",
    });
    expect([302, 303].includes(verifyResponse.status), "Supabase magic link did not redirect.");
    const callbackLocation = verifyResponse.headers.get("location");
    expect(callbackLocation, "Supabase magic link omitted its callback location.");
    const callbackResult = await request(new URL(callbackLocation).toString(), { redirect: "manual" }, memberJar);
    expectStatus(callbackResult, 303, "member magic-link callback");
    expect(
      hasCookieFamily(memberJar, "vinifera-member-auth"),
      "Member callback omitted its Auth cookie.",
    );
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
    if (sessionMatch) runtime.checkoutSessionId = sessionMatch[1];
    evidence.checks.checkout = true;

    const { data: billingOrg, error: billingError } = await admin
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", tenantA.organizationId)
      .single();
    if (billingError || !billingOrg.stripe_customer_id) throw billingError ?? new Error("Stripe customer is missing.");
    const baseCreated = Math.floor(Date.now() / 1000);
    const subscriptionId = `sub_gate7${eventSuffix}`;
    const activeEvent = stripeEvent({
      created: baseCreated,
      customerId: billingOrg.stripe_customer_id,
      eventId: `evt_gate7${eventSuffix}active`,
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
      eventId: `evt_gate7${eventSuffix}pastdue`,
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
    const now = Date.now();
    const { error: stageRestrictionError } = await admin
      .from("organizations")
      .update({
        grace_period_ends_at: new Date(now - 1_000).toISOString(),
        suspension_at: new Date(now + 60_000).toISOString(),
      })
      .eq("id", tenantA.organizationId);
    if (stageRestrictionError) throw stageRestrictionError;
    const { error: restrictError } = await admin.rpc("reconcile_subscription_access", {
      p_as_of: new Date().toISOString(),
    });
    if (restrictError) throw restrictError;
    const { data: restricted, error: restrictedError } = await admin
      .from("organizations")
      .select("access_status")
      .eq("id", tenantA.organizationId)
      .single();
    if (restrictedError) throw restrictedError;
    expect(restricted.access_status === "restricted", "Day-eight reconciliation did not restrict access.");
    const { error: stageSuspensionError } = await admin
      .from("organizations")
      .update({ suspension_at: new Date(Date.now() - 1_000).toISOString() })
      .eq("id", tenantA.organizationId);
    if (stageSuspensionError) throw stageSuspensionError;
    const { error: suspendError } = await admin.rpc("reconcile_subscription_access", {
      p_as_of: new Date().toISOString(),
    });
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
      eventId: `evt_gate7${eventSuffix}recovered`,
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
    runError = error instanceof Error ? error : new Error(String(error));
    evidence.failure = runError.message;
    evidence.success = false;
  } finally {
    const cleanupErrors = [];
    if (runtime.checkoutSessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(runtime.checkoutSessionId);
        if (session.status === "open") {
          await stripe.checkout.sessions.expire(runtime.checkoutSessionId);
        }
      } catch (error) {
        cleanupErrors.push(`checkout:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (runtime.fixtureOrganizationId) {
      const { error } = await admin
        .from("organizations")
        .update({
          access_status: "onboarding",
          grace_period_ends_at: null,
          payment_failed_at: null,
          restricted_at: null,
          stripe_subscription_id: null,
          subscription_status: "not_started",
          suspended_at: null,
          suspension_at: null,
        })
        .eq("id", runtime.fixtureOrganizationId);
      if (error) cleanupErrors.push(`fixture:${error.message}`);
    }
    evidence.cleanup = { attempted: true, passed: cleanupErrors.length === 0 };
    if (cleanupErrors.length) {
      evidence.cleanup.failureCount = cleanupErrors.length;
      evidence.success = false;
      runError ??= new Error(`Gate 7 fixture cleanup failed (${cleanupErrors.length} operation(s)).`);
      evidence.failure ??= runError.message;
    }
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  }
  if (runError) throw runError;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
