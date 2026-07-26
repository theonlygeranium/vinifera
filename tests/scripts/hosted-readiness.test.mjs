import { describe, expect, it, vi } from "vitest";
import {
  renderReadinessMarkdown,
  resolveCredentialState,
  runHostedReadinessProbe,
} from "../../scripts/hosted-readiness.mjs";

const fixedNow = () => new Date("2026-07-26T12:00:00.000Z");

function stagingEnvironment(overrides = {}) {
  return {
    STAGING_CLOUDFLARE_ACCOUNT_ID: "cloudflare-account-sensitive",
    STAGING_CLOUDFLARE_API_TOKEN: "cloudflare-token-sensitive",
    STAGING_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    STAGING_SUPABASE_PUBLISHABLE_KEY: "publishable-sensitive",
    STAGING_SUPABASE_SECRET_KEY: "sb_secret_sensitive",
    STAGING_STRIPE_SECRET_KEY: "sk_test_sensitive",
    STAGING_STRIPE_PRICE_VINE: "price_vine_sensitive",
    STAGING_STRIPE_PRICE_CELLAR: "price_cellar_sensitive",
    STAGING_STRIPE_PRICE_ESTATE: "price_estate_sensitive",
    STAGING_STRIPE_PRICE_RESERVE: "price_reserve_sensitive",
    STAGING_STRIPE_WEBHOOK_SECRET: "whsec_sensitive",
    ...overrides,
  };
}

function response({
  ok = true,
  payload = null,
  bodyContents = "provider-body-sensitive",
} = {}) {
  return {
    ok,
    body: {
      cancel: vi.fn(async () => undefined),
    },
    json: vi.fn(async () => payload),
    text: vi.fn(async () => bodyContents),
  };
}

describe("hosted readiness probe", () => {
  it("uses only read-only requests and emits a credential-free report", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/user/tokens/verify")) {
        return response({
          payload: {
            success: true,
            result: {
              id: "cloudflare-token-id-sensitive",
              status: "active",
            },
          },
        });
      }
      return response();
    });

    const report = await runHostedReadinessProbe({
      env: stagingEnvironment(),
      fetchImpl,
      now: fixedNow,
      timeoutMs: 100,
    });

    expect(report.safeNextGate).toBe(
      "ready_for_guarded_staging_activation",
    );
    expect(report.credentials.sourceClassification.overall).toBe("staging");
    expect(report.probes.cloudflare).toEqual({
      credentialsComplete: true,
      tokenValid: true,
      workersReadCapable: true,
    });
    expect(report.probes.supabase).toEqual({
      credentialsComplete: true,
      authReachable: true,
      phase1TableExists: true,
      phase5TableExists: true,
    });
    expect(report.probes.stripe).toMatchObject({
      credentialPresent: true,
      secretMode: "test",
      apiProbeAttempted: true,
      apiReachable: true,
      requiredNamesComplete: true,
    });
    expect(calls).toHaveLength(6);
    expect(calls.every(({ init }) => init.method === "GET")).toBe(true);
    expect(
      calls
        .filter(({ url }) => url.includes("/rest/v1/"))
        .every(({ url }) => new URL(url).searchParams.get("limit") === "0"),
    ).toBe(true);

    const serialized = `${JSON.stringify(report)}\n${renderReadinessMarkdown(report)}`;
    for (const sensitiveFragment of [
      "https://",
      "cloudflare-account-sensitive",
      "cloudflare-token-sensitive",
      "cloudflare-token-id-sensitive",
      "abcdefghijklmnopqrst",
      "publishable-sensitive",
      "sb_secret_sensitive",
      "sk_test_sensitive",
      "price_vine_sensitive",
      "whsec_sensitive",
      "provider-body-sensitive",
    ]) {
      expect(serialized).not.toContain(sensitiveFragment);
    }
    expect(
      calls
        .filter(({ url }) => url.includes("/rest/v1/"))
        .every(({ init }) => !Object.hasOwn(init.headers, "Authorization")),
    ).toBe(true);
  });

  it("never calls Stripe when a live key is configured", async () => {
    const fetchImpl = vi.fn();
    const report = await runHostedReadinessProbe({
      env: {
        STAGING_STRIPE_SECRET_KEY: "sk_live_sensitive",
      },
      fetchImpl,
      now: fixedNow,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report.probes.stripe).toMatchObject({
      secretMode: "live",
      apiProbeAttempted: false,
      apiReachable: false,
    });
    expect(report.safeNextGate).toBe(
      "replace_live_stripe_key_with_test_key",
    );
    expect(JSON.stringify(report)).not.toContain("sk_live_sensitive");
  });

  it("classifies generic fallback and detects every missing staging name", () => {
    const state = resolveCredentialState({
      GENERIC_CLOUDFLARE_ACCOUNT_ID: "generic-account-sensitive",
      GENERIC_CLOUDFLARE_API_TOKEN: "generic-token-sensitive",
      STAGING_STRIPE_SECRET_KEY: "sk_test_sensitive",
    });

    expect(state.sourceClassification.providers.cloudflare).toBe("generic");
    expect(state.sourceClassification.providers.supabase).toBe("missing");
    expect(state.sourceClassification.providers.stripe).toBe("partial");
    expect(state.missingNames).toContain("STRIPE_PRICE_VINE");
    expect(state.missingNames).toContain("STRIPE_WEBHOOK_SECRET");
    expect(state.missingStagingNames).toContain(
      "STAGING_CLOUDFLARE_ACCOUNT_ID",
    );
    expect(JSON.stringify(state.availability)).not.toContain(
      "generic-account-sensitive",
    );
  });

  it("does not retain provider bodies or thrown request details", async () => {
    const leakedUrl = "https://provider-sensitive.example/id-sensitive";
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith("/user/tokens/verify")) {
        return response({
          payload: { success: true, result: { status: "active" } },
        });
      }
      throw new Error(`request failed for ${leakedUrl}`);
    });

    const report = await runHostedReadinessProbe({
      env: stagingEnvironment({
        STAGING_SUPABASE_URL: leakedUrl,
      }),
      fetchImpl,
      now: fixedNow,
      timeoutMs: 100,
    });
    const output = `${JSON.stringify(report)}\n${renderReadinessMarkdown(report)}`;

    expect(report.probes.cloudflare.tokenValid).toBe(true);
    expect(report.probes.cloudflare.workersReadCapable).toBe(false);
    expect(output).not.toContain(leakedUrl);
    expect(output).not.toContain("request failed");
    expect(output).not.toContain("provider-body-sensitive");
  });
});
