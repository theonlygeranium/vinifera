import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const POLICY_PATH = resolve(
  import.meta.dirname,
  "../config/resend-staging-provisioning-policy.json",
);
const RESEND_ORIGIN = "https://api.resend.com";
const CLOUDFLARE_ORIGIN = "https://api.cloudflare.com/client/v4";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u;
const ID_PATTERN = /^[a-f0-9]{32}$/u;
const OPERATIONS = new Set(["probe", "bootstrap", "apply", "verify"]);
const MUTATING_OPERATIONS = new Set(["bootstrap", "apply"]);
const CONFIRMATIONS = Object.freeze({
  apply: "APPLY VINIFERA STAGING RESEND DNS",
  bootstrap: "BOOTSTRAP VINIFERA STAGING RESEND",
  probe: "PROBE VINIFERA STAGING RESEND",
  verify: "VERIFY VINIFERA STAGING RESEND",
});
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
const DNS_TYPES = new Set(["CNAME", "MX", "TXT"]);
const RUNTIME_API_KEY_NAME = "Vinifera staging runtime sender";

function required(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeHostname(value, label = "hostname") {
  const normalized = required(value, label).toLowerCase().replace(/\.+$/u, "");
  if (
    normalized.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      normalized,
    )
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

export function normalizeWebhookEndpoint(value) {
  let parsed;
  try {
    parsed = new URL(required(value, "webhook endpoint"));
  } catch {
    throw new Error("The staging webhook endpoint is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/api/webhooks/resend" ||
    parsed.search ||
    parsed.hash ||
    !/^vinifera-staging\.[a-z0-9-]+\.workers\.dev$/u.test(
      parsed.hostname.toLowerCase(),
    )
  ) {
    throw new Error(
      "The webhook endpoint must be the exact isolated staging Resend route.",
    );
  }
  return parsed.toString();
}

function normalizeDnsName(value) {
  const normalized = required(value, "DNS record name")
    .toLowerCase()
    .replace(/\.+$/u, "");
  if (
    normalized.length > 253 ||
    !/^(?:[_a-z0-9](?:[_a-z0-9-]{0,61}[_a-z0-9])?\.)+[_a-z0-9](?:[_a-z0-9-]{0,61}[_a-z0-9])?$/u.test(
      normalized,
    )
  ) {
    throw new Error("DNS record name is invalid.");
  }
  return normalized;
}

function normalizedHashList(value, label) {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) => typeof entry !== "string" || !SHA256_PATTERN.test(entry),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} must contain unique lowercase SHA-256 hashes.`);
  }
  return value;
}

export function normalizeDnsRecord(record, sendingDomain) {
  expect(
    record && typeof record === "object",
    "Resend returned an invalid DNS record.",
  );
  const domain = normalizeHostname(sendingDomain, "sending domain");
  const rawName = required(record.name, "DNS record name")
    .toLowerCase()
    .replace(/\.+$/u, "");
  const name = normalizeDnsName(
    rawName === domain || rawName.endsWith(`.${domain}`)
      ? rawName
      : `${rawName}.${domain}`,
  );
  expect(
    name === domain || name.endsWith(`.${domain}`),
    "A Resend DNS record escaped the approved sending domain.",
  );
  const type = required(record.type, "DNS record type").toUpperCase();
  expect(DNS_TYPES.has(type), `Unsupported Resend DNS record type: ${type}.`);
  let value = required(record.value, "DNS record value");
  if (type === "CNAME" || type === "MX") {
    value = value.toLowerCase().replace(/\.+$/u, "");
    normalizeHostname(value, "DNS record value");
  }
  const priority = type === "MX" ? Number(record.priority) : null;
  if (type === "MX") {
    expect(
      Number.isInteger(priority) && priority >= 0 && priority <= 65_535,
      "The Resend MX priority is invalid.",
    );
  }
  return {
    label: required(record.record, "DNS record label"),
    name,
    priority,
    type,
    value,
  };
}

export function validateEvidenceBinding(env, policyText) {
  const repository = required(env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  expect(
    repository === "theonlygeranium/vinifera",
    "Repository is not the canonical Vinifera repository.",
  );
  const gitSha = required(env.PROVISIONING_GIT_SHA, "PROVISIONING_GIT_SHA")
    .toLowerCase();
  expect(GIT_SHA_PATTERN.test(gitSha), "Provisioning git SHA is invalid.");
  expect(
    required(env.GITHUB_SHA, "GITHUB_SHA").toLowerCase() === gitSha,
    "Provisioning git SHA does not match the workflow revision.",
  );
  const runId = required(env.GITHUB_RUN_ID, "GITHUB_RUN_ID");
  const runAttempt = required(env.GITHUB_RUN_ATTEMPT, "GITHUB_RUN_ATTEMPT");
  expect(RUN_ID_PATTERN.test(runId), "GitHub run ID is invalid.");
  expect(RUN_ID_PATTERN.test(runAttempt), "GitHub run attempt is invalid.");
  return {
    gitSha,
    policySha256: sha256(policyText),
    repository,
    runAttempt,
    runId,
  };
}

export function dnsRecordPolicyEntry(record) {
  return {
    nameSha256: sha256(record.name),
    priority: record.priority,
    type: record.type,
    valueSha256: sha256(record.value),
  };
}

function normalizePolicyDnsRecord(record, index) {
  expect(
    record && typeof record === "object",
    `dnsRecords[${index}] is invalid.`,
  );
  const nameSha256 = required(
    record.nameSha256,
    `dnsRecords[${index}].nameSha256`,
  );
  const valueSha256 = required(
    record.valueSha256,
    `dnsRecords[${index}].valueSha256`,
  );
  expect(
    SHA256_PATTERN.test(nameSha256),
    `dnsRecords[${index}].nameSha256 is invalid.`,
  );
  expect(
    SHA256_PATTERN.test(valueSha256),
    `dnsRecords[${index}].valueSha256 is invalid.`,
  );
  const type = required(record.type, `dnsRecords[${index}].type`).toUpperCase();
  expect(DNS_TYPES.has(type), `dnsRecords[${index}].type is unsupported.`);
  const priority = record.priority === null ? null : Number(record.priority);
  expect(
    (type === "MX" &&
      Number.isInteger(priority) &&
      priority >= 0 &&
      priority <= 65_535) ||
      (type !== "MX" && priority === null),
    `dnsRecords[${index}].priority is invalid.`,
  );
  return { nameSha256, priority, type, valueSha256 };
}

export function validatePolicy(rawPolicy) {
  expect(
    rawPolicy && typeof rawPolicy === "object" && rawPolicy.schemaVersion === 1,
    "Resend staging provisioning policy schema version is invalid.",
  );
  expect(
    typeof rawPolicy.enabled === "boolean",
    "Policy enabled must be boolean.",
  );
  const policy = {
    schemaVersion: 1,
    enabled: rawPolicy.enabled,
    cloudflareAccountIdSha256: normalizedHashList(
      rawPolicy.cloudflareAccountIdSha256,
      "cloudflareAccountIdSha256",
    ),
    cloudflareZoneIdSha256: normalizedHashList(
      rawPolicy.cloudflareZoneIdSha256,
      "cloudflareZoneIdSha256",
    ),
    sendingDomainSha256: normalizedHashList(
      rawPolicy.sendingDomainSha256,
      "sendingDomainSha256",
    ),
    webhookEndpointSha256: normalizedHashList(
      rawPolicy.webhookEndpointSha256,
      "webhookEndpointSha256",
    ),
    runtimeApiKeyIdSha256: normalizedHashList(
      rawPolicy.runtimeApiKeyIdSha256,
      "runtimeApiKeyIdSha256",
    ),
    dnsRecords: Array.isArray(rawPolicy.dnsRecords)
      ? rawPolicy.dnsRecords.map(normalizePolicyDnsRecord)
      : (() => {
          throw new Error("dnsRecords must be an array.");
        })(),
  };
  const dnsKeys = policy.dnsRecords.map((record) => JSON.stringify(record));
  expect(
    new Set(dnsKeys).size === dnsKeys.length,
    "dnsRecords contains duplicates.",
  );
  if (policy.enabled) {
    for (const key of [
      "cloudflareAccountIdSha256",
      "cloudflareZoneIdSha256",
      "sendingDomainSha256",
      "webhookEndpointSha256",
    ]) {
      expect(
        policy[key].length === 1,
        `Enabled policy requires exactly one ${key} value.`,
      );
    }
  }
  return policy;
}

function authorizeRuntimeKey(key, policy, requireComplete) {
  const idHash = key?.id ? sha256(String(key.id)) : null;
  const authorized = Boolean(
    idHash && policy.runtimeApiKeyIdSha256.includes(idHash),
  );
  if (requireComplete) {
    expect(
      policy.runtimeApiKeyIdSha256.length === 1 && authorized,
      "Runtime sending API key is not authorized by exact target policy.",
    );
  }
  return { authorized, idHash };
}

export function recordRuntimeCredential(
  evidence,
  runtimeKeyResult,
  policy,
  operation,
) {
  const authorization = authorizeRuntimeKey(
    runtimeKeyResult.key,
    policy,
    operation === "apply" || operation === "verify",
  );
  evidence.runtimeCredential = {
    adminSeparated: true,
    authorized: authorization.authorized,
    disposition: runtimeKeyResult.disposition,
    domainRestricted:
      runtimeKeyResult.disposition === "created" ? true : null,
    idSha256: authorization.idHash,
    permission:
      runtimeKeyResult.disposition === "created" ? "sending_access" : null,
  };
  if (operation === "bootstrap" && runtimeKeyResult.disposition === "existing") {
    expect(
      authorization.authorized,
      "An existing runtime sending key requires its previously reviewed ID policy.",
    );
  }
  return authorization;
}

export function authorizeTargets({
  accountId,
  domain,
  endpoint,
  policy,
  zoneId,
}) {
  expect(policy.enabled, "Resend staging provisioning policy is disabled.");
  expect(ID_PATTERN.test(accountId), "Cloudflare account ID is invalid.");
  expect(ID_PATTERN.test(zoneId), "Cloudflare zone ID is invalid.");
  const normalizedDomain = normalizeHostname(domain, "sending domain");
  const normalizedEndpoint = normalizeWebhookEndpoint(endpoint);
  const checks = [
    [policy.cloudflareAccountIdSha256, sha256(accountId), "Cloudflare account"],
    [policy.cloudflareZoneIdSha256, sha256(zoneId), "Cloudflare zone"],
    [
      policy.sendingDomainSha256,
      sha256(normalizedDomain),
      "Resend sending domain",
    ],
    [
      policy.webhookEndpointSha256,
      sha256(normalizedEndpoint),
      "Resend webhook endpoint",
    ],
  ];
  for (const [allowed, actual, label] of checks) {
    expect(
      allowed.includes(actual),
      `${label} is not authorized by exact target policy.`,
    );
  }
  return { domain: normalizedDomain, endpoint: normalizedEndpoint };
}

export function authorizeDnsRecords(
  records,
  policy,
  { requireComplete = false } = {},
) {
  const actual = records.map(dnsRecordPolicyEntry);
  const authorized = actual.filter((entry) =>
    policy.dnsRecords.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(entry),
    ),
  );
  if (requireComplete) {
    expect(
      authorized.length === actual.length &&
        policy.dnsRecords.length === actual.length,
      "Exact Resend DNS record policy is incomplete or stale.",
    );
  }
  return { actual, authorizedCount: authorized.length };
}

function validateOperation(operation, confirmation) {
  expect(
    OPERATIONS.has(operation),
    "Resend provisioning operation is invalid.",
  );
  expect(
    confirmation === CONFIRMATIONS[operation],
    `Exact ${operation} confirmation is required.`,
  );
}

async function apiJson(
  origin,
  path,
  { body, headers = {}, method = "GET" } = {},
) {
  const response = await fetch(`${origin}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Accept: "application/json",
      "User-Agent": "vinifera-staging-provisioning/1.0",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    method,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(`Provider request returned HTTP ${response.status}.`);
  return payload;
}

function resendHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

function cloudflareHeaders(apiToken) {
  return { Authorization: `Bearer ${apiToken}` };
}

function unwrapCloudflare(payload, label) {
  expect(payload?.success === true && payload.result, `${label} failed.`);
  return payload.result;
}

export async function listResendCollection(path, apiKey) {
  const entries = [];
  let after = null;
  const seenCursors = new Set();
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (after) query.set("after", after);
    const payload = await apiJson(
      RESEND_ORIGIN,
      `${path}?${query.toString()}`,
      { headers: resendHeaders(apiKey) },
    );
    expect(Array.isArray(payload?.data), "Resend inventory is invalid.");
    entries.push(...payload.data);
    if (payload.has_more !== true) return entries;
    const cursor = String(payload.data.at(-1)?.id ?? "").trim();
    expect(
      cursor && !seenCursors.has(cursor),
      "Resend inventory pagination cursor is invalid.",
    );
    seenCursors.add(cursor);
    after = cursor;
  }
  throw new Error("Resend inventory exceeded the pagination limit.");
}

