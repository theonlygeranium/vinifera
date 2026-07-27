import cors from "cors";
import express, {
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { z, type ZodType } from "zod";
import mobileIdentity from "../mobile/app-identity.json";
import { getConfigurationReport } from "./config";
import { errorHandler } from "./lib/error-handler";
import { AppError } from "./lib/errors";
import { createRateLimits } from "./lib/rate-limit";
import {
  assertTrustedOrigin,
  CONTENT_SECURITY_POLICY,
  isTrustedRequestOrigin,
} from "./lib/security";
import { requireAuthPresence } from "./lib/auth-presence";

import { createProductionFoundationService } from "./services/production-foundation";
import {
  androidAssetLinks,
  appleAppSiteAssociation,
} from "./services/integrations";
import { verifyUnsubscribeToken } from "./services/retention";
import type {
  AnalyticsService,
  ApplicationService,
  ClubTierInput,
  CsvMapping,
  MemberInput,
  PostalAddress,
  ReleaseInput,
  FoundationServiceFactory,
  IntegrationService,
  IntegrationType,
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
const mobileAuthRedirectUri =
  `${mobileIdentity.customScheme}://${mobileIdentity.mobileAuthRedirectPath.slice(1)}`;

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
  fullName: z.string().trim().min(2).max(120).optional(),
  inviteToken: z.string().uuid().optional(),
  password,
});
const invitationSchema = z.object({
  email,
  role: z.enum(["admin", "manager", "staff"]),
});
const billingSchema = z.object({ attemptId: z.uuid(), planTier });
const billingPortalSchema = z.object({ attemptId: z.uuid() });
const memberMagicLinkSchema = z.object({ brandId: z.uuid().optional(), email });
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
const analyticsRange = z.enum(["7d", "30d", "90d", "12m", "all", "custom"]);
const analyticsRangeQuerySchema = z.object({
  from: z.iso.date().optional(),
  range: analyticsRange.default("30d"),
  scope: z.enum(["brand", "all"]).default("brand"),
  to: z.iso.date().optional(),
});
const analyticsWidget = z.enum([
  "revenue-by-tier",
  "member-growth",
  "member-cohorts",
  "ltv-by-tier",
  "shipment-operations",
  "engagement",
  "acquisition",
]);
const analyticsLayoutSchema = z.object({
  widgets: z
    .array(
      z.object({
        enabled: z.boolean(),
        id: analyticsWidget,
        order: z.number().int().min(0).max(100),
        size: z.enum(["half", "full"]),
      }),
    )
    .min(1)
    .max(7),
});
const analyticsReportSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["weekly", "monthly"]),
  recipientEmail: email,
  widgetIds: z.array(analyticsWidget).min(1).max(7),
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

