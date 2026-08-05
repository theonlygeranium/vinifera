import type { WorkerEnv } from "../types";

/**
 * Returns the CF Access service-token headers, or `undefined` when the
 * credentials are absent.
 */
export function cfAccessHeaders(
  env: WorkerEnv,
): Record<string, string> | undefined {
  const clientId = env.CF_ACCESS_CLIENT_ID;
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  return {
    "CF-Access-Client-Id": clientId,
    "CF-Access-Client-Secret": clientSecret,
  };
}

/**
 * Returns a custom `fetch` that injects CF Access service-token headers
 * into every outbound request, preserving existing headers.
 *
 * `@supabase/supabase-js` `global.headers` does not reliably propagate
 * to PostgREST fetch calls in the Cloudflare Workers runtime. This wrapper
 * ensures CF Access headers reach both GoTrue and PostgREST endpoints.
 */
export function cfAccessFetch(
  env: WorkerEnv,
): typeof fetch | undefined {
  const accessHeaders = cfAccessHeaders(env);
  if (!accessHeaders) return undefined;

  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    // Preserve existing headers (apikey, Authorization, Content-Type, etc.)
    // and merge CF Access headers on top.
    const merged = new Headers(init?.headers);
    for (const [key, value] of Object.entries(accessHeaders)) {
      merged.set(key, value);
    }
    return fetch(input, { ...init, headers: merged });
  };
}
