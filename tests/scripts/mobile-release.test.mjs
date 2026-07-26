import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  iosExportOptions,
  mobileReleaseConstants,
  sanitizedEvidence,
  uploadGooglePlayInternal,
  validateReleaseEnvironment,
  validateReleaseRequest,
} from "../../scripts/mobile-release.mjs";

const gitSha = "0123456789abcdef0123456789abcdef01234567";

function releaseRequest(overrides = {}) {
  return {
    action: "build-only",
    buildConfirmation: "BUILD SIGNED VINIFERA MOBILE RELEASE",
    gitSha,
    uploadConfirmation: "",
    ...overrides,
  };
}

function commonEnvironment(overrides = {}) {
  return {
    MOBILE_BUILD_CONFIRMATION:
      "BUILD SIGNED VINIFERA MOBILE RELEASE",
    MOBILE_BUILD_PROFILE: "production-authorized",
    MOBILE_PRODUCTION_ORIGIN_AUTHORIZED: "true",
    MOBILE_RELEASE_GIT_SHA: gitSha,
    MOBILE_RELEASE_ACTION: "build-only",
    MOBILE_UPLOAD_CONFIRMATION: "",
    VITE_MOBILE_API_ORIGIN:
      "https://vinifera.edstratumlabs.ai",
    ...overrides,
  };
}

function providerResponse(payload, ok = true) {
  return {
    ok,
    body: { cancel: vi.fn(async () => undefined) },
    json: vi.fn(async () => payload),
  };
}

const serviceAccount = {
  type: "service_account",
  client_email:
    "vinifera-release@example.iam.gserviceaccount.com",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
};

