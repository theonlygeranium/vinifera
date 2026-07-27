import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { assertStaffRole } from "../../server/lib/authorization";
import { AppError } from "../../server/lib/errors";
import { assertStaffWorkspaceAccess } from "../../server/services/core-club";
import { classifyOrganizationBootstrapRecovery } from "../../server/services/production-foundation";
import type {
  ApplicationService,
  FoundationServiceFactory,
  WorkerEnv,
} from "../../server/types";

const staffPrincipal = {
  access: {
    graceEndsAt: null,
    state: "active",
    suspendedAt: null,
  },
  organization: {
    accessState: "active",
    id: "10000000-0000-4000-8000-000000000001",
    name: "Test Winery",
    planTier: "vine" as const,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: "incomplete",
  },
  user: {
    email: "owner@example.com",
    fullName: "Test Owner",
    id: "20000000-0000-4000-8000-000000000001",
    role: "owner" as const,
  },
};

describe("organization signup bootstrap recovery", () => {
  it("recovers a committed organization after an ambiguous RPC response", () => {
    expect(
      classifyOrganizationBootstrapRecovery(
        { organization_id: "10000000-0000-4000-8000-000000000001" },
        null,
      ),
    ).toEqual({
      organizationId: "10000000-0000-4000-8000-000000000001",
      state: "recovered",
    });
  });

  it("permits cleanup only after a successful lookup proves no staff row exists", () => {
    expect(classifyOrganizationBootstrapRecovery(null, null)).toEqual({
      state: "absent",
    });
    expect(
      classifyOrganizationBootstrapRecovery(null, new Error("lookup timeout")),
    ).toEqual({ state: "ambiguous" });
    expect(classifyOrganizationBootstrapRecovery({}, null)).toEqual({
      state: "ambiguous",
    });
  });
});

function service(overrides: Partial<ApplicationService> = {}): ApplicationService {
  return {
    acceptStaffInvite: vi.fn().mockResolvedValue(staffPrincipal),
    completeStaffPasswordReset: vi.fn().mockResolvedValue(undefined),
    createBillingCheckout: vi
      .fn()
      .mockResolvedValue({ url: "https://checkout.stripe.test/session" }),
    createBillingPortal: vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.test/session" }),
    createStaffInvitation: vi
      .fn()
      .mockResolvedValue({ expiresAt: "2026-07-27T00:00:00.000Z" }),
    exchangeAuthCode: vi.fn().mockResolvedValue({ destination: "/app" }),
    getGoogleOAuthUrl: vi.fn().mockResolvedValue("https://accounts.google.test/oauth"),
    getMemberSession: vi.fn().mockResolvedValue(null),
    getStaffSession: vi.fn().mockResolvedValue(staffPrincipal),
    handleStripeWebhook: vi.fn().mockResolvedValue({ duplicate: false }),
    memberLogout: vi.fn().mockResolvedValue(undefined),
    requestMemberMagicLink: vi.fn().mockResolvedValue(undefined),
    requestStaffPasswordReset: vi.fn().mockResolvedValue(undefined),
    staffLogin: vi.fn().mockResolvedValue(staffPrincipal),
    staffLogout: vi.fn().mockResolvedValue(undefined),
    staffSignup: vi.fn().mockResolvedValue({
      billingActivationRequired: true,
      billingCustomerState: "deferred",
      principal: staffPrincipal,
    }),
    batchMembers: vi.fn().mockResolvedValue({ updated: 0 }),
    confirmShipmentPack: vi.fn().mockResolvedValue({
      complete: true,
      packedItems: 1,
      status: "packed",
    }),
    createClubTier: vi.fn().mockResolvedValue({ id: "tier-id" }),
    createMember: vi.fn().mockResolvedValue({ id: "member-id" }),
    createMemberPaymentMethodPortal: vi
      .fn()
      .mockResolvedValue({ url: "https://billing.stripe.test/member" }),
    createRelease: vi.fn().mockResolvedValue({ id: "release-id", status: "draft" }),
    deleteClubTier: vi.fn().mockResolvedValue(undefined),
    deleteMember: vi.fn().mockResolvedValue(undefined),
    exportMembers: vi.fn().mockResolvedValue({
      contents: "First Name,Last Name\r\nAvery,Vine\r\n",
      filename: "members.csv",
    }),
    generateShipmentLabels: vi.fn().mockResolvedValue({
      failed: 0,
      generated: 1,
      results: [],
    }),
    getMember: vi.fn().mockResolvedValue({ id: "member-id" }),
    getMemberPortalHistory: vi.fn().mockResolvedValue([]),
    getPickList: vi.fn().mockResolvedValue({ shipments: [] }),
    getRelease: vi.fn().mockResolvedValue({ id: "release-id" }),
    importMembers: vi.fn().mockResolvedValue({
      errors: [],
      importedCount: 1,
      skippedCount: 0,
    }),
    listClubTiers: vi.fn().mockResolvedValue([]),
    listMembers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    listRecoveryQueue: vi.fn().mockResolvedValue([]),
    listReleases: vi.fn().mockResolvedValue([]),
    listShipments: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    previewMemberImport: vi.fn().mockResolvedValue({
      columns: ["Customer Email"],
      rows: [{ "Customer Email": "member@example.com" }],
      source: "commerce7",
      suggestedMapping: { "Customer Email": "email" },
      uploadToken: "00000000-0000-4000-8000-000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      validation: { errors: [], invalidCount: 0, validCount: 1 },
    }),
    processRelease: vi.fn().mockResolvedValue({
      charged: 1,
      declined: 0,
      releaseId: "release-id",
      skipped: 0,
    }),
    refundShipment: vi.fn().mockResolvedValue({ status: "refunded" }),
    retryShipment: vi.fn().mockResolvedValue({ status: "charged" }),
    scheduleRelease: vi
      .fn()
      .mockResolvedValue({ id: "release-id", status: "scheduled" }),
    transitionMember: vi.fn().mockResolvedValue({ status: "paused" }),
    transitionShipment: vi.fn().mockResolvedValue({ status: "shipped" }),
    updateClubTier: vi.fn().mockResolvedValue({ id: "tier-id" }),
    updateMember: vi.fn().mockResolvedValue({ id: "member-id" }),
    updateMemberPortalAddress: vi.fn().mockResolvedValue({ id: "member-id" }),
    updateRelease: vi.fn().mockResolvedValue({ id: "release-id" }),
    validateShippingAddress: vi.fn().mockResolvedValue({
      address: {
        city: "Napa",
        country: "US",
        line1: "1 Wine Way",
        postalCode: "94558",
        state: "CA",
      },
      messages: [],
      valid: true,
    }),
    ...overrides,
  } as ApplicationService;
}

