import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../server/lib/error-handler";
import {
  createRateLimiter,
  createRateLimits,
} from "../../server/lib/rate-limit";
import type { WorkerEnv } from "../../server/types";

function testApp(
  env: WorkerEnv,
  middleware: express.RequestHandler,
): express.Express {
  const app = express();
  app.use(middleware);
  app.get("/api/members/:id", (_request, response) => {
    response.status(200).json({ ok: true });
  });
  app.get("/api/auth/session", (_request, response) => {
    response.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe("Cloudflare API rate limiting middleware", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checks normalized per-route tenant and actor keys", async () => {
    const limit = vi.fn<RateLimit["limit"]>().mockResolvedValue({
      success: true,
    });
    const env: WorkerEnv = {
      API_RATE_LIMITER: { limit },
      APP_ENV: "production",
    };
    const middleware = createRateLimiter(() => env, {
      binding: "API_RATE_LIMITER",
      max: 100,
      message: "Rate limit exceeded",
      routeGroup: "api",
      windowMs: 60_000,
    });

    const response = await request(testApp(env, middleware))
      .get("/api/members/10000000-0000-4000-8000-000000000001")
      .set("CF-Connecting-IP", "192.0.2.10")
      .set("X-Vinifera-Brand-Id", "20000000-0000-4000-8000-000000000002");

    expect(response.status).toBe(200);
    expect(limit).toHaveBeenCalledTimes(2);
    expect(limit.mock.calls[0]?.[0].key).toContain(
      "api:/api/members/:id:tenant:brand:20000000-0000-4000-8000-000000000002",
    );
    expect(limit.mock.calls[1]?.[0].key).toMatch(
      /^api:\/api\/members\/:id:actor:[a-f0-9]{64}$/,
    );
    expect(limit.mock.calls[1]?.[0].key).not.toContain("192.0.2.10");
  });

  it("returns the stable 429 envelope and retry window", async () => {
    const limit = vi
      .fn<RateLimit["limit"]>()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false });
    const env: WorkerEnv = {
      API_RATE_LIMITER: { limit },
      APP_ENV: "production",
    };
    const middleware = createRateLimiter(() => env, {
      binding: "API_RATE_LIMITER",
      max: 100,
      message: "Rate limit exceeded",
      routeGroup: "api",
      windowMs: 60_000,
    });

    const response = await request(testApp(env, middleware)).get(
      "/api/members/10000000-0000-4000-8000-000000000001",
    );

    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.body.error.code).toBe("rate_limited");
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it("fails closed outside tests when a configured binding is missing", async () => {
    const env: WorkerEnv = { APP_ENV: "staging" };
    const response = await request(
      testApp(env, createRateLimits(() => env).api),
    ).get("/api/members/10000000-0000-4000-8000-000000000001");

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("configuration_error");
  });

  it("does not apply the general API budget to specialized auth routes", async () => {
    const limit = vi.fn<RateLimit["limit"]>();
    const env: WorkerEnv = {
      API_RATE_LIMITER: { limit },
      APP_ENV: "production",
    };

    const response = await request(
      testApp(env, createRateLimits(() => env).api),
    ).get("/api/auth/session");

    expect(response.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
  });
});