async function inventoryDomain(apiKey, domain) {
  const list = await listResendCollection("/domains", apiKey);
  const matches = list.filter(
    (entry) => String(entry?.name ?? "").toLowerCase() === domain,
  );
  expect(
    matches.length <= 1,
    "Resend contains ambiguous duplicate sending domains.",
  );
  if (!matches.length) return null;
  return apiJson(
    RESEND_ORIGIN,
    `/domains/${encodeURIComponent(matches[0].id)}`,
    {
      headers: resendHeaders(apiKey),
    },
  );
}

export async function ensureDomain(apiKey, domain, canCreate) {
  let result = await inventoryDomain(apiKey, domain);
  let disposition = "existing";
  if (!result && canCreate) {
    result = await apiJson(RESEND_ORIGIN, "/domains", {
      body: { name: domain },
      headers: resendHeaders(apiKey),
      method: "POST",
    });
    disposition = "created";
  }
  return { disposition, domain: result };
}

async function inventoryWebhook(apiKey, endpoint) {
  const list = await listResendCollection("/webhooks", apiKey);
  const matches = list.filter(
    (entry) => String(entry?.endpoint ?? "") === endpoint,
  );
  expect(
    matches.length <= 1,
    "Resend contains ambiguous duplicate staging webhooks.",
  );
  if (!matches.length) return null;
  return apiJson(
    RESEND_ORIGIN,
    `/webhooks/${encodeURIComponent(matches[0].id)}`,
    {
      headers: resendHeaders(apiKey),
    },
  );
}