function commandId(request: Request): string {
  const result = uuid.safeParse(request.get("idempotency-key"));
  if (!result.success) {
    throw new AppError(
      400,
      "invalid_request",
      "A UUID Idempotency-Key header is required for this operation.",
    );
  }
  return result.data;
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
  const rateLimits = createRateLimits(options.getEnv);
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
  const analyticsService = (
    request: Request,
    response: Response,
  ): AnalyticsService => {
    const candidate = createService(request, response);
    if (!("getAnalyticsDashboard" in candidate)) {
      throw new AppError(
        503,
        "activation_required",
        "The analytics and intelligence service is not connected.",
      );
    }
    return candidate as unknown as AnalyticsService;
  };
  const integrationService = (
    request: Request,
    response: Response,
  ): IntegrationService => {
    const candidate = createService(request, response);
    if (!("listIntegrations" in candidate)) {
      throw new AppError(
        503,
        "activation_required",
        "The integrations service is not connected.",
      );
    }
    return candidate as unknown as IntegrationService;
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
        methods: ["DELETE", "GET", "PATCH", "POST", "PUT", "OPTIONS"],
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
  app.use("/api/auth", rateLimits.auth);
  app.use("/api/webhooks", rateLimits.webhooks);
  app.use("/api/email/webhook", rateLimits.webhooks);
  app.use("/api/billing/webhook", rateLimits.webhooks);
  app.use("/api/admin", rateLimits.admin);
  app.use("/api", rateLimits.api);

  app.get("/.well-known/apple-app-site-association", (_request, response) => {
    response
      .status(200)
      .type("application/json")
      .send(JSON.stringify(appleAppSiteAssociation(options.getEnv())));
  });

  app.get("/.well-known/assetlinks.json", (_request, response) => {
    response
      .status(200)
      .type("application/json")
      .send(JSON.stringify(androidAssetLinks(options.getEnv())));
  });

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
    "/api/webhooks/klaviyo/:integrationId",
    express.raw({ limit: "5mb", type: "application/json" }),
    async (request, response) => {
      const result = await integrationService(
        request,
        response,
      ).handleKlaviyoWebhook(
        uuid.parse(request.params.integrationId),
        request.body as Buffer,
        {
          signature: request.get("Klaviyo-Signature"),
          timestamp: request.get("Klaviyo-Timestamp"),
          webhookId: request.get("Klaviyo-Webhook-Id"),
        },
      );
      data(response, result, 202);
    },
  );

  app.get("/api/integrations/quickbooks/callback", async (request, response) => {
    const query = z
      .object({
        code: z.string().min(1).max(4_096),
        realmId: z.string().min(1).max(255),
        state: z.string().min(32).max(8_192),
      })
      .parse(request.query);
    const result = await integrationService(
      request,
      response,
    ).completeQuickBooksOAuth(query);
    response.redirect(303, result.redirectPath);
  });

  app.get("/api/auth/member/mobile/callback", async (request, response) => {
    const query = z
      .object({
        state: z.string().min(32).max(8_192),
        token_hash: z.string().min(20).max(512),
        type: z.literal("email"),
      })
      .parse(request.query);
    const result = await integrationService(
      request,
      response,
    ).completeMobileMagicLink({
      state: query.state,
      tokenHash: query.token_hash,
      type: query.type,
    });
    response.redirect(303, result.redirectUrl);
  });

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
  app.use(requireAuthPresence(options.getEnv));

  app.get("/api/health", (_request, response) => {
    data(response, { service: "vinifera-api", status: "ok" });
  });

  app.get("/api/health/configuration", (_request, response) => {
    data(response, getConfigurationReport(options.getEnv()));
  });

  app.get("/api/portal/branding", async (request, response) => {
    if (!getConfigurationReport(options.getEnv()).database.configured) {
      data(response, { brand: null, mode: "canonical" });
      return;
    }
    const host = request.get("host") ?? "";
    data(
      response,
      await integrationService(request, response).getPortalBranding(host),
    );
  });

  const integrationType = z.enum([
    "klaviyo",
    "quickbooks",
    "avalara",
    "meta",
  ]);
  const safeObject = z.record(z.string(), z.unknown());
  const integrationConnectSchema = z.object({
    brandId: uuid.nullable().optional(),
    consentConfirmed: z.boolean(),
    credentials: safeObject.optional(),
    optedIn: z.boolean(),
    syncConfig: safeObject.optional(),
  });
  const integrationUpdateSchema = z
    .object({
      consentConfirmed: z.boolean().optional(),
      credentials: safeObject.optional(),
      optedIn: z.boolean().optional(),
      syncConfig: safeObject.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "Choose at least one integration field to update.",
    });
  const brandSchema = z.object({
    billingMode: z.enum(["shared", "independent"]).default("shared"),
    defaultShippingChargeCents: z.number().int().min(0).max(100_000).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    name: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  });
  const brandPatchSchema = z
    .object({
      accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      billingMode: z.enum(["shared", "independent"]).optional(),
      defaultShippingChargeCents: z.number().int().min(0).max(100_000).optional(),
      description: z.string().trim().max(2_000).nullable().optional(),
      emailSenderAddress: email.nullable().optional(),
      emailSenderName: z.string().trim().min(1).max(200).optional(),
      fontFamily: z.string().trim().min(1).max(100).optional(),
      logoUrl: z.url().startsWith("https://").nullable().optional(),
      name: z.string().trim().min(1).max(200).optional(),
      primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
      portalTitle: z.string().trim().min(1).max(200).optional(),
      secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: "Choose at least one brand field to update.",
    });

  app.get("/api/integrations", async (request, response) => {
    data(response, await integrationService(request, response).listIntegrations());
  });

  app.post("/api/integrations/:type/connect", async (request, response) => {
    const type = integrationType.parse(request.params.type) as IntegrationType;
    data(
      response,
      await integrationService(request, response).connectIntegration(
        type,
        parseBody(integrationConnectSchema, request),
      ),
      201,
    );
  });

  app.patch("/api/integrations/:type", async (request, response) => {
    const type = integrationType.parse(request.params.type) as IntegrationType;
    data(
      response,
      await integrationService(request, response).updateIntegration(
        type,
        parseBody(integrationUpdateSchema, request),
      ),
    );
  });

  app.delete("/api/integrations/:type", async (request, response) => {
    await integrationService(request, response).disconnectIntegration(
      integrationType.parse(request.params.type) as IntegrationType,
    );
    response.status(204).end();
  });

  app.post("/api/integrations/:type/sync", async (request, response) => {
    data(
      response,
      await integrationService(request, response).queueIntegrationSync(
        integrationType.parse(request.params.type) as IntegrationType,
      ),
      202,
    );
  });

  app.get("/api/integrations/:type/logs", async (request, response) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(25) })
      .parse(request.query);
    data(
      response,
      await integrationService(request, response).listIntegrationLogs(
        integrationType.parse(request.params.type) as IntegrationType,
        query.limit,
      ),
    );
  });

  app.get("/api/integrations/quickbooks/authorize", async (request, response) => {
    const brandId = request.query.brandId
      ? uuid.parse(request.query.brandId)
      : undefined;
    data(
      response,
      await integrationService(
        request,
        response,
      ).getQuickBooksAuthorizationUrl(brandId),
    );
  });

  app.get(
    "/api/integrations/quickbooks/reconciliation",
    async (request, response) => {
      data(
        response,
        await integrationService(
          request,
          response,
        ).getQuickBooksReconciliation(),
      );
    },
  );

  app.get("/api/integrations/avalara/liability", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getAvalaraLiability(),
    );
  });

  app.get("/api/integrations/avalara/filing", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getAvalaraFilingStatus(),
    );
  });

  app.post(
    "/api/integrations/avalara/filing/verify",
    async (request, response) => {
      data(
        response,
        await integrationService(
          request,
          response,
        ).queueAvalaraFilingVerification(),
        202,
      );
    },
  );

  app.get(
    "/api/integrations/meta/attribution",
    async (request, response) => {
      const query = z
        .object({
          from: z.iso.datetime().optional(),
          to: z.iso.datetime().optional(),
        })
        .parse(request.query);
      data(
        response,
        await integrationService(
          request,
          response,
        ).getMetaAttributionReport(query),
      );
    },
  );

  app.get("/api/brands", async (request, response) => {
    data(response, await integrationService(request, response).listBrands());
  });

  app.post("/api/brands", async (request, response) => {
    data(
      response,
      await integrationService(request, response).createBrand(
        parseBody(brandSchema, request),
      ),
      201,
    );
  });

  app.patch("/api/brands/:id", async (request, response) => {
    data(
      response,
      await integrationService(request, response).updateBrand(
        uuid.parse(request.params.id),
        parseBody(brandPatchSchema, request),
      ),
    );
  });

  app.post("/api/brands/:id/sender/verify", async (request, response) => {
    data(
      response,
      await integrationService(request, response).activateBrandSender(
        uuid.parse(request.params.id),
      ),
      202,
    );
  });

  app.get("/api/organization/overview", async (request, response) => {
    const query = z
      .object({ brandId: z.union([uuid, z.literal("all")]).optional() })
      .parse(request.query);
    data(
      response,
      await integrationService(request, response).getBrandOverview(
        query.brandId,
      ),
    );
  });

  app.put("/api/brands/:id/domain", async (request, response) => {
    const input = parseBody(
      z.object({
        hostname: z.string().trim().min(4).max(253),
      }),
      request,
    );
    data(
      response,
      await integrationService(request, response).updateBrandDomain(
        uuid.parse(request.params.id),
        input.hostname,
      ),
      201,
    );
  });

  app.get("/api/brands/:id/domain", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getBrandDomain(
        uuid.parse(request.params.id),
      ),
    );
  });

  app.delete("/api/brands/:id/domain", async (request, response) => {
    await integrationService(request, response).deleteBrandDomain(
      uuid.parse(request.params.id),
    );
    response.status(204).end();
  });

  app.get("/api/mobile/app-policy", async (request, response) => {
    const query = z
      .object({
        platform: z.enum(["ios", "android"]),
        version: z.string().trim().min(3).max(50),
      })
      .parse(request.query);
    data(
      response,
      await integrationService(request, response).getMobileAppPolicy(query),
    );
  });

  app.post("/api/auth/member/mobile/magic-link", async (request, response) => {
    const input = parseBody(
      z.object({
        clubCode: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .optional(),
        deviceFingerprint: z.string().trim().min(16).max(255),
        email,
        redirectUri: z.literal(mobileAuthRedirectUri),
      }),
      request,
    );
    await integrationService(request, response).requestMobileMagicLink({
      ...input,
      ipAddress: getClientAddress(request),
    });
    data(response, {
      message: "If this membership exists, a secure sign-in link is on its way.",
    });
  });

  app.post("/api/auth/member/mobile/exchange", async (request, response) => {
    const input = parseBody(
      z.object({
        appVersion: z.string().trim().min(3).max(50),
        code: z.string().min(32).max(512),
        deviceFingerprint: z.string().trim().min(16).max(255),
        platform: z.enum(["ios", "android"]),
        redirectUri: z.literal(mobileAuthRedirectUri),
      }),
      request,
    );
    data(
      response,
      await integrationService(request, response).exchangeMobileSession(input),
    );
  });

  app.post("/api/auth/member/mobile/refresh", async (request, response) => {
    const input = parseBody(
      z.object({ refreshToken: z.string().min(32).max(512) }),
      request,
    );
    data(
      response,
      await integrationService(request, response).refreshMobileSession(input),
    );
  });

  app.post("/api/auth/member/mobile/logout", async (request, response) => {
    const input = parseBody(
      z.object({ refreshToken: z.string().min(32).max(512) }),
      request,
    );
    await integrationService(request, response).logoutMobileSession(input);
    response.status(204).end();
  });

  app.get("/api/mobile/bootstrap", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getMobileBootstrap(),
    );
  });

  app.post("/api/mobile/devices", async (request, response) => {
    const input = parseBody(
      z.object({
        appVersion: z.string().trim().min(3).max(50),
        brandId: uuid.nullable().optional(),
        deviceFingerprint: z.string().trim().min(16).max(255),
        permission: z.enum(["denied", "granted", "prompt"]),
        platform: z.enum(["ios", "android"]),
        token: z.string().min(16).max(4_096),
      }),
      request,
    );
    data(
      response,
      await integrationService(request, response).registerMobileDevice(input),
      201,
    );
  });

  app.delete("/api/mobile/devices", async (request, response) => {
    const input = parseBody(
      z.object({ deviceFingerprint: z.string().trim().min(16).max(255) }),
      request,
    );
    await integrationService(request, response).unregisterMobileDevice(
      input.deviceFingerprint,
    );
    response.status(204).end();
  });

  app.put("/api/member/privacy/meta", async (request, response) => {
    const input = parseBody(
      z
        .object({
          attribution: z
            .object({
              campaignId: z.string().trim().max(120).nullable().optional(),
              campaignName: z.string().trim().max(200).nullable().optional(),
              eventSourceUrl: z.url().max(2_048),
              fbc: z.string().trim().max(255).nullable().optional(),
              fbp: z.string().trim().max(255).nullable().optional(),
              medium: z.string().trim().max(120).nullable().optional(),
              occurredAt: z.iso.datetime(),
              source: z.string().trim().max(120).nullable().optional(),
            })
            .optional(),
          clientEventId: uuid.optional(),
          consentSource: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .default("member_portal"),
          consented: z.boolean(),
          policyVersion: z.string().trim().min(1).max(80),
        })
        .superRefine((value, context) => {
          if (value.attribution && !value.clientEventId) {
            context.addIssue({
              code: "custom",
              message: "clientEventId is required with attribution.",
              path: ["clientEventId"],
            });
          }
          if (!value.consented && value.attribution) {
            context.addIssue({
              code: "custom",
              message: "Attribution requires Meta consent.",
              path: ["attribution"],
            });
          }
        }),
      request,
    );
    data(
      response,
      await integrationService(request, response).updateMemberMetaPrivacy(
        input,
      ),
    );
  });

  app.get("/api/member/privacy/meta", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getMemberMetaPrivacy(),
    );
  });

  app.get("/api/analytics/dashboard", async (request, response) => {
    const query = analyticsRangeQuerySchema.parse(request.query);
    data(
      response,
      await analyticsService(request, response).getAnalyticsDashboard(query),
    );
  });

  app.get("/api/analytics/export", async (request, response) => {
    const query = analyticsRangeQuerySchema
      .extend({
        widget: analyticsWidget.optional(),
        widgetId: analyticsWidget.optional(),
      })
      .refine((value) => Boolean(value.widgetId ?? value.widget), {
        message: "widgetId is required.",
        path: ["widgetId"],
      })
      .parse(request.query);
    const result = await analyticsService(
      request,
      response,
    ).exportAnalyticsWidget(query.widgetId ?? query.widget ?? "", query);
    response
      .status(200)
      .set({
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
      })
      .send(result.contents);
  });

  app.get("/api/analytics/layout", async (request, response) => {
    data(
      response,
      await analyticsService(request, response).getAnalyticsLayout(),
    );
  });

  app.patch("/api/analytics/layout", async (request, response) => {
    const input = parseBody(analyticsLayoutSchema, request);
    data(
      response,
      await analyticsService(request, response).saveAnalyticsLayout(input),
    );
  });

  app.get("/api/analytics/reports", async (request, response) => {
    data(
      response,
      await analyticsService(
        request,
        response,
      ).listScheduledAnalyticsReports(),
    );
  });

  app.post("/api/analytics/reports", async (request, response) => {
    const input = parseBody(analyticsReportSchema, request);
    data(
      response,
      await analyticsService(
        request,
        response,
      ).upsertScheduledAnalyticsReport(input),
      201,
    );
  });

  app.patch("/api/analytics/reports/:id", async (request, response) => {
    const input = parseBody(analyticsReportSchema.partial(), request);
    if (!Object.keys(input).length) {
      throw new AppError(
        400,
        "invalid_request",
        "Choose at least one report schedule field to update.",
      );
    }
    data(
      response,
      await analyticsService(
        request,
        response,
      ).updateScheduledAnalyticsReport(uuid.parse(request.params.id), input),
    );
  });

  app.post("/api/analytics/events", async (request, response) => {
    const input = parseBody(
      z.object({
        eventData: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          )
          .optional(),
        eventType: z.string().trim().min(2).max(80),
        idempotencyKey: z.string().trim().min(16).max(200),
        memberId: uuid.optional(),
      }),
      request,
    );
    data(
      response,
      await analyticsService(request, response).recordAnalyticsEvent(input),
      202,
    );
  });

  app.get("/api/ml/operations", async (request, response) => {
    data(
      response,
      await analyticsService(request, response).getMlOperations(),
    );
  });

  app.get("/api/churn-intelligence", async (request, response) => {
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
      await analyticsService(request, response).getChurnIntelligence(query),
    );
  });

  app.patch(
    "/api/churn-intelligence/alerts/:id",
    async (request, response) => {
      parseBody(
        z.object({ status: z.literal("acknowledged") }),
        request,
      );
      data(
        response,
        await analyticsService(
          request,
          response,
        ).acknowledgeHighRiskAlert(uuid.parse(request.params.id)),
      );
    },
  );

  app.get(
    "/api/members/:id/churn-intelligence",
    async (request, response) => {
      data(
        response,
        await analyticsService(
          request,
          response,
        ).getMemberChurnIntelligence(uuid.parse(request.params.id)),
      );
    },
  );

  app.get("/api/benchmarks", async (request, response) => {
    data(
      response,
      await analyticsService(request, response).getBenchmarkComparison(),
    );
  });

  app.patch("/api/benchmarks/preferences", async (request, response) => {
    const input = parseBody(
      z.object({
        optedIn: z.boolean(),
        quarterlyReportEnabled: z.boolean(),
      }),
      request,
    );
    data(
      response,
      await analyticsService(request, response).setBenchmarkOptIn(input),
    );
  });

  app.get("/api/compliance/dashboard", async (request, response) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        releaseId: uuid.optional(),
        status: z
          .enum(["compliant", "non_compliant", "unknown"])
          .optional(),
      })
      .parse(request.query);
    data(
      response,
      await analyticsService(request, response).listComplianceChecks(query),
    );
  });

  app.get("/api/compliance/checks/:id", async (request, response) => {
    data(
      response,
      await analyticsService(request, response).getComplianceCheck(
        uuid.parse(request.params.id),
      ),
    );
  });

  app.post(
    "/api/compliance/shipments/:shipmentId/check",
    async (request, response) => {
      data(
        response,
        await analyticsService(
          request,
          response,
        ).runShipmentComplianceCheck(uuid.parse(request.params.shipmentId)),
        201,
      );
    },
  );

  app.post(
    "/api/compliance/releases/:releaseId/check",
    async (request, response) => {
      data(
        response,
        await analyticsService(
          request,
          response,
        ).runReleaseComplianceChecks(uuid.parse(request.params.releaseId)),
        201,
      );
    },
  );

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
    const query = z
      .object({
        code: z.string().min(1),
        state: z.string().min(32).max(8_192),
      })
      .parse(request.query);
    const result = await createService(request, response).exchangeAuthCode(
      "member",
      query.code,
      query.state,
    );
    response.redirect(
      303,
      safeRedirectPath(result.destination, "/portal/"),
    );
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
    const input = parseBody(billingSchema, request) as {
      attemptId: string;
      planTier: PlanTier;
    };
    data(response, await createService(request, response).createBillingCheckout(input));
  });

  app.post("/api/billing/portal", async (request, response) => {
    const input = parseBody(billingPortalSchema, request) as {
      attemptId: string;
    };
    data(response, await createService(request, response).createBillingPortal(input));
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
        body: z.string().trim().min(1).max(100_000).optional(),
        email: email.optional(),
        recipient: email.optional(),
        subject: z.string().trim().min(1).max(200).optional(),
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
          body: input.body,
          email: input.email ?? input.recipient ?? "",
          subject: input.subject,
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
          )
          .refine(
            (steps) =>
              steps.some(
                (step) =>
                  step.id === "confirm" &&
                  step.enabled &&
                  (step.order ?? step.position) === 4,
              ),
            "The enabled confirmation step must remain last.",
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
      await retentionService(request, response).startMemberCancelFlow(
        commandId(request),
      ),
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
        commandId: commandId(request),
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
        commandId(request),
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
    const query = z
      .object({
        cursor: z.string().trim().min(1).max(1_000).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    data(
      response,
      await retentionService(request, response).getStaffMemberLoyalty(
        uuid.parse(request.params.id),
        query,
      ),
    );
  });

  app.get("/api/member/loyalty", async (request, response) => {
    const query = z
      .object({
        cursor: z.string().trim().min(1).max(1_000).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    data(
      response,
      await retentionService(request, response).getMemberLoyalty(query),
    );
  });

  app.post("/api/member/loyalty/redeem", async (request, response) => {
    const input = parseBody(
      z.object({
        idempotencyKey: uuid,
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
      await coreService(request, response).createClubTier(
        input,
        commandId(request),
      ),
      201,
    );
  });

  app.patch("/api/club-tiers/:id", async (request, response) => {
    const tierId = uuid.parse(request.params.id);
    const input = parseBody(clubTierPatchSchema, request);
    data(
      response,
      await coreService(request, response).updateClubTier(
        tierId,
        input,
        commandId(request),
      ),
    );
  });

  app.delete("/api/club-tiers/:id", async (request, response) => {
    const tierId = uuid.parse(request.params.id);
    await coreService(request, response).deleteClubTier(
      tierId,
      commandId(request),
    );
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
      }, commandId(request)),
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
      await coreService(request, response).createMember(
        input,
        commandId(request),
      ),
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
      }, commandId(request)),
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
    if (raw.status !== undefined) {
      const includesProfileChanges = Object.entries(raw).some(
        ([field, value]) => field !== "status" && value !== undefined,
      );
      if (includesProfileChanges) {
        throw new AppError(
          400,
          "invalid_request",
          "Update member status separately from profile details.",
        );
      }
      data(
        response,
        await coreService(request, response).transitionMember(
          memberId,
          raw.status,
          commandId(request),
        ),
      );
      return;
    }
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
    };
    data(
      response,
      await coreService(request, response).updateMember(
        memberId,
        input,
        commandId(request),
      ),
    );
  });

  app.delete("/api/members/:id", async (request, response) => {
    await coreService(request, response).deleteMember(
      uuid.parse(request.params.id),
      commandId(request),
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
    const release = await service.createRelease(
      asReleaseInput(raw),
      commandId(request),
      raw.status ?? "draft",
    );
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
      await coreService(request, response).updateRelease(
        releaseId,
        input,
        commandId(request),
      ),
    );
  });

  app.post("/api/releases/:id/schedule", async (request, response) => {
    parseBody(z.object({ confirmed: z.literal(true) }), request);
    data(
      response,
      await coreService(request, response).scheduleRelease(
        uuid.parse(request.params.id),
        commandId(request),
      ),
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
        commandId(request),
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
      await coreService(request, response).updateMemberPortalAddress(
        address,
        commandId(request),
      ),
    );
  });

  app.post("/api/member/billing/portal", async (request, response) => {
    const input = parseBody(billingPortalSchema, request) as {
      attemptId: string;
    };
    data(
      response,
      await coreService(request, response).createMemberPaymentMethodPortal(input),
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

  app.use(errorHandler);

  return app;
}
