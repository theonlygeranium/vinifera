import { createHash } from "node:crypto";
import { assertSecuritySecretSeparation } from "./security-secret-guard.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLOUDFLARE_ID = /^[0-9a-f]{32}$/;
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const TARGETS = {
  cloudflareAccountId: {
    hashKey: "cloudflareAccountIdSha256",
    normalize: normalizeCloudflareId,
  },
  cloudflareZoneId: {
    hashKey: "cloudflareZoneIdSha256",
    normalize: normalizeCloudflareId,
  },
  customHostname: {
    hashKey: "customHostnameSha256",
    normalize: normalizeHostname,
  },
  pagesProjectName: {
    hashKey: "pagesProjectNameSha256",
    normalize: normalizeName,
  },
  workerName: {
    hashKey: "workerNameSha256",
    normalize: normalizeName,
  },
  workerOrigin: {
    hashKey: "workerOriginSha256",
    normalize: normalizeOrigin,
  },
};

const TARGET_SCOPES = {
  domain: Object.keys(TARGETS),
  upload: ["cloudflareAccountId", "workerName"],
  worker: ["cloudflareAccountId", "workerName", "workerOrigin"],
};

function normalizeCloudflareId(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!CLOUDFLARE_ID.test(normalized)) {
    throw new Error("Cloudflare target metadata is missing or invalid.");
  }
  return normalized;
}

function normalizeName(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!NAME.test(normalized)) {
    throw new Error("Cloudflare resource-name metadata is missing or invalid.");
  }
  return normalized;
}

function normalizeHostname(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
  if (!HOSTNAME.test(normalized)) {
    throw new Error("Production hostname metadata is missing or invalid.");
  }
  return normalized;
}

function normalizeOrigin(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("Production Worker origin metadata is missing or invalid.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !hostname.endsWith(".workers.dev") ||
    !HOSTNAME.test(hostname)
  ) {
    throw new Error(
      "Production Worker origin must be a canonical workers.dev HTTPS origin.",
    );
  }
  return parsed.origin.toLowerCase();
}

function checkedHashList(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !SHA256.test(entry))
  ) {
    throw new Error(`${label} must contain lowercase SHA-256 hashes.`);
  }
  if (value.length === 0) {
    throw new Error(`${label} is empty; production release is blocked.`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`${label} contains duplicate hashes.`);
  }
  return value;
}

export function hashProductionTarget(kind, value) {
  const definition = TARGETS[kind];
  if (!definition) throw new Error("Unknown production target kind.");
  return createHash("sha256")
    .update(definition.normalize(value), "utf8")
    .digest("hex");
}

export function verifyProductionTargets({ policy, scope, targets }) {
  if (!policy || policy.version !== 1) {
    throw new Error("Production release policy version is unsupported.");
  }
  const kinds = TARGET_SCOPES[scope];
  if (!kinds) throw new Error("Production target scope is invalid.");
  const verified = {};
  for (const kind of kinds) {
    const definition = TARGETS[kind];
    const allowed = checkedHashList(
      policy.targetHashes?.[definition.hashKey],
      `targetHashes.${definition.hashKey}`,
    );
    const targetHash = hashProductionTarget(kind, targets?.[kind]);
    if (!allowed.includes(targetHash)) {
      throw new Error(`The ${kind} target is not allowlisted for production.`);
    }
    verified[kind] = targetHash;
  }
  if (
    kinds.includes("workerName") &&
    normalizeName(targets.workerName) !== normalizeName(policy.workerName)
  ) {
    throw new Error("The production Worker name does not match release policy.");
  }
  return verified;
}

export function assertProductionConfirmation(policy, operation, confirmation) {
  const expected = policy?.confirmations?.[operation];
  if (!expected || confirmation !== expected) {
    throw new Error(`Exact ${operation} confirmation phrase is required.`);
  }
}

export function validateImmutableGitSha(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!GIT_SHA.test(normalized)) {
    throw new Error("A full immutable 40-character Git SHA is required.");
  }
  return normalized;
}

export function validateWorkerVersionId(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!UUID.test(normalized)) {
    throw new Error("A valid Worker Version ID is required.");
  }
  return normalized;
}

export function buildProductionSecretBundle(environment, policy) {
  if (!policy || policy.version !== 1) {
    throw new Error("Production release policy version is unsupported.");
  }
  if (environment.LIVE_BILLING_ENABLED === "true") {
    throw new Error(
      "The controlled release workflow cannot enable live billing.",
    );
  }
  for (const name of policy.requiredSecrets ?? []) {
    if (!String(environment[name] ?? "").trim()) {
      throw new Error(`Required production Worker secret ${name} is missing.`);
    }
  }
  for (const group of policy.requiredSecretGroups ?? []) {
    if (
      !Array.isArray(group.anyOf) ||
      !group.anyOf.some((name) => String(environment[name] ?? "").trim())
    ) {
      throw new Error(`Required ${group.label} is missing.`);
    }
  }
  assertSecuritySecretSeparation(environment);
  if (!String(environment.STRIPE_SECRET_KEY).startsWith("sk_test_")) {
    throw new Error(
      "Production Worker upload remains Stripe test-mode only until a separate live-billing release is approved.",
    );
  }
  const names = new Set([
    ...(policy.requiredSecrets ?? []),
    ...(policy.requiredSecretGroups ?? []).flatMap((group) => group.anyOf ?? []),
    ...(policy.optionalSecrets ?? []),
  ]);
  return Object.fromEntries(
    [...names]
      .sort()
      .filter((name) => String(environment[name] ?? "").length > 0)
      .map((name) => [name, environment[name]]),
  );
}

