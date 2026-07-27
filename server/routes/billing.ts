import { Router } from "express";
import { z } from "zod";
import type { PlanTier } from "../types";
import {
  billingPortalSchema,
  data,
  parseBody,
  planTier,
  type RouteContext,
} from "./shared";

const billingSchema = z.object({ attemptId: z.uuid(), planTier });

export default function createBillingRouter(context: RouteContext): Router {
  const router = Router();
  const { createService } = context;

  router.post("/api/billing/checkout", async (request, response) => {
    const input = parseBody(billingSchema, request) as {
      attemptId: string;
      planTier: PlanTier;
    };
    data(response, await createService(request, response).createBillingCheckout(input));
  });

  router.post("/api/billing/portal", async (request, response) => {
    const input = parseBody(billingPortalSchema, request) as {
      attemptId: string;
    };
    data(response, await createService(request, response).createBillingPortal(input));
  });

  return router;
}
