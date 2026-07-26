import type { Request, Response } from "express";

export type AuthSurface = "staff" | "member";
export type PlanTier = "vine" | "cellar" | "estate" | "reserve";
export type StaffRole =
  | "owner"
  | "admin"
  | "manager"
  | "staff"
  | "super_admin";

export interface WorkerEnv {
  ALLOWED_ORIGINS?: string;
  APP_ENV?: "development" | "test" | "staging" | "production";
  APP_ORIGIN?: string;
  ASSETS?: Fetcher;
  AUTH_EMAIL_ENABLED?: "true" | "false";
  GOOGLE_OAUTH_ENABLED?: "true" | "false";
  RATE_LIMIT_PEPPER?: string;
  STRIPE_PRICE_CELLAR?: string;
  STRIPE_PRICE_ESTATE?: string;
  STRIPE_PRICE_RESERVE?: string;
  STRIPE_PRICE_VINE?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
}

export interface StaffPrincipal {
  access?: {
    graceEndsAt: string | null;
    state: string;
    suspendedAt: string | null;
  };
  organization: {
    accessState: string;
    id: string;
    name: string;
    planTier: PlanTier;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    subscriptionStatus: string;
  } | null;
  user: {
    email: string;
    fullName: string | null;
    id: string;
    role: StaffRole;
  };
}

export interface MemberPrincipal {
  organization: {
    id: string;
    name: string;
  };
  user: {
    email: string;
    firstName: string;
    id: string;
    lastName: string;
    status: string;
  };
}

export interface FoundationService {
  acceptStaffInvite(input: { inviteToken?: string; password: string }): Promise<StaffPrincipal>;
  completeStaffPasswordReset(input: { password: string }): Promise<void>;
  createBillingCheckout(input: { planTier: PlanTier }): Promise<{ url: string }>;
  createBillingPortal(): Promise<{ url: string }>;
  createStaffInvitation(input: {
    email: string;
    role: "admin" | "manager" | "staff";
  }): Promise<{ expiresAt: string }>;
  exchangeAuthCode(
    surface: AuthSurface,
    code: string,
  ): Promise<{ destination: string }>;
  getGoogleOAuthUrl(): Promise<string>;
  getMemberSession(): Promise<MemberPrincipal | null>;
  getStaffSession(): Promise<StaffPrincipal | null>;
  handleStripeWebhook(payload: Buffer, signature: string): Promise<{ duplicate: boolean }>;
  requestMemberMagicLink(input: { email: string; ipAddress: string }): Promise<void>;
  requestStaffPasswordReset(input: { email: string }): Promise<void>;
  staffLogin(input: { email: string; password: string }): Promise<StaffPrincipal>;
  staffLogout(): Promise<void>;
  staffSignup(input: {
    email: string;
    fullName: string;
    organizationName: string;
    password: string;
    planTier: PlanTier;
  }): Promise<{ billingActivationRequired: boolean; principal: StaffPrincipal | null }>;
  memberLogout(): Promise<void>;
}

export type FoundationServiceFactory = (
  request: Request,
  response: Response,
) => FoundationService;

export interface ConfigurationCapability {
  configured: boolean;
  missing: string[];
}

export interface ConfigurationReport {
  app: ConfigurationCapability;
  billing: ConfigurationCapability;
  database: ConfigurationCapability;
  email: ConfigurationCapability;
  googleOAuth: ConfigurationCapability;
  webhook: ConfigurationCapability;
}
