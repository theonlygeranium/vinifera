import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const POLICY_PATH = resolve(
  import.meta.dirname,
  "../config/credential-envelope-rotation-policy.json",
);
const OPERATIONS = new Set(["start", "resume", "verify"]);
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sha256(value) {
  return createHash("sha256").update(String(value).trim(), "utf8").digest("hex");
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function normalizeSupabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(requiredString(value, "SUPABASE_URL"));
  } catch {
    throw new Error("The Supabase project URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.endsWith(".supabase.co")
  ) {
    throw new Error("The Supabase project URL must be a canonical HTTPS project origin.");
  }
  return parsed.origin.toLowerCase();
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

export function transitionFingerprint(sourceKeyVersion, targetKeyVersion) {
  if (!KEY_VERSION.test(sourceKeyVersion) || !KEY_VERSION.test(targetKeyVersion)) {
    throw new Error("Credential key versions are invalid.");
  }
  if (sourceKeyVersion === targetKeyVersion) {
    throw new Error("Credential rotation source and target versions must differ.");
  }
  return sha256(`${sourceKeyVersion}->${targetKeyVersion}`);
}

export function validateRotationPolicy(rawPolicy) {
  if (
    rawPolicy === null ||
    typeof rawPolicy !== "object" ||
    rawPolicy.schemaVersion !== 1 ||
    typeof rawPolicy.enabled !== "boolean"
  ) {
    throw new Error("Credential-envelope rotation policy is invalid.");
  }
  if (
    rawPolicy.confirmations?.start !==
      "START VINIFERA CREDENTIAL ENVELOPE ROTATION" ||
    rawPolicy.confirmations?.resume !==
      "RESUME VINIFERA CREDENTIAL ENVELOPE ROTATION" ||
    rawPolicy.confirmations?.verify !==
      "VERIFY VINIFERA CREDENTIAL ENVELOPE ROTATION"
  ) {
    throw new Error("Credential-envelope rotation confirmations are invalid.");
  }
  const defaultSize = positiveInteger(
    rawPolicy.batch?.defaultSize,
    "batch.defaultSize",
  );
  const maximumSize = positiveInteger(
    rawPolicy.batch?.maximumSize,
    "batch.maximumSize",
  );
  const maximumBatchesPerRun = positiveInteger(
    rawPolicy.batch?.maximumBatchesPerRun,
    "batch.maximumBatchesPerRun",
  );
  const leaseSeconds = positiveInteger(
    rawPolicy.batch?.leaseSeconds,
    "batch.leaseSeconds",
  );
  if (
    maximumSize > 500 ||
    defaultSize > maximumSize ||
    maximumBatchesPerRun > 1_000 ||
    leaseSeconds < 30 ||
    leaseSeconds > 900
  ) {
    throw new Error("Credential-envelope rotation batch boundaries are invalid.");
  }
  return {
    ...rawPolicy,
    allowedTransitionSha256: checkedHashList(
      rawPolicy.allowedTransitionSha256,
      "allowedTransitionSha256",
    ),
    batch: {
      defaultSize,
      leaseSeconds,
      maximumBatchesPerRun,
      maximumSize,
    },
    supabaseProjectUrlSha256: checkedHashList(
      rawPolicy.supabaseProjectUrlSha256,
      "supabaseProjectUrlSha256",
    ),
  };
}

export function parseCredentialKeyring(env = process.env) {
  const activeVersion = requiredString(
    env.INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION,
    "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION",
  );
  if (!KEY_VERSION.test(activeVersion)) {
    throw new Error("The active credential key version is invalid.");
  }
  let parsed;
  try {
    parsed = JSON.parse(
      requiredString(
        env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS,
        "INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS",
      ),
    );
  } catch {
    throw new Error("The credential keyring is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The credential keyring is invalid.");
  }
  const keys = Object.fromEntries(
    Object.entries(parsed).map(([version, encoded]) => {
      if (!KEY_VERSION.test(version) || typeof encoded !== "string") {
        throw new Error("The credential keyring is invalid.");
      }
      const decoded = Buffer.from(encoded, "base64");
      if (decoded.byteLength !== 32) {
        throw new Error("Credential envelope keys must be 256 bits.");
      }
      return [version, decoded];
    }),
  );
  if (!keys[activeVersion]) {
    throw new Error("The active credential key is absent from the keyring.");
  }
  return { activeVersion, keys };
}

function aad(context, keyVersion) {
  return Buffer.from(
    JSON.stringify({
      integrationType: context.integrationType,
      keyVersion,
      organizationId: context.organizationId,
      purpose: "vinifera-integration-credentials",
      targetId: context.targetId,
      version: 1,
    }),
    "utf8",
  );
}

export function encryptCredentialEnvelopeForTest(
  keyring,
  context,
  credentials,
  keyVersion,
  iv = randomBytes(12),
) {
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  if (plaintext.byteLength > 32_768) {
    plaintext.fill(0);
    throw new Error("Credential plaintext exceeds the supported size.");
  }
  try {
    const cipher = createCipheriv("aes-256-gcm", keyring.keys[keyVersion], iv);
    cipher.setAAD(aad(context, keyVersion));
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);
    return {
      algorithm: "A256GCM",
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      keyVersion,
      version: 1,
    };
  } finally {
    plaintext.fill(0);
  }
}

