import type { Request, Response } from "express";

export type AuthSurface = "staff" | "member";
export type PlanTier = "vine" | "cellar" | "estate" | "reserve";
export type ClubFrequency =
  | "monthly"
  | "bi_monthly"
  | "quarterly"
  | "semi_annual"
  | "annual";
export type MemberStatus = "active" | "paused" | "cancelled";
export type ReleaseStatus = "draft" | "scheduled" | "processing" | "completed";
export type ShipmentStatus =
  | "pending"
  | "charged"
  | "declined"
  | "label_created"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";
export type StaffRole =
  | "owner"
  | "admin"
  | "manager"
  | "staff"
  | "super_admin";
export type EmailTriggerType =
  | "welcome"
  | "pre_shipment"
  | "payment_decline"
  | "shipped"
  | "birthday"
  | "re_engagement";
export type CancelFlowOutcome =
  | "continued"
  | "paused"
  | "downgraded"
  | "swapped"
  | "cancelled";

export interface WorkerEnv {
  ALLOWED_ORIGINS?: string;
  APP_ENV?: "development" | "test" | "staging" | "production";
  APP_ORIGIN?: string;
  ASSETS?: Fetcher;
  AUTH_EMAIL_ENABLED?: "true" | "false";
  GOOGLE_OAUTH_ENABLED?: "true" | "false";
  RATE_LIMIT_PEPPER?: string;
  EASYPOST_API_KEY?: string;
  EMAIL_PROVIDER?: "resend" | "simulated";
  EMAIL_SIMULATOR_ENABLED?: "true" | "false";
  RESEND_API_KEY?: string;
  RESEND_DOMAIN_VERIFIED?: "true" | "false";
  RESEND_FROM?: string;
  RESEND_SENDING_DOMAIN?: string;
  RESEND_WEBHOOK_SECRET?: string;
  SHIPPING_ALLOWED_STATES?: string;
  SHIPPING_PROVIDER?: "easypost" | "simulated";
  SHIPPING_SIMULATOR_ENABLED?: "true" | "false";
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
  UNSUBSCRIBE_SIGNING_SECRET?: string;
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
    authUserId: string;
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

export interface PostalAddress {
  city: string;
  country: string;
  line1: string;
  line2?: string | null;
  postalCode: string;
  state: string;
}

export interface ClubTierInput {
  billingInterval: "monthly" | "quarterly";
  bottleCount: number;
  description?: string | null;
  frequency: ClubFrequency;
  name: string;
  priceCents: number;
  upgradePathId?: string | null;
}

export interface MemberInput {
  birthday?: string | null;
  clubTierId?: string | null;
  email: string;
  firstName: string;
  joinDate?: string;
  lastName: string;
  phone?: string | null;
  referredByMemberId?: string | null;
  shippingAddress?: PostalAddress | null;
  status?: MemberStatus;
}

export interface ReleaseWineInput {
  priceCents: number;
  quantity: number;
  wineName: string;
}

export interface ReleaseInput {
  description?: string | null;
  embargoDate: string;
  name: string;
  processingDate: string;
  tierIds: string[];
  tierPrices: Array<{ priceCents: number; tierId: string }>;
  wines: ReleaseWineInput[];
}

export interface CsvMapping {
  city?: string;
  clubTier?: string;
  country?: string;
  email: string;
  firstName: string;
  joinDate?: string;
  lastName: string;
  line1?: string;
  line2?: string;
  phone?: string;
  postalCode?: string;
  state?: string;
  status?: string;
}

export interface CsvPreviewInput {
  contents: string;
  contentType?: "text/csv" | "application/csv" | "application/vnd.ms-excel";
  filename?: string;
  format: "commerce7" | "winedirect" | "generic";
  mapping?: CsvMapping;
}

export interface CoreClubService {
  batchMembers(input: {
    ids?: string[];
    operation: "pause" | "resume" | "cancel" | "assign_tier";
    tierId?: string;
  }): Promise<{ updated: number }>;
  confirmShipmentPack(
    shipmentId: string,
    input: { barcode: string },
  ): Promise<{ complete: boolean; packedItems: number; status: ShipmentStatus }>;
  createClubTier(input: ClubTierInput): Promise<Record<string, unknown>>;
  createMember(input: MemberInput): Promise<Record<string, unknown>>;
  deleteMember(memberId: string): Promise<void>;
  createMemberPaymentMethodPortal(): Promise<{ url: string }>;
  createRelease(input: ReleaseInput): Promise<Record<string, unknown>>;
  deleteClubTier(tierId: string): Promise<void>;
  exportMembers(input: {
    search?: string;
    status?: MemberStatus;
    tierId?: string;
  }): Promise<{ contents: string; filename: string }>;
  generateShipmentLabels(shipmentIds: string[]): Promise<{
    failed: number;
    generated: number;
    results: Array<Record<string, unknown>>;
  }>;
  getMember(memberId: string): Promise<Record<string, unknown>>;
  getMemberPortalHistory(): Promise<Array<Record<string, unknown>>>;
  getPickList(releaseId: string): Promise<Record<string, unknown>>;
  getRelease(releaseId: string): Promise<Record<string, unknown>>;
  importMembers(input: {
    mapping?: Record<string, string>;
    uploadToken: string;
  }): Promise<{
    errors: Array<{ message: string; row: number }>;
    importedCount: number;
    skippedCount: number;
  }>;
  listClubTiers(): Promise<Array<Record<string, unknown>>>;
  listMembers(input: {
    limit: number;
    offset: number;
    search?: string;
    status?: MemberStatus;
    tierId?: string;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }>;
  listRecoveryQueue(): Promise<Array<Record<string, unknown>>>;
  listShipments(input: {
    limit: number;
    offset: number;
    releaseId?: string;
    search?: string;
    status?: ShipmentStatus;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }>;
  listReleases(input: {
    from?: string;
    status?: ReleaseStatus;
    to?: string;
  }): Promise<Array<Record<string, unknown>>>;
  previewMemberImport(input: CsvPreviewInput): Promise<{
    columns: string[];
    rows: Array<Record<string, string>>;
    source: "commerce7" | "winedirect" | "generic";
    suggestedMapping: Record<string, string>;
    uploadToken: string;
    validation: {
      errors: Array<{ field?: string; message: string; row: number }>;
      invalidCount: number;
      validCount: number;
    };
  }>;
  processRelease(releaseId: string): Promise<{
    charged: number;
    declined: number;
    releaseId: string;
    skipped: number;
  }>;
  refundShipment(
    shipmentId: string,
    input: { amountCents?: number; reason?: string },
  ): Promise<Record<string, unknown>>;
  retryShipment(shipmentId: string): Promise<Record<string, unknown>>;
  scheduleRelease(releaseId: string): Promise<Record<string, unknown>>;
  transitionMember(
    memberId: string,
    status: MemberStatus,
  ): Promise<Record<string, unknown>>;
  transitionShipment(
    shipmentId: string,
    input: {
      carrier?: string;
      status: "shipped" | "delivered" | "cancelled";
      trackingNumber?: string;
    },
  ): Promise<Record<string, unknown>>;
  updateClubTier(
    tierId: string,
    input: Partial<ClubTierInput>,
  ): Promise<Record<string, unknown>>;
  updateMember(
    memberId: string,
    input: Partial<MemberInput>,
  ): Promise<Record<string, unknown>>;
  updateMemberPortalAddress(address: PostalAddress): Promise<Record<string, unknown>>;
  updateRelease(
    releaseId: string,
    input: Partial<ReleaseInput>,
  ): Promise<Record<string, unknown>>;
  validateShippingAddress(
    address: PostalAddress,
  ): Promise<{ address: PostalAddress; messages: string[]; valid: boolean }>;
}

export interface EmailTemplateInput {
  body: string;
  daysBefore?: number;
  enabled: boolean;
  subject: string;
  triggerType: EmailTriggerType;
}

export interface RetentionService {
  applyUnsubscribe(token: string): Promise<void>;
  adjustLoyaltyPoints(
    memberId: string,
    input: { points: number; reason: string },
  ): Promise<Record<string, unknown>>;
  deleteEmailTemplate(templateId: string): Promise<void>;
  getCancelFlowAnalytics(): Promise<Record<string, unknown>>;
  getCancelFlowConfiguration(): Promise<Record<string, unknown>>;
  getChurnScore(memberId: string): Promise<Record<string, unknown>>;
  getMemberCancelFlow(): Promise<Record<string, unknown>>;
  getMemberLoyalty(): Promise<Record<string, unknown>>;
  getStaffMemberLoyalty(memberId: string): Promise<Record<string, unknown>>;
  handleResendWebhook(
    payload: Buffer,
    headers: { id: string; signature: string; timestamp: string },
  ): Promise<{ duplicate: boolean; ignored?: boolean }>;
  listChurnScores(input: {
    limit: number;
    offset: number;
    riskLevel?: "low" | "medium" | "high";
    search?: string;
  }): Promise<{
    calculatedAt: string | null;
    highCount: number;
    items: Array<Record<string, unknown>>;
    lowCount: number;
    mediumCount: number;
    scoredCount: number;
    total: number;
  }>;
  listEmailLog(input: {
    limit: number;
    offset: number;
    status?: string;
    triggerType?: EmailTriggerType;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }>;
  listEmailTemplates(): Promise<Array<Record<string, unknown>>>;
  listLoyaltyMembers(input: {
    limit: number;
    offset: number;
    search?: string;
  }): Promise<{ items: Array<Record<string, unknown>>; total: number }>;
  previewEmailTemplate(
    templateId: string,
    input: {
      body?: string;
      subject?: string;
      variables?: Record<string, string>;
    },
  ): Promise<{ body: string; html: string; subject: string }>;
  processCancelFlowEvent(input: {
    action: CancelFlowOutcome;
    attemptId?: string;
    details?: Record<string, unknown>;
    stepId: string;
  }): Promise<Record<string, unknown>>;
  recordLoyaltyEvent(
    memberId: string,
    input: {
      eventId: string;
      eventType: "event_attendance";
      occurredAt?: string;
      reason?: string;
    },
  ): Promise<Record<string, unknown>>;
  redeemMemberLoyalty(input: {
    idempotencyKey: string;
    points: number;
    shipmentId: string;
  }): Promise<Record<string, unknown>>;
  sendEmailTemplateTest(
    templateId: string,
    input: { email: string; variables?: Record<string, string> },
  ): Promise<{ accepted: boolean; deliveryId: string }>;
  startMemberCancelFlow(): Promise<Record<string, unknown>>;
  updateCancelFlowConfiguration(input: {
    steps: Array<{
      enabled: boolean;
      id: "pause" | "downgrade" | "swap" | "confirm";
      position: number;
      stepId?: string;
    }>;
  }): Promise<Record<string, unknown>>;
  updateEmailTemplate(
    templateId: string,
    input: Partial<EmailTemplateInput>,
  ): Promise<Record<string, unknown>>;
  upsertEmailTemplate(input: EmailTemplateInput): Promise<Record<string, unknown>>;
}

export type ApplicationService = FoundationService &
  CoreClubService &
  RetentionService;

export type FoundationServiceFactory = (
  request: Request,
  response: Response,
) => FoundationService;

export type ApplicationServiceFactory = (
  request: Request,
  response: Response,
) => ApplicationService;

export interface ConfigurationCapability {
  configured: boolean;
  missing: string[];
}

export interface ConfigurationReport {
  app: ConfigurationCapability;
  billing: ConfigurationCapability;
  communications: ConfigurationCapability;
  database: ConfigurationCapability;
  email: ConfigurationCapability;
  googleOAuth: ConfigurationCapability;
  shipping: ConfigurationCapability;
  webhook: ConfigurationCapability;
}
