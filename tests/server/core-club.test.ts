import type { SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  buildCsvTierLookup,
  canonicalizeCsvImportMapping,
  createShippingProvider,
  executeMemberSideEffect,
  executeScheduledRetry,
  isCompleteShippingContact,
  ProductionCoreClubService,
  resolveCsvTierId,
  resumeProcessingReleaseShipments,
  SimulatedShippingProvider,
} from "../../server/services/core-club";
import { AppError } from "../../server/lib/errors";
import type {
  MemberPrincipal,
  StaffPrincipal,
  StaffRole,
  WorkerEnv,
} from "../../server/types";

const address = {
  city: "Napa",
  country: "US",
  line1: "1 Wine Way",
  postalCode: "94558",
  state: "CA",
};

describe("Phase 2 CSV import contract", () => {
  it("canonicalizes every supported browser target without dropping optional data", () => {
    expect(
      canonicalizeCsvImportMapping({
        Address: "line1",
        Address2: "line2",
        City: "city",
        Club: "clubTier",
        Country: "country",
        Email: "email",
        First: "firstName",
        Joined: "joinDate",
        Last: "lastName",
        Phone: "phone",
        State: "state",
        Status: "status",
        Zip: "postalCode",
      }),
    ).toEqual({
      club_tier_id: "Club",
      email: "Email",
      first_name: "First",
      joined_on: "Joined",
      last_name: "Last",
      phone: "Phone",
      shipping_address_line1: "Address",
      shipping_address_line2: "Address2",
      shipping_city: "City",
      shipping_country_code: "Country",
      shipping_postal_code: "Zip",
      shipping_region: "State",
      status: "Status",
    });
  });

  it("rejects unsupported or duplicate browser targets instead of silently dropping them", () => {
    expect(() =>
      canonicalizeCsvImportMapping({
        Email: "email",
        First: "firstName",
        Last: "lastName",
        Tier: "tierName",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    expect(() =>
      canonicalizeCsvImportMapping({
        Email: "email",
        First: "firstName",
        Last: "lastName",
        OtherEmail: "email",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_request" }));
  });

  it("resolves an active tenant tier by canonical ID or case-insensitive name", () => {
    const tierId = "40000000-0000-4000-8000-000000000001";
    const lookup = buildCsvTierLookup([{ id: tierId, name: "Founders Circle" }]);

    expect(resolveCsvTierId(tierId, lookup)).toBe(tierId);
    expect(resolveCsvTierId(" founders circle ", lookup)).toBe(tierId);
    expect(resolveCsvTierId("Unknown Tier", lookup)).toBeNull();
  });

  it("stages optional Commerce7 fields with a tenant-validated canonical tier ID", async () => {
    const tierId = "41000000-0000-4000-8000-000000000001";
    const inserts = new Map<string, unknown>();
    const responses: Record<string, { data: unknown; error: null }> = {
      club_tiers: {
        data: [{ id: tierId, name: "Founders Circle" }],
        error: null,
      },
      member_import_rows: { data: null, error: null },
      member_imports: { data: null, error: null },
      members: { data: [], error: null },
    };
    const admin = {
      from: vi.fn((table: string) => {
        const response = responses[table] ?? { data: null, error: null };
        const builder = {
          eq: vi.fn(() => builder),
          in: vi.fn(() => builder),
          insert: vi.fn((value: unknown) => {
            inserts.set(table, value);
            return Promise.resolve(response);
          }),
          select: vi.fn(() => builder),
          then: (
            resolve: (value: { data: unknown; error: null }) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(response).then(resolve, reject),
        };
        return builder;
      }),
      rpc: vi.fn().mockResolvedValue({
        data: {
          deadLetterCount: 0,
          pendingCount: 0,
          state: "not_required",
          updatedAt: null,
        },
        error: null,
      }),
    } as unknown as SupabaseClient;

    const preview = await new CoreClubServiceHarness(admin).previewMemberImport({
      contents:
        "Status,Signup Date,Customer First Name,Customer Last Name,Customer Email,Customer Phone,Club,Ship To Address,Ship To Address 2,Ship To City,Ship To State Code,Ship To Zip Code,Ship To Country Code\n" +
        "Active,2026-01-05,Avery,Vine,avery-import@example.test,7075550101,Founders Circle,101 Vineyard Lane,Suite 2,Napa,CA,94558,US",
      format: "commerce7",
    });

    expect(preview.validation).toMatchObject({
      invalidCount: 0,
      validCount: 1,
    });
    expect(preview.suggestedMapping).toMatchObject({
      Club: "clubTier",
      "Ship To Address": "line1",
      "Signup Date": "joinDate",
    });
    expect(inserts.get("member_import_rows")).toEqual([
      expect.objectContaining({
        normalized_data: {
          club_tier_id: tierId,
          email: "avery-import@example.test",
          first_name: "Avery",
          joined_on: "2026-01-05",
          last_name: "Vine",
          phone: "7075550101",
          shipping_address_line1: "101 Vineyard Lane",
          shipping_address_line2: "Suite 2",
          shipping_city: "Napa",
          shipping_country_code: "US",
          shipping_postal_code: "94558",
          shipping_region: "CA",
          status: "active",
        },
        status: "valid",
      }),
    ]);
  });
});

const organizationId = "10000000-0000-4000-8000-000000000001";
const brandId = "30000000-0000-4000-8000-000000000001";
const tierId = "35000000-0000-4000-8000-000000000001";
const releaseId = "60000000-0000-4000-8000-000000000001";
const memberId = "40000000-0000-4000-8000-000000000001";
const principal: StaffPrincipal = {
  access: {
    graceEndsAt: null,
    state: "active",
    suspendedAt: null,
  },
  organization: {
    accessState: "active",
    id: organizationId,
    name: "Test Winery",
    planTier: "vine",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: "active",
  },
  user: {
    email: "owner@example.com",
    fullName: "Test Owner",
    id: "20000000-0000-4000-8000-000000000001",
    role: "owner",
  },
};
const memberPrincipal: MemberPrincipal = {
  brand: { id: brandId },
  organization: { id: organizationId, name: "Test Winery" },
  user: {
    authUserId: "50000000-0000-4000-8000-000000000001",
    email: "member@example.com",
    firstName: "Avery",
    id: memberId,
    lastName: "Vine",
    status: "active",
  },
};

const serviceEnv = {
  APP_ENV: "test",
  SHIPPING_PROVIDER: "simulated",
  SHIPPING_SIMULATOR_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_runtime_boundary",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  SUPABASE_SECRET_KEY: "test-secret-key",
  SUPABASE_URL: "https://supabase.test",
} satisfies WorkerEnv;

class CoreClubServiceHarness extends ProductionCoreClubService {
  constructor(
    admin: SupabaseClient,
    private readonly authenticated = true,
  ) {
    super(
      serviceEnv,
      { get: vi.fn().mockReturnValue(undefined) } as unknown as Request,
      { append: vi.fn() } as unknown as Response,
    );
    (this as unknown as { admin: SupabaseClient }).admin = admin;
  }

  protected override async requireStaff(
    _roles?: StaffRole[],
  ): Promise<StaffPrincipal> {
    if (!this.authenticated) {
      throw new AppError(401, "unauthorized", "A valid sign-in is required.");
    }
    return principal;
  }

  protected override async requireMember(): Promise<MemberPrincipal> {
    return memberPrincipal;
  }

  protected override async activeBrandId(
    _principal: StaffPrincipal,
    _supplied?: string | null,
    _allowSuspended = false,
  ): Promise<string> {
    return brandId;
  }

  protected override async audit(
    _principal: StaffPrincipal,
    _action: string,
    _entityType: string,
    _entityId: string,
    _metadata: Record<string, unknown> = {},
  ): Promise<void> {}

  protected override async recordDomainAnalyticsEvent(
    _principal: StaffPrincipal | MemberPrincipal,
    _input: {
      eventData?: Record<string, string | number | boolean | null>;
      eventType: string;
      memberId?: string | null;
      requestKey: string;
    },
  ): Promise<void> {}
}

describe("Phase 2 release update integrity", () => {
  const commandId = "80000000-0000-4000-8000-000000000030";
  const firstWineId = "41000000-0000-4000-8000-000000000001";
  const secondWineId = "41000000-0000-4000-8000-000000000002";

  function releaseAdmin() {
    const release = {
      brand_id: brandId,
      description: "Fall allocation",
      embargo_date: "2026-09-01",
      id: releaseId,
      name: "Fall 2026",
      organization_id: organizationId,
      processing_date: "2026-09-15",
      release_tiers: [
        {
          id: "42000000-0000-4000-8000-000000000001",
          price_cents: 12_500,
          tier_id: "40000000-0000-4000-8000-000000000001",
          tier_name: "Founders Circle",
        },
      ],
      release_wines: [
        {
          id: firstWineId,
          release_tier_items: [
            { quantity: 2, unit_price_cents: 3_400 },
          ],
          wine_name: "Estate Cabernet",
        },
        {
          id: secondWineId,
          release_tier_items: [
            { quantity: 1, unit_price_cents: 5_600 },
          ],
          wine_name: "Library Merlot",
        },
      ],
      shipments: [],
      status: "draft",
    };
    const builder = {
      eq: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn().mockResolvedValue({ data: release, error: null }),
      select: vi.fn(() => builder),
    };
    return {
      from: vi.fn().mockReturnValue(builder),
      rpc: vi.fn().mockResolvedValue({
        data: { entityId: releaseId, replayed: false },
        error: null,
      }),
    };
  }

  it("preserves stable wine IDs and reaches the RPC on an exact retry", async () => {
    const admin = releaseAdmin();
    admin.rpc
      .mockResolvedValueOnce({
        data: { entityId: releaseId, replayed: false },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { entityId: releaseId, replayed: true },
        error: null,
      });
    const service = new CoreClubServiceHarness(
      admin as unknown as SupabaseClient,
    );
    const patch = {
      wines: [
        {
          id: secondWineId,
          quantity: 3,
          wineName: "Renamed Library Merlot",
        },
        {
          id: firstWineId,
          priceCents: 0,
          quantity: 4,
          wineName: "Estate Cabernet",
        },
      ],
    };

    await service.updateRelease(releaseId, patch, commandId);
    await service.updateRelease(releaseId, patch, commandId);

    const expectedCall = [
      "apply_release_command",
      expect.objectContaining({
        p_payload: expect.objectContaining({
          wines: [
            {
              price_cents: 5_600,
              quantity: 3,
              wine_id: secondWineId,
              wine_name: "Renamed Library Merlot",
            },
            {
              price_cents: 0,
              quantity: 4,
              wine_id: firstWineId,
              wine_name: "Estate Cabernet",
            },
          ],
        }),
      }),
    ] as const;
    expect(admin.rpc).toHaveBeenCalledTimes(2);
    expect(admin.rpc).toHaveBeenNthCalledWith(1, ...expectedCall);
    expect(admin.rpc).toHaveBeenNthCalledWith(2, ...expectedCall);
    expect(admin.rpc.mock.calls[1]).toStrictEqual(admin.rpc.mock.calls[0]);
  });

  it("rejects a new or unknown wine without a price before the RPC", async () => {
    const admin = releaseAdmin();

    await expect(
      new CoreClubServiceHarness(
        admin as unknown as SupabaseClient,
      ).updateRelease(
        releaseId,
        {
          wines: [
            {
              id: "41000000-0000-4000-8000-000000000099",
              quantity: 1,
              wineName: "Unknown Wine",
            },
          ],
        },
        commandId,
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("treats an unknown wine with an explicit price as new", async () => {
    const admin = releaseAdmin();

    await new CoreClubServiceHarness(
      admin as unknown as SupabaseClient,
    ).updateRelease(
      releaseId,
      {
        wines: [
          {
            id: "41000000-0000-4000-8000-000000000099",
            priceCents: 7_500,
            quantity: 1,
            wineName: "New Wine",
          },
        ],
      },
      commandId,
    );

    expect(admin.rpc).toHaveBeenCalledWith(
      "apply_release_command",
      expect.objectContaining({
        p_payload: expect.objectContaining({
          wines: [
            {
              price_cents: 7_500,
              quantity: 1,
              wine_name: "New Wine",
            },
          ],
        }),
      }),
    );
  });
});

describe("Phase 2 member detail history", () => {
  it("loads bounded Phase 2 history without joining shipments into the member row", async () => {
    const calls: Array<{
      count?: string;
      filters: Array<[string, unknown]>;
      limit?: number;
      select?: string;
      table: string;
    }> = [];
    let auditCall = 0;
    const responses: Record<
      string,
      Array<{ count?: number; data: unknown; error: null }>
    > = {
      audit_log: [
        {
          data: [
            {
              action: "member.paused",
              created_at: "2026-07-03T12:00:00.000Z",
              id: "74000000-0000-4000-8000-000000000001",
              metadata: {},
            },
          ],
          error: null,
        },
        {
          count: 12,
          data: [
            {
              action: "member.communication.email_sent",
              created_at: "2026-07-04T12:00:00.000Z",
              id: "75000000-0000-4000-8000-000000000001",
              metadata: {
                channel: "email",
                detail: "Sent by club staff",
                subject: "Welcome to the club",
              },
            },
          ],
          error: null,
        },
      ],
      billing_attempts: [
        {
          data: [
            {
              amount_cents: 15100,
              attempt_kind: "charge",
              completed_at: "2026-07-02T12:00:00.000Z",
              created_at: "2026-07-02T11:59:00.000Z",
              decline_reason: null,
              id: "73000000-0000-4000-8000-000000000001",
              shipment_id: "72000000-0000-4000-8000-000000000001",
              status: "succeeded",
            },
          ],
          error: null,
        },
      ],
      members: [
        {
          data: {
            brand_id: brandId,
            club_tiers: { id: tierId, name: "Founders Circle" },
            created_at: "2026-01-01T12:00:00.000Z",
            email: "history@example.test",
            first_name: "History",
            id: memberId,
            joined_on: "2026-01-01",
            last_name: "Member",
            lifetime_value_cents: 15100,
            organization_id: organizationId,
            status: "paused",
            updated_at: "2026-07-03T12:00:00.000Z",
          },
          error: null,
        },
      ],
      shipments: [
        {
          count: 21,
          data: [
            {
              charge_amount_cents: 14900,
              created_at: "2026-07-01T12:00:00.000Z",
              id: "72000000-0000-4000-8000-000000000001",
              loyalty_discount_cents: 1000,
              releases: { name: "Summer 2026", processing_date: "2026-07-01" },
              shipment_items: [
                { id: "76000000-0000-4000-8000-000000000001", quantity: 3, wine_name: "Cabernet" },
              ],
              status: "delivered",
              tax_amount_cents: 1200,
              tracking_number: "1ZTEST",
              updated_at: "2026-07-05T12:00:00.000Z",
            },
          ],
          error: null,
        },
      ],
    };
    const admin = {
      from: vi.fn((table: string) => {
        const responseIndex = table === "audit_log" ? auditCall++ : 0;
        const response = responses[table]?.[responseIndex] ?? {
          data: [],
          error: null,
        };
        const call = {
          filters: [] as Array<[string, unknown]>,
          table,
        } as (typeof calls)[number];
        calls.push(call);
        const builder = {
          eq: vi.fn((column: string, value: unknown) => {
            call.filters.push([column, value]);
            return builder;
          }),
          like: vi.fn((column: string, value: unknown) => {
            call.filters.push([column, value]);
            return builder;
          }),
          limit: vi.fn((value: number) => {
            call.limit = value;
            return Promise.resolve(response);
          }),
          maybeSingle: vi.fn().mockResolvedValue(response),
          not: vi.fn((column: string, operator: string, value: unknown) => {
            call.filters.push([`${column}.${operator}`, value]);
            return builder;
          }),
          order: vi.fn(() => builder),
          select: vi.fn(
            (columns: string, options?: { count?: string }) => {
              call.select = columns;
              call.count = options?.count;
              return builder;
            },
          ),
        };
        return builder;
      }),
      rpc: vi.fn().mockResolvedValue({
        data: {
          deadLetterCount: 0,
          pendingCount: 0,
          state: "not_required",
          updatedAt: null,
        },
        error: null,
      }),
    } as unknown as SupabaseClient;

    const result = await new CoreClubServiceHarness(admin).getMember(memberId);
    const activity = result.activity as Array<Record<string, unknown>>;
    const communications = result.communications as Array<Record<string, unknown>>;
    const orders = result.orders as Array<Record<string, unknown>>;

    expect(result).toMatchObject({
      churnRisk: "not_scored",
      communicationCount: 12,
      historyMeta: {
        activityLimit: 20,
        communicationsTruncated: true,
        orderLimit: 20,
        ordersTruncated: true,
      },
      orderCount: 21,
    });
    expect(orders[0]).toMatchObject({
      discountAmountCents: 1000,
      releaseName: "Summer 2026",
      subtotalAmountCents: 13900,
      taxAmountCents: 1200,
      totalAmountCents: 15100,
    });
    expect(activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "order",
          title: "Summer 2026 order delivered",
        }),
        expect.objectContaining({
          detail: "$151.00",
          kind: "payment",
          title: "Payment succeeded",
        }),
        expect.objectContaining({
          kind: "status",
          title: "Membership paused",
        }),
      ]),
    );
    expect(communications).toEqual([
      expect.objectContaining({
        detail: "Sent by club staff",
        kind: "communication",
        title: "Welcome to the club",
      }),
    ]);

    const memberCall = calls.find((call) => call.table === "members");
    expect(memberCall?.select).toBe("*,club_tiers(id,name)");
    expect(memberCall?.select).not.toContain("shipments");
    expect(calls.find((call) => call.table === "shipments")?.limit).toBe(20);
    expect(calls.find((call) => call.table === "billing_attempts")?.limit).toBe(
      21,
    );
    expect(
      calls.filter((call) => call.table === "audit_log").map((call) => call.limit),
    ).toEqual([21, 11]);
  });

  it("publishes shipment totals after loyalty discount and tax", async () => {
    const selected: string[] = [];
    const response = {
      count: 1,
      data: [
        {
          charge_amount_cents: 14900,
          created_at: "2026-07-01T12:00:00.000Z",
          id: "72000000-0000-4000-8000-000000000001",
          loyalty_discount_cents: 1000,
          member_id: memberId,
          members: {
            email: "history@example.test",
            first_name: "History",
            last_name: "Member",
          },
          release_id: releaseId,
          releases: { name: "Summer 2026" },
          shipment_items: [],
          status: "charged",
          tax_amount_cents: 1200,
          updated_at: "2026-07-01T12:00:00.000Z",
        },
      ],
      error: null,
    };
    const builder = {
      eq: vi.fn(() => builder),
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn().mockResolvedValue(response),
      select: vi.fn((columns: string) => {
        selected.push(columns);
        return builder;
      }),
    };
    const admin = {
      from: vi.fn().mockReturnValue(builder),
    } as unknown as SupabaseClient;

    const result = await new CoreClubServiceHarness(admin).listShipments({
      limit: 10,
      offset: 0,
    });

    expect(selected[0]).toContain("tax_amount_cents");
    expect(result.items[0]).toMatchObject({
      chargeAmountCents: 15100,
      loyaltyDiscountCents: 1000,
      payableAmountCents: 15100,
      subtotalAmountCents: 13900,
      taxAmountCents: 1200,
    });
  });
});

describe("Phase 2 shipping provider boundary", () => {
  it("never permits the deterministic simulator in production", () => {
    expect(() =>
      createShippingProvider({
        APP_ENV: "production",
        SHIPPING_PROVIDER: "simulated",
        SHIPPING_SIMULATOR_ENABLED: "true",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "activation_required",
        status: 503,
      }),
    );
  });

  it("requires both test mode and an explicit simulator flag", () => {
    expect(() =>
      createShippingProvider({
        APP_ENV: "test",
        SHIPPING_PROVIDER: "simulated",
        SHIPPING_SIMULATOR_ENABLED: "false",
      }),
    ).toThrowError(expect.objectContaining({ code: "activation_required" }));
    expect(
      createShippingProvider({
        APP_ENV: "test",
        SHIPPING_PROVIDER: "simulated",
        SHIPPING_SIMULATOR_ENABLED: "true",
      }),
    ).toBeInstanceOf(SimulatedShippingProvider);
  });

  it("creates reproducible non-production labels without card or credential data", async () => {
    const provider = new SimulatedShippingProvider();
    const input = {
      externalId: "50000000-0000-4000-8000-000000000001",
      fromAddress: address,
      fromContact: {
        company: "Test Winery",
        name: "Test Winery",
        phone: "7075550100",
      },
      parcel: {
        heightInches: 6,
        lengthInches: 14,
        weightOunces: 96,
        widthInches: 12,
      },
      toAddress: { ...address, line1: "2 Member Lane" },
      toContact: { name: "Avery Vine", phone: "7075550101" },
    };

    const persisted: string[] = [];
    const first = await provider.createLabel(input, {
      persistExternalShipment: async (shipmentId, rateId) => {
        persisted.push(shipmentId, rateId);
      },
    });
    const second = await provider.createLabel(input, {
      externalRateId: first.rateId,
      externalShipmentId: first.providerReference,
      persistExternalShipment: async () => {
        throw new Error("Recovery must not persist a second shipment.");
      },
    });

    expect(first).toEqual(second);
    expect(persisted).toEqual([first.providerReference, first.rateId]);
    expect(first.trackingNumber).toMatch(/^1ZSIM\d{12}$/);
    expect(first.labelUrl).toMatch(/^https:\/\/example\.invalid\/labels\//);
  });

  it("rejects malformed addresses in deterministic tests", async () => {
    const result = await new SimulatedShippingProvider().validateAddress({
      ...address,
      line1: "",
      postalCode: "bad",
    });

    expect(result.valid).toBe(false);
    expect(result.messages).toContain("The address is incomplete or invalid.");
  });

  it("authenticates staff before constructing the address validation provider", async () => {
    const service = new CoreClubServiceHarness(
      {} as SupabaseClient,
      false,
    );

    await expect(service.validateShippingAddress(address)).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  });

  it("keeps the already-authenticated member address flow connected", async () => {
    const commandId = "80000000-0000-4000-8000-000000000001";
    const builder = {
      eq: vi.fn(() => builder),
      select: vi.fn(() => builder),
      single: vi.fn().mockResolvedValue({
        data: {
          brand_id: brandId,
          email: "member@example.com",
          first_name: "Avery",
          id: memberId,
          last_name: "Vine",
          organization_id: organizationId,
          status: "active",
        },
        error: null,
      }),
    };
    const admin = {
      from: vi.fn().mockReturnValue(builder),
      rpc: vi.fn().mockResolvedValue({
        data: {
          entityId: memberId,
          sideEffectState: "not_required",
          status: "applied",
        },
        error: null,
      }),
    } as unknown as SupabaseClient;

    await new CoreClubServiceHarness(admin).updateMemberPortalAddress(
      address,
      commandId,
    );

    expect(admin.rpc).toHaveBeenCalledWith(
      "apply_member_portal_address_command",
      expect.objectContaining({
        p_command_id: commandId,
        p_validated_address: address,
      }),
    );
  });

  it("rejects incomplete adult-signature contacts before calling a carrier", () => {
    expect(
      isCompleteShippingContact(
        { company: "Test Winery", name: "Test Winery", phone: "" },
        true,
      ),
    ).toBe(false);
    expect(
      isCompleteShippingContact({
        name: "Avery Vine",
        phone: "707-555-0101",
      }),
    ).toBe(true);
  });
});

describe("Phase 2 member batch commands", () => {
  it.each([
    {
      operation: "pause" as const,
    },
    {
      operation: "resume" as const,
    },
    {
      operation: "cancel" as const,
    },
  ])(
    "delegates $operation eligibility and locking to the aggregate SQL command",
    async ({ operation }) => {
      const commandId = "80000000-0000-4000-8000-000000000002";
      const admin = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            affected: [
            {
              id: "40000000-0000-4000-8000-000000000001",
              updatedAt: "2026-07-26T00:00:00.000Z",
            },
          ],
            updated: 1,
          },
          error: null,
        }),
      } as unknown as SupabaseClient;

      const result = await new CoreClubServiceHarness(admin).batchMembers(
        { operation },
        commandId,
      );

      expect(result).toEqual({ updated: 1 });
      expect(admin.rpc).toHaveBeenCalledWith(
        "apply_member_command",
        expect.objectContaining({
          p_command_id: commandId,
          p_operation: `batch_${operation}`,
          p_scope_all: true,
        }),
      );
    },
  );
});

describe("Phase 2 scheduled operations", () => {
  it.each(["members", "staff_users", "platform_users"] as const)(
    "supersedes auth cleanup when %s gains a reference before provider deletion",
    async (referencedTable) => {
      const providerSubjectId = "50000000-0000-4000-8000-000000000002";
      const deleteUser = vi.fn().mockResolvedValue({ data: null, error: null });
      const queriedTables: string[] = [];
      const admin = {
        auth: { admin: { deleteUser } },
        from: vi.fn((table: string) => {
          queriedTables.push(table);
          const builder = {
            eq: vi.fn(() => builder),
            is: vi.fn(() => builder),
            limit: vi.fn(() => builder),
            maybeSingle: vi.fn().mockResolvedValue({
              data:
                table === referencedTable
                  ? { id: "90000000-0000-4000-8000-000000000001" }
                  : null,
              error: null,
            }),
            select: vi.fn(() => builder),
          };
          return builder;
        }),
      } as unknown as SupabaseClient;
      const stripe = {
        customers: { update: vi.fn() },
      } as unknown as Stripe;

      await expect(
        executeMemberSideEffect(admin, stripe, {
          attempt_count: 1,
          brand_id: brandId,
          command_id: "80000000-0000-4000-8000-000000000003",
          effect_type: "auth_user_delete",
          lease_token: "lease-auth-cleanup",
          max_attempts: 5,
          member_id: memberId,
          organization_id: organizationId,
          outbox_id: "90000000-0000-4000-8000-000000000002",
          payload: {},
          provider_subject_id: providerSubjectId,
        }),
      ).resolves.toBe("superseded");

      expect(queriedTables).toEqual([
        "members",
        "staff_users",
        "platform_users",
      ]);
      expect(deleteUser).not.toHaveBeenCalled();
    },
  );

  it("resumes every due processing release even when it was not newly claimed", async () => {
    const createShipments = vi.fn().mockResolvedValue(undefined);
    const failed = await resumeProcessingReleaseShipments(
      [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: "10000000-0000-4000-8000-000000000001",
        },
      ],
      createShipments,
    );

    expect(failed).toBe(0);
    expect(createShipments).toHaveBeenCalledWith({
      id: "60000000-0000-4000-8000-000000000001",
      organization_id: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("requeues a claimed decline retry when its provider call is transiently unavailable", async () => {
    const retry = {
      amount_cents: 12500,
      attempt_number: 2,
      billing_attempt_id: "70000000-0000-4000-8000-000000000001",
      member_id: "30000000-0000-4000-8000-000000000001",
      organization_id: "10000000-0000-4000-8000-000000000001",
      shipment_id: "50000000-0000-4000-8000-000000000001",
    };
    const requeue = vi.fn().mockResolvedValue(undefined);
    const result = await executeScheduledRetry(
      retry,
      vi.fn().mockRejectedValue(new Error("temporary Stripe timeout")),
      requeue,
    );

    expect(result).toBe("failed");
    expect(requeue).toHaveBeenCalledWith(retry);
  });

  it("leaves release state changes to transactional shipment preparation", async () => {
    const admin = {
      from: vi.fn((table: string) => {
        const response =
          table === "brands"
            ? {
                data: {
                  access_status: "active",
                  active: true,
                  billing_mode: "independent",
                  id: brandId,
                },
                error: null,
              }
            : {
                data: { access_status: "active", id: organizationId },
                error: null,
              };
        const builder = {
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn().mockResolvedValue(response),
          select: vi.fn(() => builder),
        };
        return builder;
      }),
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "XX000", message: "temporary preparation failure" },
      }),
    } as unknown as SupabaseClient;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      new CoreClubServiceHarness(admin).processRelease(releaseId),
    ).rejects.toMatchObject({
      code: "upstream_error",
      message: "Release shipments could not be prepared transactionally.",
      status: 500,
    });

    expect(admin.from).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"resumable":false'),
    );
    log.mockRestore();
  });

  it("orders the recovery queue by its persisted retry timestamp", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const builder = {
      eq: vi.fn(() => builder),
      order,
      select: vi.fn(() => builder),
    };
    const admin = {
      from: vi.fn().mockReturnValue(builder),
    } as unknown as SupabaseClient;

    await new CoreClubServiceHarness(admin).listRecoveryQueue();

    expect(order).toHaveBeenCalledWith("next_retry_at");
  });
});

describe("Phase 2 refund command replay", () => {
  const commandId = "80000000-0000-4000-8000-000000000020";
  const shipmentId = "70000000-0000-4000-8000-000000000020";
  const recordedAmountCents = 15_500;
  const recordedReason = "Customer request";

  function replayAdmin() {
    const responses: Record<string, { data: unknown; error: null }> = {
      billing_attempts: {
        data: {
          amount_cents: recordedAmountCents,
          id: "71000000-0000-4000-8000-000000000020",
          metadata: { reason: recordedReason },
          status: "refunded",
          stripe_refund_id: "re_phase2_replay",
        },
        error: null,
      },
      shipments: {
        data: {
          charge_amount_cents: recordedAmountCents,
          id: shipmentId,
          loyalty_discount_cents: 0,
          refund_amount_cents: recordedAmountCents,
          status: "refunded",
          stripe_charge_id: "ch_phase2_replay",
          stripe_payment_intent_id: "pi_phase2_replay",
          tax_amount_cents: 0,
        },
        error: null,
      },
    };
    const admin = {
      from: vi.fn((table: string) => {
        const builder = {
          eq: vi.fn(() => builder),
          maybeSingle: vi
            .fn()
            .mockResolvedValue(
              responses[table] ?? { data: null, error: null },
            ),
          select: vi.fn(() => builder),
        };
        return builder;
      }),
      rpc: vi.fn(),
    };
    return admin;
  }

  it("returns the recorded full-refund result without another ledger or Stripe call", async () => {
    const admin = replayAdmin();
    const refundResource = new Stripe("sk_test_refund_replay").refunds;
    const stripeCreate = vi
      .spyOn(Object.getPrototypeOf(refundResource), "create")
      .mockRejectedValue(new Error("a terminal replay must not reach Stripe"));

    const result = await new CoreClubServiceHarness(
      admin as unknown as SupabaseClient,
    ).refundShipment(
      shipmentId,
      { amountCents: recordedAmountCents, reason: recordedReason },
      commandId,
    );

    expect(result).toEqual({
      amountCents: recordedAmountCents,
      id: shipmentId,
      status: "refunded",
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(stripeCreate).not.toHaveBeenCalled();
    stripeCreate.mockRestore();
  });

  it.each([
    ["amount", { amountCents: recordedAmountCents - 100, reason: recordedReason }],
    ["reason", { amountCents: recordedAmountCents, reason: "Different reason" }],
  ])("rejects a replay with a mismatched %s", async (_field, input) => {
    const admin = replayAdmin();
    const refundResource = new Stripe("sk_test_refund_replay").refunds;
    const stripeCreate = vi
      .spyOn(Object.getPrototypeOf(refundResource), "create")
      .mockRejectedValue(new Error("a conflicting replay must not reach Stripe"));

    await expect(
      new CoreClubServiceHarness(
        admin as unknown as SupabaseClient,
      ).refundShipment(shipmentId, input, commandId),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(stripeCreate).not.toHaveBeenCalled();
    stripeCreate.mockRestore();
  });
});

function createScheduleAdmin(
  refundClaims: Array<{
    billing_attempt_id: string;
    lease_token: string;
  }>,
  refundAttempts: unknown[] = [],
): SupabaseClient & {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
} {
  const rpc = vi.fn(
    async (name: string): Promise<{ data: unknown; error: null }> => {
      if (name === "claim_stale_refund_attempts") {
        return { data: refundClaims, error: null };
      }
      return { data: [], error: null };
    },
  );
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const response = () => ({
      data:
        table === "billing_attempts" &&
        filters.attempt_kind === "refund"
          ? refundAttempts
          : [],
      error: null,
    });
    const builder = {
      eq: vi.fn((column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      }),
      in: vi.fn((column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      }),
      limit: vi.fn(async () => response()),
      lte: vi.fn(() => builder),
      select: vi.fn(() => builder),
      then: (
        resolve: (value: ReturnType<typeof response>) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(response()).then(resolve, reject),
    };
    return builder;
  });
  return { from, rpc } as unknown as SupabaseClient & {
    from: ReturnType<typeof vi.fn>;
    rpc: ReturnType<typeof vi.fn>;
  };
}

async function loadScheduledRunner(admin: SupabaseClient) {
  vi.resetModules();
  vi.doMock("@supabase/supabase-js", async () => {
    const actual =
      await vi.importActual<typeof import("@supabase/supabase-js")>(
        "@supabase/supabase-js",
      );
    return {
      ...actual,
      createClient: vi.fn(() => admin),
    };
  });
  return (await import("../../server/services/core-club"))
    .runCoreClubSchedule;
}

describe("Phase 2 stale refund scheduler", () => {
  const asOf = new Date("2026-07-26T18:00:00.000Z");
  const refundAttemptId = "70000000-0000-4000-8000-000000000010";
  const refundLeaseToken = "refund-recovery-lease";
  const refundAttempt = {
    amount_cents: 4_000,
    id: refundAttemptId,
    idempotency_key: `shipment:${releaseId}:refund:80000000-0000-4000-8000-000000000010`,
    metadata: { reason: "customer_request" },
    shipments: {
      brand_id: brandId,
      charge_amount_cents: 12_000,
      id: "50000000-0000-4000-8000-000000000010",
      loyalty_discount_cents: 0,
      loyalty_redemption_id: null,
      member_id: memberId,
      organization_id: organizationId,
      release_id: releaseId,
      retry_count: 0,
      shipping_charge_cents: 0,
      status: "charged",
      stripe_charge_id: "ch_recovery",
      stripe_payment_intent_id: "pi_recovery",
      tax_amount_cents: 0,
    },
  };

  it("claims only stale refunds and skips provider work when the claim set is empty", async () => {
    const admin = createScheduleAdmin([]);
    const refundResource = new Stripe("sk_test_refund_scheduler").refunds;
    const createRefund = vi
      .spyOn(Object.getPrototypeOf(refundResource), "create")
      .mockRejectedValue(new Error("an unclaimed refund must not reach Stripe"));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const runCoreClubSchedule = await loadScheduledRunner(admin);

    const report = await runCoreClubSchedule(serviceEnv, asOf);

    expect(admin.rpc).toHaveBeenCalledWith("claim_stale_refund_attempts", {
      p_as_of: asOf.toISOString(),
      p_lease_seconds: 300,
      p_limit: 100,
      p_stale_seconds: 300,
      p_worker_id: `core-club-refund:${asOf.toISOString()}`,
    });
    expect(createRefund).not.toHaveBeenCalled();
    expect(
      admin.from.mock.calls.filter(([table]) => table === "billing_attempts"),
    ).toHaveLength(1);
    expect(admin.rpc).not.toHaveBeenCalledWith(
      "complete_refund_recovery_claim",
      expect.anything(),
    );
    expect(report).toMatchObject({
      failed: 0,
      recoveredAttempts: 0,
      refundsRecovered: 0,
    });

    createRefund.mockRestore();
    info.mockRestore();
  });

  it.each([
    {
      expectedErrorCode: null,
      expectedFailed: 0,
      expectedOutcome: "refunded",
      expectedRefundsRecovered: 1,
      expectedRetry: false,
    },
    {
      expectedErrorCode: "RECOVERY_RETRY_REQUIRED",
      expectedFailed: 1,
      expectedOutcome: "retry",
      expectedRefundsRecovered: 0,
      expectedRetry: true,
    },
  ] as const)(
    "finalizes a claimed $expectedOutcome refund with the matching lease disposition",
    async ({
      expectedErrorCode,
      expectedFailed,
      expectedOutcome,
      expectedRefundsRecovered,
      expectedRetry,
    }) => {
      const admin = createScheduleAdmin(
        [
          {
            billing_attempt_id: refundAttemptId,
            lease_token: refundLeaseToken,
          },
        ],
        [refundAttempt],
      );
      const refundResource = new Stripe("sk_test_refund_scheduler").refunds;
      const createRefund = vi.spyOn(
        Object.getPrototypeOf(refundResource),
        "create",
      );
      if (expectedOutcome === "refunded") {
        createRefund.mockResolvedValue({
          amount: 4_000,
          id: "re_recovered",
        } as Stripe.Refund);
      } else {
        createRefund.mockRejectedValue(
          new Stripe.errors.StripeConnectionError({
            message: "connection reset after request",
            type: "api_error",
          }),
        );
      }
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const runCoreClubSchedule = await loadScheduledRunner(admin);

      const report = await runCoreClubSchedule(serviceEnv, asOf);

      expect(createRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 4_000,
          metadata: expect.objectContaining({
            billing_attempt_id: refundAttemptId,
          }),
          payment_intent: "pi_recovery",
        }),
        { idempotencyKey: refundAttempt.idempotency_key },
      );
      expect(admin.rpc).toHaveBeenCalledWith(
        "complete_refund_recovery_claim",
        {
          p_billing_attempt_id: refundAttemptId,
          p_error_code: expectedErrorCode,
          p_lease_token: refundLeaseToken,
          p_retry: expectedRetry,
        },
      );
      expect(report).toMatchObject({
        failed: expectedFailed,
        recoveredAttempts: 1,
        refundsRecovered: expectedRefundsRecovered,
      });

      createRefund.mockRestore();
      info.mockRestore();
    },
  );
});