function webhookIsExact(webhook, endpoint) {
  const events = Array.isArray(webhook?.events)
    ? [...new Set(webhook.events.map(String))].sort()
    : [];
  return (
    webhook?.endpoint === endpoint &&
    webhook?.status === "enabled" &&
    JSON.stringify(events) ===
      JSON.stringify([...REQUIRED_WEBHOOK_EVENTS].sort())
  );
}

export async function ensureWebhook(
  apiKey,
  endpoint,
  canMutate,
  persistSigningSecret,
  boundWebhookIdSha256,
) {
  let webhook = await inventoryWebhook(apiKey, endpoint);
  let disposition = "existing";
  if (!webhook && canMutate) {
    const created = await apiJson(RESEND_ORIGIN, "/webhooks", {
      body: { endpoint, events: REQUIRED_WEBHOOK_EVENTS },
      headers: resendHeaders(apiKey),
      method: "POST",
    });
    expect(
      typeof persistSigningSecret === "function",
      "Webhook creation requires an immediate secret persistence callback.",
    );
    const createdId =
      typeof created?.id === "string" && created.id.trim()
        ? created.id.trim()
        : required(
            (await inventoryWebhook(apiKey, endpoint))?.id,
            "Resend webhook ID",
          );
    try {
      await persistSigningSecret(
        required(created.signing_secret, "Resend webhook signing secret"),
        sha256(createdId),
      );
    } catch (persistenceError) {
      try {
        await apiJson(
          RESEND_ORIGIN,
          `/webhooks/${encodeURIComponent(createdId)}`,
          { headers: resendHeaders(apiKey), method: "DELETE" },
        );
      } catch (rollbackError) {
        throw new AggregateError(
          [persistenceError, rollbackError],
          "Webhook secret persistence and provider rollback both failed.",
        );
      }
      throw persistenceError;
    }
    webhook = await apiJson(
      RESEND_ORIGIN,
      `/webhooks/${encodeURIComponent(createdId)}`,
      { headers: resendHeaders(apiKey) },
    );
    disposition = "created";
  } else if (webhook && !webhookIsExact(webhook, endpoint) && canMutate) {
    await apiJson(
      RESEND_ORIGIN,
      `/webhooks/${encodeURIComponent(webhook.id)}`,
      {
        body: { endpoint, events: REQUIRED_WEBHOOK_EVENTS, status: "enabled" },
        headers: resendHeaders(apiKey),
        method: "PATCH",
      },
    );
    webhook = await inventoryWebhook(apiKey, endpoint);
    disposition = "updated";
  }
  if (webhook && disposition !== "created") {
    expect(
      typeof boundWebhookIdSha256 === "string" &&
        SHA256_PATTERN.test(boundWebhookIdSha256) &&
        sha256(String(webhook.id)) === boundWebhookIdSha256,
      "Existing Resend webhook is not bound to the persisted signing secret.",
    );
  }
  return { disposition, webhook };
}

