import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors";
import {
  data,
  email,
  parseBody,
  uuid,
  type RouteContext,
} from "./shared";

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

export default function createAnalyticsRouter(
  context: RouteContext,
): Router {
  const { analyticsService } = context;
  const router = Router();

  router.get("/api/analytics/dashboard", async (request, response) => {
    const query = analyticsRangeQuerySchema.parse(request.query);
    data(
      response,
      await analyticsService(request, response).getAnalyticsDashboard(query),
    );
  });

  router.get("/api/analytics/export", async (request, response) => {
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

  router.get("/api/analytics/layout", async (request, response) => {
    data(
      response,
      await analyticsService(request, response).getAnalyticsLayout(),
    );
  });

  router.patch("/api/analytics/layout", async (request, response) => {
    const input = parseBody(analyticsLayoutSchema, request);
    data(
      response,
      await analyticsService(request, response).saveAnalyticsLayout(input),
    );
  });

  router.get("/api/analytics/reports", async (request, response) => {
    data(
      response,
      await analyticsService(
        request,
        response,
      ).listScheduledAnalyticsReports(),
    );
  });

  router.post("/api/analytics/reports", async (request, response) => {
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

  router.patch("/api/analytics/reports/:id", async (request, response) => {
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

  router.post("/api/analytics/events", async (request, response) => {
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

  return router;
}
