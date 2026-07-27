import { Router } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors";
import type { ReleaseInput } from "../types";
import {
  commandId,
  data,
  parseBody,
  uuid,
  type RouteContext,
} from "./shared";

const releaseSchema = z.object({
  description: z.string().trim().max(5_000).nullable().optional(),
  embargoDate: z.iso.date(),
  name: z.string().trim().min(1).max(160),
  processingDate: z.iso.date(),
  status: z.enum(["draft", "scheduled"]).optional(),
  tierIds: z.array(uuid).min(1).optional(),
  tierPrices: z
    .array(z.object({ priceCents: z.number().int().positive(), tierId: uuid }))
    .min(1)
    .optional(),
  tiers: z
    .array(z.object({ priceCents: z.number().int().positive(), tierId: uuid }))
    .min(1)
    .optional(),
  wines: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        priceCents: z.number().int().nonnegative().optional(),
        quantity: z.number().int().min(1).max(120),
        wineName: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .min(1),
});

function asReleaseInput(input: z.infer<typeof releaseSchema>): ReleaseInput {
  const tiers = input.tierPrices ?? input.tiers ?? [];
  const tierIds = input.tierIds ?? tiers.map((tier) => tier.tierId);
  const tierPriceIds = tiers.map((tier) => tier.tierId);
  const tierPriceIdSet = new Set(tierPriceIds);
  if (
    !tiers.length ||
    new Set(tierIds).size !== tierIds.length ||
    tierPriceIdSet.size !== tierPriceIds.length ||
    tierIds.length !== tierPriceIds.length ||
    tierIds.some((tierId) => !tierPriceIdSet.has(tierId))
  ) {
    throw new AppError(
      400,
      "invalid_request",
      "Choose each participating tier once and set its release price.",
    );
  }
  const wines = input.wines.map((wine) => {
    const wineName = wine.wineName ?? wine.name;
    if (!wineName) {
      throw new AppError(400, "invalid_request", "Every wine needs a name.");
    }
    return {
      priceCents: wine.priceCents ?? 0,
      quantity: wine.quantity,
      wineName,
    };
  });
  return {
    description: input.description,
    embargoDate: input.embargoDate,
    name: input.name,
    processingDate: input.processingDate,
    tierIds,
    tierPrices: tiers,
    wines,
  };
}

export default function createReleasesRouter(
  context: RouteContext,
): Router {
  const { coreService } = context;
  const router = Router();

  router.get("/api/releases", async (request, response) => {
    const query = z
      .object({
        from: z.iso.date().optional(),
        status: z.enum(["draft", "scheduled", "processing", "completed"]).optional(),
        to: z.iso.date().optional(),
      })
      .parse(request.query);
    data(response, await coreService(request, response).listReleases(query));
  });

  router.post("/api/releases", async (request, response) => {
    // TODO(BS-03): move logic to service layer
    const raw = parseBody(releaseSchema, request);
    const service = coreService(request, response);
    const release = await service.createRelease(
      asReleaseInput(raw),
      commandId(request),
      raw.status ?? "draft",
    );
    data(response, release, 201);
  });

  router.get("/api/releases/:id", async (request, response) => {
    data(
      response,
      await coreService(request, response).getRelease(
        uuid.parse(request.params.id),
      ),
    );
  });

  router.patch("/api/releases/:id", async (request, response) => {
    // TODO(BS-03): move logic to service layer
    const releaseId = uuid.parse(request.params.id);
    const raw = parseBody(releaseSchema.partial(), request);
    const tiers = raw.tierPrices ?? raw.tiers;
    const tierIds = raw.tierIds ?? tiers?.map((tier) => tier.tierId);
    if (tierIds && new Set(tierIds).size !== tierIds.length) {
      throw new AppError(
        400,
        "invalid_request",
        "Choose each participating tier once and set its release price.",
      );
    }
    if (tiers && tierIds) {
      const tierPriceIds = tiers.map((tier) => tier.tierId);
      const tierPriceIdSet = new Set(tierPriceIds);
      if (
        tierPriceIdSet.size !== tierPriceIds.length ||
        tierIds.length !== tierPriceIds.length ||
        tierIds.some((tierId) => !tierPriceIdSet.has(tierId))
      ) {
        throw new AppError(
          400,
          "invalid_request",
          "Choose each participating tier once and set its release price.",
        );
      }
    }
    const wines = raw.wines?.map((wine) => {
      const wineName = wine.wineName ?? wine.name;
      if (!wineName) {
        throw new AppError(400, "invalid_request", "Every wine needs a name.");
      }
      return {
        priceCents: wine.priceCents ?? 0,
        quantity: wine.quantity,
        wineName,
      };
    });
    const input: Partial<ReleaseInput> = {
      ...("description" in raw ? { description: raw.description } : {}),
      ...("embargoDate" in raw ? { embargoDate: raw.embargoDate } : {}),
      ...("name" in raw ? { name: raw.name } : {}),
      ...("processingDate" in raw
        ? { processingDate: raw.processingDate }
        : {}),
      ...(tiers || tierIds
        ? {
            tierIds,
            tierPrices: tiers,
          }
        : {}),
      ...(wines ? { wines } : {}),
    };
    data(
      response,
      await coreService(request, response).updateRelease(
        releaseId,
        input,
        commandId(request),
      ),
    );
  });

  router.post("/api/releases/:id/schedule", async (request, response) => {
    parseBody(z.object({ confirmed: z.literal(true) }), request);
    data(
      response,
      await coreService(request, response).scheduleRelease(
        uuid.parse(request.params.id),
        commandId(request),
      ),
    );
  });

  router.post("/api/releases/:id/process", async (request, response) => {
    parseBody(z.object({ confirmed: z.literal(true) }), request);
    data(
      response,
      await coreService(request, response).processRelease(
        uuid.parse(request.params.id),
      ),
    );
  });

  router.get("/api/recovery", async (request, response) => {
    data(response, await coreService(request, response).listRecoveryQueue());
  });

  return router;
}