async function inventoryRuntimeSendingKey(apiKey) {
  const list = await listResendCollection("/api-keys", apiKey);
  const matches = list.filter(
    (entry) => String(entry?.name ?? "") === RUNTIME_API_KEY_NAME,
  );
  expect(matches.length <= 1, "Resend contains ambiguous runtime API keys.");
  return matches[0] ?? null;
}

export async function ensureRuntimeSendingKey(
  provisioningApiKey,
  domainId,
  canCreate,
  persistToken = async () => {},
) {
  let key = await inventoryRuntimeSendingKey(provisioningApiKey);
  let token = null;
  let disposition = "existing";
  if (!key && canCreate) {
    const created = await apiJson(RESEND_ORIGIN, "/api-keys", {
      body: {
        domain_id: required(domainId, "Resend domain ID"),
        name: RUNTIME_API_KEY_NAME,
        permission: "sending_access",
      },
      headers: resendHeaders(provisioningApiKey),
      method: "POST",
    });
    const createdId =
      typeof created?.id === "string" && created.id.trim()
        ? created.id.trim()
        : required(
            (await inventoryRuntimeSendingKey(provisioningApiKey))?.id,
            "Resend runtime API key ID",
          );
    // Resend returns this value only once. Store it before any provider
    // inventory or other fallible post-creation work can interrupt bootstrap.
    try {
      token = required(created?.token, "Resend runtime sending token");
      expect(
        /^re_[^\s]{8,}$/u.test(token),
        "Resend runtime sending credential format is invalid.",
      );
      await persistToken(token);
    } catch (persistenceError) {
      try {
        await apiJson(
          RESEND_ORIGIN,
          `/api-keys/${encodeURIComponent(createdId)}`,
          { headers: resendHeaders(provisioningApiKey), method: "DELETE" },
        );
      } catch (rollbackError) {
        throw new AggregateError(
          [persistenceError, rollbackError],
          "Runtime-key persistence and provider rollback both failed.",
        );
      }
      throw persistenceError;
    }
    key = await inventoryRuntimeSendingKey(provisioningApiKey);
    expect(
      key && String(key.id) === createdId,
      "Post-creation runtime API key inventory did not match.",
    );
    disposition = "created";
  }
  return { disposition: key ? disposition : "absent", key, token };
}

