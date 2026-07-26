import { describe, expect, it } from "vitest";
import {
  blocksPrivateContent,
  safeStoreUrl,
  shouldRelockAfterBackground,
} from "../../src/client/mobile/mobile-policy";
import { routeFromMobileUrl } from "../../src/client/mobile/mobile-identity";

describe("Phase 5 native policy gates", () => {
  it("removes private content for a required store update", () => {
    expect(
      blocksPrivateContent({
        latestVersion: "0.6.0",
        minimumVersion: "0.6.0",
        update: "required",
      }),
    ).toBe(true);
    expect(
      blocksPrivateContent({
        latestVersion: "0.6.0",
        minimumVersion: "0.5.0",
        update: "recommended",
      }),
    ).toBe(false);
  });

  it("accepts only credential-free default-port HTTPS store links", () => {
    expect(safeStoreUrl("https://apps.apple.com/app/id123")).toBe(
      "https://apps.apple.com/app/id123",
    );
    expect(safeStoreUrl("http://apps.example.test/update")).toBeNull();
    expect(
      safeStoreUrl("https://user:pass@apps.example.test/update"),
    ).toBeNull();
    expect(safeStoreUrl("https://apps.example.test:8443/update")).toBeNull();
  });

  it("requires unlock after more than five minutes in the background", () => {
    expect(shouldRelockAfterBackground(1_000, 301_001)).toBe(true);
    expect(shouldRelockAfterBackground(1_000, 301_000)).toBe(false);
    expect(shouldRelockAfterBackground(null, 999_999)).toBe(false);
  });

  it("accepts only the canonical mobile scheme, host, and exact routes", () => {
    expect(routeFromMobileUrl("vinifera.ai://portal")?.path).toBe("/portal");
    expect(
      routeFromMobileUrl("vinifera.ai://portal/auth?code=opaque")?.path,
    ).toBe("/portal/auth");
    expect(
      routeFromMobileUrl(
        "https://vinifera.edstratumlabs.ai/app/fulfillment",
      )?.path,
    ).toBe("/app/fulfillment");
    expect(routeFromMobileUrl("vinifera://portal/auth")).toBeNull();
    expect(
      routeFromMobileUrl(
        "https://evil.edstratumlabs.ai/app/fulfillment",
      ),
    ).toBeNull();
    expect(
      routeFromMobileUrl(
        "https://vinifera.edstratumlabs.ai/app/fulfillment/admin",
      ),
    ).toBeNull();
    expect(
      routeFromMobileUrl("vinifera.ai://portal/auth/replay"),
    ).toBeNull();
  });
});
