import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  gate13PolicyHashes,
  gate16PolicyHashes,
  manifestSha256,
} from "../../scripts/gate-policy-hash.mjs";
import {
  authorize as authorizeGate16,
  validateManifest as validateGate16,
} from "../../scripts/hosted-gate16-custom-hostname-acceptance.mjs";

const hex = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const gate13Env = {
  SHIPCOMPLIANT_ACCOUNT_ID: "  acct-123  ",
  SHIPCOMPLIANT_LICENSE_ID: "lic-456",
  SHIPCOMPLIANT_CONTRACT_VERSION: "2026-01",
  SHIPCOMPLIANT_BASE_URL: "https://sandbox.shipcompliant.example.com/",
  SHIPCOMPLIANT_TOKEN_PATH: "/oauth/token",
  SHIPCOMPLIANT_CHECK_PATH: "/v1/compliance/check",
  STAGING_WORKER_ORIGIN: "https://vinifera-staging.example.workers.dev",
  SUPABASE_URL: "https://project.supabase.co",
};

function gate16Manifest() {
  return {
    schemaVersion: 1,
    gate: 16,
    candidateRevision: "a".repeat(40),
    observedAt: "2026-08-01T00:00:00Z",
    organizationId: "10000000-0000-4000-8000-000000000001",
    brandId: "20000000-0000-4000-8000-000000000001",
    providerHostnameId: "cf-hostname-123",
    customHostname: "club.winery.example",
    siblingHostname: "sibling.winery.example",
    unknownHostname: "unknown.winery.example",
    cloudflareZoneId: "zone-abc",
    fallbackOrigin: "https://fallback.example.workers.dev",
    supabaseUrl: "https://project.supabase.co",
    provider: {
      ownershipStatus: "active",
      hostnameStatus: "active",
      certificateStatus: "active",
      certificateExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    },
    expectedBrand: {
      name: "Example Winery",
      portalTitle: "Example Members",
      logoUrl: "https://cdn.example.com/logo.png",
      primaryColor: "#111111",
      secondaryColor: "#eeeeee",
      fontFamily: "Inter",
    },
    assets: {
      portalPath: "/portal",
      webManifestPath: "/manifest.webmanifest",
      iconPaths: ["/icons/vinifera-192.png", "/icons/vinifera-512.png"],
    },
  };
}

describe("gate13 policy-hash generation", () => {
  it("maps each env target to its policy field with the controller's normalization", () => {
    const policy = gate13PolicyHashes(gate13Env);
    expect(policy.enabled).toBe(true);
    // Trimmed simple values.
    expect(policy.accountIdSha256).toEqual([hex("acct-123")]);
    expect(policy.contractVersionSha256).toEqual([hex("2026-01")]);
    expect(policy.licenseIdSha256).toEqual([hex("lic-456")]);
    // Origins normalize to URL.origin (trailing slash stripped).
    expect(policy.sandboxOriginSha256).toEqual([
      hex("https://sandbox.shipcompliant.example.com"),
    ]);
    expect(policy.stagingWorkerOriginSha256).toEqual([
      hex("https://vinifera-staging.example.workers.dev"),
    ]);
    expect(policy.stagingSupabaseUrlSha256).toEqual([
      hex("https://project.supabase.co"),
    ]);
    // Exact API paths preserved.
    expect(policy.tokenPathSha256).toEqual([hex("/oauth/token")]);
    expect(policy.checkPathSha256).toEqual([hex("/v1/compliance/check")]);
  });

  it("fails closed on a missing target or a non-canonical origin/path", () => {
    expect(() => gate13PolicyHashes({ ...gate13Env, SHIPCOMPLIANT_ACCOUNT_ID: "" })).toThrow(
      /SHIPCOMPLIANT_ACCOUNT_ID is required/,
    );
    expect(() =>
      gate13PolicyHashes({ ...gate13Env, SHIPCOMPLIANT_BASE_URL: "http://insecure.example.com" }),
    ).toThrow(/canonical HTTPS origin/);
    expect(() =>
      gate13PolicyHashes({ ...gate13Env, SHIPCOMPLIANT_CHECK_PATH: "v1/no-leading-slash" }),
    ).toThrow(/exact absolute API path/);
  });
});

describe("gate16 policy-hash generation", () => {
  it("derives policy hashes from the validated manifest and is accepted by the controller", () => {
    const manifestText = JSON.stringify(gate16Manifest());
    const policy = gate16PolicyHashes(manifestText);
    expect(policy.enabled).toBe(true);
    expect(policy.customHostnameSha256).toEqual([hex("club.winery.example")]);
    expect(policy.cloudflareZoneIdSha256).toEqual([hex("zone-abc")]);
    expect(policy.fallbackOriginSha256).toEqual([
      hex("https://fallback.example.workers.dev"),
    ]);
    expect(policy.stagingSupabaseUrlSha256).toEqual([
      hex("https://project.supabase.co"),
    ]);

    // Strong cross-check: feed the generated policy back into the controller's
    // own authorize() with a matching enabled env. If normalization or field
    // mapping drifted, authorize() would throw.
    const validated = JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        enabled: true,
        customHostnameSha256: policy.customHostnameSha256,
        cloudflareZoneIdSha256: policy.cloudflareZoneIdSha256,
        fallbackOriginSha256: policy.fallbackOriginSha256,
        stagingSupabaseUrlSha256: policy.stagingSupabaseUrlSha256,
      }),
    );
    const env = {
      STAGING_GATE16_ACCEPTANCE_ENABLED: "true",
      GATE16_ACCEPTANCE_CONFIRMATION: "RUN VINIFERA GATE 16 CUSTOM HOSTNAME ACCEPTANCE",
      STAGING_GATE16_ACCEPTANCE_MANIFEST_SHA256: manifestSha256(manifestText),
    };
    const validatedManifest = validateGate16(JSON.parse(manifestText));
    expect(() => authorizeGate16(env, validated, validatedManifest, manifestText)).not.toThrow();
  });

  it("rejects an invalid manifest", () => {
    const broken = gate16Manifest();
    broken.customHostname = broken.siblingHostname;
    expect(() => gate16PolicyHashes(JSON.stringify(broken))).toThrow(/distinct/);
  });
});

describe("manifest byte hashing", () => {
  it("matches a direct SHA-256 over the exact manifest text", () => {
    const text = JSON.stringify(gate16Manifest());
    expect(manifestSha256(text)).toBe(hex(text));
  });
});