async function verifyCloudflareZone(apiToken, accountId, zoneId, domain) {
  const payload = await apiJson(CLOUDFLARE_ORIGIN, `/zones/${zoneId}`, {
    headers: cloudflareHeaders(apiToken),
  });
  const zone = unwrapCloudflare(payload, "Cloudflare zone inventory");
  expect(
    String(zone.id).toLowerCase() === zoneId,
    "Cloudflare returned another zone.",
  );
  expect(
    String(zone.account?.id ?? "").toLowerCase() === accountId,
    "Cloudflare zone does not belong to the approved account.",
  );
  const zoneName = normalizeHostname(zone.name, "Cloudflare zone name");
  expect(
    domain === zoneName || domain.endsWith(`.${zoneName}`),
    "The sending domain is outside the approved Cloudflare zone.",
  );
  return zoneName;
}

function comparableCloudflareRecord(record, type) {
  let value = required(record.content, "Cloudflare DNS record content");
  if (type === "CNAME" || type === "MX") {
    value = value.toLowerCase().replace(/\.+$/u, "");
  }
  return {
    name: normalizeDnsName(record.name),
    priority: type === "MX" ? Number(record.priority) : null,
    proxied: record.proxied,
    type,
    value,
  };
}

export async function reconcileDnsRecord(apiToken, zoneId, record, { create }) {
  const query = new URLSearchParams({
    match: "all",
    name: record.name,
    per_page: "100",
    type: record.type,
  });
  const listed = unwrapCloudflare(
    await apiJson(CLOUDFLARE_ORIGIN, `/zones/${zoneId}/dns_records?${query}`, {
      headers: cloudflareHeaders(apiToken),
    }),
    "Cloudflare DNS inventory",
  );
  expect(Array.isArray(listed), "Cloudflare DNS inventory is invalid.");
  expect(listed.length <= 1, "Cloudflare DNS inventory is ambiguous.");
  if (listed.length === 1) {
    const existing = comparableCloudflareRecord(listed[0], record.type);
    expect(
      existing.name === record.name &&
        existing.value === record.value &&
        existing.priority === record.priority &&
        existing.proxied === false,
      "An existing Cloudflare DNS record conflicts with the exact Resend value.",
    );
    return "existing";
  }
  if (!create) return "absent";
  unwrapCloudflare(
    await apiJson(CLOUDFLARE_ORIGIN, `/zones/${zoneId}/dns_records`, {
      body: {
        content: record.value,
        name: record.name,
        ...(record.type === "MX" ? { priority: record.priority } : {}),
        proxied: false,
        ttl: 1,
        type: record.type,
      },
      headers: cloudflareHeaders(apiToken),
      method: "POST",
    }),
    "Cloudflare DNS creation",
  );
  return "created";
}

