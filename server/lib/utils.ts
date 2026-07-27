/**
 * Shared server-side utility functions.
 *
 * Centralizes sha256, assertUuid, camelKey, and numeric helpers that were
 * previously duplicated across server/services/*.ts (P3-4).
 *
 * Server-only — uses Node Buffer and WebCrypto crypto.subtle.
 * Client-side equivalents (numberValue) remain in src/client/api/.
 */

import { createHash } from "node:crypto";
import { AppError } from "./errors";

// ---------------------------------------------------------------------------
// sha256 (async, WebCrypto)
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash of a string, returning a lowercase hex digest.
 * Uses the WebCrypto SubtleCrypto API (async).
 */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("hex");
}

/**
 * Compute the SHA-256 hash of a string synchronously using Node's createHash.
 * Use this only when an async context is unavailable (e.g. provider-target
 * fingerprinting in the production release guard).
 */
export function sha256Sync(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// assertUuid
// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate that a string is a well-formed UUID. Throws AppError(400) if not.
 */
export function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new AppError(400, "invalid_request", `${label} is invalid.`);
  }
}

// ---------------------------------------------------------------------------
// camelKey
// ---------------------------------------------------------------------------

/**
 * Convert a snake_case string to camelCase.
 */
export function camelKey(value: string): string {
  return value.replace(/_([a-z])/g, (_, character: string) =>
    character.toUpperCase(),
  );
}

// ---------------------------------------------------------------------------
// numeric
// ---------------------------------------------------------------------------

/**
 * Coerce an unknown value to a finite number, falling back to a default.
 */
export function numeric(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
