import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  hashActivationTarget,
  resolveMobileBuildTarget,
  verifyActivationTarget,
  verifyStagingCustomHostnameOrigin,
} from "../../scripts/lib/activation-guard.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const supabaseProjectRef = "abcdefghijklmnopqrst";
const cloudflareAccountId = "0123456789abcdef0123456789abcdef";

function targetPolicy({
  cloudflareAllowed = [],
  cloudflareDenied = [],
  supabaseAllowed = [],
  supabaseDenied = [],
} = {}) {
  return {
    deniedProduction: {
      cloudflareAccountIdSha256: cloudflareDenied,
      supabaseProjectRefSha256: supabaseDenied,
    },
    deniedProductionCustomHostnameOrigins: ["vinifera.edstratumlabs.ai"],
    staging: {
      cloudflareAccountIdSha256: cloudflareAllowed,
      supabaseProjectRefSha256: supabaseAllowed,
    },
    version: 1,
  };
}

describe("hosted activation target guards", () => {
  it("fails closed when a staging target allowlist is empty", () => {
    expect(() =>
      verifyActivationTarget({
        allowlist: targetPolicy(),
        kind: "supabase",
        rawValue: supabaseProjectRef,
      }),
    ).toThrow(/No staging Supabase project ref hashes are allowlisted/);
  });

  it("accepts only the normalized allowlisted target identity", () => {
    const supabaseHash = hashActivationTarget("supabase", supabaseProjectRef);
    const cloudflareHash = hashActivationTarget(
      "cloudflare",
      cloudflareAccountId,
    );
    const policy = targetPolicy({
      cloudflareAllowed: [cloudflareHash],
      supabaseAllowed: [supabaseHash],
    });

    expect(
      verifyActivationTarget({
        allowlist: policy,
        kind: "supabase",
        rawValue: supabaseProjectRef.toUpperCase(),
      }).targetHash,
    ).toBe(supabaseHash);
    expect(
      verifyActivationTarget({
        allowlist: policy,
        kind: "cloudflare",
        rawValue: cloudflareAccountId.toUpperCase(),
      }).targetHash,
    ).toBe(cloudflareHash);
  });

  it("rejects denied production targets without disclosing the raw identity", () => {
    const productionRef = "productionprojectref";
    const policy = targetPolicy({
      supabaseAllowed: [hashActivationTarget("supabase", supabaseProjectRef)],
      supabaseDenied: [hashActivationTarget("supabase", productionRef)],
    });
    let message = "";
    try {
      verifyActivationTarget({
        allowlist: policy,
        kind: "supabase",
        rawValue: productionRef,
      });
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/denied production target/);
    expect(message).not.toContain(productionRef);
  });

  it("rejects an allow/deny policy conflict", () => {
    const hash = hashActivationTarget("cloudflare", cloudflareAccountId);
    expect(() =>
      verifyActivationTarget({
        allowlist: targetPolicy({
          cloudflareAllowed: [hash],
          cloudflareDenied: [hash],
        }),
        kind: "cloudflare",
        rawValue: cloudflareAccountId,
      }),
    ).toThrow(/allow\/deny conflict/);
  });

  it("keeps unchecked hosted targets fail-closed at the CLI boundary", async () => {
    const allowlist = JSON.parse(
      await readFile(
        new URL("../../config/hosted-target-allowlist.json", import.meta.url),
        "utf8",
      ),
    );
    expect(allowlist.staging.supabaseProjectRefSha256).toEqual([]);
    expect(allowlist.staging.cloudflareAccountIdSha256).toEqual([
      "fabdb949ae1bfce81a0132f2fceb8365f3678943f00b910337449136dcde2694",
    ]);
    expect(allowlist.deniedProduction.cloudflareAccountIdSha256).toEqual([
      "9255ff49245aa55fe0593dd098290d4f31928f5607b79d3a8633579c1695dd01",
    ]);
    expect(allowlist.deniedProduction.cloudflareAccountIdSha256).not.toContain(
      allowlist.staging.cloudflareAccountIdSha256[0],
    );

    for (const [kind, environment] of [
      ["supabase", { SUPABASE_PROJECT_ID: supabaseProjectRef }],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/verify-staging-activation.mjs", "verify-target", kind],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            ...environment,
          },
        },
      );
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).not.toBe(0);
      expect(output).toMatch(/hosted activation is blocked/);
      expect(output).not.toContain(Object.values(environment)[0]);
    }
  });
});

