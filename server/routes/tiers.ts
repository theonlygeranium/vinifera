import { Router } from "express";
import { z } from "zod";
import type { ClubTierInput } from "../types";
import {
  commandId,
  data,
  parseBody,
  uuid,
  type RouteContext,
} from "./shared";

const clubTierSchema = z.object({
  billingInterval: z.enum(["monthly", "quarterly"]),
  bottleCount: z.number().int().min(1).max(120),
  description: z.string().trim().max(2_000).nullable().optional(),
  frequency: z.enum([
    "monthly",
    "bi_monthly",
    "quarterly",
    "semi_annual",
    "annual",
  ]),
  name: z.string().trim().min(1).max(120),
  priceCents: z.number().int().positive(),
  upgradePathId: uuid.nullable().optional(),
});
const clubTierPatchSchema = clubTierSchema.partial();

export default function createTiersRouter(context: RouteContext): Router {
  const { coreService } = context;
  const router = Router();

  router.get("/api/club-tiers", async (request, response) => {
    data(response, await coreService(request, response).listClubTiers());
  });

  router.post("/api/club-tiers", async (request, response) => {
    const input = parseBody(clubTierSchema, request) as ClubTierInput;
    data(
      response,
      await coreService(request, response).createClubTier(
        input,
        commandId(request),
      ),
      201,
    );
  });

  router.patch("/api/club-tiers/:id", async (request, response) => {
    const tierId = uuid.parse(request.params.id);
    const input = parseBody(clubTierPatchSchema, request);
    data(
      response,
      await coreService(request, response).updateClubTier(
        tierId,
        input,
        commandId(request),
      ),
    );
  });

  router.delete("/api/club-tiers/:id", async (request, response) => {
    const tierId = uuid.parse(request.params.id);
    await coreService(request, response).deleteClubTier(
      tierId,
      commandId(request),
    );
    response.status(204).end();
  });

  router.post("/api/club-tiers/:id/assign", async (request, response) => {
    const tierId = uuid.parse(request.params.id);
    const input = parseBody(
      z.object({ memberIds: z.array(uuid).min(1).max(1_000) }),
      request,
    );
    data(
      response,
      await coreService(request, response).batchMembers({
        ids: input.memberIds,
        operation: "assign_tier",
        tierId,
      }, commandId(request)),
    );
  });

  return router;
}
