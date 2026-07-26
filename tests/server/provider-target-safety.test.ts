import { describe, expect, it, vi } from "vitest";
import {
  CloudflareCustomHostnameClient,
  type CustomHostnameResult,
} from "../../server/integrations/cloudflare-domains";
import {
  executeRetrySafeCustomHostnameWrite,
  type CustomHostnameWriteClaim,
  type CustomHostnameWriteStore,
} from "../../server/integrations/custom-hostname-writes";
import {
  assertCloudflareCustomHostnameTarget,
  assertEasyPostTarget,
  assertFcmProjectTarget,
  assertShipCompliantTarget,
  type ProviderTargetPolicy,
  providerTargetPolicy,
  sha256ProviderTarget,
} from "../../server/provider-targets";
import { EasyPostShippingProvider } from "../../server/services/core-club";
import { ShipCompliantProvider } from "../../server/services/compliance";

const zoneId = "a".repeat(32);
const fallbackOrigin = "origin.staging.example.test";
const fcmProjectId = "vinifera-staging-123";
const shipCompliantOrigin = "https://sandbox.shipcompliant.example";
const brandId = "10000000-0000-4000-8000-000000000001";
const organizationId = "20000000-0000-4000-8000-000000000002";
const attemptId = "30000000-0000-4000-8000-000000000003";
const leaseOne = "40000000-0000-4000-8000-000000000004";
const leaseTwo = "50000000-0000-4000-8000-000000000005";

function targetPolicy(
  overrides: Partial<ProviderTargetPolicy> = {},
): ProviderTargetPolicy {
  return {
    schemaVersion: 1,
    cloudflareCustomHostnames: {
      production: {
        fallbackOriginSha256: [],
        zoneIdSha256: [],
      },
      staging: {
        fallbackOriginSha256: [sha256ProviderTarget(fallbackOrigin)],
        zoneIdSha256: [sha256ProviderTarget(zoneId)],
      },
    },
    fcm: {
      productionProjectIdSha256: [],
      stagingProjectIdSha256: [sha256ProviderTarget(fcmProjectId)],
    },
    shipCompliant: {
      productionModeEnabled: false,
      productionOriginSha256: [],
      productionSandboxOriginSha256: [],
      stagingSandboxOriginSha256: [
        sha256ProviderTarget(shipCompliantOrigin),
      ],
    },
    ...overrides,
  };
}

const hostnameResult = {
  externalId: "hostname_123",
  hostname: "club.example.test",
  ownershipVerification: {
    name: "_cf-custom-hostname.club.example.test",
    type: "txt" as const,
    value: "challenge",
  },
  sslStatus: "pending_validation",
  status: "pending",
};