describe("staging custom-hostname origin guard", () => {
  const denied = [
    "vinifera.edstratumlabs.ai",
    "vinifera-live.edstratumlabs.ai",
  ];

  it.each([
    "vinifera.edstratumlabs.ai",
    "VINIFERA.EDSTRATUMLABS.AI.",
    "https://vinifera.edstratumlabs.ai/",
    "HTTPS://VINIFERA.EDSTRATUMLABS.AI:443/",
    "vinifera-live.edstratumlabs.ai",
  ])("canonicalizes and rejects production variant %s", (origin) => {
    expect(() => verifyStagingCustomHostnameOrigin(origin, denied)).toThrow(
      /denied production origin/,
    );
  });

  it("accepts only a canonical non-production hostname", () => {
    expect(
      verifyStagingCustomHostnameOrigin(
        "vinifera-staging.example.workers.dev",
        denied,
      ),
    ).toEqual({
      configured: true,
      hostname: "vinifera-staging.example.workers.dev",
    });
    expect(() =>
      verifyStagingCustomHostnameOrigin(
        "https://vinifera-staging.example.workers.dev",
        denied,
      ),
    ).toThrow(/canonical HTTPS hostname/);
  });
});

describe("isolated staging application origin", () => {
  it("uses the protected workers.dev origin for callbacks and CORS", async () => {
    const [workflow, wrangler] = await Promise.all([
      readFile(`${repositoryRoot}/.github/workflows/ci.yml`, "utf8"),
      readFile(`${repositoryRoot}/wrangler.jsonc`, "utf8"),
    ]);

    expect(workflow).toContain('--var "APP_ORIGIN:$STAGING_WORKER_ORIGIN"');
    expect(workflow).toContain(
      '--var "ALLOWED_ORIGINS:$STAGING_WORKER_ORIGIN,capacitor://localhost,https://localhost"',
    );
    expect(workflow).not.toContain(
      '--var "APP_ORIGIN:https://vinifera-staging.edstratumlabs.ai"',
    );
    expect(wrangler).toContain(
      '"APP_ORIGIN": "https://vinifera-staging.edstratum-labs-staging.workers.dev"',
    );
  });
});

