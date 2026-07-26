import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import Stripe from "stripe";
import { getConfigurationReport, isProduction } from "../config";
import { assertStaffRole } from "../lib/authorization";
import { AppError, requireConfigured } from "../lib/errors";
import { ProductionCoreClubService } from "./core-club";
import type {
  ApplicationService,
  AuthSurface,
  MemberPrincipal,
  PlanTier,
  StaffPrincipal,
  StaffRole,
  WorkerEnv,
} from "../types";

const STRIPE_API_VERSION = "2026-02-25.clover";
const STAFF_COOKIE = "vinifera-staff-auth";
const MEMBER_COOKIE = "vinifera-member-auth";

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

interface MemberRow {
  email: string;
  first_name: string;
  id: string;
  last_name: string;
  organization_id: string;
  status: string;
}

interface PlatformUserRow {
  email: string;
  id: string;
  role: "super_admin";
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-US");
}

function getPublicKey(env: WorkerEnv): string {
  return requireConfigured(
    env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY,
    "SUPABASE_PUBLISHABLE_KEY",
  );
}

function getSecretKey(env: WorkerEnv): string {
  return requireConfigured(
    env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SECRET_KEY",
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
      secure: isProduction(env),
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
      secure: isProduction(env),
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

function createAdminClient(env: WorkerEnv): SupabaseClient {
  return createClient(requireConfigured(env.SUPABASE_URL, "SUPABASE_URL"), getSecretKey(env), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function createStripe(env: WorkerEnv): Stripe {
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

export class ProductionFoundationService
  extends ProductionCoreClubService
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
    const requestOrigin = this.request.get("origin");
    if (requestOrigin) {
      try {
        return new URL(requestOrigin).origin;
      } catch {
        // The origin middleware rejects malformed values before state changes.
      }
    }

    const host = this.request.get("host");
    if (host) {
      const forwardedProtocol = this.request
        .get("x-forwarded-proto")
        ?.split(",")[0]
        ?.trim();
      return `${forwardedProtocol || this.request.protocol}://${host}`;
    }
    return this.env.APP_ORIGIN ?? "http://localhost:5173";
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

  async getStaffSession(): Promise<StaffPrincipal | null> {
    const client = this.surfaceClient("staff");
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
    const client = this.surfaceClient("member");
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;

    const { data: memberData, error: memberError } = await client
      .from("members")
      .select("id,organization_id,email,first_name,last_name,status")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (memberError || !memberData) return null;

    const member = memberData as MemberRow;
    const { data: organizationData, error: organizationError } = await client
      .from("organizations")
      .select("id,name")
      .eq("id", member.organization_id)
      .single();
    if (organizationError || !organizationData) return null;

    return {
      organization: organizationData as { id: string; name: string },
      user: {
        email: member.email,
        firstName: member.first_name,
        id: member.id,
        lastName: member.last_name,
        status: member.status,
      },
    };
  }

  async staffSignup(input: {
    email: string;
    fullName: string;
    organizationName: string;
    password: string;
    planTier: PlanTier;
  }): Promise<{ billingActivationRequired: boolean; principal: StaffPrincipal | null }> {
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

    let stripeCustomerId: string | null = null;
    try {
      if (this.env.STRIPE_SECRET_KEY) {
        const customer = await createStripe(this.env).customers.create({
          email,
          metadata: {
            plan_tier: input.planTier,
            supabase_user_id: data.user.id,
          },
          name: input.organizationName,
        });
        stripeCustomerId = customer.id;
      }

      const { error: bootstrapError } = await this.admin.rpc("bootstrap_organization", {
        p_organization_name: input.organizationName,
        p_owner_email: email,
        p_owner_user_id: data.user.id,
        p_plan_tier: input.planTier,
        p_stripe_customer_id: stripeCustomerId,
      });
      if (bootstrapError) {
        throw bootstrapError;
      }
      if (data.session) {
        const { error: refreshError } = await staffClient.auth.refreshSession();
        if (refreshError) throw refreshError;
      }
    } catch (error) {
      await this.admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      if (stripeCustomerId) {
        await createStripe(this.env).customers.del(stripeCustomerId).catch(() => undefined);
      }
      throw new AppError(
        502,
        "upstream_error",
        "The organization could not be created. No account was retained.",
      );
    }

    return {
      billingActivationRequired:
        !getConfigurationReport(this.env).billing.configured ||
        !getConfigurationReport(this.env).webhook.configured,
      principal: data.session ? await this.getStaffSession() : null,
    };
  }

  async staffLogin(input: { email: string; password: string }): Promise<StaffPrincipal> {
    const { error } = await this.surfaceClient("staff").auth.signInWithPassword({
      email: normalizeEmail(input.email),
      password: input.password,
    });
    if (error) throw authFailure();
    const principal = await this.getStaffSession();
    if (!principal) throw authFailure();
    return principal;
  }

  async staffLogout(): Promise<void> {
    await this.surfaceClient("staff").auth.signOut({ scope: "local" });
  }

  async memberLogout(): Promise<void> {
    await this.surfaceClient("member").auth.signOut({ scope: "local" });
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
  ): Promise<{ destination: string }> {
    const client = this.surfaceClient(surface);
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      throw new AppError(401, "unauthorized", "This sign-in link is invalid or expired.");
    }
    if (surface === "member") {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user?.email) throw authFailure();
      const { error: linkError } = await this.admin.rpc("link_member_auth_user", {
        p_email: normalizeEmail(userData.user.email),
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
    inviteToken?: string;
    password: string;
  }): Promise<StaffPrincipal> {
    const client = this.surfaceClient("staff");
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user?.email) throw authFailure();
    const { error: passwordError } = await client.auth.updateUser({
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

    const principal = await this.getStaffSession();
    if (!principal) throw authFailure();
    return principal;
  }

  async requestMemberMagicLink(input: {
    email: string;
    ipAddress: string;
  }): Promise<void> {
    this.requireAuthEmail();
    const email = normalizeEmail(input.email);
    const pepper =
      this.env.RATE_LIMIT_PEPPER ??
      this.env.SUPABASE_SECRET_KEY ??
      this.env.SUPABASE_SERVICE_ROLE_KEY;
    const ipHash = await sha256(`${pepper ?? "unconfigured"}:${input.ipAddress}`);
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

    const { data: member } = await this.admin
      .from("members")
      .select("id,auth_user_id")
      .eq("email", email)
      .maybeSingle();
    if (!member) return;

    await this.surfaceClient("member").auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${this.applicationOrigin()}/api/auth/member/callback`,
        shouldCreateUser: true,
      },
    });
  }

  async createBillingCheckout(input: { planTier: PlanTier }): Promise<{ url: string }> {
    const principal = await this.getStaffSession();
    if (!principal) throw authFailure();
    assertStaffRole(principal, ["owner"]);
    if (!principal.organization) {
      throw new AppError(403, "forbidden", "Platform operators do not have winery billing.");
    }

    const stripe = createStripe(this.env);
    let customerId = principal.organization.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: principal.user.email,
        metadata: {
          organization_id: principal.organization.id,
        },
        name: principal.organization.name,
      });
      customerId = customer.id;
      const { error } = await this.admin
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", principal.organization.id);
      if (error) {
        await stripe.customers.del(customerId).catch(() => undefined);
        throw new AppError(502, "upstream_error", "Billing could not be initialized.");
      }
    }

    const origin = this.applicationOrigin();
    const session = await stripe.checkout.sessions.create({
      cancel_url: `${origin}/app/billing/cancel`,
      customer: customerId,
      line_items: [{ price: planPrice(this.env, input.planTier), quantity: 1 }],
      metadata: {
        organization_id: principal.organization.id,
        plan_tier: input.planTier,
      },
      mode: "subscription",
      subscription_data: {
        metadata: {
          organization_id: principal.organization.id,
          plan_tier: input.planTier,
        },
      },
      success_url: `${origin}/app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    });
    if (!session.url) {
      throw new AppError(502, "upstream_error", "Stripe did not return a checkout URL.");
    }
    return { url: session.url };
  }

  async createBillingPortal(): Promise<{ url: string }> {
    const principal = await this.getStaffSession();
    if (!principal) throw authFailure();
    assertStaffRole(principal, ["owner"]);
    if (!principal.organization) {
      throw new AppError(403, "forbidden", "Platform operators do not have winery billing.");
    }
    if (!principal.organization.stripeCustomerId) {
      throw new AppError(409, "conflict", "Billing has not been activated for this winery.");
    }
    const session = await createStripe(this.env).billingPortal.sessions.create({
      customer: principal.organization.stripeCustomerId,
      return_url: `${this.applicationOrigin()}/app/settings/billing`,
    });
    return { url: session.url };
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
    if (!organizationId && subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      organizationId = subscription.metadata.organization_id ?? null;
    }
    if (!organizationId && customerId) {
      const { data } = await this.admin
        .from("organizations")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      organizationId = (data as { id?: string } | null)?.id ?? null;
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

    const { data, error } = await this.admin.rpc("apply_subscription_event", {
      p_event_created_at: new Date(event.created * 1000).toISOString(),
      p_event_type: event.type,
      p_livemode: event.livemode,
      p_payload: event as unknown as Record<string, unknown>,
      p_plan_tier: planTier,
      p_stripe_customer_id: customerId,
      p_stripe_event_id: event.id,
      p_stripe_subscription_id: subscriptionId,
      p_subscription_status: subscriptionStatus,
    });
    if (error) {
      throw new AppError(500, "upstream_error", "The webhook could not be persisted.");
    }
    const result = Array.isArray(data) ? data[0] : data;
    return { duplicate: Boolean(result?.duplicate) };
  }

  private async handleShipmentPaymentWebhook(
    event: Stripe.Event,
  ): Promise<{ duplicate: boolean }> {
    const { data: existingEvent } = await this.admin
      .from("billing_attempts")
      .select("id")
      .eq("stripe_event_id", event.id)
      .maybeSingle();
    if (existingEvent) return { duplicate: true };

    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const { data: shipment, error: shipmentError } = await this.admin
        .from("shipments")
        .select(
          "id,organization_id,charge_amount_cents,stripe_payment_intent_id,stripe_charge_id",
        )
        .eq("stripe_charge_id", charge.id)
        .maybeSingle();
      if (shipmentError) {
        throw new AppError(500, "upstream_error", "The refund event could not be resolved.");
      }
      if (!shipment) return { duplicate: false };
      const refund = charge.refunds?.data.at(-1);
      const amount = Math.max(1, refund?.amount ?? charge.amount_refunded);
      const { data: attemptData, error: attemptError } = await this.admin.rpc(
        "record_billing_attempt",
        {
          p_actor_user_id: null,
          p_amount_cents: amount,
          p_attempt_kind: "refund",
          p_idempotency_key: `stripe-refund:${refund?.id ?? event.id}`,
          p_metadata: { source: "stripe_webhook" },
          p_organization_id: shipment.organization_id,
          p_shipment_id: shipment.id,
          p_stripe_payment_intent_id: shipment.stripe_payment_intent_id,
        },
      );
      if (attemptError) {
        throw new AppError(500, "upstream_error", "The refund attempt could not be recorded.");
      }
      const billingAttemptId = Array.isArray(attemptData)
        ? attemptData[0]
        : attemptData;
      const { error } = await this.admin.rpc("apply_shipment_payment_event", {
        p_billing_attempt_id: billingAttemptId,
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
      .select("id,organization_id,charge_amount_cents,retry_count")
      .eq("id", shipmentId)
      .eq("organization_id", organizationId)
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
          p_amount_cents: shipment.charge_amount_cents,
          p_attempt_kind: shipment.retry_count > 0 ? "retry" : "charge",
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
