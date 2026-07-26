import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertRotationAuthority,
  encryptCredentialEnvelopeForTest,
  parseCredentialKeyring,
  rewrapCredentialEnvelope,
  runCredentialEnvelopeRotation,
  sha256,
  transitionFingerprint,
  validateRotationPolicy,
} from "../../scripts/credential-envelope-rotation.mjs";
import { decryptIntegrationCredentials } from "../../server/integrations/security";

const sourceVersion = "key-2026-01";
const targetVersion = "key-2026-07";
const projectUrl = "https://vinifera.supabase.co";
const runId = "123e4567-e89b-42d3-a456-426614174000";
const organizationId = "223e4567-e89b-42d3-a456-426614174000";
const integrationId = "323e4567-e89b-42d3-a456-426614174000";
const mobileId = "423e4567-e89b-42d3-a456-426614174000";
const metaAttributionId = "723e4567-e89b-42d3-a456-426614174000";
const leaseOne = "523e4567-e89b-42d3-a456-426614174000";
const leaseTwo = "623e4567-e89b-42d3-a456-426614174000";
const leaseThree = "823e4567-e89b-42d3-a456-426614174000";

function rawPolicy(overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    confirmations: {
      start: "START VINIFERA CREDENTIAL ENVELOPE ROTATION",
      resume: "RESUME VINIFERA CREDENTIAL ENVELOPE ROTATION",
      verify: "VERIFY VINIFERA CREDENTIAL ENVELOPE ROTATION",
    },
    supabaseProjectUrlSha256: [sha256(projectUrl)],
    allowedTransitionSha256: [
      transitionFingerprint(sourceVersion, targetVersion),
    ],
    batch: {
      defaultSize: 100,
      maximumSize: 500,
      maximumBatchesPerRun: 100,
      leaseSeconds: 120,
    },
    ...overrides,
  };
}

function environment(overrides = {}) {
  return {
    CREDENTIAL_ROTATION_CONFIRMATION:
      "START VINIFERA CREDENTIAL ENVELOPE ROTATION",
    CREDENTIAL_ROTATION_GIT_SHA: "a".repeat(40),
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "12345",
    INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: targetVersion,
    INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
      [sourceVersion]: randomBytes(32).toString("base64"),
      [targetVersion]: randomBytes(32).toString("base64"),
    }),
    SUPABASE_SERVICE_ROLE_KEY: "service-role-credential-not-a-real-secret",
    SUPABASE_URL: projectUrl,
    ...overrides,
  };
}

function contexts() {
  return {
    integration: {
      integrationType: "quickbooks",
      organizationId,
      targetId: integrationId,
    },
    mobile: {
      integrationType: "mobile_push_token",
      organizationId,
      targetId: mobileId,
    },
    metaAttribution: {
      integrationType: "meta_attribution",
      organizationId,
      targetId: metaAttributionId,
    },
  };
}

