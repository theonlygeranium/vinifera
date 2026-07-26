import { BiometricAuth } from "@aparajita/capacitor-biometric-auth";
import {
  KeychainAccess,
  SecureStorage,
} from "@aparajita/capacitor-secure-storage";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import type {
  MobileBootstrap,
  MobileSessionTokens,
} from "../api/phase5";
import { MOBILE_AUTH_REDIRECT_URI } from "./mobile-identity";

const SESSION_KEY = "member-session";
const BOOTSTRAP_KEY = "member-bootstrap";
const DEVICE_FINGERPRINT_KEY = "device-fingerprint";
const SESSION_MARKER = "vinifera.native-session-present";
const MOBILE_API_ORIGIN =
  import.meta.env.VITE_MOBILE_API_ORIGIN?.trim() ||
  "https://vinifera.edstratumlabs.ai";

let accessToken: string | null = null;
let sessionExpiresAt = 0;
let storageReady: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMobileSession(value: unknown): value is MobileSessionTokens {
  if (!isRecord(value) || !isRecord(value.member)) return false;
  return (
    typeof value.accessToken === "string" &&
    typeof value.refreshToken === "string" &&
    typeof value.expiresAt === "string" &&
    value.tokenType === "bearer" &&
    typeof value.member.id === "string" &&
    typeof value.member.email === "string"
  );
}

function isMobileBootstrap(value: unknown): value is MobileBootstrap {
  if (!isRecord(value) || !isRecord(value.member)) return false;
  return (
    typeof value.member.id === "string" &&
    Array.isArray(value.recentShipments) &&
    value.recentShipments.every(
      (shipment) =>
        isRecord(shipment) &&
        typeof shipment.id === "string" &&
        typeof shipment.releaseName === "string" &&
        typeof shipment.status === "string" &&
        typeof shipment.createdAt === "string" &&
        typeof shipment.chargeAmountCents === "number",
    ) &&
    Array.isArray(value.loyaltyLedger) &&
    value.loyaltyLedger.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.description === "string" &&
        typeof entry.points === "number" &&
        typeof entry.createdAt === "string",
    ) &&
    Array.isArray(value.pendingActions) &&
    value.pendingActions.every(
      (action) =>
        isRecord(action) &&
        typeof action.id === "string" &&
        typeof action.type === "string" &&
        typeof action.label === "string",
    ) &&
    (value.cursor === null || typeof value.cursor === "string") &&
    typeof value.generatedAt === "string"
  );
}

function requireNative() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Native secure storage is unavailable on the web.");
  }
}

function apiUrl(path: `/api/${string}`) {
  const origin = new URL(MOBILE_API_ORIGIN);
  if (origin.protocol !== "https:") {
    throw new Error("The native API origin must use HTTPS.");
  }
  return new URL(path, origin).toString();
}

async function prepareStorage() {
  requireNative();
  storageReady ??= (async () => {
    await SecureStorage.setKeyPrefix("vinifera_");
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(
      KeychainAccess.whenPasscodeSetThisDeviceOnly,
    );
  })();
  await storageReady;
}

async function postMobile<T>(
  path: `/api/${string}`,
  body: Record<string, unknown>,
  bearer?: string | null,
) {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? "The secure mobile session request failed.",
    );
  }
  return (payload && "data" in payload ? payload.data : payload) as T;
}

async function writeSession(session: MobileSessionTokens) {
  await prepareStorage();
  await SecureStorage.set(SESSION_KEY, JSON.stringify(session));
  window.localStorage.setItem(SESSION_MARKER, "1");
  accessToken = session.accessToken;
  sessionExpiresAt = Date.parse(session.expiresAt);
}

