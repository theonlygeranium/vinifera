import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../../server/lib/sentry", () => ({
  captureException: vi.fn(),
}));

import { errorHandler } from "../../server/lib/error-handler";
import { AppError } from "../../server/lib/errors";
import { captureException } from "../../server/lib/sentry";

const captureExceptionMock = vi.mocked(captureException);

function appThatThrows(error: unknown): express.Express {
  const app = express();
  app.get("/failure", () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe("centralized API error handler", () => {
  beforeEach(() => {
    captureExceptionMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps ZodError to a 400 response with field-level detail", async () => {
    const schema = z.object({ email: z.email("Enter a valid email.") });
    const parsed = schema.safeParse({ email: "not-an-email" });
    if (parsed.success) throw new Error("Expected the fixture to be invalid.");

    const response = await request(appThatThrows(parsed.error)).get("/failure");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: "invalid_request",
      fieldErrors: {
        email: "Enter a valid email.",
      },
      message: "The request is invalid.",
    });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("returns an opaque 500 response without a stack trace", async () => {
    const response = await request(
      appThatThrows(new Error("private provider response")),
    ).get("/failure");

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe(
      "The request could not be completed.",
    );
    expect(JSON.stringify(response.body)).not.toContain("private provider");
    expect(response.body.error).not.toHaveProperty("stack");
  });

  it("always includes a request ID and preserves a Cloudflare Ray ID", async () => {
    const generated = await request(
      appThatThrows(new AppError(404, "not_found", "Missing.")),
    ).get("/failure");
    const cloudflare = await request(
      appThatThrows(new AppError(404, "not_found", "Missing.")),
    )
      .get("/failure")
      .set("CF-Ray", "ray-test-123");

    expect(generated.body.error.requestId).toEqual(expect.any(String));
    expect(generated.body.error.requestId.length).toBeGreaterThan(0);
    expect(cloudflare.body.error.requestId).toBe("ray-test-123");
  });

  it("captures 500-level errors in Sentry with request context", async () => {
    const error = new Error("unexpected");
    const response = await request(appThatThrows(error))
      .get("/failure")
      .set("CF-Ray", "ray-sentry-500");

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        tags: expect.objectContaining({
          http_method: "GET",
          http_status: 500,
          request_id: "ray-sentry-500",
          route: "/failure",
        }),
      }),
    );
  });

  it.each([
    ["AuthenticationError", 401, "unauthorized"],
    ["AuthorizationError", 403, "forbidden"],
    ["RecordNotFoundError", 404, "not_found"],
  ])("maps %s to the expected API status", async (name, status, code) => {
    const error = new Error("internal detail");
    error.name = name;

    const response = await request(appThatThrows(error)).get("/failure");

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
  });
});
