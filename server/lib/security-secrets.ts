import type {
  ConfigurationCapability,
  WorkerEnv,
} from "../types";
import { AppError } from "./errors";

const MINIMUM_SECRET_BYTES = 32;
const encoder = new TextEncoder();

export interface SecuritySecrets {
  memberBrandContextSecret: string;
  rateLimitPepper: string;
}

type SecuritySecretBindings = Pick<
  WorkerEnv,
  "MEMBER_BRAND_CONTEXT_SECRET" | "RATE_LIMIT_PEPPER"
>;

function validSecret(value: string | undefined): value is string {
  return Boolean(
    value &&
      value === value.trim() &&
      encoder.encode(value).byteLength >= MINIMUM_SECRET_BYTES,
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length, 1);
  let different = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    different |=
      (leftBytes[index % leftBytes.length] ?? 0) ^
      (rightBytes[index % rightBytes.length] ?? 0);
  }
  return different === 0;
}

export function securitySecretConfiguration(
  env: SecuritySecretBindings,
): ConfigurationCapability {
  const missing: string[] = [];
  if (!validSecret(env.RATE_LIMIT_PEPPER)) {
    missing.push("RATE_LIMIT_PEPPER");
  }
  if (!validSecret(env.MEMBER_BRAND_CONTEXT_SECRET)) {
    missing.push("MEMBER_BRAND_CONTEXT_SECRET");
  }
  if (
    missing.length === 0 &&
    constantTimeEqual(
      env.RATE_LIMIT_PEPPER!,
      env.MEMBER_BRAND_CONTEXT_SECRET!,
    )
  ) {
    missing.push("RATE_LIMIT_PEPPER", "MEMBER_BRAND_CONTEXT_SECRET");
  }
  return { configured: missing.length === 0, missing };
}

export function requireSecuritySecrets(
  env: SecuritySecretBindings,
): SecuritySecrets {
  const configuration = securitySecretConfiguration(env);
  if (!configuration.configured) {
    throw new AppError(
      503,
      "configuration_error",
      "Independent server security secrets must be configured before this operation can run.",
    );
  }
  return {
    memberBrandContextSecret: env.MEMBER_BRAND_CONTEXT_SECRET!,
    rateLimitPepper: env.RATE_LIMIT_PEPPER!,
  };
}
