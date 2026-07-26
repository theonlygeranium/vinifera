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
          env.APP_ENV !== "production" &&
          env.SHIPPING_SIMULATOR_ENABLED === "true"
        ? { configured: true, missing: [] }
        : {
            configured: false,
            missing:
              env.SHIPPING_PROVIDER === "simulated"
                ? [
                    ...(env.APP_ENV === "production" ? ["APP_ENV"] : []),
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
    communications,
    webhook: capability(env, ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]),
    googleOAuth: {
      configured: env.GOOGLE_OAUTH_ENABLED === "true",
      missing: env.GOOGLE_OAUTH_ENABLED === "true" ? [] : ["GOOGLE_OAUTH_ENABLED"],
    },
    email: {
      configured: env.AUTH_EMAIL_ENABLED === "true",
      missing: env.AUTH_EMAIL_ENABLED === "true" ? [] : ["AUTH_EMAIL_ENABLED"],
    },
    shipping,
  };
}

export function isProduction(env: WorkerEnv): boolean {
  return env.APP_ENV === "production";
}
