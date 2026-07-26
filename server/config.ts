import type {
  ConfigurationCapability,
  ConfigurationReport,
  WorkerEnv,
} from "./types";
import { AppError, requireConfigured } from "./lib/errors";
import {
  assertCloudflareCustomHostnameTarget,
  assertEasyPostTarget,
  assertFcmProjectTarget,
  assertShipCompliantTarget,
} from "./provider-targets";

export type ProviderEnvironment = "live" | "production" | "sandbox" | "test";
export type ProtectedProvider = "APNs" | "Avalara" | "QuickBooks" | "Stripe";
export type StripeCredentialMode = "live" | "test";

function capability(env: WorkerEnv, names: Array<keyof WorkerEnv>): ConfigurationCapability {
  const missing = names.filter((name) => !env[name]).map(String);
  return { configured: missing.length === 0, missing };
}

export function getAllowedOrigins(env: WorkerEnv): string[] {
  const configured = env.ALLOWED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured?.length) {
    return configured;
  }

  return [env.APP_ORIGIN ?? "http://localhost:5173"];
}

export function getConfigurationReport(env: WorkerEnv): ConfigurationReport {
  const billing = capability(env, [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_VINE",
    "STRIPE_PRICE_CELLAR",
    "STRIPE_PRICE_ESTATE",
    "STRIPE_PRICE_RESERVE",
  ]);
  if (env.STRIPE_SECRET_KEY) {
    try {
      if (
        stripeCredentialMode(env) === "live" &&
        env.LIVE_BILLING_ENABLED !== "true"
      ) {
        billing.configured = false;
        billing.missing.push("LIVE_BILLING_ENABLED");
      }
    } catch {
      billing.configured = false;
      if (!billing.missing.includes("STRIPE_SECRET_KEY")) {
        billing.missing.push("STRIPE_SECRET_KEY");
      }
    }
  }
  const compliance =
    env.COMPLIANCE_PROVIDER === "shipcompliant"
      ? capability(env, [
          "COMPLIANCE_PROVIDER",
          "SHIPCOMPLIANT_BASE_URL",
          "SHIPCOMPLIANT_ACCOUNT_ID",
          "SHIPCOMPLIANT_API_KEY",
          "SHIPCOMPLIANT_API_SECRET",
          "SHIPCOMPLIANT_CHECK_PATH",
          "SHIPCOMPLIANT_CONTRACT_VERSION",
          "SHIPCOMPLIANT_ENDPOINT_MODE",
          "SHIPCOMPLIANT_LICENSE_ID",
        ])
      : env.COMPLIANCE_PROVIDER === "simulated" &&
          env.APP_ENV === "test" &&
          env.COMPLIANCE_SIMULATOR_ENABLED === "true"
        ? { configured: true, missing: [] }
        : {
            configured: false,
            missing:
              env.COMPLIANCE_PROVIDER === "simulated"
                ? [
                    ...(env.APP_ENV === "test" ? [] : ["APP_ENV"]),
                    ...(env.COMPLIANCE_SIMULATOR_ENABLED === "true"
                      ? []
                      : ["COMPLIANCE_SIMULATOR_ENABLED"]),
                  ]
                : ["COMPLIANCE_PROVIDER"],
          };
  if (env.COMPLIANCE_PROVIDER === "shipcompliant" && env.SHIPCOMPLIANT_BASE_URL) {
    try {
      if (new URL(env.SHIPCOMPLIANT_BASE_URL).protocol !== "https:") {
        throw new Error("ShipCompliant must use HTTPS.");
      }
    } catch {
      compliance.configured = false;
      if (!compliance.missing.includes("SHIPCOMPLIANT_BASE_URL")) {
        compliance.missing.push("SHIPCOMPLIANT_BASE_URL");
      }
    }
    try {
      assertShipCompliantTarget({
        appEnvironment: env.APP_ENV,
        baseUrl: env.SHIPCOMPLIANT_BASE_URL,
        endpointMode: env.SHIPCOMPLIANT_ENDPOINT_MODE,
      });
    } catch {
      compliance.configured = false;
      if (!compliance.missing.includes("SHIPCOMPLIANT_ENDPOINT_MODE")) {
        compliance.missing.push("SHIPCOMPLIANT_ENDPOINT_MODE");
      }
    }
  }
  const communications =
    env.EMAIL_PROVIDER === "resend"
      ? capability(env, [
          "EMAIL_PROVIDER",
          "RESEND_API_KEY",
          "RESEND_FROM",
          "RESEND_SENDING_DOMAIN",
          "RESEND_DOMAIN_VERIFIED",
          "RESEND_WEBHOOK_SECRET",
          "UNSUBSCRIBE_SIGNING_SECRET",
        ])
      : env.EMAIL_PROVIDER === "simulated" &&
          env.APP_ENV === "test" &&
          env.EMAIL_SIMULATOR_ENABLED === "true" &&
          Boolean(env.UNSUBSCRIBE_SIGNING_SECRET)
        ? { configured: true, missing: [] }
        : {
            configured: false,
            missing:
              env.EMAIL_PROVIDER === "simulated"
                ? [
                    ...(env.APP_ENV === "test" ? [] : ["APP_ENV"]),
                    ...(env.EMAIL_SIMULATOR_ENABLED === "true"
                      ? []
                      : ["EMAIL_SIMULATOR_ENABLED"]),
                    ...(env.UNSUBSCRIBE_SIGNING_SECRET
                      ? []
                      : ["UNSUBSCRIBE_SIGNING_SECRET"]),
                  ]
                : ["EMAIL_PROVIDER"],
          };
  if (
    env.EMAIL_PROVIDER === "resend" &&
    env.RESEND_DOMAIN_VERIFIED !== "true" &&
    !communications.missing.includes("RESEND_DOMAIN_VERIFIED")
  ) {
    communications.configured = false;
    communications.missing.push("RESEND_DOMAIN_VERIFIED");
  }
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_FROM && env.RESEND_SENDING_DOMAIN) {
    const fromAddress = env.RESEND_FROM.match(
      /(?:<)?([^<>\s]+@([^<>\s]+))(?:>)?$/,
    )?.[1];
    const fromDomain = fromAddress?.split("@")[1]?.toLowerCase();
    if (fromDomain !== env.RESEND_SENDING_DOMAIN.toLowerCase()) {
      communications.configured = false;
      if (!communications.missing.includes("RESEND_FROM")) {
        communications.missing.push("RESEND_FROM");
      }
    }
  }
  const shipping =
    env.SHIPPING_PROVIDER === "easypost"
      ? capability(env, ["SHIPPING_PROVIDER", "EASYPOST_API_KEY"])
      : env.SHIPPING_PROVIDER === "simulated" &&
          env.APP_ENV === "test" &&
          env.SHIPPING_SIMULATOR_ENABLED === "true"
        ? { configured: true, missing: [] }
        : {
            configured: false,
            missing:
              env.SHIPPING_PROVIDER === "simulated"
                ? [
                    ...(env.APP_ENV === "test" ? [] : ["APP_ENV"]),
                    ...(env.SHIPPING_SIMULATOR_ENABLED === "true"
                      ? []
                      : ["SHIPPING_SIMULATOR_ENABLED"]),
                  ]
                : ["SHIPPING_PROVIDER"],
          };
  if (env.SHIPPING_PROVIDER === "easypost" && env.EASYPOST_API_KEY) {
    try {
      assertEasyPostTarget({
        apiKey: env.EASYPOST_API_KEY,
        appEnvironment: env.APP_ENV,
        liveLabelsEnabled: env.EASYPOST_LIVE_LABELS_ENABLED,
      });
    } catch {
      shipping.configured = false;
      if (!shipping.missing.includes("EASYPOST_LIVE_LABELS_ENABLED")) {
        shipping.missing.push("EASYPOST_LIVE_LABELS_ENABLED");
      }
    }
  }
  const customDomains = capability(env, [
    "CLOUDFLARE_CUSTOM_HOSTNAME_API_TOKEN",
    "CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN",
    "CLOUDFLARE_ZONE_ID",
  ]);
  if (
    env.CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN &&
    env.CLOUDFLARE_ZONE_ID
  ) {
    try {
      assertCloudflareCustomHostnameTarget({
        appEnvironment: env.APP_ENV,
        fallbackOrigin: env.CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN,
        zoneId: env.CLOUDFLARE_ZONE_ID,
      });
    } catch {
      customDomains.configured = false;
      if (!customDomains.missing.includes("CLOUDFLARE_ZONE_ID")) {
        customDomains.missing.push("CLOUDFLARE_ZONE_ID");
      }
    }
  }
  const push = capability(env, [
    "APNS_BUNDLE_ID",
    "APNS_ENVIRONMENT",
    "APNS_KEY_ID",
    "APNS_PRIVATE_KEY",
    "APNS_TEAM_ID",
    "FCM_CLIENT_EMAIL",
    "FCM_PRIVATE_KEY",
    "FCM_PROJECT_ID",
  ]);
  if (env.FCM_PROJECT_ID) {
    try {
      assertFcmProjectTarget(env);
    } catch {
      push.configured = false;
      if (!push.missing.includes("FCM_PROJECT_ID")) {
        push.missing.push("FCM_PROJECT_ID");
      }
    }
  }
  return {
    app: capability(env, ["APP_ORIGIN", "ALLOWED_ORIGINS"]),
    database: capability(env, [
      "SUPABASE_URL",
      env.SUPABASE_PUBLISHABLE_KEY ? "SUPABASE_PUBLISHABLE_KEY" : "SUPABASE_ANON_KEY",
      env.SUPABASE_SECRET_KEY ? "SUPABASE_SECRET_KEY" : "SUPABASE_SERVICE_ROLE_KEY",
    ]),
    billing,
    compliance,
    communications,
    customDomains,
    webhook: capability(env, ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]),
    googleOAuth: {
      configured: env.GOOGLE_OAUTH_ENABLED === "true",
      missing: env.GOOGLE_OAUTH_ENABLED === "true" ? [] : ["GOOGLE_OAUTH_ENABLED"],
    },
    email: {
      configured: env.AUTH_EMAIL_ENABLED === "true",
      missing: env.AUTH_EMAIL_ENABLED === "true" ? [] : ["AUTH_EMAIL_ENABLED"],
    },
    integrationEncryption: capability(env, [
      "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION",
      "INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS",
    ]),
    mobile: capability(env, [
      "MOBILE_ANDROID_LATEST_VERSION",
      "MOBILE_ANDROID_MINIMUM_VERSION",
      "MOBILE_ANDROID_PACKAGE_NAME",
      "MOBILE_ANDROID_SIGNING_CERT_SHA256",
      "MOBILE_APPLE_TEAM_ID",
      "MOBILE_AUTH_EMAIL_TEMPLATE_ENABLED",
      "MOBILE_AUTH_STATE_SIGNING_SECRET",
      "MOBILE_IOS_BUNDLE_ID",
      "MOBILE_IOS_LATEST_VERSION",
      "MOBILE_IOS_MINIMUM_VERSION",
    ]),
    quickBooksOAuth: capability(env, [
      "QUICKBOOKS_CLIENT_ID",
      "QUICKBOOKS_CLIENT_SECRET",
      "QUICKBOOKS_ENVIRONMENT",
      "QUICKBOOKS_REDIRECT_URI",
      "QUICKBOOKS_STATE_SIGNING_SECRET",
    ]),
    push,
    shipping,
  };
}

