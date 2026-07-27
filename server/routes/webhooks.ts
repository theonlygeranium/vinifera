import express, { Router } from "express";
import { AppError } from "../lib/errors";
import { data, uuid, type RouteContext } from "./shared";

export default function createWebhooksRouter(
  context: RouteContext,
): Router {
  const { createService, integrationService, retentionService } = context;
  const router = Router();

  router.post(
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

  router.post(
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

  router.post(
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

  return router;
}
