import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  assertActiveDeployment,
  assertHealthPayload,
  assertProductionConfirmation,
  assertVersionMatchesGitSha,
  buildProductionSecretBundle,
  hashProductionTarget,
  parseWranglerJson,
  parseWranglerVersionUploadOutput,
  soleActiveVersionId,
  verifyProductionTargets,
} from "../../scripts/lib/production-release-guard.mjs";
import {
  captureProductionState,
  cutoverToWorker,
  restorePages,
  workerResourceExists,
} from "../../scripts/lib/cloudflare-production-control.mjs";

const gitSha = "a".repeat(40);
const versionId = "11111111-1111-4111-8111-111111111111";
const accountId = "1".repeat(32);
const zoneId = "2".repeat(32);
const hostname = "vinifera.edstratumlabs.ai";
const pagesProjectName = "vinifera";
const workerName = "vinifera-production";
const workerOrigin = "https://vinifera-production.example.workers.dev";
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
  "push",
  "shipping",
];

function policy() {
  return {
    confirmations: {
      bootstrap: "BOOTSTRAP VINIFERA PRODUCTION WORKER",
      cutover: "CUT OVER VINIFERA DOMAIN TO WORKER",
      deploy: "DEPLOY VINIFERA PRODUCTION VERSION",
      rollback: "ROLL BACK VINIFERA PRODUCTION WORKER",
      "restore-pages": "RESTORE VINIFERA DOMAIN TO PAGES",
      upload: "UPLOAD VINIFERA PRODUCTION VERSION",
    },
    coreHealthCapabilities: ["app", "database", "billing", "webhook"],
    cutoverHealthCapabilities: cutoverCapabilities,
    liveBilling: {
      activationPath: "separate-human-approved-live-billing-cutover",
      enabled: false,
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
      customHostnameSha256: [
        hashProductionTarget("customHostname", hostname),
      ],
      pagesProjectNameSha256: [
        hashProductionTarget("pagesProjectName", pagesProjectName),
      ],
      workerNameSha256: [hashProductionTarget("workerName", workerName)],
      workerOriginSha256: [
        hashProductionTarget("workerOrigin", workerOrigin),
      ],
    },
    version: 1,
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
    MEMBER_BRAND_CONTEXT_SECRET: "member-context",
    RATE_LIMIT_PEPPER: "rate-pepper",
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

function configurationPayload(configured = true, capabilities = cutoverCapabilities) {
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
    new Response(JSON.stringify({ errors: [], messages: [], result, success: status < 400 }), {
      headers: { "Content-Type": "application/json" },
      status,
    });
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
      if (url.pathname === "/") {
        return new Response("<title>Vinifera</title>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.pathname === "/app/") {
        return new Response("Fall 2026 Club Release", {
          headers: { "Content-Type": "text/html" },
        });
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
        subdomain: "vinifera.pages.dev",
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
          url: "https://vinifera.pages.dev",
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
  hostname,
  pagesProjectName,
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

  it("binds version metadata and the sole active deployment to an immutable SHA", () => {
    expect(() =>
      assertVersionMatchesGitSha({
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
    ).not.toThrow();
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

  it("requires both API identity and profile-specific configuration health gates", () => {
    expect(() =>
      assertHealthPayload(
        { data: { service: "vinifera-api", status: "ok" } },
        configurationPayload(),
        policy(),
      ),
    ).not.toThrow();
    expect(() =>
      assertHealthPayload(
        { data: { service: "vinifera-api", status: "ok" } },
        configurationPayload(false),
        policy(),
      ),
    ).toThrow(/capability app is not activated/);
    expect(() =>
      assertHealthPayload(
        { data: { service: "vinifera-api", status: "ok" } },
        configurationPayload(true, ["app", "database", "billing", "webhook"]),
        policy(),
        "cutover",
      ),
    ).toThrow(/capability compliance is not activated/);
    expect(() => parseWranglerJson("not-json", "deployment")).toThrow(
      /did not return valid JSON/,
    );
  });
});

describe("production release workflow", () => {
  it("is manual, pinned, reversible, test-mode only, and cannot delete Pages", async () => {
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
    expect(workflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    );
    expect(workflow).toContain(
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    );
    expect(workflow).toContain(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    expect(workflow).toContain("wrangler deploy --env production --strict");
    expect(workflow).toContain("wrangler versions upload --env production --strict");
    expect(workflow).toContain("wrangler versions deploy");
    expect(workflow).toContain("wrangler rollback");
    expect(workflow).toContain("LIVE_BILLING_ENABLED: \"false\"");
    expect(workflow).toContain("verify-bootstrap-absent");
    expect(workflow).toContain("restore-pages");
    expect(workflow).not.toContain("pages project delete");
    expect(workflow).not.toMatch(/wrangler\s+pages\s+project\s+delete/);
    expect(workflow).not.toMatch(/--(?:route|routes|domain|domains)\b/);
  });

  it("keeps the named production Worker on workers.dev without automatic routes", async () => {
    const wrangler = JSON.parse(
      await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
    );
    expect(wrangler.env.production).toMatchObject({
      name: workerName,
      preview_urls: true,
      vars: {
        LIVE_BILLING_ENABLED: "false",
      },
      workers_dev: true,
    });
    expect(wrangler.env.production).not.toHaveProperty("routes");
    expect(wrangler.env.production).not.toHaveProperty("route");
    expect(wrangler.env.production).not.toHaveProperty("domains");
    expect(wrangler.env.production).not.toHaveProperty("domain");
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
    expect(
      absent.calls.every((call) => call.method === "GET"),
    ).toBe(true);
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
      attached: { hostname, service: workerName },
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

  it("restores Pages automatically when post-cutover Worker health fails", async () => {
    const mock = cloudflareMock({ healthOk: false });
    await expect(
      cutoverToWorker(controlOptions(mock.fetcher)),
    ).rejects.toThrow(/Pages restoration was attempted/);
    expect(mock.state).toEqual({ pagesDomain: true, workerDomain: false });
  });

  it("refuses cutover unless the retained Pages hostname is active", async () => {
    const mock = cloudflareMock({ pagesStatus: "pending" });
    await expect(
      cutoverToWorker(controlOptions(mock.fetcher)),
    ).rejects.toThrow(/Pages hostname must be active/);
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
          call.pathname.endsWith(
            `/pages/projects/${pagesProjectName}`,
          ),
      ),
    ).toBe(false);
  });
});
