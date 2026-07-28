import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import Stripe from "stripe";
import {
  assertStripeBillingAuthority,
  canProvisionStripeCustomer,
  getConfigurationReport,
  stripeCredentialMode,
  usesSecureCookies,
} from "../config";
import { assertStaffRole } from "../lib/authorization";
import { AppError, requireConfigured } from "../lib/errors";
import {
  createSupabaseAdminClient as createAdminClient,
} from "../lib/supabase-admin";
import { requireSecuritySecrets } from "../lib/security-secrets";
import {
  clearMemberAuthLinkContextCookie,
  clearMemberBrandContextCookie,
  issueMemberAuthLinkContext,
  readMemberAuthLinkContextCookie,
  setMemberBrandContextCookie,
  setMemberAuthLinkContextCookie,
  verifyMemberAuthLinkCallback,
} from "../lib/member-brand-context";
import { ProductionIntegrationService } from "./webhooks";
import {
  executeStripeBillingAttempt,
  isNonterminalSubscriptionStatus,
  provisionStripeCustomer,
  resolveOrganizationStripeCustomerOnSignup,
  stripeClientReferenceId,
  supabaseStripeBillingAttemptStore,
  supabaseStripeCustomerProvisioningStore,
  type StripeSubscriptionStatus,
} from "./stripe-runtime";
import type {
  ApplicationService,
  AuthSurface,
  BillingCustomerState,
  MemberPrincipal,
  PlanTier,
  StaffPrincipal,
  StaffRole,
  WorkerEnv,
} from "../types";

const STRIPE_API_VERSION = "2026-02-25.clover";
const STAFF_COOKIE = "vinifera-staff-auth";
const MEMBER_COOKIE = "vinifera-member-auth";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StaffUserRow {
  email: string;
  id: string;
  organization_id: string;
  role: StaffRole;
}

interface OrganizationRow {
  access_status: string;
  grace_period_ends_at: string | null;
  id: string;
  name: string;
  plan_tier: PlanTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  suspended_at: string | null;
}

interface PlatformUserRow {
  email: string;
  id: string;
  role: "super_admin";
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

function normalizedRequestHost(request: Request): string | null {
  const host = (request.get("host") ?? "")
    .split(":")[0]
    ?.trim()
    .toLowerCase();
  return host && /^[a-z0-9.-]+$/.test(host) ? host : null;
}

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "[::1]"
  );
}

function enforceApplicationOriginPolicy(
  env: Pick<WorkerEnv, "APP_ENV">,
  origin: string,
): string {
  const originUrl = new URL(origin);
  const localMode =
    env.APP_ENV === "development" || env.APP_ENV === "test";
  if (
    originUrl.protocol !== "https:" &&
    (!localMode || !isLoopbackHostname(originUrl.hostname))
  ) {
    throw new AppError(
      500,
      "configuration_error",
      "HTTP application origins are allowed only for loopback development and test.",
    );
  }
  return origin;
}

export function resolveApplicationOrigin(
  env: Pick<WorkerEnv, "APP_ENV" | "APP_ORIGIN">,
  request: Pick<Request, "get" | "protocol">,
): string {
  const configuredOrigin = env.APP_ORIGIN?.trim();
  if (configuredOrigin) {
    const origin = httpOrigin(configuredOrigin);
    if (!origin) {
      throw new AppError(
        500,
        "configuration_error",
        "APP_ORIGIN must be a credential-free HTTP or HTTPS origin.",
      );
    }
    return enforceApplicationOriginPolicy(env, origin);
  }
  if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
    throw new AppError(
      500,
      "configuration_error",
      "APP_ORIGIN is required outside development and test.",
    );
  }

  const requestOrigin = request.get("origin");
  if (requestOrigin) {
    const origin = httpOrigin(requestOrigin);
    if (origin) return enforceApplicationOriginPolicy(env, origin);
  }

  const host = request.get("host");
  if (host) {
    const forwardedProtocol = request
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const origin = httpOrigin(
      `${forwardedProtocol || request.protocol}://${host}`,
    );
    if (origin) return enforceApplicationOriginPolicy(env, origin);
    throw new AppError(
      500,
      "configuration_error",
      "The request origin could not be derived safely.",
    );
  }
  return enforceApplicationOriginPolicy(env, "http://localhost:5173");
}

function getPublicKey(env: WorkerEnv): string {
  return requireConfigured(
    env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY,
    "SUPABASE_PUBLISHABLE_KEY",
  );
}

function appendAuthCookie(
  response: Response,
  env: WorkerEnv,
  name: string,
  value: string,
  options: Record<string, unknown>,
): void {
  response.append(
    "Set-Cookie",
    serializeCookieHeader(name, value, {
      ...options,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: usesSecureCookies(env),
    }),
  );
}

function createSurfaceClient(
  env: WorkerEnv,
  request: Request,
  response: Response,
  surface: AuthSurface,
): SupabaseClient {
  const url = requireConfigured(env.SUPABASE_URL, "SUPABASE_URL");
  const bearer =
    surface === "member"
      ? request.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1]
      : undefined;
  if (bearer) {
    return createClient(url, getPublicKey(env), {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: { Authorization: `Bearer ${bearer}` },
      },
    });
  }
  const cookieName = surface === "staff" ? STAFF_COOKIE : MEMBER_COOKIE;

  return createServerClient(url, getPublicKey(env), {
    auth: {
      flowType: "pkce",
    },
    cookieOptions: {
      name: cookieName,
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: usesSecureCookies(env),
    },
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.cookie ?? "").filter(
          (cookie): cookie is { name: string; value: string } =>
            typeof cookie.value === "string",
        );
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          appendAuthCookie(response, env, cookie.name, cookie.value, cookie.options);
        }
      },
    },
  });
}

