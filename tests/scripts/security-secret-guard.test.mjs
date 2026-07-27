import { describe, expect, it } from "vitest";
import { assertSecuritySecretSeparation } from "../../scripts/lib/security-secret-guard.mjs";

const valid = {
  MEMBER_BRAND_CONTEXT_SECRET:
    "test-member-context-secret-43f3b070-4f50-4a6b",
  RATE_LIMIT_PEPPER:
    "test-rate-limit-pepper-7b15a76f-9f4e-49f6",
};

describe("deployment security-secret guard", () => {
  it("accepts independent strong bindings without returning them", () => {
    expect(assertSecuritySecretSeparation(valid)).toBe(true);
  });

  it.each([
    [{ ...valid, RATE_LIMIT_PEPPER: "" }, /RATE_LIMIT_PEPPER/],
    [
      {
        ...valid,
        MEMBER_BRAND_CONTEXT_SECRET: "short",
      },
      /MEMBER_BRAND_CONTEXT_SECRET/,
    ],
    [
      {
        MEMBER_BRAND_CONTEXT_SECRET:
          valid.RATE_LIMIT_PEPPER,
        RATE_LIMIT_PEPPER: valid.RATE_LIMIT_PEPPER,
      },
      /independently generated/,
    ],
    [
      {
        ...valid,
        RATE_LIMIT_PEPPER: ` ${valid.RATE_LIMIT_PEPPER}`,
      },
      /no surrounding whitespace/,
    ],
  ])("rejects unsafe deployment input", (environment, message) => {
    expect(() =>
      assertSecuritySecretSeparation(environment),
    ).toThrow(message);
  });
});
