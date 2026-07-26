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
import { verifyUnsubscribeToken } from "./services/retention";
import type {
  ApplicationService,
  ClubTierInput,
  CsvMapping,
  MemberInput,
  PostalAddress,
  ReleaseInput,
  FoundationServiceFactory,
  PlanTier,
  RetentionService,
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
const templateVariableSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/i),
  z.string().max(2_000),
);
const emailTrigger = z.enum([
  "welcome",
  "pre_shipment",
  "payment_decline",
  "shipped",
  "birthday",
  "re_engagement",
]);
const emailTemplateSchema = z.object({
  body: z.string().trim().min(1).max(100_000),
  daysBefore: z.number().int().min(1).max(30).optional(),
  enabled: z.boolean().default(true),
  subject: z.string().trim().min(1).max(200),
  triggerType: emailTrigger,
});
const uuid = z.uuid();
const memberStatus = z.enum(["active", "paused", "cancelled"]);
const shipmentStatus = z.enum([
  "pending",
  "charged",
  "declined",
  "label_created",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);
const addressSchema = z.object({
  city: z.string().trim().min(2).max(120),
  country: z.string().trim().length(2).default("US"),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  postalCode: z.string().trim().min(3).max(24),
  state: z.string().trim().min(2).max(80),
});
const clubTierSchema = z.object({
  billingInterval: z.enum(["monthly", "quarterly"]),
  bottleCount: z.number().int().min(1).max(120),
  description: z.string().trim().max(2_000).nullable().optional(),
  frequency: z.enum([
    "monthly",
    "bi_monthly",
    "quarterly",
    "semi_annual",
    "annual",
  ]),
  name: z.string().trim().min(1).max(120),
  priceCents: z.number().int().positive(),
  upgradePathId: uuid.nullable().optional(),
});
const clubTierPatchSchema = clubTierSchema.partial();
const memberSchema = z.object({
  address: addressSchema.nullable().optional(),
  birthday: z.iso.date().nullable().optional(),
  clubTierId: uuid.nullable().optional(),
  email,
  firstName: z.string().trim().min(1).max(100),
  joinDate: z.iso.date().optional(),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(30).nullable().optional(),
  referredByMemberId: uuid.nullable().optional(),
  shippingAddress: addressSchema.nullable().optional(),
  status: memberStatus.optional(),
  tierId: uuid.nullable().optional(),
});
const memberPatchSchema = memberSchema.partial();
const releaseSchema = z.object({
  description: z.string().trim().max(5_000).nullable().optional(),
  embargoDate: z.iso.date(),
  name: z.string().trim().min(1).max(160),
  processingDate: z.iso.date(),
  status: z.enum(["draft", "scheduled"]).optional(),
  tierIds: z.array(uuid).min(1).optional(),
  tierPrices: z
    .array(z.object({ priceCents: z.number().int().positive(), tierId: uuid }))
    .min(1)
    .optional(),
  tiers: z
    .array(z.object({ priceCents: z.number().int().positive(), tierId: uuid }))
    .min(1)
    .optional(),
  wines: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        priceCents: z.number().int().nonnegative().optional(),
        quantity: z.number().int().min(1).max(120),
        wineName: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .min(1),
});

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

function asMemberInput(
  input: z.infer<typeof memberSchema>,
): MemberInput {
  return {
    birthday: input.birthday,
    clubTierId: input.clubTierId ?? input.tierId,
    email: input.email,
    firstName: input.firstName,
    joinDate: input.joinDate,
    lastName: input.lastName,
    phone: input.phone,
    referredByMemberId: input.referredByMemberId,
    shippingAddress: (input.shippingAddress ?? input.address) as
      | PostalAddress
      | null
      | undefined,
    status: input.status,
  };
}

function asReleaseInput(input: z.infer<typeof releaseSchema>): ReleaseInput {
  const tiers = input.tierPrices ?? input.tiers ?? [];
  const tierIds = input.tierIds ?? tiers.map((tier) => tier.tierId);
  if (!tiers.length || new Set(tierIds).size !== tierIds.length) {
    throw new AppError(
      400,
      "invalid_request",
      "Choose each participating tier once and set its release price.",
    );
  }
  return {
    description: input.description,
    embargoDate: input.embargoDate,
    name: input.name,
    processingDate: input.processingDate,
    tierIds,
    tierPrices: tiers,
    wines: input.wines.map((wine) => ({
      priceCents: wine.priceCents ?? 0,
      quantity: wine.quantity,
      wineName: wine.wineName ?? wine.name ?? "",
    })),
  };
}

interface MultipartPart {
  contentType?: string;
  filename?: string;
  name: string;
  value: Buffer;
}

function parseMultipartForm(request: Request): MultipartPart[] {
  if (!Buffer.isBuffer(request.body)) {
    throw new AppError(400, "invalid_request", "A CSV file is required.");
  }
  const contentType = request.get("content-type") ?? "";
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
  if (!boundary || boundary.length > 200) {
    throw new AppError(400, "invalid_request", "The multipart boundary is invalid.");
  }
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let cursor = request.body.indexOf(delimiter);
  while (cursor >= 0) {
    const start = cursor + delimiter.length;
    if (request.body.subarray(start, start + 2).toString() === "--") break;
    const headerStart = start + 2;
    const headerEnd = request.body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd < 0) break;
    const headers = request.body.subarray(headerStart, headerEnd).toString("utf8");
    const disposition = headers.match(
      /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i,
    );
    if (!disposition?.[1]) {
      throw new AppError(400, "invalid_request", "A multipart field is invalid.");
    }
    const valueStart = headerEnd + 4;
    const next = request.body.indexOf(delimiter, valueStart);
    if (next < 0) break;
    const valueEnd = Math.max(valueStart, next - 2);
    const partType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();
    parts.push({
      contentType: partType,
      filename: disposition[2],
      name: disposition[1],
      value: request.body.subarray(valueStart, valueEnd),
    });
    cursor = next;
  }
  return parts;
}

