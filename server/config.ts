import type {
  ConfigurationCapability,
  ConfigurationReport,
  WorkerEnv,
} from "./types";

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
  return {
    app: capability(env, ["APP_ORIGIN", "ALLOWED_ORIGINS"]),
    database: capability(env, [
      "SUPABASE_URL",
      env.SUPABASE_PUBLISHABLE_KEY ? "SUPABASE_PUBLISHABLE_KEY" : "SUPABASE_ANON_KEY",
      env.SUPABASE_SECRET_KEY ? "SUPABASE_SECRET_KEY" : "SUPABASE_SERVICE_ROLE_KEY",
    ]),
    billing: capability(env, [
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_VINE",
      "STRIPE_PRICE_CELLAR",
      "STRIPE_PRICE_ESTATE",
      "STRIPE_PRICE_RESERVE",
    ]),
    compliance,
    communications,
    customDomains: capability(env, [
      "CLOUDFLARE_CUSTOM_HOSTNAME_API_TOKEN",
      "CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN",
      "CLOUDFLARE_ZONE_ID",
    ]),
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
    push: capability(env, [
      "APNS_BUNDLE_ID",
      "APNS_ENVIRONMENT",
      "APNS_KEY_ID",
      "APNS_PRIVATE_KEY",
      "APNS_TEAM_ID",
      "FCM_CLIENT_EMAIL",
      "FCM_PRIVATE_KEY",
      "FCM_PROJECT_ID",
    ]),
    shipping,
  };
}

export function isProduction(env: WorkerEnv): boolean {
  return env.APP_ENV === "production";
}
