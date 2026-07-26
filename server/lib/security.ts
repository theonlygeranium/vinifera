import type {
  NextFunction,
  Request,
  Response as ExpressResponse,
} from "express";
import { AppError } from "./errors";
import { getAllowedOrigins } from "../config";
import type { WorkerEnv } from "../types";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' data:",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
};

export function isTrustedRequestOrigin(
  request: Request,
  origin: string,
  env: WorkerEnv,
): boolean {
  if (getAllowedOrigins(env).includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const forwardedProtocol = request.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestProtocol = forwardedProtocol || request.protocol;
    return (
      parsed.host === request.get("host") &&
      parsed.protocol === `${requestProtocol}:`
    );
  } catch {
    return false;
  }
}

export function assertTrustedOrigin(getEnv: () => WorkerEnv) {
  return (
    request: Request,
    _response: ExpressResponse,
    next: NextFunction,
  ): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      next();
      return;
    }

    const origin = request.get("origin");
    if (!origin || !isTrustedRequestOrigin(request, origin, getEnv())) {
      next(new AppError(403, "forbidden", "The request origin is not allowed."));
      return;
    }

    next();
  };
}

export function withSecurityHeaders(response: globalThis.Response): globalThis.Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new globalThis.Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
