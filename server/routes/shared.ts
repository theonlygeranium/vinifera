import type { Request, Response } from "express";
import { z, type ZodType } from "zod";
import mobileIdentity from "../../mobile/app-identity.json";
import { AppError } from "../lib/errors";
import { createProductionFoundationService } from "../services/production-foundation";
import type {
  AnalyticsService,
  ApplicationService,
  FoundationServiceFactory,
  IntegrationService,
  RetentionService,
  WorkerEnv,
} from "../types";

export const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
export const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128)
  .regex(/[a-z]/, "Add a lowercase letter.")
  .regex(/[A-Z]/, "Add an uppercase letter.")
  .regex(/[0-9]/, "Add a number.");
export const planTier = z.enum(["vine", "cellar", "estate", "reserve"]);
export const mobileAuthRedirectUri =
  `${mobileIdentity.customScheme}://${mobileIdentity.mobileAuthRedirectPath.slice(1)}`;
export const uuid = z.uuid();
export const memberStatus = z.enum(["active", "paused", "cancelled"]);
export const shipmentStatus = z.enum([
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
export const addressSchema = z.object({
  city: z.string().trim().min(2).max(120),
  country: z.string().trim().length(2).default("US"),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  postalCode: z.string().trim().min(3).max(24),
  state: z.string().trim().min(2).max(80),
});
export const billingPortalSchema = z.object({ attemptId: z.uuid() });

export interface AppOptions {
  createService?: FoundationServiceFactory;
  getEnv: () => WorkerEnv;
}

export interface RouteContext {
  analyticsService: (
    request: Request,
    response: Response,
  ) => AnalyticsService;
  coreService: (
    request: Request,
    response: Response,
  ) => ApplicationService;
  createService: FoundationServiceFactory;
  integrationService: (
    request: Request,
    response: Response,
  ) => IntegrationService;
  options: AppOptions;
  retentionService: (
    request: Request,
    response: Response,
  ) => RetentionService;
}

export function createRouteContext(options: AppOptions): RouteContext {
  const createService =
    options.createService ??
    ((request, response) =>
      createProductionFoundationService(options.getEnv(), request, response));
  const coreService = (
    request: Request,
    response: Response,
  ): ApplicationService => {
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

  return {
    analyticsService,
    coreService,
    createService,
    integrationService,
    options,
    retentionService,
  };
}

export function parseBody<T>(schema: ZodType<T>, request: Request): T {
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

export function commandId(request: Request): string {
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

export function data<T>(response: Response, payload: T, status = 200): void {
  response.status(status).json({ data: payload });
}

export function getClientAddress(request: Request): string {
  const connectingIp = request.get("cf-connecting-ip");
  if (connectingIp) return connectingIp;
  return request.ip || "unknown";
}

export function safeRedirectPath(candidate: unknown, fallback: string): string {
  if (
    typeof candidate === "string" &&
    candidate.startsWith("/") &&
    !candidate.startsWith("//")
  ) {
    return candidate;
  }
  return fallback;
}
