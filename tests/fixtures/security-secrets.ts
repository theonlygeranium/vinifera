import type { WorkerEnv } from "../../server/types";

const RATE_LIMIT_PEPPER =
  "test-rate-limit-pepper-7b15a76f-9f4e-49f6";
const MEMBER_BRAND_CONTEXT_SECRET =
  "test-member-context-secret-43f3b070-4f50-4a6b";

export function securitySecretTestFixture(): Pick<
  WorkerEnv,
  "MEMBER_BRAND_CONTEXT_SECRET" | "RATE_LIMIT_PEPPER"
> {
  return {
    MEMBER_BRAND_CONTEXT_SECRET,
    RATE_LIMIT_PEPPER,
  };
}
