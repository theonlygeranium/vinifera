import { describe, expect, it } from "vitest";
import { initSentry } from "../../server/lib/sentry";

describe("Sentry Cloudflare configuration", () => {
  it("leaves Sentry disabled when no DSN is configured", () => {
    expect(initSentry(undefined, "development")).toBeUndefined();
    expect(initSentry("  ", "production")).toBeUndefined();
  });

  it("uses environment-aware tracing and disables private data collection", () => {
    const options = initSentry(
      "https://public@example.ingest.sentry.io/project",
      "production",
    );

    expect(options).toMatchObject({
      dataCollection: {
        cookies: false,
        databaseQueryData: false,
        httpBodies: [],
        stackFrameVariables: false,
        urlQueryParams: false,
        userInfo: false,
      },
      enabled: true,
      environment: "production",
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
    });

    const sanitized = options?.beforeSend?.(
      {
        exception: {
          values: [{ type: "ProviderError", value: "member@example.com" }],
        },
        logentry: { message: "private response" },
        message: "private response",
        type: undefined,
      },
      {},
    );
    expect(sanitized).toMatchObject({
      exception: {
        values: [{ type: "ProviderError", value: "ProviderError" }],
      },
    });
    expect(sanitized).not.toHaveProperty("logentry");
    expect(sanitized).not.toHaveProperty("message");
  });
});