async function setGitHubEnvironmentSecret(
  name,
  value,
  env,
  environment = "staging",
) {
  const repository = required(env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY");
  expect(
    repository === "theonlygeranium/vinifera",
    "Repository is not the canonical Vinifera repository.",
  );
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      "gh",
      ["secret", "set", name, "--env", environment, "--repo", repository],
      {
        env: { ...process.env, GH_TOKEN: required(env.GH_TOKEN, "GH_TOKEN") },
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
    child.on("error", () =>
      reject(new Error("GitHub secret writer failed to start.")),
    );
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else
        reject(
          new Error(`GitHub environment secret update failed for ${name}.`),
        );
    });
    child.stdin.end(value);
  });
}

async function writeRuntimeSecrets({
  domain,
  domainVerified,
  env,
  runtimeApiKey,
}) {
  const unsubscribe = required(
    env.STAGING_UNSUBSCRIBE_SIGNING_SECRET,
    "STAGING_UNSUBSCRIBE_SIGNING_SECRET",
  );
  const values = {
    STAGING_EMAIL_PROVIDER: "resend",
    STAGING_EMAIL_SIMULATOR_ENABLED: "false",
    STAGING_RESEND_DOMAIN_VERIFIED: domainVerified ? "true" : "false",
    STAGING_RESEND_FROM: `Vinifera Staging <notifications@${domain}>`,
    STAGING_RESEND_SENDING_DOMAIN: domain,
    STAGING_UNSUBSCRIBE_SIGNING_SECRET: unsubscribe,
  };
  if (runtimeApiKey) values.STAGING_RESEND_API_KEY = runtimeApiKey;
  for (const [name, value] of Object.entries(values)) {
    await setGitHubEnvironmentSecret(name, value, env);
  }
  return Object.keys(values).sort();
}

async function waitForDomain(apiKey, domainId, seconds) {
  const deadline = Date.now() + seconds * 1_000;
  let domain;
  do {
    domain = await apiJson(
      RESEND_ORIGIN,
      `/domains/${encodeURIComponent(domainId)}`,
      {
        headers: resendHeaders(apiKey),
      },
    );
    if (domain?.status === "verified") return domain;
    if (Date.now() >= deadline) return domain;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10_000));
  } while (true);
}

function sanitizedDnsEvidence(records) {
  return records.map((record) => ({
    ...dnsRecordPolicyEntry(record),
    label: record.label,
  }));
}