export function createApp(options: AppOptions): express.Express {
  const app = express();
  const createService =
    options.createService ??
    ((request, response) =>
      createProductionFoundationService(options.getEnv(), request, response));
  const coreService = (request: Request, response: Response): ApplicationService => {
    const candidate = createService(request, response);
    if (!("listMembers" in candidate)) {
      throw new AppError(
        503,
        "activation_required",
        "The Phase 2 core club service is not connected.",
      );
    }
    return candidate as ApplicationService;
  };
  const retentionService = (
    request: Request,
    response: Response,
  ): RetentionService => {
    const candidate = createService(request, response);
    if (!("listEmailTemplates" in candidate)) {
      throw new AppError(
        503,
        "activation_required",
        "The retention and communications service is not connected.",
      );
    }
    return candidate as unknown as RetentionService;
  };

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
        methods: ["DELETE", "GET", "PATCH", "POST", "OPTIONS"],
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

  app.post(
    ["/api/webhooks/resend", "/api/email/webhook"],
    express.raw({ limit: "1mb", type: "application/json" }),
    async (request, response) => {
      const id = request.get("svix-id");
      const signature = request.get("svix-signature");
      const timestamp = request.get("svix-timestamp");
      if (!id || !signature || !timestamp) {
        throw new AppError(
          400,
          "invalid_request",
          "The Resend webhook signature headers are missing.",
        );
      }
      const result = await retentionService(
        request,
        response,
      ).handleResendWebhook(request.body as Buffer, {
        id,
        signature,
        timestamp,
      });
      data(response, { received: true, ...result });
    },
  );

  app.get("/api/communications/unsubscribe", async (request, response) => {
    const token = z.string().min(32).max(4_096).parse(request.query.token);
    await verifyUnsubscribeToken(options.getEnv(), token);
    const action = `/api/communications/unsubscribe?token=${encodeURIComponent(
      token,
    )}`;
    response
      .status(200)
      .type("html")
      .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title></head>
<body><main><h1>Email preferences</h1><p>Confirm that you want to stop optional transactional notifications. Essential billing and account notices may still be sent.</p><form method="post" action="${action}"><button type="submit" style="min-height:44px;min-width:44px">Update email preference</button></form></main></body></html>`);
  });

  app.post("/api/communications/unsubscribe", async (request, response) => {
    const token = z.string().min(32).max(4_096).parse(request.query.token);
    await retentionService(request, response).applyUnsubscribe(token);
    data(response, {
      message: "Your optional transactional email preference has been updated.",
      unsubscribed: true,
    });
  });

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
    const publicPrincipal = principal
      ? {
          ...principal,
          user: {
            email: principal.user.email,
            firstName: principal.user.firstName,
            id: principal.user.id,
            lastName: principal.user.lastName,
            status: principal.user.status,
          },
        }
      : null;
    data(response, {
      authenticated: Boolean(principal),
      ...(publicPrincipal ?? {}),
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

  app.get("/api/email/templates", async (request, response) => {
    data(
      response,
      await retentionService(request, response).listEmailTemplates(),
    );
  });

  app.post("/api/email/templates", async (request, response) => {
    const input = parseBody(emailTemplateSchema, request);
    data(
      response,
      await retentionService(request, response).upsertEmailTemplate(input),
      201,
    );
  });

  app.patch("/api/email/templates/:id", async (request, response) => {
    const input = parseBody(emailTemplateSchema.partial(), request);
    if (!Object.keys(input).length) {
      throw new AppError(
        400,
        "invalid_request",
        "Choose at least one template field to update.",
      );
    }
    data(
      response,
      await retentionService(request, response).updateEmailTemplate(
        uuid.parse(request.params.id),
        input,
      ),
    );
  });

  app.delete("/api/email/templates/:id", async (request, response) => {
    await retentionService(request, response).deleteEmailTemplate(
      uuid.parse(request.params.id),
    );
    response.status(204).end();
  });

  app.post("/api/email/templates/:id/preview", async (request, response) => {
    const input = parseBody(
      z.object({
        body: z.string().trim().min(1).max(100_000).optional(),
        subject: z.string().trim().min(1).max(200).optional(),
        variables: templateVariableSchema.optional(),
      }),
      request,
    );
    data(
      response,
      await retentionService(request, response).previewEmailTemplate(
        uuid.parse(request.params.id),
        input,
      ),
    );
  });

  app.post(
    ["/api/email/templates/:id/test", "/api/email/templates/:id/test-send"],
    async (request, response) => {
    const input = parseBody(
      z.object({
        email: email.optional(),
        recipient: email.optional(),
        variables: templateVariableSchema.optional(),
      }).refine((value) => Boolean(value.email ?? value.recipient), {
        message: "A test recipient is required.",
        path: ["recipient"],
      }),
      request,
    );
    data(
      response,
      await retentionService(request, response).sendEmailTemplateTest(
        uuid.parse(request.params.id),
        {
          email: input.email ?? input.recipient ?? "",
          variables: input.variables,
        },
      ),
      202,
    );
    },
  );

  app.get("/api/email/log", async (request, response) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        status: z.string().trim().max(32).optional(),
        triggerType: emailTrigger.optional(),
      })
      .parse(request.query);
    data(
      response,
      await retentionService(request, response).listEmailLog(query),
    );
  });

  app.get("/api/churn-scores", async (request, response) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        riskLevel: z.enum(["low", "medium", "high"]).optional(),
        search: z.string().trim().max(120).optional(),
      })
      .parse(request.query);
    data(
      response,
      await retentionService(request, response).listChurnScores(query),
    );
  });

  app.get("/api/members/:id/churn-score", async (request, response) => {
    data(
      response,
      await retentionService(request, response).getChurnScore(
        uuid.parse(request.params.id),
      ),
    );
  });

  app.get("/api/cancel-flow/config", async (request, response) => {
    data(
      response,
      await retentionService(
        request,
        response,
      ).getCancelFlowConfiguration(),
    );
  });

  app.patch("/api/cancel-flow/config", async (request, response) => {
    const input = parseBody(
      z.object({
        steps: z
          .array(
            z.object({
              enabled: z.boolean(),
              id: z.enum(["pause", "downgrade", "swap", "confirm"]),
              order: z.number().int().min(1).max(4).optional(),
              position: z.number().int().min(1).max(4).optional(),
              stepId: uuid.optional(),
            }).refine((step) => Boolean(step.order ?? step.position), {
              message: "A cancel-flow order is required.",
            }),
          )
          .length(4)
          .refine(
            (steps) =>
              new Set(steps.map((step) => step.id)).size === steps.length &&
              new Set(steps.map((step) => step.order ?? step.position)).size ===
                steps.length,
            "Each cancel-flow step and position must be unique.",
          ),
      }),
      request,
    );
    data(
      response,
      await retentionService(request, response).updateCancelFlowConfiguration({
        steps: input.steps.map((step) => ({
          enabled: step.enabled,
          id: step.id,
          position: step.order ?? step.position ?? 1,
          stepId: step.stepId,
        })),
      }),
    );
  });

  app.get("/api/cancel-flow/analytics", async (request, response) => {
    data(
      response,
      await retentionService(request, response).getCancelFlowAnalytics(),
    );
  });

  app.get("/api/member/cancel-flow", async (request, response) => {
    data(
      response,
      await retentionService(request, response).getMemberCancelFlow(),
    );
  });

  app.post("/api/member/cancel-flow", async (request, response) => {
    parseBody(z.object({ confirmed: z.literal(true) }), request);
    data(
      response,
      await retentionService(request, response).startMemberCancelFlow(),
      201,
    );
  });

  app.post("/api/member/cancel-flow/events", async (request, response) => {
    const input = parseBody(
      z.object({
        action: z.enum([
          "continued",
          "paused",
          "downgraded",
          "swapped",
          "cancelled",
        ]).optional(),
        attemptId: uuid.optional(),
        details: z.record(z.string(), z.unknown()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        offerId: z.string().max(200).optional(),
        outcome: z.enum([
          "continued",
          "paused",
          "downgraded",
          "swapped",
          "cancelled",
        ]).optional(),
        step: z.enum(["pause", "downgrade", "swap", "confirm"]).optional(),
        stepId: z.union([
          uuid,
          z.enum(["pause", "downgrade", "swap", "confirm"]),
        ]).optional(),
      }).refine(
        (value) =>
          Boolean(value.action ?? value.outcome) &&
          Boolean(value.step ?? value.stepId),
        "A cancellation step and outcome are required.",
      ),
      request,
    );
    data(
      response,
      await retentionService(request, response).processCancelFlowEvent({
        action: input.action ?? input.outcome ?? "continued",
        attemptId: input.attemptId,
        details: {
          ...(input.details ?? input.metadata ?? {}),
          ...(input.offerId ? { offer_id: input.offerId } : {}),
        },
        stepId: input.stepId ?? input.step ?? "confirm",
      }),
    );
  });

  app.get("/api/loyalty/members", async (request, response) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        search: z.string().trim().max(120).optional(),
      })
      .parse(request.query);
    data(
      response,
      await retentionService(request, response).listLoyaltyMembers(query),
    );
  });

  app.post("/api/loyalty/members/:id/adjust", async (request, response) => {
    const input = parseBody(
      z.object({
        points: z.number().int().min(-100_000).max(100_000).refine(Boolean),
        reason: z.string().trim().min(3).max(500),
      }),
      request,
    );
    data(
      response,
      await retentionService(request, response).adjustLoyaltyPoints(
        uuid.parse(request.params.id),
        input,
      ),
      201,
    );
  });

  app.post("/api/loyalty/members/:id/events", async (request, response) => {
    const input = parseBody(
      z.object({
        eventId: uuid,
        eventType: z.literal("event_attendance").default("event_attendance"),
        idempotencyKey: z.string().trim().min(8).max(200).optional(),
        occurredAt: z.iso.datetime().optional(),
        reason: z.string().trim().min(3).max(500).optional(),
      }),
      request,
    );
    data(
      response,
      await retentionService(request, response).recordLoyaltyEvent(
        uuid.parse(request.params.id),
        input,
      ),
      201,
    );
  });

  app.get("/api/loyalty/members/:id", async (request, response) => {
    data(
      response,
      await retentionService(request, response).getStaffMemberLoyalty(
        uuid.parse(request.params.id),
      ),
    );
  });

  app.get("/api/member/loyalty", async (request, response) => {
    data(
      response,
      await retentionService(request, response).getMemberLoyalty(),
    );
  });

  app.post("/api/member/loyalty/redeem", async (request, response) => {
    const input = parseBody(
      z.object({
        idempotencyKey: z.string().trim().min(16).max(200),
        points: z.number().int().positive().max(100_000),
        shipmentId: uuid,
      }),
      request,
    );
    data(
      response,
      await retentionService(request, response).redeemMemberLoyalty(input),
      201,
    );
  });

  app.get("/api/club-tiers", async (request, response) => {
    data(response, await coreService(request, response).listClubTiers());
  });

  app.post("/api/club-tiers", async (request, response) => {
    const input = parseBody(clubTierSchema, request) as ClubTierInput;
    data(
      response,
      await coreService(request, response).createClubTier(input),
      201,
    );
  });

  app.patch("/api/club-tiers/:id", async (request, response) => {
    const tierId = uuid.parse(request.params.id);
    const input = parseBody(clubTierPatchSchema, request);
    data(
      response,
      await coreService(request, response).updateClubTier(tierId, input),
    );
  });

  app.delete("/api/club-tiers/:id", async (request, response) => {
    const tierId = uuid.parse(request.params.id);
    await coreService(request, response).deleteClubTier(tierId);
    response.status(204).end();
  });

  app.post("/api/club-tiers/:id/assign", async (request, response) => {
    const tierId = uuid.parse(request.params.id);
    const input = parseBody(
      z.object({ memberIds: z.array(uuid).min(1).max(1_000) }),
      request,
    );
    data(
      response,
      await coreService(request, response).batchMembers({
        ids: input.memberIds,
        operation: "assign_tier",
        tierId,
      }),
    );
  });

  app.get("/api/members", async (request, response) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        search: z.string().trim().max(120).optional(),
        status: memberStatus.optional(),
        tierId: uuid.optional(),
      })
      .parse(request.query);
    data(response, await coreService(request, response).listMembers(query));
  });

  app.post("/api/members", async (request, response) => {
    const input = asMemberInput(parseBody(memberSchema, request));
    data(
      response,
      await coreService(request, response).createMember(input),
      201,
    );
  });

  app.get("/api/members/export", async (request, response) => {
    const query = z
      .object({
        search: z.string().trim().max(120).optional(),
        status: memberStatus.optional(),
        tierId: uuid.optional(),
      })
      .parse(request.query);
    const result = await coreService(request, response).exportMembers(query);
    response
      .status(200)
      .set({
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
      })
      .send(result.contents);
  });

  app.post(
    "/api/members/import/preview",
    express.raw({ limit: "6mb", type: "multipart/form-data" }),
    async (request, response) => {
      const parts = parseMultipartForm(request);
      const file = parts.find((part) => part.name === "file");
      const sourcePart = parts.find((part) => part.name === "source");
      const source = z
        .enum(["commerce7", "winedirect", "generic"])
        .parse(sourcePart?.value.toString("utf8") ?? "generic");
      if (!file?.filename || !file.value.length) {
        throw new AppError(400, "invalid_request", "Choose a non-empty CSV file.");
      }
      if (!file.filename.toLowerCase().endsWith(".csv")) {
        throw new AppError(400, "invalid_request", "Only .csv files can be imported.");
      }
      const allowedTypes = new Set([
        "application/csv",
        "application/vnd.ms-excel",
        "text/csv",
      ]);
      const contentType = file.contentType ?? "text/csv";
      if (!allowedTypes.has(contentType)) {
        throw new AppError(400, "invalid_request", "The upload must use a CSV media type.");
      }
      data(
        response,
        await coreService(request, response).previewMemberImport({
          contents: file.value.toString("utf8"),
          contentType: contentType as
            | "text/csv"
            | "application/csv"
            | "application/vnd.ms-excel",
          filename: file.filename.replaceAll(/[^\w .-]/g, "_").slice(0, 255),
          format: source,
        }),
        201,
      );
    },
  );

  app.post("/api/members/import", async (request, response) => {
    const input = parseBody(
      z.object({
        mapping: z.record(z.string(), z.string()).optional(),
        uploadToken: z.string().min(32).max(200),
      }),
      request,
    );
    data(
      response,
      await coreService(request, response).importMembers(input),
      201,
    );
  });

  app.post("/api/members/batch", async (request, response) => {
    const input = parseBody(
      z.object({
        action: z.enum(["pause", "resume", "cancel", "assign_tier"]),
        memberIds: z.array(uuid).min(1).max(1_000).optional(),
        scope: z.literal("all").optional(),
        tierId: uuid.optional(),
      }),
      request,
    );
    if (input.scope !== "all" && !input.memberIds?.length) {
      throw new AppError(
        400,
        "invalid_request",
        "Choose members or explicitly select the entire roster.",
      );
    }
    data(
      response,
      await coreService(request, response).batchMembers({
        ids: input.memberIds,
        operation: input.action,
        tierId: input.tierId,
      }),
    );
  });

  app.get("/api/members/:id", async (request, response) => {
    data(
      response,
      await coreService(request, response).getMember(
        uuid.parse(request.params.id),
      ),
    );
  });

  app.patch("/api/members/:id", async (request, response) => {
    const memberId = uuid.parse(request.params.id);
    const raw = parseBody(memberPatchSchema, request);
    const input: Partial<MemberInput> = {
      birthday: raw.birthday,
      ...(raw.address !== undefined || raw.shippingAddress !== undefined
        ? {
            shippingAddress: (raw.shippingAddress ?? raw.address) as
              | PostalAddress
              | null,
          }
        : {}),
      ...(raw.clubTierId !== undefined || raw.tierId !== undefined
        ? { clubTierId: raw.clubTierId ?? raw.tierId }
        : {}),
      email: raw.email,
      firstName: raw.firstName,
      joinDate: raw.joinDate,
      lastName: raw.lastName,
      phone: raw.phone,
      referredByMemberId: raw.referredByMemberId,
      status: raw.status,
    };
    data(
      response,
      await coreService(request, response).updateMember(memberId, input),
    );
  });

  app.delete("/api/members/:id", async (request, response) => {
    await coreService(request, response).deleteMember(
      uuid.parse(request.params.id),
    );
    response.status(204).end();
  });

  app.get("/api/releases", async (request, response) => {
    const query = z
      .object({
        from: z.iso.date().optional(),
        status: z.enum(["draft", "scheduled", "processing", "completed"]).optional(),
        to: z.iso.date().optional(),
      })
      .parse(request.query);
    data(response, await coreService(request, response).listReleases(query));
  });

  app.post("/api/releases", async (request, response) => {
    const raw = parseBody(releaseSchema, request);
    const service = coreService(request, response);
    const created = await service.createRelease(asReleaseInput(raw));
    const release =
      raw.status === "scheduled" && typeof created.id === "string"
        ? await service.scheduleRelease(created.id)
        : created;
    data(response, release, 201);
  });

  app.get("/api/releases/:id", async (request, response) => {
    data(
      response,
      await coreService(request, response).getRelease(
        uuid.parse(request.params.id),
      ),
    );
  });

  app.patch("/api/releases/:id", async (request, response) => {
    const releaseId = uuid.parse(request.params.id);
    const raw = parseBody(releaseSchema.partial(), request);
    const input: Partial<ReleaseInput> = {
      description: raw.description,
      embargoDate: raw.embargoDate,
      name: raw.name,
      processingDate: raw.processingDate,
      ...(raw.tiers || raw.tierPrices || raw.tierIds
        ? {
            tierIds:
              raw.tierIds ??
              (raw.tierPrices ?? raw.tiers ?? []).map((tier) => tier.tierId),
            tierPrices: raw.tierPrices ?? raw.tiers,
          }
        : {}),
      ...(raw.wines
        ? {
            wines: raw.wines.map((wine) => ({
              priceCents: wine.priceCents ?? 0,
              quantity: wine.quantity,
              wineName: wine.wineName ?? wine.name ?? "",
            })),
          }
        : {}),
    };
    data(
      response,
      await coreService(request, response).updateRelease(releaseId, input),
    );
  });

  app.post("/api/releases/:id/process", async (request, response) => {
    parseBody(z.object({ confirmed: z.literal(true) }), request);
    data(
      response,
      await coreService(request, response).processRelease(
        uuid.parse(request.params.id),
      ),
    );
  });

  app.get("/api/recovery", async (request, response) => {
    data(response, await coreService(request, response).listRecoveryQueue());
  });

  app.get("/api/shipments", async (request, response) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        query: z.string().trim().max(120).optional(),
        releaseId: uuid.optional(),
        search: z.string().trim().max(120).optional(),
        status: shipmentStatus.optional(),
      })
      .parse(request.query);
    data(
      response,
      await coreService(request, response).listShipments({
        ...query,
        search: query.search ?? query.query,
      }),
    );
  });

  app.post("/api/shipments/labels", async (request, response) => {
    const input = parseBody(
      z.object({ shipmentIds: z.array(uuid).min(1).max(100) }),
      request,
    );
    const result = await coreService(request, response).generateShipmentLabels(
      input.shipmentIds,
    );
    data(response, { ...result, labelCount: result.generated });
  });

  app.post("/api/shipping/validate-address", async (request, response) => {
    const address = parseBody(addressSchema, request) as PostalAddress;
    data(
      response,
      await coreService(request, response).validateShippingAddress(address),
    );
  });

  app.get("/api/shipments/pick-list", async (request, response) => {
    const releaseId = uuid.parse(request.query.releaseId);
    const result = await coreService(request, response).getPickList(releaseId);
    data(response, result);
  });

  app.post("/api/shipments/:id/pack", async (request, response) => {
    const input = parseBody(
      z.object({ barcode: z.string().trim().min(1).max(120) }),
      request,
    );
    data(
      response,
      await coreService(request, response).confirmShipmentPack(
        uuid.parse(request.params.id),
        input,
      ),
    );
  });

  app.post("/api/shipments/:id/retry", async (request, response) => {
    data(
      response,
      await coreService(request, response).retryShipment(
        uuid.parse(request.params.id),
      ),
    );
  });

  app.post("/api/shipments/:id/refund", async (request, response) => {
    const input = parseBody(
      z.object({
        amountCents: z.number().int().positive().optional(),
        reason: z.string().trim().max(500).optional(),
      }),
      request,
    );
    data(
      response,
      await coreService(request, response).refundShipment(
        uuid.parse(request.params.id),
        input,
      ),
    );
  });

  app.patch("/api/shipments/:id/status", async (request, response) => {
    const input = parseBody(
      z.object({
        carrier: z.string().trim().max(80).optional(),
        status: z.enum(["shipped", "delivered", "cancelled"]),
        trackingNumber: z.string().trim().max(160).optional(),
      }),
      request,
    );
    data(
      response,
      await coreService(request, response).transitionShipment(
        uuid.parse(request.params.id),
        input,
      ),
    );
  });

  app.get("/api/member/shipments", async (request, response) => {
    data(
      response,
      await coreService(request, response).getMemberPortalHistory(),
    );
  });

  app.patch("/api/member/profile/address", async (request, response) => {
    const address = parseBody(addressSchema, request) as PostalAddress;
    data(
      response,
      await coreService(request, response).updateMemberPortalAddress(address),
    );
  });

  app.post("/api/member/billing/portal", async (request, response) => {
    data(
      response,
      await coreService(request, response).createMemberPaymentMethodPortal(),
    );
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
