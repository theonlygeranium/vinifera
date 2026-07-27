import { afterEach, describe, expect, it, vi } from "vitest";
import { AvalaraClient, resolveTaxFailClosed } from "../../server/integrations/avalara";
import { CloudflareCustomHostnameClient } from "../../server/integrations/cloudflare-domains";
import {
  failedIntegrationJob,
  successfulIntegrationJob,
} from "../../server/integrations/jobs";
import {
  KLAVIYO_API_REVISION,
  KlaviyoClient,
  parseKlaviyoWebhookBatch,
  verifyKlaviyoWebhook,
} from "../../server/integrations/klaviyo";
import {
  buildHashedMetaUserData,
  MetaConversionsClient,
  normalizeMetaBrowserData,
  normalizeMetaTestEventCode,
} from "../../server/integrations/meta";
import {
  QuickBooksClient,
  quickBooksRequestId,
} from "../../server/integrations/quickbooks";
import {
  ApnsPushClient,
  createApnsPushClient,
} from "../../server/integrations/push";
import {
  constantTimeEqual,
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  hmacSha256Hex,
  normalizeMetaIdentifier,
  resolveExternalIntegrationCredentials,
} from "../../server/integrations/security";
import {
  formatBrandSender,
  ResendDomainsClient,
} from "../../server/integrations/resend-domains";
import {
  IntegrationProviderError,
  MAX_INTEGRATION_RESPONSE_BYTES,
  providerRequest,
  requestIntegrationJson,
} from "../../server/integrations/http";
import {
  androidAssetLinks,
  appleAppSiteAssociation,
  contrastRatio,
  evaluateThemeColor,
  executeIntegrationJob,
  integrationJobKind,
  metaPurchaseValue,
  metaAttributionCustomData,
  normalizeMetaAttribution,
  normalizeMobileClubCode,
  ProductionIntegrationService,
  quickBooksRefundDeltaFinancials,
  quickBooksShipmentFinancials,
  runMobilePushSchedule,
  uniqueMobileClubBrandId,
  validatedTheme,
} from "../../server/services/integrations";
import { brandAllowsOperationalAccess } from "../../server/services/core-club";
import type { WorkerEnv } from "../../server/types";
import {
  providerTargetPolicy,
  sha256ProviderTarget,
} from "../../server/provider-targets";
import { assertQuickBooksRedirectUri } from "../../server/config";

const organizationId = "10000000-0000-4000-8000-000000000001";
const integrationId = "20000000-0000-4000-8000-000000000002";
const encryptionEnv: WorkerEnv = {
  INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "2",
  INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
    "1": Buffer.alloc(32, 3).toString("base64"),
    "2": Buffer.alloc(32, 7).toString("base64"),
  }),
};

const address = {
  city: "Napa",
  country: "US",
  line1: "1 Winery Way",
  postalCode: "94558",
  state: "CA",
};

interface MockTableResult {
  data: unknown;
  error: null;
}

function integrationAdminMock(input: {
  onRpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => Promise<MockTableResult>;
  onTable: (
    table: string,
    filters: Record<string, unknown>,
    single: boolean,
  ) => MockTableResult;
  onUpsert?: (
    table: string,
    value: Record<string, unknown>,
  ) => MockTableResult;
}) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {};
      for (const method of [
        "gte",
        "gt",
        "in",
        "is",
        "limit",
        "lte",
        "or",
        "order",
        "range",
        "select",
      ]) {
        builder[method] = (...args: unknown[]) => {
          if (method === "in" || method === "is" || method === "gt") {
            filters[String(args[0])] = args[1];
          } else if (method === "select") {
            filters.__select = args[0];
          }
          return builder;
        };
      }
      builder.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      };
      builder.maybeSingle = async () => input.onTable(table, filters, true);
      builder.upsert = async (value: Record<string, unknown>) =>
        input.onUpsert?.(table, value) ?? { data: null, error: null };
      builder.then = (
        fulfilled: (value: MockTableResult) => unknown,
        rejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(input.onTable(table, filters, false)).then(
          fulfilled,
          rejected,
        );
      return builder;
    },
    rpc: vi.fn(input.onRpc),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mobile bootstrap tenant isolation", () => {
  it("scopes every offline snapshot query to the authenticated organization and brand", async () => {
    const brandId = "30000000-0000-4000-8000-000000000003";
    const otherBrandId = "30000000-0000-4000-8000-000000000099";
    const memberId = "40000000-0000-4000-8000-000000000004";
    const otherMemberId = "40000000-0000-4000-8000-000000000099";
    const filters: Array<{ column: string; table: string; value: unknown }> = [];
    const rows: Record<string, Array<Record<string, unknown>>> = {
      loyalty_ledger: [
        {
          brand_id: otherBrandId,
          description: "Other tenant points",
          id: "50000000-0000-4000-8000-000000000099",
          member_id: otherMemberId,
          organization_id: "10000000-0000-4000-8000-000000000099",
          points: 999,
        },
      ],
      members: [
        {
          brand_id: brandId,
          brands: {
            id: brandId,
            logo_url: null,
            name: "Tenant One",
            primary_color: "#6B1E30",
          },
          first_name: "Avery",
          id: memberId,
          last_name: "Member",
          organization_id: organizationId,
        },
      ],
      shipments: [
        {
          brand_id: otherBrandId,
          charge_amount_cents: 999_00,
          id: "60000000-0000-4000-8000-000000000099",
          member_id: otherMemberId,
          organization_id: "10000000-0000-4000-8000-000000000099",
          releases: { name: "Other tenant release" },
          status: "charged",
        },
      ],
    };
    const memberClient = {
      from(table: string) {
        const tableFilters: Array<{ column: string; value: unknown }> = [];
        const result = (single: boolean): MockTableResult => {
          const matching = (rows[table] ?? []).filter((row) =>
            tableFilters.every(({ column, value }) => row[column] === value),
          );
          return { data: single ? (matching[0] ?? null) : matching, error: null };
        };
        const builder = {
          eq(column: string, value: unknown) {
            filters.push({ column, table, value });
            tableFilters.push({ column, value });
            return builder;
          },
          limit() {
            return builder;
          },
          order() {
            return builder;
          },
          select() {
            return builder;
          },
          single() {
            return Promise.resolve(result(true));
          },
          then<TResult1 = MockTableResult, TResult2 = never>(
            onfulfilled?:
              | ((value: MockTableResult) => TResult1 | PromiseLike<TResult1>)
              | null,
            onrejected?:
              | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
              | null,
          ) {
            return Promise.resolve(result(false)).then(onfulfilled, onrejected);
          },
        };
        return builder;
      },
    };

    class MobileBootstrapService extends ProductionIntegrationService {
      protected override authenticatedSurfaceClient() {
        return memberClient as never;
      }

      protected override async requireMember() {
        return {
          brand: { id: brandId },
          organization: { id: organizationId },
          user: { id: memberId },
        } as never;
      }
    }

    const service = new MobileBootstrapService(
      {
        SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder",
        SUPABASE_URL: "https://example.supabase.co",
      } as WorkerEnv,
      {} as never,
      {} as never,
    );
    const bootstrap = await service.getMobileBootstrap();

    for (const table of ["members", "shipments", "loyalty_ledger"]) {
      expect(filters).toContainEqual({
        column: "organization_id",
        table,
        value: organizationId,
      });
      expect(filters).toContainEqual({
        column: "brand_id",
        table,
        value: brandId,
      });
    }
    expect(JSON.stringify(bootstrap)).not.toContain(otherBrandId);
    expect(JSON.stringify(bootstrap)).not.toContain(otherMemberId);
  });
});

