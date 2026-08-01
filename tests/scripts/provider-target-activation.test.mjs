import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  hashActivationTarget,
  verifyActivationTarget,
  verifyStagingCustomHostnameOrigin,
} from "../../scripts/lib/activation-guard.mjs";

const accountId = "a".repeat(32);
const zoneId = "b".repeat(32);
const fallbackOrigin = "origin.staging.example.test";
const fcmProjectId = "vinifera-staging-123";
const shipCompliantOrigin = "https://sandbox.shipcompliant.example";

function policy() {
  return {
    version: 1,
    staging: {
      cloudflareAccountIdSha256: [
        hashActivationTarget("cloudflare", accountId),
      ],
      cloudflareZoneIdSha256: [
        hashActivationTarget("cloudflare-zone", zoneId),
      ],
      cloudflareFallbackOriginSha256: [
        hashActivationTarget("cloudflare-origin", fallbackOrigin),
      ],
      fcmProjectIdSha256: [
        hashActivationTarget("fcm-project", fcmProjectId),
      ],
      shipCompliantSandboxOriginSha256: [
        hashActivationTarget(
          "shipcompliant-origin",
          shipCompliantOrigin,
        ),
      ],
      supabaseProjectRefSha256: [],
    },
    deniedProduction: {
      cloudflareAccountIdSha256: [],
      cloudflareZoneIdSha256: [],
      cloudflareFallbackOriginSha256: [],
      fcmProjectIdSha256: [],
      shipCompliantSandboxOriginSha256: [],
      supabaseProjectRefSha256: [],
    },
    deniedProductionCustomHostnameOrigins: [
      "vinifera.edstratumlabs.ai",
    ],
  };
}

describe("staging provider target activation policy", () => {
  it("requires exact account, zone, fallback, FCM, and ShipCompliant hashes", () => {
    const allowlist = policy();
    for (const [kind, value] of [
      ["cloudflare", accountId],
      ["cloudflare-zone", zoneId],
      ["cloudflare-origin", fallbackOrigin],
      ["fcm-project", fcmProjectId],
      ["shipcompliant-origin", shipCompliantOrigin],
    ]) {
      expect(
        verifyActivationTarget({
          allowlist,
          kind,
          rawValue: value,
        }).targetHash,
      ).toBe(hashActivationTarget(kind, value));
    }
    expect(() =>
      verifyActivationTarget({
        allowlist,
        kind: "cloudflare-zone",
        rawValue: "c".repeat(32),
      }),
    ).toThrow(/not an allowlisted staging target/);
  });

  it("requires the fallback origin to pass both production denial and staging authorization", () => {
    expect(
      verifyStagingCustomHostnameOrigin(
        fallbackOrigin,
        ["vinifera.edstratumlabs.ai"],
        policy().staging.cloudflareFallbackOriginSha256,
      ),
    ).toEqual({ configured: true, hostname: fallbackOrigin });
    expect(() =>
      verifyStagingCustomHostnameOrigin(
        "other.staging.example.test",
        ["vinifera.edstratumlabs.ai"],
        policy().staging.cloudflareFallbackOriginSha256,
      ),
    ).toThrow(/not an allowlisted staging target/);
  });

  it("ships new staging provider allowlists empty and verifies them before deployment", async () => {
    const checkedIn = JSON.parse(
      await readFile("config/hosted-target-allowlist.json", "utf8"),
    );
    expect(checkedIn.staging.cloudflareZoneIdSha256).toEqual([]);
    expect(checkedIn.staging.cloudflareFallbackOriginSha256).toEqual([]);
    expect(checkedIn.staging.fcmProjectIdSha256).toEqual([]);
    expect(checkedIn.staging.shipCompliantSandboxOriginSha256).toEqual([]);

    const workflow = await readFile(".github/workflows/ci.yml", "utf8");
    const deployment = workflow.indexOf(
      "npx wrangler versions upload release/worker/worker.js",
    );
    for (const command of [
      "verify-target cloudflare",
      "verify-target cloudflare-zone",
      "verify-custom-hostname-origin",
      "verify-target fcm-project",
      "verify-target shipcompliant-origin",
    ]) {
      expect(workflow.indexOf(command)).toBeGreaterThan(-1);
      expect(workflow.indexOf(command)).toBeLessThan(deployment);
    }
    expect(workflow).toContain(
      'EASYPOST_LIVE_LABELS_ENABLED: "false"',
    );
    const productionWorkflow = await readFile(
      ".github/workflows/production-worker-release.yml",
      "utf8",
    );
    expect(productionWorkflow).toContain(
      "EASYPOST_LIVE_LABELS_ENABLED: ${{ secrets.PRODUCTION_EASYPOST_LIVE_LABELS_ENABLED }}",
    );
  });
});