describe("mobile release authorization and signing guards", () => {
  it("separates build-only and internal-upload confirmations", () => {
    expect(validateReleaseRequest(releaseRequest())).toEqual({
      action: "build-only",
      uploadAuthorized: false,
    });
    expect(() =>
      validateReleaseRequest(
        releaseRequest({ gitSha: "0123456789abcdef" }),
      ),
    ).toThrow(/40 lowercase hex characters/);
    expect(() =>
      validateReleaseRequest(
        releaseRequest({
          action: "build-only",
          uploadConfirmation:
            "UPLOAD VINIFERA MOBILE INTERNAL TRACKS",
        }),
      ),
    ).toThrow(/leave the upload confirmation empty/);
    expect(() =>
      validateReleaseRequest(
        releaseRequest({
          action: "upload-internal",
          uploadConfirmation: "almost",
        }),
      ),
    ).toThrow(/upload confirmation is not exact/);
    expect(
      validateReleaseRequest(
        releaseRequest({
          action: "upload-internal",
          uploadConfirmation:
            "UPLOAD VINIFERA MOBILE INTERNAL TRACKS",
        }),
      ).uploadAuthorized,
    ).toBe(true);
  });

  it("requires the exact production mobile origin and signing names", () => {
    const androidEnv = commonEnvironment({
      MOBILE_ANDROID_KEYSTORE_BASE64: "encoded",
      MOBILE_ANDROID_KEYSTORE_PASSWORD: "secret",
      MOBILE_ANDROID_KEY_ALIAS: "upload",
      MOBILE_ANDROID_KEY_PASSWORD: "secret",
      MOBILE_ANDROID_PACKAGE_NAME: "ai.edstratumlabs.vinifera",
      MOBILE_ANDROID_SIGNING_CERT_SHA256:
        "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA",
      MOBILE_GOOGLE_SERVICES_JSON_BASE64: "encoded",
    });
    expect(
      validateReleaseEnvironment({
        action: "build-only",
        env: androidEnv,
        platform: "android",
      }),
    ).toMatchObject({
      appId: "ai.edstratumlabs.vinifera",
      platform: "android",
    });
    expect(() =>
      validateReleaseEnvironment({
        action: "build-only",
        env: {
          ...androidEnv,
          VITE_MOBILE_API_ORIGIN:
            "https://vinifera-staging.example.workers.dev",
        },
        platform: "android",
      }),
    ).toThrow(/authorized production origin/);
    expect(() =>
      validateReleaseEnvironment({
        action: "build-only",
        env: {
          ...androidEnv,
          MOBILE_ANDROID_KEYSTORE_PASSWORD: "",
        },
        platform: "android",
      }),
    ).toThrow(/MOBILE_ANDROID_KEYSTORE_PASSWORD/);
    expect(() =>
      validateReleaseEnvironment({
        action: "build-only",
        env: {
          ...androidEnv,
          MOBILE_ANDROID_SIGNING_CERT_SHA256:
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
        platform: "android",
      }),
    ).toThrow(/colon-delimited SHA-256 fingerprint/);
  });

  it("exports only a manually signed internal-TestFlight package", () => {
    const options = iosExportOptions({
      bundleId: "ai.edstratumlabs.vinifera",
      profileUuid: "01234567-89AB-CDEF-0123-456789ABCDEF",
      teamId: "ABCDE12345",
    });
    expect(options).toContain("<string>app-store-connect</string>");
    expect(options).toContain(
      "<key>testFlightInternalTestingOnly</key>",
    );
    expect(options).toContain("<string>manual</string>");
    expect(options).toContain(
      "<key>ai.edstratumlabs.vinifera</key>",
    );
  });
});

describe("Google Play edit transaction", () => {
  it("uses fixed official endpoints and commits only after track update", async () => {
    expect(mobileReleaseConstants).toMatchObject({
      googleOAuthEndpoint: "https://oauth2.googleapis.com/token",
      googlePlayApiRoot:
        "https://androidpublisher.googleapis.com/androidpublisher/v3",
      googlePlayUploadRoot:
        "https://androidpublisher.googleapis.com/upload/androidpublisher/v3",
      playTrack: "internal",
    });

    const calls = [];
    const responses = [
      providerResponse({ id: "opaque-edit" }),
      providerResponse({ versionCode: 5 }),
      providerResponse({ track: "internal" }),
      providerResponse({ id: "opaque-edit" }),
    ];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ init, url: String(url) });
      return responses[calls.length - 1];
    });

    const result = await uploadGooglePlayInternal({
      aabBytes: Buffer.alloc(64, 1),
      fetchImpl,
      serviceAccount,
      tokenProvider: vi.fn(async () => "access-token-sensitive"),
    });

    expect(result).toEqual({
      bundleUploaded: true,
      committed: true,
      track: "internal",
      trackUpdated: true,
    });
    expect(calls.map(({ init }) => init.method)).toEqual([
      "POST",
      "POST",
      "PUT",
      "POST",
    ]);
    expect(calls[1].url).toBe(
      "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/ai.edstratumlabs.vinifera/edits/opaque-edit/bundles?uploadType=media",
    );
    expect(calls[2].url).toBe(
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/ai.edstratumlabs.vinifera/edits/opaque-edit/tracks/internal",
    );
    expect(JSON.parse(calls[2].init.body)).toEqual({
      releases: [{ status: "completed", versionCodes: ["5"] }],
      track: "internal",
    });
    expect(calls[3].url).toBe(
      "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/ai.edstratumlabs.vinifera/edits/opaque-edit:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW",
    );
    expect(calls[3].init.body).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("opaque-edit");
    expect(JSON.stringify(result)).not.toContain(
      "access-token-sensitive",
    );
  });

  it("does not commit when the internal track update fails", async () => {
    const calls = [];
    const responses = [
      providerResponse({ id: "opaque-edit" }),
      providerResponse({ versionCode: 5 }),
      providerResponse({ error: "sensitive-body" }, false),
    ];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ init, url: String(url) });
      return responses[calls.length - 1];
    });

    await expect(
      uploadGooglePlayInternal({
        aabBytes: Buffer.alloc(64, 1),
        fetchImpl,
        serviceAccount,
        tokenProvider: vi.fn(async () => "access-token-sensitive"),
      }),
    ).rejects.toThrow("Google Play internal track update failed.");
    expect(calls).toHaveLength(3);
    expect(calls.some(({ url }) => url.includes(":commit"))).toBe(false);
    expect(responses[2].body.cancel).toHaveBeenCalledOnce();
  });
});

