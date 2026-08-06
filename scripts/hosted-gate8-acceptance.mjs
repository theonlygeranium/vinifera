import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const RESEND_API_ORIGIN = "https://api.resend.com";
const REQUIRED_WEBHOOK_EVENTS = Object.freeze([
  "email.bounced",
  "email.clicked",
  "email.complained",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.opened",
  "email.sent",
]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

export function plusAddress(base, tag) {
  const match = /^([^@+]+)(?:\+[^@]*)?@([^@]+)$/u.exec(
    base.trim().toLowerCase(),
  );
  if (!match) {
    throw new Error("HOSTED_ACCEPTANCE_EMAIL_BASE must be an email address.");
  }
  return `${match[1]}+${tag}@${match[2]}`;
}

export function senderDomain(from) {
  const address = from.match(/(?:<)?([^<>\s]+@([^<>\s]+))(?:>)?$/u)?.[1];
  const domain = address?.split("@")[1]?.toLowerCase();
  if (!domain) throw new Error("RESEND_FROM must contain an email address.");
  return domain;
}

function providerId(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_-]{3,255}$/u.test(normalized)) {
    throw new Error(`Resend returned an invalid ${label}.`);
  }
  return normalized;
}

export function validateResendDomain(domain, expectedDomain) {
  const expected = expectedDomain.trim().toLowerCase();
  expect(
    domain && typeof domain === "object",
    "Resend did not return the configured sending domain.",
  );
  expect(
    String(domain.name ?? "").toLowerCase() === expected,
    "Resend returned a different sending domain.",
  );
  expect(
    domain.status === "verified",
    "The Resend sending domain is not verified.",
  );
  expect(
    domain.capabilities?.sending === "enabled",
    "The Resend sending capability is not enabled.",
  );
  const records = Array.isArray(domain.records) ? domain.records : [];
  for (const recordType of ["DKIM", "SPF"]) {
    expect(
      records.some(
        (record) =>
          String(record?.record ?? "").toUpperCase() === recordType &&
          record?.status === "verified",
      ),
      `The Resend ${recordType} record is not verified.`,
    );
  }
  return {
    id: providerId(domain.id, "domain identifier"),
    recordTypes: [
      ...new Set(
        records
          .filter((record) => record?.status === "verified")
          .map((record) => String(record.record ?? "").toUpperCase())
          .filter(Boolean),
      ),
    ].sort(),
  };
}

export function validateResendWebhook(webhook, expectedEndpoint) {
  const endpoint = new URL(String(webhook?.endpoint ?? ""));
  const expected = new URL(expectedEndpoint);
  expect(
    endpoint.toString() === expected.toString() &&
      endpoint.protocol === "https:" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.hash,
    "Resend returned a different webhook endpoint.",
  );
  expect(webhook.status === "enabled", "The Resend webhook is not enabled.");
  const events = Array.isArray(webhook.events)
    ? [...new Set(webhook.events.map(String))].sort()
    : [];
  for (const event of REQUIRED_WEBHOOK_EVENTS) {
    expect(events.includes(event), `The Resend webhook is missing ${event}.`);
  }
  return { events, id: providerId(webhook.id, "webhook identifier") };
}

export function secretsMatch(left, right) {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function localDate(timeZone, asOf = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(asOf);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCalendarDays(date, days) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (!Number.isInteger(days) || Number.isNaN(parsed.getTime())) {
    throw new Error("The lifecycle fixture date is invalid.");
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function deliveryComplete({ events, logIds, logs, outbox }) {
  return (
    logs.length === 2 &&
    logs.every(
      (row) =>
        row.status === "delivered" &&
        typeof row.resend_id === "string" &&
        row.resend_id.length > 0,
    ) &&
    outbox.length === 2 &&
    outbox.every((row) => row.status === "completed") &&
    logIds.every((id) =>
      events.some(
        (event) =>
          event.email_log_id === id && event.event_type === "delivered",
      ),
    )
  );
}

export function scopedPreShipmentTriggerArgs(fixture, asOf) {
  expect(
    fixture.organizationId &&
      fixture.brandId &&
      fixture.memberId &&
      fixture.releaseId,
    "The scoped pre-shipment fixture identity is incomplete.",
  );
  return {
    p_as_of: asOf.toISOString(),
    p_brand_id: fixture.brandId,
    p_member_id: fixture.memberId,
    p_organization_id: fixture.organizationId,
    p_release_id: fixture.releaseId,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function accessHeaders(clientId, clientSecret) {
  return {
    "CF-Access-Client-Id": clientId,
    "CF-Access-Client-Secret": clientSecret,
  };
}

function remainingMilliseconds(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error("Gate 8 exhausted its pre-cleanup execution budget.");
  }
  return Math.min(15_000, remaining);
}

function boundedFetch(deadline = null) {
  return (input, init = {}) => {
    const timeoutSignal = AbortSignal.timeout(
      deadline === null ? 15_000 : remainingMilliseconds(deadline),
    );
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    return fetch(input, { ...init, signal });
  };
}

function hostedClient(url, key, headers, deadline = null) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: boundedFetch(deadline), headers },
  });
}