function fakeRotationRpc(env) {
  const keyring = parseCredentialKeyring(env);
  const context = contexts();
  const integrationEnvelope = encryptCredentialEnvelopeForTest(
    keyring,
    context.integration,
    { refreshToken: "integration-secret" },
    sourceVersion,
    Buffer.alloc(12, 1),
  );
  const mobileEnvelope = encryptCredentialEnvelopeForTest(
    keyring,
    context.mobile,
    { token: "mobile-secret" },
    sourceVersion,
    Buffer.alloc(12, 2),
  );
  const metaAttributionEnvelope = encryptCredentialEnvelopeForTest(
    keyring,
    context.metaAttribution,
    { fbc: "meta-browser-data" },
    sourceVersion,
    Buffer.alloc(12, 3),
  );
  const claims = [
    {
      algorithm: integrationEnvelope.algorithm,
      ciphertext: integrationEnvelope.ciphertext,
      envelope_version: integrationEnvelope.version,
      integration_type: "quickbooks",
      iv: integrationEnvelope.iv,
      key_version: sourceVersion,
      lease_token: leaseOne,
      organization_id: organizationId,
      secret_id: integrationId,
      secret_kind: "integration",
      target_id: integrationId,
    },
    {
      algorithm: metaAttributionEnvelope.algorithm,
      ciphertext: metaAttributionEnvelope.ciphertext,
      envelope_version: metaAttributionEnvelope.version,
      integration_type: "meta_attribution",
      iv: metaAttributionEnvelope.iv,
      key_version: sourceVersion,
      lease_token: leaseThree,
      organization_id: organizationId,
      secret_id: metaAttributionId,
      secret_kind: "meta_attribution",
      target_id: metaAttributionId,
    },
    {
      algorithm: mobileEnvelope.algorithm,
      ciphertext: mobileEnvelope.ciphertext,
      envelope_version: mobileEnvelope.version,
      integration_type: "mobile_push_token",
      iv: mobileEnvelope.iv,
      key_version: sourceVersion,
      lease_token: leaseTwo,
      organization_id: organizationId,
      secret_id: mobileId,
      secret_kind: "mobile_push",
      target_id: mobileId,
    },
  ];
  let claimed = false;
  let completed = 0;
  const rpc = vi.fn(async (name, parameters) => {
    if (name === "start_credential_envelope_rotation") return runId;
    if (name === "claim_credential_envelope_rotation_batch") {
      if (claimed) return [];
      claimed = true;
      return claims;
    }
    if (name === "complete_credential_envelope_rotation_item") {
      expect(parameters.p_key_version).toBe(targetVersion);
      expect(parameters.p_ciphertext).not.toContain("secret");
      completed += 1;
      return "rotated";
    }
    if (name === "get_credential_envelope_rotation_status") {
      return {
        failedItems: 0,
        oldIntegrationEnvelopes: completed === 3 ? 0 : 1,
        oldMetaAttributionEnvelopes: completed === 3 ? 0 : 1,
        oldMobileEnvelopes: completed === 3 ? 0 : 1,
        pendingItems: 0,
        processingItems: 0,
        rotatedItems: completed,
        runId,
        skippedItems: 0,
        status: "running",
        totalItems: 3,
      };
    }
    if (name === "verify_credential_envelope_rotation") {
      return {
        failedItems: 0,
        oldIntegrationEnvelopes: 0,
        oldKeyCountVerifiedZero: true,
        oldMetaAttributionEnvelopes: 0,
        oldMobileEnvelopes: 0,
        pendingItems: 0,
        processingItems: 0,
        rotatedItems: 3,
        runId,
        skippedItems: 0,
        status: "verified",
        totalItems: 3,
      };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  });
  return { rpc };
}

describe("credential-envelope rotation policy and authority", () => {
  it("ships disabled with empty project and transition allowlists", async () => {
    const checkedIn = JSON.parse(
      await readFile(
        resolve("config/credential-envelope-rotation-policy.json"),
        "utf8",
      ),
    );
    expect(checkedIn.enabled).toBe(false);
    expect(checkedIn.supabaseProjectUrlSha256).toEqual([]);
    expect(checkedIn.allowedTransitionSha256).toEqual([]);
    expect(() => validateRotationPolicy(checkedIn)).toThrow(/non-empty/);
  });

  it("requires exact confirmation, immutable SHA, project target, and transition allowlists", () => {
    const policy = validateRotationPolicy(rawPolicy());
    expect(() =>
      assertRotationAuthority(
        { ...policy, enabled: false },
        "start",
        sourceVersion,
        targetVersion,
        environment(),
      ),
    ).toThrow(/disabled/);
    expect(() =>
      assertRotationAuthority(
        policy,
        "start",
        sourceVersion,
        targetVersion,
        environment({ CREDENTIAL_ROTATION_CONFIRMATION: "almost" }),
      ),
    ).toThrow(/Exact start/);
    expect(() =>
      assertRotationAuthority(
        policy,
        "start",
        sourceVersion,
        targetVersion,
        environment({ SUPABASE_URL: "https://other.supabase.co" }),
      ),
    ).toThrow(/not allowlisted/);
  });
});

describe("credential-envelope cryptography and orchestration", () => {
  it("rewraps AES-256-GCM envelopes compatibly without preserving ciphertext and binds AAD", async () => {
    const env = environment();
    const keyring = parseCredentialKeyring(env);
    const context = contexts().integration;
    const original = encryptCredentialEnvelopeForTest(
      keyring,
      context,
      { refreshToken: "secret-value" },
      sourceVersion,
      Buffer.alloc(12, 7),
    );
    const replacement = rewrapCredentialEnvelope(
      keyring,
      context,
      original,
      targetVersion,
    );
    expect(replacement.keyVersion).toBe(targetVersion);
    expect(replacement.ciphertext).not.toBe(original.ciphertext);
    await expect(
      decryptIntegrationCredentials(env, context, replacement),
    ).resolves.toEqual({ refreshToken: "secret-value" });
    expect(() =>
      rewrapCredentialEnvelope(
        keyring,
        { ...context, targetId: mobileId },
        original,
        targetVersion,
      ),
    ).toThrow(/rewrap failed/);
    expect(() =>
      rewrapCredentialEnvelope(
        { ...keyring, keys: { [targetVersion]: keyring.keys[targetVersion] } },
        context,
        original,
        targetVersion,
      ),
    ).toThrow(/unavailable/);
  });

  it("processes integration, Meta attribution, and mobile envelopes and verifies zero old-key rows", async () => {
    const env = environment();
    const { rpc } = fakeRotationRpc(env);
    const result = await runCredentialEnvelopeRotation({
      batchSize: 100,
      env,
      maxBatches: 10,
      operation: "start",
      policy: validateRotationPolicy(rawPolicy()),
      rpc,
      sourceKeyVersion: sourceVersion,
      targetKeyVersion: targetVersion,
    });
    expect(result).toEqual(
      expect.objectContaining({
        oldKeyCountVerifiedZero: true,
        processedItems: 3,
        resumeRequired: false,
        status: "verified",
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "verify_credential_envelope_rotation",
      { p_run_id: runId },
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("integration-secret");
    expect(serialized).not.toContain("mobile-secret");
    expect(serialized).not.toContain("meta-browser-data");
    expect(serialized).not.toContain(
      JSON.parse(env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS)[sourceVersion],
    );
  });

  it("leaves a durable run resumable when a bounded invocation cannot reach zero", async () => {
    const env = environment({
      CREDENTIAL_ROTATION_CONFIRMATION:
        "RESUME VINIFERA CREDENTIAL ENVELOPE ROTATION",
    });
    const rpc = vi.fn(async (name) => {
      if (name === "claim_credential_envelope_rotation_batch") return [];
      if (name === "get_credential_envelope_rotation_status") {
        return {
          failedItems: 0,
          oldIntegrationEnvelopes: 3,
          oldMetaAttributionEnvelopes: 4,
          oldMobileEnvelopes: 2,
          pendingItems: 5,
          processingItems: 0,
          rotatedItems: 10,
          runId,
          skippedItems: 0,
          status: "running",
          totalItems: 15,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    const result = await runCredentialEnvelopeRotation({
      env,
      operation: "resume",
      policy: validateRotationPolicy(rawPolicy()),
      rpc,
      runId,
      sourceKeyVersion: sourceVersion,
      targetKeyVersion: targetVersion,
    });
    expect(result.resumeRequired).toBe(true);
    expect(result.runId).toBe(runId);
    expect(
      rpc.mock.calls.some(
        ([name]) => name === "verify_credential_envelope_rotation",
      ),
    ).toBe(false);
  });

  it("migration keeps leases resumable and verifies every encrypted envelope table reaches zero", async () => {
    const migration = await readFile(
      resolve(
        "supabase/migrations/202607260009_credential_envelope_rotation.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("integration_secrets");
    expect(migration).toContain("meta_attribution_touchpoints");
    expect(migration).toContain("mobile_device_secrets");
    expect(migration).toContain("LEASE_EXPIRED");
    expect(migration).toContain("oldIntegrationEnvelopes");
    expect(migration).toContain("oldMetaAttributionEnvelopes");
    expect(migration).toContain("oldMobileEnvelopes");
    expect(migration).toContain("private.is_service_role()");
    expect(migration).not.toMatch(/grant .*authenticated/i);
  });
});