describe("mobile release workflow boundaries", () => {
  it("keeps uploads protected, fixed, ephemeral, and separately confirmed", async () => {
    const [workflow, gradle, gitignore] = await Promise.all([
      readFile(
        new URL("../../.github/workflows/mobile-release.yml", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../../android/app/build.gradle", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../../.gitignore", import.meta.url), "utf8"),
    ]);

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("git_sha:");
    expect(workflow).toContain("ref: ${{ inputs.git_sha }}");
    expect(workflow.match(/ref: \$\{\{ inputs\.git_sha \}\}/g))
      .toHaveLength(3);
    expect(workflow).toContain(
      '[[ "$GITHUB_REPOSITORY" == "theonlygeranium/vinifera" ]]',
    );
    expect(workflow).toContain(
      'git merge-base --is-ancestor "$RELEASE_GIT_SHA" origin/main',
    );
    expect(workflow).toContain(
      "Type BUILD SIGNED VINIFERA MOBILE RELEASE",
    );
    expect(workflow).toContain(
      "UPLOAD VINIFERA MOBILE INTERNAL TRACKS",
    );
    expect(workflow).toContain("name: mobile-release");
    expect(workflow).toContain("deployment: false");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("deployments: none");
    expect(workflow).toContain(
      "if: inputs.release_action == 'upload-internal'",
    );
    expect(workflow.match(/if: inputs\.release_action == 'upload-internal'/g))
      .toHaveLength(2);
    expect(workflow).toContain(
      "VITE_MOBILE_API_ORIGIN: https://vinifera.edstratumlabs.ai",
    );
    expect(workflow).toContain(
      "MOBILE_BUILD_PROFILE: production-authorized",
    );
    expect(workflow).toContain("bundleRelease");
    expect(workflow).toContain("jarsigner -verify -strict");
    expect(workflow).toContain(
      "MOBILE_ANDROID_SIGNING_CERT_SHA256",
    );
    expect(workflow).toContain("keytool -list -v");
    expect(workflow).toContain(
      '[[ "${actual_signing_fingerprint^^}" == "${MOBILE_ANDROID_SIGNING_CERT_SHA256^^}" ]]',
    );
    expect(workflow).toContain("xcrun codesign --verify");
    expect(workflow).toContain("xcrun altool --validate-app");
    expect(workflow).toContain("xcrun altool --upload-app");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      'rm -f -- android/app/google-services.json',
    );
    expect(workflow).toContain("security delete-keychain");
    expect(workflow).not.toMatch(
      /fastlane|r0adkll|google-github-actions\/upload/i,
    );

    expect(gradle).toContain("ANDROID_RELEASE_KEYSTORE_PATH");
    expect(gradle).toContain("releaseSigningPartiallyConfigured");
    expect(gradle).toContain("it.name == 'bundleRelease'");
    expect(gradle).toContain(
      "release bundles require ephemeral environment-backed signing",
    );
    expect(gitignore).toContain(
      "android/app/google-services.json",
    );
  });

  it("emits evidence without credential values or provider identifiers", () => {
    const evidence = sanitizedEvidence({
      action: "upload-internal",
      buildOutcome: "success",
      gitSha,
      platform: "android",
      uploadOutcome: "success",
      verificationOutcome: "success",
    });
    const serialized = JSON.stringify(evidence);
    expect(evidence).toMatchObject({
      gitSha,
      platform: "android",
      signedBuild: true,
      signatureVerified: true,
      upload: {
        requested: true,
        result: "success",
        target: "google-play-internal",
      },
    });
    expect(serialized).not.toMatch(
      /secret|private_key|access-token|opaque-edit|client_email/i,
    );
  });
});
