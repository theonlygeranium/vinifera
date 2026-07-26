import { putJson } from "../api/client";

const META_COOKIE_ID = /^fb\.[12]\.\d{10,13}\.[A-Za-z0-9_-]{1,200}$/;
const META_CLICK_ID = /^[A-Za-z0-9_-]{1,200}$/;
export const META_PRIVACY_POLICY_VERSION = "2026-07";

function cookieValue(cookieHeader: string, name: string): string | null {
  for (const item of cookieHeader.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function collectFirstPartyMetaAttribution(input: {
  consented: boolean;
  cookieHeader?: string;
  now?: number;
  pageUrl?: string;
}) {
  if (!input.consented) return null;
  const now = input.now ?? Date.now();
  const page = new URL(input.pageUrl ?? window.location.href);
  const cookies = input.cookieHeader ?? document.cookie;
  const storedFbc = cookieValue(cookies, "_fbc");
  const storedFbp = cookieValue(cookies, "_fbp");
  const clickId = page.searchParams.get("fbclid");
  const generatedFbc =
    clickId && META_CLICK_ID.test(clickId)
      ? `fb.1.${now}.${clickId}`
      : null;
  return {
    campaignId: page.searchParams.get("utm_id"),
    campaignName: page.searchParams.get("utm_campaign"),
    eventSourceUrl: page.toString(),
    fbc:
      storedFbc && META_COOKIE_ID.test(storedFbc)
        ? storedFbc
        : generatedFbc,
    fbp:
      storedFbp && META_COOKIE_ID.test(storedFbp)
        ? storedFbp
        : null,
    medium: page.searchParams.get("utm_medium"),
    occurredAt: new Date(now).toISOString(),
    source: page.searchParams.get("utm_source"),
  };
}

export async function updateMemberMetaConsent(input: {
  consentSource?: string;
  consented: boolean;
  policyVersion: string;
}) {
  const attribution = collectFirstPartyMetaAttribution({
    consented: input.consented,
  });
  const payload: Record<string, unknown> = {
    consentSource: input.consentSource ?? "member_portal",
    consented: input.consented,
    policyVersion: input.policyVersion,
  };
  if (attribution) {
    payload.attribution = attribution;
    payload.clientEventId = crypto.randomUUID();
  }
  return putJson<{
    attributionCaptured: boolean;
    attributionId: string | null;
    consented: boolean;
  }>("/api/member/privacy/meta", payload);
}
