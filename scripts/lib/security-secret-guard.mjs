import {
  createHash,
  timingSafeEqual,
} from "node:crypto";

const MINIMUM_SECRET_BYTES = 32;

function checkedSecret(environment, name) {
  const value = environment[name];
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") < MINIMUM_SECRET_BYTES
  ) {
    throw new Error(
      `${name} must be a server-only secret of at least ${MINIMUM_SECRET_BYTES} UTF-8 bytes with no surrounding whitespace.`,
    );
  }
  return value;
}

function fingerprint(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function assertSecuritySecretSeparation(environment) {
  const rateLimitPepper = checkedSecret(environment, "RATE_LIMIT_PEPPER");
  const memberBrandContextSecret = checkedSecret(
    environment,
    "MEMBER_BRAND_CONTEXT_SECRET",
  );
  if (
    timingSafeEqual(
      fingerprint(rateLimitPepper),
      fingerprint(memberBrandContextSecret),
    )
  ) {
    throw new Error(
      "RATE_LIMIT_PEPPER and MEMBER_BRAND_CONTEXT_SECRET must be independently generated values.",
    );
  }
  return true;
}
