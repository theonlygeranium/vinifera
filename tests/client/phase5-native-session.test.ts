/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkBiometry: vi.fn(),
  storage: new Map<string, string>(),
}));

vi.mock("@aparajita/capacitor-biometric-auth", () => ({
  BiometricAuth: {
    authenticate: nativeMocks.authenticate,
    checkBiometry: nativeMocks.checkBiometry,
  },
}));

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  KeychainAccess: { whenPasscodeSetThisDeviceOnly: "device-only" },
  SecureStorage: {
    get: vi.fn(async (key: string) => nativeMocks.storage.get(key)),
    remove: vi.fn(async (key: string) => nativeMocks.storage.delete(key)),
    set: vi.fn(async (key: string, value: string) => {
      nativeMocks.storage.set(key, value);
    }),
    setDefaultKeychainAccess: vi.fn(async () => undefined),
    setKeyPrefix: vi.fn(async () => undefined),
    setSynchronize: vi.fn(async () => undefined),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => "ios",
    isNativePlatform: () => true,
  },
}));

vi.mock("@capacitor/app", () => ({
  App: { getInfo: vi.fn(async () => ({ version: "0.5.0" })) },
}));

import {
  cacheMobileBootstrap,
  getNativeAccessToken,
  getNativeDeviceFingerprint,
  initializeNativeSession,
  lockNativeSession,
  readCachedMobileBootstrap,
} from "../../src/client/mobile/native-session";

describe("Phase 5 native session boundary", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_MOBILE_API_ORIGIN", "https://api.vinifera.test");
    nativeMocks.authenticate.mockReset();
    nativeMocks.checkBiometry.mockReset();
    nativeMocks.storage.clear();
    lockNativeSession();
    window.localStorage.clear();
    window.localStorage.setItem("vinifera.native-session-present", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("falls back to a magic link when the device has no secure unlock", async () => {
    nativeMocks.checkBiometry.mockResolvedValue({
      deviceIsSecure: false,
      isAvailable: false,
    });

    await expect(initializeNativeSession()).resolves.toBe(
      "magic_link_required",
    );
    expect(nativeMocks.authenticate).not.toHaveBeenCalled();
  });

  it("falls back to a magic link when biometric or device unlock is cancelled", async () => {
    nativeMocks.checkBiometry.mockResolvedValue({
      deviceIsSecure: true,
      isAvailable: true,
    });
    nativeMocks.authenticate.mockRejectedValue(new Error("User cancelled"));

    await expect(initializeNativeSession()).resolves.toBe(
      "magic_link_required",
    );
  });

  it("uses one stable secure installation fingerprint across push-token rotations", async () => {
    const first = await getNativeDeviceFingerprint();
    const second = await getNativeDeviceFingerprint();

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(second).toBe(first);
    expect(nativeMocks.storage.get("device-fingerprint")).toBe(first);
  });

  it("round-trips the minimized offline snapshot from secure storage within 500ms", async () => {
    const snapshot = {
      brand: {
        id: "brand-1",
        logoUrl: null,
        name: "Vinifera Estate",
        primaryColor: "#6B1E30",
      },
      cursor: "shipment-1",
      generatedAt: "2026-07-26T16:00:00.000Z",
      loyaltyLedger: [
        {
          createdAt: "2026-07-26T15:00:00.000Z",
          description: "Shipment points",
          id: "ledger-1",
          points: 120,
        },
      ],
      member: {
        email: "member@example.test",
        firstName: "Avery",
        id: "member-1",
        lastName: "Vine",
      },
      pendingActions: [],
      recentShipments: [
        {
          chargeAmountCents: 12_500,
          createdAt: "2026-07-26T14:00:00.000Z",
          id: "shipment-1",
          releaseName: "Summer Release",
          status: "shipped",
        },
      ],
    };
    const startedAt = performance.now();
    await cacheMobileBootstrap(snapshot);
    await expect(readCachedMobileBootstrap()).resolves.toEqual(snapshot);
    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(window.localStorage.getItem("member-bootstrap")).toBeNull();
  });

  it("opens a biometrically unlocked cached session on an offline cold start", async () => {
    const now = Date.parse("2026-07-26T16:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    nativeMocks.storage.set(
      "member-session",
      JSON.stringify({
        accessToken: "expired-access",
        expiresAt: new Date(now - 1_000).toISOString(),
        member: { email: "member@example.test", id: "member-1" },
        refreshToken: "offline-refresh",
        tokenType: "bearer",
      }),
    );
    nativeMocks.storage.set(
      "member-bootstrap",
      JSON.stringify({
        cursor: null,
        generatedAt: "2026-07-26T15:55:00.000Z",
        loyaltyLedger: [],
        member: { email: "member@example.test", id: "member-1" },
        pendingActions: [],
        recentShipments: [],
      }),
    );
    nativeMocks.checkBiometry.mockResolvedValue({
      deviceIsSecure: true,
      isAvailable: true,
    });
    nativeMocks.authenticate.mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(initializeNativeSession()).resolves.toBe("cached");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it("single-flights concurrent refreshes of one rotating native session", async () => {
    const now = Date.parse("2026-07-26T16:00:00.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const initial = {
      accessToken: "access-before-rotation",
      expiresAt: new Date(now + 60_000).toISOString(),
      member: {
        email: "member@example.test",
        id: "member-1",
      },
      refreshToken: "single-use-refresh",
      tokenType: "bearer",
    };
    nativeMocks.storage.set("member-session", JSON.stringify(initial));
    nativeMocks.checkBiometry.mockResolvedValue({
      deviceIsSecure: true,
      isAvailable: true,
    });
    nativeMocks.authenticate.mockResolvedValue(undefined);
    await expect(initializeNativeSession()).resolves.toBe("unlocked");

    nowSpy.mockReturnValue(now + 40_000);
    const refreshed = {
      ...initial,
      accessToken: "access-after-rotation",
      expiresAt: new Date(now + 3_600_000).toISOString(),
      refreshToken: "next-refresh-token",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: refreshed }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      Promise.all([
        getNativeAccessToken(),
        getNativeAccessToken(),
        getNativeAccessToken(),
      ]),
    ).resolves.toEqual([
      "access-after-rotation",
      "access-after-rotation",
      "access-after-rotation",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(nativeMocks.storage.get("member-session")!)).toMatchObject({
      refreshToken: "next-refresh-token",
    });

    nowSpy.mockRestore();
  });
});
