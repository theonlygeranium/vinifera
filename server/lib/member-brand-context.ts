import { parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import type { Request, Response } from "express";
import type { WorkerEnv } from "../types";
import { AppError, requireConfigured } from "./errors";
import { usesSecureCookies } from "../config";

export const MEMBER_BRAND_CONTEXT_COOKIE = "vinifera-member-brand";
export const MEMBER_AUTH_LINK_CONTEXT_COOKIE = "vinifera-member-auth-link";
const CONTEXT_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_LINK_TTL_SECONDS = 15 * 60;

interface MemberBrandContext {
  brandId: string;
  expiresAt: number;
  memberId: string;
  organizationId: string;
}

export interface MemberAuthLinkContext {
  brandId: string;
  emailHash: string;
  expiresAt: number;
  memberId: string;
  nonce: string;
  organizationId: string;
  requestHost: string;
}

function contextSecret(env: WorkerEnv): string {
  return requireConfigured(
    env.MEMBER_BRAND_CONTEXT_SECRET ??
      env.RATE_LIMIT_PEPPER,
    "MEMBER_BRAND_CONTEXT_SECRET",
  );
}

function base64url(value: Uint8Array | string): string {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}

function decodeBase64url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function signature(env: WorkerEnv, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(contextSecret(env)),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payload),
      ),
    ),
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let different = 0;
  for (let index = 0; index < a.length; index += 1) {
    different |= a[index]! ^ b[index]!;
  }
  return different === 0;
}

export function memberAuthLinkTokensMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return Boolean(left && right && constantTimeEqual(left, right));
}

export async function issueMemberBrandContext(
  env: WorkerEnv,
  input: Omit<MemberBrandContext, "expiresAt">,
): Promise<string> {
  const payload = base64url(
    JSON.stringify({
      ...input,
      expiresAt: Math.floor(Date.now() / 1_000) + CONTEXT_TTL_SECONDS,
    }),
  );
  return `${payload}.${await signature(env, payload)}`;
}

export async function issueMemberAuthLinkContext(
  env: WorkerEnv,
  input: Omit<MemberAuthLinkContext, "expiresAt">,
): Promise<string> {
  const payload = base64url(
    JSON.stringify({
      ...input,
      expiresAt: Math.floor(Date.now() / 1_000) + AUTH_LINK_TTL_SECONDS,
    }),
  );
  return `${payload}.${await signature(env, payload)}`;
}

export async function verifyMemberAuthLinkContext(
  env: WorkerEnv,
  token: string | null | undefined,
): Promise<MemberAuthLinkContext | null> {
  if (!token) return null;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  if (!constantTimeEqual(suppliedSignature, await signature(env, payload))) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      decodeBase64url(payload),
    ) as Partial<MemberAuthLinkContext>;
    if (
      typeof parsed.brandId !== "string" ||
      typeof parsed.emailHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.emailHash) ||
      typeof parsed.organizationId !== "string" ||
      typeof parsed.memberId !== "string" ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 16 ||
      typeof parsed.requestHost !== "string" ||
      parsed.requestHost !== parsed.requestHost.toLowerCase() ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Math.floor(Date.now() / 1_000)
    ) {
      return null;
    }
    return parsed as MemberAuthLinkContext;
  } catch {
    return null;
  }
}

export async function verifyMemberAuthLinkCallback(
  env: WorkerEnv,
  input: {
    cookieState: string | null | undefined;
    requestHost: string | null | undefined;
    state: string | null | undefined;
  },
): Promise<MemberAuthLinkContext | null> {
  if (!memberAuthLinkTokensMatch(input.state, input.cookieState)) return null;
  const context = await verifyMemberAuthLinkContext(env, input.state);
  return context && context.requestHost === input.requestHost ? context : null;
}

export async function verifyMemberBrandContext(
  env: WorkerEnv,
  token: string | null | undefined,
): Promise<MemberBrandContext | null> {
  if (!token) return null;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  if (!constantTimeEqual(suppliedSignature, await signature(env, payload))) {
    return null;
  }
  try {
    const parsed = JSON.parse(decodeBase64url(payload)) as Partial<MemberBrandContext>;
    if (
      typeof parsed.brandId !== "string" ||
      typeof parsed.organizationId !== "string" ||
      typeof parsed.memberId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Math.floor(Date.now() / 1_000)
    ) {
      return null;
    }
    return parsed as MemberBrandContext;
  } catch {
    return null;
  }
}

export function readMemberBrandContextCookie(request: Request): string | null {
  return (
    parseCookieHeader(request.headers.cookie ?? "").find(
      (cookie) => cookie.name === MEMBER_BRAND_CONTEXT_COOKIE,
    )?.value ?? null
  );
}

export function readMemberAuthLinkContextCookie(
  request: Request,
): string | null {
  return (
    parseCookieHeader(request.headers.cookie ?? "").find(
      (cookie) => cookie.name === MEMBER_AUTH_LINK_CONTEXT_COOKIE,
    )?.value ?? null
  );
}

export async function setMemberBrandContextCookie(
  response: Response,
  env: WorkerEnv,
  context: Omit<MemberBrandContext, "expiresAt">,
): Promise<void> {
  response.append(
    "Set-Cookie",
    serializeCookieHeader(
      MEMBER_BRAND_CONTEXT_COOKIE,
      await issueMemberBrandContext(env, context),
      {
        httpOnly: true,
        maxAge: CONTEXT_TTL_SECONDS,
        path: "/",
        sameSite: "lax",
        secure: usesSecureCookies(env),
      },
    ),
  );
}

export function setMemberAuthLinkContextCookie(
  response: Response,
  env: WorkerEnv,
  token: string,
): void {
  response.append(
    "Set-Cookie",
    serializeCookieHeader(MEMBER_AUTH_LINK_CONTEXT_COOKIE, token, {
      httpOnly: true,
      maxAge: AUTH_LINK_TTL_SECONDS,
      path: "/api/auth/member/callback",
      sameSite: "lax",
      secure: usesSecureCookies(env),
    }),
  );
}

export function clearMemberAuthLinkContextCookie(
  response: Response,
  env: WorkerEnv,
): void {
  response.append(
    "Set-Cookie",
    serializeCookieHeader(MEMBER_AUTH_LINK_CONTEXT_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/api/auth/member/callback",
      sameSite: "lax",
      secure: usesSecureCookies(env),
    }),
  );
}

export function clearMemberBrandContextCookie(
  response: Response,
  env: WorkerEnv,
): void {
  response.append(
    "Set-Cookie",
    serializeCookieHeader(MEMBER_BRAND_CONTEXT_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: usesSecureCookies(env),
    }),
  );
}

export function invalidMemberBrandContext(): AppError {
  return new AppError(
    401,
    "unauthorized",
    "The email or sign-in method is invalid.",
  );
}