describe("provider activation runtime seams", () => {
  it("resolves only allowlisted env credential bindings without exposing values", () => {
    const credentials = resolveExternalIntegrationCredentials<{
      accessToken: string;
    }>(
      {
        VINIFERA_INTEGRATION_SECRET_META_REHEARSAL: JSON.stringify({
          accessToken: "provider-secret-value",
        }),
      } as never,
      "env://VINIFERA_INTEGRATION_SECRET_META_REHEARSAL",
    );
    expect(credentials).toEqual({ accessToken: "provider-secret-value" });
    for (const reference of [
      "vault://vinifera/meta",
      "env://PATH",
      "env://vinifera_integration_secret_meta",
      "env://VINIFERA_INTEGRATION_SECRET_META/../../PATH",
    ]) {
      expect(() =>
        resolveExternalIntegrationCredentials(
          {} as never,
          reference,
        ),
      ).toThrowError(
        expect.objectContaining({ code: "activation_required", status: 503 }),
      );
    }
    try {
      resolveExternalIntegrationCredentials(
        {
          VINIFERA_INTEGRATION_SECRET_META_REHEARSAL:
            "provider-secret-value",
        } as never,
        "env://VINIFERA_INTEGRATION_SECRET_META_REHEARSAL",
      );
    } catch (error) {
      expect(String(error)).not.toContain("provider-secret-value");
      expect(String(error)).not.toContain(
        "VINIFERA_INTEGRATION_SECRET_META_REHEARSAL",
      );
    }
  });

  it("requires and normalizes Meta rehearsal codes outside production", () => {
    expect(normalizeMetaTestEventCode(" test123_abc ", true)).toBe(
      "TEST123_ABC",
    );
    expect(normalizeMetaTestEventCode(null, false)).toBeNull();
    expect(() => normalizeMetaTestEventCode(null, true)).toThrow(
      /required outside production/,
    );
    expect(() => normalizeMetaTestEventCode("LIVE123", false)).toThrow(
      /invalid/,
    );
  });

  it("creates and verifies only the exact Resend sender domain", async () => {
    const responses = [
      { data: [] },
      {
        id: "domain_123",
        name: "estate.example.com",
        status: "pending",
      },
      {},
      {
        capabilities: { sending: "enabled" },
        id: "domain_123",
        name: "estate.example.com",
        records: [
          {
            name: "send.estate.example.com",
            record: "SPF",
            status: "verified",
            type: "TXT",
            value: "v=spf1 include:amazonses.com ~all",
          },
        ],
        status: "verified",
      },
    ];
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toMatch(/^https:\/\/api\.resend\.com\//);
      expect(request.headers.get("authorization")).toBe(
        "Bearer resend-api-key",
      );
      return new Response(JSON.stringify(responses.shift()), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    const activation = await new ResendDomainsClient("resend-api-key", {
      fetcher,
      sleep: async () => undefined,
    }).activate("club@estate.example.com");
    expect(activation).toMatchObject({
      domain: "estate.example.com",
      providerIdentityId: "domain_123",
      status: "verified",
    });
    expect(activation.dnsRecords).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(
      formatBrandSender({
        fromEmail: "club@estate.example.com",
        fromName: "Estate Club",
      }),
    ).toBe("Estate Club <club@estate.example.com>");
    expect(() =>
      formatBrandSender({
        fromEmail: "club@evil.example",
        fromName: "Estate <attacker@example.com>",
      }),
    ).toThrow(/sender name is invalid/);
  });

  it("rejects a stored Resend identity that resolves to another domain", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          capabilities: { sending: "enabled" },
          id: "domain_123",
          name: "other.example.com",
          status: "verified",
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    );
    await expect(
      new ResendDomainsClient("resend-api-key", { fetcher }).activate(
        "club@estate.example.com",
        "domain_123",
      ),
    ).rejects.toMatchObject({ code: "upstream_error", status: 502 });
  });
});

async function testApnsPrivateKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", key.privateKey));
  return `-----BEGIN PRIVATE KEY-----\n${pkcs8
    .toString("base64")
    .match(/.{1,64}/g)
    ?.join("\n")}\n-----END PRIVATE KEY-----`;
}

