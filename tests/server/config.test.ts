import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  assertAvalaraBaseUrlEnvironment,
  assertProviderEnvironment,
  assertStripeBillingAuthority,
  canProvisionStripeCustomer,
  getConfigurationReport,
  getRuntimeConfigurationReport,
  stripeCredentialMode,
  usesSecureCookies,
  type ProtectedProvider,
} from "../../server/config";
import { securitySecretTestFixture } from "../fixtures/security-secrets";
import { encryptIntegrationCredentials } from "../../server/integrations/security";

describe("hosted environment security boundaries", () => {
  it("reports only a SHA-256 binding for the runtime Supabase origin", async () => {
    const report = await getRuntimeConfigurationReport({
      SUPABASE_URL: "https://project-ref.supabase.co/path?ignored=true",
    });
    expect(report.database.bindingHashes).toEqual({
      supabaseUrlSha256:
        "9dcce8c56abe928a625bf27c35eb9407f96c853744564d92b4b3c5e650c062b5",
    });
    expect(JSON.stringify(report)).not.toContain("project-ref.supabase.co");
  });
  it("reports only key-version set and active-version bindings for the runtime keyring", async () => {
    const environment = {
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "key-2026-07",
      INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        "key-2026-06": Buffer.alloc(32, 1).toString("base64"),
        "key-2026-07": Buffer.alloc(32, 2).toString("base64"),
      }),
    };
    const proofs = await Promise.all(
      ["avalara", "klaviyo", "meta", "quickbooks"].map(
        async (integrationType, index) => {
          const targetId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
          return {
            brandId: "00000000-0000-4000-8000-000000000098",
            integrationType,
            organizationId: "00000000-0000-4000-8000-000000000099",
            targetId,
            envelope: await encryptIntegrationCredentials(
              environment,
              {
                integrationType,
                organizationId: "00000000-0000-4000-8000-000000000099",
                targetId,
              },
              { token: "proof" },
            ),
          };
        },
      ),
    );
    const report = await getRuntimeConfigurationReport({
      ...environment,
      INTEGRATION_CREDENTIAL_ACCEPTANCE_PROOFS: JSON.stringify(proofs),
    });
    expect(report.integrationEncryption.bindingHashes).toEqual({
      acceptedConnectionIdsSha256:
        "66b10ee832884325130488d8ce667e59deaac41f27a1b4c0986a8ab2698cc296",
      acceptedEnvelopeScopeSha256: createHash("sha256")
        .update(
          JSON.stringify(
            proofs
              .map((proof) => ({
                brandId: proof.brandId,
                ciphertextSha256: createHash("sha256")
                  .update(proof.envelope.ciphertext)
                  .digest("hex"),
                integrationType: proof.integrationType,
                ivSha256: createHash("sha256")
                  .update(proof.envelope.iv)
                  .digest("hex"),
                keyIdSha256: createHash("sha256")
                  .update(proof.envelope.keyVersion)
                  .digest("hex"),
                organizationId: proof.organizationId,
                targetId: proof.targetId,
              }))
              .sort((left, right) =>
                left.integrationType.localeCompare(right.integrationType),
              ),
          ),
        )
        .digest("hex"),
      activeVersionSha256:
        "f0fcbf45b0b7cf33ff3f80c8b73985b37512c61233a7bff26270d37bd20179db",
      keyringVersionsSha256:
        "496c9e07951ec840998c847141323442cff0224522265661d4c757570e6285b9",
    });
    expect(JSON.stringify(report)).not.toContain(
      Buffer.alloc(32, 2).toString("base64"),
    );
    expect(JSON.stringify(report)).not.toContain("key-2026-07");
  });
  it("withholds runtime keyring evidence for malformed material or undecryptable proofs", async () => {
    const malformed = await getRuntimeConfigurationReport({
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION: "key-2026-07",
      INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS: JSON.stringify({
        "key-2026-07": "wrong-length",
      }),
      INTEGRATION_CREDENTIAL_ACCEPTANCE_PROOFS: "[]",
    });
    expect(malformed.integrationEncryption.bindingHashes).toBeUndefined();
  });
  it("uses secure cookies for staging and production only", () => {
    expect(usesSecureCookies({ APP_ENV: "development" })).toBe(false);
    expect(usesSecureCookies({ APP_ENV: "test" })).toBe(false);
    expect(usesSecureCookies({ APP_ENV: "staging" })).toBe(true);
    expect(usesSecureCookies({ APP_ENV: "production" })).toBe(true);
  });

  it("rejects every protected provider production mode outside production", () => {
    const providers: ProtectedProvider[] = [
      "APNs",
      "Avalara",
      "QuickBooks",
      "Stripe",
    ];
    for (const provider of providers) {
      expect(() =>
        assertProviderEnvironment(
          { APP_ENV: "staging" },
          provider,
          "production",
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "activation_required",
          status: 503,
        }),
      );
      expect(() =>
        assertProviderEnvironment(
          { APP_ENV: "production" },
          provider,
          "production",
        ),
      ).not.toThrow();
    }
  });

  it("allows Stripe test mode but rejects live mode in staging", () => {
    expect(
      stripeCredentialMode({
        APP_ENV: "staging",
        STRIPE_SECRET_KEY: "sk_test_runtime_boundary",
      }),
    ).toBe("test");
    expect(() =>
      stripeCredentialMode({
        APP_ENV: "staging",
        STRIPE_SECRET_KEY: "sk_live_runtime_boundary",
      }),
    ).toThrowError(expect.objectContaining({ code: "activation_required" }));
  });

  it("requires explicit authority for live billing while leaving test billing usable", () => {
    expect(() =>
      assertStripeBillingAuthority({
        APP_ENV: "staging",
        STRIPE_SECRET_KEY: "sk_test_runtime_boundary",
      }),
    ).not.toThrow();
    expect(() =>
      assertStripeBillingAuthority({
        APP_ENV: "production",
        STRIPE_SECRET_KEY: "sk_live_runtime_boundary",
      }),
    ).toThrowError(expect.objectContaining({ code: "activation_required" }));
    expect(() =>
      assertStripeBillingAuthority({
        APP_ENV: "production",
        LIVE_BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_live_runtime_boundary",
      }),
    ).not.toThrow();
  });

  it("enables signup Customer provisioning only for an authorized Stripe key", () => {
    expect(canProvisionStripeCustomer({ APP_ENV: "staging" })).toBe(false);
    expect(
      canProvisionStripeCustomer({
        APP_ENV: "staging",
        STRIPE_SECRET_KEY: "sk_test_runtime_boundary",
      }),
    ).toBe(true);
    expect(
      canProvisionStripeCustomer({
        APP_ENV: "staging",
        STRIPE_SECRET_KEY: "sk_live_runtime_boundary",
      }),
    ).toBe(false);
    expect(
      canProvisionStripeCustomer({
        APP_ENV: "production",
        LIVE_BILLING_ENABLED: "true",
        STRIPE_SECRET_KEY: "sk_live_runtime_boundary",
      }),
    ).toBe(true);
  });

  it("reports the live billing switch as missing until explicitly enabled", () => {
    const report = getConfigurationReport({
      ALLOWED_ORIGINS: "https://vinifera.example",
      APP_ENV: "production",
      APP_ORIGIN: "https://vinifera.example",
      STRIPE_PRICE_CELLAR: "price_cellar",
      STRIPE_PRICE_ESTATE: "price_estate",
      STRIPE_PRICE_RESERVE: "price_reserve",
      STRIPE_PRICE_VINE: "price_vine",
      STRIPE_SECRET_KEY: "sk_live_runtime_boundary",
    });

    expect(report.billing).toEqual({
      configured: false,
      missing: ["LIVE_BILLING_ENABLED"],
    });
  });

  it("reports only independently configured security secrets as ready", () => {
    const secret = "test-reused-security-secret-9a58cbec-cd8d";
    const missing = getConfigurationReport({});
    const reused = getConfigurationReport({
      MEMBER_BRAND_CONTEXT_SECRET: secret,
      RATE_LIMIT_PEPPER: secret,
    });
    const configured = getConfigurationReport(securitySecretTestFixture());

    expect(missing.security).toEqual({
      configured: false,
      missing: ["RATE_LIMIT_PEPPER", "MEMBER_BRAND_CONTEXT_SECRET"],
    });
    expect(reused.security).toEqual({
      configured: false,
      missing: ["RATE_LIMIT_PEPPER", "MEMBER_BRAND_CONTEXT_SECRET"],
    });
    expect(configured.security).toEqual({
      configured: true,
      missing: [],
    });
  });

  it("treats the vendor-approved ShipCompliant token path as required configuration", () => {
    const report = getConfigurationReport({
      COMPLIANCE_PROVIDER: "shipcompliant",
    });

    expect(report.compliance.configured).toBe(false);
    expect(report.compliance.missing).toContain("SHIPCOMPLIANT_TOKEN_PATH");
  });

  it("allows Avalara sandbox but rejects its production endpoint in staging", () => {
    expect(() =>
      assertAvalaraBaseUrlEnvironment(
        { APP_ENV: "staging" },
        "https://sandbox-rest.avatax.com",
      ),
    ).not.toThrow();
    expect(() =>
      assertAvalaraBaseUrlEnvironment(
        { APP_ENV: "staging" },
        "https://rest.avatax.com",
      ),
    ).toThrowError(expect.objectContaining({ code: "activation_required" }));
  });
});
