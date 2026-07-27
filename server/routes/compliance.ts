import { Router } from "express";
import { z } from "zod";
import { data, uuid, type RouteContext } from "./shared";

export default function createComplianceRouter(
  context: RouteContext,
): Router {
  const { analyticsService } = context;
  const router = Router();

  router.get("/api/compliance/dashboard", async (request, response) => {
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

  router.get("/api/compliance/checks/:id", async (request, response) => {
    data(
      response,
      await analyticsService(request, response).getComplianceCheck(
        uuid.parse(request.params.id),
      ),
    );
  });

  router.post(
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

  router.post(
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

  return router;
}
