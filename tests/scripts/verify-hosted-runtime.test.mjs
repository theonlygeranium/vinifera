import { describe, expect, it, vi } from "vitest";
import {
  buildHostedRuntimeEvidence,
  verifyHostedRuntime,
} from "../../scripts/verify-hosted-runtime.mjs";

const capabilityNames = [
  "app",
  "billing",
  "compliance",
  "communications",
  "customDomains",
  "database",
  "email",
  "googleOAuth",
  "integrationEncryption",
  "mobile",
  "push",
  "quickBooksOAuth",
  "security",
  "shipping",
  "webhook",
];

function configurationPayload(overrides = {}) {
  return {
    data: Object.fromEntries(
      capabilityNames.map((name) => [
        name,
        {
          configured: ["app", "database", "billing", "security", "webhook"].includes(
            name,
          ),
          missing: [],
          ...overrides[name],
        },
      ]),
    ),
  };
}

function response(payload) {
  return {
    json: vi.fn(async () => payload),
    ok: true,
  };
}

describe("hosted runtime verifier", () => {
  it("accepts only an isolated staging Worker and emits credential-free evidence", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ init, url });
      return response(
        String(url).endsWith("/api/health/configuration")
          ? configurationPayload()
          : { data: { service: "vinifera-api", status: "ok" } },
      );
    });
    const origin =
      "https://vinifera-staging.account-subdomain.workers.dev";

    const evidence = await verifyHostedRuntime({
      fetchImpl,
      now: () => new Date("2026-07-26T12:00:00.000Z"),
      origin,
    });

    expect(evidence).toMatchObject({
      configuration: {
        requiredCapabilities: ["app", "database", "billing", "security", "webhook"],
        requiredCapabilitiesPassed: true,
      },
      health: { passed: true, service: "vinifera-api", status: "ok" },
      targetClass: "isolated-staging-workers-dev",
    });
    expect(calls).toHaveLength(2);
    expect(
      calls.every(
        ({ init, url }) =>
          init.method === "GET" &&
          init.redirect === "error" &&
          String(url).startsWith(`${origin}/api/health`),
      ),
    ).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(origin);
    expect(JSON.stringify(evidence)).not.toContain("missing");
  });

  it("fails closed when a core capability is not configured", () => {
    expect(() =>
      buildHostedRuntimeEvidence({
        configurationPayload: configurationPayload({
          billing: { configured: false, missing: ["STRIPE_SECRET_KEY"] },
        }),
        healthPayload: {
          data: { service: "vinifera-api", status: "ok" },
        },
      }),
    ).toThrow(/missing required capabilities: billing/);
  });

  it.each([
    "https://vinifera.edstratumlabs.ai",
    "https://vinifera-staging.workers.dev",
    "https://vinifera-staging.example.com",
    "https://vinifera-staging.account.workers.dev/path",
    "http://vinifera-staging.account.workers.dev",
  ])("rejects a non-isolated staging origin: %s", async (origin) => {
    const fetchImpl = vi.fn();
    await expect(
      verifyHostedRuntime({ fetchImpl, origin }),
    ).rejects.toThrow(/isolated vinifera-staging workers\.dev origin/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects malformed health and configuration contracts", () => {
    expect(() =>
      buildHostedRuntimeEvidence({
        configurationPayload: configurationPayload(),
        healthPayload: { data: { service: "unexpected", status: "ok" } },
      }),
    ).toThrow(/health contract did not pass/);
    expect(() =>
      buildHostedRuntimeEvidence({
        configurationPayload: { data: { app: { configured: "yes" } } },
        healthPayload: {
          data: { service: "vinifera-api", status: "ok" },
        },
      }),
    ).toThrow(/configuration contract is invalid/);
  });
});
