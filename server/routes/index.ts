import type { Express } from "express";
import { errorHandler } from "../lib/error-handler";
import { AppError } from "../lib/errors";
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

  app.use(errorHandler);
}