function testApp(
  foundation = service(),
  envOverrides: Partial<WorkerEnv> = {},
) {
  const createService: FoundationServiceFactory = () => foundation;
  const allowRateLimit: RateLimit = {
    limit: async () => ({ success: true }),
  };
  return createApp({
    createService,
    getEnv: () => ({
      ADMIN_RATE_LIMITER: allowRateLimit,
      ALLOWED_ORIGINS: "https://vinifera.test",
      API_RATE_LIMITER: allowRateLimit,
      APP_ENV: "test",
      APP_ORIGIN: "https://vinifera.test",
      AUTH_RATE_LIMITER: allowRateLimit,
      WEBHOOK_RATE_LIMITER: allowRateLimit,
      ...envOverrides,
    }),
  });
}

describe("Phase 1 API", () => {
  it("blocks non-owner staff from owner-only billing operations", () => {
    expect(() =>
      assertStaffRole(
        {
          ...staffPrincipal,
          user: { ...staffPrincipal.user, role: "staff" },
        },
        ["owner"],
      ),
    ).toThrowError(expect.objectContaining({ code: "forbidden", status: 403 }));
    expect(() => assertStaffRole(staffPrincipal, ["owner"])).not.toThrow();
  });

  it("restricts day-eight workspaces to subscription recovery", () => {
    expect(() => assertStaffWorkspaceAccess("active")).not.toThrow();
    expect(() => assertStaffWorkspaceAccess("grace")).not.toThrow();
    expect(() => assertStaffWorkspaceAccess("restricted")).toThrowError(
      expect.objectContaining({
        code: "forbidden",
        message: "This winery account is restricted to subscription recovery.",
        status: 403,
      }),
    );
    expect(() => assertStaffWorkspaceAccess("suspended")).toThrowError(
      expect.objectContaining({ code: "forbidden", status: 403 }),
    );
  });

  it("creates a role-scoped staff invitation through the protected API", async () => {
    const foundation = service();
    const response = await request(testApp(foundation))
      .post("/api/staff/invitations")
      .set("Origin", "https://vinifera.test")
      .send({ email: " INVITED@EXAMPLE.COM ", role: "manager" });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({
      expiresAt: "2026-07-27T00:00:00.000Z",
    });
    expect(foundation.createStaffInvitation).toHaveBeenCalledWith({
      email: "invited@example.com",
      role: "manager",
    });

    const invalidRole = await request(testApp(foundation))
      .post("/api/staff/invitations")
      .set("Origin", "https://vinifera.test")
      .send({ email: "owner@example.com", role: "owner" });
    expect(invalidRole.status).toBe(400);
    expect(foundation.createStaffInvitation).toHaveBeenCalledTimes(1);
  });

  it("reports provider activation without exposing secret values", async () => {
    const response = await request(
      testApp(service(), {
        STRIPE_SECRET_KEY: "sk_test_do-not-return",
        SUPABASE_SECRET_KEY: "sb_secret_do-not-return",
      }),
    ).get("/api/health/configuration");

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("sk_test_do-not-return");
    expect(response.text).not.toContain("sb_secret_do-not-return");
    expect(response.body.data.billing.configured).toBe(false);
    expect(response.body.data.database.configured).toBe(false);
  });

  it("returns canonical public branding while database activation is deferred", async () => {
    const response = await request(testApp()).get("/api/portal/branding");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      brand: null,
      mode: "canonical",
    });
  });

  it("rejects unsafe cross-origin state changes", async () => {
    const response = await request(testApp())
      .post("/api/auth/staff/login")
      .set("Origin", "https://attacker.example")
      .send({ email: "owner@example.com", password: "secret" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden");
  });

  it("accepts an explicit null sender address so a white-label sender can be cleared", async () => {
    const updateBrand = vi
      .fn()
      .mockResolvedValue({ id: "30000000-0000-4000-8000-000000000003" });
    const foundation = service({
      listIntegrations: vi.fn().mockResolvedValue([]),
      updateBrand,
    });
    const brandId = "30000000-0000-4000-8000-000000000003";
    const response = await request(testApp(foundation))
      .patch(`/api/brands/${brandId}`)
      .set("Origin", "https://vinifera.test")
      .send({
        emailSenderAddress: null,
        emailSenderName: "Vinifera Club",
      });

    expect(response.status).toBe(200);
    expect(updateBrand).toHaveBeenCalledWith(brandId, {
      emailSenderAddress: null,
      emailSenderName: "Vinifera Club",
    });
  });

  it("exposes the brand sender verification activation seam", async () => {
    const activateBrandSender = vi.fn().mockResolvedValue({
      dnsRecords: [],
      domain: "estate.example.com",
      status: "pending",
    });
    const foundation = service({
      activateBrandSender,
      listIntegrations: vi.fn().mockResolvedValue([]),
    });
    const brandId = "30000000-0000-4000-8000-000000000003";
    const response = await request(testApp(foundation))
      .post(`/api/brands/${brandId}/sender/verify`)
      .set("Origin", "https://vinifera.test");

    expect(response.status).toBe(202);
    expect(activateBrandSender).toHaveBeenCalledWith(brandId);
    expect(response.body.data).toMatchObject({
      domain: "estate.example.com",
      status: "pending",
    });
  });

  it("allows only the exact configured Capacitor origin", async () => {
    const foundation = service();
    const nativeEnv = {
      ALLOWED_ORIGINS:
        "https://vinifera.test,capacitor://localhost,https://localhost",
    };
    const accepted = await request(testApp(foundation, nativeEnv))
      .post("/api/auth/staff/login")
      .set("Origin", "capacitor://localhost")
      .send({ email: "owner@example.com", password: "correct horse" });
    const spoofed = await request(testApp(foundation, nativeEnv))
      .post("/api/auth/staff/login")
      .set("Origin", "capacitor://localhost.attacker.example")
      .send({ email: "owner@example.com", password: "correct horse" });

    expect(accepted.status).toBe(200);
    expect(spoofed.status).toBe(403);
  });

  it("validates staff signup fields before invoking providers", async () => {
    const foundation = service();
    const response = await request(testApp(foundation))
      .post("/api/auth/staff/signup")
      .set("Origin", "https://vinifera.test")
      .send({
        email: "not-an-email",
        organizationName: "",
        password: "weak",
        planTier: "unknown",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.fieldErrors.email).toBeTruthy();
    expect(response.body.error.fieldErrors.organizationName).toBeTruthy();
    expect(foundation.staffSignup).not.toHaveBeenCalled();
  });

  it("logs staff in through the cookie-backed service boundary", async () => {
    const foundation = service();
    const response = await request(testApp(foundation))
      .post("/api/auth/staff/login")
      .set("Origin", "https://vinifera.test")
      .send({ email: "OWNER@EXAMPLE.COM", password: "correct horse" });

    expect(response.status).toBe(200);
    expect(response.body.data.user.role).toBe("owner");
    expect(foundation.staffLogin).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "correct horse",
    });
  });

  it("supports session-backed password reset and invitation acceptance", async () => {
    const foundation = service();
    const reset = await request(testApp(foundation))
      .post("/api/auth/staff/reset-password")
      .set("Origin", "https://vinifera.test")
      .send({ password: "NewPassword1234" });
    const invite = await request(testApp(foundation))
      .post("/api/auth/staff/accept-invite")
      .set("Origin", "https://vinifera.test")
      .send({
        fullName: "Invited Manager",
        password: "InvitePassword1234",
      });

    expect(reset.status).toBe(200);
    expect(foundation.completeStaffPasswordReset).toHaveBeenCalledWith({
      password: "NewPassword1234",
    });
    expect(invite.status).toBe(200);
    expect(foundation.acceptStaffInvite).toHaveBeenCalledWith({
      fullName: "Invited Manager",
      password: "InvitePassword1234",
    });
  });

  it("keeps logout, password email, and Google OAuth routes connected", async () => {
    const foundation = service();
    const logout = await request(testApp(foundation))
      .post("/api/auth/staff/logout")
      .set("Origin", "https://vinifera.test");
    const forgot = await request(testApp(foundation))
      .post("/api/auth/staff/forgot-password")
      .set("Origin", "https://vinifera.test")
      .send({ email: "OWNER@EXAMPLE.COM" });
    const oauth = await request(testApp(foundation)).get("/api/auth/staff/google");

    expect(logout.status).toBe(204);
    expect(foundation.staffLogout).toHaveBeenCalledOnce();
    expect(forgot.status).toBe(200);
    expect(forgot.text).not.toContain("owner@example.com");
    expect(foundation.requestStaffPasswordReset).toHaveBeenCalledWith({
      email: "owner@example.com",
    });
    expect(oauth.status).toBe(303);
    expect(oauth.headers.location).toBe("https://accounts.google.test/oauth");
  });

  it("keeps member and staff session endpoints separate", async () => {
    const foundation = service({
      getMemberSession: vi.fn().mockResolvedValue({
        organization: {
          id: staffPrincipal.organization.id,
          name: staffPrincipal.organization.name,
        },
        user: {
          authUserId: "90000000-0000-4000-8000-000000000001",
          email: "member@example.com",
          firstName: "Avery",
          id: "30000000-0000-4000-8000-000000000001",
          lastName: "Vine",
          status: "active",
        },
      }),
    });
    const [staff, member] = await Promise.all([
      request(
        testApp(foundation, {
          SUPABASE_ANON_KEY: "sb_publishable_test",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
          SUPABASE_URL: "https://test.supabase.co",
        }),
      ).get("/api/auth/staff/session"),
      request(
        testApp(foundation, {
          SUPABASE_ANON_KEY: "sb_publishable_test",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
          SUPABASE_URL: "https://test.supabase.co",
        }),
      ).get("/api/auth/member/session"),
    ]);

    expect(staff.body.data.user.email).toBe("owner@example.com");
    expect(member.body.data.user.email).toBe("member@example.com");
    expect(member.body.data.user.authUserId).toBeUndefined();
    expect(member.body.data.user.role).toBeUndefined();
  });

  it("allows browser member authentication to bootstrap without existing credentials", async () => {
    const foundation = service();
    const productionEnv = {
      APP_ENV: "production" as const,
      SUPABASE_ANON_KEY: "sb_publishable_test",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
      SUPABASE_URL: "https://test.supabase.co",
    };
    const session = await request(testApp(foundation, productionEnv)).get(
      "/api/auth/member/session",
    );
    const magicLink = await request(testApp(foundation, productionEnv))
      .post("/api/auth/member/magic-link")
      .set("Origin", "https://vinifera.test")
      .send({ email: "MEMBER@EXAMPLE.COM" });

    expect(session.status).toBe(200);
    expect(magicLink.status).toBe(200);
    expect(foundation.requestMemberMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "member@example.com" }),
    );
  });

  it("rejects anonymous protected requests before they reach a service", async () => {
    const listMembers = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const response = await request(
      testApp(service({ listMembers }), { APP_ENV: "production" }),
    ).get("/api/members");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthorized");
    expect(listMembers).not.toHaveBeenCalled();
  });

  it("fails closed without noisy session errors when providers await activation", async () => {
    const response = await request(testApp()).get("/api/auth/staff/session");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      activated: false,
      authenticated: false,
    });
  });

  it("returns a privacy-safe magic-link response", async () => {
    const foundation = service();
    const response = await request(testApp(foundation))
      .post("/api/auth/member/magic-link")
      .set("Origin", "https://vinifera.test")
      .send({ email: "unknown@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.data.message).toContain("If this membership exists");
    expect(response.text).not.toContain("unknown@example.com");
  });

  it("trusts edge client addresses only in deployed environments", async () => {
    const requestMemberMagicLink = vi.fn().mockResolvedValue(undefined);
    const foundation = service({ requestMemberMagicLink });
    const submit = (appEnvironment: WorkerEnv["APP_ENV"], address: string) =>
      request(testApp(foundation, { APP_ENV: appEnvironment }))
        .post("/api/auth/member/magic-link")
        .set("CF-Connecting-IP", address)
        .set(
          "X-Forwarded-For",
          `198.51.100.${address.endsWith("10") ? "10" : "11"}`,
        )
        .set("Origin", "https://vinifera.test")
        .send({ email: "member@example.com" });

    await submit("development", "192.0.2.10").expect(200);
    await submit("test", "192.0.2.11").expect(200);
    await submit("staging", "192.0.2.12").expect(200);
    await submit("production", "192.0.2.13").expect(200);

    const addresses = requestMemberMagicLink.mock.calls.map(
      ([input]) => input.ipAddress,
    );
    const normalizeLoopback = (address: string) =>
      address === "::1" ? "127.0.0.1" : address.replace(/^::ffff:/, "");
    expect(addresses.slice(0, 2).map(normalizeLoopback)).toEqual([
      "127.0.0.1",
      "127.0.0.1",
    ]);
    expect(addresses[2]).toBe("192.0.2.12");
    expect(addresses[3]).toBe("192.0.2.13");
  });

  it("requires and forwards signed state on the member auth callback", async () => {
    const exchangeAuthCode = vi
      .fn()
      .mockResolvedValue({ destination: "/portal" });
    const foundation = service({ exchangeAuthCode });
    const state = "signed-member-link-state-value".repeat(2);
    const response = await request(testApp(foundation))
      .get("/api/auth/member/callback")
      .query({ code: "pkce-code", state });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/portal");
    expect(exchangeAuthCode).toHaveBeenCalledWith(
      "member",
      "pkce-code",
      state,
    );

    const missingState = await request(testApp(foundation))
      .get("/api/auth/member/callback")
      .query({ code: "pkce-code" });
    expect(missingState.status).toBe(400);
    expect(exchangeAuthCode).toHaveBeenCalledTimes(1);
  });

  it("rejects authority-style staff callback redirects", async () => {
    const exchangeAuthCode = vi.fn().mockResolvedValue({ destination: "/app" });
    const foundation = service({ exchangeAuthCode });

    for (const next of [
      null,
      "//attacker.example",
      "/\\attacker.example",
      "/\u0000/attacker.example",
      "/\r/attacker.example",
      "/\n/attacker.example",
      "/\t/attacker.example",
    ]) {
      const response = await request(testApp(foundation))
        .get("/api/auth/staff/callback")
        .query({ code: "pkce-code", next });

      expect(response.status).toBe(303);
      expect(response.headers.location).toBe("/app");
    }
  });

  it("preserves the raw Stripe body for signature verification", async () => {
    const handleStripeWebhook = vi.fn().mockResolvedValue({ duplicate: false });
    const foundation = service({ handleStripeWebhook });
    const payload = JSON.stringify({ id: "evt_test", type: "invoice.payment_failed" });
    const response = await request(testApp(foundation))
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=test")
      .send(payload);

    expect(response.status).toBe(200);
    expect(Buffer.isBuffer(handleStripeWebhook.mock.calls[0]?.[0])).toBe(true);
    expect(handleStripeWebhook.mock.calls[0]?.[0].toString()).toBe(payload);
  });

  it("rejects non-JSON webhook bodies before provider dispatch", async () => {
    const handleStripeWebhook = vi.fn();
    const handleKlaviyoWebhook = vi.fn();
    const handleResendWebhook = vi.fn();
    const foundation = service({
      handleKlaviyoWebhook,
      handleResendWebhook,
      handleStripeWebhook,
      listEmailTemplates: vi.fn().mockResolvedValue([]),
      listIntegrations: vi.fn().mockResolvedValue([]),
    });

    await request(testApp(foundation))
      .post("/api/billing/webhook")
      .set("Content-Type", "text/plain")
      .set("stripe-signature", "t=1,v1=test")
      .send("not-json")
      .expect(400);
    await request(testApp(foundation))
      .post(
        "/api/webhooks/klaviyo/30000000-0000-4000-8000-000000000001",
      )
      .set("Content-Type", "text/plain")
      .send("not-json")
      .expect(400);
    await request(testApp(foundation))
      .post("/api/webhooks/resend")
      .set("Content-Type", "text/plain")
      .set("svix-id", "msg_123")
      .set("svix-signature", "v1,test")
      .set("svix-timestamp", "1785042000")
      .send("not-json")
      .expect(400);

    expect(handleStripeWebhook).not.toHaveBeenCalled();
    expect(handleKlaviyoWebhook).not.toHaveBeenCalled();
    expect(handleResendWebhook).not.toHaveBeenCalled();
  });

  it("uses the stable error envelope for provider activation gates", async () => {
    const foundation = service({
      createBillingCheckout: vi
        .fn()
        .mockRejectedValue(
          new AppError(
            503,
            "activation_required",
            "STRIPE_PRICE_VINE must be connected before this operation can run.",
          ),
        ),
    });
    const response = await request(testApp(foundation))
      .post("/api/billing/checkout")
      .set("Origin", "https://vinifera.test")
      .send({
        attemptId: "80000000-0000-4000-8000-000000000001",
        planTier: "vine",
      });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("activation_required");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("rejects malformed caller billing attempt identifiers before service invocation", async () => {
    const foundation = service();
    const response = await request(testApp(foundation))
      .post("/api/billing/checkout")
      .set("Origin", "https://vinifera.test")
      .send({ attemptId: "owner@example.com", planTier: "vine" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
    expect(foundation.createBillingCheckout).not.toHaveBeenCalled();
  });
});

describe("Phase 3 member retention fields", () => {
  it("accepts birthday and same-tenant referral identifiers through member CRUD", async () => {
    const commandId = "81000000-0000-4000-8000-000000000001";
    const createMember = vi.fn().mockResolvedValue({
      id: "30000000-0000-4000-8000-000000000009",
    });
    const foundation = service({ createMember });
    const response = await request(testApp(foundation))
      .post("/api/members")
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send({
        birthday: "1990-07-26",
        email: "new-member@example.com",
        firstName: "New",
        lastName: "Member",
        referredByMemberId: "30000000-0000-4000-8000-000000000001",
      });

    expect(response.status).toBe(201);
    expect(createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        birthday: "1990-07-26",
        referredByMemberId: "30000000-0000-4000-8000-000000000001",
      }),
      commandId,
    );
  });
});

describe("Phase 2 core club API", () => {
  it("normalizes the member UI contract before invoking the tenant service", async () => {
    const commandId = "81000000-0000-4000-8000-000000000002";
    const createMember = vi.fn().mockResolvedValue({ id: "member-id" });
    const foundation = service({ createMember });
    const response = await request(testApp(foundation))
      .post("/api/members")
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send({
        address: {
          city: "Napa",
          country: "US",
          line1: "1 Wine Way",
          postalCode: "94558",
          state: "CA",
        },
        email: "MEMBER@EXAMPLE.COM",
        firstName: "Avery",
        lastName: "Vine",
        status: "active",
        tierId: "30000000-0000-4000-8000-000000000001",
      });

    expect(response.status).toBe(201);
    expect(createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        clubTierId: "30000000-0000-4000-8000-000000000001",
        email: "member@example.com",
        shippingAddress: expect.objectContaining({ postalCode: "94558" }),
      }),
      commandId,
    );
  });

  it("preserves explicit null member aliases in create and partial update inputs", async () => {
    const commandId = "81000000-0000-4000-8000-000000000002";
    const memberId = "30000000-0000-4000-8000-000000000001";
    const createMember = vi.fn().mockResolvedValue({ id: memberId });
    const updateMember = vi.fn().mockResolvedValue({ id: memberId });
    const foundation = service({ createMember, updateMember });
    const aliasValues = {
      address: {
        city: "Napa",
        country: "US",
        line1: "1 Wine Way",
        postalCode: "94558",
        state: "CA",
      },
      clubTierId: null,
      shippingAddress: null,
      tierId: "30000000-0000-4000-8000-000000000002",
    };

    await request(testApp(foundation))
      .post("/api/members")
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send({
        ...aliasValues,
        email: "member@example.com",
        firstName: "Avery",
        lastName: "Vine",
      })
      .expect(201);
    await request(testApp(foundation))
      .patch(`/api/members/${memberId}`)
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send(aliasValues)
      .expect(200);

    expect(createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        clubTierId: null,
        shippingAddress: null,
      }),
      commandId,
    );
    expect(updateMember).toHaveBeenCalledWith(
      memberId,
      {
        clubTierId: null,
        shippingAddress: null,
      },
      commandId,
    );
  });

  it("creates a scheduled release atomically from the fixed frontend payload", async () => {
    const commandId = "81000000-0000-4000-8000-000000000003";
    const createRelease = vi
      .fn()
      .mockResolvedValue({ id: "40000000-0000-4000-8000-000000000001" });
    const foundation = service({ createRelease });
    const response = await request(testApp(foundation))
      .post("/api/releases")
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send({
        description: "Fall allocation",
        embargoDate: "2026-09-01",
        name: "Fall 2026",
        processingDate: "2026-09-15",
        status: "scheduled",
        tiers: [
          {
            priceCents: 12500,
            tierId: "30000000-0000-4000-8000-000000000001",
          },
        ],
        wines: [{ name: "Estate Cabernet", quantity: 2 }],
      });

    expect(response.status).toBe(201);
    expect(createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        tierIds: ["30000000-0000-4000-8000-000000000001"],
        tierPrices: [
          {
            priceCents: 12500,
            tierId: "30000000-0000-4000-8000-000000000001",
          },
        ],
        wines: [
          { priceCents: 0, quantity: 2, wineName: "Estate Cabernet" },
        ],
      }),
      commandId,
      "scheduled",
    );
  });

  it("rejects inconsistent tiers and unnamed wines before release creation", async () => {
    const commandId = "81000000-0000-4000-8000-000000000003";
    const createRelease = vi.fn();
    const updateRelease = vi.fn();
    const foundation = service({ createRelease, updateRelease });
    const release = {
      embargoDate: "2026-09-01",
      name: "Fall 2026",
      processingDate: "2026-09-15",
      tierIds: ["30000000-0000-4000-8000-000000000001"],
      tiers: [
        {
          priceCents: 12500,
          tierId: "30000000-0000-4000-8000-000000000002",
        },
      ],
      wines: [{ name: "Estate Cabernet", quantity: 2 }],
    };

    await request(testApp(foundation))
      .post("/api/releases")
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send(release)
      .expect(400);
    await request(testApp(foundation))
      .post("/api/releases")
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send({
        ...release,
        tierIds: ["30000000-0000-4000-8000-000000000002"],
        wines: [{ quantity: 2 }],
      })
      .expect(400);
    await request(testApp(foundation))
      .patch("/api/releases/40000000-0000-4000-8000-000000000001")
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send(release)
      .expect(400);

    expect(createRelease).not.toHaveBeenCalled();
    expect(updateRelease).not.toHaveBeenCalled();
  });

  it("passes only supplied fields to release updates", async () => {
    const commandId = "81000000-0000-4000-8000-000000000003";
    const releaseId = "40000000-0000-4000-8000-000000000001";
    const updateRelease = vi.fn().mockResolvedValue({ id: releaseId });
    const foundation = service({ updateRelease });

    await request(testApp(foundation))
      .patch(`/api/releases/${releaseId}`)
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send({ name: "Renamed release" })
      .expect(200);

    expect(updateRelease).toHaveBeenCalledWith(
      releaseId,
      { name: "Renamed release" },
      commandId,
    );
  });

  it("schedules an existing draft through the transactional command route", async () => {
    const releaseId = "40000000-0000-4000-8000-000000000002";
    const commandId = "81000000-0000-4000-8000-000000000004";
    const scheduleRelease = vi
      .fn()
      .mockResolvedValue({ id: releaseId, status: "scheduled" });
    const response = await request(
      testApp(service({ scheduleRelease })),
    )
      .post(`/api/releases/${releaseId}/schedule`)
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send({ confirmed: true });

    expect(response.status).toBe(200);
    expect(scheduleRelease).toHaveBeenCalledWith(releaseId, commandId);
  });

  it("rejects a transactional command without a UUID idempotency key", async () => {
    const createMember = vi.fn();
    const response = await request(testApp(service({ createMember })))
      .post("/api/members")
      .set("Origin", "https://vinifera.test")
      .send({
        email: "missing-key@example.com",
        firstName: "Missing",
        lastName: "Key",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
    expect(createMember).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation before a release billing run", async () => {
    const processRelease = vi.fn();
    const foundation = service({ processRelease });
    const response = await request(testApp(foundation))
      .post(
        "/api/releases/40000000-0000-4000-8000-000000000001/process",
      )
      .set("Origin", "https://vinifera.test")
      .send({ confirmed: false });

    expect(response.status).toBe(400);
    expect(processRelease).not.toHaveBeenCalled();
  });

  it("accepts canonical Commerce7 multipart CSV previews", async () => {
    const previewMemberImport = vi
      .fn()
      .mockResolvedValue({
        columns: ["Customer First Name", "Customer Email"],
        rows: [],
        source: "commerce7",
        suggestedMapping: {},
        uploadToken:
          "00000000-0000-4000-8000-000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        validation: { errors: [], invalidCount: 0, validCount: 1 },
      });
    const foundation = service({ previewMemberImport });
    const response = await request(testApp(foundation))
      .post("/api/members/import/preview")
      .set("Origin", "https://vinifera.test")
      .field("source", "commerce7")
      .attach(
        "file",
        Buffer.from(
          "Customer First Name,Customer Last Name,Customer Email\nAvery,Vine,avery@example.com\n",
        ),
        { contentType: "text/csv", filename: "commerce7.csv" },
      );

    expect(response.status).toBe(201);
    expect(previewMemberImport).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.stringContaining("Customer First Name"),
        filename: "commerce7.csv",
        format: "commerce7",
      }),
    );
  });

  it("keeps delimiter-like CSV bytes and rejects malformed multipart framing", async () => {
    const previewMemberImport = vi.fn().mockResolvedValue({
      columns: ["Customer Email", "Note"],
      rows: [],
      source: "commerce7",
      suggestedMapping: {},
      uploadToken:
        "00000000-0000-4000-8000-000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      validation: { errors: [], invalidCount: 0, validCount: 1 },
    });
    const boundary = "ViniferaBoundary";
    const csv =
      `Customer Email,Note\r\navery@example.com,before--${boundary}after\r\n`;
    const body = Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="source"\r\n\r\n' +
        `commerce7\r\n--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="commerce7.csv"\r\n' +
        "Content-Type: text/csv\r\n\r\n" +
        `${csv}\r\n--${boundary}--\r\n`,
    );
    const foundation = service({ previewMemberImport });

    await request(testApp(foundation))
      .post("/api/members/import/preview")
      .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
      .set("Origin", "https://vinifera.test")
      .send(body)
      .expect(201);
    expect(previewMemberImport).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.stringContaining(`before--${boundary}after`),
      }),
    );

    const malformed = Buffer.from(
      `--${boundary}\nContent-Disposition: form-data; name="source"\r\n\r\ncommerce7`,
    );
    await request(testApp(foundation))
      .post("/api/members/import/preview")
      .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
      .set("Origin", "https://vinifera.test")
      .send(malformed)
      .expect(400);

    const malformedClosing = Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="source"\r\n\r\n' +
        `commerce7\r\n--${boundary}--junk`,
    );
    await request(testApp(foundation))
      .post("/api/members/import/preview")
      .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
      .set("Origin", "https://vinifera.test")
      .send(malformedClosing)
      .expect(400);

    expect(previewMemberImport).toHaveBeenCalledTimes(1);
  });

  it("reports shipping activation names without exposing credential values", async () => {
    const response = await request(
      testApp(service(), {
        APP_ENV: "production",
        EASYPOST_API_KEY: "EZAK_secret-do-not-return",
        SHIPPING_PROVIDER: "simulated",
        SHIPPING_SIMULATOR_ENABLED: "true",
      }),
    ).get("/api/health/configuration");

    expect(response.status).toBe(200);
    expect(response.text).not.toContain("EZAK_secret-do-not-return");
    expect(response.body.data.shipping.configured).toBe(false);
    expect(response.body.data.shipping.missing).toContain("APP_ENV");
  });

  it("returns 401 when anonymous callers request provider-backed address validation", async () => {
    const validateShippingAddress = vi.fn().mockRejectedValue(
      new AppError(401, "unauthorized", "A valid sign-in is required."),
    );
    const response = await request(
      testApp(service({ validateShippingAddress })),
    )
      .post("/api/shipping/validate-address")
      .set("Origin", "https://vinifera.test")
      .send({
        city: "Napa",
        country: "US",
        line1: "1 Wine Way",
        postalCode: "94558",
        state: "CA",
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthorized");
    expect(validateShippingAddress).toHaveBeenCalledOnce();
  });

  it("returns member exports as a downloadable CSV instead of a JSON envelope", async () => {
    const response = await request(testApp())
      .get("/api/members/export")
      .set("Accept", "text/csv");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain("members.csv");
    expect(response.text).toContain("Avery,Vine");
  });

  it("requires an explicit all-roster scope when batch ids are omitted", async () => {
    const commandId = "81000000-0000-4000-8000-000000000004";
    const batchMembers = vi.fn().mockResolvedValue({ updated: 10 });
    const foundation = service({ batchMembers });
    const rejected = await request(testApp(foundation))
      .post("/api/members/batch")
      .set("Origin", "https://vinifera.test")
      .send({ action: "pause" });
    const accepted = await request(testApp(foundation))
      .post("/api/members/batch")
      .set("Idempotency-Key", commandId)
      .set("Origin", "https://vinifera.test")
      .send({ action: "pause", scope: "all" });

    expect(rejected.status).toBe(400);
    expect(accepted.status).toBe(200);
    expect(batchMembers).toHaveBeenCalledWith({
      ids: undefined,
      operation: "pause",
      tierId: undefined,
    }, commandId);
  });

  it("maps shipment roster search to the service search contract", async () => {
    const listShipments = vi
      .fn()
      .mockResolvedValue({ items: [], total: 0 });
    const response = await request(testApp(service({ listShipments }))).get(
      "/api/shipments?query=avery&status=declined",
    );

    expect(response.status).toBe(200);
    expect(listShipments).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "avery",
        status: "declined",
      }),
    );
  });
});