export function parseWranglerVersionUploadOutput(output) {
  const text = String(output ?? "");
  const versionIds = [
    ...text.matchAll(
      /Worker Version ID:\s*([0-9a-f]{8}-[0-9a-f-]{27,})/gi,
    ),
  ].map((match) => validateWorkerVersionId(match[1]));
  const previewUrls = [
    ...text.matchAll(/Version Preview URL:\s*(https:\/\/\S+)/gi),
  ].map((match) => normalizeOrigin(match[1]));
  if (versionIds.length !== 1 || previewUrls.length !== 1) {
    throw new Error(
      "Wrangler upload output must contain exactly one Version ID and preview URL.",
    );
  }
  return { previewUrl: previewUrls[0], versionId: versionIds[0] };
}

export function parseWranglerJson(output, label) {
  try {
    return JSON.parse(String(output ?? ""));
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

export function assertVersionMatchesGitSha({
  artifactSha256,
  gitSha,
  version,
  versionId,
}) {
  const expectedSha = validateImmutableGitSha(gitSha);
  const expectedVersionId = validateWorkerVersionId(versionId);
  if (!version || validateWorkerVersionId(version.id) !== expectedVersionId) {
    throw new Error("Worker version metadata does not match the approved version.");
  }
  const tag = version.annotations?.["workers/tag"];
  const message = version.annotations?.["workers/message"];
  const artifactDigest =
    artifactSha256 === undefined || artifactSha256 === ""
      ? null
      : String(artifactSha256);
  if (
    tag !== `git-${expectedSha}` ||
    typeof message !== "string" ||
    !message.includes(`git_sha=${expectedSha}`) ||
    (artifactDigest !== null &&
      (!/^[0-9a-f]{64}$/.test(artifactDigest) ||
        !message.includes(`artifact_sha256=${artifactDigest}`)))
  ) {
    throw new Error(
      "Worker version metadata does not match the approved immutable Git SHA and artifact.",
    );
  }
}

export function assertActiveDeployment(deployment, versionId) {
  const expectedVersionId = validateWorkerVersionId(versionId);
  if (
    !deployment ||
    !Array.isArray(deployment.versions) ||
    deployment.versions.length !== 1 ||
    validateWorkerVersionId(deployment.versions[0]?.version_id) !==
      expectedVersionId ||
    Number(deployment.versions[0]?.percentage) !== 100
  ) {
    throw new Error(
      "The approved Worker version is not the sole 100% active deployment.",
    );
  }
}

export function assertRollbackDeploymentHistory(
  deployments,
  currentDeployment,
  versionId,
) {
  const expectedVersionId = validateWorkerVersionId(versionId);
  if (!Array.isArray(deployments)) {
    throw new Error("Worker deployment history is missing or invalid.");
  }
  if (
    currentDeployment?.versions?.length === 1 &&
    Number(currentDeployment.versions[0]?.percentage) === 100 &&
    validateWorkerVersionId(currentDeployment.versions[0]?.version_id) ===
      expectedVersionId
  ) {
    throw new Error(
      "The rollback Worker version is already the sole active deployment.",
    );
  }
  const wasActive = deployments.some(
    (deployment) =>
      Array.isArray(deployment?.versions) &&
      deployment.versions.length === 1 &&
      Number(deployment.versions[0]?.percentage) === 100 &&
      validateWorkerVersionId(deployment.versions[0]?.version_id) ===
        expectedVersionId,
  );
  if (!wasActive) {
    throw new Error(
      "The rollback Worker version was not a sole 100% deployment in retained Cloudflare history.",
    );
  }
  return true;
}

export function soleActiveVersionId(deployment) {
  if (
    !deployment ||
    !Array.isArray(deployment.versions) ||
    deployment.versions.length !== 1 ||
    Number(deployment.versions[0]?.percentage) !== 100
  ) {
    throw new Error("Worker deployment must contain one version at 100% traffic.");
  }
  return validateWorkerVersionId(deployment.versions[0]?.version_id);
}

function healthCapabilities(policy, profile) {
  const capabilities =
    profile === "cutover"
      ? policy.cutoverHealthCapabilities
      : profile === "core"
        ? policy.coreHealthCapabilities
        : null;
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new Error(`Production ${profile} health capability policy is missing.`);
  }
  return capabilities;
}

export function assertHealthPayload(
  health,
  configuration,
  policy,
  profile = "core",
) {
  if (
    health?.data?.service !== "vinifera-api" ||
    health?.data?.status !== "ok"
  ) {
    throw new Error("Worker health response is not the Vinifera API contract.");
  }
  for (const capability of healthCapabilities(policy, profile)) {
    if (configuration?.data?.[capability]?.configured !== true) {
      throw new Error(
        `Worker configuration capability ${capability} is not activated.`,
      );
    }
  }
  return true;
}