export function rewrapCredentialEnvelope(keyring, context, envelope, targetVersion) {
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== "A256GCM" ||
    !KEY_VERSION.test(envelope.keyVersion) ||
    !KEY_VERSION.test(targetVersion) ||
    !keyring.keys[envelope.keyVersion] ||
    !keyring.keys[targetVersion]
  ) {
    throw new Error("Credential envelope or key version is unavailable.");
  }
  const sourceCiphertext = Buffer.from(envelope.ciphertext, "base64");
  const sourceIv = Buffer.from(envelope.iv, "base64");
  if (sourceIv.byteLength !== 12 || sourceCiphertext.byteLength < 17) {
    throw new Error("Credential envelope encoding is invalid.");
  }
  const encrypted = sourceCiphertext.subarray(0, -16);
  const tag = sourceCiphertext.subarray(-16);
  let plaintext;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyring.keys[envelope.keyVersion],
      sourceIv,
    );
    decipher.setAAD(aad(context, envelope.keyVersion));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    JSON.parse(plaintext.toString("utf8"));
    const targetIv = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      keyring.keys[targetVersion],
      targetIv,
    );
    cipher.setAAD(aad(context, targetVersion));
    const replacement = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const replacementWithTag = Buffer.concat([
      replacement,
      cipher.getAuthTag(),
    ]);
    return {
      algorithm: "A256GCM",
      ciphertext: replacementWithTag.toString("base64"),
      iv: targetIv.toString("base64"),
      keyVersion: targetVersion,
      version: 1,
    };
  } catch {
    throw new Error("Credential envelope rewrap failed.");
  } finally {
    plaintext?.fill(0);
    sourceCiphertext.fill(0);
  }
}

export function assertRotationAuthority(
  policy,
  operation,
  sourceKeyVersion,
  targetKeyVersion,
  env = process.env,
) {
  if (!OPERATIONS.has(operation)) {
    throw new Error("Credential-envelope rotation operation is invalid.");
  }
  if (!policy.enabled) {
    throw new Error("Credential-envelope rotation is disabled by reviewed policy.");
  }
  if (env.CREDENTIAL_ROTATION_CONFIRMATION !== policy.confirmations[operation]) {
    throw new Error(`Exact ${operation} confirmation phrase is required.`);
  }
  const gitSha = requiredString(env.CREDENTIAL_ROTATION_GIT_SHA, "git SHA");
  if (!/^[a-f0-9]{40}$/.test(gitSha)) {
    throw new Error("A full immutable main-branch Git SHA is required.");
  }
  const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  if (!policy.supabaseProjectUrlSha256.includes(sha256(supabaseUrl))) {
    throw new Error("The Supabase project target is not allowlisted.");
  }
  const transitionSha256 = transitionFingerprint(
    sourceKeyVersion,
    targetKeyVersion,
  );
  if (!policy.allowedTransitionSha256.includes(transitionSha256)) {
    throw new Error("The credential key-version transition is not allowlisted.");
  }
  return { gitSha, supabaseUrl, transitionSha256 };
}

function serviceRoleCredential(env) {
  const credential =
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    env.SUPABASE_SECRET_KEY?.trim();
  if (!credential || credential.length < 20 || /\s/.test(credential)) {
    throw new Error("A server-only Supabase service credential is required.");
  }
  return credential;
}

export function createSupabaseRpcClient(env = process.env, fetcher = fetch) {
  const baseUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  const credential = serviceRoleCredential(env);
  return async (functionName, parameters) => {
    const response = await fetcher(
      `${baseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
      {
        body: JSON.stringify(parameters),
        headers: {
          apikey: credential,
          Authorization: `Bearer ${credential}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error(`Credential rotation RPC ${functionName} failed.`);
    }
    return response.status === 204 ? null : response.json();
  };
}

