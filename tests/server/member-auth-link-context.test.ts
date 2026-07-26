import { describe, expect, it } from "vitest";
import {
  issueMemberAuthLinkContext,
  verifyMemberAuthLinkCallback,
  verifyMemberAuthLinkContext,
} from "../../server/lib/member-brand-context";
import type { WorkerEnv } from "../../server/types";

const env: WorkerEnv = {
  APP_ENV: "test",
  MEMBER_BRAND_CONTEXT_SECRET: "test-member-context-secret-at-least-32-bytes",
};

describe("member web auth-link context", () => {
  it("signs and verifies the exact organization, brand, member, email, and host", async () => {
    const state = await issueMemberAuthLinkContext(env, {
      brandId: "30000000-0000-4000-8000-000000000003",
      emailHash: "a".repeat(64),
      memberId: "40000000-0000-4000-8000-000000000004",
      nonce: "50000000-0000-4000-8000-000000000005",
      organizationId: "20000000-0000-4000-8000-000000000002",
      requestHost: "club.example.test",
    });

    await expect(verifyMemberAuthLinkContext(env, state)).resolves.toMatchObject(
      {
        brandId: "30000000-0000-4000-8000-000000000003",
        emailHash: "a".repeat(64),
        memberId: "40000000-0000-4000-8000-000000000004",
        organizationId: "20000000-0000-4000-8000-000000000002",
        requestHost: "club.example.test",
      },
    );
    await expect(
      verifyMemberAuthLinkCallback(env, {
        cookieState: state,
        requestHost: "club.example.test",
        state,
      }),
    ).resolves.toMatchObject({
      memberId: "40000000-0000-4000-8000-000000000004",
    });
  });

  it("rejects a tampered cookie, a different state, and a callback host mismatch", async () => {
    const state = await issueMemberAuthLinkContext(env, {
      brandId: "30000000-0000-4000-8000-000000000003",
      emailHash: "b".repeat(64),
      memberId: "40000000-0000-4000-8000-000000000004",
      nonce: "50000000-0000-4000-8000-000000000005",
      organizationId: "20000000-0000-4000-8000-000000000002",
      requestHost: "club.example.test",
    });

    await expect(
      verifyMemberAuthLinkCallback(env, {
        cookieState: `${state}tampered`,
        requestHost: "club.example.test",
        state,
      }),
    ).resolves.toBeNull();
    await expect(
      verifyMemberAuthLinkCallback(env, {
        cookieState: state,
        requestHost: "other.example.test",
        state,
      }),
    ).resolves.toBeNull();
    await expect(
      verifyMemberAuthLinkContext(
        env,
        `${state.slice(0, -1)}${state.endsWith("a") ? "b" : "a"}`,
      ),
    ).resolves.toBeNull();
  });
});