describe("native API-origin activation profiles", () => {
  it("requires an explicit origin and build profile", () => {
    expect(() =>
      resolveMobileBuildTarget({
        apiOrigin: undefined,
        buildProfile: "compile-only",
        productionAuthorized: "false",
      }),
    ).toThrow(/VITE_MOBILE_API_ORIGIN is required/);
    expect(() =>
      resolveMobileBuildTarget({
        apiOrigin: "https://unconfigured.invalid",
        buildProfile: undefined,
        productionAuthorized: "false",
      }),
    ).toThrow(/MOBILE_BUILD_PROFILE/);
  });

  it("permits only the explicit non-routable compile-only origin", () => {
    expect(
      resolveMobileBuildTarget({
        apiOrigin: "https://unconfigured.invalid",
        buildProfile: "compile-only",
        productionAuthorized: "false",
      }),
    ).toMatchObject({ classification: "compile-only" });
    expect(() =>
      resolveMobileBuildTarget({
        apiOrigin: "https://vinifera-live.edstratumlabs.ai",
        buildProfile: "compile-only",
        productionAuthorized: "false",
      }),
    ).toThrow(/Compile-only native builds/);
  });

  it("requires an isolated staging workers.dev origin for runtime QA", () => {
    expect(
      resolveMobileBuildTarget({
        apiOrigin: "https://vinifera-staging.example.workers.dev",
        buildProfile: "staging-runtime",
        productionAuthorized: "false",
      }),
    ).toMatchObject({ classification: "staging-runtime-qa" });
    expect(() =>
      resolveMobileBuildTarget({
        apiOrigin: "https://staging.vinifera.edstratumlabs.ai",
        buildProfile: "staging-runtime",
        productionAuthorized: "false",
      }),
    ).toThrow(/isolated vinifera-staging workers.dev origin/);
  });

  it("requires a separate authorization flag for the production origin", () => {
    expect(() =>
      resolveMobileBuildTarget({
        apiOrigin: "https://vinifera-live.edstratumlabs.ai",
        buildProfile: "production-authorized",
        productionAuthorized: "false",
      }),
    ).toThrow(/separate explicit authorization/);
    expect(
      resolveMobileBuildTarget({
        apiOrigin: "https://vinifera-live.edstratumlabs.ai",
        buildProfile: "production-authorized",
        productionAuthorized: "true",
      }),
    ).toMatchObject({ classification: "production-authorized" });
  });

  it("rejects credentials, custom ports, paths, queries, and fragments", () => {
    for (const origin of [
      "https://user:pass@vinifera-staging.example.workers.dev",
      "https://vinifera-staging.example.workers.dev:8443",
      "https://vinifera-staging.example.workers.dev/api",
      "https://vinifera-staging.example.workers.dev?target=prod",
      "https://vinifera-staging.example.workers.dev#target",
    ]) {
      expect(() =>
        resolveMobileBuildTarget({
          apiOrigin: origin,
          buildProfile: "staging-runtime",
          productionAuthorized: "false",
        }),
      ).toThrow(/credential-free default-port HTTPS origin/);
    }
  });
});

describe("activation workflow wiring", () => {
  it("runs target verification before hosted mutation and labels compile-only artifacts", async () => {
    const workflow = await readFile(
      new URL("../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    expect(
      workflow.indexOf(
        "node scripts/verify-staging-activation.mjs verify-target supabase",
      ),
    ).toBeLessThan(workflow.indexOf("supabase db push"));
    expect(
      workflow.indexOf(
        "node scripts/verify-staging-activation.mjs verify-target cloudflare",
      ),
    ).toBeLessThan(
      workflow.indexOf("npx wrangler versions upload release/worker/worker.js"),
    );
    const securityGuardIndex = workflow.indexOf(
      "assertSecuritySecretSeparation(process.env)",
    );
    const stagingDeployIndex = workflow.indexOf(
      "npx wrangler versions upload release/worker/worker.js",
    );
    expect(securityGuardIndex).toBeGreaterThanOrEqual(0);
    expect(stagingDeployIndex).toBeGreaterThanOrEqual(0);
    expect(securityGuardIndex).toBeLessThan(stagingDeployIndex);
    expect(workflow).toContain("release-artifact.mjs verify");
    expect(workflow).toContain(
      "--no-bundle --assets release/dist --env staging",
    );
    expect(workflow).toContain("https://unconfigured.invalid");
    expect(workflow).toContain(
      "android-${{ vars.VITE_MOBILE_API_ORIGIN && 'staging-runtime-qa' || 'compile-only' }}-evidence",
    );
  });

  it("contains no native production-origin fallback", async () => {
    const files = await Promise.all(
      [
        "../../scripts/prepare-capacitor.mjs",
        "../../src/client/api/client.ts",
        "../../src/client/mobile/native-session.ts",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
    for (const source of files) {
      expect(source).not.toMatch(
        /\|\|\s*["']https:\/\/vinifera\.edstratumlabs\.ai/,
      );
    }
  });
});
