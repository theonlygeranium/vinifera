import { describe, expect, it, vi } from "vitest";

import { KlaviyoClient } from "../../server/integrations/klaviyo";
import {
  QuickBooksClient,
  type QuickBooksRefreshLease,
} from "../../server/integrations/quickbooks";
import { IntegrationProviderError } from "../../server/integrations/http";
import {
  buildConfiguredKlaviyoProfile,
  configuredKlaviyoListIds,
  failedClaimedIntegrationJob,
  providerMappingsFromSyncConfig,
  unexplainedKlaviyoMissingProfiles,
} from "../../server/services/integrations";

describe("Phase 5 provider mapping execution", () => {
  it("translates the existing integration UI sync configuration into durable mappings", () => {
    const klaviyo = providerMappingsFromSyncConfig("klaviyo", {
      churnRiskField: "member_churn",
      listId: "Estate_Members",
      memberEmailField: "email",
      memberTierField: "wine_club_tier",
    });
    expect(klaviyo.fieldMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          klaviyo_property: "wine_club_tier",
          vinifera_field: "club_tier_id",
        }),
        expect.objectContaining({
          klaviyo_property: "member_churn",
          vinifera_field: "churn_risk_score",
        }),
        expect.objectContaining({
          klaviyo_property: "member_churn_level",
          vinifera_field: "churn_risk_level",
        }),
      ]),
    );
    expect(klaviyo.listMappings).toEqual([
      expect.objectContaining({ list_id: "Estate_Members" }),
    ]);

    const quickbooks = providerMappingsFromSyncConfig("quickbooks", {
      defaultItemRef: "WineClub-Quarterly",
      depositAccountRef: "Undeposited-Funds",
    });
    expect(quickbooks.accountMappings).toEqual([
      expect.objectContaining({
        mapping_kind: "membership",
        quickbooks_account_id: "Undeposited-Funds",
        quickbooks_item_id: "WineClub-Quarterly",
      }),
      expect.objectContaining({
        mapping_kind: "shipping",
        quickbooks_account_id: "Undeposited-Funds",
        quickbooks_item_id: "WineClub-Quarterly",
      }),
    ]);
  });

  it("builds configured churn properties and status-aware list memberships", () => {
    const row = {
      churn_risk_score: 84.25,
      club_tier_id: "tier-estate",
      email: "member@example.test",
      first_name: "Estate",
      last_name: "Member",
      member_id: "member-1",
      status: "active",
    };
    const profile = buildConfiguredKlaviyoProfile(row, [
      {
        enabled: true,
        klaviyo_property: "first_name",
        vinifera_field: "first_name",
      },
      {
        enabled: true,
        klaviyo_property: "member_churn",
        vinifera_field: "churn_risk_score",
      },
      {
        enabled: true,
        klaviyo_property: "member_churn_level",
        vinifera_field: "churn_risk_level",
      },
    ]);
    expect(profile).toMatchObject({
      email: "member@example.test",
      externalId: "member-1",
      firstName: "Estate",
      properties: {
        member_churn: 84.25,
        member_churn_level: "high",
      },
    });
    expect(
      configuredKlaviyoListIds(row, [
        {
          club_tier_id: null,
          enabled: true,
          list_id: "All_Members",
          membership_status: "active",
        },
        {
          club_tier_id: "tier-estate",
          enabled: true,
          list_id: "Estate_Members",
          membership_status: null,
        },
        {
          club_tier_id: "tier-other",
          enabled: true,
          list_id: "Other_Members",
          membership_status: null,
        },
      ]),
    ).toEqual(["All_Members", "Estate_Members"]);
    expect(
      configuredKlaviyoListIds({ ...row, deleted_at: "2026-07-26" }, [
        {
          club_tier_id: null,
          enabled: true,
          list_id: "All_Members",
          membership_status: null,
        },
      ]),
    ).toEqual([]);
  });

  it("resolves provider profile IDs before applying list membership", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      if (request.method === "GET") {
        expect(new URL(request.url).searchParams.get("filter")).toContain(
          "member-1",
        );
        return new Response(
          JSON.stringify({
            data: [
              {
                attributes: { external_id: "member-1" },
                id: "provider-profile-1",
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      expect(request.method).toBe("POST");
      expect(await request.json()).toEqual({
        data: [{ id: "provider-profile-1", type: "profile" }],
      });
      return new Response(null, { status: 204 });
    });
    const client = new KlaviyoClient(
      { apiKey: "pk_phase5_backend_test" },
      { fetcher, sleep: async () => undefined },
    );
    const resolved = await client.resolveProfileIds(["member-1"]);
    expect(resolved).toEqual({ "member-1": "provider-profile-1" });
    await client.updateListMembership(
      "Estate_Members",
      [resolved["member-1"]!],
      true,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a completed bulk job for provider-reported profile failures", () => {
    expect(
      unexplainedKlaviyoMissingProfiles(
        ["member-accepted", "member-rejected"],
        { "member-accepted": "profile-accepted" },
        1,
      ),
    ).toEqual([]);
    expect(
      unexplainedKlaviyoMissingProfiles(
        ["member-accepted", "member-missing", "member-rejected"],
        { "member-accepted": "profile-accepted" },
        1,
      ),
    ).toEqual(["member-rejected"]);
  });
});

describe("QuickBooks cross-isolate refresh coordination contract", () => {
  it("allows only one of two clients to use the rolling refresh token", async () => {
    let leaseHeld = false;
    let releaseTokenRequest!: () => void;
    const tokenRequestGate = new Promise<void>((resolve) => {
      releaseTokenRequest = resolve;
    });
    const fetcher = vi.fn(async (request: Request) => {
      if (request.url.includes("/tokens/bearer")) {
        await tokenRequestGate;
        return new Response(
          JSON.stringify({
            access_token: "rotated-access-token",
            expires_in: 3600,
            refresh_token: "rotated-refresh-token",
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        );
      }
      return new Response(JSON.stringify({ CompanyInfo: { Id: "realm-1" } }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    });
    const claimRefreshLease = async (): Promise<QuickBooksRefreshLease> => {
      if (leaseHeld) {
        throw new IntegrationProviderError(
          "provider_conflict",
          409,
          true,
          1_000,
        );
      }
      leaseHeld = true;
      return { credentialGeneration: 7, leaseToken: "lease-token-7" };
    };
    const persistRotatedCredentials = vi.fn(
      async (
        _credentials: unknown,
        lease?: QuickBooksRefreshLease,
      ): Promise<void> => {
        expect(lease).toEqual({
          credentialGeneration: 7,
          leaseToken: "lease-token-7",
        });
        leaseHeld = false;
      },
    );
    const client = (id: string) =>
      new QuickBooksClient(
        id,
        {
          accessToken: "expired-access-token",
          accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
          realmId: "realm-1",
          refreshToken: "rolling-refresh-token",
        },
        {
          clientId: "client-id",
          clientSecret: "client-secret",
          environment: "sandbox",
          redirectUri:
            "https://vinifera.example/api/integrations/quickbooks/callback",
        },
        {
          claimRefreshLease,
          fetcher,
          persistRotatedCredentials,
          releaseRefreshLease: async () => {
            leaseHeld = false;
          },
          sleep: async () => undefined,
        },
      );

    const first = client("worker-isolate-a").validateConnection();
    await vi.waitFor(() => expect(leaseHeld).toBe(true));
    const second = client("worker-isolate-b").validateConnection();
    await expect(second).rejects.toMatchObject({
      providerCode: "provider_conflict",
      retryable: true,
    });
    releaseTokenRequest();
    await first;

    expect(
      fetcher.mock.calls.filter(([request]) =>
        (request as Request).url.includes("/tokens/bearer"),
      ),
    ).toHaveLength(1);
    expect(persistRotatedCredentials).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 5 integration attempt ceilings", () => {
  it("retries a ninth failed attempt when the claimed job permits twelve", () => {
    const error = new IntegrationProviderError(
      "provider_unavailable",
      503,
      true,
    );
    expect(
      failedClaimedIntegrationJob(
        { attempt_count: 9, max_attempts: 12 },
        error,
        new Date("2026-07-26T12:00:00.000Z"),
      ),
    ).toMatchObject({
      outcome: "retry",
    });
    expect(
      failedClaimedIntegrationJob(
        { attempt_count: 12, max_attempts: 12 },
        error,
        new Date("2026-07-26T12:00:00.000Z"),
      ),
    ).toMatchObject({
      nextAttemptAt: null,
      outcome: "dead_letter",
    });
  });
});
