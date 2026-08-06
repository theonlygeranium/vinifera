import {
  constants,
  createCipheriv,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  cookieHeader,
  decryptMagicLinkEnvelope,
  expectStatus,
  hasCookieFamily,
  mergeCookieJar,
  plusAddress,
  splitSetCookieHeader,
  validateMagicActionLink,
} from "../../scripts/hosted-gate7-acceptance.mjs";

const repositoryRoot = new URL("../../", import.meta.url);

describe("hosted Gate 7 acceptance controller", () => {
  it("creates scoped plus-addresses and retains only sanitized HTTP errors", () => {
    expect(plusAddress("Founder+old@EdStratumLabs.ai", "vinifera-g7-123")).toBe(
      "founder+vinifera-g7-123@edstratumlabs.ai",
    );
    expect(() => plusAddress("not-an-email", "tag")).toThrow(/email address/);
    expect(() =>
      expectStatus(
        {
          body: {
            error: {
              code: "configuration_error",
              message: "Member sign-in is temporarily unavailable.",
              requestId: "omitted-from-diagnostic",
            },
          },
          response: { status: 503 },
        },
        200,
        "member magic-link request",
      ),
    ).toThrow(
      "member magic-link request: expected HTTP 200, received 503. configuration_error: Member sign-in is temporarily unavailable.",
    );
  });

  it("splits and merges host-only cookies", () => {
    const jar = new Map();
    const response = {
      headers: {
        get: () => "vinifera-member-auth-link=state.token; Path=/; HttpOnly, vinifera-member-brand=brand.token; Path=/; HttpOnly",
        getSetCookie: () => [
          "vinifera-member-auth=; Path=/; Max-Age=0; HttpOnly",
          "vinifera-member-auth.0=part-one; Path=/; Expires=Thu, 06 Aug 2037 07:00:00 GMT; HttpOnly, vinifera-member-auth.1=part-two; Path=/; HttpOnly",
        ],
      },
    };
    expect(splitSetCookieHeader(response.headers.get())).toHaveLength(2);
    mergeCookieJar(jar, response);
    expect(cookieHeader(jar)).toBe(
      "vinifera-member-auth.0=part-one; vinifera-member-auth.1=part-two",
    );
  });

  it("recognizes unchunked and Supabase SSR chunked Auth cookie families", () => {
    expect(hasCookieFamily(new Map([["vinifera-staff-auth", "token"]]), "vinifera-staff-auth")).toBe(true);
    expect(
      hasCookieFamily(
        new Map([
          ["vinifera-member-auth.0", "part-one"],
          ["vinifera-member-auth.1", "part-two"],
        ]),
        "vinifera-member-auth",
      ),
    ).toBe(true);
    expect(
      hasCookieFamily(new Map([["vinifera-member-auth-link", "state"]]), "vinifera-member-auth"),
    ).toBe(false);
    expect(
      hasCookieFamily(new Map([["vinifera-member-auth", ""]]), "vinifera-member-auth"),
    ).toBe(false);
  });

  it("validates the real Supabase magic link against the requested PKCE callback", () => {
    const callback = "https://staging.example.com/api/auth/member/callback?state=expected";
    const link = new URL("https://project.supabase.co/auth/v1/verify");
    link.searchParams.set("token", "opaque");
    link.searchParams.set("type", "magiclink");
    link.searchParams.set("redirect_to", callback);
    expect(
      validateMagicActionLink(link.toString(), {
        callback,
        state: "expected",
        supabaseUrl: "https://project.supabase.co",
      }).toString(),
    ).toBe(link.toString());
    link.searchParams.set("redirect_to", callback.replace("expected", "wrong"));
    expect(() =>
      validateMagicActionLink(link.toString(), {
        callback,
        state: "expected",
        supabaseUrl: "https://project.supabase.co",
      }),
    ).toThrow(/does not match/);
  });

  it("decrypts a run-bound hybrid magic-link envelope", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update("https://example.com/".repeat(30)), cipher.final()]);
    const envelope = JSON.stringify({
      ciphertext: ciphertext.toString("base64"),
      encryptedKey: publicEncrypt(
        {
          key: publicKey,
          oaepHash: "sha256",
          padding: constants.RSA_PKCS1_OAEP_PADDING,
        },
        key,
      ).toString("base64"),
      handoffId: "run-1",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    });
    expect(decryptMagicLinkEnvelope(envelope, privateKey, "run-1")).toBe(
      "https://example.com/".repeat(30),
    );
    expect(() => decryptMagicLinkEnvelope(envelope, privateKey, "run-2")).toThrow(/does not match/);
  });

  it("is opt-in and retains sanitized evidence from the protected staging job", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", repositoryRoot), "utf8");
    expect(workflow).toContain("vars.STAGING_HOSTED_ACCEPTANCE_ENABLED == 'true'");
    expect(workflow).toContain("scripts/hosted-gate7-acceptance.mjs");
    expect(workflow).toContain("vinifera-hosted-gate7-acceptance.json");
    expect(workflow).toContain(
      "HOSTED_ACCEPTANCE_GITHUB_TOKEN: ${{ secrets.STAGING_GITHUB_VARIABLES_TOKEN }}",
    );
    expect(workflow).not.toContain("HOSTED_ACCEPTANCE_EMAIL_BASE: founder@");
  });

  it("does not mint bypass links, delete audit-backed fixtures, or advance the global clock", async () => {
    const controller = await readFile(
      new URL("scripts/hosted-gate7-acceptance.mjs", repositoryRoot),
      "utf8",
    );
    expect(controller).not.toContain("admin.auth.admin.generateLink");
    expect(controller).not.toContain('.from("organizations").delete()');
    expect(controller).not.toContain("admin.auth.admin.deleteUser");
    expect(controller).not.toContain("stripe.customers.del");
    expect(controller).not.toMatch(/p_as_of:\s*(restrictedAt|suspendedAt)/u);
    expect(controller.indexOf("const firstActive = await deliver(activeEvent)")).toBeLessThan(
      controller.indexOf('"/api/auth/member/magic-link"'),
    );
    expect(controller).toContain("HOSTED_GATE7_MAGIC_LINK_HANDOFF");
    expect(controller).toContain("::notice title=Hosted Gate 7 magic-link handoff::");
  });
});