async function main() {
  const operation = process.argv[2];
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = resolve(
    outputIndex >= 0 && process.argv[outputIndex + 1]
      ? process.argv[outputIndex + 1]
      : "resend-staging-provisioning-report.json",
  );
  const policyText = await readFile(POLICY_PATH, "utf8");
  const source = validateEvidenceBinding(process.env, policyText);
  const evidence = {
    generatedAt: new Date().toISOString(),
    operation,
    policyEnabled: false,
    ready: false,
    schemaVersion: 1,
    source,
    success: false,
  };
  let runError;
  try {
    validateOperation(operation, process.env.RESEND_PROVISIONING_CONFIRMATION);
    const policy = validatePolicy(JSON.parse(policyText));
    evidence.policyEnabled = policy.enabled;
    const accountId = required(
      process.env.CLOUDFLARE_ACCOUNT_ID,
      "CLOUDFLARE_ACCOUNT_ID",
    ).toLowerCase();
    const zoneId = required(
      process.env.CLOUDFLARE_ZONE_ID,
      "CLOUDFLARE_ZONE_ID",
    ).toLowerCase();
    const apiToken = required(
      process.env.CLOUDFLARE_API_TOKEN,
      "CLOUDFLARE_API_TOKEN",
    );
    const provisioningApiKey = required(
      process.env.RESEND_PROVISIONING_API_KEY,
      "RESEND_PROVISIONING_API_KEY",
    );
    expect(
      /^re_[^\s]{8,}$/u.test(provisioningApiKey),
      "Resend provisioning API credential format is invalid.",
    );
    const canMutate = MUTATING_OPERATIONS.has(operation);
    const authorized = authorizeTargets({
      accountId,
      domain: process.env.RESEND_SENDING_DOMAIN,
      endpoint: process.env.RESEND_WEBHOOK_ENDPOINT,
      policy,
      zoneId,
    });
    evidence.targets = {
      cloudflareAccountIdSha256: sha256(accountId),
      cloudflareZoneIdSha256: sha256(zoneId),
      sendingDomainSha256: sha256(authorized.domain),
      webhookEndpointSha256: sha256(authorized.endpoint),
    };
    await verifyCloudflareZone(apiToken, accountId, zoneId, authorized.domain);
    const domainResult = await ensureDomain(
      provisioningApiKey,
      authorized.domain,
      canMutate,
    );
    const webhookResult = await ensureWebhook(
      provisioningApiKey,
      authorized.endpoint,
      canMutate,
      async (secret, webhookIdSha256) => {
        await setGitHubEnvironmentSecret(
          "STAGING_RESEND_WEBHOOK_SECRET",
          secret,
          process.env,
        );
        await setGitHubEnvironmentSecret(
          "STAGING_RESEND_WEBHOOK_ID_SHA256",
          webhookIdSha256,
          process.env,
          "staging-acceptance-control",
        );
      },
      process.env.STAGING_RESEND_WEBHOOK_ID_SHA256,
    );
    evidence.provider = {
      domainDisposition: domainResult.domain
        ? domainResult.disposition
        : "absent",
      domainIdSha256: domainResult.domain?.id
        ? sha256(String(domainResult.domain.id))
        : null,
      webhookDisposition: webhookResult.webhook
        ? webhookResult.disposition
        : "absent",
      webhookIdSha256: webhookResult.webhook?.id
        ? sha256(String(webhookResult.webhook.id))
        : null,
    };
    if (!domainResult.domain || !webhookResult.webhook) {
      expect(
        operation === "probe",
        "Required Resend staging resources are absent.",
      );
      evidence.success = true;
      return;
    }
    const runtimeKeyResult = await ensureRuntimeSendingKey(
      provisioningApiKey,
      domainResult.domain.id,
      operation === "bootstrap",
      async (token) =>
        setGitHubEnvironmentSecret(
          "STAGING_RESEND_API_KEY",
          token,
          process.env,
        ),
    );
    recordRuntimeCredential(
      evidence,
      runtimeKeyResult,
      policy,
      operation,
    );
    expect(
      String(domainResult.domain.name).toLowerCase() === authorized.domain,
      "Resend returned another domain.",
    );
    expect(
      webhookIsExact(webhookResult.webhook, authorized.endpoint),
      "Webhook contract is not exact.",
    );
    const records = (domainResult.domain.records ?? []).map((record) =>
      normalizeDnsRecord(record, authorized.domain),
    );
    expect(
      records.length >= 3,
      "Resend returned an incomplete DNS record set.",
    );
    const dnsAuthorization = authorizeDnsRecords(records, policy, {
      requireComplete: operation === "apply" || operation === "verify",
    });
    evidence.dns = {
      authorizedCount: dnsAuthorization.authorizedCount,
      records: sanitizedDnsEvidence(records),
      totalCount: records.length,
    };
    if (operation === "apply") {
      const dispositions = [];
      for (const record of records) {
        dispositions.push(
          await reconcileDnsRecord(apiToken, zoneId, record, { create: true }),
        );
      }
      evidence.dns.createdCount = dispositions.filter(
        (value) => value === "created",
      ).length;
      evidence.dns.existingCount = dispositions.filter(
        (value) => value === "existing",
      ).length;
      const alreadyVerified =
        domainResult.domain.status === "verified" &&
        (domainResult.domain.records ?? []).every(
          (record) => record.status === "verified",
        );
      if (!alreadyVerified) {
        await apiJson(
          RESEND_ORIGIN,
          `/domains/${encodeURIComponent(domainResult.domain.id)}/verify`,
          { headers: resendHeaders(provisioningApiKey), method: "POST" },
        );
        const waitSeconds = Number(
          process.env.RESEND_DOMAIN_VERIFY_WAIT_SECONDS ?? "300",
        );
        expect(
          Number.isInteger(waitSeconds) &&
            waitSeconds >= 0 &&
            waitSeconds <= 300,
          "RESEND_DOMAIN_VERIFY_WAIT_SECONDS must be between 0 and 300.",
        );
        await waitForDomain(
          provisioningApiKey,
          domainResult.domain.id,
          waitSeconds,
        );
      }
    }
    await verifyCloudflareZone(apiToken, accountId, zoneId, authorized.domain);
    const finalDomain = await inventoryDomain(
      provisioningApiKey,
      authorized.domain,
    );
    const finalWebhook = await inventoryWebhook(
      provisioningApiKey,
      authorized.endpoint,
    );
    expect(
      finalDomain && finalWebhook,
      "Post-mutation provider inventory is incomplete.",
    );
    const finalRuntimeKey = await inventoryRuntimeSendingKey(provisioningApiKey);
    expect(
      operation === "probe" || finalRuntimeKey,
      "Post-mutation runtime sending-key inventory is incomplete.",
    );
    const finalRuntimeKeyAuthorization = authorizeRuntimeKey(
      finalRuntimeKey,
      policy,
      operation === "apply" || operation === "verify",
    );
    evidence.runtimeCredential.authorized =
      finalRuntimeKeyAuthorization.authorized;
    evidence.runtimeCredential.idSha256 = finalRuntimeKeyAuthorization.idHash;
    expect(
      String(finalDomain.name).toLowerCase() === authorized.domain,
      "Post-mutation Resend domain inventory changed target.",
    );
    expect(
      webhookIsExact(finalWebhook, authorized.endpoint),
      "Post-mutation webhook contract is not exact.",
    );
    const finalRecords = (finalDomain.records ?? []).map((record) =>
      normalizeDnsRecord(record, authorized.domain),
    );
    const finalDnsAuthorization = authorizeDnsRecords(finalRecords, policy, {
      requireComplete: operation === "apply" || operation === "verify",
    });
    const finalDispositions = [];
    for (const record of finalRecords) {
      finalDispositions.push(
        await reconcileDnsRecord(apiToken, zoneId, record, { create: false }),
      );
    }
    evidence.dns = {
      ...evidence.dns,
      absentCount: finalDispositions.filter((value) => value === "absent")
        .length,
      authorizedCount: finalDnsAuthorization.authorizedCount,
      existingCount: finalDispositions.filter((value) => value === "existing")
        .length,
      postMutationInventory: true,
      records: sanitizedDnsEvidence(finalRecords),
      totalCount: finalRecords.length,
    };
    const domainVerified = finalDomain.status === "verified";
    const recordsVerified = (finalDomain.records ?? []).every(
      (record) => record.status === "verified",
    );
    evidence.provider.domainVerified = domainVerified;
    evidence.provider.recordsVerified = recordsVerified;
    evidence.provider.sendingEnabled =
      finalDomain.capabilities?.sending === "enabled";
    evidence.provider.webhookEnabled =
      finalWebhook.status === "enabled";
    evidence.provider.webhookEvents = [...REQUIRED_WEBHOOK_EVENTS];
    evidence.ready =
      domainVerified &&
      recordsVerified &&
      evidence.provider.sendingEnabled &&
      evidence.provider.webhookEnabled &&
      evidence.dns.absentCount === 0 &&
      Boolean(finalRuntimeKey) &&
      finalRuntimeKeyAuthorization.authorized;
    if (operation === "apply" || operation === "verify") {
      expect(
        evidence.ready,
        "Resend staging resources are not fully verified.",
      );
    }
    if (canMutate) {
      evidence.runtimeSecretNames = await writeRuntimeSecrets({
        domain: authorized.domain,
        domainVerified,
        env: process.env,
        runtimeApiKey: runtimeKeyResult.token,
      });
    }
    evidence.success = true;
  } catch (error) {
    runError = error instanceof Error ? error : new Error(String(error));
    evidence.failure = runError.message;
  } finally {
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
