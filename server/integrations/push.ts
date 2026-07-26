import { AppError, requireConfigured } from "../lib/errors";
import type { WorkerEnv } from "../types";
import {
  providerRequest,
  requestIntegrationJson,
  type IntegrationRequestOptions,
} from "./http";

interface FcmAccessToken {
  expiresAt: number;
  token: string;
}

function base64Url(value: string | ArrayBuffer): string {
  return Buffer.from(
    typeof value === "string"
      ? Buffer.from(value, "utf8")
      : new Uint8Array(value),
  ).toString("base64url");
}

function pkcs8(privateKey: string): Uint8Array<ArrayBuffer> {
  const normalized = privateKey.replace(/\\n/g, "\n");
  const encoded = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const decoded = Buffer.from(encoded, "base64");
  if (!decoded.length) {
    throw new AppError(
      503,
      "activation_required",
      "The Firebase service-account private key is invalid.",
    );
  }
  return Uint8Array.from(decoded);
}

export class FcmPushClient {
  private access: FcmAccessToken | null = null;

  constructor(
    private readonly configuration: {
      clientEmail: string;
      privateKey: string;
      projectId: string;
    },
    private readonly options: {
      fetcher?: (input: Request) => Promise<Response>;
      sleep?: IntegrationRequestOptions["sleep"];
    } = {},
  ) {
    if (
      !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(
        configuration.clientEmail,
      ) ||
      !/^[a-z][a-z0-9-]{4,62}$/.test(configuration.projectId) ||
      !configuration.privateKey.includes("PRIVATE KEY")
    ) {
      throw new AppError(
        503,
        "activation_required",
        "Firebase Cloud Messaging credentials are not configured.",
      );
    }
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now() + 5 * 60 * 1_000) {
      return this.access.token;
    }
    const now = Math.floor(Date.now() / 1_000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64Url(
      JSON.stringify({
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3_600,
        iat: now,
        iss: this.configuration.clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
      }),
    );
    const unsigned = `${header}.${claims}`;
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8(this.configuration.privateKey),
      { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      Uint8Array.from(new TextEncoder().encode(unsigned)),
    );
    const assertion = `${unsigned}.${base64Url(signature)}`;
    const payload = await requestIntegrationJson<{
      access_token?: string;
      expires_in?: number;
    }>({
      attempts: 2,
      fetcher: this.options.fetcher,
      request: providerRequest("https://oauth2.googleapis.com/token", {
        body: new URLSearchParams({
          assertion,
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        method: "POST",
      }),
      sleep: this.options.sleep,
    });
    if (!payload.access_token || !payload.expires_in) {
      throw new AppError(
        502,
        "upstream_error",
        "Firebase OAuth did not return an access token.",
      );
    }
    this.access = {
      expiresAt: Date.now() + Math.max(60, payload.expires_in) * 1_000,
      token: payload.access_token,
    };
    return this.access.token;
  }

  async send(input: {
    body: string;
    data?: Record<string, string>;
    deepLinkPath?: string | null;
    title: string;
    token: string;
  }): Promise<{ providerMessageId: string }> {
    if (
      input.token.length < 16 ||
      input.token.length > 4_096 ||
      input.title.length > 120 ||
      input.body.length > 1_000
    ) {
      throw new AppError(
        400,
        "invalid_request",
        "The push notification is invalid.",
      );
    }
    const payload = await requestIntegrationJson<{ name?: string }>({
      attempts: 3,
      fetcher: this.options.fetcher,
      request: providerRequest(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
          this.configuration.projectId,
        )}/messages:send`,
        {
          body: JSON.stringify({
            message: {
              data: {
                ...(input.data ?? {}),
                ...(input.deepLinkPath
                  ? { deep_link_path: input.deepLinkPath }
                  : {}),
              },
              notification: {
                body: input.body,
                title: input.title,
              },
              token: input.token,
            },
          }),
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${await this.accessToken()}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      ),
      sleep: this.options.sleep,
    });
    if (!payload.name) {
      throw new AppError(
        502,
        "upstream_error",
        "Firebase did not return a message identifier.",
      );
    }
    return { providerMessageId: payload.name };
  }
}

export class ApnsPushClient {
  private jwt: { expiresAt: number; token: string } | null = null;

  constructor(
    private readonly configuration: {
      bundleId: string;
      environment: "production" | "sandbox";
      keyId: string;
      privateKey: string;
      teamId: string;
    },
    private readonly options: {
      fetcher?: (input: Request) => Promise<Response>;
      sleep?: IntegrationRequestOptions["sleep"];
    } = {},
  ) {
    if (
      !/^[A-Z0-9]{10}$/.test(configuration.teamId) ||
      !/^[A-Z0-9]{10}$/.test(configuration.keyId) ||
      !/^[A-Za-z0-9.-]{3,255}$/.test(configuration.bundleId) ||
      !["production", "sandbox"].includes(configuration.environment) ||
      !configuration.privateKey.includes("PRIVATE KEY")
    ) {
      throw new AppError(
        503,
        "activation_required",
        "Apple Push Notification credentials are not configured.",
      );
    }
  }

  private async authorizationToken(): Promise<string> {
    if (this.jwt && this.jwt.expiresAt > Date.now() + 5 * 60 * 1_000) {
      return this.jwt.token;
    }
    const issuedAt = Math.floor(Date.now() / 1_000);
    const header = base64Url(
      JSON.stringify({
        alg: "ES256",
        kid: this.configuration.keyId,
      }),
    );
    const claims = base64Url(
      JSON.stringify({
        iat: issuedAt,
        iss: this.configuration.teamId,
      }),
    );
    const unsigned = `${header}.${claims}`;
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8(this.configuration.privateKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      { hash: "SHA-256", name: "ECDSA" },
      key,
      Uint8Array.from(new TextEncoder().encode(unsigned)),
    );
    const token = `${unsigned}.${base64Url(signature)}`;
    this.jwt = {
      expiresAt: Date.now() + 50 * 60 * 1_000,
      token,
    };
    return token;
  }

  async send(input: {
    body: string;
    data?: Record<string, string>;
    deepLinkPath?: string | null;
    title: string;
    token: string;
  }): Promise<{ providerMessageId: string }> {
    if (!/^[a-f0-9]{32,512}$/i.test(input.token)) {
      throw new AppError(400, "invalid_request", "The APNs device token is invalid.");
    }
    const requestId = crypto.randomUUID();
    await requestIntegrationJson<void>({
      attempts: 3,
      fetcher: this.options.fetcher,
      request: providerRequest(
        `https://${
          this.configuration.environment === "sandbox"
            ? "api.sandbox.push.apple.com"
            : "api.push.apple.com"
        }/3/device/${encodeURIComponent(input.token)}`,
        {
          body: JSON.stringify({
            aps: {
              alert: {
                body: input.body,
                title: input.title,
              },
              sound: "default",
            },
            ...(input.data ?? {}),
            ...(input.deepLinkPath
              ? { deep_link_path: input.deepLinkPath }
              : {}),
          }),
          headers: {
            Authorization: `bearer ${await this.authorizationToken()}`,
            "Content-Type": "application/json",
            "apns-id": requestId,
            "apns-priority": "10",
            "apns-push-type": "alert",
            "apns-topic": this.configuration.bundleId,
          },
          method: "POST",
        },
      ),
      sleep: this.options.sleep,
    });
    return { providerMessageId: requestId };
  }
}

export function createPushClient(env: WorkerEnv): FcmPushClient {
  return new FcmPushClient({
    clientEmail: requireConfigured(env.FCM_CLIENT_EMAIL, "FCM_CLIENT_EMAIL"),
    privateKey: requireConfigured(env.FCM_PRIVATE_KEY, "FCM_PRIVATE_KEY"),
    projectId: requireConfigured(env.FCM_PROJECT_ID, "FCM_PROJECT_ID"),
  });
}

export function createApnsPushClient(env: WorkerEnv): ApnsPushClient {
  const bundleId = requireConfigured(env.APNS_BUNDLE_ID, "APNS_BUNDLE_ID");
  const mobileBundleId = requireConfigured(
    env.MOBILE_IOS_BUNDLE_ID,
    "MOBILE_IOS_BUNDLE_ID",
  );
  if (bundleId !== mobileBundleId) {
    throw new AppError(
      503,
      "activation_required",
      "APNS_BUNDLE_ID must match MOBILE_IOS_BUNDLE_ID.",
    );
  }
  return new ApnsPushClient({
    bundleId,
    environment: requireConfigured(
      env.APNS_ENVIRONMENT,
      "APNS_ENVIRONMENT",
    ) as "production" | "sandbox",
    keyId: requireConfigured(env.APNS_KEY_ID, "APNS_KEY_ID"),
    privateKey: requireConfigured(env.APNS_PRIVATE_KEY, "APNS_PRIVATE_KEY"),
    teamId: requireConfigured(env.APNS_TEAM_ID, "APNS_TEAM_ID"),
  });
}