describe("provider target authorization", () => {
  it("ships every provider target hash allowlist empty and fail-closed", () => {
    expect(providerTargetPolicy.cloudflareCustomHostnames.staging).toEqual({
      fallbackOriginSha256: [],
      zoneIdSha256: [],
    });
    expect(providerTargetPolicy.fcm.stagingProjectIdSha256).toEqual([]);
    expect(
      providerTargetPolicy.shipCompliant.stagingSandboxOriginSha256,
    ).toEqual([]);
    expect(() =>
      assertCloudflareCustomHostnameTarget({
        appEnvironment: "staging",
        fallbackOrigin,
        zoneId,
      }),
    ).toThrow(/reviewed policy/);
  });

  it("permits only EasyPost test keys outside production and independently authorizes live labels", () => {
    expect(
      assertEasyPostTarget({
        apiKey: "EZTKstagingcredential",
        appEnvironment: "staging",
      }),
    ).toBe("test");
    expect(() =>
      assertEasyPostTarget({
        apiKey: "EZAKproductioncredential",
        appEnvironment: "staging",
        liveLabelsEnabled: "true",
      }),
    ).toThrow(/Non-production/);
    expect(() =>
      new EasyPostShippingProvider(
        "EZAKproductioncredential",
        fetch,
        {
          appEnvironment: "production",
          liveLabelsEnabled: "false",
        },
      ),
    ).toThrow(/independent production authority/);
    expect(
      new EasyPostShippingProvider(
        "EZAKproductioncredential",
        fetch,
        {
          appEnvironment: "production",
          liveLabelsEnabled: "true",
        },
      ),
    ).toBeInstanceOf(EasyPostShippingProvider);
  });

  it("requires exact Cloudflare zone and fallback-origin hashes together", () => {
    expect(
      assertCloudflareCustomHostnameTarget(
        {
          appEnvironment: "staging",
          fallbackOrigin,
          zoneId,
        },
        targetPolicy(),
      ),
    ).toEqual({
      fallbackOriginSha256: sha256ProviderTarget(fallbackOrigin),
      zoneIdSha256: sha256ProviderTarget(zoneId),
    });
    expect(() =>
      assertCloudflareCustomHostnameTarget(
        {
          appEnvironment: "staging",
          fallbackOrigin,
          zoneId: "b".repeat(32),
        },
        targetPolicy(),
      ),
    ).toThrow(/Cloudflare zone.*reviewed policy/);
  });

  it("authorizes a reviewed non-production FCM project hash", () => {
    expect(
      assertFcmProjectTarget(
        { APP_ENV: "staging", FCM_PROJECT_ID: fcmProjectId },
        targetPolicy(),
      ),
    ).toBe(sha256ProviderTarget(fcmProjectId));
    expect(() =>
      assertFcmProjectTarget(
        { APP_ENV: "staging", FCM_PROJECT_ID: "production-project-123" },
        targetPolicy(),
      ),
    ).toThrow(/Firebase project.*reviewed policy/);
  });

  it("requires ShipCompliant mode and reviewed origin before authentication or PII requests", () => {
    expect(
      assertShipCompliantTarget(
        {
          appEnvironment: "staging",
          baseUrl: shipCompliantOrigin,
          endpointMode: "sandbox",
        },
        targetPolicy(),
      ),
    ).toMatchObject({
      endpointMode: "sandbox",
      originSha256: sha256ProviderTarget(shipCompliantOrigin),
    });
    expect(() =>
      assertShipCompliantTarget(
        {
          appEnvironment: "staging",
          baseUrl: shipCompliantOrigin,
          endpointMode: "production",
        },
        targetPolicy(),
      ),
    ).toThrow(/Non-production ShipCompliant/);

    const fetcher = vi.fn();
    expect(() =>
      new ShipCompliantProvider(
        {
          accountId: "account",
          appEnvironment: "staging",
          apiKey: "key",
          apiSecret: "secret",
          baseUrl: "https://unreviewed.shipcompliant.example",
          checkPath: "/shipment/check",
          contractVersion: "sandbox-v1",
          endpointMode: "sandbox",
          licenseId: "license",
          targetPolicy: targetPolicy(),
          tokenPath: "/oauth/token",
        },
        fetcher,
      ),
    ).toThrow(/reviewed policy/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("retry-safe Cloudflare custom-hostname writes", () => {
  it("never retries the create POST inside the provider adapter", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ambiguous timeout");
    });
    const client = new CloudflareCustomHostnameClient(
      {
        apiToken: "custom-hostname-token",
        appEnvironment: "staging",
        fallbackOrigin,
        targetPolicy: targetPolicy(),
        zoneId,
      },
      { fetcher },
    );
    await expect(
      client.createHostname("club.example.test", brandId),
    ).rejects.toMatchObject({ code: "upstream_error" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("changes an ambiguous create into lookup-only reconciliation on replay", async () => {
    let state: "new" | "lookup" | "completed" = "new";
    const store: CustomHostnameWriteStore = {
      claim: vi.fn(async (): Promise<CustomHostnameWriteClaim> => {
        if (state === "new") {
          return {
            attemptId,
            disposition: "create",
            leaseToken: leaseOne,
            providerHostnameId: null,
          };
        }
        if (state === "lookup") {
          return {
            attemptId,
            disposition: "lookup",
            leaseToken: leaseTwo,
            providerHostnameId: null,
          };
        }
        return {
          attemptId,
          disposition: "completed",
          leaseToken: null,
          providerHostnameId: hostnameResult.externalId,
        };
      }),
      complete: vi.fn(async () => {
        state = "completed";
      }),
      markLookupRequired: vi.fn(async () => {
        state = "lookup";
      }),
      recordProviderResult: vi.fn(async () => undefined),
      releaseLookup: vi.fn(async () => undefined),
    };
    const client = {
      createHostname: vi.fn(async () => {
        throw new Error("ambiguous timeout");
      }),
      findHostname: vi.fn(async () => hostnameResult),
      getHostname: vi.fn(async () => hostnameResult),
    };
    const persist = vi.fn(async () => undefined);
    const execute = () =>
      executeRetrySafeCustomHostnameWrite({
        brandId,
        client,
        hostname: hostnameResult.hostname,
        leaseOwner: "hostname:test",
        organizationId,
        persist,
        store,
      });

    await expect(execute()).rejects.toThrow(/requires provider reconciliation/);
    await expect(execute()).resolves.toEqual(hostnameResult);
    expect(client.createHostname).toHaveBeenCalledOnce();
    expect(client.findHostname).toHaveBeenCalledOnce();
    expect(store.markLookupRequired).toHaveBeenCalledWith(
      attemptId,
      leaseOne,
      "CREATE_RESULT_UNKNOWN",
    );
    expect(store.recordProviderResult).toHaveBeenCalledWith(
      attemptId,
      leaseTwo,
      hostnameResult.externalId,
    );
    expect(persist).toHaveBeenCalledOnce();
  });

  it("reconciles by provider ID after provider success but local persistence failure", async () => {
    let state: "new" | "provider_confirmed" | "completed" = "new";
    const store: CustomHostnameWriteStore = {
      claim: vi.fn(async () =>
        state === "new"
          ? {
              attemptId,
              disposition: "create" as const,
              leaseToken: leaseOne,
              providerHostnameId: null,
            }
          : {
              attemptId,
              disposition: "reconcile" as const,
              leaseToken: leaseTwo,
              providerHostnameId: hostnameResult.externalId,
            }),
      complete: vi.fn(async () => {
        state = "completed";
      }),
      markLookupRequired: vi.fn(async () => undefined),
      recordProviderResult: vi.fn(async () => {
        state = "provider_confirmed";
      }),
      releaseLookup: vi.fn(async () => undefined),
    };
    const client = {
      createHostname: vi.fn(async () => hostnameResult),
      findHostname: vi.fn(async () => null),
      getHostname: vi.fn(async () => hostnameResult),
    };
    const persist = vi
      .fn<(result: CustomHostnameResult) => Promise<void>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce();
    const execute = () =>
      executeRetrySafeCustomHostnameWrite({
        brandId,
        client,
        hostname: hostnameResult.hostname,
        leaseOwner: "hostname:test",
        organizationId,
        persist,
        store,
      });

    await expect(execute()).rejects.toThrow(/database unavailable/);
    await expect(execute()).resolves.toEqual(hostnameResult);
    expect(client.createHostname).toHaveBeenCalledOnce();
    expect(client.getHostname).toHaveBeenCalledOnce();
    expect(store.recordProviderResult).toHaveBeenCalledOnce();
    expect(store.complete).toHaveBeenCalledWith(attemptId, leaseTwo);
  });
});
