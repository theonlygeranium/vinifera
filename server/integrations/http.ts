import { AppError } from "../lib/errors";

export const MAX_INTEGRATION_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface IntegrationTransport {
  fetch(input: Request): Promise<Response>;
}

export interface IntegrationRequestOptions {
  attempts?: number;
  baseDelayMs?: number;
  fetcher?: (input: Request) => Promise<Response>;
  request: Request;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
}

export class IntegrationProviderError extends Error {
  constructor(
    readonly providerCode: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`Integration provider request failed (${providerCode}).`);
    this.name = "IntegrationProviderError";
  }
}

function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function providerErrorCode(response: Response): string {
  if (response.status === 401 || response.status === 403) {
    return "provider_authentication_failed";
  }
  if (response.status === 409) return "provider_conflict";
  if (response.status === 429) return "provider_rate_limited";
  if (response.status >= 500) return "provider_unavailable";
  return "provider_rejected_request";
}

async function boundedResponseText(
  response: Response,
  maxBytes = MAX_INTEGRATION_RESPONSE_BYTES,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      throw new IntegrationProviderError(
        "provider_response_too_large",
        502,
        false,
      );
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        try {
          await reader.cancel("Integration response exceeded the byte limit.");
        } catch {
          // The bounded read still fails closed if the upstream stream rejects cancellation.
        }
        throw new IntegrationProviderError(
          "provider_response_too_large",
          502,
          false,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function requestIntegrationJson<T>(
  options: IntegrationRequestOptions,
): Promise<T> {
  const attempts = Math.min(5, Math.max(1, options.attempts ?? 3));
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 250);
  const timeoutMs = Math.min(30_000, Math.max(100, options.timeoutMs ?? 15_000));
  const fetcher: (input: Request) => Promise<Response> =
    options.fetcher ?? ((request) => fetch(request));
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(
        new Request(options.request, {
          redirect: "error",
          signal: AbortSignal.any([
            options.request.signal,
            AbortSignal.timeout(timeoutMs),
          ]),
        }),
      );
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const body = await boundedResponseText(response);
        if (!body) return undefined as T;
        try {
          return JSON.parse(body) as T;
        } catch {
          throw new IntegrationProviderError(
            "provider_invalid_response",
            502,
            false,
          );
        }
      }
      const retryable = response.status === 429 || response.status >= 500;
      const error = new IntegrationProviderError(
        providerErrorCode(response),
        response.status,
        retryable,
        retryAfterMilliseconds(response),
      );
      if (!retryable || attempt === attempts) throw error;
      lastError = error;
      await sleep(
        error.retryAfterMs ??
          Math.min(30_000, baseDelayMs * 2 ** (attempt - 1)),
      );
    } catch (error) {
      const normalizedError =
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "TimeoutError")
          ? new IntegrationProviderError(
              "provider_timeout",
              504,
              true,
            )
          : error;
      if (normalizedError instanceof IntegrationProviderError) {
        lastError = normalizedError;
        if (!normalizedError.retryable || attempt === attempts) {
          throw normalizedError;
        }
        await sleep(
          normalizedError.retryAfterMs ??
            Math.min(30_000, baseDelayMs * 2 ** (attempt - 1)),
        );
        continue;
      }
      lastError = normalizedError;
      if (attempt === attempts) break;
      await sleep(Math.min(30_000, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  console.error(
    JSON.stringify({
      event: "integration.provider_transport_failed",
      method: options.request.method,
      providerHost: new URL(options.request.url).host,
    }),
  );
  if (lastError instanceof IntegrationProviderError) throw lastError;
  throw new AppError(
    502,
    "upstream_error",
    "The integration provider could not be reached.",
  );
}

export function providerRequest(
  url: string,
  init: RequestInit,
): Request {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new AppError(
      503,
      "activation_required",
      "Integration providers must use HTTPS.",
    );
  }
  return new Request(parsed, {
    ...init,
    redirect: "error",
  });
}
