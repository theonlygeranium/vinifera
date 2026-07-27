import { Router } from "express";
import { z } from "zod";
import { getClientAddress } from "../lib/client-address";
import {
  data,
  email,
  mobileAuthRedirectUri,
  parseBody,
  uuid,
  type RouteContext,
} from "./shared";

export function createMobileCallbackRouter(
  context: RouteContext,
): Router {
  const router = Router();
  const { integrationService } = context;

  router.get("/api/auth/member/mobile/callback", async (request, response) => {
    const query = z
      .object({
        state: z.string().min(32).max(8_192),
        token_hash: z.string().min(20).max(512),
        type: z.literal("email"),
      })
      .parse(request.query);
    const result = await integrationService(
      request,
      response,
    ).completeMobileMagicLink({
      state: query.state,
      tokenHash: query.token_hash,
      type: query.type,
    });
    response.redirect(303, result.redirectUrl);
  });

  return router;
}

export default function createMobileRouter(context: RouteContext): Router {
  const router = Router();
  const { integrationService, options } = context;

  router.get("/api/mobile/app-policy", async (request, response) => {
    const query = z
      .object({
        platform: z.enum(["ios", "android"]),
        version: z.string().trim().min(3).max(50),
      })
      .parse(request.query);
    data(
      response,
      await integrationService(request, response).getMobileAppPolicy(query),
    );
  });

  router.post("/api/auth/member/mobile/magic-link", async (request, response) => {
    const input = parseBody(
      z.object({
        clubCode: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .optional(),
        deviceFingerprint: z.string().trim().min(16).max(255),
        email,
        redirectUri: z.literal(mobileAuthRedirectUri),
      }),
      request,
    );
    await integrationService(request, response).requestMobileMagicLink({
      ...input,
      ipAddress: getClientAddress(request, options.getEnv()),
    });
    data(response, {
      message: "If this membership exists, a secure sign-in link is on its way.",
    });
  });

  router.post("/api/auth/member/mobile/exchange", async (request, response) => {
    const input = parseBody(
      z.object({
        appVersion: z.string().trim().min(3).max(50),
        code: z.string().min(32).max(512),
        deviceFingerprint: z.string().trim().min(16).max(255),
        platform: z.enum(["ios", "android"]),
        redirectUri: z.literal(mobileAuthRedirectUri),
      }),
      request,
    );
    data(
      response,
      await integrationService(request, response).exchangeMobileSession(input),
    );
  });

  router.post("/api/auth/member/mobile/refresh", async (request, response) => {
    const input = parseBody(
      z.object({ refreshToken: z.string().min(32).max(512) }),
      request,
    );
    data(
      response,
      await integrationService(request, response).refreshMobileSession(input),
    );
  });

  router.post("/api/auth/member/mobile/logout", async (request, response) => {
    const input = parseBody(
      z.object({ refreshToken: z.string().min(32).max(512) }),
      request,
    );
    await integrationService(request, response).logoutMobileSession(input);
    response.status(204).end();
  });

  router.get("/api/mobile/bootstrap", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getMobileBootstrap(),
    );
  });

  router.post("/api/mobile/devices", async (request, response) => {
    const input = parseBody(
      z.object({
        appVersion: z.string().trim().min(3).max(50),
        brandId: uuid.nullable().optional(),
        deviceFingerprint: z.string().trim().min(16).max(255),
        permission: z.enum(["denied", "granted", "prompt"]),
        platform: z.enum(["ios", "android"]),
        token: z.string().min(16).max(4_096),
      }),
      request,
    );
    data(
      response,
      await integrationService(request, response).registerMobileDevice(input),
      201,
    );
  });

  router.delete("/api/mobile/devices", async (request, response) => {
    const input = parseBody(
      z.object({ deviceFingerprint: z.string().trim().min(16).max(255) }),
      request,
    );
    await integrationService(request, response).unregisterMobileDevice(
      input.deviceFingerprint,
    );
    response.status(204).end();
  });

  router.put("/api/member/privacy/meta", async (request, response) => {
    const input = parseBody(
      z
        .object({
          attribution: z
            .object({
              campaignId: z.string().trim().max(120).nullable().optional(),
              campaignName: z.string().trim().max(200).nullable().optional(),
              eventSourceUrl: z.url().max(2_048),
              fbc: z.string().trim().max(255).nullable().optional(),
              fbp: z.string().trim().max(255).nullable().optional(),
              medium: z.string().trim().max(120).nullable().optional(),
              occurredAt: z.iso.datetime(),
              source: z.string().trim().max(120).nullable().optional(),
            })
            .optional(),
          clientEventId: uuid.optional(),
          consentSource: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .default("member_portal"),
          consented: z.boolean(),
          policyVersion: z.string().trim().min(1).max(80),
        })
        .superRefine((value, context) => {
          if (value.attribution && !value.clientEventId) {
            context.addIssue({
              code: "custom",
              message: "clientEventId is required with attribution.",
              path: ["clientEventId"],
            });
          }
          if (!value.consented && value.attribution) {
            context.addIssue({
              code: "custom",
              message: "Attribution requires Meta consent.",
              path: ["attribution"],
            });
          }
        }),
      request,
    );
    data(
      response,
      await integrationService(request, response).updateMemberMetaPrivacy(
        input,
      ),
    );
  });

  router.get("/api/member/privacy/meta", async (request, response) => {
    data(
      response,
      await integrationService(request, response).getMemberMetaPrivacy(),
    );
  });

  return router;
}