async function readSession() {
  await prepareStorage();
  const value = await SecureStorage.get(SESSION_KEY, false);
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isMobileSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function rotateSession(session: MobileSessionTokens) {
  const refreshed = await postMobile<MobileSessionTokens>(
    "/api/auth/member/mobile/refresh",
    { refreshToken: session.refreshToken },
  );
  await writeSession(refreshed);
  return refreshed;
}

export function isNativeShell() {
  return Capacitor.isNativePlatform();
}

export async function initializeNativeSession() {
  if (!isNativeShell()) return "web" as const;
  if (window.localStorage.getItem(SESSION_MARKER) !== "1") {
    return "magic_link_required" as const;
  }

  try {
    const biometry = await BiometricAuth.checkBiometry();
    if (!biometry.isAvailable && !biometry.deviceIsSecure) {
      return "magic_link_required" as const;
    }
    await BiometricAuth.authenticate({
      reason: "Unlock your Vinifera member session",
      cancelTitle: "Use magic link",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use device passcode",
      androidTitle: "Unlock Vinifera",
      androidSubtitle: "Confirm your identity to continue",
      androidConfirmationRequired: false,
    });
    const session = await readSession();
    if (!session) return "magic_link_required" as const;
    if (Date.parse(session.expiresAt) <= Date.now() + 30_000) {
      await rotateSession(session);
    } else {
      accessToken = session.accessToken;
      sessionExpiresAt = Date.parse(session.expiresAt);
    }
    return "unlocked" as const;
  } catch {
    accessToken = null;
    sessionExpiresAt = 0;
    return "magic_link_required" as const;
  }
}

export async function exchangeNativeMagicLink(code: string) {
  requireNative();
  const app = await CapacitorApp.getInfo();
  const session = await postMobile<MobileSessionTokens>(
    "/api/auth/member/mobile/exchange",
    {
      code,
      deviceFingerprint: await getNativeDeviceFingerprint(),
      redirectUri: MOBILE_AUTH_REDIRECT_URI,
      platform: Capacitor.getPlatform(),
      appVersion: app.version,
    },
  );
  await writeSession(session);
  return session;
}

export async function getNativeAccessToken() {
  if (!isNativeShell() || !accessToken) return null;
  if (sessionExpiresAt <= Date.now() + 30_000) {
    const session = await readSession();
    if (!session) return null;
    await rotateSession(session);
  }
  return accessToken;
}

export function lockNativeSession() {
  accessToken = null;
  sessionExpiresAt = 0;
}

export async function getNativeDeviceFingerprint() {
  requireNative();
  await prepareStorage();
  const existing = await SecureStorage.get(DEVICE_FINGERPRINT_KEY, false);
  if (typeof existing === "string" && existing.length >= 16) return existing;
  const fingerprint = crypto.randomUUID();
  await SecureStorage.set(DEVICE_FINGERPRINT_KEY, fingerprint);
  return fingerprint;
}

export async function clearNativeSession() {
  if (!isNativeShell()) return;
  const session = await readSession().catch(() => null);
  if (session) {
    const deviceFingerprint = await getNativeDeviceFingerprint().catch(
      () => null,
    );
    if (deviceFingerprint) {
      await fetch(apiUrl("/api/mobile/devices"), {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deviceFingerprint }),
      }).catch(() => undefined);
    }
    await postMobile(
      "/api/auth/member/mobile/logout",
      {
        refreshToken: session.refreshToken,
      },
      session.accessToken,
    ).catch(() => undefined);
  }
  await prepareStorage();
  await SecureStorage.remove(SESSION_KEY);
  await SecureStorage.remove(BOOTSTRAP_KEY);
  window.localStorage.removeItem(SESSION_MARKER);
  lockNativeSession();
}

export async function cacheMobileBootstrap(snapshot: MobileBootstrap) {
  requireNative();
  await prepareStorage();
  await SecureStorage.set(BOOTSTRAP_KEY, JSON.stringify(snapshot));
}

export async function readCachedMobileBootstrap() {
  if (!isNativeShell()) return null;
  await prepareStorage();
  const value = await SecureStorage.get(BOOTSTRAP_KEY, false);
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isMobileBootstrap(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
