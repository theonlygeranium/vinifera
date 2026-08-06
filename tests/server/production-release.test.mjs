import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  assertActiveDeployment,
  assertHealthPayload,
  assertProductionConfirmation,
  assertRollbackDeploymentHistory,
  assertVersionMatchesGitSha,
  buildProductionSecretBundle,
  hashProductionTarget,
  parseWranglerJson,
  parseWranglerStagingVersionUploadOutput,
  parseWranglerVersionUploadOutput,
  soleActiveVersionId,
  versionGitSha,
  verifyProductionTargets,
} from "../../scripts/lib/production-release-guard.mjs";
import {
  captureProductionState,
  cutoverToWorker,
  probeWorkerDomainAttachment,
  restorePages,
  workerResourceExists,
} from "../../scripts/lib/cloudflare-production-control.mjs";

const gitSha = "a".repeat(40);
const versionId = "11111111-1111-4111-8111-111111111111";
const accountId = "1".repeat(32);
const zoneId = "2".repeat(32);
const hostname = "vinifera-live.edstratumlabs.ai";
const marketingHostname = "vinifera.edstratumlabs.ai";
const pagesProjectName = "vinifera-live";
const workerName = "vinifera-production";
const workerOrigin = "https://vinifera-production.example.workers.dev";
const certificateId = "33333333-3333-4333-8333-333333333333";
const pagesRoot = "<title>Vinifera</title>";
const pagesApp = "Fall 2026 Club Release";
const marketingGuide = "Vinifera Investor Guide";
const cutoverCapabilities = [
  "app",
  "database",
  "billing",
  "compliance",
  "communications",
  "customDomains",
  "webhook",
  "googleOAuth",
  "email",
  "integrationEncryption",
  "mobile",
  "quickBooksOAuth",
  "security",
  "push",
  "shipping",
];

function policy() {
  return {
    confirmations: {
      "attach-live-domain": "ATTACH VINIFERA LIVE DOMAIN TO WORKER",
      bootstrap: "BOOTSTRAP VINIFERA PRODUCTION WORKER",
      deploy: "DEPLOY VINIFERA PRODUCTION VERSION",
      rollback: "ROLL BACK VINIFERA PRODUCTION WORKER",
      "restore-live-pages": "RESTORE VINIFERA LIVE DOMAIN TO PAGES",
      upload: "UPLOAD VINIFERA PRODUCTION VERSION",
    },
    applicationOrigin: `https://${hostname}`,
    coreHealthCapabilities: [
      "app",
      "database",
      "billing",
      "security",
      "webhook",
    ],
    cutoverHealthCapabilities: cutoverCapabilities,
    liveBilling: {
      activationPath: "separate-human-approved-live-billing-cutover",
      enabled: false,
    },
    marketingOrigin: `https://${marketingHostname}`,
    pagesRollback: {
      appSha256: createHash("sha256").update(pagesApp).digest("hex"),
      deploymentHostnameSuffix: "vinifera-live.pages.dev",
      productionBranch: "main",
      rootSha256: createHash("sha256").update(pagesRoot).digest("hex"),
    },
    optionalSecrets: ["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    requiredSecretGroups: [
      {
        anyOf: ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"],
        label: "Supabase public credential",
      },
      {
        anyOf: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
        label: "Supabase server credential",
      },
    ],
    requiredSecrets: [
      "MEMBER_BRAND_CONTEXT_SECRET",
      "RATE_LIMIT_PEPPER",
      "STRIPE_PRICE_CELLAR",
      "STRIPE_PRICE_ESTATE",
      "STRIPE_PRICE_RESERVE",
      "STRIPE_PRICE_VINE",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "SUPABASE_URL",
    ],
    targetHashes: {
      cloudflareAccountIdSha256: [
        hashProductionTarget("cloudflareAccountId", accountId),
      ],
      cloudflareZoneIdSha256: [
        hashProductionTarget("cloudflareZoneId", zoneId),
      ],
      customHostnameSha256: [hashProductionTarget("customHostname", hostname)],
      pagesProjectNameSha256: [
        hashProductionTarget("pagesProjectName", pagesProjectName),
      ],
      workerNameSha256: [hashProductionTarget("workerName", workerName)],
      workerOriginSha256: [hashProductionTarget("workerOrigin", workerOrigin)],
    },
    version: 1,
    pagesProjectName,
    workerName,
  };
}

