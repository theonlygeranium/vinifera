import type { SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contextDeleteMock,
  createClientMock,
  createServerClientMock,
  signInWithOtpMock,
} = vi.hoisted(() => {
    const signInWithOtp = vi.fn();
    const memberQuery = {
      eq: vi.fn(),
      limit: vi.fn(),
      select: vi.fn(),
    };
    memberQuery.eq.mockReturnValue(memberQuery);
    memberQuery.select.mockReturnValue(memberQuery);
    const contextDeleteQuery = {
      delete: vi.fn(),
      eq: vi.fn(),
      error: null,
    };
    contextDeleteQuery.delete.mockReturnValue(contextDeleteQuery);
    contextDeleteQuery.eq.mockReturnValue(contextDeleteQuery);
    const admin = {
      from: vi.fn((table: string) =>
        table === "member_auth_link_contexts" ? contextDeleteQuery : memberQuery,
      ),
      rpc: vi.fn(async (name: string) => {
        if (name === "record_magic_link_request") {
          return { data: [{ allowed: true }], error: null };
        }
        return { data: null, error: null };
      }),
    };
    memberQuery.limit.mockResolvedValue({
      data: [
        {
          auth_user_id: null,
          brand_id: "20000000-0000-4000-8000-000000000001",
          id: "10000000-0000-4000-8000-000000000001",
          organization_id: "30000000-0000-4000-8000-000000000001",
        },
      ],
      error: null,
    });
    return {
      contextDeleteMock: contextDeleteQuery,
      createClientMock: vi.fn(() => admin as unknown as SupabaseClient),
      createServerClientMock: vi.fn(
        () => ({ auth: { signInWithOtp } }) as unknown as SupabaseClient,
      ),
      signInWithOtpMock: signInWithOtp,
    };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
  parseCookieHeader: vi.fn(() => []),
  serializeCookieHeader: vi.fn(() => "member-link-cookie"),
}));

import { ProductionFoundationService } from "../../server/services/production-foundation";
import type { WorkerEnv } from "../../server/types";

const env = {
  APP_ENV: "staging",
  APP_ORIGIN: "https://staging.example.test",
  AUTH_EMAIL_ENABLED: "true",
  MEMBER_BRAND_CONTEXT_SECRET: "member-secret-that-is-long-enough-for-tests",
  RATE_LIMIT_PEPPER: "rate-limit-pepper-that-is-long-enough-for-tests",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  SUPABASE_SECRET_KEY: "secret-key",
  SUPABASE_URL: "https://supabase.example.test",
} satisfies WorkerEnv;

describe("member magic-link provider response", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    createServerClientMock.mockClear();
    contextDeleteMock.delete.mockClear();
    contextDeleteMock.eq.mockClear();
    signInWithOtpMock.mockReset();
  });

  it("fails closed with a privacy-safe error when Supabase rejects delivery", async () => {
    signInWithOtpMock.mockResolvedValue({
      data: { user: null },
      error: { message: "provider detail must remain private" },
    });
    const request = {
      get: vi.fn((name: string) =>
        name.toLowerCase() === "host" ? "staging.example.test" : undefined,
      ),
      headers: {},
      protocol: "https",
    } as unknown as Request;
    const response = { append: vi.fn() } as unknown as Response;
    const service = new ProductionFoundationService(env, request, response);

    await expect(
      service.requestMemberMagicLink({
        email: "member@example.test",
        ipAddress: "192.0.2.44",
      }),
    ).rejects.toMatchObject({
      code: "configuration_error",
      message: "Member sign-in is temporarily unavailable.",
      status: 503,
    });
    expect(signInWithOtpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "member@example.test",
        options: expect.objectContaining({
          emailRedirectTo: expect.stringMatching(
            /^https:\/\/staging\.example\.test\/api\/auth\/member\/callback\?state=/,
          ),
        }),
      }),
    );
    expect(contextDeleteMock.delete).toHaveBeenCalledOnce();
    expect(contextDeleteMock.eq).toHaveBeenCalledWith(
      "organization_id",
      "30000000-0000-4000-8000-000000000001",
    );
    expect(contextDeleteMock.eq).toHaveBeenCalledWith(
      "brand_id",
      "20000000-0000-4000-8000-000000000001",
    );
    expect(response.append).not.toHaveBeenCalled();
  });

  it("writes the new link cookie only after Supabase accepts delivery", async () => {
    signInWithOtpMock.mockResolvedValue({ data: { user: null }, error: null });
    const request = {
      get: vi.fn((name: string) =>
        name.toLowerCase() === "host" ? "staging.example.test" : undefined,
      ),
      headers: {},
      protocol: "https",
    } as unknown as Request;
    const response = { append: vi.fn() } as unknown as Response;
    const service = new ProductionFoundationService(env, request, response);

    await expect(
      service.requestMemberMagicLink({
        email: "member@example.test",
        ipAddress: "192.0.2.45",
      }),
    ).resolves.toBeUndefined();
    expect(contextDeleteMock.delete).not.toHaveBeenCalled();
    expect(response.append).toHaveBeenCalledWith(
      "Set-Cookie",
      "member-link-cookie",
    );
  });
});
