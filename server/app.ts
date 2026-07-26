import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { z, type ZodType } from "zod";
import { getConfigurationReport } from "./config";
import { AppError, asAppError } from "./lib/errors";
import {
  assertTrustedOrigin,
  CONTENT_SECURITY_POLICY,
  isTrustedRequestOrigin,
} from "./lib/security";
import { createProductionFoundationService } from "./services/production-foundation";
import type {
  FoundationServiceFactory,
  PlanTier,
  WorkerEnv,
} from "./types";

const email = z.email().max(254).transform((value) => value.trim().toLowerCase());
const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128)
  .regex(/[a-z]/, "Add a lowercase letter.")
  .regex(/[A-Z]/, "Add an uppercase letter.")
  .regex(/[0-9]/, "Add a number.");
const planTier = z.enum(["vine", "cellar", "estate", "reserve"]);

const signupSchema = z.object({
  email,
  fullName: z.string().trim().min(2).max(120),
  organizationName: z.string().trim().min(2).max(120),
  password,
  planTier,
});
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const emailSchema = z.object({ email });
const passwordSchema = z.object({ password });
const inviteAcceptSchema = z.object({
  inviteToken: z.string().uuid().optional(),
  password,
});
const invitationSchema = z.object({
  email,
  role: z.enum(["admin", "manager", "staff"]),
});
const billingSchema = z.object({ planTier });
const memberMagicLinkSchema = z.object({ email });

interface AppOptions {
  createService?: FoundationServiceFactory;
  getEnv: () => WorkerEnv;
}

function parseBody<T>(schema: ZodType<T>, request: Request): T {
  const result = schema.safeParse(request.body);
  if (result.success) return result.data;

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] ??= issue.message;
  }
  throw new AppError(
    400,
    "invalid_request",
    "Check the highlighted fields and try again.",
    fieldErrors,
  );
}

function data<T>(response: Response, payload: T, status = 200): void {
  response.status(status).json({ data: payload });
}

function getClientAddress(request: Request): string {
  const connectingIp = request.get("cf-connecting-ip");
  if (connectingIp) return connectingIp;
  return request.ip || "unknown";
}

function safeRedirectPath(candidate: unknown, fallback: string): string {
  if (
    typeof candidate === "string" &&
    candidate.startsWith("/") &&
    !candidate.startsWith("//")
  ) {
    return candidate;
  }
  return fallback;
}

