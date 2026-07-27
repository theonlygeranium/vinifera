import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { WorkerEnv } from "../types";
import { AppError } from "./errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE_LIMIT_WINDOW_MS = 60_000;

type RateLimitBindingName =
  | "ADMIN_RATE_LIMITER"
  | "API_RATE_LIMITER"
  | "AUTH_RATE_LIMITER"
  | "WEBHOOK_RATE_LIMITER";

interface RateLimiterConfig {
  binding: RateLimitBindingName;
  excludedPathPrefixes?: readonly string[];
  max: number;
  message: string;
  routeGroup: "admin" | "api" | "auth" | "webhooks";
  windowMs: number;
}

type GetEnv = () => WorkerEnv;

function requestPath(request: Request): string {
  return new URL(request.originalUrl, "https://vinifera.invalid").pathname;
}

function normalizedRoute(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (UUID_PATTERN.test(segment)) return ":id";
      if (/^\d+$/.test(segment)) return ":number";
      if (segment.length > 64) return ":token";
      return segment.toLowerCase();
    })
    .join("/");
}

function tenantScope(request: Request): string {
  const brandId = request.get("x-vinifera-brand-id")?.trim();
  if (brandId && UUID_PATTERN.test(brandId)) {
    return `brand:${brandId.toLowerCase()}`;
  }

  const hostname = request.hostname.trim().toLowerCase();
  return hostname ? `host:${hostname}` : "host:unknown";
}

function actorSource(request: Request): string {
  const authorization = request.get("authorization");
  if (authorization) return `authorization:${authorization}`;

  const cookie = request.get("cookie");
  if (cookie) return `cookie:${cookie}`;

  const connectingIp = request.get("cf-connecting-ip");
  if (connectingIp) return `ip:${connectingIp}`;

  return `ip:${request.ip || "unknown"}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function shouldSkip(
  path: string,
  prefixes: readonly string[] | undefined,
): boolean {
  return Boolean(
    prefixes?.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    ),
  );
}

async function rateLimitKeys(
  request: Request,
  routeGroup: RateLimiterConfig["routeGroup"],
): Promise<string[]> {
  const route = normalizedRoute(requestPath(request));
  const actor = await sha256(actorSource(request));
  return [
    `${routeGroup}:${route}:tenant:${tenantScope(request)}`,
    `${routeGroup}:${route}:actor:${actor}`,
  ];
}

export function createRateLimiter(
  getEnv: GetEnv,
  config: RateLimiterConfig,
): RequestHandler {
  return async function rateLimitMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const path = requestPath(request);
    if (shouldSkip(path, config.excludedPathPrefixes)) {
      next();
      return;
    }

    const env = getEnv();
    const limiter = env[config.binding];
    if (!limiter) {
      if (env.APP_ENV === "test") {
        next();
        return;
      }
      throw new AppError(
        503,
        "configuration_error",
        "API rate limiting is unavailable.",
      );
    }

    const keys = await rateLimitKeys(request, config.routeGroup);
    const outcomes = await Promise.all(
      keys.map((key) => limiter.limit({ key })),
    );
    const windowSeconds = Math.ceil(config.windowMs / 1_000);

    response.setHeader("RateLimit-Limit", String(config.max));
    response.setHeader(
      "RateLimit-Policy",
      `${config.max};w=${windowSeconds}`,
    );

    if (outcomes.some(({ success }) => !success)) {
      response.setHeader("Retry-After", String(windowSeconds));
      throw new AppError(429, "rate_limited", config.message);
    }

    next();
  };
}

export function createRateLimits(getEnv: GetEnv): {
  admin: RequestHandler;
  api: RequestHandler;
  auth: RequestHandler;
  webhooks: RequestHandler;
} {
  return {
    admin: createRateLimiter(getEnv, {
      binding: "ADMIN_RATE_LIMITER",
      max: 30,
      message: "Admin rate limit exceeded",
      routeGroup: "admin",
      windowMs: RATE_LIMIT_WINDOW_MS,
    }),
    api: createRateLimiter(getEnv, {
      binding: "API_RATE_LIMITER",
      excludedPathPrefixes: [
        "/api/admin",
        "/api/auth",
        "/api/billing/webhook",
        "/api/email/webhook",
        "/api/webhooks",
      ],
      max: 100,
      message: "Rate limit exceeded",
      routeGroup: "api",
      windowMs: RATE_LIMIT_WINDOW_MS,
    }),
    auth: createRateLimiter(getEnv, {
      binding: "AUTH_RATE_LIMITER",
      max: 20,
      message: "Too many auth attempts",
      routeGroup: "auth",
      windowMs: RATE_LIMIT_WINDOW_MS,
    }),
    webhooks: createRateLimiter(getEnv, {
      binding: "WEBHOOK_RATE_LIMITER",
      max: 500,
      message: "Webhook rate limit exceeded",
      routeGroup: "webhooks",
      windowMs: RATE_LIMIT_WINDOW_MS,
    }),
  };
}
