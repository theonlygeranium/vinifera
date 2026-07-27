import type {
  NextFunction,
  Request,
  Response,
} from "express";
import { z } from "zod";
import { AppError, asAppError } from "./errors";
import { captureException } from "./sentry";

const AUTH_COOKIE_PATTERN =
  /(?:^|;\s*)(?:vinifera-staff-auth|vinifera-member-auth)=([^;]+)/;

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path.map(String).join(".") || "form";
    fieldErrors[field] ??= issue.message;
  }
  return fieldErrors;
}

function normalizeError(error: unknown): AppError {
  if (error instanceof z.ZodError) {
    return new AppError(
      400,
      "invalid_request",
      "The request is invalid.",
      zodFieldErrors(error),
    );
  }

  if (error instanceof AppError) return error;

  if (error instanceof Error && error.name === "AuthenticationError") {
    return new AppError(401, "unauthorized", "A valid sign-in is required.");
  }

  if (error instanceof Error && error.name === "AuthorizationError") {
    return new AppError(
      403,
      "forbidden",
      "Your account cannot perform this action.",
    );
  }

  if (error instanceof Error && error.name === "RecordNotFoundError") {
    return new AppError(404, "not_found", "The requested record was not found.");
  }

  return asAppError(error);
}

function requestId(request: Request): string {
  return (
    request.get("cf-ray")?.trim() ||
    request.get("x-request-id")?.trim() ||
    crypto.randomUUID()
  );
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

async function authenticatedActorId(
  request: Request,
  response: Response,
): Promise<string | undefined> {
  const locals = response.locals as Record<string, unknown>;
  if (typeof locals.userId === "string" && locals.userId.trim()) {
    return locals.userId.trim();
  }

  const authorization = request.get("authorization");
  if (authorization && /^Bearer\s+\S+$/i.test(authorization)) {
    return `session:${await sha256(authorization)}`;
  }

  const cookie = request.get("cookie")?.match(AUTH_COOKIE_PATTERN)?.[1];
  return cookie ? `session:${await sha256(cookie)}` : undefined;
}

function logError(
  appError: AppError,
  request: Request,
  correlationId: string,
  error: unknown,
): void {
  const event = JSON.stringify({
    code: appError.code,
    errorClass: error instanceof Error ? error.name : "UnknownError",
    method: request.method,
    path: request.path,
    requestId: correlationId,
    status: appError.status,
  });

  if (appError.status >= 500) {
    console.error(event);
  } else {
    console.warn(event);
  }
}

export async function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction,
): Promise<void> {
  const appError = normalizeError(error);
  const correlationId = requestId(request);
  const actorId = await authenticatedActorId(request, response);

  logError(appError, request, correlationId, error);

  if (appError.status >= 500) {
    captureException(error, {
      tags: {
        error_code: appError.code,
        http_method: request.method,
        http_status: appError.status,
        request_id: correlationId,
        route: request.path,
      },
      user: actorId ? { id: actorId } : undefined,
    });
  }

  response.status(appError.status).json({
    error: {
      code: appError.code,
      fieldErrors: appError.fieldErrors,
      message: appError.message,
      requestId: correlationId,
    },
  });
}