export function createApp(options: AppOptions): express.Express {
  const app = express();
  const createService =
    options.createService ??
    ((request, response) =>
      createProductionFoundationService(options.getEnv(), request, response));

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use((_request, response, next) => {
    response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    cors((request, resolveOptions) => {
      resolveOptions(null, {
        credentials: true,
        methods: ["GET", "POST", "OPTIONS"],
        origin(
          origin: string | undefined,
          callback: (error: Error | null, allow?: boolean) => void,
        ) {
          if (
            !origin ||
            isTrustedRequestOrigin(request, origin, options.getEnv())
          ) {
            callback(null, true);
            return;
          }
          callback(
            new AppError(403, "forbidden", "The request origin is not allowed."),
          );
        },
      });
    }),
  );

  app.post(
    "/api/billing/webhook",
    express.raw({ limit: "1mb", type: "application/json" }),
    async (request, response) => {
      const signature = request.get("stripe-signature");
      if (!signature) {
        throw new AppError(400, "invalid_request", "The Stripe signature is missing.");
      }
      const result = await createService(request, response).handleStripeWebhook(
        request.body as Buffer,
        signature,
      );
      data(response, { received: true, ...result });
    },
  );

  app.use(express.json({ limit: "256kb", strict: true }));
  app.use(assertTrustedOrigin(options.getEnv));

  app.get("/api/health", (_request, response) => {
    data(response, { service: "vinifera-api", status: "ok" });
  });

  app.get("/api/health/configuration", (_request, response) => {
    data(response, getConfigurationReport(options.getEnv()));
  });

  app.post("/api/auth/staff/signup", async (request, response) => {
    const input = parseBody(signupSchema, request);
    const result = await createService(request, response).staffSignup(input);
    data(response, result, 201);
  });

  app.post("/api/auth/staff/login", async (request, response) => {
    const input = parseBody(loginSchema, request);
    data(response, await createService(request, response).staffLogin(input));
  });

  app.post("/api/auth/staff/logout", async (request, response) => {
    await createService(request, response).staffLogout();
    response.status(204).end();
  });

  app.get("/api/auth/staff/session", async (request, response) => {
    if (!getConfigurationReport(options.getEnv()).database.configured) {
      data(response, {
        activated: false,
        authenticated: false,
      });
      return;
    }
    const principal = await createService(request, response).getStaffSession();
    data(response, {
      authenticated: Boolean(principal),
      ...(principal ?? {}),
    });
  });

  app.post("/api/auth/staff/forgot-password", async (request, response) => {
    const input = parseBody(emailSchema, request);
    await createService(request, response).requestStaffPasswordReset(input);
    data(response, {
      message: "If the account exists, a password reset email is on its way.",
    });
  });

  app.post("/api/auth/staff/reset-password", async (request, response) => {
    const input = parseBody(passwordSchema, request);
    await createService(request, response).completeStaffPasswordReset(input);
    data(response, { updated: true });
  });

  app.get("/api/auth/staff/google", async (request, response) => {
    const url = await createService(request, response).getGoogleOAuthUrl();
    response.redirect(303, url);
  });

  app.get("/api/auth/staff/callback", async (request, response) => {
    const code = z.string().min(1).parse(request.query.code);
    const result = await createService(request, response).exchangeAuthCode("staff", code);
    response.redirect(
      303,
      safeRedirectPath(request.query.next, result.destination),
    );
  });

  app.post("/api/auth/staff/accept-invite", async (request, response) => {
    const input = parseBody(inviteAcceptSchema, request);
    data(response, await createService(request, response).acceptStaffInvite(input));
  });

  app.post("/api/staff/invitations", async (request, response) => {
    const input = parseBody(invitationSchema, request);
    data(
      response,
      await createService(request, response).createStaffInvitation(input),
      201,
    );
  });

  app.post("/api/auth/member/magic-link", async (request, response) => {
    const input = parseBody(memberMagicLinkSchema, request);
    await createService(request, response).requestMemberMagicLink({
      ...input,
      ipAddress: getClientAddress(request),
    });
    data(response, {
      message: "If this membership exists, a secure sign-in link is on its way.",
    });
  });

  app.get("/api/auth/member/callback", async (request, response) => {
    const code = z.string().min(1).parse(request.query.code);
    const result = await createService(request, response).exchangeAuthCode("member", code);
    response.redirect(303, result.destination);
  });

  app.get("/api/auth/member/session", async (request, response) => {
    if (!getConfigurationReport(options.getEnv()).database.configured) {
      data(response, {
        activated: false,
        authenticated: false,
      });
      return;
    }
    const principal = await createService(request, response).getMemberSession();
    data(response, {
      authenticated: Boolean(principal),
      ...(principal ?? {}),
    });
  });

  app.post("/api/auth/member/logout", async (request, response) => {
    await createService(request, response).memberLogout();
    response.status(204).end();
  });

  app.post("/api/billing/checkout", async (request, response) => {
    const input = parseBody(billingSchema, request) as { planTier: PlanTier };
    data(response, await createService(request, response).createBillingCheckout(input));
  });

  app.post("/api/billing/portal", async (request, response) => {
    data(response, await createService(request, response).createBillingPortal());
  });

  app.use("/api", (request, _response, next) => {
    next(
      new AppError(
        404,
        "not_found",
        `No API route exists for ${request.method} ${request.path}.`,
      ),
    );
  });

  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      const appError =
        error instanceof z.ZodError
          ? new AppError(400, "invalid_request", "The request is invalid.")
          : asAppError(error);
      const requestId = request.get("cf-ray") ?? crypto.randomUUID();

      if (appError.status >= 500) {
        console.error(
          JSON.stringify({
            code: appError.code,
            method: request.method,
            path: request.path,
            requestId,
            status: appError.status,
          }),
        );
      }

      response.status(appError.status).json({
        error: {
          code: appError.code,
          fieldErrors: appError.fieldErrors,
          message: appError.message,
          requestId,
        },
      });
    },
  );

  return app;
}
