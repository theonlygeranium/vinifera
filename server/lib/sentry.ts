import * as Sentry from "@sentry/cloudflare";
import type {
  CaptureContext,
  CloudflareOptions,
} from "@sentry/cloudflare";

const PRIVATE_DATA_COLLECTION: NonNullable<
  CloudflareOptions["dataCollection"]
> = {
  cookies: false,
  databaseQueryData: false,
  frameContextLines: 0,
  genAI: {
    inputs: false,
    outputs: false,
  },
  graphQL: {
    document: false,
    variables: false,
  },
  httpBodies: [],
  httpHeaders: {
    request: {
      allow: ["cf-ray"],
    },
    response: false,
  },
  stackFrameVariables: false,
  urlQueryParams: false,
  userInfo: false,
};

/**
 * Build request-scoped Sentry options for the Cloudflare SDK wrapper.
 *
 * Returning undefined leaves the Worker uninstrumented when no DSN is
 * configured. The DSN is read from a Worker secret by the entrypoint and is
 * never stored in source or Wrangler variables.
 */
export function initSentry(
  dsn: string | undefined,
  environment: string,
): CloudflareOptions | undefined {
  const normalizedDsn = dsn?.trim();
  if (!normalizedDsn) return undefined;

  return {
    beforeSend(event) {
      delete event.logentry;
      delete event.message;
      for (const exception of event.exception?.values ?? []) {
        exception.value = exception.type ?? "Error";
      }
      return event;
    },
    dataCollection: PRIVATE_DATA_COLLECTION,
    dsn: normalizedDsn,
    enabled: true,
    environment,
    sendDefaultPii: false,
    tracesSampleRate: environment === "production" ? 0.1 : 1,
  };
}

export function captureException(
  error: unknown,
  context?: CaptureContext,
): string {
  return Sentry.captureException(error, context);
}

export { Sentry };
