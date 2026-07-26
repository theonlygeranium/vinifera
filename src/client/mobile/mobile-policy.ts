import type { MobileAppPolicy } from "../api/phase5";

export function blocksPrivateContent(policy: MobileAppPolicy | null) {
  return policy?.update === "required";
}

export function safeStoreUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function shouldRelockAfterBackground(
  backgroundedAt: number | null,
  now: number,
) {
  return backgroundedAt !== null && now - backgroundedAt > 5 * 60 * 1000;
}
