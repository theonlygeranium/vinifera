import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  cookieHeader,
  mergeCookieJar,
  plusAddress,
  splitSetCookieHeader,
} from "../../scripts/hosted-gate7-acceptance.mjs";

const repositoryRoot = new URL("../../", import.meta.url);

describe("hosted Gate 7 acceptance controller", () => {
  it("creates scoped plus-addresses without retaining an existing tag", () => {
    expect(plusAddress("Founder+old@EdStratumLabs.ai", "vinifera-g7-123")).toBe(
      "founder+vinifera-g7-123@edstratumlabs.ai",
    );
    expect(() => plusAddress("not-an-email", "tag")).toThrow(/email address/);
  });

  it("splits and merges host-only cookies", () => {
    const jar = new Map();
    const response = {
      headers: {
        get: () => "vinifera-member-auth-link=state.token; Path=/; HttpOnly, vinifera-member-brand=brand.token; Path=/; HttpOnly",
      },
    };
    expect(splitSetCookieHeader(response.headers.get())).toHaveLength(2);
    mergeCookieJar(jar, response);
    expect(cookieHeader(jar)).toBe(
      "vinifera-member-auth-link=state.token; vinifera-member-brand=brand.token",
    );
  });

  it("is opt-in and retains sanitized evidence from the protected staging job", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", repositoryRoot), "utf8");
    expect(workflow).toContain("vars.STAGING_HOSTED_ACCEPTANCE_ENABLED == 'true'");
    expect(workflow).toContain("scripts/hosted-gate7-acceptance.mjs");
    expect(workflow).toContain("vinifera-hosted-gate7-acceptance.json");
    expect(workflow).not.toContain("HOSTED_ACCEPTANCE_EMAIL_BASE: founder@");
  });
});
