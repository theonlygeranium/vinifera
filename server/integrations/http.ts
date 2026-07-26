import { AppError } from "../lib/errors";

export interface IntegrationTransport {
  fetch(input: Request): Promise<Response>;
}

export interface IntegrationRequestOptions {
  attempts?: number;
  baseDelayMs?: number;
  fetcher?: (input: Request) => Promise<Response>;
  request: Request;
  sleep?: (milliseconds: number) => Promise<void>;
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

export async function requestIntegrationJson<T>(
  options: IntegrationRequestOptions,
): Promise<T> {
  const attempts = Math.min(5, Math.max(1, options.attempts ?? 3));
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 250);
  const fetcher: (input: Request) => Promise<Response> =
    options.fetcher ?? ((request) => fetch(request as never));
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(options.request.clone() as never);
      if (response.ok) {
        if (response.status === 204) return undefined as T;
        const body = await response.text();
        return body ? (JSON.parse(body) as T) : (undefined as T);
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
      if (error instanceof IntegrationProviderError) {
        lastError = error;
        if (!error.retryable || attempt === attempts) throw error;
        await sleep(
          error.retryAfterMs ??
            Math.min(30_000, baseDelayMs * 2 ** (attempt - 1)),
        );
        continue;
      }
      lastError = error;
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
  return new Request(parsed, init);
}
