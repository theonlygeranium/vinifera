import { createHash } from "node:crypto";
import checkedInPolicy from "../config/provider-target-policy.json";
import { AppError } from "./lib/errors";
import type { WorkerEnv } from "./types";

const SHA256 = /^[a-f0-9]{64}$/;
const CLOUDFLARE_ID = /^[a-f0-9]{32}$/;
const FCM_PROJECT_ID = /^[a-z][a-z0-9-]{4,62}$/;
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface ProviderTargetPolicy {
  schemaVersion: 1;
  cloudflareCustomHostnames: {
    production: {
      fallbackOriginSha256: string[];
      zoneIdSha256: string[];
    };
    staging: {
      fallbackOriginSha256: string[];
      zoneIdSha256: string[];
    };
  };
  fcm: {
    productionProjectIdSha256: string[];
    stagingProjectIdSha256: string[];
  };
  shipCompliant: {
    productionModeEnabled: boolean;
    productionOriginSha256: string[];
    productionSandboxOriginSha256: string[];
    stagingSandboxOriginSha256: string[];
  };
}

export const providerTargetPolicy = checkedInPolicy as ProviderTargetPolicy;

function activationRequired(message: string): never {
  throw new AppError(503, "activation_required", message);
}

function checkedHashes(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !SHA256.test(entry)) ||
    new Set(value).size !== value.length
  ) {
    activationRequired(`${label} contains an invalid reviewed hash policy.`);
  }
  return value as string[];
}

function assertPolicy(policy: ProviderTargetPolicy): void {
  if (!policy || policy.schemaVersion !== 1) {
    activationRequired("The provider target policy version is unsupported.");
  }
}

export function sha256ProviderTarget(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertHashAllowed(
  hashes: unknown,
  normalized: string,
  label: string,
): string {
  const allowed = checkedHashes(hashes, label);
  const fingerprint = sha256ProviderTarget(normalized);
  if (allowed.length === 0 || !allowed.includes(fingerprint)) {
    activationRequired(`${label} is not authorized by reviewed policy.`);
  }
  return fingerprint;
}

function normalizeCloudflareId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!CLOUDFLARE_ID.test(normalized)) {
    activationRequired("The Cloudflare zone identity is invalid.");
  }
  return normalized;
}

function normalizeFallbackOrigin(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.+$/, "");
  if (
    !HOSTNAME.test(normalized) ||
    /^\d+(?:\.\d+){3}$/.test(normalized)
  ) {
    activationRequired("The Cloudflare fallback origin is invalid.");
  }
  return normalized;
}

function normalizeFcmProjectId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!FCM_PROJECT_ID.test(normalized)) {
    activationRequired("The Firebase project identity is invalid.");
  }
  return normalized;
}

export function normalizeShipCompliantOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    activationRequired("The ShipCompliant endpoint origin is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !HOSTNAME.test(parsed.hostname.toLowerCase())
  ) {
    activationRequired(
      "The ShipCompliant endpoint must be a canonical HTTPS origin.",
    );
  }
  return parsed.origin.toLowerCase();
}

function environmentScope(
  appEnvironment: WorkerEnv["APP_ENV"],
): "production" | "staging" {
  return appEnvironment === "production" ? "production" : "staging";
}

export function easyPostCredentialMode(apiKey: string): "live" | "test" {
  const normalized = apiKey.trim();
  if (/^EZTK[A-Za-z0-9]{8,}$/.test(normalized)) return "test";
  if (/^EZAK[A-Za-z0-9]{8,}$/.test(normalized)) return "live";
  activationRequired("The EasyPost credential must be a test or live API key.");
}

export function assertEasyPostTarget(input: {
  apiKey: string;
  appEnvironment: WorkerEnv["APP_ENV"];
  liveLabelsEnabled?: WorkerEnv["EASYPOST_LIVE_LABELS_ENABLED"];
}): "live" | "test" {
  const mode = easyPostCredentialMode(input.apiKey);
  if (mode === "live") {
    if (input.appEnvironment !== "production") {
      activationRequired(
        "Non-production EasyPost operations require an EZTK test key.",
      );
    }
    if (input.liveLabelsEnabled !== "true") {
      activationRequired(
        "Live EasyPost labels require independent production authority.",
      );
    }
  }
  return mode;
}

export function assertCloudflareCustomHostnameTarget(
  input: {
    appEnvironment: WorkerEnv["APP_ENV"];
    fallbackOrigin: string;
    zoneId: string;
  },
  policy: ProviderTargetPolicy = providerTargetPolicy,
): { fallbackOriginSha256: string; zoneIdSha256: string } {
  assertPolicy(policy);
  const scope = environmentScope(input.appEnvironment);
  const targets = policy.cloudflareCustomHostnames[scope];
  const fallbackOrigin = normalizeFallbackOrigin(input.fallbackOrigin);
  const zoneId = normalizeCloudflareId(input.zoneId);
  return {
    fallbackOriginSha256: assertHashAllowed(
      targets.fallbackOriginSha256,
      fallbackOrigin,
      `The ${scope} Cloudflare fallback origin`,
    ),
    zoneIdSha256: assertHashAllowed(
      targets.zoneIdSha256,
      zoneId,
      `The ${scope} Cloudflare zone`,
    ),
  };
}

export function assertFcmProjectTarget(
  env: Pick<WorkerEnv, "APP_ENV" | "FCM_PROJECT_ID">,
  policy: ProviderTargetPolicy = providerTargetPolicy,
): string {
  assertPolicy(policy);
  const projectId = normalizeFcmProjectId(env.FCM_PROJECT_ID ?? "");
  const hashes =
    env.APP_ENV === "production"
      ? policy.fcm.productionProjectIdSha256
      : policy.fcm.stagingProjectIdSha256;
  return assertHashAllowed(
    hashes,
    projectId,
    `The ${environmentScope(env.APP_ENV)} Firebase project`,
  );
}

export function assertShipCompliantTarget(
  input: {
    appEnvironment: WorkerEnv["APP_ENV"];
    baseUrl: string;
    endpointMode: WorkerEnv["SHIPCOMPLIANT_ENDPOINT_MODE"];
  },
  policy: ProviderTargetPolicy = providerTargetPolicy,
): {
  endpointMode: "production" | "sandbox";
  origin: string;
  originSha256: string;
} {
  assertPolicy(policy);
  const origin = normalizeShipCompliantOrigin(input.baseUrl);
  if (
    input.endpointMode !== "sandbox" &&
    input.endpointMode !== "production"
  ) {
    activationRequired(
      "SHIPCOMPLIANT_ENDPOINT_MODE must be sandbox or production.",
    );
  }
  if (
    input.appEnvironment !== "production" &&
    input.endpointMode !== "sandbox"
  ) {
    activationRequired(
      "Non-production ShipCompliant requests require sandbox mode.",
    );
  }
  let hashes: string[];
  if (input.appEnvironment !== "production") {
    hashes = policy.shipCompliant.stagingSandboxOriginSha256;
  } else if (input.endpointMode === "sandbox") {
    hashes = policy.shipCompliant.productionSandboxOriginSha256;
  } else {
    if (!policy.shipCompliant.productionModeEnabled) {
      activationRequired(
        "ShipCompliant production mode is disabled by reviewed policy.",
      );
    }
    hashes = policy.shipCompliant.productionOriginSha256;
  }
  return {
    endpointMode: input.endpointMode,
    origin,
    originSha256: assertHashAllowed(
      hashes,
      origin,
      `The ${environmentScope(input.appEnvironment)} ShipCompliant ${input.endpointMode} origin`,
    ),
  };
}
