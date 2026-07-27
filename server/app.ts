import cors from "cors";
import express from "express";
import helmet from "helmet";
import { requireAuthPresence } from "./lib/auth-presence";
import { AppError } from "./lib/errors";
import { createRateLimits } from "./lib/rate-limit";
import {
  assertTrustedOrigin,
  CONTENT_SECURITY_POLICY,
  isTrustedRequestOrigin,
} from "./lib/security";
import {
  mountPublicRoutes,
  mountRouteErrors,
  mountRoutes,
} from "./routes";
import {
  createRouteContext,
  type AppOptions,
} from "./routes/shared";

export function createApp(options: AppOptions): express.Express {
  const app = express();
  const rateLimits = createRateLimits(options.getEnv);
  const routeContext = createRouteContext(options);

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

  mountPublicRoutes(app, routeContext);

  app.use(express.json({ limit: "256kb", strict: true }));
  app.use(assertTrustedOrigin(options.getEnv));
  app.use(requireAuthPresence(options.getEnv));

  mountRoutes(app, routeContext);
  mountRouteErrors(app);

  return app;
}