async function providerJson(path, apiKey, deadline = null) {
  const response = await fetch(`${RESEND_API_ORIGIN}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(
      deadline === null ? 15_000 : remainingMilliseconds(deadline),
    ),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      `Resend readiness request returned HTTP ${response.status}.`,
    );
  }
  return response.json();
}

export async function providerList(path, apiKey, deadline = null) {
  const rows = [];
  let after = null;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    const page = await providerJson(`${path}?${query}`, apiKey, deadline);
    const pageRows = Array.isArray(page?.data) ? page.data : [];
    rows.push(...pageRows);
    if (page?.has_more !== true) return rows;
    const lastId = providerId(pageRows.at(-1)?.id, "pagination cursor");
    expect(lastId !== after, "Resend pagination cursor did not advance.");
    after = lastId;
  }
  throw new Error("Resend provider inventory exceeded the pagination limit.");
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  const origin = new URL(required("STAGING_WORKER_ORIGIN"));
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    !/^vinifera-staging\.[a-z0-9-]+\.workers\.dev$/u.test(origin.hostname)
  ) {
    throw new Error(
      "STAGING_WORKER_ORIGIN must be the isolated staging workers.dev origin.",
    );
  }
  const outputIndex = process.argv.indexOf("--output");
  const outputPath =
    outputIndex >= 0 && process.argv[outputIndex + 1]
      ? resolve(process.argv[outputIndex + 1])
      : resolve("hosted-gate8-acceptance.json");
  const apiKey = required("RESEND_API_KEY");
  const sendingDomain = required("RESEND_SENDING_DOMAIN").toLowerCase();
  const webhookSecret = required("RESEND_WEBHOOK_SECRET");
  expect(
    required("EMAIL_PROVIDER") === "resend",
    "EMAIL_PROVIDER must be resend.",
  );
  expect(
    required("EMAIL_SIMULATOR_ENABLED") === "false",
    "The staging email simulator must be disabled.",
  );
  expect(
    required("RESEND_DOMAIN_VERIFIED") === "true",
    "RESEND_DOMAIN_VERIFIED must be true only after provider verification.",
  );
  expect(
    senderDomain(required("RESEND_FROM")) === sendingDomain,
    "RESEND_FROM does not use RESEND_SENDING_DOMAIN.",
  );
  required("UNSUBSCRIBE_SIGNING_SECRET");
  const access = accessHeaders(
    required("CF_ACCESS_CLIENT_ID"),
    required("CF_ACCESS_CLIENT_SECRET"),
  );
  const emailBase = required("HOSTED_ACCEPTANCE_EMAIL_BASE");
  const waitSeconds = Number(process.env.HOSTED_GATE8_WAIT_SECONDS ?? "4200");
  expect(
    Number.isInteger(waitSeconds) && waitSeconds >= 60 && waitSeconds <= 4_500,
    "HOSTED_GATE8_WAIT_SECONDS must be between 60 and 4500.",
  );
  const preCleanupSeconds = Number(
    process.env.HOSTED_GATE8_PRE_CLEANUP_SECONDS ?? "4200",
  );
  expect(
    Number.isInteger(preCleanupSeconds) &&
      preCleanupSeconds >= 60 &&
      preCleanupSeconds <= 4_200 &&
      waitSeconds <= preCleanupSeconds,
    "HOSTED_GATE8_PRE_CLEANUP_SECONDS must be 60-4200 and cover the delivery wait.",
  );
  const preCleanupDeadline = Date.now() + preCleanupSeconds * 1_000;
  const supabaseUrl = required("SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const admin = hostedClient(
    supabaseUrl,
    serviceRoleKey,
    access,
    preCleanupDeadline,
  );
  const cleanupAdmin = hostedClient(supabaseUrl, serviceRoleKey, access);
  const runSuffix = `${process.env.GITHUB_RUN_ID ?? "local"}-${randomBytes(4).toString("hex")}`;
  const recipient = plusAddress(emailBase, `vinifera-g8-${runSuffix}`);
  const evidence = {
    checks: {},
    fixtureMode: "durable-one-shot-staging",
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    success: false,
    targetClass: "isolated-staging-workers-dev",
  };
  const fixture = {
    brandId: null,
    memberId: null,
    organizationId: null,
    releaseId: null,
    tierId: null,
  };
  let runError = null;

  try {
    const healthResponse = await fetch(new URL("/api/health", origin), {
      headers: access,
      redirect: "error",
      signal: AbortSignal.timeout(remainingMilliseconds(preCleanupDeadline)),
    });
    const health = await responseBody(healthResponse);
    expect(
      healthResponse.status === 200,
      "Worker health did not return HTTP 200.",
    );
    expect(health?.data?.environment === "staging", "Worker is not staging.");
    const configurationResponse = await fetch(
      new URL("/api/health/configuration", origin),
      {
        headers: access,
        redirect: "error",
        signal: AbortSignal.timeout(remainingMilliseconds(preCleanupDeadline)),
      },
    );
    const configuration = await responseBody(configurationResponse);
    expect(
      configurationResponse.status === 200,
      "Worker configuration did not return HTTP 200.",
    );
    expect(
      configuration?.data?.communications?.configured === true,
      "The deployed Worker communications capability is not configured.",
    );
    evidence.checks.runtime = true;

    const domains = await providerList(
      "/domains",
      apiKey,
      preCleanupDeadline,
    );
    const domainSummary = domains.find(
      (domain) => String(domain?.name ?? "").toLowerCase() === sendingDomain,
    );
    expect(domainSummary, "The configured Resend domain was not found.");
    const domain = await providerJson(
      `/domains/${encodeURIComponent(providerId(domainSummary.id, "domain identifier"))}`,
      apiKey,
      preCleanupDeadline,
    );
    const validatedDomain = validateResendDomain(domain, sendingDomain);
    evidence.provider = {
      domainIdSha256: sha256(validatedDomain.id),
      domainVerified: true,
      sendingEnabled: true,
      verifiedRecordTypes: validatedDomain.recordTypes,
    };
    evidence.checks.domain = true;

    const webhookEndpoint = new URL("/api/webhooks/resend", origin).toString();
    const webhooks = await providerList(
      "/webhooks",
      apiKey,
      preCleanupDeadline,
    );
    const webhookSummary = webhooks.find(
      (webhook) => String(webhook?.endpoint ?? "") === webhookEndpoint,
    );
    expect(webhookSummary, "The exact staging Resend webhook was not found.");
    const webhook = await providerJson(
      `/webhooks/${encodeURIComponent(providerId(webhookSummary.id, "webhook identifier"))}`,
      apiKey,
      preCleanupDeadline,
    );
    const validatedWebhook = validateResendWebhook(webhook, webhookEndpoint);
    expect(
      typeof webhook.signing_secret === "string" &&
        secretsMatch(webhook.signing_secret, webhookSecret),
      "The deployed Resend webhook secret does not match the provider endpoint.",
    );
    evidence.provider.webhookIdSha256 = sha256(validatedWebhook.id);
    evidence.provider.webhookEvents = validatedWebhook.events;
    evidence.provider.webhookPath = "/api/webhooks/resend";
    evidence.checks.webhook = true;

    const ownerEmail = plusAddress(emailBase, "vinifera-g7-owner-a");
    const { data: staff, error: staffError } = await admin
      .from("staff_users")
      .select("id,organization_id")
      .eq("email", ownerEmail)
      .maybeSingle();
    if (staffError) throw staffError;
    expect(staff, "The dedicated Gate 7 staging owner fixture is missing.");
    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .select("default_brand_id")
      .eq("id", staff.organization_id)
      .single();
    if (organizationError) throw organizationError;
    expect(
      organization.default_brand_id,
      "The acceptance organization has no default brand.",
    );
    const brandId = organization.default_brand_id;
    fixture.brandId = brandId;
    fixture.organizationId = staff.organization_id;
    const { data: brand, error: brandError } = await admin
      .from("brands")
      .select("time_zone")
      .eq("organization_id", staff.organization_id)
      .eq("id", brandId)
      .single();
    if (brandError) throw brandError;
    const { data: senders, error: senderError } = await admin
      .from("brand_sender_identities")
      .select("status")
      .eq("organization_id", staff.organization_id)
      .eq("brand_id", brandId)
      .neq("status", "disabled");
    if (senderError) throw senderError;
    expect(
      (senders ?? []).every((sender) => sender.status === "verified"),
      "The acceptance brand has a pending sender identity that blocks global fallback.",
    );
    const { data: templates, error: templateError } = await admin
      .from("email_templates")
      .select("trigger_type,enabled,days_before")
      .eq("organization_id", staff.organization_id)
      .eq("brand_id", brandId)
      .in("trigger_type", ["welcome", "pre_shipment"]);
    if (templateError) throw templateError;
    const welcome = templates?.find((row) => row.trigger_type === "welcome");
    const preShipment = templates?.find(
      (row) => row.trigger_type === "pre_shipment",
    );
    expect(welcome?.enabled === true, "The welcome template is not enabled.");
    expect(
      preShipment?.enabled === true &&
        Number.isInteger(preShipment.days_before) &&
        preShipment.days_before >= 1,
      "The pre-shipment template is not enabled with a valid lead time.",
    );

    fixture.tierId = randomUUID();
    fixture.memberId = randomUUID();
    fixture.releaseId = randomUUID();
    const { error: tierError } = await admin.from("club_tiers").insert({
      active: true,
      billing_interval: "quarterly",
      bottle_count: 3,
      brand_id: brandId,
      frequency: "quarterly",
      id: fixture.tierId,
      name: `Gate 8 Tier ${runSuffix}`,
      organization_id: staff.organization_id,
      price_cents: 10000,
    });
    if (tierError) throw tierError;
    const { error: memberError } = await admin.from("members").insert({
      brand_id: brandId,
      club_tier_id: fixture.tierId,
      email: recipient,
      first_name: "Hosted",
      id: fixture.memberId,
      last_name: "Gate Eight",
      organization_id: staff.organization_id,
      status: "active",
    });
    if (memberError) throw memberError;
    const asOf = new Date();
    const today = localDate(brand.time_zone || "UTC", asOf);
    const processingDate = addCalendarDays(today, preShipment.days_before);
    const { error: releaseError } = await admin.from("releases").insert({
      brand_id: brandId,
      created_by: staff.id,
      embargo_date: today,
      id: fixture.releaseId,
      name: `Gate 8 Release ${runSuffix}`,
      organization_id: staff.organization_id,
      processing_date: processingDate,
      status: "scheduled",
    });
    if (releaseError) throw releaseError;
    const { error: releaseTierError } = await admin
      .from("release_tiers")
      .insert({
        bottle_count: 3,
        brand_id: brandId,
        organization_id: staff.organization_id,
        price_cents: 10000,
        release_id: fixture.releaseId,
        tier_id: fixture.tierId,
        tier_name: `Gate 8 Tier ${runSuffix}`,
      });
    if (releaseTierError) throw releaseTierError;
    const triggerArgs = scopedPreShipmentTriggerArgs(fixture, asOf);
    const firstEnqueue = await admin.rpc(
      "enqueue_scoped_pre_shipment_trigger",
      triggerArgs,
    );
    if (firstEnqueue.error) throw firstEnqueue.error;
    expect(firstEnqueue.data, "The scoped pre-shipment trigger was not queued.");
    const replayEnqueue = await admin.rpc(
      "enqueue_scoped_pre_shipment_trigger",
      triggerArgs,
    );
    if (replayEnqueue.error) throw replayEnqueue.error;
    expect(
      replayEnqueue.data === firstEnqueue.data,
      "The scoped pre-shipment trigger was not idempotent.",
    );
    const { data: logicalRows, error: logicalError } = await admin
      .from("email_log")
      .select("id,trigger_type,status,resend_id")
      .eq("organization_id", staff.organization_id)
      .eq("brand_id", brandId)
      .eq("member_id", fixture.memberId)
      .in("trigger_type", ["welcome", "pre_shipment"]);
    if (logicalError) throw logicalError;
    expect(
      logicalRows?.filter((row) => row.trigger_type === "welcome").length === 1,
      "The welcome lifecycle did not create exactly one logical message.",
    );
    expect(
      logicalRows?.filter((row) => row.trigger_type === "pre_shipment")
        .length === 1,
      "The pre-shipment lifecycle did not create exactly one logical message.",
    );
    evidence.checks.triggerIdempotency = true;
    const logIds = logicalRows.map((row) => row.id);
    const deadline = Math.min(
      Date.now() + waitSeconds * 1_000,
      preCleanupDeadline,
    );
    let deliveredRows = [];
    let deliveryEvents = [];
    let completedOutboxRows = [];
    while (Date.now() < deadline) {
      const [logs, events, outbox] = await Promise.all([
        admin
          .from("email_log")
          .select("id,trigger_type,status,resend_id")
          .eq("organization_id", staff.organization_id)
          .eq("brand_id", brandId)
          .in("id", logIds),
        admin
          .from("email_delivery_events")
          .select("email_log_id,event_type")
          .eq("organization_id", staff.organization_id)
          .eq("brand_id", brandId)
          .in("email_log_id", logIds),
        admin
          .from("email_outbox")
          .select("email_log_id,status")
          .eq("organization_id", staff.organization_id)
          .eq("brand_id", brandId)
          .in("email_log_id", logIds),
      ]);
      if (logs.error) throw logs.error;
      if (events.error) throw events.error;
      if (outbox.error) throw outbox.error;
      deliveredRows = logs.data ?? [];
      deliveryEvents = events.data ?? [];
      completedOutboxRows = outbox.data ?? [];
      if (
        deliveryComplete({
          events: deliveryEvents,
          logIds,
          logs: deliveredRows,
          outbox: completedOutboxRows,
        })
      ) {
        break;
      }
      const remaining = Math.max(0, deadline - Date.now());
      if (remaining === 0) break;
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, Math.min(10_000, remaining)),
      );
    }
    expect(
      deliveryComplete({
        events: deliveryEvents,
        logIds,
        logs: deliveredRows,
        outbox: completedOutboxRows,
      }),
      "The deployed Worker did not record two completed outbox rows and two delivered provider events before timeout.",
    );
    evidence.checks.welcomeTrigger = true;
    evidence.checks.preShipmentTrigger = true;
    evidence.checks.providerEvents = true;
    evidence.delivery = {
      logicalMessageCount: 2,
      providerMessageCount: new Set(deliveredRows.map((row) => row.resend_id))
        .size,
      providerEventTypes: [
        ...new Set(deliveryEvents.map((row) => row.event_type)),
      ].sort(),
      completedOutboxCount: completedOutboxRows.length,
    };
    expect(
      evidence.delivery.providerMessageCount === 2,
      "The lifecycle triggers did not resolve to two distinct provider messages.",
    );
    evidence.success = true;
  } catch (error) {
    runError = error instanceof Error ? error : new Error(String(error));
    evidence.failure = runError.message;
    evidence.success = false;
  } finally {
    const cleanupErrors = [];
    const retiredAt = new Date().toISOString();
    if (fixture.releaseId) {
      const processing = await cleanupAdmin
        .from("releases")
        .update({ status: "processing" })
        .eq("id", fixture.releaseId)
        .eq("organization_id", fixture.organizationId)
        .eq("brand_id", fixture.brandId);
      if (processing.error) {
        cleanupErrors.push("release");
      } else {
        const completed = await cleanupAdmin
          .from("releases")
          .update({ status: "completed" })
          .eq("id", fixture.releaseId)
          .eq("organization_id", fixture.organizationId)
          .eq("brand_id", fixture.brandId);
        if (completed.error) cleanupErrors.push("release");
      }
    }
    if (fixture.memberId) {
      const result = await cleanupAdmin
        .from("members")
        .update({
          cancelled_at: retiredAt,
          deleted_at: retiredAt,
          status: "cancelled",
        })
        .eq("id", fixture.memberId)
        .eq("organization_id", fixture.organizationId)
        .eq("brand_id", fixture.brandId);
      if (result.error) cleanupErrors.push("member");
    }
    if (fixture.tierId) {
      const result = await cleanupAdmin
        .from("club_tiers")
        .update({ active: false })
        .eq("id", fixture.tierId)
        .eq("organization_id", fixture.organizationId)
        .eq("brand_id", fixture.brandId);
      if (result.error) cleanupErrors.push("tier");
    }
    evidence.cleanup = {
      attempted: true,
      disposition: "durable-evidence-retained",
      passed: cleanupErrors.length === 0,
    };
    if (cleanupErrors.length) {
      evidence.cleanup.failureCount = cleanupErrors.length;
      evidence.success = false;
      runError ??= new Error("Gate 8 fixture retirement failed.");
      evidence.failure ??= runError.message;
    }
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  if (runError) throw runError;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
