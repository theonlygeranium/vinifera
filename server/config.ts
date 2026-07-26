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
