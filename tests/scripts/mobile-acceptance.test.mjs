import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  acceptanceEvidence,
  mobileAcceptanceConstants,
  validateGate17Attestation,
  validateGate18Attestation,
  validatePolicy,
  validatePriorGate17Evidence,
  validateReleaseEvidence,
  validateRequest,
  validateWorkflowRun,
  verifySignedAttestation,
} from "../../scripts/mobile-acceptance.mjs";

const gitSha = "0123456789abcdef0123456789abcdef01234567";
const releaseRunId = "123456789";
const now = new Date("2026-08-06T18:00:00.000Z");
const evidenceHash = "a".repeat(64);
const signingHash = "b".repeat(64);
const apiOriginHash = "c".repeat(64);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
const publicKeyHash = createHash("sha256")
  .update(publicKey.export({ format: "der", type: "spki" }))
  .digest("hex");

function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    enabled: true,
    repository: "theonlygeranium/vinifera",
    environment: "mobile-release",
    releaseWorkflowName: "Signed mobile internal release",
    acceptanceWorkflowName: "Mobile activation acceptance",
    confirmation: {
      17: "ATTEST VINIFERA GATE 17 PHYSICAL DEVICE ACCEPTANCE",
      18: "ATTEST VINIFERA GATE 18 INTERNAL TRACK INSTALLS",
    },
    maximumEvidenceAgeHours: 24,
    maximumFutureSkewMinutes: 5,
    allowedEvidencePublicKeySha256: [publicKeyHash],
    allowedApiOriginSha256: [apiOriginHash],
    allowedSigningIdentitySha256: {
      android: ["e".repeat(64)],
      ios: [signingHash],
    },
    ...overrides,
  };
}

function releaseRun(overrides = {}) {
  return {
    id: Number(releaseRunId),
    name: "Signed mobile internal release",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: gitSha,
    path: ".github/workflows/mobile-release.yml",
    status: "completed",
    conclusion: "success",
    repository: { full_name: "theonlygeranium/vinifera" },
    ...overrides,
  };
}

function releaseEvidence(platform, action = "build-only", overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-06T17:45:00.000Z",
    gitSha,
    platform,
    readOnlyEvidence: true,
    releaseAction: action,
    signedBuild: true,
    signatureVerified: true,
    upload: {
      requested: action === "upload-internal",
      result: action === "upload-internal" ? "success" : "skipped",
      target: mobileAcceptanceConstants.releaseTargets[platform],
    },
    ...overrides,
  };
}

function gate17Checks(overrides = {}) {
  return Object.fromEntries(
    mobileAcceptanceConstants.gate17Checks.map((name) => [
      name,
      overrides[name] ?? true,
    ]),
  );
}

function gate18Checks(overrides = {}) {
  return Object.fromEntries(
    mobileAcceptanceConstants.gate18Checks.map((name) => [
      name,
      overrides[name] ?? true,
    ]),
  );
}

function commonAttestation(gate, releaseAction, platforms, overrides = {}) {
  return {
    schemaVersion: 1,
    gate: Number(gate),
    repository: "theonlygeranium/vinifera",
    environment: "production",
    gitSha,
    releaseRunId,
    releaseAction,
    app: {
      id: "ai.edstratumlabs.vinifera",
      versionCode: 5,
      versionName: "0.5.0",
    },
    testedAt: "2026-08-06T17:30:00.000Z",
    apiOriginSha256: apiOriginHash,
    platforms,
    ...overrides,
  };
}

function gate17Attestation() {
  return commonAttestation("17", "build-only", [
    {
      platform: "ios",
      osVersion: "iOS 26.0",
      deviceEvidenceSha256: evidenceHash,
      signingIdentitySha256: signingHash,
      distributionSignatureVerified: true,
      pushProvider: "apns",
      checks: gate17Checks(),
    },
    {
      platform: "android",
      osVersion: "Android 16",
      deviceEvidenceSha256: "d".repeat(64),
      signingIdentitySha256: "e".repeat(64),
      distributionSignatureVerified: true,
      pushProvider: "fcm",
      checks: gate17Checks(),
    },
  ]);
}

function gate18Attestation() {
  return commonAttestation("18", "upload-internal", [
    {
      platform: "ios",
      osVersion: "iOS 26.0",
      deviceEvidenceSha256: evidenceHash,
      signingIdentitySha256: signingHash,
      installSource: "testflight-internal",
      checks: gate18Checks(),
    },
    {
      platform: "android",
      osVersion: "Android 16",
      deviceEvidenceSha256: "d".repeat(64),
      signingIdentitySha256: "e".repeat(64),
      installSource: "google-play-internal",
      checks: gate18Checks(),
    },
  ]);
}

function context(attestation) {
  return {
    attestation,
    gitSha,
    now,
    policy: policy(),
    releaseRunId,
  };
}