export function isProduction(env: WorkerEnv): boolean {
  return env.APP_ENV === "production";
}

export function usesSecureCookies(env: WorkerEnv): boolean {
  return env.APP_ENV === "staging" || isProduction(env);
}

export function assertProviderEnvironment(
  env: WorkerEnv,
  provider: ProtectedProvider,
  environment: ProviderEnvironment,
): void {
  if (
    (environment === "live" || environment === "production") &&
    !isProduction(env)
  ) {
    throw new AppError(
      503,
      "activation_required",
      `${provider} production mode requires APP_ENV=production.`,
    );
  }
}

export function stripeCredentialMode(env: WorkerEnv): StripeCredentialMode {
  const secretKey = requireConfigured(env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY");
  const match = secretKey.match(/^(?:rk|sk)_(live|test)_/);
  if (!match) {
    throw new AppError(
      503,
      "activation_required",
      "STRIPE_SECRET_KEY must be a Stripe test or live secret key.",
    );
  }
  const mode = match[1] as StripeCredentialMode;
  assertProviderEnvironment(env, "Stripe", mode);
  return mode;
}

export function assertStripeBillingAuthority(env: WorkerEnv): void {
  if (
    stripeCredentialMode(env) === "live" &&
    env.LIVE_BILLING_ENABLED !== "true"
  ) {
    throw new AppError(
      503,
      "activation_required",
      "Live Stripe billing requires LIVE_BILLING_ENABLED=true.",
    );
  }
}

export function canProvisionStripeCustomer(env: WorkerEnv): boolean {
  if (!env.STRIPE_SECRET_KEY) return false;
  try {
    assertStripeBillingAuthority(env);
    return true;
  } catch {
    return false;
  }
}

export function assertAvalaraBaseUrlEnvironment(
  env: WorkerEnv,
  baseUrl: string,
): void {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    throw new AppError(
      503,
      "activation_required",
      "The Avalara endpoint is invalid.",
    );
  }
  if (origin === "https://sandbox-rest.avatax.com") {
    assertProviderEnvironment(env, "Avalara", "sandbox");
    return;
  }
  if (origin === "https://rest.avatax.com") {
    assertProviderEnvironment(env, "Avalara", "production");
    return;
  }
  throw new AppError(
    503,
    "activation_required",
    "The Avalara endpoint is not allowlisted.",
  );
}
