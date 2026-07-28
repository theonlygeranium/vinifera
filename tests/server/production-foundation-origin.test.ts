import { describe, expect, it, vi } from "vitest";
import {
  resolveApplicationOrigin,
} from "../../server/services/production-foundation";

function requestWithOrigin(origin: string) {
  return {
    get: vi.fn((name: string) => {
      if (name === "origin") return origin;
      if (name === "host") return "127.0.0.1:8788";
      return undefined;
    }),
    protocol: "http",
  } as unknown as Parameters<typeof resolveApplicationOrigin>[1];
}

describe("production foundation application origin", () => {
  it("routes cross-origin Vite auth callbacks through the configured Worker", () => {
    expect(
      resolveApplicationOrigin(
        {
          APP_ENV: "development",
          APP_ORIGIN: "http://127.0.0.1:8788",
        },
        requestWithOrigin("http://127.0.0.1:5173"),
      ),
    ).toBe("http://127.0.0.1:8788");
  });

  it("rejects a configured callback URL that is not an origin", () => {
    expect(() =>
      resolveApplicationOrigin(
        { APP_ORIGIN: "https://vinifera.example/app" },
        requestWithOrigin("https://vinifera.example"),
      ),
    ).toThrow("APP_ORIGIN must be a credential-free HTTP or HTTPS origin.");
  });

  it("rejects HTTP APP_ORIGIN outside explicit loopback local modes", () => {
    for (const env of [
      {
        APP_ENV: "production" as const,
        APP_ORIGIN: "http://vinifera.example",
      },
      {
        APP_ENV: "development" as const,
        APP_ORIGIN: "http://vinifera.example",
      },
    ]) {
      expect(() =>
        resolveApplicationOrigin(
          env,
          requestWithOrigin("https://vinifera.example"),
        ),
      ).toThrow(
        "HTTP application origins are allowed only for loopback development and test.",
      );
    }
  });

  it("requires APP_ORIGIN in hosted environments", () => {
    expect(() =>
      resolveApplicationOrigin(
        { APP_ENV: "production" },
        requestWithOrigin("https://attacker.example"),
      ),
    ).toThrow("APP_ORIGIN is required outside development and test.");
  });

  it("allows request-origin fallback only in explicit local modes", () => {
    expect(
      resolveApplicationOrigin(
        { APP_ENV: "development" },
        requestWithOrigin("http://127.0.0.1:5173"),
      ),
    ).toBe("http://127.0.0.1:5173");
  });

  it("applies the loopback HTTP rule to request-derived origins", () => {
    expect(() =>
      resolveApplicationOrigin(
        { APP_ENV: "development" },
        requestWithOrigin("http://attacker.example"),
      ),
    ).toThrow(
      "HTTP application origins are allowed only for loopback development and test.",
    );
  });

  it("fails closed when APP_ENV is missing or unknown", () => {
    const invalidEnvironments = [
      {},
      { APP_ENV: "preview" } as unknown as Parameters<
        typeof resolveApplicationOrigin
      >[0],
    ];

    for (const env of invalidEnvironments) {
      expect(() =>
        resolveApplicationOrigin(
          env,
          requestWithOrigin("https://attacker.example"),
        ),
      ).toThrow("APP_ORIGIN is required outside development and test.");
    }
  });
});