describe("mobile acceptance policy and request", () => {
  it("is structurally strict and disabled by the checked-in policy", async () => {
    const checkedIn = JSON.parse(
      await readFile(
        new URL("../../.github/mobile-acceptance/policy.json", import.meta.url),
        "utf8",
      ),
    );
    expect(validatePolicy(checkedIn).enabled).toBe(false);
    expect(() =>
      validateRequest({
        confirmation: checkedIn.confirmation["17"],
        gate: "17",
        gate17AcceptanceRunId: "",
        gitSha,
        policy: checkedIn,
        releaseRunId,
      }),
    ).toThrow(/disabled by policy/);
    expect(() => validatePolicy({ ...policy(), unexpected: true })).toThrow(
      /missing or unexpected/,
    );
  });

  it("requires exact gate confirmations and Gate 18 ancestry", () => {
    expect(
      validateRequest({
        confirmation: policy().confirmation["17"],
        gate: "17",
        gate17AcceptanceRunId: "",
        gitSha,
        policy: policy(),
        releaseRunId,
      }),
    ).toMatchObject({ gate: "17", gitSha, releaseRunId });
    expect(() =>
      validateRequest({
        confirmation: policy().confirmation["18"],
        gate: "18",
        gate17AcceptanceRunId: "",
        gitSha,
        policy: policy(),
        releaseRunId,
      }),
    ).toThrow(/requires a prior Gate 17/);
    expect(() =>
      validateRequest({
        confirmation: "almost",
        gate: "17",
        gate17AcceptanceRunId: "",
        gitSha,
        policy: policy(),
        releaseRunId,
      }),
    ).toThrow(/confirmation is not exact/);
  });
});

describe("exact release and workflow evidence", () => {
  it("binds successful workflow runs to repository, name, branch, and SHA", () => {
    expect(
      validateWorkflowRun({
        expectedGitSha: gitSha,
        expectedName: "Signed mobile internal release",
        expectedPath: ".github/workflows/mobile-release.yml",
        expectedRepository: "theonlygeranium/vinifera",
        expectedRunId: releaseRunId,
        run: releaseRun(),
      }),
    ).toBe(true);
    for (const bad of [
      { head_sha: "f".repeat(40) },
      { head_branch: "staging" },
      { conclusion: "failure" },
      { event: "push" },
      { path: ".github/workflows/lookalike.yml" },
      { repository: { full_name: "other/repo" } },
    ]) {
      expect(() =>
        validateWorkflowRun({
          expectedGitSha: gitSha,
          expectedName: "Signed mobile internal release",
          expectedPath: ".github/workflows/mobile-release.yml",
          expectedRepository: "theonlygeranium/vinifera",
          expectedRunId: releaseRunId,
          run: releaseRun(bad),
        }),
      ).toThrow(/not an exact successful main run/);
    }
  });

  it("requires signed artifacts and successful uploads for Gate 18", () => {
    for (const platform of ["android", "ios"]) {
      expect(
        validateReleaseEvidence({
          action: "build-only",
          evidence: releaseEvidence(platform),
          gitSha,
          platform,
        }),
      ).toBe(true);
      expect(
        validateReleaseEvidence({
          action: "upload-internal",
          evidence: releaseEvidence(platform, "upload-internal"),
          gitSha,
          platform,
        }),
      ).toBe(true);
      const failedUpload = releaseEvidence(platform, "upload-internal");
      failedUpload.upload.result = "failure";
      expect(() =>
        validateReleaseEvidence({
          action: "upload-internal",
          evidence: failedUpload,
          gitSha,
          platform,
        }),
      ).toThrow(/internal upload did not succeed/);
    }
  });
});

describe("Gate 17 physical-device acceptance", () => {
  it("requires all checks on one iOS and one Android physical device", () => {
    expect(validateGate17Attestation(context(gate17Attestation()))).toBe(true);
    const failed = gate17Attestation();
    failed.platforms[0].checks.pushBackground = false;
    expect(() => validateGate17Attestation(context(failed))).toThrow(
      /pushBackground did not pass/,
    );
    const wrongProvider = gate17Attestation();
    wrongProvider.platforms[1].pushProvider = "apns";
    expect(() => validateGate17Attestation(context(wrongProvider))).toThrow(
      /push-provider evidence is invalid/,
    );
  });

  it("rejects stale evidence, duplicate platforms, and schema smuggling", () => {
    const stale = gate17Attestation();
    stale.testedAt = "2026-08-05T17:00:00.000Z";
    expect(() => validateGate17Attestation(context(stale))).toThrow(/invalid or stale/);
    const duplicate = gate17Attestation();
    duplicate.platforms[1].platform = "ios";
    expect(() => validateGate17Attestation(context(duplicate))).toThrow(/exactly Android and iOS/);
    const extra = gate17Attestation();
    extra.platforms[0].deviceSerial = "not permitted";
    expect(() => validateGate17Attestation(context(extra))).toThrow(/missing or unexpected/);
  });

  it("requires the checked-in app version and authorized origin/signing hashes", () => {
    const wrongVersion = gate17Attestation();
    wrongVersion.app.versionCode += 1;
    expect(() => validateGate17Attestation(context(wrongVersion))).toThrow(
      /invalid or stale/,
    );
    const wrongOrigin = gate17Attestation();
    wrongOrigin.apiOriginSha256 = "f".repeat(64);
    expect(() => validateGate17Attestation(context(wrongOrigin))).toThrow(
      /invalid or stale/,
    );
    const wrongSigningIdentity = gate17Attestation();
    wrongSigningIdentity.platforms[0].signingIdentitySha256 = "f".repeat(64);
    expect(() => validateGate17Attestation(context(wrongSigningIdentity))).toThrow(
      /platform identity is invalid/,
    );
  });
});

