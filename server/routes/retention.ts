import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { verifyUnsubscribeToken } from "../services/retention";
import {
  commandId,
  data,
  email,
  parseBody,
  uuid,
  type RouteContext,
} from "./shared";

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
const emailTemplatePatchSchema = emailTemplateSchema
  .extend({ enabled: z.boolean().optional() })
  .partial();

export function createPublicRetentionRouter(
  context: RouteContext,
): Router {
  const { options, retentionService } = context;
  const router = Router();

  router.get("/api/communications/unsubscribe", async (request, response) => {
    response.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    const token = z.string().min(32).max(4_096).parse(request.query.token);
    await verifyUnsubscribeToken(options.getEnv(), token);
    const action = `/api/communications/unsubscribe?token=${encodeURIComponent(
      token,
    )}`;
    // TODO(BS-03): move logic to service layer
    response
      .status(200)
      .type("html")
      .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title></head>
<body><main><h1>Email preferences</h1><p>Confirm that you want to stop optional transactional notifications. Essential billing and account notices may still be sent.</p><form method="post" action="${action}"><button type="submit" style="min-height:44px;min-width:44px">Update email preference</button></form></main></body></html>`);
  });

  router.post("/api/communications/unsubscribe", async (request, response) => {
    response.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });
    const token = z.string().min(32).max(4_096).parse(request.query.token);
    await retentionService(request, response).applyUnsubscribe(token);
    data(response, {
      message: "Your optional transactional email preference has been updated.",
      unsubscribed: true,
    });
  });

  return router;
}

export default function createRetentionRouter(
  context: RouteContext,
): Router {
  const { retentionService } = context;
  const router = Router();

  router.get("/api/email/templates", async (request, response) => {
    data(
      response,
      await retentionService(request, response).listEmailTemplates(),
    );
  });

  router.post("/api/email/templates", async (request, response) => {
    const input = parseBody(emailTemplateSchema, request);
    data(
      response,
      await retentionService(request, response).upsertEmailTemplate(input),
      201,
    );
  });

  router.patch("/api/email/templates/:id", async (request, response) => {
    const input = parseBody(emailTemplatePatchSchema, request);
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

  router.delete("/api/email/templates/:id", async (request, response) => {
    await retentionService(request, response).deleteEmailTemplate(
      uuid.parse(request.params.id),
    );
    response.status(204).end();
  });

  router.post("/api/email/templates/:id/preview", async (request, response) => {
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

  router.post(
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

  router.get("/api/email/log", async (request, response) => {
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

  router.get("/api/churn-scores", async (request, response) => {
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

  router.get("/api/members/:id/churn-score", async (request, response) => {
    data(
      response,
      await retentionService(request, response).getChurnScore(
        uuid.parse(request.params.id),
      ),
    );
  });

  router.get("/api/cancel-flow/config", async (request, response) => {
    data(
      response,
      await retentionService(
        request,
        response,
      ).getCancelFlowConfiguration(),
    );
  });

  router.patch("/api/cancel-flow/config", async (request, response) => {
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
    // TODO(BS-03): move logic to service layer
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

  router.get("/api/cancel-flow/analytics", async (request, response) => {
    data(
      response,
      await retentionService(request, response).getCancelFlowAnalytics(),
    );
  });

  router.get("/api/member/cancel-flow", async (request, response) => {
    data(
      response,
      await retentionService(request, response).getMemberCancelFlow(),
    );
  });

  router.post("/api/member/cancel-flow", async (request, response) => {
    parseBody(z.object({ confirmed: z.literal(true) }), request);
    data(
      response,
      await retentionService(request, response).startMemberCancelFlow(
        commandId(request),
      ),
      201,
    );
  });

  router.post("/api/member/cancel-flow/events", async (request, response) => {
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
    // TODO(BS-03): move logic to service layer
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

  router.get("/api/loyalty/members", async (request, response) => {
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

  router.post("/api/loyalty/members/:id/adjust", async (request, response) => {
    const input = parseBody(
      z.object({
        points: z
          .number()
          .int()
          .min(-100_000)
          .max(100_000)
          .refine((points) => points !== 0, {
            message: "Point adjustment cannot be zero.",
          }),
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

  router.post("/api/loyalty/members/:id/events", async (request, response) => {
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

  router.get("/api/loyalty/members/:id", async (request, response) => {
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

  router.get("/api/member/loyalty", async (request, response) => {
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

  router.post("/api/member/loyalty/redeem", async (request, response) => {
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

  return router;
}
