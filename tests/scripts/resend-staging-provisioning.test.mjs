import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeDnsRecords,
  authorizeTargets,
  dnsRecordPolicyEntry,
  ensureDomain,
  ensureRuntimeSendingKey,
  ensureWebhook,
  listResendCollection,
  normalizeDnsRecord,
  normalizeWebhookEndpoint,
  recordRuntimeCredential,
  reconcileDnsRecord,
  sha256,
  validateEvidenceBinding,
  validatePolicy,
} from "../../scripts/resend-staging-provisioning.mjs";
import { isAuthorityHighRiskPath } from "../../.github/scripts/delivery-policy.mjs";

const repositoryRoot = new URL("../../", import.meta.url);

afterEach(() => {
  vi.unstubAllGlobals();
});

function enabledPolicy(overrides = {}) {
  const accountId = "a".repeat(32);
  const zoneId = "b".repeat(32);
  const domain = "mail.staging.example.com";
  const endpoint =
    "https://vinifera-staging.account.workers.dev/api/webhooks/resend";
  return {
    inputs: { accountId, domain, endpoint, zoneId },
    policy: validatePolicy({
      schemaVersion: 1,
      enabled: true,
      cloudflareAccountIdSha256: [sha256(accountId)],
      cloudflareZoneIdSha256: [sha256(zoneId)],
      sendingDomainSha256: [sha256(domain)],
      webhookEndpointSha256: [sha256(endpoint)],
      runtimeApiKeyIdSha256: [],
      dnsRecords: [],
      ...overrides,
    }),
  };
}

