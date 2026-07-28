import { describe, expect, it } from "vitest";
import { resolveLocalPassword } from "../../scripts/local-dev-config.mjs";
import { assertLoopbackHttpOrigin } from "../../scripts/local-dev-url.mjs";

describe("local development password override", () => {
  it("falls back for blank values and preserves a usable override", () => {
    expect(resolveLocalPassword(undefined)).toBe("ViniferaLocal1!");
    expect(resolveLocalPassword("   ")).toBe("ViniferaLocal1!");
    expect(resolveLocalPassword(" custom password ")).toBe(
      " custom password ",
    );
  });
});

describe("local development URL boundary", () => {
  it.each([
    ["http://127.0.0.1:54321", "http://127.0.0.1:54321"],
    ["http://localhost:8788/", "http://localhost:8788"],
    ["http://[::1]:5173", "http://[::1]:5173"],
  ])("accepts loopback HTTP %s", (value, expected) => {
    expect(assertLoopbackHttpOrigin(value, "LOCAL_URL")).toBe(expected);
  });

  it.each([
    "https://127.0.0.1:54321",
    "http://192.168.1.10:54321",
    "http://example.com",
    "http://user:password@127.0.0.1:54321",
    "http://127.0.0.1:54321/rest/v1",
    "http://127.0.0.1:54321?tenant=sunrise",
    "http://127.0.0.1:54321#fragment",
    "not a URL",
  ])("rejects non-loopback or non-HTTP %s", (value) => {
    expect(() => assertLoopbackHttpOrigin(value, "LOCAL_URL")).toThrow(
      "LOCAL_URL must be a loopback HTTP origin.",
    );
  });
});
