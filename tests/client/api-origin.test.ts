import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiRequest,
  downloadApiFile,
  resolveApiUrl,
} from "../../src/client/api/client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function expectOriginError(
  invoke: () => string,
  code: "INVALID_API_ORIGIN" | "INVALID_MOBILE_API_ORIGIN",
) {
  try {
    invoke();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

describe("browser API origin policy", () => {
  it("uses same-origin API paths by default", () => {
    vi.stubEnv("VITE_CAPACITOR_BUILD", "false");
    vi.stubEnv("VITE_API_BASE_URL", "");

    expect(resolveApiUrl("/api/health")).toBe("/api/health");
  });

  it.each([
    ["IPv4 loopback", "http://127.0.0.1:8788"],
    ["localhost", "http://localhost:8788"],
    ["IPv6 loopback", "http://[::1]:8788"],
  ])("allows %s HTTP for local browser development", (_label, origin) => {
    vi.stubEnv("VITE_CAPACITOR_BUILD", "false");
    vi.stubEnv("VITE_API_BASE_URL", origin);

    expect(resolveApiUrl("/api/health")).toBe(`${origin}/api/health`);
  });

  it("allows a credential-free HTTPS origin", () => {
    vi.stubEnv("VITE_CAPACITOR_BUILD", "false");
    vi.stubEnv("VITE_API_BASE_URL", "https://api.vinifera.test");

    expect(resolveApiUrl("/api/health")).toBe(
      "https://api.vinifera.test/api/health",
    );
  });

  it.each([
    ["credentials", "https://user:password@api.vinifera.test"],
    ["path", "https://api.vinifera.test/v1"],
    ["query", "https://api.vinifera.test/?tenant=one"],
    ["non-loopback HTTP", "http://api.vinifera.test"],
    ["invalid URL", "not a URL"],
  ])("rejects a browser origin containing %s", (_label, origin) => {
    vi.stubEnv("VITE_CAPACITOR_BUILD", "false");
    vi.stubEnv("VITE_API_BASE_URL", origin);

    expectOriginError(
      () => resolveApiUrl("/api/health"),
      "INVALID_API_ORIGIN",
    );
  });

  it.each([
    ["API requests", () => apiRequest("/api/health")],
    [
      "file downloads",
      () => downloadApiFile("/api/analytics/export.csv", "analytics.csv"),
    ],
  ])("preserves origin-policy errors for %s", async (_label, request) => {
    vi.stubEnv("VITE_CAPACITOR_BUILD", "false");
    vi.stubEnv("VITE_API_BASE_URL", "not a URL");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(request()).rejects.toMatchObject({
      code: "INVALID_API_ORIGIN",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Capacitor API origin policy", () => {
  it("continues to require and use the mobile HTTPS origin", () => {
    vi.stubEnv("VITE_CAPACITOR_BUILD", "true");
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:8788");
    vi.stubEnv("VITE_MOBILE_API_ORIGIN", "https://api.vinifera.test");

    expect(resolveApiUrl("/api/health")).toBe(
      "https://api.vinifera.test/api/health",
    );
  });

  it.each([
    ["loopback HTTP", "http://127.0.0.1:8788"],
    ["HTTPS with a port", "https://api.vinifera.test:8443"],
  ])("keeps rejecting %s for native builds", (_label, origin) => {
    vi.stubEnv("VITE_CAPACITOR_BUILD", "true");
    vi.stubEnv("VITE_MOBILE_API_ORIGIN", origin);

    expectOriginError(
      () => resolveApiUrl("/api/health"),
      "INVALID_MOBILE_API_ORIGIN",
    );
  });
});
