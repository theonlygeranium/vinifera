import { Router } from "express";
import { z } from "zod";
import { getConfigurationReport } from "../config";
import {
  data,
  email,
  getClientAddress,
  parseBody,
  password,
  planTier,
  safeRedirectPath,
  type RouteContext,
} from "./shared";

const signupSchema = z.object({
  email,
  fullName: z.string().trim().min(2).max(120),
  organizationName: z.string().trim().min(2).max(120),
  password,
  planTier,
});
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
const emailSchema = z.object({ email });
const passwordSchema = z.object({ password });
const inviteAcceptSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  inviteToken: z.string().uuid().optional(),
  password,
});
const invitationSchema = z.object({
  email,
  role: z.enum(["admin", "manager", "staff"]),
});
const memberMagicLinkSchema = z.object({ brandId: z.uuid().optional(), email });

export default function createAuthRouter(context: RouteContext): Router {
  const router = Router();
  const { createService, options } = context;

  router.post("/api/auth/staff/signup", async (request, response) => {
    const input = parseBody(signupSchema, request);
    const result = await createService(request, response).staffSignup(input);
    data(response, result, 201);
  });

  router.post("/api/auth/staff/login", async (request, response) => {
    const input = parseBody(loginSchema, request);
    data(response, await createService(request, response).staffLogin(input));
  });

  router.post("/api/auth/staff/logout", async (request, response) => {
    await createService(request, response).staffLogout();
    response.status(204).end();
  });

  router.get("/api/auth/staff/session", async (request, response) => {
    if (!getConfigurationReport(options.getEnv()).database.configured) {
      data(response, {
        activated: false,
        authenticated: false,
      });
      return;
    }
    const principal = await createService(request, response).getStaffSession();
    data(response, {
      authenticated: Boolean(principal),
      ...(principal ?? {}),
    });
  });

  router.post("/api/auth/staff/forgot-password", async (request, response) => {
    const input = parseBody(emailSchema, request);
    await createService(request, response).requestStaffPasswordReset(input);
    data(response, {
      message: "If the account exists, a password reset email is on its way.",
    });
  });

  router.post("/api/auth/staff/reset-password", async (request, response) => {
    const input = parseBody(passwordSchema, request);
    await createService(request, response).completeStaffPasswordReset(input);
    data(response, { updated: true });
  });

  router.get("/api/auth/staff/google", async (request, response) => {
    const url = await createService(request, response).getGoogleOAuthUrl();
    response.redirect(303, url);
  });

  router.get("/api/auth/staff/callback", async (request, response) => {
    const code = z.string().min(1).parse(request.query.code);
    const result = await createService(request, response).exchangeAuthCode("staff", code);
    response.redirect(
      303,
      safeRedirectPath(request.query.next, result.destination),
    );
  });

  router.post("/api/auth/staff/accept-invite", async (request, response) => {
    const input = parseBody(inviteAcceptSchema, request);
    data(response, await createService(request, response).acceptStaffInvite(input));
  });

  router.post("/api/staff/invitations", async (request, response) => {
    const input = parseBody(invitationSchema, request);
    data(
      response,
      await createService(request, response).createStaffInvitation(input),
      201,
    );
  });

  router.post("/api/auth/member/magic-link", async (request, response) => {
    const input = parseBody(memberMagicLinkSchema, request);
    await createService(request, response).requestMemberMagicLink({
      ...input,
      ipAddress: getClientAddress(request),
    });
    data(response, {
      message: "If this membership exists, a secure sign-in link is on its way.",
    });
  });

  router.get("/api/auth/member/callback", async (request, response) => {
    const query = z
      .object({
        code: z.string().min(1),
        state: z.string().min(32).max(8_192),
      })
      .parse(request.query);
    const result = await createService(request, response).exchangeAuthCode(
      "member",
      query.code,
      query.state,
    );
    response.redirect(
      303,
      safeRedirectPath(result.destination, "/portal/"),
    );
  });

  router.get("/api/auth/member/session", async (request, response) => {
    if (!getConfigurationReport(options.getEnv()).database.configured) {
      data(response, {
        activated: false,
        authenticated: false,
      });
      return;
    }
    const principal = await createService(request, response).getMemberSession();
    // TODO(BS-03): move logic to service layer
    const publicPrincipal = principal
      ? {
          ...principal,
          user: {
            email: principal.user.email,
            firstName: principal.user.firstName,
            id: principal.user.id,
            lastName: principal.user.lastName,
            status: principal.user.status,
          },
        }
      : null;
    data(response, {
      authenticated: Boolean(principal),
      ...(publicPrincipal ?? {}),
    });
  });

  router.post("/api/auth/member/logout", async (request, response) => {
    await createService(request, response).memberLogout();
    response.status(204).end();
  });

  return router;
}
