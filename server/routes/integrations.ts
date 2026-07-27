import { Router } from "express";
import { z } from "zod";
import {
  data,
  email,
  parseBody,
  uuid,
  type RouteContext,
} from "./shared";

const integrationType = z.enum([
  "klaviyo",
  "quickbooks",
  "avalara",
  "meta",
]);
const safeObject = z.record(z.string(), z.unknown());
const integrationConnectSchema = z.object({
  brandId: uuid.nullable().optional(),
  consentConfirmed: z.boolean(),
  credentials: safeObject.optional(),
  optedIn: z.boolean(),
  syncConfig: safeObject.optional(),
});
const integrationUpdateSchema = z
  .object({
    consentConfirmed: z.boolean().optional(),
    credentials: safeObject.optional(),
    optedIn: z.boolean().optional(),
    syncConfig: safeObject.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Choose at least one integration field to update.",
  });
const brandSchema = z.object({
  billingMode: z.enum(["shared", "independent"]).default("shared"),
  defaultShippingChargeCents: z.number().int().min(0).max(100_000).optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
const brandPatchSchema = z
  .object({
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    billingMode: z.enum(["shared", "independent"]).optional(),
    defaultShippingChargeCents: z.number().int().min(0).max(100_000).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    emailSenderAddress: email.nullable().optional(),
    emailSenderName: z.string().trim().min(1).max(200).optional(),
    fontFamily: z.string().trim().min(1).max(100).optional(),
    logoUrl: z.url().startsWith("https://").nullable().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    portalTitle: z.string().trim().min(1).max(200).optional(),
    secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Choose at least one brand field to update.",
  });

export function createIntegrationCallbackRouter(
  context: RouteContext,
): Router {
  const { integrationService } = context;
  const router = Router();

  router.get("/api/integrations/quickbooks/callback", async (request, response) => {
    const query = z
      .object({
        code: z.string().min(1).max(4_096),
        realmId: z.string().min(1).max(255),
        state: z.string().min(32).max(8_192),
      })
      .parse(request.query);
    const result = await integrationService(
      request,
      response,
    ).completeQuickBooksOAuth(query);
    response.redirect(303, result.redirectPath);
  });

  return router;
}

export default function createIntegrationsRouter(
  context: RouteContext,
): Router {
  const { integrationService } = context;
  const router = Router();

  router.get("/api/integrations", async (request, response) => {
    data(response, await integrationService(request, response).listIntegrations());
  });

  router.post("/api/integrations/:type/connect", async (request, response) => {
    const type = integrationType.parse(request.params.type);
    data(
      response,
      await integrationService(request, response).connectIntegration(
        type,
        parseBody(integrationConnectSchema, request),
      ),
      201,
    );
  });

  router.patch("/api/integrations/:type", async (request, response) => {
    const type = integrationType.parse(request.params.type);
    data(
      response,
      await integrationService(request, response).updateIntegration(
        type,
        parseBody(integrationUpdateSchema, request),
      ),
    );
  });

  router.delete("/api/integrations/:type", async (request, response) => {
    await integrationService(request, response).disconnectIntegration(
      integrationType.parse(request.params.type),
    );
    response.status(204).end();
  });

  router.post("/api/integrations/:type/sync", async (request, response) => {
    data(
      response,
      await integrationService(request, response).queueIntegrationSync(
        integrationType.parse(request.params.type),
      ),
      202,
    );
  });

  router.get("/api/integrations/:type/logs", async (request, response) => {
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(25) })
      .parse(request.query);
    data(
      response,
      await integrationService(request, response).listIntegrationLogs(
        integrationType.parse(request.params.type),
        query.limit,
      ),
    );
  });

  router.get("/api/integrations/quickbooks/authorize", async (request, response) => {
    const brandId = request.query.brandId
      ? uuid.parse(request.query.brandId)
      : undefined;
    data(
      response,
      await integrationService(
        request,
        response,
      ).getQuickBooksAuthorizationUrl(brandId),
    );
  });

  router.get(
    "/api/integrations/quickbooks/reconciliation",
    async (request, response) => {
      data(
        response,
        await integrationService(
          request,
          response,
        ).getQuickBooksReconciliation(),
      );
    },
  );

  router.get("/api/integrations/avalara/liability", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getAvalaraLiability(),
    );
  });

  router.get("/api/integrations/avalara/filing", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getAvalaraFilingStatus(),
    );
  });

  router.post(
    "/api/integrations/avalara/filing/verify",
    async (request, response) => {
      data(
        response,
        await integrationService(
          request,
          response,
        ).queueAvalaraFilingVerification(),
        202,
      );
    },
  );

  router.get(
    "/api/integrations/meta/attribution",
    async (request, response) => {
      const query = z
        .object({
          from: z.iso.datetime().optional(),
          to: z.iso.datetime().optional(),
        })
        .parse(request.query);
      data(
        response,
        await integrationService(
          request,
          response,
        ).getMetaAttributionReport(query),
      );
    },
  );

  router.get("/api/brands", async (request, response) => {
    data(response, await integrationService(request, response).listBrands());
  });

  router.post("/api/brands", async (request, response) => {
    data(
      response,
      await integrationService(request, response).createBrand(
        parseBody(brandSchema, request),
      ),
      201,
    );
  });

  router.patch("/api/brands/:id", async (request, response) => {
    data(
      response,
      await integrationService(request, response).updateBrand(
        uuid.parse(request.params.id),
        parseBody(brandPatchSchema, request),
      ),
    );
  });

  router.post("/api/brands/:id/sender/verify", async (request, response) => {
    data(
      response,
      await integrationService(request, response).activateBrandSender(
        uuid.parse(request.params.id),
      ),
      202,
    );
  });

  router.get("/api/organization/overview", async (request, response) => {
    const query = z
      .object({ brandId: z.union([uuid, z.literal("all")]).optional() })
      .parse(request.query);
    data(
      response,
      await integrationService(request, response).getBrandOverview(
        query.brandId,
      ),
    );
  });

  router.put("/api/brands/:id/domain", async (request, response) => {
    const input = parseBody(
      z.object({
        hostname: z.string().trim().min(4).max(253),
      }),
      request,
    );
    data(
      response,
      await integrationService(request, response).updateBrandDomain(
        uuid.parse(request.params.id),
        input.hostname,
      ),
      201,
    );
  });

  router.get("/api/brands/:id/domain", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getBrandDomain(
        uuid.parse(request.params.id),
      ),
    );
  });

  router.delete("/api/brands/:id/domain", async (request, response) => {
    await integrationService(request, response).deleteBrandDomain(
      uuid.parse(request.params.id),
    );
    response.status(204).end();
  });

  return router;
}