describe("Gate 18 internal-track acceptance", () => {
  it("requires processed, installed, launched builds from both fixed tracks", () => {
    expect(validateGate18Attestation(context(gate18Attestation()))).toBe(true);
    const direct = gate18Attestation();
    direct.platforms[0].installSource = "local-ipa";
    expect(() => validateGate18Attestation(context(direct))).toThrow(
      /not the required internal track/,
    );
    const buildOnly = gate18Attestation();
    buildOnly.releaseAction = "build-only";
    expect(() => validateGate18Attestation(context(buildOnly))).toThrow(
      /requires an upload-internal/,
    );
    const unavailable = gate18Attestation();
    unavailable.platforms[1].checks.storeProcessingAvailable = false;
    expect(() => validateGate18Attestation(context(unavailable))).toThrow(
      /storeProcessingAvailable did not pass/,
    );
  });

  it("binds Gate 18 to accepted Gate 17 evidence for the same release", () => {
    const evidence = acceptanceEvidence({
      attestationBytes: Buffer.from("gate17"),
      gate: "17",
      gitSha,
      keyHash: publicKeyHash,
      releaseAction: "upload-internal",
      releaseRunId,
      now,
    });
    expect(validatePriorGate17Evidence({ evidence, gitSha, releaseRunId })).toBe(true);
    expect(() =>
      validatePriorGate17Evidence({
        evidence: { ...evidence, gitSha: "f".repeat(40) },
        gitSha,
        releaseRunId,
      }),
    ).toThrow(/not bound to this release/);
  });
});

describe("signed evidence and workflow boundary", () => {
  it("accepts only an authorized Ed25519 key and exact signed bytes", () => {
    const bytes = Buffer.from(JSON.stringify(gate17Attestation()));
    const signature = sign(null, bytes, privateKey);
    expect(
      verifySignedAttestation({
        attestationBytes: bytes,
        policy: policy(),
        publicKeyPem,
        signature,
      }),
    ).toBe(publicKeyHash);
    expect(() =>
      verifySignedAttestation({
        attestationBytes: Buffer.concat([bytes, Buffer.from("\n")]),
        policy: policy(),
        publicKeyPem,
        signature,
      }),
    ).toThrow(/signature is invalid/);
    expect(() =>
      verifySignedAttestation({
        attestationBytes: bytes,
        policy: policy({ allowedEvidencePublicKeySha256: [] }),
        publicKeyPem,
        signature,
      }),
    ).toThrow(/not authorized by policy/);
  });

  it("runs only as a protected main dispatch and retains digest-only output", async () => {
    const workflow = await readFile(
      new URL("../../.github/workflows/mobile-acceptance.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain("name: mobile-release");
    expect(workflow).toContain("deployment: false");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("deployments: none");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain('select(.base.ref == "main")');
    expect(workflow).toContain('select(.head.ref == "staging")');
    expect(workflow).toContain('any(.labels[]?; .name == "human-review-required" or .name == "do-not-merge")');
    expect(workflow).toContain("MOBILE_ACCEPTANCE_EVIDENCE_PUBLIC_KEY_PEM_BASE64");
    expect(workflow).toContain("gate17-mobile-acceptance-evidence");
    expect(workflow.match(/commits\/\$MOBILE_ACCEPTANCE_GIT_SHA\/pulls/g)).toHaveLength(2);
    expect(workflow.indexOf("Final revalidation before accepting evidence")).toBeLessThan(
      workflow.indexOf("Upload sanitized acceptance evidence"),
    );
    expect(workflow).not.toMatch(/pull_request_target|push:|schedule:/);

    const bytes = Buffer.from(JSON.stringify(gate18Attestation()));
    const evidence = acceptanceEvidence({
      attestationBytes: bytes,
      gate: "18",
      gitSha,
      keyHash: publicKeyHash,
      releaseAction: "upload-internal",
      releaseRunId,
      now,
    });
    expect(evidence).toMatchObject({ gate: 18, accepted: true, gitSha, releaseRunId });
    expect(JSON.stringify(evidence)).not.toMatch(/osVersion|device|signingIdentity|apiOrigin/);
  });
});
