import type { SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, createServerClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({}) as SupabaseClient),
  createServerClientMock: vi.fn(() => ({}) as SupabaseClient),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
  parseCookieHeader: vi.fn(() => []),
  serializeCookieHeader: vi.fn(() => "cookie"),
}));

import { CoreClubMemberService } from "../../server/services/members";
import type { WorkerEnv } from "../../server/types";

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
});
