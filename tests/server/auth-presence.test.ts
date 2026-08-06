import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { hasAuthCredential } from "../../server/lib/auth-presence";

function requestWithHeaders(headers: Record<string, string>): Request {
  return {
    get(name: string) {
      return headers[name.toLowerCase()];
    },
    headers,
  } as unknown as Request;
}

describe("auth presence", () => {
  it.each([
    "vinifera-staff-auth=token",
    "vinifera-staff-auth.0=part-one; vinifera-staff-auth.1=part-two",
    "vinifera-member-auth=token",
    "vinifera-member-auth.0=part-one; vinifera-member-auth.1=part-two",
  ])("accepts the Supabase session cookie family: %s", (cookie) => {
    expect(hasAuthCredential(requestWithHeaders({ cookie }))).toBe(true);
  });

  it("rejects similarly prefixed state cookies and malformed chunk suffixes", () => {
    expect(
      hasAuthCredential(
        requestWithHeaders({
          cookie:
            "vinifera-member-auth-link=state; vinifera-staff-auth.invalid=not-a-session",
        }),
      ),
    ).toBe(false);
  });

  it("accepts a non-empty bearer credential", () => {
    expect(
      hasAuthCredential(requestWithHeaders({ authorization: "Bearer native-token" })),
    ).toBe(true);
  });
});
