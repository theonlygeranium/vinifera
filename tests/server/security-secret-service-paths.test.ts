import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { WorkerEnv } from "../../server/types";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    rpc: vi.fn(),
  })),
}));

import { ProductionFoundationService } from "../../server/services/production-foundation";
import { ProductionIntegrationService } from "../../server/services/webhooks";

const request = {
  get: vi.fn(),
  protocol: "https",
} as unknown as Request;
const response = {} as Response;
const providerCredentialOnly: WorkerEnv = {
  AUTH_EMAIL_ENABLED: "true",
  MOBILE_AUTH_EMAIL_TEMPLATE_ENABLED: "true",
  SUPABASE_SECRET_KEY: "provider-secret-must-not-be-used-for-app-security",
  SUPABASE_URL: "https://example.supabase.co",
};

describe("production security-secret call sites", () => {
  it("rejects member magic-link rate hashing before a provider credential fallback", async () => {
    const service = new ProductionFoundationService(
      providerCredentialOnly,
      request,
      response,
    );

    await expect(
      service.requestMemberMagicLink({
        email: "member@example.test",
        ipAddress: "192.0.2.10",
      }),
    ).rejects.toMatchObject({
      code: "configuration_error",
      status: 503,
    });
  });

  it("rejects mobile magic-link rate hashing before a provider credential fallback", async () => {
    const service = new ProductionIntegrationService(
      providerCredentialOnly,
      request,
      response,
    );

    await expect(
      service.requestMobileMagicLink({
        deviceFingerprint: "test-device-fingerprint",
        email: "member@example.test",
        ipAddress: "192.0.2.11",
        redirectUri: "vinifera.ai://portal/auth",
      }),
    ).rejects.toMatchObject({
      code: "configuration_error",
      status: 503,
    });
  });
});