function createStripe(env: WorkerEnv): Stripe {
  stripeCredentialMode(env);
  return new Stripe(requireConfigured(env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY"), {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: "Vinifera",
      url: "https://vinifera.edstratumlabs.ai",
      version: "0.1.0",
    },
  });
}

function authFailure(): AppError {
  return new AppError(401, "unauthorized", "The email or sign-in method is invalid.");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

function planPrice(env: WorkerEnv, plan: PlanTier): string {
  const prices: Record<PlanTier, string | undefined> = {
    cellar: env.STRIPE_PRICE_CELLAR,
    estate: env.STRIPE_PRICE_ESTATE,
    reserve: env.STRIPE_PRICE_RESERVE,
    vine: env.STRIPE_PRICE_VINE,
  };
  return requireConfigured(prices[plan], `STRIPE_PRICE_${plan.toUpperCase()}`);
}

function stripeObjectId(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function classifyOrganizationBootstrapRecovery(
  recoveredStaff: unknown,
  recoveryError: unknown,
):
  | { organizationId: string; state: "recovered" }
  | { state: "absent" | "ambiguous" } {
  if (recoveryError) return { state: "ambiguous" };
  if (recoveredStaff === null) return { state: "absent" };
  if (
    recoveredStaff &&
    typeof recoveredStaff === "object" &&
    "organization_id" in recoveredStaff &&
    typeof recoveredStaff.organization_id === "string" &&
    UUID.test(recoveredStaff.organization_id)
  ) {
    return {
      organizationId: recoveredStaff.organization_id,
      state: "recovered",
    };
  }
  return { state: "ambiguous" };
}

export class ProductionFoundationService
  extends ProductionIntegrationService
  implements ApplicationService
{
  constructor(
    env: WorkerEnv,
    request: Request,
    response: Response,
  ) {
    super(env, request, response);
  }

  private surfaceClient(surface: AuthSurface): SupabaseClient {
    return createSurfaceClient(this.env, this.request, this.response, surface);
  }

  private applicationOrigin(): string {
    return resolveApplicationOrigin(this.env, this.request);
  }

  private requireAuthEmail(): void {
    if (this.env.AUTH_EMAIL_ENABLED !== "true") {
      throw new AppError(
        503,
        "activation_required",
        "Supabase Auth email delivery must be verified before this operation can run.",
      );
    }
  }

  async getStaffSession(
    client = this.surfaceClient("staff"),
  ): Promise<StaffPrincipal | null> {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;

    const { data: staffData, error: staffError } = await client
      .from("staff_users")
      .select("id,email,role,organization_id")
      .eq("id", data.user.id)
      .maybeSingle();
    if (staffError) return null;

    if (!staffData) {
      const { data: platformData, error: platformError } = await client
        .from("platform_users")
        .select("id,email,role")
        .eq("id", data.user.id)
        .eq("active", true)
        .maybeSingle();
      if (platformError || !platformData) return null;
      const platformUser = platformData as PlatformUserRow;
      return {
        organization: null,
        user: {
          email: platformUser.email,
          fullName:
            typeof data.user.user_metadata?.full_name === "string"
              ? data.user.user_metadata.full_name
              : null,
          id: platformUser.id,
          role: platformUser.role,
        },
      };
    }

    const staff = staffData as StaffUserRow;
    const { data: organizationData, error: organizationError } = await client
      .from("organizations")
      .select(
        "id,name,plan_tier,stripe_customer_id,stripe_subscription_id,subscription_status,access_status,grace_period_ends_at,suspended_at",
      )
      .eq("id", staff.organization_id)
      .single();
    if (organizationError || !organizationData) return null;

    const organization = organizationData as OrganizationRow;
    return {
      access: {
        graceEndsAt: organization.grace_period_ends_at,
        state: organization.access_status,
        suspendedAt: organization.suspended_at,
      },
      organization: {
        accessState: organization.access_status,
        id: organization.id,
        name: organization.name,
        planTier: organization.plan_tier,
        stripeCustomerId: organization.stripe_customer_id,
        stripeSubscriptionId: organization.stripe_subscription_id,
        subscriptionStatus: organization.subscription_status,
      },
      user: {
        email: staff.email,
        fullName:
          typeof data.user.user_metadata?.full_name === "string"
            ? data.user.user_metadata.full_name
            : null,
        id: staff.id,
        role: staff.role,
      },
    };
  }

  async getMemberSession(): Promise<MemberPrincipal | null> {
    const principal = await this.requireMember().catch(() => null);
    if (!principal) return null;
    await this.recordMemberPortalLogin(principal).catch(() => {
      console.error(
        JSON.stringify({
          event: "member.portal_login_activity_failed",
          memberId: principal.user.id,
          organizationId: principal.organization.id,
        }),
      );
    });
    return principal;
  }

  async staffSignup(input: {
    email: string;
    fullName: string;
    organizationName: string;
    password: string;
    planTier: PlanTier;
  }): Promise<{
    billingActivationRequired: boolean;
    billingCustomerState: BillingCustomerState;
    principal: StaffPrincipal | null;
  }> {
    this.requireAuthEmail();
    const email = normalizeEmail(input.email);
    const staffClient = this.surfaceClient("staff");
    const { data, error } = await staffClient.auth.signUp({
      email,
      password: input.password,
      options: {
        data: {
          auth_surface: "staff",
          full_name: input.fullName,
          organization_name: input.organizationName,
        },
        emailRedirectTo: `${this.applicationOrigin()}/api/auth/staff/callback`,
      },
    });
    if (error || !data.user) {
      throw new AppError(409, "conflict", "An account with this email may already exist.");
    }

    const configuration = getConfigurationReport(this.env);
    let billingActivationRequired =
      !configuration.billing.configured || !configuration.webhook.configured;
    let billingCustomerState: BillingCustomerState = "deferred";
    let organizationId: string | null = null;
    const { data: bootstrapData, error: bootstrapError } = await this.admin.rpc(
      "bootstrap_organization",
      {
        p_organization_name: input.organizationName,
        p_owner_email: email,
        p_owner_user_id: data.user.id,
        p_plan_tier: input.planTier,
        p_stripe_customer_id: null,
      },
    );
    if (!bootstrapError && typeof bootstrapData === "string") {
      organizationId = bootstrapData;
    } else {
      const { data: recoveredStaff, error: recoveryError } = await this.admin
        .from("staff_users")
        .select("organization_id")
        .eq("id", data.user.id)
        .maybeSingle();
      const recovery = classifyOrganizationBootstrapRecovery(
        recoveredStaff,
        recoveryError,
      );
      if (recovery.state === "recovered") {
        organizationId = recovery.organizationId;
      } else if (recovery.state === "absent") {
        const { error: deleteError } =
          await this.admin.auth.admin.deleteUser(data.user.id);
        throw new AppError(
          502,
          "upstream_error",
          deleteError
            ? "The organization could not be created. The account was retained for safe recovery."
            : "The organization could not be created. No account was retained.",
        );
      } else {
        throw new AppError(
          502,
          "upstream_error",
          "Organization creation could not be confirmed. The account was retained for safe recovery.",
        );
      }
    }
    if (!organizationId) {
      throw new AppError(
        502,
        "upstream_error",
        "Organization creation could not be confirmed. The account was retained for safe recovery.",
      );
    }

    const { data: organizationBilling, error: organizationBillingError } =
      await this.admin
        .from("organizations")
        .select("stripe_customer_id")
        .eq("id", organizationId)
        .maybeSingle();
    billingCustomerState = await resolveOrganizationStripeCustomerOnSignup({
      configured: canProvisionStripeCustomer(this.env),
      createCustomer: (params, idempotencyKey) =>
        createStripe(this.env).customers.create(params, { idempotencyKey }),
      currentCustomerId: organizationBilling?.stripe_customer_id,
      organizationId,
      readError: organizationBillingError,
      store: supabaseStripeCustomerProvisioningStore(this.admin),
    });
    if (billingCustomerState !== "ready") {
      billingActivationRequired = true;
    }
    if (billingCustomerState === "reconciliation_required") {
      console.error(
        JSON.stringify({
          event: "billing.organization_customer_reconciliation_required",
          organizationId,
        }),
      );
    }

    let principal: StaffPrincipal | null = null;
    if (data.session) {
      const { error: refreshError } = await staffClient.auth.refreshSession();
      if (!refreshError) {
        principal = await this.getStaffSession(staffClient);
      }
    }

    return {
      billingActivationRequired,
      billingCustomerState,
      principal,
    };
  }

  async staffLogin(input: { email: string; password: string }): Promise<StaffPrincipal> {
    const staffClient = this.surfaceClient("staff");
    const { error } = await staffClient.auth.signInWithPassword({
      email: normalizeEmail(input.email),
      password: input.password,
    });
    if (error) throw authFailure();
    const principal = await this.getStaffSession(staffClient);
    if (!principal) throw authFailure();
    return principal;
  }

  async staffLogout(): Promise<void> {
    await this.surfaceClient("staff").auth.signOut({ scope: "local" });
  }

  async memberLogout(): Promise<void> {
    await this.surfaceClient("member").auth.signOut({ scope: "local" });
    clearMemberBrandContextCookie(this.response, this.env);
  }

  async requestStaffPasswordReset(input: { email: string }): Promise<void> {
    this.requireAuthEmail();
    await this.surfaceClient("staff").auth.resetPasswordForEmail(
      normalizeEmail(input.email),
      {
        redirectTo: `${this.applicationOrigin()}/api/auth/staff/callback?next=/app/reset-password`,
      },
    );
  }

  async completeStaffPasswordReset(input: { password: string }): Promise<void> {
    const { error } = await this.surfaceClient("staff").auth.updateUser({
      password: input.password,
    });
    if (error) {
      throw new AppError(400, "invalid_request", "The password could not be updated.");
    }
  }

  async getGoogleOAuthUrl(): Promise<string> {
    if (this.env.GOOGLE_OAUTH_ENABLED !== "true") {
      throw new AppError(
        503,
        "activation_required",
        "Google sign-in must be connected in Supabase before it can be used.",
      );
    }
    const { data, error } = await this.surfaceClient("staff").auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${this.applicationOrigin()}/api/auth/staff/callback`,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) {
      throw new AppError(
        503,
        "activation_required",
        "Google sign-in must be connected in Supabase before it can be used.",
      );
    }
    return data.url;
  }

  async exchangeAuthCode(
    surface: AuthSurface,
    code: string,
    state?: string,
  ): Promise<{ destination: string }> {
    let memberLinkContext:
      | Awaited<ReturnType<typeof verifyMemberAuthLinkCallback>>
      | null = null;
    if (surface === "member") {
      const cookieState = readMemberAuthLinkContextCookie(this.request);
      clearMemberAuthLinkContextCookie(this.response, this.env);
      memberLinkContext = await verifyMemberAuthLinkCallback(this.env, {
        cookieState,
        requestHost: normalizedRequestHost(this.request),
        state,
      });
      if (!memberLinkContext) {
        throw new AppError(
          401,
          "unauthorized",
          "This sign-in link is invalid or expired.",
        );
      }
    }
    const client = this.surfaceClient(surface);
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      throw new AppError(401, "unauthorized", "This sign-in link is invalid or expired.");
    }
    if (surface === "member") {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user?.email || !memberLinkContext || !state) {
        throw authFailure();
      }
      const normalizedUserEmail = normalizeEmail(userData.user.email);
      if (
        memberLinkContext.emailHash !== await sha256(normalizedUserEmail)
      ) {
        await client.auth.signOut({ scope: "local" });
        throw authFailure();
      }
      const { error: linkError } = await this.admin.rpc("link_member_auth_user", {
        p_brand_id: memberLinkContext.brandId,
        p_context_token_hash: await sha256(state),
        p_email: normalizedUserEmail,
        p_member_id: memberLinkContext.memberId,
        p_organization_id: memberLinkContext.organizationId,
        p_request_host: memberLinkContext.requestHost,
        p_user_id: userData.user.id,
      });
      if (linkError) {
        await client.auth.signOut({ scope: "local" });
        throw new AppError(
          403,
          "forbidden",
          "This sign-in identity cannot be linked to a member profile.",
        );
      }
      await setMemberBrandContextCookie(this.response, this.env, {
        brandId: memberLinkContext.brandId,
        memberId: memberLinkContext.memberId,
        organizationId: memberLinkContext.organizationId,
      });
      const { error: refreshError } = await client.auth.refreshSession();
      if (refreshError) throw authFailure();
    }
    return {
      destination: surface === "staff" ? "/app" : "/portal",
    };
  }

  async createStaffInvitation(input: {
    email: string;
    role: Exclude<StaffRole, "owner">;
  }): Promise<{ expiresAt: string }> {
    this.requireAuthEmail();
    const principal = await this.getStaffSession();
    if (!principal) throw authFailure();
    assertStaffRole(principal, ["owner", "admin"]);
    if (!principal.organization) {
      throw new AppError(403, "forbidden", "Platform operators do not belong to a winery.");
    }

    const email = normalizeEmail(input.email);
    const inviteToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data: invite, error: inviteError } =
      await this.admin.auth.admin.inviteUserByEmail(email, {
        data: {
          auth_surface: "staff",
          invite_token: inviteToken,
          organization_id: principal.organization.id,
          role: input.role,
        },
        redirectTo: `${this.applicationOrigin()}/api/auth/staff/callback?next=/app/invite`,
      });
    if (inviteError || !invite.user) {
      throw new AppError(502, "upstream_error", "The invitation email could not be sent.");
    }

    const { error } = await this.admin.from("organization_invites").insert({
      email,
      expires_at: expiresAt,
      invited_by: principal.user.id,
      organization_id: principal.organization.id,
      role: input.role,
      token_hash: await sha256(inviteToken),
    });
    if (error) {
      await this.admin.auth.admin.deleteUser(invite.user.id).catch(() => undefined);
      throw new AppError(409, "conflict", "An active invitation already exists.");
    }
    return { expiresAt };
  }

  async acceptStaffInvite(input: {
    fullName?: string;
    inviteToken?: string;
    password: string;
  }): Promise<StaffPrincipal> {
    const client = this.surfaceClient("staff");
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user?.email) throw authFailure();
    const { error: passwordError } = await client.auth.updateUser({
      ...(input.fullName
        ? {
            data: {
              full_name: input.fullName,
            },
          }
        : {}),
      password: input.password,
    });
    if (passwordError) {
      throw new AppError(400, "invalid_request", "The password could not be set.");
    }

    const { error } = await this.admin.rpc("complete_staff_invite", {
      p_email: normalizeEmail(userData.user.email),
      p_invite_token: input.inviteToken ?? null,
      p_user_id: userData.user.id,
    });
    if (error) {
      throw new AppError(400, "invalid_request", "This invitation is invalid or expired.");
    }
    const { error: refreshError } = await client.auth.refreshSession();
    if (refreshError) {
      throw new AppError(401, "unauthorized", "The staff session could not be refreshed.");
    }

    const principal = await this.getStaffSession(client);
    if (!principal) throw authFailure();
    return principal;
  }

  async requestMemberMagicLink(input: {
    brandId?: string;
    email: string;
    ipAddress: string;
  }): Promise<void> {
    this.requireAuthEmail();
    const email = normalizeEmail(input.email);
    const { rateLimitPepper } = requireSecuritySecrets(this.env);
    const ipHash = await sha256(`${rateLimitPepper}:${input.ipAddress}`);
    const { data: rateRows, error: rateError } = await this.admin.rpc(
      "record_magic_link_request",
      {
        p_normalized_email: email,
        p_ip_hash: ipHash,
      },
    );
    if (rateError) {
      throw new AppError(503, "configuration_error", "Sign-in requests are unavailable.");
    }
    const rateResult = Array.isArray(rateRows) ? rateRows[0] : rateRows;
    if (!rateResult?.allowed) {
      throw new AppError(
        429,
        "rate_limited",
        `Too many sign-in requests. Try again in ${Math.max(
          1,
          Number(rateResult?.retry_after_seconds ?? 3600),
        )} seconds.`,
      );
    }

    let resolvedBrandId = input.brandId ?? null;
    let verifiedCustomOrigin: string | null = null;
    const requestHost = normalizedRequestHost(this.request);
    if (requestHost) {
      const { data: domainData } = await this.admin.rpc(
        "resolve_custom_domain",
        { p_hostname: requestHost },
      );
      const domain = Array.isArray(domainData) ? domainData[0] : domainData;
      const hostBrandId =
        domain && typeof domain === "object" && "brand_id" in domain
          ? String(domain.brand_id)
          : null;
      if (hostBrandId && resolvedBrandId && hostBrandId !== resolvedBrandId) {
        return;
      }
      if (hostBrandId) {
        resolvedBrandId = hostBrandId;
        verifiedCustomOrigin = `https://${requestHost}`;
      }
    }
    let memberQuery = this.admin
      .from("members")
      .select("id,organization_id,brand_id,auth_user_id")
      .eq("email", email);
    if (resolvedBrandId) {
      memberQuery = memberQuery.eq("brand_id", resolvedBrandId);
    }
    const { data: members } = await memberQuery.limit(2);
    if (members?.length !== 1) return;
    const member = members[0]!;
    const callbackOrigin =
      verifiedCustomOrigin ??
      requireConfigured(this.env.APP_ORIGIN, "APP_ORIGIN");
    const callbackHost = new URL(callbackOrigin).hostname.toLowerCase();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1_000).toISOString();
    const linkState = await issueMemberAuthLinkContext(this.env, {
      brandId: member.brand_id,
      emailHash: await sha256(email),
      memberId: member.id,
      nonce: crypto.randomUUID(),
      organizationId: member.organization_id,
      requestHost: callbackHost,
    });
    const { error: contextError } = await this.admin.rpc(
      "register_member_auth_link_context",
      {
        p_brand_id: member.brand_id,
        p_email_hash: await sha256(email),
        p_expires_at: expiresAt,
        p_member_id: member.id,
        p_organization_id: member.organization_id,
        p_request_host: callbackHost,
        p_token_hash: await sha256(linkState),
      },
    );
    if (contextError) {
      throw new AppError(
        503,
        "configuration_error",
        "Member sign-in is temporarily unavailable.",
      );
    }
    setMemberAuthLinkContextCookie(this.response, this.env, linkState);
    const callback = new URL("/api/auth/member/callback", callbackOrigin);
    callback.searchParams.set("state", linkState);

    await this.surfaceClient("member").auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callback.toString(),
        shouldCreateUser: true,
      },
    });
  }

  async createBillingCheckout(input: {
    attemptId: string;
    planTier: PlanTier;
  }): Promise<{ url: string }> {
    const principal = await this.getStaffSession();
    if (!principal) throw authFailure();
    assertStaffRole(principal, ["owner"]);
    if (!principal.organization) {
      throw new AppError(403, "forbidden", "Platform operators do not have winery billing.");
    }
    assertStripeBillingAuthority(this.env);

    const brandId = await this.activeBrandId(principal, undefined, true);
    const { data: brand, error: brandError } = await this.admin
      .from("brands")
      .select(
        "id,name,billing_mode,stripe_customer_id,stripe_subscription_id,subscription_status",
      )
      .eq("organization_id", principal.organization.id)
      .eq("id", brandId)
      .eq("active", true)
      .maybeSingle();
    if (brandError || !brand) {
      throw new AppError(403, "forbidden", "Brand billing access is unavailable.");
    }
    const independent = brand.billing_mode === "independent";
    const stripe = createStripe(this.env);
    const localSubscriptionId = independent
      ? (brand.stripe_subscription_id as string | null)
      : principal.organization.stripeSubscriptionId;
    const localSubscriptionStatus = independent
      ? String(brand.subscription_status)
      : principal.organization.subscriptionStatus;
    if (localSubscriptionId) {
      let subscription: Stripe.Subscription;
      try {
        subscription = await stripe.subscriptions.retrieve(localSubscriptionId);
      } catch {
        throw new AppError(
          502,
          "upstream_error",
          "The existing subscription could not be reconciled safely.",
        );
      }
      const subscriptionStatus =
        subscription.status as StripeSubscriptionStatus;
      const { error: reconcileError } = await this.admin.rpc(
        "reconcile_stripe_subscription_target",
        {
          p_brand_id: brandId,
          p_organization_id: principal.organization.id,
          p_stripe_subscription_id: subscription.id,
          p_subscription_status: subscriptionStatus,
        },
      );
      if (reconcileError) {
        throw new AppError(
          500,
          "upstream_error",
          "The existing subscription could not be reconciled safely.",
        );
      }
      if (isNonterminalSubscriptionStatus(subscriptionStatus)) {
        throw new AppError(
          409,
          "conflict",
          "An existing subscription must be managed in the billing portal.",
        );
      }
    } else if (isNonterminalSubscriptionStatus(localSubscriptionStatus)) {
      throw new AppError(
        409,
        "conflict",
        "An existing subscription is still reconciling. Retry this request shortly.",
      );
    }

    let customerId = independent
      ? (brand.stripe_customer_id as string | null)
      : principal.organization.stripeCustomerId;
    if (!customerId) {
      const scope = independent ? "brand" : "organization";
      const subjectId = independent ? brandId : principal.organization.id;
      customerId = await provisionStripeCustomer({
        brandId: independent ? brandId : null,
        createCustomer: (params, idempotencyKey) =>
          stripe.customers.create(params, { idempotencyKey }),
        memberId: null,
        organizationId: principal.organization.id,
        scope,
        store: supabaseStripeCustomerProvisioningStore(this.admin),
        subjectId,
      });
    }

    const origin = this.applicationOrigin();
    const requestedPriceId = planPrice(this.env, input.planTier);
    return executeStripeBillingAttempt({
      attemptId: input.attemptId,
      brandId,
      createSession: async ({
        attemptId,
        idempotencyKey,
        planTier,
        providerPayloadKey,
      }) => {
        if (!planTier) {
          throw new AppError(
            500,
            "configuration_error",
            "The checkout plan is unavailable.",
          );
        }
        const session = await stripe.checkout.sessions.create(
          {
            cancel_url: `${origin}/app/billing/cancel`,
            client_reference_id: stripeClientReferenceId({
              brandId,
              organizationId: principal.organization!.id,
            }),
            customer: customerId,
            line_items: [{ price: providerPayloadKey, quantity: 1 }],
            metadata: {
              attempt_id: attemptId,
              brand_id: brandId,
              billing_mode: independent ? "independent" : "shared",
              organization_id: principal.organization!.id,
              plan_tier: planTier,
            },
            mode: "subscription",
            subscription_data: {
              metadata: {
                attempt_id: attemptId,
                brand_id: brandId,
                billing_mode: independent ? "independent" : "shared",
                organization_id: principal.organization!.id,
                plan_tier: planTier,
              },
            },
            success_url: `${origin}/app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          },
          { idempotencyKey },
        );
        return { id: session.id, url: session.url };
      },
      customerId,
      memberId: null,
      operation: "checkout",
      organizationId: principal.organization.id,
      planTier: input.planTier,
      providerPayloadKey: requestedPriceId,
      reconcileOpenCheckout: async (sessionId) => {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.status === "complete") {
          return { status: "complete" as const, url: session.url };
        }
        if (session.status === "expired") {
          return { status: "expired" as const, url: session.url };
        }
        return { status: "open" as const, url: session.url };
      },
      store: supabaseStripeBillingAttemptStore(this.admin),
      subjectId: independent ? brandId : principal.organization.id,
    });
  }

  async createBillingPortal(input: {
    attemptId: string;
  }): Promise<{ url: string }> {
    const principal = await this.getStaffSession();
    if (!principal) throw authFailure();
    assertStaffRole(principal, ["owner"]);
    if (!principal.organization) {
      throw new AppError(403, "forbidden", "Platform operators do not have winery billing.");
    }
    assertStripeBillingAuthority(this.env);
    const brandId = await this.activeBrandId(principal, undefined, true);
    const { data: brand, error: brandError } = await this.admin
      .from("brands")
      .select("billing_mode,stripe_customer_id")
      .eq("organization_id", principal.organization.id)
      .eq("id", brandId)
      .eq("active", true)
      .maybeSingle();
    if (brandError || !brand) {
      throw new AppError(403, "forbidden", "Brand billing access is unavailable.");
    }
    const customerId =
      brand.billing_mode === "independent"
        ? brand.stripe_customer_id
        : principal.organization.stripeCustomerId;
    if (!customerId) {
      throw new AppError(409, "conflict", "Billing has not been activated for this winery.");
    }
    const stripe = createStripe(this.env);
    return executeStripeBillingAttempt({
      attemptId: input.attemptId,
      brandId,
      createSession: async ({ idempotencyKey }) => {
        const session = await stripe.billingPortal.sessions.create(
          {
            customer: customerId,
            return_url: `${this.applicationOrigin()}/app/settings/billing`,
          },
          { idempotencyKey },
        );
        return { id: session.id, url: session.url };
      },
      customerId,
      memberId: null,
      operation: "staff_portal",
      organizationId: principal.organization.id,
      planTier: null,
      providerPayloadKey: "staff_portal:v1",
      reconcileOpenCheckout: async () => ({ status: "expired" as const }),
      store: supabaseStripeBillingAttemptStore(this.admin),
      subjectId:
        brand.billing_mode === "independent"
          ? brandId
          : principal.organization.id,
    });
  }

  async handleStripeWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<{ duplicate: boolean }> {
    const webhookSecret = requireConfigured(
      this.env.STRIPE_WEBHOOK_SECRET,
      "STRIPE_WEBHOOK_SECRET",
    );
    const stripe = createStripe(this.env);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch {
      throw new AppError(400, "invalid_request", "The webhook signature is invalid.");
    }

    const supported = new Set([
      "charge.refunded",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.payment_succeeded",
      "invoice.payment_failed",
      "payment_intent.canceled",
      "payment_intent.payment_failed",
      "payment_intent.succeeded",
    ]);
    if (!supported.has(event.type)) {
      return { duplicate: false };
    }

    if (
      event.type === "payment_intent.succeeded" ||
      event.type === "payment_intent.payment_failed" ||
      event.type === "payment_intent.canceled" ||
      event.type === "charge.refunded"
    ) {
      return this.handleShipmentPaymentWebhook(event);
    }

    const object = event.data.object as Stripe.Subscription | Stripe.Invoice;
    const customerId = stripeObjectId(object.customer);
    let subscriptionId: string | null =
      object.object === "subscription"
        ? object.id
        : stripeObjectId(object.parent?.subscription_details?.subscription ?? null);

    let organizationId: string | null =
      "metadata" in object ? object.metadata?.organization_id ?? null : null;
    let brandId: string | null =
      "metadata" in object ? object.metadata?.brand_id ?? null : null;
    let billingMode: string | null =
      "metadata" in object ? object.metadata?.billing_mode ?? null : null;
    let billingAttemptId: string | null =
      "metadata" in object ? object.metadata?.attempt_id ?? null : null;
    let resolvedSubscription: Stripe.Subscription | null =
      object.object === "subscription" ? object : null;
    if (!resolvedSubscription && subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      resolvedSubscription = subscription;
      organizationId ??= subscription.metadata.organization_id ?? null;
      brandId ??= subscription.metadata.brand_id ?? null;
      billingMode ??= subscription.metadata.billing_mode ?? null;
      billingAttemptId ??= subscription.metadata.attempt_id ?? null;
    }
    if (!organizationId && customerId) {
      const [{ data: brand }, { data: organization }] = await Promise.all([
        this.admin
          .from("brands")
          .select("id,organization_id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle(),
        this.admin
          .from("organizations")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle(),
      ]);
      organizationId =
        (brand as { organization_id?: string } | null)?.organization_id ??
        (organization as { id?: string } | null)?.id ??
        null;
      brandId = (brand as { id?: string } | null)?.id ?? brandId;
      if (brand) billingMode = "independent";
    }
    if (!organizationId) {
      throw new AppError(422, "invalid_request", "Webhook tenant metadata is missing.");
    }

    let subscriptionStatus: string | null = null;
    let planTier: string | null = null;

    if (object.object === "subscription") {
      subscriptionId = object.id;
      subscriptionStatus = object.status;
      planTier = object.metadata.plan_tier ?? null;
    } else if (event.type === "invoice.payment_failed") {
      subscriptionStatus = "past_due";
    } else if (event.type === "invoice.payment_succeeded") {
      subscriptionStatus = "active";
    }

    if (!planTier && resolvedSubscription) {
      planTier = resolvedSubscription.metadata.plan_tier ?? null;
    }
    if (billingMode !== "independent") brandId = null;
    const eventArguments = {
      p_event_created_at: new Date(event.created * 1000).toISOString(),
      p_event_type: event.type,
      p_livemode: event.livemode,
      p_payload: event as unknown as Record<string, unknown>,
      p_plan_tier: planTier,
      p_stripe_customer_id: customerId,
      p_stripe_event_id: event.id,
      p_stripe_subscription_id: subscriptionId,
      p_subscription_status: subscriptionStatus,
    };
    const { data, error } = brandId
      ? await this.admin.rpc("apply_brand_subscription_event", {
          ...eventArguments,
          p_brand_id: brandId,
          p_organization_id: organizationId,
        })
      : await this.admin.rpc("apply_subscription_event", eventArguments);
    if (error) {
      throw new AppError(500, "upstream_error", "The webhook could not be persisted.");
    }
    if (
      billingAttemptId &&
      UUID.test(billingAttemptId) &&
      subscriptionId
    ) {
      const { error: attemptError } = await this.admin.rpc(
        "reconcile_stripe_billing_attempt",
        {
          p_attempt_id: billingAttemptId,
          p_organization_id: organizationId,
          p_stripe_subscription_id: subscriptionId,
        },
      );
      if (attemptError) {
        throw new AppError(
          500,
          "upstream_error",
          "The checkout reconciliation could not be persisted.",
        );
      }
    }
    const result = Array.isArray(data) ? data[0] : data;
    return { duplicate: Boolean(result?.duplicate) };
  }

  private async handleShipmentPaymentWebhook(
    event: Stripe.Event,
  ): Promise<{ duplicate: boolean }> {
    const { data: existingEvent, error: existingEventError } = await this.admin
      .from("billing_attempts")
      .select("id")
      .eq("stripe_event_id", event.id)
      .maybeSingle();
    if (existingEventError) {
      throw new AppError(
        500,
        "upstream_error",
        "The payment event ledger could not be checked.",
      );
    }
    if (existingEvent) return { duplicate: true };

    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const { data: shipment, error: shipmentError } = await this.admin
        .from("shipments")
        .select(
          "id,organization_id,brand_id,charge_amount_cents,refund_amount_cents,stripe_payment_intent_id,stripe_charge_id",
        )
        .eq("stripe_charge_id", charge.id)
        .maybeSingle();
      if (shipmentError) {
        throw new AppError(500, "upstream_error", "The refund event could not be resolved.");
      }
      if (!shipment) return { duplicate: false };
      const refunds = [...(charge.refunds?.data ?? [])].sort(
        (left, right) => right.created - left.created,
      );
      const refundIds = refunds.map((refund) => refund.id);
      const { data: mappedAttempts, error: mappingError } = refundIds.length
        ? await this.admin
            .from("billing_attempts")
            .select(
              "id,amount_cents,stripe_event_id,stripe_refund_id,status",
            )
            .eq("organization_id", shipment.organization_id)
            .eq("brand_id", shipment.brand_id)
            .eq("shipment_id", shipment.id)
            .eq("attempt_kind", "refund")
            .in("stripe_refund_id", refundIds)
        : { data: [], error: null };
      if (mappingError) {
        throw new AppError(
          500,
          "upstream_error",
          "The refund attempt could not be resolved.",
        );
      }
      const attemptsByRefundId = new Map(
        (mappedAttempts ?? []).map((attempt) => [
          String(attempt.stripe_refund_id),
          attempt,
        ]),
      );
      let refund = refunds.find((candidate) => {
        const attempt = attemptsByRefundId.get(candidate.id);
        return !attempt || !attempt.stripe_event_id;
      });
      let billingAttempt = refund
        ? attemptsByRefundId.get(refund.id) ?? null
        : null;
      if (!refund && refundIds.length) {
        return { duplicate: true };
      }
      const metadataAttemptId = refund?.metadata?.billing_attempt_id;
      if (
        !billingAttempt &&
        typeof metadataAttemptId === "string" &&
        UUID.test(metadataAttemptId)
      ) {
        const { data: racedAttempt, error: racedAttemptError } =
          await this.admin
            .from("billing_attempts")
            .select(
              "id,amount_cents,stripe_event_id,stripe_refund_id,status",
            )
            .eq("id", metadataAttemptId)
            .eq("organization_id", shipment.organization_id)
            .eq("brand_id", shipment.brand_id)
            .eq("shipment_id", shipment.id)
            .eq("attempt_kind", "refund")
            .maybeSingle();
        if (racedAttemptError) {
          throw new AppError(
            500,
            "upstream_error",
            "The refund attempt could not be resolved.",
          );
        }
        billingAttempt = racedAttempt;
      }
      const amount = Math.max(
        1,
        refund?.amount ??
          charge.amount_refunded -
            Number(shipment.refund_amount_cents ?? 0),
      );
      if (
        billingAttempt &&
        Number(billingAttempt.amount_cents) !== amount
      ) {
        throw new AppError(
          422,
          "invalid_request",
          "The Stripe refund does not match its billing attempt.",
        );
      }
      let billingAttemptId =
        typeof billingAttempt?.id === "string"
          ? billingAttempt.id
          : null;
      if (!billingAttemptId) {
        const { data: attemptData, error: attemptError } =
          await this.admin.rpc("record_billing_attempt", {
            p_actor_user_id: null,
            p_amount_cents: amount,
            p_attempt_kind: "refund",
            p_brand_id: shipment.brand_id,
            p_idempotency_key:
              `stripe-refund:${refund?.id ?? event.id}`,
            p_metadata: { source: "stripe_webhook" },
            p_organization_id: shipment.organization_id,
            p_shipment_id: shipment.id,
            p_stripe_payment_intent_id:
              shipment.stripe_payment_intent_id,
          });
        if (attemptError) {
          throw new AppError(
            500,
            "upstream_error",
            "The refund attempt could not be recorded.",
          );
        }
        billingAttemptId = Array.isArray(attemptData)
          ? attemptData[0]
          : attemptData;
      }
      if (typeof billingAttemptId !== "string") {
        throw new AppError(
          500,
          "upstream_error",
          "The refund attempt is unavailable.",
        );
      }
      const { error } = await this.admin.rpc("apply_shipment_payment_event", {
        p_billing_attempt_id: billingAttemptId,
        p_brand_id: shipment.brand_id,
        p_decline_code: null,
        p_decline_reason: null,
        p_event_created_at: new Date(event.created * 1_000).toISOString(),
        p_metadata: { source: "stripe_webhook" },
        p_organization_id: shipment.organization_id,
        p_shipment_id: shipment.id,
        p_status: "refunded",
        p_stripe_charge_id: charge.id,
        p_stripe_event_id: event.id,
        p_stripe_refund_id: refund?.id ?? null,
      });
      if (error) {
        throw new AppError(500, "upstream_error", "The refund event could not be applied.");
      }
      return { duplicate: false };
    }

    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const shipmentId = paymentIntent.metadata.shipment_id;
    const organizationId = paymentIntent.metadata.organization_id;
    if (!shipmentId || !organizationId) {
      return { duplicate: false };
    }
    const { data: shipment, error: shipmentError } = await this.admin
      .from("shipments")
      .select("id,organization_id,brand_id,charge_amount_cents,retry_count")
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
      .eq(
        "brand_id",
        paymentIntent.metadata.brand_id ??
          "00000000-0000-0000-0000-000000000000",
      )
      .maybeSingle();
    if (shipmentError || !shipment) {
      throw new AppError(422, "invalid_request", "Shipment webhook metadata is invalid.");
    }
    const { data: existingAttempt } = await this.admin
      .from("billing_attempts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("shipment_id", shipmentId)
      .eq("stripe_payment_intent_id", paymentIntent.id)
      .maybeSingle();
    let billingAttemptId =
      typeof existingAttempt?.id === "string" ? existingAttempt.id : null;
    if (!billingAttemptId) {
      const { data: attemptData, error: attemptError } = await this.admin.rpc(
        "record_billing_attempt",
        {
          p_actor_user_id: null,
          p_amount_cents: paymentIntent.amount,
          p_attempt_kind: shipment.retry_count > 0 ? "retry" : "charge",
          p_brand_id: shipment.brand_id,
          p_idempotency_key: `stripe-pi:${paymentIntent.id}`,
          p_metadata: { source: "stripe_webhook" },
          p_organization_id: organizationId,
          p_shipment_id: shipmentId,
          p_stripe_payment_intent_id: paymentIntent.id,
        },
      );
      if (attemptError) {
        throw new AppError(500, "upstream_error", "The billing attempt could not be recorded.");
      }
      billingAttemptId = Array.isArray(attemptData)
        ? attemptData[0]
        : attemptData;
    }
    if (typeof billingAttemptId !== "string") {
      throw new AppError(500, "upstream_error", "The billing attempt is unavailable.");
    }
    const status =
      event.type === "payment_intent.succeeded"
        ? "succeeded"
        : event.type === "payment_intent.payment_failed"
          ? "declined"
          : "failed";
    const chargeId =
      typeof paymentIntent.latest_charge === "string"
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id ?? null;
    const { error } = await this.admin.rpc("apply_shipment_payment_event", {
      p_billing_attempt_id: billingAttemptId,
      p_brand_id: shipment.brand_id,
      p_decline_code: paymentIntent.last_payment_error?.decline_code ?? null,
      p_decline_reason: paymentIntent.last_payment_error?.message ?? null,
      p_event_created_at: new Date(event.created * 1_000).toISOString(),
      p_metadata: { source: "stripe_webhook" },
      p_organization_id: organizationId,
      p_shipment_id: shipmentId,
      p_status: status,
      p_stripe_charge_id: chargeId,
      p_stripe_event_id: event.id,
      p_stripe_refund_id: null,
    });
    if (error) {
      throw new AppError(500, "upstream_error", "The payment event could not be applied.");
    }
    return { duplicate: false };
  }
}

export function createProductionFoundationService(
  env: WorkerEnv,
  request: Request,
  response: Response,
): ApplicationService {
  return new ProductionFoundationService(env, request, response);
}

export async function reconcileSubscriptionAccess(
  env: WorkerEnv,
  asOf = new Date(),
): Promise<void> {
  const { error } = await createAdminClient(env).rpc("reconcile_subscription_access", {
    p_as_of: asOf.toISOString(),
  });
  if (error) {
    throw new AppError(
      500,
      "upstream_error",
      "Subscription access reconciliation failed.",
    );
  }
}