function checkedUuid(value, label) {
  const normalized = requiredString(value, label).toLowerCase();
  if (!UUID.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function claimedEnvelope(row, sourceKeyVersion) {
  if (
    !row ||
    !["integration", "meta_attribution", "mobile_push"].includes(
      row.secret_kind,
    ) ||
    row.envelope_version !== 1 ||
    row.algorithm !== "A256GCM" ||
    row.key_version !== sourceKeyVersion ||
    typeof row.ciphertext !== "string" ||
    typeof row.iv !== "string"
  ) {
    throw new Error("Claimed credential envelope is invalid.");
  }
  return {
    context: {
      integrationType: requiredString(row.integration_type, "integration type"),
      organizationId: checkedUuid(row.organization_id, "organization ID"),
      targetId: checkedUuid(row.target_id, "target ID"),
    },
    envelope: {
      algorithm: row.algorithm,
      ciphertext: row.ciphertext,
      iv: row.iv,
      keyVersion: row.key_version,
      version: row.envelope_version,
    },
    leaseToken: checkedUuid(row.lease_token, "lease token"),
    secretId: checkedUuid(row.secret_id, "secret ID"),
    secretKind: row.secret_kind,
  };
}

function normalizeStatus(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !UUID.test(value.runId ?? "") ||
    !["running", "verified", "failed"].includes(value.status)
  ) {
    throw new Error("Credential rotation status is invalid.");
  }
  const counts = [
    "failedItems",
    "oldIntegrationEnvelopes",
    "oldMetaAttributionEnvelopes",
    "oldMobileEnvelopes",
    "pendingItems",
    "processingItems",
    "rotatedItems",
    "skippedItems",
    "totalItems",
  ];
  for (const name of counts) {
    if (!Number.isSafeInteger(value[name]) || value[name] < 0) {
      throw new Error("Credential rotation status counts are invalid.");
    }
  }
  return Object.fromEntries([
    ...Object.entries(value).filter(([name]) => counts.includes(name)),
    ["runId", value.runId],
    ["status", value.status],
    ["oldKeyCountVerifiedZero", value.oldKeyCountVerifiedZero === true],
  ]);
}

export async function runCredentialEnvelopeRotation({
  batchSize,
  env = process.env,
  maxBatches,
  operation,
  policy,
  rpc = createSupabaseRpcClient(env),
  runId = null,
  sourceKeyVersion,
  targetKeyVersion,
}) {
  const authority = assertRotationAuthority(
    policy,
    operation,
    sourceKeyVersion,
    targetKeyVersion,
    env,
  );
  const keyring = parseCredentialKeyring(env);
  if (keyring.activeVersion !== targetKeyVersion) {
    throw new Error("The rotation target must already be the active envelope key.");
  }
  if (!keyring.keys[sourceKeyVersion]) {
    throw new Error("The source envelope key must remain available until verification.");
  }
  const boundedBatchSize = positiveInteger(
    batchSize ?? policy.batch.defaultSize,
    "batch size",
  );
  const boundedMaxBatches = positiveInteger(
    maxBatches ?? policy.batch.maximumBatchesPerRun,
    "maximum batches",
  );
  if (
    boundedBatchSize > policy.batch.maximumSize ||
    boundedMaxBatches > policy.batch.maximumBatchesPerRun
  ) {
    throw new Error("Requested credential rotation bounds exceed policy.");
  }
  let activeRunId = runId ? checkedUuid(runId, "rotation run ID") : null;
  if (operation === "start") {
    if (activeRunId) throw new Error("A new rotation cannot reuse an existing run ID.");
    activeRunId = checkedUuid(
      await rpc("start_credential_envelope_rotation", {
        p_batch_size: boundedBatchSize,
        p_requested_git_sha: authority.gitSha,
        p_source_key_version: sourceKeyVersion,
        p_target_key_version: targetKeyVersion,
      }),
      "rotation run ID",
    );
  } else if (!activeRunId) {
    throw new Error(`${operation} requires an existing rotation run ID.`);
  }

  if (operation === "verify") {
    return normalizeStatus(
      await rpc("verify_credential_envelope_rotation", {
        p_run_id: activeRunId,
      }),
    );
  }

  const leaseOwner = `github:${env.GITHUB_RUN_ID ?? "local"}:${env.GITHUB_RUN_ATTEMPT ?? "1"}`;
  let processedBatches = 0;
  let processedItems = 0;
  for (; processedBatches < boundedMaxBatches; processedBatches += 1) {
    const claimed = await rpc("claim_credential_envelope_rotation_batch", {
      p_lease_owner: leaseOwner,
      p_lease_seconds: policy.batch.leaseSeconds,
      p_run_id: activeRunId,
    });
    if (!Array.isArray(claimed)) {
      throw new Error("Credential rotation claim response is invalid.");
    }
    if (claimed.length === 0) break;
    if (claimed.length > boundedBatchSize) {
      throw new Error("Credential rotation claim exceeded the reviewed batch bound.");
    }
    for (const row of claimed) {
      const item = claimedEnvelope(row, sourceKeyVersion);
      try {
        const replacement = rewrapCredentialEnvelope(
          keyring,
          item.context,
          item.envelope,
          targetKeyVersion,
        );
        const disposition = await rpc(
          "complete_credential_envelope_rotation_item",
          {
            p_algorithm: replacement.algorithm,
            p_ciphertext: replacement.ciphertext,
            p_envelope_version: replacement.version,
            p_iv: replacement.iv,
            p_key_version: replacement.keyVersion,
            p_lease_token: item.leaseToken,
            p_run_id: activeRunId,
            p_secret_id: item.secretId,
            p_secret_kind: item.secretKind,
            p_source_ciphertext: item.envelope.ciphertext,
            p_source_iv: item.envelope.iv,
          },
        );
        if (!["rotated", "skipped"].includes(disposition)) {
          throw new Error("Credential rotation completion response is invalid.");
        }
        processedItems += 1;
      } catch {
        await rpc("release_credential_envelope_rotation_item", {
          p_error_code: "REWRAP_FAILED",
          p_lease_token: item.leaseToken,
          p_run_id: activeRunId,
          p_secret_id: item.secretId,
          p_secret_kind: item.secretKind,
        });
        throw new Error("Credential envelope rewrap batch failed closed.");
      }
    }
  }

  let status = normalizeStatus(
    await rpc("get_credential_envelope_rotation_status", {
      p_run_id: activeRunId,
    }),
  );
  const oldKeyCount =
    status.oldIntegrationEnvelopes +
    status.oldMetaAttributionEnvelopes +
    status.oldMobileEnvelopes;
  const unfinished =
    status.pendingItems + status.processingItems + status.failedItems;
  if (oldKeyCount === 0 && unfinished === 0) {
    status = normalizeStatus(
      await rpc("verify_credential_envelope_rotation", {
        p_run_id: activeRunId,
      }),
    );
  }
  return {
    ...status,
    processedBatches,
    processedItems,
    resumeRequired: status.status !== "verified",
    sourceKeyVersionSha256: sha256(sourceKeyVersion),
    targetKeyVersionSha256: sha256(targetKeyVersion),
    transitionSha256: authority.transitionSha256,
  };
}

async function writeSanitizedReport(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function main(arguments_, env = process.env) {
  const [command, operation, ...rest] = arguments_;
  const option = (name) => {
    const index = rest.indexOf(name);
    return index === -1 ? null : rest[index + 1];
  };
  if (command !== "execute" || !OPERATIONS.has(operation)) {
    throw new Error(
      "Usage: credential-envelope-rotation.mjs execute <start|resume|verify> --source <version> --target <version> --report <path> [--run-id <uuid>] [--batch-size <n>] [--max-batches <n>].",
    );
  }
  const reportPath = requiredString(option("--report"), "report path");
  let durableReportWritten = false;
  try {
    const rawPolicy = JSON.parse(await readFile(POLICY_PATH, "utf8"));
    const policy = validateRotationPolicy(rawPolicy);
    const result = await runCredentialEnvelopeRotation({
      batchSize: option("--batch-size"),
      env,
      maxBatches: option("--max-batches"),
      operation,
      policy,
      runId: option("--run-id"),
      sourceKeyVersion: requiredString(option("--source"), "source key version"),
      targetKeyVersion: requiredString(option("--target"), "target key version"),
    });
    await writeSanitizedReport(reportPath, {
      ...result,
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
    });
    durableReportWritten = true;
    if (result.resumeRequired) {
      throw new Error("Credential rotation is incomplete; resume the durable run.");
    }
  } catch (error) {
    if (!durableReportWritten) {
      try {
        await writeSanitizedReport(reportPath, {
          errorCode: "CREDENTIAL_ROTATION_FAILED",
          operation,
          schemaVersion: 1,
          verified: false,
        });
      } catch {
        // Preserve the original fail-closed result when evidence writing also fails.
      }
    }
    throw error;
  }
}

const isEntrypoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntrypoint) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "Credential rotation failed.");
    process.exitCode = 1;
  });
}