describe("Phase 5 integration credential boundary", () => {
  it("compares fixed-size signature digests for equal and malformed inputs", () => {
    expect(constantTimeEqual("a".repeat(64), "a".repeat(64))).toBe(true);
    expect(constantTimeEqual("a".repeat(64), "b".repeat(64))).toBe(false);
    expect(constantTimeEqual("a".repeat(64), "")).toBe(false);
    expect(constantTimeEqual("", "a".repeat(64))).toBe(false);
  });

  it("pins the QuickBooks OAuth callback to the canonical application origin", () => {
    expect(
      assertQuickBooksRedirectUri({
        APP_ORIGIN: "https://vinifera.example",
        QUICKBOOKS_REDIRECT_URI:
          "https://vinifera.example/api/integrations/quickbooks/callback",
      }),
    ).toBe("https://vinifera.example/api/integrations/quickbooks/callback");
    for (const QUICKBOOKS_REDIRECT_URI of [
      "http://vinifera.example/api/integrations/quickbooks/callback",
      "https://attacker.example/api/integrations/quickbooks/callback",
      "https://vinifera.example:444/api/integrations/quickbooks/callback",
      "https://vinifera.example/api/integrations/quickbooks/callback?next=evil",
      "https://vinifera.example/api/integrations/quickbooks/other",
    ]) {
      expect(() =>
        assertQuickBooksRedirectUri({
          APP_ORIGIN: "https://vinifera.example",
          QUICKBOOKS_REDIRECT_URI,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "activation_required",
          status: 503,
        }),
      );
    }
  });

  it("round-trips AES-256-GCM credentials with key version and tenant AAD", async () => {
    const envelope = await encryptIntegrationCredentials(
      encryptionEnv,
      { integrationType: "klaviyo", organizationId, targetId: integrationId },
      { apiKey: "private-provider-key" },
    );
    expect(envelope).toMatchObject({
      algorithm: "A256GCM",
      keyVersion: "2",
      version: 1,
    });
    expect(envelope.ciphertext).not.toContain("private-provider-key");
    await expect(
      decryptIntegrationCredentials(
        encryptionEnv,
        {
          integrationType: "klaviyo",
          organizationId,
          targetId: integrationId,
        },
        envelope,
      ),
    ).resolves.toEqual({ apiKey: "private-provider-key" });
    await expect(
      decryptIntegrationCredentials(
        encryptionEnv,
        {
          integrationType: "klaviyo",
          organizationId: "30000000-0000-4000-8000-000000000003",
          targetId: integrationId,
        },
        envelope,
      ),
    ).rejects.toMatchObject({ code: "activation_required" });
    await expect(
      decryptIntegrationCredentials(
        encryptionEnv,
        {
          integrationType: "klaviyo",
          organizationId,
          targetId: "40000000-0000-4000-8000-000000000004",
        },
        envelope,
      ),
    ).rejects.toMatchObject({ code: "activation_required" });
  });

  it("honors Retry-After and exhausts retryable provider failures", async () => {
    const sleeps: number[] = [];
    const fetcher = vi
      .fn<(request: Request) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response("busy", {
          headers: { "Retry-After": "2" },
          status: 429,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    await expect(
      requestIntegrationJson({
        fetcher,
        request: providerRequest("https://provider.example/jobs", {
          method: "GET",
        }),
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).resolves.toEqual({ accepted: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([2_000]);
  });

  it("rejects oversized and invalid provider responses without retrying", async () => {
    const oversizedFetcher = vi.fn(async () =>
      new Response("not read", {
        headers: {
          "Content-Length": String(MAX_INTEGRATION_RESPONSE_BYTES + 1),
        },
      }),
    );
    await expect(
      requestIntegrationJson({
        attempts: 3,
        fetcher: oversizedFetcher,
        request: providerRequest("https://provider.example/oversized", {
          method: "GET",
        }),
      }),
    ).rejects.toMatchObject({
      providerCode: "provider_response_too_large",
      retryable: false,
    });
    expect(oversizedFetcher).toHaveBeenCalledTimes(1);

    const streamedOversizedFetcher = vi.fn(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new Uint8Array(MAX_INTEGRATION_RESPONSE_BYTES),
            );
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        }),
      ),
    );
    await expect(
      requestIntegrationJson({
        attempts: 3,
        fetcher: streamedOversizedFetcher,
        request: providerRequest(
          "https://provider.example/streamed-oversized",
          { method: "GET" },
        ),
      }),
    ).rejects.toMatchObject({
      providerCode: "provider_response_too_large",
      retryable: false,
    });
    expect(streamedOversizedFetcher).toHaveBeenCalledTimes(1);

    const invalidFetcher = vi.fn(async () =>
      new Response("{invalid", {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      requestIntegrationJson({
        attempts: 3,
        fetcher: invalidFetcher,
        request: providerRequest("https://provider.example/invalid", {
          method: "GET",
        }),
      }),
    ).rejects.toMatchObject({
      providerCode: "provider_invalid_response",
      retryable: false,
    });
    expect(invalidFetcher).toHaveBeenCalledTimes(1);
  });

  it("blocks redirects and bounds every provider attempt with a deadline", async () => {
    const redirectRequest = () =>
      providerRequest("https://provider.example/redirect", {
        body: "refresh_token=never-forward",
        headers: { Authorization: "Bearer never-forward" },
        method: "POST",
        redirect: "follow",
      });
    expect(redirectRequest().redirect).toBe("error");

    for (const status of [302, 307]) {
      const request = redirectRequest();
      const redirectFetcher = vi.fn(async (attempt: Request) => {
        expect(attempt.url).toBe("https://provider.example/redirect");
        expect(attempt.redirect).toBe("error");
        return new Response(null, {
          headers: { Location: "https://attacker.example/collect" },
          status,
        });
      });
      await expect(
        requestIntegrationJson({
          attempts: 3,
          fetcher: redirectFetcher,
          request,
        }),
      ).rejects.toMatchObject({
        providerCode: "provider_rejected_request",
        retryable: false,
      });
      expect(redirectFetcher).toHaveBeenCalledTimes(1);
    }

    const request = redirectRequest();
    const fetcher = vi.fn(
      (attempt: Request) =>
        new Promise<Response>((_resolve, reject) => {
          attempt.signal.addEventListener(
            "abort",
            () => reject(attempt.signal.reason),
            { once: true },
          );
        }),
    );
    await expect(
      requestIntegrationJson({
        attempts: 1,
        fetcher,
        request,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({
      providerCode: "provider_timeout",
      retryable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 5 provider clients", () => {
  it("keeps real-UUID QuickBooks refund targets distinct within Intuit's 50-character limit", () => {
    const shipmentId = "a8000000-0000-4000-8000-000000000001";
    const first = quickBooksRequestId(
      `quickbooks:refund:${shipmentId}:4863`,
    );
    const later = quickBooksRequestId(
      `quickbooks:refund:${shipmentId}:9725`,
    );

    expect(first).toMatch(/^vinifera_[0-9a-f]{40}$/);
    expect(first).toHaveLength(49);
    expect(first).not.toBe(later);
    expect(quickBooksRequestId(`quickbooks:refund:${shipmentId}:4863`)).toBe(
      first,
    );
  });

  it("routes APNs by explicit environment and binds the app bundle topic", async () => {
    const privateKey = await testApnsPrivateKey();
    const requests: Request[] = [];
    const fetcher = vi.fn(async (request: Request) => {
      requests.push(request);
      return new Response(null, { status: 200 });
    });
    const shared = {
      bundleId: "ai.edstratumlabs.vinifera",
      keyId: "KEYID12345",
      privateKey,
      teamId: "TEAM123456",
    };
    for (const environment of ["sandbox", "production"] as const) {
      const client = new ApnsPushClient(
        { ...shared, environment },
        { fetcher },
      );
      await client.send({
        body: "Your shipment is ready.",
        title: "Vinifera",
        token: "a".repeat(64),
      });
    }
    expect(new URL(requests[0]!.url).hostname).toBe(
      "api.sandbox.push.apple.com",
    );
    expect(new URL(requests[1]!.url).hostname).toBe("api.push.apple.com");
    expect(requests.map((request) => request.headers.get("apns-topic"))).toEqual([
      "ai.edstratumlabs.vinifera",
      "ai.edstratumlabs.vinifera",
    ]);
  });

  it("fails APNs activation when push and signed-app bundle identities differ", () => {
    expect(() =>
      createApnsPushClient({
        APNS_BUNDLE_ID: "ai.edstratumlabs.another-app",
        APNS_ENVIRONMENT: "sandbox",
        APNS_KEY_ID: "KEYID12345",
        APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-used",
        APNS_TEAM_ID: "TEAM123456",
        MOBILE_IOS_BUNDLE_ID: "ai.edstratumlabs.vinifera",
      }),
    ).toThrow(/APNS_BUNDLE_ID must match MOBILE_IOS_BUNDLE_ID/);
    expect(
      () =>
        new ApnsPushClient({
          bundleId: "ai.edstratumlabs.vinifera",
          environment: "staging" as never,
          keyId: "KEYID12345",
          privateKey: "-----BEGIN PRIVATE KEY-----\nnot-used",
          teamId: "TEAM123456",
        }),
    ).toThrow(/Apple Push Notification credentials are not configured/);
  });

  it("rejects APNs production routing from hosted staging", () => {
    expect(() =>
      createApnsPushClient({
        APP_ENV: "staging",
        APNS_BUNDLE_ID: "ai.edstratumlabs.vinifera",
        APNS_ENVIRONMENT: "production",
        APNS_KEY_ID: "KEYID12345",
        APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-used",
        APNS_TEAM_ID: "TEAM123456",
        MOBILE_IOS_BUNDLE_ID: "ai.edstratumlabs.vinifera",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "activation_required",
        status: 503,
      }),
    );
  });

  it("rejects an unknown APNs environment before selecting an endpoint", () => {
    expect(() =>
      createApnsPushClient({
        APP_ENV: "staging",
        APNS_BUNDLE_ID: "ai.edstratumlabs.vinifera",
        APNS_ENVIRONMENT: "preview" as never,
        APNS_KEY_ID: "KEYID12345",
        APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nnot-used",
        APNS_TEAM_ID: "TEAM123456",
        MOBILE_IOS_BUNDLE_ID: "ai.edstratumlabs.vinifera",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "activation_required",
        status: 503,
      }),
    );
  });

  it("uses Klaviyo revisioned async bulk imports for 1,000 profiles", async () => {
    let requestBody = "";
    const fetcher = vi.fn(async (request: Request) => {
      requestBody = await request.text();
      expect(request.url).toContain("/api/profile-bulk-import-jobs");
      expect(request.headers.get("revision")).toBe(KLAVIYO_API_REVISION);
      expect(request.headers.get("authorization")).toBe(
        "Klaviyo-API-Key pk_test_provider_only",
      );
      return new Response(
        JSON.stringify({ data: { id: "bulk-job-1234" } }),
        { headers: { "Content-Type": "application/json" }, status: 202 },
      );
    });
    const client = new KlaviyoClient(
      { apiKey: "pk_test_provider_only" },
      { fetcher },
    );
    const profiles = Array.from({ length: 1_000 }, (_, index) => ({
      email: `member-${index}@example.test`,
      externalId: `member-${index}`,
      properties: { club_tier: "Reserve", lifetime_value: index },
    }));
    await expect(
      client.bulkImportProfiles(profiles, "brand-full-sync-1"),
    ).resolves.toEqual({ jobId: "bulk-job-1234" });
    expect(JSON.parse(requestBody).data.attributes.profiles.data).toHaveLength(
      1_000,
    );
  });

  it("verifies Klaviyo HMAC and rejects replay-window violations", async () => {
    const payload = new TextEncoder().encode('{"id":"evt-1"}');
    const timestamp = "Sun, 26 Jul 2026 16:00:00 GMT";
    const signed = new Uint8Array([
      ...payload,
      ...new TextEncoder().encode(timestamp),
    ]);
    const signature = await hmacSha256Hex("webhook-secret", signed);
    await expect(
      verifyKlaviyoWebhook({
        now: new Date(timestamp),
        payload,
        secret: "webhook-secret",
        signature,
        timestamp,
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyKlaviyoWebhook({
        now: new Date(Date.parse(timestamp) + 10 * 60 * 1_000),
        payload,
        secret: "webhook-secret",
        signature,
        timestamp,
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("parses a signed-contract Klaviyo batch and allowlists open/click events", () => {
    const webhookId = "webhook-12345678";
    const payload = new TextEncoder().encode(
      JSON.stringify({
        data: [
          {
            external_id: "event-open-1",
            payload: {
              data: {
                attributes: { datetime: "2026-07-26T16:00:00.000Z" },
                relationships: {
                  profile: { data: { id: "profile-1", type: "profile" } },
                },
                type: "event",
              },
            },
            topic: "event:klaviyo.opened_email",
          },
          {
            external_id: "event-click-2",
            payload: {
              data: {
                attributes: { timestamp: 1_785_081_660 },
                relationships: {
                  profile: { data: { id: "profile-2", type: "profile" } },
                },
                type: "event",
              },
            },
            topic: "event:klaviyo.clicked_email",
          },
        ],
        meta: { klaviyo_webhook_id: webhookId },
      }),
    );
    expect(parseKlaviyoWebhookBatch(payload, webhookId)).toEqual({
      events: [
        {
          datetime: "2026-07-26T16:00:00.000Z",
          eventId: "event-open-1",
          eventType: "email_opened",
          profileExternalId: "profile-1",
        },
        {
          datetime: "2026-07-26T16:01:00.000Z",
          eventId: "event-click-2",
          eventType: "email_clicked",
          profileExternalId: "profile-2",
        },
      ],
      ignored: 0,
    });
    expect(() =>
      parseKlaviyoWebhookBatch(payload, "different-webhook"),
    ).toThrow(/identity/);
  });

  it("serializes QuickBooks rolling refresh-token persistence", async () => {
    let refreshCalls = 0;
    let receiptCalls = 0;
    const persisted: string[] = [];
    const fetcher = vi.fn(async (request: Request) => {
      if (request.url.includes("/tokens/bearer")) {
        refreshCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: "rotated-access",
            expires_in: 3600,
            refresh_token: "rotated-refresh",
            x_refresh_token_expires_in: 8_000_000,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      receiptCalls += 1;
      const entity = request.url.includes("/refundreceipt")
        ? "RefundReceipt"
        : "SalesReceipt";
      return new Response(
        JSON.stringify({
          [entity]: { Id: `qbo-${receiptCalls}`, SyncToken: "0" },
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });
    const client = new QuickBooksClient(
      integrationId,
      {
        accessToken: "expired-access",
        accessTokenExpiresAt: "2020-01-01T00:00:00.000Z",
        realmId: "realm-1",
        refreshToken: "rolling-refresh",
      },
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        environment: "sandbox",
        redirectUri: "https://vinifera.test/api/integrations/quickbooks/callback",
      },
      {
        fetcher,
        persistRotatedCredentials: async (credentials) => {
          persisted.push(credentials.refreshToken);
        },
      },
    );
    const receipt = {
      currencyCode: "USD",
      customerRef: "customer-1",
      depositAccountRef: "account-1",
      docNumber: "VIN-1001",
      lines: [
        {
          amountCents: 12_500,
          description: "Reserve shipment",
          itemRef: "item-1",
          taxCodeRef: "TAX",
        },
      ],
      privateNote: "shipment:1",
      taxCents: 1_250,
      transactionDate: "2026-07-26",
    };
    await Promise.all([
      client.createSalesReceipt(receipt, "shipment-1001-sales"),
      client.createRefundReceipt(receipt, "shipment-1001-refund"),
    ]);
    expect(refreshCalls).toBe(1);
    expect(persisted).toEqual(["rotated-refresh"]);
  });

  it("queries by DocNumber instead of blindly retrying an ambiguous QuickBooks write", async () => {
    let posts = 0;
    let queries = 0;
    const fetcher = vi.fn(async (request: Request) => {
      if (request.method === "POST") {
        posts += 1;
        throw new TypeError("connection reset after send");
      }
      queries += 1;
      return new Response(
        JSON.stringify({
          QueryResponse: {
            SalesReceipt: [
              { DocNumber: "VIN-2002", Id: "qbo-recovered", SyncToken: "1" },
            ],
          },
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });
    const client = new QuickBooksClient(
      integrationId,
      {
        accessToken: "active-access",
        accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        realmId: "realm-2",
        refreshToken: "refresh",
      },
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        environment: "sandbox",
        redirectUri: "https://vinifera.test/callback",
      },
      {
        fetcher,
        persistRotatedCredentials: async () => undefined,
      },
    );
    await expect(
      client.createSalesReceipt(
        {
          currencyCode: "USD",
          customerRef: "customer",
          depositAccountRef: "account",
          docNumber: "VIN-2002",
          lines: [
            {
              amountCents: 5_000,
              description: "Shipment",
              itemRef: "item",
            },
          ],
          privateNote: "shipment",
          taxCents: 0,
          transactionDate: "2026-07-26",
        },
        "shipment-2002-sales",
      ),
    ).resolves.toEqual({ id: "qbo-recovered", syncToken: "1" });
    expect(posts).toBe(1);
    expect(queries).toBe(1);
  });

  it("reconciles all paged Vinifera QuickBooks receipts net of refunds", async () => {
    const queries: string[] = [];
    const fetcher = vi.fn(async (request: Request) => {
      const query = new URL(request.url).searchParams.get("query") ?? "";
      queries.push(query);
      if (
        query.includes("SalesReceipt") &&
        !query.includes("startposition 1001")
      ) {
        return new Response(
          JSON.stringify({
            QueryResponse: {
              SalesReceipt: Array.from({ length: 1_000 }, (_, index) => ({
                Id: `sale-${index}`,
                TotalAmt: 1,
              })),
            },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      if (query.includes("SalesReceipt")) {
        return new Response(
          JSON.stringify({
            QueryResponse: { SalesReceipt: [{ Id: "sale-1001", TotalAmt: 2 }] },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          QueryResponse: { RefundReceipt: [{ Id: "refund-1", TotalAmt: 3 }] },
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });
    const client = new QuickBooksClient(
      integrationId,
      {
        accessToken: "active-access",
        accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        realmId: "realm-reconcile",
        refreshToken: "refresh",
      },
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        environment: "sandbox",
        redirectUri: "https://vinifera.test/callback",
      },
      {
        fetcher,
        persistRotatedCredentials: async () => undefined,
      },
    );
    await expect(
      client.getNetTransactionTotal("2026-06-01", "2026-06-30"),
    ).resolves.toBe(99_900);
    expect(queries).toHaveLength(3);
    expect(queries.every((query) => query.includes("DocNumber like 'VIN-%'"))).toBe(
      true,
    );
    expect(
      queries.some((query) => query.includes("startposition 1001")),
    ).toBe(true);
  });

  it("executes a partial-refund QuickBooks job as a delta refund receipt while status remains charged", async () => {
    const envelope = await encryptIntegrationCredentials(
      encryptionEnv,
      {
        integrationType: "quickbooks",
        organizationId,
        targetId: integrationId,
      },
      {
        accessToken: "active-access-token",
        accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        realmId: "realm-partial-refund",
        refreshToken: "rolling-refresh-token",
      },
    );
    const persisted: Array<Record<string, unknown>> = [];
    const admin = integrationAdminMock({
      onRpc: async (name, parameters) => {
        if (name === "get_integration_runtime") {
          return {
            data: {
              algorithm: envelope.algorithm,
              connection_id: integrationId,
              credential_ciphertext: envelope.ciphertext,
              credential_iv: envelope.iv,
              envelope_version: envelope.version,
              integration_type: "quickbooks",
              key_version: envelope.keyVersion,
              organization_id: organizationId,
              storage_mode: "encrypted_envelope",
              sync_config: {
                currencyCode: "USD",
                defaultCustomerRef: "customer-1",
                defaultItemRef: "item-1",
                depositAccountRef: "deposit-1",
                taxCodeRef: "TAX",
              },
            },
            error: null,
          };
        }
        if (name === "claim_integration_refund_delivery") {
          return {
            data: {
              delta_amount_cents: 5_363,
              lease_token: "refund-delivery-lease",
              outcome: "claimed",
              prior_cumulative_amount_cents: 0,
              provider_request_key: "quickbooks:refund:shipment:5363",
              reclaimed: false,
              retry_after: "2026-07-26T13:02:00.000Z",
              target_cumulative_amount_cents: 5_363,
            },
            error: null,
          };
        }
        if (name === "complete_quickbooks_refund_delivery") {
          persisted.push(parameters);
          return { data: 5_363, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
      onTable: (table) => {
        if (table === "shipments") {
          return {
            data: {
              charge_amount_cents: 12_000,
              id: "30000000-0000-4000-8000-000000000003",
              loyalty_discount_cents: 2_000,
              member_id: "40000000-0000-4000-8000-000000000004",
              paid_at: "2026-07-26T12:00:00.000Z",
              refund_amount_cents: 5_363,
              shipping_charge_cents: 2_000,
              status: "charged",
              tax_amount_cents: 725,
              tier_id: null,
              updated_at: "2026-07-26T13:00:00.000Z",
            },
            error: null,
          };
        }
        if (table === "quickbooks_account_mappings") {
          return {
            data: [
              {
                mapping_kind: "membership",
                quickbooks_account_id: "deposit-1",
                quickbooks_item_id: "item-1",
              },
              {
                mapping_kind: "shipping",
                quickbooks_account_id: "shipping-income-1",
                quickbooks_item_id: "shipping-item-1",
              },
            ],
            error: null,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    });
    const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        requests.push({
          body: JSON.parse(await request.text()),
          url: request.url,
        });
        return new Response(
          JSON.stringify({
            RefundReceipt: { Id: "qbo-partial-refund", SyncToken: "0" },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }),
    );

    await expect(
      executeIntegrationJob(
        {
          ...encryptionEnv,
          APP_ORIGIN: "https://vinifera.test",
          QUICKBOOKS_CLIENT_ID: "quickbooks-client",
          QUICKBOOKS_CLIENT_SECRET: "quickbooks-secret",
          QUICKBOOKS_ENVIRONMENT: "sandbox",
          QUICKBOOKS_REDIRECT_URI:
            "https://vinifera.test/api/integrations/quickbooks/callback",
        },
        admin as never,
        {
          attempt_count: 1,
          brand_id: "50000000-0000-4000-8000-000000000005",
          connection_id: integrationId,
          cursor_data: {},
          entity_id: "30000000-0000-4000-8000-000000000003",
          idempotency_key: "quickbooks-partial-refund",
          integration_type: "quickbooks",
          job_id: "60000000-0000-4000-8000-000000000006",
          lease_token: "lease-token",
          max_attempts: 8,
          organization_id: organizationId,
          payload: {
            change_type: "refund",
            refund_amount_cents: 5_363,
          },
          sync_type: "quickbooks.transaction.upsert",
        },
      ),
    ).resolves.toMatchObject({ outcome: "synced", processed: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/refundreceipt");
    expect(requests[0]?.body).toMatchObject({
      Line: [
        {
          Amount: 40,
          SalesItemLineDetail: {
            ItemRef: { value: "item-1" },
          },
        },
        {
          Amount: 10,
          SalesItemLineDetail: {
            ItemRef: { value: "shipping-item-1" },
          },
        },
      ],
      TxnTaxDetail: { TotalTax: 3.63 },
    });
    expect(persisted).toEqual([
      expect.objectContaining({
        p_amount_cents: 5_363,
        p_lease_token: "refund-delivery-lease",
        p_provider_transaction_id: "qbo-partial-refund",
        p_tax_cents: 363,
      }),
    ]);
  });

  it("retries a later QuickBooks refund target without calling Intuit while an earlier target is in flight", async () => {
    const envelope = await encryptIntegrationCredentials(
      encryptionEnv,
      {
        integrationType: "quickbooks",
        organizationId,
        targetId: integrationId,
      },
      {
        accessToken: "active-access-token",
        accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        realmId: "realm-concurrent-refund",
        refreshToken: "rolling-refresh-token",
      },
    );
    const admin = integrationAdminMock({
      onRpc: async (name) => {
        if (name === "get_integration_runtime") {
          return {
            data: {
              algorithm: envelope.algorithm,
              connection_id: integrationId,
              credential_ciphertext: envelope.ciphertext,
              credential_iv: envelope.iv,
              envelope_version: envelope.version,
              integration_type: "quickbooks",
              key_version: envelope.keyVersion,
              organization_id: organizationId,
              storage_mode: "encrypted_envelope",
              sync_config: {
                defaultCustomerRef: "customer-1",
                defaultItemRef: "item-1",
                depositAccountRef: "deposit-1",
              },
            },
            error: null,
          };
        }
        if (name === "claim_integration_refund_delivery") {
          return {
            data: {
              delta_amount_cents: 4_863,
              lease_token: null,
              outcome: "blocked",
              prior_cumulative_amount_cents: 0,
              provider_request_key: "quickbooks:refund:shipment:4863",
              reclaimed: false,
              retry_after: "2099-01-01T00:00:00.000Z",
              target_cumulative_amount_cents: 4_863,
            },
            error: null,
          };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
      onTable: (table) => {
        if (table === "shipments") {
          return {
            data: {
              charge_amount_cents: 10_000,
              id: "30000000-0000-4000-8000-000000000003",
              loyalty_discount_cents: 1_000,
              paid_at: "2026-07-26T12:00:00.000Z",
              refund_amount_cents: 9_725,
              status: "refunded",
              tax_amount_cents: 725,
              tier_id: null,
              updated_at: "2026-07-26T13:00:00.000Z",
            },
            error: null,
          };
        }
        if (table === "quickbooks_account_mappings") {
          return {
            data: [
              {
                mapping_kind: "membership",
                quickbooks_account_id: "deposit-1",
                quickbooks_item_id: "item-1",
              },
            ],
            error: null,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      executeIntegrationJob(
        {
          ...encryptionEnv,
          APP_ORIGIN: "https://vinifera.test",
          QUICKBOOKS_CLIENT_ID: "quickbooks-client",
          QUICKBOOKS_CLIENT_SECRET: "quickbooks-secret",
          QUICKBOOKS_ENVIRONMENT: "sandbox",
          QUICKBOOKS_REDIRECT_URI:
            "https://vinifera.test/api/integrations/quickbooks/callback",
        },
        admin as never,
        {
          attempt_count: 1,
          brand_id: "50000000-0000-4000-8000-000000000005",
          connection_id: integrationId,
          cursor_data: {},
          entity_id: "30000000-0000-4000-8000-000000000003",
          idempotency_key: "quickbooks-concurrent-refund-9725",
          integration_type: "quickbooks",
          job_id: "60000000-0000-4000-8000-000000000006",
          lease_token: "job-lease-token",
          max_attempts: 8,
          organization_id: organizationId,
          payload: {
            change_type: "refund",
            refund_amount_cents: 9_725,
          },
          sync_type: "quickbooks.transaction.upsert",
        },
      ),
    ).resolves.toMatchObject({ outcome: "retry", processed: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("creates a Saved Avalara quote, persists it fail-closed, then commits", async () => {
    const methods: string[] = [];
    const fetcher = vi.fn(async (request: Request) => {
      methods.push(`${request.method} ${request.url}`);
      if (request.url.includes("/transactions/create")) {
        const body = JSON.parse(await request.text());
        expect(body.commit).toBe(false);
        expect(body.lines[0].taxCode).toBe("P0000000");
        return new Response(
          JSON.stringify({
            code: "shipment-1",
            currencyCode: "USD",
            id: 42,
            status: "Saved",
            summary: [
              {
                jurisdictionName: "California",
                jurisdictionType: "State",
                rate: 0.0725,
                tax: 7.25,
                taxable: 100,
              },
            ],
            totalAmount: 100,
            totalTax: 7.25,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: "Committed" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    const client = new AvalaraClient(
      {
        accountId: "account",
        baseUrl: "https://sandbox-rest.avatax.com",
        companyCode: "VINIFERA",
        licenseKey: "license",
      },
      { fetcher },
    );
    let persisted = false;
    const taxStartedAt = performance.now();
    const quote = await resolveTaxFailClosed({
      calculate: () =>
        client.createTaxQuote({
          currencyCode: "USD",
          customerCode: "member-1",
          destination: address,
          lines: [
            {
              amountCents: 10_000,
              description: "Wine",
              itemCode: "wine-1",
              kind: "wine",
              quantity: 1,
              taxCode: "P0000000",
            },
          ],
          origin: address,
          transactionCode: "shipment-1",
          transactionDate: "2026-07-26",
        }),
      connected: true,
      optedIn: true,
      persistAudit: async () => {
        persisted = true;
      },
    });
    const taxElapsedMs = performance.now() - taxStartedAt;
    expect(taxElapsedMs).toBeLessThan(500);
    console.info(
      `[phase5-integration-performance] avalara_request=${taxElapsedMs.toFixed(2)}ms`,
    );
    expect(quote?.status).toBe("Saved");
    expect(persisted).toBe(true);
    await client.commitTransaction("shipment-1");
    expect(methods[1]).toContain("/commit");
  });

  it("creates a committed Avalara return transaction for a partial refund", async () => {
    let refundBody: Record<string, unknown> = {};
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe(
        "https://sandbox-rest.avatax.com/api/v2/companies/VINIFERA/transactions/shipment-1/refund",
      );
      refundBody = JSON.parse(await request.text());
      return new Response(
        JSON.stringify({
          code: "VINR-shipment-1-5363",
          status: "Committed",
          summary: [
            {
              jurisdictionName: "California",
              jurisdictionType: "State",
              rate: 0.0725,
              tax: -3.63,
              taxable: -50,
            },
          ],
          totalAmount: -53.63,
          totalTax: -3.63,
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });
    const client = new AvalaraClient(
      {
        accountId: "account",
        baseUrl: "https://sandbox-rest.avatax.com",
        companyCode: "VINIFERA",
        licenseKey: "license",
      },
      { fetcher },
    );
    await expect(
      client.refundTransaction("shipment-1", {
        refundDate: "2026-07-26",
        refundPercentage: 50,
        refundTransactionCode: "VINR-shipment-1-5363",
        refundType: "Percentage",
        referenceCode: "Vinifera shipment shipment-1",
      }),
    ).resolves.toMatchObject({
      code: "VINR-shipment-1-5363",
      status: "Committed",
      taxCents: 363,
      totalCents: 5_363,
    });
    expect(refundBody).toEqual({
      refundDate: "2026-07-26",
      refundPercentage: 50,
      refundTransactionCode: "VINR-shipment-1-5363",
      refundType: "Percentage",
      referenceCode: "Vinifera shipment shipment-1",
    });
  });

  it("replaces the Avalara filing snapshot from a read-only worker check", async () => {
    const envelope = await encryptIntegrationCredentials(
      encryptionEnv,
      {
        integrationType: "avalara",
        organizationId,
        targetId: integrationId,
      },
      {
        accountId: "avalara-account",
        baseUrl: "https://sandbox-rest.avatax.com",
        companyCode: "VINIFERA",
        licenseKey: "avalara-license",
      },
    );
    const persisted: Array<Record<string, unknown>> = [];
    const admin = integrationAdminMock({
      onRpc: async (name, parameters) => {
        if (name === "get_integration_runtime") {
          return {
            data: {
              algorithm: envelope.algorithm,
              connection_id: integrationId,
              credential_ciphertext: envelope.ciphertext,
              credential_iv: envelope.iv,
              envelope_version: envelope.version,
              integration_type: "avalara",
              key_version: envelope.keyVersion,
              organization_id: organizationId,
              storage_mode: "encrypted_envelope",
              sync_config: { filingEnabled: true },
            },
            error: null,
          };
        }
        if (name === "replace_avalara_filing_registration_snapshot") {
          persisted.push(parameters);
          return { data: { currentCount: 1, staleCount: 0 }, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
      onTable: (table) => {
        throw new Error(`Unexpected table ${table}`);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        expect(request.method).toBe("GET");
        return new Response(
          JSON.stringify({
            value: [
              {
                active: true,
                filingFrequencyCode: "Monthly",
                id: 17,
                region: "CA",
                status: "Active",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }),
    );

    await expect(
      executeIntegrationJob(encryptionEnv, admin as never, {
        attempt_count: 1,
        brand_id: "50000000-0000-4000-8000-000000000005",
        connection_id: integrationId,
        cursor_data: {},
        entity_id: "50000000-0000-4000-8000-000000000005",
        idempotency_key: "filing:daily:2026-07-26",
        integration_type: "avalara",
        job_id: "60000000-0000-4000-8000-000000000006",
        lease_token: "lease-token",
        max_attempts: 8,
        organization_id: organizationId,
        payload: {},
        sync_type: "filing.verify",
      }),
    ).resolves.toMatchObject({ outcome: "synced", processed: 1 });
    expect(persisted).toEqual([
      expect.objectContaining({
        p_connection_id: integrationId,
        p_registrations: [
          {
            filing_calendar_id: 17,
            filing_frequency: "Monthly",
            region_code: "CA",
            registration_status: "active",
          },
        ],
        p_snapshot_id: "60000000-0000-4000-8000-000000000006",
      }),
    ]);
  });

  it("executes Avalara refund work through committed ReturnInvoice ledger persistence", async () => {
    const envelope = await encryptIntegrationCredentials(
      encryptionEnv,
      {
        integrationType: "avalara",
        organizationId,
        targetId: integrationId,
      },
      {
        accountId: "avalara-account",
        baseUrl: "https://sandbox-rest.avatax.com",
        companyCode: "VINIFERA",
        licenseKey: "avalara-license",
      },
    );
    const recorded: Array<Record<string, unknown>> = [];
    const admin = integrationAdminMock({
      onRpc: async (name, parameters) => {
        if (name === "get_integration_runtime") {
          return {
            data: {
              algorithm: envelope.algorithm,
              connection_id: integrationId,
              credential_ciphertext: envelope.ciphertext,
              credential_iv: envelope.iv,
              envelope_version: envelope.version,
              integration_type: "avalara",
              key_version: envelope.keyVersion,
              organization_id: organizationId,
              storage_mode: "encrypted_envelope",
              sync_config: {},
            },
            error: null,
          };
        }
        if (name === "claim_integration_refund_delivery") {
          return {
            data: {
              delta_amount_cents: 5_363,
              lease_token: "avalara-refund-delivery-lease",
              outcome: "claimed",
              prior_cumulative_amount_cents: 0,
              provider_request_key: "avalara:refund:shipment:5363",
              reclaimed: false,
              retry_after: "2026-07-26T13:02:00.000Z",
              target_cumulative_amount_cents: 5_363,
            },
            error: null,
          };
        }
        if (name === "complete_avalara_refund_delivery") {
          recorded.push(parameters);
          return {
            data: 5_363,
            error: null,
          };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
      onTable: (table, filters, single) => {
        if (table === "shipments" && single) {
          return {
            data: {
              charge_amount_cents: 12_000,
              id: "30000000-0000-4000-8000-000000000003",
              loyalty_discount_cents: 2_000,
              refund_amount_cents: 5_363,
              refunded_at: null,
              tax_amount_cents: 725,
              updated_at: "2026-07-26T13:00:00.000Z",
            },
            error: null,
          };
        }
        if (
          table === "avalara_tax_calculations" &&
          filters.document_type === "SalesInvoice" &&
          single
        ) {
          return {
            data: {
              currency_code: "USD",
              provider_transaction_code: "shipment-transaction-1",
            },
            error: null,
          };
        }
        throw new Error(
          `Unexpected table ${table} with ${JSON.stringify(filters)}`,
        );
      },
    });
    let refundBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        expect(request.url).toContain(
          "/transactions/shipment-transaction-1/refund",
        );
        refundBody = JSON.parse(await request.text());
        return new Response(
          JSON.stringify({
            code: "VINR-300000000000400080000000-5363",
            status: "Committed",
            summary: [
              {
                jurisdictionName: "California",
                jurisdictionType: "State",
                rate: 0.0725,
                tax: -3.63,
                taxable: -50,
              },
            ],
            totalAmount: -53.63,
            totalTax: -3.63,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }),
    );

    await expect(
      executeIntegrationJob(
        encryptionEnv,
        admin as never,
        {
          attempt_count: 1,
          brand_id: "50000000-0000-4000-8000-000000000005",
          connection_id: integrationId,
          cursor_data: {},
          entity_id: "30000000-0000-4000-8000-000000000003",
          idempotency_key: "avalara-partial-refund",
          integration_type: "avalara",
          job_id: "60000000-0000-4000-8000-000000000006",
          lease_token: "lease-token",
          max_attempts: 8,
          organization_id: organizationId,
          payload: {
            refund_amount_cents: 5_363,
            shipment_id: "30000000-0000-4000-8000-000000000003",
          },
          sync_type: "avalara.tax.refund",
        },
      ),
    ).resolves.toMatchObject({ outcome: "synced", processed: 1 });
    expect(refundBody).toMatchObject({
      refundTransactionCode: "VINR-300000000000400080000000-5363",
      refundType: "Percentage",
    });
    expect(recorded).toEqual([
      expect.objectContaining({
        p_lease_token: "avalara-refund-delivery-lease",
        p_shipment_id: "30000000-0000-4000-8000-000000000003",
        p_tax_amount_cents: 363,
        p_taxable_basis_cents: 5_000,
      }),
    ]);
  });

  it("reconciles a reclaimed Avalara refund by immutable transaction code before issuing another POST", async () => {
    const envelope = await encryptIntegrationCredentials(
      encryptionEnv,
      {
        integrationType: "avalara",
        organizationId,
        targetId: integrationId,
      },
      {
        accountId: "avalara-account",
        baseUrl: "https://sandbox-rest.avatax.com",
        companyCode: "VINIFERA",
        licenseKey: "avalara-license",
      },
    );
    const completions: Array<Record<string, unknown>> = [];
    const admin = integrationAdminMock({
      onRpc: async (name, parameters) => {
        if (name === "get_integration_runtime") {
          return {
            data: {
              algorithm: envelope.algorithm,
              connection_id: integrationId,
              credential_ciphertext: envelope.ciphertext,
              credential_iv: envelope.iv,
              envelope_version: envelope.version,
              integration_type: "avalara",
              key_version: envelope.keyVersion,
              organization_id: organizationId,
              storage_mode: "encrypted_envelope",
              sync_config: {},
            },
            error: null,
          };
        }
        if (name === "claim_integration_refund_delivery") {
          return {
            data: {
              delta_amount_cents: 5_363,
              lease_token: "reclaimed-avalara-lease",
              outcome: "claimed",
              prior_cumulative_amount_cents: 0,
              provider_request_key: "avalara:refund:shipment:5363",
              reclaimed: true,
              retry_after: "2026-07-26T13:02:00.000Z",
              target_cumulative_amount_cents: 5_363,
            },
            error: null,
          };
        }
        if (name === "complete_avalara_refund_delivery") {
          completions.push(parameters);
          return { data: 5_363, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
      onTable: (table, filters, single) => {
        if (table === "shipments" && single) {
          return {
            data: {
              charge_amount_cents: 12_000,
              id: "30000000-0000-4000-8000-000000000003",
              loyalty_discount_cents: 2_000,
              refund_amount_cents: 5_363,
              refunded_at: null,
              tax_amount_cents: 725,
              updated_at: "2026-07-26T13:00:00.000Z",
            },
            error: null,
          };
        }
        if (
          table === "avalara_tax_calculations" &&
          filters.document_type === "SalesInvoice" &&
          single
        ) {
          return {
            data: {
              currency_code: "USD",
              provider_transaction_code: "shipment-transaction-1",
            },
            error: null,
          };
        }
        throw new Error(
          `Unexpected table ${table} with ${JSON.stringify(filters)}`,
        );
      },
    });
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        methods.push(request.method);
        expect(request.url).toContain(
          "/transactions/VINR-300000000000400080000000-5363",
        );
        return new Response(
          JSON.stringify({
            code: "VINR-300000000000400080000000-5363",
            status: "Committed",
            summary: [
              {
                jurisdictionName: "California",
                jurisdictionType: "State",
                rate: 0.0725,
                tax: -3.63,
                taxable: -50,
              },
            ],
            totalAmount: -53.63,
            totalTax: -3.63,
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }),
    );

    await expect(
      executeIntegrationJob(
        encryptionEnv,
        admin as never,
        {
          attempt_count: 2,
          brand_id: "50000000-0000-4000-8000-000000000005",
          connection_id: integrationId,
          cursor_data: {},
          entity_id: "30000000-0000-4000-8000-000000000003",
          idempotency_key: "avalara-refund-recovery",
          integration_type: "avalara",
          job_id: "60000000-0000-4000-8000-000000000006",
          lease_token: "job-lease-token",
          max_attempts: 8,
          organization_id: organizationId,
          payload: {
            refund_amount_cents: 5_363,
            shipment_id: "30000000-0000-4000-8000-000000000003",
          },
          sync_type: "avalara.tax.refund",
        },
      ),
    ).resolves.toMatchObject({ outcome: "synced", processed: 1 });
    expect(methods).toEqual(["GET"]);
    expect(completions).toEqual([
      expect.objectContaining({
        p_document_code: "VINR-300000000000400080000000-5363",
        p_lease_token: "reclaimed-avalara-lease",
        p_taxable_basis_cents: 5_000,
      }),
    ]);
  });

  it("hashes all Meta PII before a Request is serialized", async () => {
    let serialized = "";
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).not.toContain("server-access-token");
      expect(request.headers.get("authorization")).toBe(
        "Bearer server-access-token",
      );
      serialized = await request.text();
      return new Response(
        JSON.stringify({ events_received: 1, fbtrace_id: "trace-1" }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });
    const client = new MetaConversionsClient(
      {
        accessToken: "server-access-token",
        apiVersion: "v25.0",
        pixelId: "pixel-1",
        testEventCode: "TEST12345",
      },
      { fetcher },
    );
    const metaStartedAt = performance.now();
    await client.sendConversion({
      browserData: {
        fbc: "fb.1.1721995200000.click_abc-123",
        fbp: "fb.1.1721995200000.browser_abc-123",
      },
      consented: true,
      customData: {
        campaign_id: "summer-club",
        value: 125,
      },
      eventId: "shipment:1001:purchase",
      eventName: "Purchase",
      eventSourceUrl:
        "https://club.example.test/join?utm_campaign=summer-club",
      eventTime: "2026-07-26T12:00:00.000Z",
      userData: {
        email: " Member@Example.Test ",
        firstName: "Avery",
        phone: "+1 (707) 555-0100",
      },
    });
    const metaElapsedMs = performance.now() - metaStartedAt;
    expect(metaElapsedMs).toBeLessThan(5_000);
    console.info(
      `[phase5-integration-performance] meta_request=${metaElapsedMs.toFixed(2)}ms`,
    );
    expect(serialized).not.toContain("Member@Example.Test");
    expect(serialized).not.toContain("Avery");
    expect(serialized).not.toContain("707");
    const body = JSON.parse(serialized);
    expect(body.data[0].user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data[0].user_data.fbc).toBe(
      "fb.1.1721995200000.click_abc-123",
    );
    expect(body.data[0].user_data.fbp).toBe(
      "fb.1.1721995200000.browser_abc-123",
    );
    expect(body.data[0].event_source_url).toBe(
      "https://club.example.test/join?utm_campaign=summer-club",
    );
    expect(body.data[0].custom_data).toMatchObject({
      campaign_id: "summer-club",
      value: 125,
    });
    expect(body.test_event_code).toBe("TEST12345");
    await expect(
      client.sendConversion({
        consented: false,
        eventId: "shipment:1002:purchase",
        eventName: "Purchase",
        eventTime: "2026-07-26T12:00:00.000Z",
        userData: { email: "blocked@example.test" },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      client.sendConversion({
        browserData: { fbc: "raw-click-id" },
        consented: true,
        eventId: "shipment:1003:purchase",
        eventName: "Purchase",
        eventTime: "2026-07-26T12:00:00.000Z",
        userData: { email: "blocked@example.test" },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps Meta attribution first-party, minimal, and campaign-safe", () => {
    const now = Date.parse("2026-07-26T12:00:00.000Z");
    const attribution = normalizeMetaAttribution(
      {
        campaignId: null,
        campaignName: null,
        eventSourceUrl:
          "https://club.example.test/join?fbclid=discard&utm_id=launch-1&utm_campaign=Summer%20Club&utm_source=meta&utm_medium=paid#discard",
        fbc: "fb.1.1721995200000.click_abc-123",
        fbp: "fb.1.1721995200000.browser_abc-123",
        occurredAt: "2026-07-26T11:59:00.000Z",
      },
      ["club.example.test"],
      now,
    );
    expect(attribution).toMatchObject({
      campaignId: "launch-1",
      campaignName: "Summer Club",
      eventSourceUrl:
        "https://club.example.test/join?utm_id=launch-1&utm_campaign=Summer+Club&utm_source=meta&utm_medium=paid",
      medium: "paid",
      source: "meta",
    });
    expect(attribution.eventSourceUrl).not.toContain("fbclid");
    expect(
      metaAttributionCustomData(
        { currency: "USD", value: 125 },
        {
          campaign_id: attribution.campaignId,
          campaign_name: attribution.campaignName,
          medium: attribution.medium,
          source: attribution.source,
        },
      ),
    ).toEqual({
      campaign_id: "launch-1",
      campaign_name: "Summer Club",
      currency: "USD",
      utm_medium: "paid",
      utm_source: "meta",
      value: 125,
    });
    expect(normalizeMetaBrowserData(null)).toEqual({
      fbc: undefined,
      fbp: undefined,
    });
    expect(() =>
      normalizeMetaAttribution(
        {
          eventSourceUrl: "https://attacker.example/join",
          occurredAt: "2026-07-26T11:59:00.000Z",
        },
        ["club.example.test"],
        now,
      ),
    ).toThrowError(/first-party HTTPS page/);
  });

  it("normalizes Meta birthdays to YYYYMMDD and emits the db hash field", async () => {
    expect(normalizeMetaIdentifier("date_of_birth", " 1980-01-02 ")).toBe(
      "19800102",
    );
    const hashes = await buildHashedMetaUserData({
      dateOfBirth: "1980-01-02",
    });
    expect(hashes.db).toHaveLength(1);
    expect(hashes.db?.[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses a least-privilege Cloudflare bearer token and TXT validation", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.headers.get("authorization")).toBe(
        "Bearer custom-hostname-only-token",
      );
      expect(request.headers.has("x-auth-key")).toBe(false);
      return new Response(
        JSON.stringify({
          result: {
            hostname: "club.example.test",
            id: "hostname-id",
            ownership_verification: {
              name: "_cf-custom-hostname.club.example.test",
              type: "txt",
              value: "challenge",
            },
            ssl: { status: "pending_validation" },
            status: "pending",
          },
          success: true,
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });
    const client = new CloudflareCustomHostnameClient(
      {
        appEnvironment: "test",
        apiToken: "custom-hostname-only-token",
        fallbackOrigin: "origin.vinifera.test",
        targetPolicy: {
          ...providerTargetPolicy,
          cloudflareCustomHostnames: {
            ...providerTargetPolicy.cloudflareCustomHostnames,
            staging: {
              fallbackOriginSha256: [
                sha256ProviderTarget("origin.vinifera.test"),
              ],
              zoneIdSha256: [sha256ProviderTarget("a".repeat(32))],
            },
          },
        },
        zoneId: "a".repeat(32),
      },
      { fetcher },
    );
    const result = await client.createHostname(
      "club.example.test",
      "30000000-0000-4000-8000-000000000003",
    );
    expect(result.ownershipVerification?.type).toBe("txt");
  });

  it("does not retry or reconcile an ambiguous custom-hostname delete inline", async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (request: Request) => {
      requests.push(request.method);
      throw new TypeError("response lost after remote commit");
    });
    const client = new CloudflareCustomHostnameClient(
      {
        appEnvironment: "test",
        apiToken: "custom-hostname-only-token",
        fallbackOrigin: "origin.vinifera.test",
        targetPolicy: {
          ...providerTargetPolicy,
          cloudflareCustomHostnames: {
            ...providerTargetPolicy.cloudflareCustomHostnames,
            staging: {
              fallbackOriginSha256: [
                sha256ProviderTarget("origin.vinifera.test"),
              ],
              zoneIdSha256: [sha256ProviderTarget("a".repeat(32))],
            },
          },
        },
        zoneId: "a".repeat(32),
      },
      { fetcher },
    );

    await expect(client.deleteHostname("hostname-id")).rejects.toThrow(
      /provider could not be reached/,
    );
    expect(requests).toEqual(["DELETE"]);
  });
});

describe("Phase 5 job, theme, and native delivery controls", () => {
  it("routes every database-enqueued integration alias and rejects unknown work", () => {
    expect(integrationJobKind("klaviyo", "klaviyo.profiles.bootstrap")).toBe(
      "klaviyo_profiles",
    );
    expect(integrationJobKind("klaviyo", "klaviyo.profile.upsert")).toBe(
      "klaviyo_profiles",
    );
    expect(integrationJobKind("klaviyo", "engagement.poll")).toBe(
      "klaviyo_engagement",
    );
    expect(
      integrationJobKind("quickbooks", "quickbooks.transactions.bootstrap"),
    ).toBe("quickbooks_transactions");
    expect(
      integrationJobKind("quickbooks", "quickbooks.transaction.upsert"),
    ).toBe("quickbooks_transactions");
    expect(integrationJobKind("quickbooks", "reconciliation.monthly")).toBe(
      "quickbooks_reconciliation",
    );
    expect(integrationJobKind("avalara", "avalara.tax.bootstrap")).toBe(
      "avalara_calculate",
    );
    expect(integrationJobKind("avalara", "avalara.tax.calculate")).toBe(
      "avalara_calculate",
    );
    expect(integrationJobKind("avalara", "avalara.tax.refund")).toBe(
      "avalara_refund",
    );
    expect(integrationJobKind("avalara", "tax.reconcile")).toBe(
      "avalara_reconcile",
    );
    expect(integrationJobKind("avalara", "filing.verify")).toBe(
      "avalara_filing_verify",
    );
    for (const suffix of ["lead", "purchase", "referral", "tier_upgrade"]) {
      expect(integrationJobKind("meta", `meta.event.${suffix}`)).toBe(
        "meta_event",
      );
    }
    expect(() => integrationJobKind("klaviyo", "unknown.success")).toThrow(
      IntegrationProviderError,
    );
    expect(() => integrationJobKind("avalara", "conversions.pending")).toThrow(
      IntegrationProviderError,
    );
  });

  it("uses the tax-inclusive, loyalty-net shipment amount across accounting and Meta", () => {
    const shipment = {
      charge_amount_cents: 12_000,
      loyalty_discount_cents: 2_000,
      refund_amount_cents: 5_363,
      tax_amount_cents: 725,
    };
    expect(quickBooksShipmentFinancials(shipment, false)).toEqual({
      subtotalCents: 10_000,
      taxCents: 725,
      totalCents: 10_725,
    });
    const refund = quickBooksShipmentFinancials(shipment, true);
    expect(refund).toEqual({
      subtotalCents: 5_000,
      taxCents: 363,
      totalCents: 5_363,
    });
    expect(refund.subtotalCents + refund.taxCents).toBe(refund.totalCents);
    const finalRefundDelta = quickBooksRefundDeltaFinancials(
      shipment,
      5_363,
      10_725,
    );
    expect(finalRefundDelta).toEqual({
      subtotalCents: 5_000,
      taxCents: 362,
      totalCents: 5_362,
    });
    expect(
      refund.taxCents + finalRefundDelta.taxCents,
    ).toBe(shipment.tax_amount_cents);
    expect(metaPurchaseValue(shipment)).toBe(107.25);
  });

  it("allows charges only for active or grace brand billing access", () => {
    expect(
      brandAllowsOperationalAccess({
        active: true,
        access_status: "suspended",
        billing_mode: "independent",
        organization_access_status: "active",
      }),
    ).toBe(false);
    expect(
      brandAllowsOperationalAccess({
        active: true,
        access_status: "restricted",
        billing_mode: "independent",
        organization_access_status: "active",
      }),
    ).toBe(false);
    expect(
      brandAllowsOperationalAccess({
        active: true,
        access_status: "onboarding",
        billing_mode: "independent",
        organization_access_status: "active",
      }),
    ).toBe(false);
    expect(
      brandAllowsOperationalAccess({
        active: true,
        access_status: "active",
        billing_mode: "shared",
        organization_access_status: "suspended",
      }),
    ).toBe(false);
    expect(
      brandAllowsOperationalAccess({
        active: true,
        access_status: "active",
        billing_mode: "shared",
        organization_access_status: "restricted",
      }),
    ).toBe(false);
    expect(
      brandAllowsOperationalAccess({
        active: true,
        access_status: "active",
        billing_mode: "independent",
        organization_access_status: "suspended",
      }),
    ).toBe(true);
    expect(
      brandAllowsOperationalAccess({
        active: true,
        access_status: "grace",
        billing_mode: "independent",
        organization_access_status: "suspended",
      }),
    ).toBe(true);
    expect(
      brandAllowsOperationalAccess({
        active: true,
        access_status: "suspended",
        billing_mode: "shared",
        organization_access_status: "grace",
      }),
    ).toBe(true);
    expect(
      brandAllowsOperationalAccess({
        active: false,
        access_status: "active",
        billing_mode: "independent",
        organization_access_status: "active",
      }),
    ).toBe(false);
  });

  it("normalizes mobile club codes and rejects a globally ambiguous slug", () => {
    expect(normalizeMobileClubCode("  Estate-Reserve ")).toBe(
      "estate-reserve",
    );
    expect(normalizeMobileClubCode("   ")).toBeNull();
    expect(() => normalizeMobileClubCode("estate reserve")).toThrow(
      /club code is invalid/i,
    );
    expect(() =>
      uniqueMobileClubBrandId([
        { id: "brand-one" },
        { id: "brand-two" },
      ]),
    ).toThrow(/ambiguous/i);
    expect(uniqueMobileClubBrandId([{ id: "brand-one" }])).toBe("brand-one");
  });

  it("moves retryable failures to retry then DLQ at the attempt ceiling", () => {
    const error = new IntegrationProviderError(
      "provider_unavailable",
      503,
      true,
      5_000,
    );
    expect(
      failedIntegrationJob({
        asOf: new Date("2026-07-26T00:00:00.000Z"),
        attempt: 2,
        error,
        maxAttempts: 3,
      }),
    ).toMatchObject({
      errorCode: "provider_unavailable",
      nextAttemptAt: "2026-07-26T00:00:05.000Z",
      outcome: "retry",
    });
    expect(
      failedIntegrationJob({ attempt: 3, error, maxAttempts: 3 }),
    ).toMatchObject({ nextAttemptAt: null, outcome: "dead_letter" });
    expect(successfulIntegrationJob({ processed: 1_000 })).toMatchObject({
      failed: 0,
      outcome: "synced",
      processed: 1_000,
    });
  });

  it("accepts the canonical theme using independently derived foregrounds", () => {
    expect(
      validatedTheme({
        primaryColor: "#6b1e30",
        secondaryColor: "#c9993a",
      }),
    ).toMatchObject({
      contrast: {
        normalTextPasses: true,
        primaryForeground: "#FFFFFF",
        primaryOnSecondaryPasses: false,
        secondaryForeground: "#1A0009",
      },
    });
    expect(evaluateThemeColor("#6b1e30").ratio).toBeGreaterThanOrEqual(4.5);
    expect(evaluateThemeColor("#c9993a").ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#6F263D", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBe(1);
  });

  it("rejects theme surfaces that cannot support AA text contrast", () => {
    expect(() =>
      validatedTheme({
        primaryColor: "#777777",
        secondaryColor: "#c9993a",
      }),
    ).toThrow(/WCAG 2.1 AA/);
  });

  it("rejects logo URLs with embedded credentials or custom ports", () => {
    expect(() =>
      validatedTheme({
        logoUrl: "https://user:secret@cdn.example.test/logo.svg",
      }),
    ).toThrow(/without credentials or a custom port/);
    expect(() =>
      validatedTheme({
        logoUrl: "https://cdn.example.test:8443/logo.svg",
      }),
    ).toThrow(/without credentials or a custom port/);
  });

  it("fails closed on placeholder-free universal-link identities", () => {
    expect(() => appleAppSiteAssociation({})).toThrow(
      /MOBILE_APPLE_TEAM_ID/,
    );
    expect(() => androidAssetLinks({})).toThrow(
      /MOBILE_ANDROID_PACKAGE_NAME/,
    );
    expect(
      appleAppSiteAssociation({
        MOBILE_APPLE_TEAM_ID: "TEAM123456",
        MOBILE_IOS_BUNDLE_ID: "ai.edstratumlabs.vinifera",
      }),
    ).toMatchObject({
      applinks: {
        details: [
          {
            appIDs: ["TEAM123456.ai.edstratumlabs.vinifera"],
            components: [
              { "/": "/portal" },
              { "/": "/portal/auth" },
              { "/": "/app/fulfillment" },
            ],
          },
        ],
      },
    });
  });

  it("keeps the mobile push queue dormant until both providers are configured", async () => {
    await expect(
      runMobilePushSchedule({
        SUPABASE_SECRET_KEY: "service-role-placeholder",
        SUPABASE_URL: "https://project.supabase.co",
      }),
    ).resolves.toEqual({
      activationRequired: true,
      failed: 0,
      sent: 0,
    });
  });
});