function targets() {
  return {
    cloudflareAccountId: accountId,
    cloudflareZoneId: zoneId,
    customHostname: hostname,
    pagesProjectName,
    workerName,
    workerOrigin,
  };
}

function secrets(overrides = {}) {
  return {
    MEMBER_BRAND_CONTEXT_SECRET:
      "test-member-context-secret-43f3b070-4f50-4a6b",
    RATE_LIMIT_PEPPER: "test-rate-limit-pepper-7b15a76f-9f4e-49f6",
    STRIPE_PRICE_CELLAR: "price_cellar",
    STRIPE_PRICE_ESTATE: "price_estate",
    STRIPE_PRICE_RESERVE: "price_reserve",
    STRIPE_PRICE_VINE: "price_vine",
    STRIPE_SECRET_KEY: "sk_test_release",
    STRIPE_WEBHOOK_SECRET: "whsec_release",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    SUPABASE_URL: "https://example.supabase.co",
    ...overrides,
  };
}

function configurationPayload(
  configured = true,
  capabilities = cutoverCapabilities,
) {
  return {
    data: Object.fromEntries(
      capabilities.map((capability) => [
        capability,
        { configured, missing: configured ? [] : ["MISSING"] },
      ]),
    ),
  };
}

function cloudflareMock({
  healthOk = true,
  includeCertificateId = true,
  marketingChangesAfterCutover = false,
  pagesPostFails = false,
  pagesDomain = true,
  pagesStatus = "active",
  workerExists = true,
  workerDomain = false,
} = {}) {
  const calls = [];
  const state = {
    pagesDomain,
    workerDomain,
  };
  const json = (result, status = 200) =>
    new Response(
      JSON.stringify({
        errors: [],
        messages: [],
        result,
        success: status < 400,
      }),
      {
        headers: { "Content-Type": "application/json" },
        status,
      },
    );
  const fetcher = vi.fn(async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    calls.push({ method, pathname: url.pathname, search: url.search });
    if (url.hostname !== "api.cloudflare.com") {
      if (url.pathname === "/api/health") {
        return new Response(
          JSON.stringify({
            data: {
              service: healthOk ? "vinifera-api" : "wrong-service",
              status: "ok",
              environment: "production",
              revision: gitSha,
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.pathname === "/api/health/configuration") {
        return new Response(JSON.stringify(configurationPayload(healthOk)), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.hostname === marketingHostname) {
        return new Response(
          marketingChangesAfterCutover && state.workerDomain
            ? "unexpected marketing mutation"
            : url.pathname === "/guide/"
              ? marketingGuide
              : pagesRoot,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      if (url.pathname === "/") {
        return new Response(pagesRoot, {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.pathname === "/app/") {
        return new Response(
          state.pagesDomain ? pagesApp : "Vinifera Club Management",
          {
            headers: { "Content-Type": "text/html" },
          },
        );
      }
      if (url.pathname === "/portal/") {
        return new Response("Vinifera Club Management", {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.pathname === "/.well-known/apple-app-site-association") {
        return new Response(
          JSON.stringify({
            applinks: {
              details: [
                {
                  appIDs: ["ABCDE12345.ai.edstratumlabs.vinifera"],
                  components: [
                    "/portal",
                    "/portal/auth",
                    "/app/fulfillment",
                  ].map((path) => ({ "/": path })),
                },
              ],
            },
          }),
        );
      }
      if (url.pathname === "/.well-known/assetlinks.json") {
        return new Response(
          JSON.stringify([
            {
              relation: ["delegate_permission/common.handle_all_urls"],
              target: {
                namespace: "android_app",
                package_name: "ai.edstratumlabs.vinifera",
                sha256_cert_fingerprints: ["AA:".repeat(31) + "AA"],
              },
            },
          ]),
        );
      }
      return new Response(null, { status: 404 });
    }
    if (url.pathname.endsWith(`/workers/services/${workerName}`)) {
      return workerExists
        ? json({ default_environment: { environment: "production" } })
        : json(null, 404);
    }
    if (url.pathname.endsWith(`/workers/scripts/${workerName}/deployments`)) {
      return json({
        deployments: [
          {
            created_on: "2026-07-26T00:00:00.000Z",
            id: "deployment-1",
            versions: [{ percentage: 100, version_id: versionId }],
          },
        ],
      });
    }
    if (url.pathname.endsWith("/workers/domains") && method === "GET") {
      return json(
        state.workerDomain
          ? [
              {
                ...(includeCertificateId ? { cert_id: certificateId } : {}),
                environment: "production",
                hostname,
                id: "worker-domain-1",
                service: workerName,
                zone_id: zoneId,
              },
            ]
          : [],
      );
    }
    if (url.pathname.endsWith("/workers/domains") && method === "PUT") {
      state.workerDomain = true;
      return json({
        ...(includeCertificateId ? { cert_id: certificateId } : {}),
        environment: "production",
        hostname,
        id: "worker-domain-1",
        service: workerName,
        zone_id: zoneId,
      });
    }
    if (
      url.pathname.endsWith("/workers/domains/worker-domain-1") &&
      method === "GET"
    ) {
      return json({
        ...(includeCertificateId ? { cert_id: certificateId } : {}),
        environment: "production",
        hostname,
        id: "worker-domain-1",
        service: workerName,
        zone_id: zoneId,
      });
    }
    if (
      url.pathname.endsWith("/workers/domains/worker-domain-1") &&
      method === "DELETE"
    ) {
      state.workerDomain = false;
      return json({ id: "worker-domain-1" });
    }
    if (
      url.pathname.endsWith(`/pages/projects/${pagesProjectName}`) &&
      method === "GET"
    ) {
      return json({
        name: pagesProjectName,
        production_branch: "main",
        subdomain: "vinifera-live.pages.dev",
      });
    }
    if (
      url.pathname.endsWith(
        `/pages/projects/${pagesProjectName}/deployments`,
      ) &&
      method === "GET"
    ) {
      return json([
        {
          environment: "production",
          id: "pages-deployment-1",
          url: "https://vinifera-live.pages.dev",
        },
      ]);
    }
    if (
      url.pathname.endsWith(`/pages/projects/${pagesProjectName}/domains`) &&
      method === "GET"
    ) {
      return json(
        state.pagesDomain ? [{ name: hostname, status: pagesStatus }] : [],
      );
    }
    if (
      url.pathname.endsWith(
        `/pages/projects/${pagesProjectName}/domains/${hostname}`,
      ) &&
      method === "DELETE"
    ) {
      state.pagesDomain = false;
      return json({ name: hostname });
    }
    if (
      url.pathname.endsWith(`/pages/projects/${pagesProjectName}/domains`) &&
      method === "POST"
    ) {
      if (pagesPostFails) return json(null, 500);
      state.pagesDomain = true;
      return json({ name: hostname, status: "pending" });
    }
    return json(null, 404);
  });
  return { calls, fetcher, state };
}

const controlOptions = (fetcher) => ({
  accountId,
  apiToken: "control-plane-token",
  attempts: 1,
  fetcher,
  expectedRevision: gitSha,
  hostname,
  pagesProjectName,
  mobile: {
    androidPackageName: "ai.edstratumlabs.vinifera",
    androidSigningCertSha256: "AA:".repeat(31) + "AA",
    appleTeamId: "ABCDE12345",
    iosBundleId: "ai.edstratumlabs.vinifera",
  },
  policy: policy(),
  sleep: vi.fn(),
  workerName,
  zoneId,
});

describe("production release guards", () => {
  it("requires exact operation confirmation phrases", () => {
    expect(() =>
      assertProductionConfirmation(
        policy(),
        "deploy",
        "DEPLOY VINIFERA PRODUCTION VERSION",
      ),
    ).not.toThrow();
    expect(() =>
      assertProductionConfirmation(
        policy(),
        "deploy",
        "deploy vinifera production version",
      ),
    ).toThrow(/Exact deploy confirmation phrase/);
  });

  it("fails closed on empty target allowlists and accepts every hashed domain target", async () => {
    const checkedIn = JSON.parse(
      await readFile(
        new URL("../../config/production-release-policy.json", import.meta.url),
        "utf8",
      ),
    );
    // P1-5 populated the allowlists with real SHA-256 hashes, so the
    // checked-in policy no longer has empty allowlists.  The test targets
    // use dummy values that won't match the real hashes, so verification
    // fails at the "not allowlisted" check rather than the "is empty" check.
    expect(() =>
      verifyProductionTargets({
        policy: checkedIn,
        scope: "worker",
        targets: targets(),
      }),
    ).toThrow(/not allowlisted for production/);
    expect(() =>
      verifyProductionTargets({
        policy: policy(),
        scope: "domain",
        targets: targets(),
      }),
    ).not.toThrow();
    expect(() =>
      verifyProductionTargets({
        policy: policy(),
        scope: "domain",
        targets: {
          ...targets(),
          customHostname: marketingHostname,
        },
      }),
    ).toThrow(/not allowlisted|live application topology/);
    expect(checkedIn.applicationOrigin).toBe(
      "https://vinifera-live.edstratumlabs.ai",
    );
    expect(checkedIn.marketingOrigin).toBe("https://vinifera.edstratumlabs.ai");
    expect(checkedIn.pagesProjectName).toBe("vinifera-live");
    expect(checkedIn.liveBilling).toEqual({
      activationPath: "separate-human-approved-live-billing-cutover",
      enabled: false,
    });
  });

  it("builds only allowlisted secret bindings and rejects live Stripe mode", () => {
    const bundle = buildProductionSecretBundle(secrets(), policy());
    expect(bundle).toMatchObject({
      STRIPE_SECRET_KEY: "sk_test_release",
      SUPABASE_ANON_KEY: "anon",
    });
    expect(bundle).not.toHaveProperty("LIVE_BILLING_ENABLED");
    expect(() =>
      buildProductionSecretBundle(
        secrets({ STRIPE_SECRET_KEY: "sk_live_release" }),
        policy(),
      ),
    ).toThrow(/Stripe test-mode only/);
    expect(() =>
      buildProductionSecretBundle(
        secrets({
          MEMBER_BRAND_CONTEXT_SECRET:
            "test-rate-limit-pepper-7b15a76f-9f4e-49f6",
        }),
        policy(),
      ),
    ).toThrow(/independently generated/);
    expect(() =>
      buildProductionSecretBundle(
        secrets({ RATE_LIMIT_PEPPER: "short" }),
        policy(),
      ),
    ).toThrow(/at least 32 UTF-8 bytes/);
  });

  it("parses one Wrangler version and rejects ambiguous output", () => {
    expect(
      parseWranglerVersionUploadOutput(`
        Worker Version ID: ${versionId}
        Version Preview URL: https://abc123-${workerName}.example.workers.dev
      `),
    ).toEqual({
      previewUrl: `https://abc123-${workerName}.example.workers.dev`,
      versionId,
    });
    expect(() =>
      parseWranglerVersionUploadOutput(`Worker Version ID: ${versionId}`),
    ).toThrow(/exactly one Version ID and preview URL/);
  });

  it("uses the configured staging origin when Wrangler omits a preview URL", () => {
    const configuredOrigin = `https://${workerName}.example.workers.dev`;
    expect(
      parseWranglerStagingVersionUploadOutput(
        `Worker Version ID: ${versionId}`,
        configuredOrigin,
      ),
    ).toEqual({ previewUrl: configuredOrigin, versionId });
    expect(
      parseWranglerStagingVersionUploadOutput(
        `Worker Version ID: ${versionId}\nVersion Preview URL: https://preview.example.workers.dev`,
        configuredOrigin,
      ),
    ).toEqual({
      previewUrl: "https://preview.example.workers.dev",
      versionId,
    });
    expect(() =>
      parseWranglerStagingVersionUploadOutput(
        `Worker Version ID: ${versionId}`,
        "",
      ),
    ).toThrow(/valid URL|origin/i);
  });

  it("binds version metadata and the sole active deployment to an immutable SHA", () => {
    const artifactSha256 = "b".repeat(64);
    expect(() =>
      assertVersionMatchesGitSha({
        artifactSha256,
        gitSha,
        version: {
          annotations: {
            "workers/message": `vinifera production git_sha=${gitSha} artifact_sha256=${artifactSha256}`,
            "workers/tag": `git-${gitSha}`,
          },
          id: versionId,
        },
        versionId,
      }),
    ).not.toThrow();
    expect(() =>
      assertVersionMatchesGitSha({
        artifactSha256,
        gitSha,
        version: {
          annotations: {
            "workers/message": `vinifera production git_sha=${gitSha}`,
            "workers/tag": `git-${gitSha}`,
          },
          id: versionId,
        },
        versionId,
      }),
    ).toThrow(/artifact/);
    expect(() =>
      assertActiveDeployment(
        { versions: [{ percentage: 100, version_id: versionId }] },
        versionId,
      ),
    ).not.toThrow();
    expect(
      soleActiveVersionId({
        versions: [{ percentage: 100, version_id: versionId }],
      }),
    ).toBe(versionId);
  });

  it("permits only a retained, previously sole-active rollback version", () => {
    const otherVersionId = "22222222-2222-4222-8222-222222222222";
    const history = [
      {
        versions: [{ percentage: 100, version_id: versionId }],
      },
      {
        versions: [{ percentage: 100, version_id: otherVersionId }],
      },
    ];
    expect(() =>
      assertRollbackDeploymentHistory(
        history,
        { versions: [{ percentage: 100, version_id: otherVersionId }] },
        versionId,
      ),
    ).not.toThrow();
    expect(() =>
      assertRollbackDeploymentHistory(
        history,
        { versions: [{ percentage: 100, version_id: versionId }] },
        versionId,
      ),
    ).toThrow(/already the sole active/);
    expect(() =>
      assertRollbackDeploymentHistory(
        [
          {
            versions: [{ percentage: 50, version_id: versionId }],
          },
        ],
        { versions: [{ percentage: 100, version_id: otherVersionId }] },
        versionId,
      ),
    ).toThrow(/not a sole 100% deployment/);
  });

  it("requires both API identity and profile-specific configuration health gates", () => {
    expect(() =>
      assertHealthPayload(
        {
          data: {
            environment: "production",
            revision: gitSha,
            service: "vinifera-api",
            status: "ok",
          },
        },
        configurationPayload(),
        policy(),
        "core",
        gitSha,
      ),
    ).not.toThrow();
    expect(() =>
      assertHealthPayload(
        {
          data: {
            environment: "production",
            revision: gitSha,
            service: "vinifera-api",
            status: "ok",
          },
        },
        configurationPayload(false),
        policy(),
        "core",
        gitSha,
      ),
    ).toThrow(/capability app is not activated/);
    expect(() =>
      assertHealthPayload(
        {
          data: {
            environment: "production",
            revision: gitSha,
            service: "vinifera-api",
            status: "ok",
          },
        },
        configurationPayload(true, [
          "app",
          "database",
          "billing",
          "security",
          "webhook",
        ]),
        policy(),
        "cutover",
        gitSha,
      ),
    ).toThrow(/capability compliance is not activated/);
    expect(() =>
      assertHealthPayload(
        {
          data: {
            environment: "production",
            revision: "b".repeat(40),
            service: "vinifera-api",
            status: "ok",
          },
        },
        configurationPayload(),
        policy(),
        "core",
        gitSha,
      ),
    ).toThrow(/exact production/);
    expect(() => parseWranglerJson("not-json", "deployment")).toThrow(
      /did not return valid JSON/,
    );
  });

  it("recovers an exact reviewed Git SHA from prior Worker version metadata", () => {
    expect(
      versionGitSha({
        annotations: {
          "workers/message": `vinifera production git_sha=${gitSha}`,
          "workers/tag": `git-${gitSha}`,
        },
      }),
    ).toBe(gitSha);
    expect(() =>
      versionGitSha({
        annotations: {
          "workers/message": "missing exact identity",
          "workers/tag": `git-${gitSha}`,
        },
      }),
    ).toThrow(/exact reviewed Git SHA/);
  });
});

describe("production release workflow", () => {
  it("is manual, pinned, reversible, test-mode only, and protects the live-domain mutation", async () => {
    const workflow = await readFile(
      new URL(
        "../../.github/workflows/production-worker-release.yml",
        import.meta.url,
      ),
      "utf8",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+(push|schedule):/m);
    expect(workflow).toContain("name: production");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain('[[ "$GITHUB_REF" != "refs/heads/main" ]]');
    expect(workflow).toContain('[[ "$GITHUB_SHA" != "$PRODUCTION_GIT_SHA" ]]');
    expect(workflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(workflow).toContain(
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    );
    expect(workflow).toContain(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    expect(workflow).toContain("wrangler deploy release/worker/worker.js");
    expect(workflow).toContain(
      "wrangler versions upload release/worker/worker.js",
    );
    expect(workflow).toContain("--no-bundle --assets release/dist");
    expect(workflow).toContain("release_artifact_run_id:");
    expect(workflow).toContain("activation_exit_evidence_run_id:");
    expect(workflow).toContain("hosted-activation-exit-${{ inputs.git_sha }}");
    expect(workflow).toContain(
      "node scripts/hosted-activation-exit.mjs verify",
    );
    expect(workflow).toContain("artifact_source_sha:");
    expect(workflow).toContain("release-artifact.mjs verify");
    expect(workflow).toContain("wrangler versions deploy");
    expect(workflow).toContain("wrangler rollback");
    expect(workflow).toContain('LIVE_BILLING_ENABLED: "false"');
    expect(workflow).toContain("verify-bootstrap-absent");
    expect(workflow).toContain("rollback_git_sha:");
    expect(workflow).toContain(
      "PRODUCTION_ARTIFACT_GIT_SHA: ${{ inputs.operation == 'rollback-worker' && inputs.rollback_git_sha || inputs.git_sha }}",
    );
    expect(workflow).toContain(
      'git merge-base --is-ancestor \\\n              "$PRODUCTION_ROLLBACK_GIT_SHA" "$PRODUCTION_GIT_SHA"',
    );
    expect(workflow).toContain(
      "node scripts/production-release.mjs verify-rollback-history",
    );
    expect(workflow).toContain(
      "control_git_sha=$PRODUCTION_GIT_SHA artifact_git_sha=$PRODUCTION_ARTIFACT_GIT_SHA",
    );
    expect(workflow).toContain("attach-live-domain");
    expect(workflow).toContain("restore-live-pages");
    expect(workflow).toContain("node scripts/production-release.mjs snapshot");
    expect(workflow).toContain(
      "node scripts/production-release.mjs attach-live-domain",
    );
    expect(workflow).toContain(
      "node scripts/production-release.mjs restore-live-pages",
    );
    expect(workflow).toContain("PRIOR_PRODUCTION_VERSION_ID");
    expect(workflow).toContain("automatic production rollback");
    expect(workflow).toContain("automatic_rollback_ready");
    expect(workflow).toContain(
      "The prior production Worker did not reconverge after automatic rollback.",
    );
    expect(workflow).toContain("steps.worker-smoke.outcome == 'failure'");
    expect(workflow).toContain("steps.deploy-worker.outcome == 'failure'");
    expect(workflow).toContain("steps.rollback-worker.outcome == 'failure'");
    expect(workflow).toContain(
      "node scripts/production-release.mjs version-git-sha",
    );
    expect(workflow).toContain("if: inputs.operation != 'restore-live-pages'");
    expect(workflow).toContain("--max-filesize 1048576");
    expect(workflow).not.toContain("cutover-domain");
    expect(workflow).not.toContain("pages project delete");
    expect(workflow).not.toMatch(/wrangler\s+pages\s+project\s+delete/);
    expect(workflow).not.toMatch(/--(?:route|routes|domain|domains)\b/);
    expect(workflow).toContain(
      '--var "APP_ORIGIN:$PRODUCTION_WORKER_ORIGIN"',
    );
    expect(workflow).toContain(
      '--var "ALLOWED_ORIGINS:$PRODUCTION_WORKER_ORIGIN,https://vinifera-live.edstratumlabs.ai,capacitor://localhost,https://localhost"',
    );
    expect(workflow).not.toContain(
      '--var "APP_ORIGIN:https://vinifera.edstratumlabs.ai"',
    );
  });

  it("keeps the named production Worker on workers.dev without automatic routes", async () => {
    const wrangler = JSON.parse(
      await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
    );
    const environmentExample = await readFile(
      new URL("../../.env.example", import.meta.url),
      "utf8",
    );
    const supabaseConfig = await readFile(
      new URL("../../supabase/config.toml", import.meta.url),
      "utf8",
    );
    expect(wrangler.env.production).toMatchObject({
      name: workerName,
      preview_urls: true,
      vars: {
        APP_ORIGIN: "https://vinifera-live.edstratumlabs.ai",
        LIVE_BILLING_ENABLED: "false",
      },
      workers_dev: true,
    });
    expect(wrangler.env.production).not.toHaveProperty("routes");
    expect(wrangler.env.production).not.toHaveProperty("route");
    expect(wrangler.env.production).not.toHaveProperty("domains");
    expect(wrangler.env.production).not.toHaveProperty("domain");
    expect(environmentExample).toContain(
      "PRODUCTION_CUSTOM_HOSTNAME=vinifera-live.edstratumlabs.ai",
    );
    expect(environmentExample).toContain(
      "PRODUCTION_PAGES_PROJECT_NAME=vinifera-live",
    );
    expect(supabaseConfig).toContain(
      "https://vinifera-live.edstratumlabs.ai/api/auth/staff/callback",
    );
    expect(supabaseConfig).toContain(
      "https://vinifera-live.edstratumlabs.ai/api/auth/member/callback",
    );
    expect(supabaseConfig).not.toContain(
      '"https://vinifera.edstratumlabs.ai/api/auth/',
    );
  });
});

describe("Cloudflare production control plane", () => {
  it("detects first-time bootstrap without mutating the Worker service", async () => {
    const absent = cloudflareMock({ workerExists: false });
    await expect(
      workerResourceExists(controlOptions(absent.fetcher)),
    ).resolves.toBe(false);
    const existing = cloudflareMock();
    await expect(
      workerResourceExists(controlOptions(existing.fetcher)),
    ).resolves.toBe(true);
    expect(absent.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("captures sanitized Worker and restorable Pages state", async () => {
    const mock = cloudflareMock();
    const snapshot = await captureProductionState(controlOptions(mock.fetcher));
    expect(snapshot).toMatchObject({
      pages: {
        productionDeployment: { id: "pages-deployment-1" },
        projectName: pagesProjectName,
      },
      worker: {
        deployment: { id: "deployment-1" },
        name: workerName,
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("control-plane-token");
  });

  it("cuts over from Pages to Worker only after health succeeds", async () => {
    const mock = cloudflareMock();
    await expect(
      cutoverToWorker(controlOptions(mock.fetcher)),
    ).resolves.toMatchObject({
      attached: {
        environment: "production",
        hostname,
        service: workerName,
        zoneId,
      },
    });
    expect(mock.state).toEqual({ pagesDomain: false, workerDomain: true });
    expect(
      mock.calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.pathname.includes("/pages/projects/") &&
          call.pathname.includes("/domains/"),
      ),
    ).toBe(true);
    expect(
      mock.calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.pathname ===
            `/client/v4/accounts/${accountId}/pages/projects/${pagesProjectName}`,
      ),
    ).toBe(false);
  });

  it("requires the exact Worker custom-domain attachment before HTTPS health", async () => {
    const mock = cloudflareMock({ includeCertificateId: false });
    await expect(
      probeWorkerDomainAttachment({
        ...controlOptions(mock.fetcher),
        domainId: "worker-domain-1",
      }),
    ).resolves.toMatchObject({
      environment: "production",
      hostname,
      service: workerName,
      zoneId,
    });
  });

  it("restores Pages automatically when post-cutover Worker health fails", async () => {
    const mock = cloudflareMock({ healthOk: false });
    await expect(cutoverToWorker(controlOptions(mock.fetcher))).rejects.toThrow(
      /Pages was restored/,
    );
    expect(mock.state).toEqual({ pagesDomain: true, workerDomain: false });
    expect(
      mock.calls.some(
        (call) =>
          call.method === "POST" &&
          call.pathname.endsWith(`/pages/projects/${pagesProjectName}/domains`),
      ),
    ).toBe(true);
  });

  it("restores Pages when the final marketing invariant changes", async () => {
    const mock = cloudflareMock({ marketingChangesAfterCutover: true });
    await expect(cutoverToWorker(controlOptions(mock.fetcher))).rejects.toThrow(
      /Pages was restored/,
    );
    expect(mock.state).toEqual({ pagesDomain: true, workerDomain: false });
  });

  it("refuses cutover unless the retained Pages hostname is active", async () => {
    const mock = cloudflareMock({ pagesStatus: "pending" });
    await expect(cutoverToWorker(controlOptions(mock.fetcher))).rejects.toThrow(
      /Pages hostname must be active/,
    );
    expect(mock.state).toEqual({ pagesDomain: true, workerDomain: false });
  });

  it("restores the retained Pages project and removes only the Worker domain", async () => {
    const mock = cloudflareMock({ pagesDomain: false, workerDomain: true });
    await expect(restorePages(controlOptions(mock.fetcher))).resolves.toEqual(
      expect.objectContaining({ restored: true }),
    );
    expect(mock.state).toEqual({ pagesDomain: true, workerDomain: false });
    expect(
      mock.calls.some(
        (call) =>
          call.method === "DELETE" &&
          call.pathname.endsWith(`/pages/projects/${pagesProjectName}`),
      ),
    ).toBe(false);
  });

  it("resumes an already attached Worker after an interrupted cutover", async () => {
    const mock = cloudflareMock({ pagesDomain: false, workerDomain: true });
    await expect(
      cutoverToWorker(controlOptions(mock.fetcher)),
    ).resolves.toMatchObject({
      resumed: true,
      publicProof: {
        routes: { androidAssociation: true, appleAssociation: true },
      },
    });
    expect(mock.state).toEqual({ pagesDomain: false, workerDomain: true });
  });

  it("continues cutover safely from an unowned interrupted topology", async () => {
    const mock = cloudflareMock({ pagesDomain: false, workerDomain: false });
    await expect(
      cutoverToWorker(controlOptions(mock.fetcher)),
    ).resolves.toMatchObject({
      resumed: true,
    });
    expect(mock.state).toEqual({ pagesDomain: false, workerDomain: true });
  });

  it("treats an already restored Pages domain as converged", async () => {
    const mock = cloudflareMock({ pagesDomain: true, workerDomain: false });
    await expect(
      restorePages(controlOptions(mock.fetcher)),
    ).resolves.toMatchObject({
      restored: true,
      resumed: true,
    });
    expect(mock.state).toEqual({ pagesDomain: true, workerDomain: false });
  });

  it("restores Pages from an unowned interrupted topology", async () => {
    const mock = cloudflareMock({ pagesDomain: false, workerDomain: false });
    await expect(
      restorePages(controlOptions(mock.fetcher)),
    ).resolves.toMatchObject({
      restored: true,
      resumed: true,
    });
    expect(mock.state).toEqual({ pagesDomain: true, workerDomain: false });
  });

  it("fails closed when both Pages and Worker claim the live hostname", async () => {
    const mock = cloudflareMock({ pagesDomain: true, workerDomain: true });
    await expect(cutoverToWorker(controlOptions(mock.fetcher))).rejects.toThrow(
      /both Worker and Pages/,
    );
    await expect(restorePages(controlOptions(mock.fetcher))).rejects.toThrow(
      /both Worker and Pages/,
    );
  });

  it("fully verifies Worker recovery when Pages restoration fails", async () => {
    const mock = cloudflareMock({
      pagesDomain: false,
      pagesPostFails: true,
      workerDomain: true,
    });
    await expect(restorePages(controlOptions(mock.fetcher))).rejects.toThrow(
      /Worker was fully restored/,
    );
    expect(mock.state).toEqual({ pagesDomain: false, workerDomain: true });
  });

  it("restores an unowned topology when Pages attachment fails", async () => {
    const mock = cloudflareMock({
      pagesDomain: false,
      pagesPostFails: true,
      workerDomain: false,
    });
    await expect(restorePages(controlOptions(mock.fetcher))).rejects.toThrow(
      /prior unowned topology was restored/,
    );
    expect(mock.state).toEqual({ pagesDomain: false, workerDomain: false });
    expect(
      mock.calls.some(
        (call) =>
          call.method === "PUT" && call.pathname.endsWith("/workers/domains"),
      ),
    ).toBe(false);
  });
});
