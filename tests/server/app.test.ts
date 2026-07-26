import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../server/app";
import { assertStaffRole } from "../../server/lib/authorization";
import { AppError } from "../../server/lib/errors";
import type {
  FoundationService,
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

function service(overrides: Partial<FoundationService> = {}): FoundationService {
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
      principal: staffPrincipal,
    }),
    ...overrides,
  };
}

function testApp(
  foundation = service(),
  envOverrides: Partial<WorkerEnv> = {},
) {
  const createService: FoundationServiceFactory = () => foundation;
  return createApp({
    createService,
    getEnv: () => ({
      ALLOWED_ORIGINS: "https://vinifera.test",
      APP_ENV: "test",
      APP_ORIGIN: "https://vinifera.test",
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

  it("rejects unsafe cross-origin state changes", async () => {
    const response = await request(testApp())
      .post("/api/auth/staff/login")
      .set("Origin", "https://attacker.example")
      .send({ email: "owner@example.com", password: "secret" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden");
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

  it("keeps member and staff session endpoints separate", async () => {
    const foundation = service({
      getMemberSession: vi.fn().mockResolvedValue({
        organization: {
          id: staffPrincipal.organization.id,
          name: staffPrincipal.organization.name,
        },
        user: {
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
    expect(member.body.data.user.role).toBeUndefined();
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
      .send({ planTier: "vine" });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("activation_required");
    expect(response.body.error.requestId).toBeTruthy();
  });
});
