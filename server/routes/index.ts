import type {
  Express,
  NextFunction,
  Request,
  Response,
} from "express";
import { z } from "zod";
import { AppError, asAppError } from "../lib/errors";
import createAnalyticsRouter from "./analytics";
import createAuthRouter from "./auth";
import createBillingRouter from "./billing";
import createComplianceRouter from "./compliance";
import createFulfillmentRouter from "./fulfillment";
import createIntegrationsRouter, {
  createIntegrationCallbackRouter,
} from "./integrations";
import createIntelligenceRouter from "./intelligence";
import createMembersRouter from "./members";
import createMobileRouter, { createMobileCallbackRouter } from "./mobile";
import createReleasesRouter from "./releases";
import createRetentionRouter, {
  createPublicRetentionRouter,
} from "./retention";
import type { RouteContext } from "./shared";
import createSystemRouter, { createPublicSystemRouter } from "./system";
import createTiersRouter from "./tiers";
import createWebhooksRouter from "./webhooks";

export function mountPublicRoutes(
  app: Express,
  context: RouteContext,
): void {
  app.use(createPublicSystemRouter(context));
  app.use(createWebhooksRouter(context));
  app.use(createIntegrationCallbackRouter(context));
  app.use(createMobileCallbackRouter(context));
  app.use(createPublicRetentionRouter(context));
}

export function mountRoutes(
  app: Express,
  context: RouteContext,
): void {
  app.use(createSystemRouter(context));
  app.use(createIntegrationsRouter(context));
  app.use(createMobileRouter(context));
  app.use(createAnalyticsRouter(context));
  app.use(createIntelligenceRouter(context));
  app.use(createComplianceRouter(context));
  app.use(createAuthRouter(context));
  app.use(createBillingRouter(context));
  app.use(createRetentionRouter(context));
  app.use(createTiersRouter(context));
  app.use(createMembersRouter(context));
  app.use(createReleasesRouter(context));
  app.use(createFulfillmentRouter(context));
}

export function mountRouteErrors(app: Express): void {
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
      } else if (appError.status >= 400) {
        console.warn(
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
}
