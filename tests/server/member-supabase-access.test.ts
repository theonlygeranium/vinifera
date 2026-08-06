import type { SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  brandQueryMock,
  createClientMock,
  createServerClientMock,
  rpcMock,
  surfaceFromMock,
} = vi.hoisted(() => {
  const rpc = vi.fn();
  const brandQuery = {
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    select: vi.fn(),
  };
  brandQuery.eq.mockReturnValue(brandQuery);
  brandQuery.select.mockReturnValue(brandQuery);
  const surfaceFrom = vi.fn(() => brandQuery);
  return {
    brandQueryMock: brandQuery,
    createClientMock: vi.fn(() => ({ rpc }) as unknown as SupabaseClient),
    createServerClientMock: vi.fn(
      () => ({ from: surfaceFrom }) as unknown as SupabaseClient,
    ),
    rpcMock: rpc,
    surfaceFromMock: surfaceFrom,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
  parseCookieHeader: vi.fn(() => []),
  serializeCookieHeader: vi.fn(() => "cookie"),
}));

import { CoreClubMemberService } from "../../server/services/members";
import type { StaffPrincipal, WorkerEnv } from "../../server/types";

const env = {
  APP_ENV: "staging",
  CF_ACCESS_CLIENT_ID: "access-id",
  CF_ACCESS_CLIENT_SECRET: "access-secret",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  SUPABASE_SECRET_KEY: "secret-key",
  SUPABASE_URL: "https://supabase.example.test",
} satisfies WorkerEnv;

class MemberServiceHarness extends CoreClubMemberService {
  surface(kind: "member" | "staff"): SupabaseClient {
    return this.authenticatedSurfaceClient(kind);
  }

  resolveBrand(principal: StaffPrincipal): Promise<string> {
    return this.activeBrandId(principal);
  }
}

function requestWithAuthorization(value?: string): Request {
  return {
    get: vi.fn((name: string) =>
      name.toLowerCase() === "authorization" ? value : undefined,
    ),
    headers: {},
  } as unknown as Request;
}

describe("member service Supabase Access transport", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    createServerClientMock.mockClear();
    rpcMock.mockReset();
    surfaceFromMock.mockClear();
    brandQueryMock.eq.mockClear();
    brandQueryMock.select.mockClear();
    brandQueryMock.maybeSingle.mockReset();
  });

  it("injects Cloudflare Access into cookie and bearer surface clients", () => {
    const response = { append: vi.fn() } as unknown as Response;
    const staffService = new MemberServiceHarness(
      env,
      requestWithAuthorization(),
      response,
    );
    staffService.surface("staff");

    expect(createServerClientMock).toHaveBeenCalledWith(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY,
      expect.objectContaining({
        global: expect.objectContaining({
          fetch: expect.any(Function),
          headers: {
            "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
            "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
          },
        }),
      }),
    );

    const memberService = new MemberServiceHarness(
      env,
      requestWithAuthorization("Bearer member-token"),
      response,
    );
    memberService.surface("member");

    expect(createClientMock).toHaveBeenLastCalledWith(
      env.SUPABASE_URL,
      env.SUPABASE_PUBLISHABLE_KEY,
      expect.objectContaining({
        global: expect.objectContaining({
          fetch: expect.any(Function),
          headers: {
            Authorization: "Bearer member-token",
            "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
            "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
          },
        }),
      }),
    );
  });

  it("resolves the default brand through the tenant-scoped admin RPC", async () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const brandId = "22222222-2222-4222-8222-222222222222";
    rpcMock.mockResolvedValue({ data: brandId, error: null });
    brandQueryMock.maybeSingle.mockResolvedValue({
      data: {
        access_status: "active",
        billing_mode: "organization",
        id: brandId,
      },
      error: null,
    });
    const service = new MemberServiceHarness(
      env,
      requestWithAuthorization(),
      { append: vi.fn() } as unknown as Response,
    );

    await expect(
      service.resolveBrand({
        access: {
          graceEndsAt: null,
          state: "active",
          suspendedAt: null,
        },
        organization: {
          accessState: "active",
          id: organizationId,
          name: "QA Winery",
          planTier: "vine",
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          subscriptionStatus: "active",
        },
        user: {
          email: "qa@example.test",
          fullName: "QA Owner",
          id: "33333333-3333-4333-8333-333333333333",
          role: "owner",
        },
      }),
    ).resolves.toBe(brandId);

    expect(rpcMock).toHaveBeenCalledWith("resolve_default_brand_id", {
      p_organization_id: organizationId,
    });
    expect(surfaceFromMock).toHaveBeenCalledWith("brands");
  });
});
