import { IntegrationProviderError } from "./http";

export type IntegrationJobOutcome =
  | "dead_letter"
  | "partial"
  | "retry"
  | "synced";

export interface IntegrationJobCompletion {
  errorCode: string | null;
  failed: number;
  nextAttemptAt: string | null;
  outcome: IntegrationJobOutcome;
  processed: number;
  providerCursor: Record<string, unknown>;
}

const SAFE_ERROR_CODES = new Set([
  "activation_required",
  "consent_required",
  "invalid_mapping",
  "provider_authentication_failed",
  "provider_conflict",
  "provider_invalid_response",
  "provider_rate_limited",
  "provider_rejected_request",
  "provider_response_too_large",
  "provider_timeout",
  "provider_unavailable",
  "upstream_error",
]);

export function integrationRetryAt(
  attempt: number,
  asOf = new Date(),
  retryAfterMs?: number | null,
): string {
  const boundedAttempt = Math.min(10, Math.max(1, attempt));
  const delay =
    retryAfterMs ??
    Math.min(24 * 60 * 60 * 1_000, 60_000 * 2 ** (boundedAttempt - 1));
  return new Date(asOf.getTime() + Math.max(1_000, delay)).toISOString();
}

export function sanitizedIntegrationErrorCode(error: unknown): string {
  if (error instanceof IntegrationProviderError) {
    return SAFE_ERROR_CODES.has(error.providerCode)
      ? error.providerCode
      : "upstream_error";
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    SAFE_ERROR_CODES.has(error.code)
  ) {
    return error.code;
  }
  return "upstream_error";
}

export function failedIntegrationJob(input: {
  asOf?: Date;
  attempt: number;
  error: unknown;
  maxAttempts: number;
  processed?: number;
  providerCursor?: Record<string, unknown>;
}): IntegrationJobCompletion {
  const retryable =
    input.error instanceof IntegrationProviderError
      ? input.error.retryable
      : sanitizedIntegrationErrorCode(input.error) === "upstream_error";
  const retry =
    retryable && Math.max(1, input.attempt) < Math.max(1, input.maxAttempts);
  return {
    errorCode: sanitizedIntegrationErrorCode(input.error),
    failed: 1,
    nextAttemptAt: retry
      ? integrationRetryAt(
          input.attempt,
          input.asOf,
          input.error instanceof IntegrationProviderError
            ? input.error.retryAfterMs
            : null,
        )
      : null,
    outcome: retry ? "retry" : "dead_letter",
    processed: Math.max(0, input.processed ?? 0),
    providerCursor: input.providerCursor ?? {},
  };
}

export function successfulIntegrationJob(input: {
  failed?: number;
  processed: number;
  providerCursor?: Record<string, unknown>;
}): IntegrationJobCompletion {
  const failed = Math.max(0, input.failed ?? 0);
  return {
    errorCode: failed ? "partial_failure" : null,
    failed,
    nextAttemptAt: null,
    outcome: failed ? "partial" : "synced",
    processed: Math.max(0, input.processed),
    providerCursor: input.providerCursor ?? {},
  };
}
