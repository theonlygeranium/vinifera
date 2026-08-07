import {
  createHash,
  createPublicKey,
  verify,
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const appIdentity = JSON.parse(
  await readFile(new URL("../mobile/app-identity.json", import.meta.url), "utf8"),
);
const APP_ID = appIdentity.appId;
const PLATFORMS = Object.freeze(["android", "ios"]);
const RELEASE_TARGETS = Object.freeze({
  android: "google-play-internal",
  ios: "testflight-internal-only",
});
const STORE_SOURCES = Object.freeze({
  android: "google-play-internal",
  ios: "testflight-internal",
});
const GATE17_CHECKS = Object.freeze([
  "magicLink",
  "brandDisambiguation",
  "secureStorage",
  "sessionRevocation",
  "biometricFallback",
  "foregroundRelock",
  "pushForeground",
  "pushBackground",
  "pushTap",
  "cameraPermission",
  "cameraScan",
  "offlineRestore",
  "reconnect",
  "accessibility",
  "privacyMetadata",
  "storeMetadata",
]);
const GATE18_CHECKS = Object.freeze([
  "storeProcessingAvailable",
  "installed",
  "launched",
]);

function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

function requireExactKeys(value, keys, label) {
  if (!hasExactKeys(value, keys)) {
    throw new Error(`${label} has missing or unexpected fields.`);
  }
}

function isSha(value) {
  return /^[0-9a-f]{40}$/.test(value ?? "");
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/.test(value ?? "");
}

function isRunId(value) {
  return /^[1-9][0-9]{0,19}$/.test(String(value ?? ""));
}

function strictBase64(value, label, { minimumBytes = 1, maximumBytes }) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error(`${label} is not canonical base64.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.length < minimumBytes ||
    decoded.length > maximumBytes ||
    decoded.toString("base64") !== value
  ) {
    throw new Error(`${label} is not canonical base64.`);
  }
  return decoded;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function timestamp(value, label) {
  const milliseconds = Date.parse(value ?? "");
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new Error(`${label} is not an ISO timestamp.`);
  }
  return milliseconds;
}

function validateBooleanChecks(checks, names, label) {
  requireExactKeys(checks, names, label);
  for (const name of names) {
    if (checks[name] !== true) {
      throw new Error(`${label}.${name} did not pass.`);
    }
  }
}

export function validatePolicy(policy) {
  requireExactKeys(
    policy,
    [
      "schemaVersion",
      "enabled",
      "repository",
      "environment",
      "releaseWorkflowName",
      "acceptanceWorkflowName",
      "confirmation",
      "maximumEvidenceAgeHours",
      "maximumFutureSkewMinutes",
      "allowedEvidencePublicKeySha256",
      "allowedApiOriginSha256",
      "allowedSigningIdentitySha256",
    ],
    "Mobile acceptance policy",
  );
  requireExactKeys(policy.confirmation, ["17", "18"], "Policy confirmation");
  requireExactKeys(
    policy.allowedSigningIdentitySha256,
    ["android", "ios"],
    "Signing identity policy",
  );
  if (
    policy.schemaVersion !== 1 ||
    typeof policy.enabled !== "boolean" ||
    policy.repository !== "theonlygeranium/vinifera" ||
    policy.environment !== "mobile-release" ||
    policy.releaseWorkflowName !== "Signed mobile internal release" ||
    policy.acceptanceWorkflowName !== "Mobile activation acceptance" ||
    !Number.isInteger(policy.maximumEvidenceAgeHours) ||
    policy.maximumEvidenceAgeHours < 1 ||
    policy.maximumEvidenceAgeHours > 72 ||
    !Number.isInteger(policy.maximumFutureSkewMinutes) ||
    policy.maximumFutureSkewMinutes < 0 ||
    policy.maximumFutureSkewMinutes > 15 ||
    !Array.isArray(policy.allowedEvidencePublicKeySha256) ||
    !policy.allowedEvidencePublicKeySha256.every(isSha256) ||
    new Set(policy.allowedEvidencePublicKeySha256).size !==
      policy.allowedEvidencePublicKeySha256.length ||
    !Array.isArray(policy.allowedApiOriginSha256) ||
    !policy.allowedApiOriginSha256.every(isSha256) ||
    new Set(policy.allowedApiOriginSha256).size !==
      policy.allowedApiOriginSha256.length ||
    !PLATFORMS.every((platform) =>
      Array.isArray(policy.allowedSigningIdentitySha256[platform]) &&
      policy.allowedSigningIdentitySha256[platform].every(isSha256) &&
      new Set(policy.allowedSigningIdentitySha256[platform]).size ===
        policy.allowedSigningIdentitySha256[platform].length)
  ) {
    throw new Error("Mobile acceptance policy is invalid.");
  }
  for (const gate of ["17", "18"]) {
    if (
      typeof policy.confirmation[gate] !== "string" ||
      policy.confirmation[gate].length < 20
    ) {
      throw new Error("Mobile acceptance confirmation policy is invalid.");
    }
  }
  return policy;
}

export function validateRequest({
  confirmation,
  gate,
  gate17AcceptanceRunId,
  gitSha,
  policy,
  releaseRunId,
}) {
  validatePolicy(policy);
  if (!policy.enabled) {
    throw new Error("Mobile activation acceptance is disabled by policy.");
  }
  if (!["17", "18"].includes(gate)) {
    throw new Error("Mobile acceptance gate must be 17 or 18.");
  }
  if (!isSha(gitSha) || !isRunId(releaseRunId)) {
    throw new Error("Mobile acceptance commit or release run is invalid.");
  }
  if (confirmation !== policy.confirmation[gate]) {
    throw new Error("Mobile acceptance confirmation is not exact.");
  }
  if (gate === "17" && String(gate17AcceptanceRunId ?? "") !== "") {
    throw new Error("Gate 17 must not supply a prior Gate 17 run.");
  }
  if (gate === "18" && !isRunId(gate17AcceptanceRunId)) {
    throw new Error("Gate 18 requires a prior Gate 17 acceptance run.");
  }
  return { gate, gitSha, releaseRunId: String(releaseRunId) };
}

export function validateWorkflowRun({
  expectedGitSha,
  expectedName,
  expectedPath,
  expectedRepository,
  expectedRunId,
  run,
}) {
  const repository = run?.repository?.full_name ?? run?.repository?.fullName;
  if (
    String(run?.id ?? run?.databaseId ?? "") !== String(expectedRunId) ||
    (run?.name ?? run?.workflowName) !== expectedName ||
    run?.path !== expectedPath ||
    run?.event !== "workflow_dispatch" ||
    (run?.head_branch ?? run?.headBranch) !== "main" ||
    (run?.head_sha ?? run?.headSha) !== expectedGitSha ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    repository !== expectedRepository
  ) {
    throw new Error("Referenced workflow run is not an exact successful main run.");
  }
  return true;
}

export function validateReleaseEvidence({ action, evidence, gitSha, platform }) {
  requireExactKeys(
    evidence,
    [
      "schemaVersion",
      "generatedAt",
      "gitSha",
      "platform",
      "readOnlyEvidence",
      "releaseAction",
      "signedBuild",
      "signatureVerified",
      "upload",
    ],
    `${platform} release evidence`,
  );
  requireExactKeys(
    evidence.upload,
    ["requested", "result", "target"],
    `${platform} upload evidence`,
  );
  if (
    evidence.schemaVersion !== 1 ||
    evidence.gitSha !== gitSha ||
    evidence.platform !== platform ||
    evidence.readOnlyEvidence !== true ||
    evidence.releaseAction !== action ||
    evidence.signedBuild !== true ||
    evidence.signatureVerified !== true ||
    evidence.upload.target !== RELEASE_TARGETS[platform]
  ) {
    throw new Error(`${platform} release evidence is not bound to the target.`);
  }
  if (action === "upload-internal") {
    if (
      evidence.upload.requested !== true ||
      evidence.upload.result !== "success"
    ) {
      throw new Error(`${platform} internal upload did not succeed.`);
    }
  } else if (
    evidence.upload.requested !== false ||
    !["skipped", "unknown"].includes(evidence.upload.result)
  ) {
    throw new Error(`${platform} build-only evidence contains an upload result.`);
  }
  timestamp(evidence.generatedAt, `${platform} release generatedAt`);
  return true;
}

function validateCommonAttestation({ attestation, gate, gitSha, now, policy, releaseRunId }) {
  requireExactKeys(
    attestation,
    [
      "schemaVersion",
      "gate",
      "repository",
      "environment",
      "gitSha",
      "releaseRunId",
      "releaseAction",
      "app",
      "testedAt",
      "apiOriginSha256",
      "platforms",
    ],
    "Mobile acceptance attestation",
  );
  requireExactKeys(attestation.app, ["id", "versionCode", "versionName"], "Attested app");
  const testedAt = timestamp(attestation.testedAt, "Attestation testedAt");
  const nowMilliseconds = now.getTime();
  if (
    attestation.schemaVersion !== 1 ||
    String(attestation.gate) !== gate ||
    attestation.repository !== policy.repository ||
    attestation.environment !== "production" ||
    attestation.gitSha !== gitSha ||
    String(attestation.releaseRunId) !== String(releaseRunId) ||
    !["build-only", "upload-internal"].includes(attestation.releaseAction) ||
    attestation.app.id !== APP_ID ||
    attestation.app.versionCode !== appIdentity.versionCode ||
    attestation.app.versionName !== appIdentity.versionName ||
    !isSha256(attestation.apiOriginSha256) ||
    !policy.allowedApiOriginSha256.includes(attestation.apiOriginSha256) ||
    !Array.isArray(attestation.platforms) ||
    attestation.platforms.length !== 2 ||
    testedAt > nowMilliseconds + policy.maximumFutureSkewMinutes * 60_000 ||
    testedAt < nowMilliseconds - policy.maximumEvidenceAgeHours * 3_600_000
  ) {
    throw new Error("Mobile acceptance attestation is invalid or stale.");
  }
  const names = attestation.platforms.map((entry) => entry?.platform).sort();
  if (names.join(",") !== "android,ios") {
    throw new Error("Mobile acceptance requires exactly Android and iOS evidence.");
  }
}

function validatePlatformIdentity(platform, label, policy) {
  if (
    !PLATFORMS.includes(platform.platform) ||
    typeof platform.osVersion !== "string" ||
    platform.osVersion.length < 1 ||
    platform.osVersion.length > 64 ||
    !isSha256(platform.deviceEvidenceSha256) ||
    !isSha256(platform.signingIdentitySha256) ||
    !policy.allowedSigningIdentitySha256[platform.platform]?.includes(
      platform.signingIdentitySha256,
    )
  ) {
    throw new Error(`${label} platform identity is invalid.`);
  }
}

export function validateGate17Attestation(context) {
  const { attestation } = context;
  validateCommonAttestation({ ...context, gate: "17" });
  for (const platform of attestation.platforms) {
    requireExactKeys(
      platform,
      [
        "platform",
        "osVersion",
        "deviceEvidenceSha256",
        "signingIdentitySha256",
        "distributionSignatureVerified",
        "pushProvider",
        "checks",
      ],
      "Gate 17 platform evidence",
    );
    validatePlatformIdentity(platform, "Gate 17", context.policy);
    if (
      platform.distributionSignatureVerified !== true ||
      platform.pushProvider !== (platform.platform === "ios" ? "apns" : "fcm")
    ) {
      throw new Error("Gate 17 signing or push-provider evidence is invalid.");
    }
    validateBooleanChecks(platform.checks, GATE17_CHECKS, "Gate 17 checks");
  }
  return true;
}

export function validateGate18Attestation(context) {
  const { attestation } = context;
  validateCommonAttestation({ ...context, gate: "18" });
  if (attestation.releaseAction !== "upload-internal") {
    throw new Error("Gate 18 requires an upload-internal release action.");
  }
  for (const platform of attestation.platforms) {
    requireExactKeys(
      platform,
      [
        "platform",
        "osVersion",
        "deviceEvidenceSha256",
        "signingIdentitySha256",
        "installSource",
        "checks",
      ],
      "Gate 18 platform evidence",
    );
    validatePlatformIdentity(platform, "Gate 18", context.policy);
    if (platform.installSource !== STORE_SOURCES[platform.platform]) {
      throw new Error("Gate 18 install source is not the required internal track.");
    }
    validateBooleanChecks(platform.checks, GATE18_CHECKS, "Gate 18 checks");
  }
  return true;
}

export function verifySignedAttestation({ attestationBytes, policy, publicKeyPem, signature }) {
  validatePolicy(policy);
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new Error("Mobile evidence public key is invalid.");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Mobile evidence public key must be Ed25519.");
  }
  const keyHash = createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("hex");
  if (!policy.allowedEvidencePublicKeySha256.includes(keyHash)) {
    throw new Error("Mobile evidence public key is not authorized by policy.");
  }
  if (!verify(null, attestationBytes, publicKey, signature)) {
    throw new Error("Mobile acceptance attestation signature is invalid.");
  }
  return keyHash;
}

export function validatePriorGate17Evidence({ evidence, gitSha, releaseRunId }) {
  requireExactKeys(
    evidence,
    [
      "schemaVersion",
      "gate",
      "repository",
      "environment",
      "gitSha",
      "releaseRunId",
      "releaseAction",
      "accepted",
      "attestationSha256",
      "publicKeySha256",
      "generatedAt",
    ],
    "Prior Gate 17 acceptance evidence",
  );
  if (
    evidence.schemaVersion !== 1 ||
    evidence.gate !== 17 ||
    evidence.repository !== "theonlygeranium/vinifera" ||
    evidence.environment !== "production" ||
    evidence.gitSha !== gitSha ||
    String(evidence.releaseRunId) !== String(releaseRunId) ||
    evidence.releaseAction !== "upload-internal" ||
    evidence.accepted !== true ||
    !isSha256(evidence.attestationSha256) ||
    !isSha256(evidence.publicKeySha256)
  ) {
    throw new Error("Prior Gate 17 evidence is not bound to this release.");
  }
  timestamp(evidence.generatedAt, "Prior Gate 17 generatedAt");
  return true;
}

export function acceptanceEvidence({
  attestationBytes,
  gate,
  gitSha,
  keyHash,
  releaseAction,
  releaseRunId,
  now = new Date(),
}) {
  return {
    schemaVersion: 1,
    gate: Number(gate),
    repository: "theonlygeranium/vinifera",
    environment: "production",
    gitSha,
    releaseRunId: String(releaseRunId),
    releaseAction,
    accepted: true,
    attestationSha256: createHash("sha256").update(attestationBytes).digest("hex"),
    publicKeySha256: keyHash,
    generatedAt: now.toISOString(),
  };
}

async function writePrivate(path, bytes) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  await writeFile(absolute, bytes, { mode: 0o600 });
}

function argumentsMap(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Mobile acceptance arguments are invalid.");
    }
    options[key.slice(2)] = value;
  }
  return { command, options };
}

async function loadJson(path, label) {
  return parseJson(await readFile(resolve(path)), label);
}

async function main() {
  const { command, options } = argumentsMap(process.argv.slice(2));
  if (command === "validate-request") {
    const policy = await loadJson(options.policy, "Policy");
    validateRequest({
      confirmation: process.env.MOBILE_ACCEPTANCE_CONFIRMATION,
      gate: options.gate,
      gate17AcceptanceRunId: options["gate17-run-id"] ?? "",
      gitSha: options["git-sha"],
      policy,
      releaseRunId: options["release-run-id"],
    });
    return;
  }
  if (command === "materialize") {
    await writePrivate(
      options.attestation,
      strictBase64(process.env.MOBILE_ACCEPTANCE_ATTESTATION_BASE64, "Attestation", {
        minimumBytes: 200,
        maximumBytes: 32_768,
      }),
    );
    await writePrivate(
      options.signature,
      strictBase64(process.env.MOBILE_ACCEPTANCE_SIGNATURE_BASE64, "Signature", {
        minimumBytes: 64,
        maximumBytes: 64,
      }),
    );
    await writePrivate(
      options["public-key"],
      strictBase64(process.env.MOBILE_ACCEPTANCE_PUBLIC_KEY_BASE64, "Public key", {
        minimumBytes: 64,
        maximumBytes: 4_096,
      }),
    );
    return;
  }
  if (command !== "validate") {
    throw new Error("Unsupported mobile acceptance command.");
  }

  const policy = await loadJson(options.policy, "Policy");
  const gate = options.gate;
  const request = validateRequest({
    confirmation: process.env.MOBILE_ACCEPTANCE_CONFIRMATION,
    gate,
    gate17AcceptanceRunId: options["gate17-run-id"] ?? "",
    gitSha: options["git-sha"],
    policy,
    releaseRunId: options["release-run-id"],
  });
  const [attestationBytes, signature, publicKeyPem, releaseRun, androidEvidence, iosEvidence] =
    await Promise.all([
      readFile(resolve(options.attestation)),
      readFile(resolve(options.signature)),
      readFile(resolve(options["public-key"])),
      loadJson(options["release-run"], "Release workflow run"),
      loadJson(options.android, "Android release evidence"),
      loadJson(options.ios, "iOS release evidence"),
    ]);
  const attestation = parseJson(attestationBytes, "Attestation");
  const keyHash = verifySignedAttestation({
    attestationBytes,
    policy,
    publicKeyPem,
    signature,
  });
  validateWorkflowRun({
    expectedGitSha: request.gitSha,
    expectedName: policy.releaseWorkflowName,
    expectedPath: ".github/workflows/mobile-release.yml",
    expectedRepository: policy.repository,
    expectedRunId: request.releaseRunId,
    run: releaseRun,
  });
  const releaseAction = gate === "18" ? "upload-internal" : attestation.releaseAction;
  if (gate === "17" && !["build-only", "upload-internal"].includes(releaseAction)) {
    throw new Error("Gate 17 release action is invalid.");
  }
  for (const [platform, evidence] of [["android", androidEvidence], ["ios", iosEvidence]]) {
    validateReleaseEvidence({ action: releaseAction, evidence, gitSha: request.gitSha, platform });
  }
  const context = {
    attestation,
    gitSha: request.gitSha,
    now: new Date(),
    policy,
    releaseRunId: request.releaseRunId,
  };
  if (gate === "17") {
    validateGate17Attestation(context);
  } else {
    validateGate18Attestation(context);
    const [priorRun, priorEvidence] = await Promise.all([
      loadJson(options["gate17-run"], "Gate 17 workflow run"),
      loadJson(options["gate17-evidence"], "Gate 17 acceptance evidence"),
    ]);
    validateWorkflowRun({
      expectedGitSha: request.gitSha,
      expectedName: policy.acceptanceWorkflowName,
      expectedPath: ".github/workflows/mobile-acceptance.yml",
      expectedRepository: policy.repository,
      expectedRunId: options["gate17-run-id"],
      run: priorRun,
    });
    validatePriorGate17Evidence({
      evidence: priorEvidence,
      gitSha: request.gitSha,
      releaseRunId: request.releaseRunId,
    });
  }
  const evidence = acceptanceEvidence({
    attestationBytes,
    gate,
    gitSha: request.gitSha,
    keyHash,
    releaseAction,
    releaseRunId: request.releaseRunId,
  });
  await writePrivate(options.output, `${JSON.stringify(evidence, null, 2)}\n`);
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Mobile acceptance failed.");
    process.exitCode = 1;
  });
}

export const mobileAcceptanceConstants = Object.freeze({
  appId: APP_ID,
  gate17Checks: GATE17_CHECKS,
  gate18Checks: GATE18_CHECKS,
  releaseTargets: RELEASE_TARGETS,
  storeSources: STORE_SOURCES,
});
