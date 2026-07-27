/**
 * Defense-in-depth auth presence middleware (P3-1).
 *
 * The service layer's requireStaff()/requireMember() methods are the
 * authoritative auth checks. This middleware adds an early gate: it rejects
 * requests to protected API routes that lack any auth credential (staff
 * cookie, member cookie, or bearer token) before they reach the handler body.
 *
 * This does NOT replace service-layer auth — it prevents unauthenticated
 * requests from executing handler code at all, reducing the attack surface
 * if a service method forgets to call requireStaff()/requireMember().
 *
 * Public routes (health, auth, webhooks, well-known, branding, unsubscribe,
 * mobile callbacks) are excluded from the check.
 *
 * In test environments (APP_ENV === "test"), the middleware is skipped
 * entirely — the test harness mocks the service layer and does not send
 * auth cookies. Production and staging enforce the check.
 */

import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errors";
import type { WorkerEnv } from "../types";

/** Cookie names — must match the constants in core-club.ts. */
const STAFF_COOKIE = "vinifera-staff-auth";
const MEMBER_COOKIE = "vinifera-member-auth";

/**
 * Public route patterns that do not require auth presence.
 * Matched against the request path using startsWith or exact match.
 */
const PUBLIC_ROUTE_PATTERNS: string[] = [
  "/.well-known/",
  "/api/health",
  "/api/health/configuration",
  "/api/portal/branding",
  "/api/communications/unsubscribe",
  "/api/billing/webhook",
  "/api/webhooks/klaviyo",
  "/api/webhooks/resend",
  "/api/email/webhook",
  "/api/auth/staff/signup",
  "/api/auth/staff/login",
  "/api/auth/staff/logout",
  "/api/auth/staff/session",
  "/api/auth/staff/forgot-password",
  "/api/auth/staff/reset-password",
  "/api/auth/staff/google",
  "/api/auth/staff/callback",
  "/api/auth/member/magic-link",
  "/api/auth/member/callback",
  "/api/auth/member/session",
  "/api/auth/member/logout",
  "/api/auth/member/mobile/magic-link",
  "/api/auth/member/mobile/callback",
  "/api/auth/member/mobile/exchange",
  "/api/auth/member/mobile/refresh",
  "/api/auth/member/mobile/logout",
  "/api/integrations/quickbooks/callback",
  "/api/mobile/app-policy",
];

function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTE_PATTERNS.some(
    (pattern) =>
      path === pattern ||
      path.startsWith(pattern + "/") ||
      path.startsWith(pattern),
  );
}

/**
 * Check whether the request carries any auth credential.
 * This is a presence check only — validity is confirmed by the service layer.
 */
function hasAuthCredential(request: Request): boolean {
  // Check for bearer token (mobile member auth).
  const authHeader = request.get("authorization");
  if (authHeader && /^Bearer\s+\S+$/i.test(authHeader)) {
    return true;
  }

  // Check for staff or member session cookie.
  const cookieHeader = request.headers.cookie;
  if (cookieHeader) {
    if (
      cookieHeader.includes(STAFF_COOKIE + "=") ||
      cookieHeader.includes(MEMBER_COOKIE + "=")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Create an Express middleware that rejects requests to protected API routes
 * when no auth credential is present. Public routes pass through.
 *
 * In test environments (APP_ENV === "test"), the middleware is a no-op.
 */
export function requireAuthPresence(getEnv: () => WorkerEnv) {
  return function authPresenceMiddleware(
    request: Request,
    _response: Response,
    next: NextFunction,
  ): void {
    // Skip entirely in test environments — the test harness mocks the
    // service layer and does not send auth cookies.
    if (getEnv().APP_ENV === "test") {
      next();
      return;
    }

    const path = request.path;

    // Allow non-API routes (static assets, etc.) and public API routes.
    if (!path.startsWith("/api/") || isPublicRoute(path)) {
      next();
      return;
    }

    if (!hasAuthCredential(request)) {
      throw new AppError(401, "unauthorized", "A valid sign-in is required.");
    }

    next();
  };
}
