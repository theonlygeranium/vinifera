import { Router } from "express";
import { z } from "zod";
import type { PostalAddress } from "../types";
import {
  addressSchema,
  billingPortalSchema,
  commandId,
  data,
  parseBody,
  shipmentStatus,
  uuid,
  type RouteContext,
} from "./shared";

export default function createFulfillmentRouter(
  context: RouteContext,
): Router {
  const { coreService } = context;
  const router = Router();

  router.get("/api/shipments", async (request, response) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        query: z.string().trim().max(120).optional(),
        releaseId: uuid.optional(),
        search: z.string().trim().max(120).optional(),
        status: shipmentStatus.optional(),
      })
      .parse(request.query);
    data(
      response,
      await coreService(request, response).listShipments({
        ...query,
        search: query.search ?? query.query,
      }),
    );
  });

  router.post("/api/shipments/labels", async (request, response) => {
    const input = parseBody(
      z.object({ shipmentIds: z.array(uuid).min(1).max(100) }),
      request,
    );
    const result = await coreService(request, response).generateShipmentLabels(
      input.shipmentIds,
    );
    data(response, { ...result, labelCount: result.generated });
  });

  router.post("/api/shipping/validate-address", async (request, response) => {
    const address = parseBody(addressSchema, request) as PostalAddress;
    data(
      response,
      await coreService(request, response).validateShippingAddress(address),
    );
  });

  router.get("/api/shipments/pick-list", async (request, response) => {
    const releaseId = uuid.parse(request.query.releaseId);
    const result = await coreService(request, response).getPickList(releaseId);
    data(response, result);
  });

  router.post("/api/shipments/:id/pack", async (request, response) => {
    const input = parseBody(
      z.object({ barcode: z.string().trim().min(1).max(120) }),
      request,
    );
    data(
      response,
      await coreService(request, response).confirmShipmentPack(
        uuid.parse(request.params.id),
        input,
      ),
    );
  });

  router.post("/api/shipments/:id/retry", async (request, response) => {
    data(
      response,
      await coreService(request, response).retryShipment(
        uuid.parse(request.params.id),
      ),
    );
  });

  router.post("/api/shipments/:id/refund", async (request, response) => {
    const input = parseBody(
      z.object({
        amountCents: z.number().int().positive().optional(),
        reason: z.string().trim().max(500).optional(),
      }),
      request,
    );
    data(
      response,
      await coreService(request, response).refundShipment(
        uuid.parse(request.params.id),
        input,
        commandId(request),
      ),
    );
  });

  router.patch("/api/shipments/:id/status", async (request, response) => {
    const input = parseBody(
      z.object({
        carrier: z.string().trim().max(80).optional(),
        status: z.enum(["shipped", "delivered", "cancelled"]),
        trackingNumber: z.string().trim().max(160).optional(),
      }),
      request,
    );
    data(
      response,
      await coreService(request, response).transitionShipment(
        uuid.parse(request.params.id),
        input,
      ),
    );
  });

  router.get("/api/member/shipments", async (request, response) => {
    data(
      response,
      await coreService(request, response).getMemberPortalHistory(),
    );
  });

  router.patch("/api/member/profile/address", async (request, response) => {
    const address = parseBody(addressSchema, request) as PostalAddress;
    data(
      response,
      await coreService(request, response).updateMemberPortalAddress(
        address,
        commandId(request),
      ),
    );
  });

  router.post("/api/member/billing/portal", async (request, response) => {
    const input = parseBody(billingPortalSchema, request) as {
      attemptId: string;
    };
    data(
      response,
      await coreService(request, response).createMemberPaymentMethodPortal(input),
    );
  });

  return router;
}
