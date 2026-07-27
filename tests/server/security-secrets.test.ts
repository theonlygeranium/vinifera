import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  requireSecuritySecrets,
  securitySecretConfiguration,
} from "../../server/lib/security-secrets";
import { issueMemberAuthLinkContext } from "../../server/lib/member-brand-context";
import { securitySecretTestFixture } from "../fixtures/security-secrets";

const serverRoot = fileURLToPath(new URL("../../server/", import.meta.url));
const SECURITY_BINDING_NAMES = [
  "MEMBER_BRAND_CONTEXT_SECRET",
  "RATE_LIMIT_PEPPER",
];

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return nested.flat();
}

describe("purpose-separated application security secrets", () => {
  it("keeps direct secret-binding access inside the type and neutral security owners", async () => {
    const owners: string[] = [];
    for (const path of await sourceFiles(serverRoot)) {
      const source = await readFile(path, "utf8");
      if (SECURITY_BINDING_NAMES.some((name) => source.includes(name))) {
        owners.push(relative(serverRoot, path));
      }
    }

    expect(owners.sort()).toEqual([
      "lib/security-secrets.ts",
      "types.ts",
    ]);
  });

  it("accepts only the explicit isolated test fixture", () => {
    expect(
      securitySecretConfiguration(securitySecretTestFixture()),
    ).toEqual({
      configured: true,
      missing: [],
    });
    expect(() =>
      requireSecuritySecrets(securitySecretTestFixture()),
    ).not.toThrow();
  });

  it.each([
    [{}, ["RATE_LIMIT_PEPPER", "MEMBER_BRAND_CONTEXT_SECRET"]],
    [
      {
        MEMBER_BRAND_CONTEXT_SECRET:
          "test-member-context-secret-43f3b070-4f50-4a6b",
      },
      ["RATE_LIMIT_PEPPER"],
    ],
    [
      {
        RATE_LIMIT_PEPPER:
          "test-rate-limit-pepper-7b15a76f-9f4e-49f6",
      },
      ["MEMBER_BRAND_CONTEXT_SECRET"],
    ],
    [
      {
        MEMBER_BRAND_CONTEXT_SECRET: "too-short",
        RATE_LIMIT_PEPPER: "also-too-short",
      },
      ["RATE_LIMIT_PEPPER", "MEMBER_BRAND_CONTEXT_SECRET"],
    ],
    [
      {
        MEMBER_BRAND_CONTEXT_SECRET:
          " test-member-context-secret-43f3b070-4f50-4a6b",
        RATE_LIMIT_PEPPER:
          "test-rate-limit-pepper-7b15a76f-9f4e-49f6 ",
      },
      ["RATE_LIMIT_PEPPER", "MEMBER_BRAND_CONTEXT_SECRET"],
    ],
  ])("fails closed for missing or weak bindings", (env, missing) => {
    expect(securitySecretConfiguration(env)).toEqual({
      configured: false,
      missing,
    });
    expect(() => requireSecuritySecrets(env)).toThrowError(
      expect.objectContaining({
        code: "configuration_error",
        status: 503,
      }),
    );
  });

  it("rejects reuse of one value for both security purposes", () => {
    const reused = "test-reused-secret-fb698ad5-d728-4fb4";
    const env = {
      MEMBER_BRAND_CONTEXT_SECRET: reused,
      RATE_LIMIT_PEPPER: reused,
    };
    expect(securitySecretConfiguration(env)).toEqual({
      configured: false,
      missing: [
        "RATE_LIMIT_PEPPER",
        "MEMBER_BRAND_CONTEXT_SECRET",
      ],
    });
    expect(() => requireSecuritySecrets(env)).toThrowError(
      expect.objectContaining({ code: "configuration_error" }),
    );
  });

  it("does not let a member-context path fall back to a different credential", async () => {
    await expect(
      issueMemberAuthLinkContext(
        {
          MEMBER_BRAND_CONTEXT_SECRET:
            "test-member-context-secret-43f3b070-4f50-4a6b",
          SUPABASE_SECRET_KEY: "test-supabase-secret",
        },
        {
          brandId: "30000000-0000-4000-8000-000000000003",
          emailHash: "a".repeat(64),
          memberId: "40000000-0000-4000-8000-000000000004",
          nonce: "50000000-0000-4000-8000-000000000005",
          organizationId: "20000000-0000-4000-8000-000000000002",
          requestHost: "club.example.test",
        },
      ),
    ).rejects.toMatchObject({
      code: "configuration_error",
      status: 503,
    });
  });
});