describe("Resend staging provisioning controller", () => {
  it("ships disabled with no guessed target or DNS hashes", async () => {
    const policy = JSON.parse(
      await readFile(
        new URL(
          "config/resend-staging-provisioning-policy.json",
          repositoryRoot,
        ),
        "utf8",
      ),
    );
    expect(validatePolicy(policy)).toEqual(policy);
    expect(policy.enabled).toBe(false);
    expect(policy.cloudflareAccountIdSha256).toEqual([]);
    expect(policy.cloudflareZoneIdSha256).toEqual([]);
    expect(policy.sendingDomainSha256).toEqual([]);
    expect(policy.webhookEndpointSha256).toEqual([]);
    expect(policy.runtimeApiKeyIdSha256).toEqual([]);
    expect(policy.dnsRecords).toEqual([]);
  });

  it("records an existing runtime key hash before rejecting incomplete bootstrap policy", () => {
    const evidence = {};
    const { policy } = enabledPolicy();
    expect(() =>
      recordRuntimeCredential(
        evidence,
        {
          disposition: "existing",
          key: { id: "runtime-key-after-interrupted-bootstrap" },
          token: null,
        },
        policy,
        "bootstrap",
      ),
    ).toThrow(/previously reviewed ID policy/u);
    expect(evidence.runtimeCredential).toEqual({
      adminSeparated: true,
      authorized: false,
      disposition: "existing",
      domainRestricted: null,
      idSha256: sha256("runtime-key-after-interrupted-bootstrap"),
      permission: null,
    });
    expect(JSON.stringify(evidence.runtimeCredential)).not.toContain(
      "runtime-key-after-interrupted-bootstrap",
    );
  });

  it("fails before provider access and retains sanitized evidence while disabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vinifera-resend-policy-"));
    const output = join(directory, "report.json");
    try {
      const result = spawnSync(
        process.execPath,
        [
          new URL("scripts/resend-staging-provisioning.mjs", repositoryRoot)
            .pathname,
          "probe",
          "--output",
          output,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
            CLOUDFLARE_API_TOKEN: "not-contacted",
            CLOUDFLARE_ZONE_ID: "b".repeat(32),
            GITHUB_REPOSITORY: "theonlygeranium/vinifera",
            GITHUB_RUN_ATTEMPT: "1",
            GITHUB_RUN_ID: "12345",
            GITHUB_SHA: "a".repeat(40),
            PROVISIONING_GIT_SHA: "a".repeat(40),
            RESEND_PROVISIONING_API_KEY: "re_not_contacted",
            RESEND_PROVISIONING_CONFIRMATION: "PROBE VINIFERA STAGING RESEND",
            RESEND_SENDING_DOMAIN: "mail.staging.example.com",
            RESEND_WEBHOOK_ENDPOINT:
              "https://vinifera-staging.account.workers.dev/api/webhooks/resend",
          },
        },
      );
      expect(result.status).not.toBe(0);
      const evidence = JSON.parse(await readFile(output, "utf8"));
      expect(evidence).toMatchObject({
        failure: "Resend staging provisioning policy is disabled.",
        operation: "probe",
        ready: false,
        success: false,
      });
      expect(JSON.stringify(evidence)).not.toContain("not-contacted");
      expect(JSON.stringify(evidence)).not.toContain(
        "mail.staging.example.com",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("authorizes only one exact account, zone, domain, and staging webhook", () => {
    const { inputs, policy } = enabledPolicy();
    expect(authorizeTargets({ ...inputs, policy })).toEqual({
      domain: inputs.domain,
      endpoint: inputs.endpoint,
    });
    expect(() =>
      authorizeTargets({
        ...inputs,
        domain: "other.staging.example.com",
        policy,
      }),
    ).toThrow(/not authorized/u);
    expect(() =>
      normalizeWebhookEndpoint(
        "https://vinifera-staging.account.workers.dev/api/webhooks/other",
      ),
    ).toThrow(/exact isolated staging/u);
  });

  it("paginates every Resend inventory page with the last returned ID", async () => {
    const requests = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(async (url) => {
          requests.push(String(url));
          return Response.json({
            data: [{ id: "first-page-key" }],
            has_more: true,
          });
        })
        .mockImplementationOnce(async (url) => {
          requests.push(String(url));
          return Response.json({
            data: [{ id: "second-page-key" }],
            has_more: false,
          });
        }),
    );
    await expect(
      listResendCollection("/api-keys", "re_provisioning_admin"),
    ).resolves.toEqual([
      { id: "first-page-key" },
      { id: "second-page-key" },
    ]);
    expect(requests[0]).toContain("limit=100");
    expect(requests[1]).toContain("after=first-page-key");
  });

  it("normalizes exact Resend DNS records and retains MX priority", () => {
    const domain = "mail.staging.example.com";
    const mx = normalizeDnsRecord(
      {
        name: "send.mail.staging.example.com.",
        priority: 10,
        record: "SPF",
        type: "MX",
        value: "feedback-smtp.us-east-1.amazonses.com.",
      },
      domain,
    );
    expect(mx).toEqual({
      label: "SPF",
      name: `send.${domain}`,
      priority: 10,
      type: "MX",
      value: "feedback-smtp.us-east-1.amazonses.com",
    });
    expect(dnsRecordPolicyEntry(mx)).toEqual({
      nameSha256: sha256(`send.${domain}`),
      priority: 10,
      type: "MX",
      valueSha256: sha256("feedback-smtp.us-east-1.amazonses.com"),
    });
  });

  it("binds evidence to the exact workflow revision, policy, repository, and run", () => {
    const policyText = '{"schemaVersion":1}\n';
    expect(
      validateEvidenceBinding(
        {
          GITHUB_REPOSITORY: "theonlygeranium/vinifera",
          GITHUB_RUN_ATTEMPT: "2",
          GITHUB_RUN_ID: "12345",
          GITHUB_SHA: "a".repeat(40),
          PROVISIONING_GIT_SHA: "a".repeat(40),
        },
        policyText,
      ),
    ).toEqual({
      gitSha: "a".repeat(40),
      policySha256: sha256(policyText),
      repository: "theonlygeranium/vinifera",
      runAttempt: "2",
      runId: "12345",
    });
    expect(() =>
      validateEvidenceBinding(
        {
          GITHUB_REPOSITORY: "theonlygeranium/vinifera",
          GITHUB_RUN_ATTEMPT: "2",
          GITHUB_RUN_ID: "12345",
          GITHUB_SHA: "b".repeat(40),
          PROVISIONING_GIT_SHA: "a".repeat(40),
        },
        policyText,
      ),
    ).toThrow(/workflow revision/u);
  });

  it("fails closed until every returned DNS tuple is exactly authorized", () => {
    const record = normalizeDnsRecord(
      {
        name: "resend._domainkey",
        record: "DKIM",
        type: "TXT",
        value: "p=provider-key",
      },
      "mail.staging.example.com",
    );
    const { policy } = enabledPolicy({
      dnsRecords: [dnsRecordPolicyEntry(record)],
    });
    expect(
      authorizeDnsRecords([record], policy, { requireComplete: true }),
    ).toEqual({
      actual: [dnsRecordPolicyEntry(record)],
      authorizedCount: 1,
    });
    expect(() =>
      authorizeDnsRecords([{ ...record, value: "p=different-key" }], policy, {
        requireComplete: true,
      }),
    ).toThrow(/incomplete or stale/u);
  });

  it("inventories exact provider resources and creates only when authorized", async () => {
    const endpoint =
      "https://vinifera-staging.account.workers.dev/api/webhooks/resend";
    const requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        requests.push({ method: init.method, url: String(url) });
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/domains") {
          return Response.json(
            init.method === "POST"
              ? {
                  id: "domain-one",
                  name: "mail.staging.example.com",
                  records: [],
                  status: "not_started",
                }
              : { data: [] },
          );
        }
        if (pathname === "/webhooks") {
          return Response.json({
            data:
              init.method === "POST"
                ? undefined
                : [
                    {
                      endpoint,
                      id: "webhook-one",
                    },
                  ],
            ...(init.method === "POST"
              ? { id: "webhook-one", signing_secret: "whsec_test" }
              : {}),
          });
        }
        if (pathname === "/webhooks/webhook-one") {
          return Response.json({
            endpoint,
            events: ["email.sent"],
            id: "webhook-one",
            signing_secret: "whsec_test",
            status: "disabled",
          });
        }
        return Response.json({
          id: "domain-one",
          name: "mail.staging.example.com",
          records: [],
          status: "not_started",
        });
      }),
    );
    const domain = await ensureDomain(
      "re_test_key",
      "mail.staging.example.com",
      true,
    );
    expect(domain.disposition).toBe("created");
    const persistSigningSecret = vi.fn(async () => undefined);
    const webhook = await ensureWebhook(
      "re_test_key",
      endpoint,
      true,
      persistSigningSecret,
      sha256("webhook-one"),
    );
    expect(webhook.disposition).toBe("updated");
    expect(persistSigningSecret).not.toHaveBeenCalled();
    expect(requests.some((request) => request.method === "POST")).toBe(true);
    expect(requests.some((request) => request.method === "PATCH")).toBe(true);
    expect(requests.every((request) => request.method !== "DELETE")).toBe(true);
  });

  it("recovers a missing webhook ID only after persisting its one-time secret", async () => {
    const endpoint =
      "https://vinifera-staging.account.workers.dev/api/webhooks/resend";
    const order = [];
    let inventoryCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/webhooks" && init.method === "GET") {
          inventoryCalls += 1;
          if (inventoryCalls === 1) {
            order.push("inventory");
            return Response.json({ data: [] });
          }
          order.push("recover-id");
          throw new Error("synthetic inventory outage");
        }
        if (pathname === "/webhooks" && init.method === "POST") {
          order.push("create");
          return Response.json({
            signing_secret: "whsec_created_once",
          });
        }
        throw new Error(`Unexpected request: ${init.method} ${pathname}`);
      }),
    );
    const persistWebhookRecovery = vi.fn(async () => order.push("persist"));
    await expect(
      ensureWebhook(
        "re_test_key",
        endpoint,
        true,
        persistWebhookRecovery,
        undefined,
        vi.fn(),
      ),
    ).rejects.toThrow(/protected recovery envelope permits an exact retry/u);
    expect(persistWebhookRecovery).toHaveBeenCalledWith(
      "whsec_created_once",
      sha256(endpoint),
    );
    expect(order).toEqual([
      "inventory",
      "create",
      "persist",
      "recover-id",
      "recover-id",
    ]);

    const retryOrder = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/webhooks") {
          retryOrder.push("inventory");
          return Response.json({
            data: [{ endpoint, id: "webhook-created" }],
          });
        }
        if (pathname === "/webhooks/webhook-created") {
          retryOrder.push("retrieve");
          return Response.json({
            endpoint,
            events: [
              "email.bounced",
              "email.clicked",
              "email.complained",
              "email.delivered",
              "email.delivery_delayed",
              "email.failed",
              "email.opened",
              "email.sent",
            ],
            id: "webhook-created",
            status: "enabled",
          });
        }
        throw new Error(`Unexpected request: ${init.method} ${pathname}`);
      }),
    );
    const finalizeWebhookBinding = vi.fn(async () =>
      retryOrder.push("finalize"),
    );
    const result = await ensureWebhook(
      "re_test_key",
      endpoint,
      true,
      vi.fn(),
      undefined,
      finalizeWebhookBinding,
      JSON.stringify({
        endpointSha256: sha256(endpoint),
        schemaVersion: 1,
        signingSecret: "whsec_created_once",
      }),
    );
    expect(result.disposition).toBe("recovered");
    expect(finalizeWebhookBinding).toHaveBeenCalledWith(
      "whsec_created_once",
      sha256("webhook-created"),
    );
    expect(retryOrder).toEqual(["inventory", "retrieve", "finalize"]);
  });

  it("deletes a newly created webhook when one-time secret persistence fails", async () => {
    const endpoint =
      "https://vinifera-staging.account.workers.dev/api/webhooks/resend";
    const order = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/webhooks" && init.method === "GET") {
          order.push("inventory");
          return Response.json({ data: [] });
        }
        if (pathname === "/webhooks" && init.method === "POST") {
          order.push("create");
          return Response.json({
            id: "webhook-created",
            signing_secret: "whsec_created_once",
          });
        }
        if (pathname === "/webhooks/webhook-created" && init.method === "DELETE") {
          order.push("delete");
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected request: ${init.method} ${pathname}`);
      }),
    );
    await expect(
      ensureWebhook(
        "re_test_key",
        endpoint,
        true,
        async () => {
          order.push("persist");
          throw new Error("synthetic webhook persistence failure");
        },
        undefined,
        vi.fn(),
      ),
    ).rejects.toThrow(/webhook persistence failure/u);
    expect(order).toEqual(["inventory", "create", "persist", "delete"]);
  });

  it("rejects an existing webhook without its persisted secret binding", async () => {
    const endpoint =
      "https://vinifera-staging.account.workers.dev/api/webhooks/resend";
    const methods = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        methods.push(init.method);
        const pathname = new URL(String(url)).pathname;
        if (pathname === "/webhooks") {
          return Response.json({ data: [{ endpoint, id: "webhook-existing" }] });
        }
        return Response.json({
          endpoint,
          events: ["email.sent"],
          id: "webhook-existing",
          status: "disabled",
        });
      }),
    );
    await expect(
      ensureWebhook("re_test_key", endpoint, true, undefined, undefined),
    ).rejects.toThrow(/not bound to the persisted signing secret/u);
    expect(methods).toEqual(["GET", "GET"]);

    methods.length = 0;
    const finalizeWebhookBinding = vi.fn();
    await expect(
      ensureWebhook(
        "re_test_key",
        endpoint,
        false,
        undefined,
        undefined,
        finalizeWebhookBinding,
        JSON.stringify({
          endpointSha256: sha256(endpoint),
          schemaVersion: 1,
          signingSecret: "whsec_pending",
        }),
      ),
    ).rejects.toThrow(/protected mutating operation/u);
    expect(finalizeWebhookBinding).not.toHaveBeenCalled();
    expect(methods).toEqual(["GET", "GET"]);
  });

  it("creates a distinct sending-only runtime key restricted to the exact domain", async () => {
    const order = [];
    const fetchMock = vi
      .fn(async (_url, init) => {
        order.push(init.method === "POST" ? "create" : "inventory");
        if (init.method === "POST") {
          return Response.json({
            id: "runtime-key",
            token: "re_runtime_sender",
          });
        }
        return Response.json({
          data:
            order.length === 1
              ? []
              : [
                  {
                    id: "runtime-key",
                    name: "Vinifera staging runtime sender",
                  },
                ],
        });
      });
    vi.stubGlobal("fetch", fetchMock);
    const result = await ensureRuntimeSendingKey(
      "re_provisioning_admin",
      "domain-one",
      true,
      async (token) => {
        expect(token).toBe("re_runtime_sender");
        order.push("persist");
      },
    );
    expect(result).toMatchObject({
      disposition: "created",
      token: "re_runtime_sender",
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      domain_id: "domain-one",
      name: "Vinifera staging runtime sender",
      permission: "sending_access",
    });
    expect(order).toEqual(["inventory", "create", "persist", "inventory"]);
  });

  it("stops before post-creation inventory when one-time key persistence fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(
        Response.json({ id: "runtime-key", token: "re_runtime_sender" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      ensureRuntimeSendingKey(
        "re_provisioning_admin",
        "domain-one",
        true,
        async () => {
          throw new Error("synthetic persistence failure");
        },
      ),
    ).rejects.toThrow(/persistence failure/u);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain("/api-keys/runtime-key");
    expect(fetchMock.mock.calls[2][1].method).toBe("DELETE");
  });

  it("persists a one-time token before recovering a missing provider key ID", async () => {
    const order = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push("inventory");
        return Response.json({ data: [] });
      })
      .mockImplementationOnce(async () => {
        order.push("create");
        return Response.json({ token: "re_runtime_sender" });
      })
      .mockImplementationOnce(async () => {
        order.push("recover-id");
        throw new Error("synthetic inventory outage");
      });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      ensureRuntimeSendingKey(
        "re_provisioning_admin",
        "domain-one",
        true,
        async () => order.push("persist"),
      ),
    ).rejects.toThrow(/inventory outage/u);
    expect(order).toEqual(["inventory", "create", "persist", "recover-id"]);
  });

  it("deletes a newly created runtime key when its token response is malformed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(
        Response.json({ id: "runtime-key", token: "malformed" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      ensureRuntimeSendingKey(
        "re_provisioning_admin",
        "domain-one",
        true,
      ),
    ).rejects.toThrow(/credential format is invalid/u);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain("/api-keys/runtime-key");
    expect(fetchMock.mock.calls[2][1].method).toBe("DELETE");
  });

  it("creates only absent exact DNS and refuses conflicting records", async () => {
    const record = normalizeDnsRecord(
      {
        name: "send",
        priority: 10,
        record: "SPF",
        type: "MX",
        value: "feedback-smtp.us-east-1.amazonses.com",
      },
      "mail.staging.example.com",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: [], success: true }))
      .mockResolvedValueOnce(
        Response.json({ result: { id: "dns-one" }, success: true }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      reconcileDnsRecord("token", "b".repeat(32), record, { create: true }),
    ).resolves.toBe("created");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          result: [
            {
              content: "conflicting.example.com",
              name: record.name,
              priority: 10,
            },
          ],
          success: true,
        }),
      ),
    );
    await expect(
      reconcileDnsRecord("token", "b".repeat(32), record, { create: true }),
    ).rejects.toThrow(/conflicts/u);
  });

  it("rejects an exact existing CNAME when Cloudflare proxying is enabled", async () => {
    const record = normalizeDnsRecord(
      {
        name: "links.mail.staging.example.com.",
        record: "Tracking",
        type: "CNAME",
        value: "links1.resend-dns.com.",
      },
      "mail.staging.example.com",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          result: [
            {
              content: `${record.value}.`,
              name: `${record.name}.`,
              proxied: true,
            },
          ],
          success: true,
        }),
      ),
    );
    await expect(
      reconcileDnsRecord("token", "b".repeat(32), record, { create: false }),
    ).rejects.toThrow(/conflicts/u);
  });

  it("uses trusted default-branch code and protected repository credentials", async () => {
    const workflow = await readFile(
      new URL(
        ".github/workflows/resend-staging-provisioning.yml",
        repositoryRoot,
      ),
      "utf8",
    );
    expect(workflow).toContain('[[ "$GITHUB_REF" == "refs/heads/main" ]]');
    expect(workflow).toContain(
      "git fetch --no-tags origin main:refs/remotes/origin/main",
    );
    expect(workflow).toContain(
      "environment:\n      name: staging-acceptance-control",
    );
    expect(workflow).toContain(
      "RESEND_PROVISIONING_API_KEY: ${{ secrets.RESEND_PROVISIONING_API_KEY }}",
    );
    expect(workflow).toContain("PROVISIONING_GIT_SHA: ${{ inputs.git_sha }}");
    expect(workflow).toContain(
      "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    );
    expect(workflow).toContain(
      "GH_TOKEN: ${{ secrets.STAGING_GITHUB_VARIABLES_TOKEN }}",
    );
    expect(workflow).not.toContain("pull_request:");
    for (const path of [
      ".github/workflows/resend-staging-provisioning.yml",
      "scripts/resend-staging-provisioning.mjs",
    ]) {
      expect(isAuthorityHighRiskPath(path)).toBe(true);
    }
    const stagingWorkflow = await readFile(
      new URL(".github/workflows/ci.yml", repositoryRoot),
      "utf8",
    );
    for (const name of [
      "EMAIL_PROVIDER",
      "EMAIL_SIMULATOR_ENABLED",
      "RESEND_API_KEY",
      "RESEND_DOMAIN_VERIFIED",
      "RESEND_FROM",
      "RESEND_SENDING_DOMAIN",
      "RESEND_WEBHOOK_SECRET",
      "UNSUBSCRIBE_SIGNING_SECRET",
    ]) {
      expect(stagingWorkflow).toContain(
        `${name}: \${{ secrets.STAGING_${name} }}`,
      );
    }
  });

  it("writes secrets through stdin and keeps evidence sanitized", async () => {
    const controller = await readFile(
      new URL("scripts/resend-staging-provisioning.mjs", repositoryRoot),
      "utf8",
    );
    expect(controller).toContain(
      '["secret", "set", name, "--env", environment, "--repo", repository]',
    );
    expect(controller).toContain("child.stdin.end(value)");
    expect(controller).toContain(
      'setGitHubEnvironmentSecret(\n          "STAGING_RESEND_API_KEY"',
    );
    expect(controller).toContain('stdio: ["pipe", "ignore", "ignore"]');
    expect(controller).toContain("STAGING_RESEND_WEBHOOK_SECRET");
    expect(controller).toContain("STAGING_RESEND_WEBHOOK_RECOVERY");
    expect(controller).toContain(
      '["secret", "delete", name, "--env", environment, "--repo", repository]',
    );
    expect(controller).toContain("STAGING_UNSUBSCRIBE_SIGNING_SECRET");
    expect(controller).toContain("domainIdSha256");
    expect(controller).toContain("webhookIdSha256");
    expect(controller).not.toContain("evidence.webhookSecret");
    expect(controller).not.toContain("evidence.apiKey");
  });

  it("uses the official provider mutation endpoints without destructive calls", async () => {
    const controller = await readFile(
      new URL("scripts/resend-staging-provisioning.mjs", repositoryRoot),
      "utf8",
    );
    expect(controller).toContain('apiJson(RESEND_ORIGIN, "/domains"');
    expect(controller).toContain('method: "POST"');
    expect(controller).toContain('method: "PATCH"');
    expect(controller).toContain("/verify`");
    expect(controller).toContain("/dns_records`");
    expect(controller.match(/method: "DELETE"/gu)).toHaveLength(2);
    expect(controller).toContain(
      '`/webhooks/${encodeURIComponent(createdId)}`',
    );
    expect(controller).toContain("STAGING_RESEND_WEBHOOK_ID_SHA256");
    expect(controller).toContain('"staging-acceptance-control"');
    expect(controller).not.toContain("dns_records/batch");
  });
});
