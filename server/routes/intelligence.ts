import { Router } from "express";
import { z } from "zod";
import { data, parseBody, uuid, type RouteContext } from "./shared";

export default function createIntelligenceRouter(
  context: RouteContext,
): Router {
  const { analyticsService } = context;
  const router = Router();

  router.get("/api/ml/operations", async (request, response) => {
    data(
      response,
      await analyticsService(request, response).getMlOperations(),
    );
  });

  router.get("/api/churn-intelligence", async (request, response) => {
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

  router.patch(
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

  router.get(
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

  router.get("/api/benchmarks", async (request, response) => {
    data(
      response,
      await analyticsService(request, response).getBenchmarkComparison(),
    );
  });

  router.patch("/api/benchmarks/preferences", async (request, response) => {
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

  return router;
}
