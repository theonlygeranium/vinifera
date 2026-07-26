import type { Request, Response } from "express";

export type AuthSurface = "staff" | "member";
export type BillingCustomerState =
  | "deferred"
  | "ready"
  | "reconciliation_required";
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
export type AnalyticsRange =
  | "7d"
  | "30d"
  | "90d"
  | "12m"
  | "all"
  | "custom";
export type ComplianceStatus = "compliant" | "non_compliant" | "unknown";
export type IntegrationType =
  | "avalara"
  | "klaviyo"
  | "meta"
  | "quickbooks";

export interface WorkerEnv {
  ALLOWED_ORIGINS?: string;
  APNS_BUNDLE_ID?: string;
  APNS_ENVIRONMENT?: "production" | "sandbox";
  APNS_KEY_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_TEAM_ID?: string;
  APP_ENV?: "development" | "test" | "staging" | "production";
  APP_ORIGIN?: string;
  ASSETS?: Fetcher;
  AUTH_EMAIL_ENABLED?: "true" | "false";
  COMPLIANCE_PROVIDER?: "shipcompliant" | "simulated";
  COMPLIANCE_SIMULATOR_ENABLED?: "true" | "false";
  GOOGLE_OAUTH_ENABLED?: "true" | "false";
  INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION?: string;
  INTEGRATION_CREDENTIAL_ENCRYPTION_KEYS?: string;
  LIVE_BILLING_ENABLED?: "true" | "false";
  QUICKBOOKS_CLIENT_ID?: string;
  QUICKBOOKS_CLIENT_SECRET?: string;
  QUICKBOOKS_ENVIRONMENT?: "production" | "sandbox";
  QUICKBOOKS_REDIRECT_URI?: string;
  QUICKBOOKS_STATE_SIGNING_SECRET?: string;
  CLOUDFLARE_CUSTOM_HOSTNAME_API_TOKEN?: string;
  CLOUDFLARE_CUSTOM_HOSTNAME_ORIGIN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  EASYPOST_LIVE_LABELS_ENABLED?: "true" | "false";
  MOBILE_ANDROID_LATEST_VERSION?: string;
  MOBILE_ANDROID_MINIMUM_VERSION?: string;
  MOBILE_ANDROID_PACKAGE_NAME?: string;
  MOBILE_ANDROID_SIGNING_CERT_SHA256?: string;
  MOBILE_ANDROID_STORE_URL?: string;
  MOBILE_APPLE_TEAM_ID?: string;
  MOBILE_AUTH_EMAIL_TEMPLATE_ENABLED?: "true" | "false";
  MOBILE_AUTH_STATE_SIGNING_SECRET?: string;
  MOBILE_IOS_BUNDLE_ID?: string;
  MOBILE_IOS_LATEST_VERSION?: string;
  MOBILE_IOS_MINIMUM_VERSION?: string;
  MOBILE_IOS_STORE_URL?: string;
  RATE_LIMIT_PEPPER?: string;
  MEMBER_BRAND_CONTEXT_SECRET?: string;
  EASYPOST_API_KEY?: string;
  EMAIL_PROVIDER?: "resend" | "simulated";
  EMAIL_SIMULATOR_ENABLED?: "true" | "false";
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
  FCM_PROJECT_ID?: string;
  RESEND_API_KEY?: string;
  RESEND_DOMAIN_VERIFIED?: "true" | "false";
  RESEND_FROM?: string;
  RESEND_SENDING_DOMAIN?: string;
  RESEND_WEBHOOK_SECRET?: string;
  SHIPCOMPLIANT_ACCOUNT_ID?: string;
  SHIPCOMPLIANT_API_KEY?: string;
  SHIPCOMPLIANT_API_SECRET?: string;
  SHIPCOMPLIANT_BASE_URL?: string;
  SHIPCOMPLIANT_CHECK_PATH?: string;
  SHIPCOMPLIANT_CONTRACT_VERSION?: string;
  SHIPCOMPLIANT_ENDPOINT_MODE?: "production" | "sandbox";
  SHIPCOMPLIANT_LICENSE_ID?: string;
  SHIPCOMPLIANT_TOKEN_PATH?: string;
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
  brand: {
    id: string;
  };
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
  acceptStaffInvite(input: {
    fullName?: string;
    inviteToken?: string;
    password: string;
  }): Promise<StaffPrincipal>;
  completeStaffPasswordReset(input: { password: string }): Promise<void>;
  createBillingCheckout(input: {
    attemptId: string;
    planTier: PlanTier;
  }): Promise<{ url: string }>;
  createBillingPortal(input: { attemptId: string }): Promise<{ url: string }>;
  createStaffInvitation(input: {
    email: string;
    role: "admin" | "manager" | "staff";
  }): Promise<{ expiresAt: string }>;
  exchangeAuthCode(
    surface: AuthSurface,
    code: string,
    state?: string,
  ): Promise<{ destination: string }>;
  getGoogleOAuthUrl(): Promise<string>;
  getMemberSession(): Promise<MemberPrincipal | null>;
  getStaffSession(): Promise<StaffPrincipal | null>;
  handleStripeWebhook(payload: Buffer, signature: string): Promise<{ duplicate: boolean }>;
  requestMemberMagicLink(input: {
    brandId?: string;
    email: string;
    ipAddress: string;
  }): Promise<void>;
  requestStaffPasswordReset(input: { email: string }): Promise<void>;
  staffLogin(input: { email: string; password: string }): Promise<StaffPrincipal>;
  staffLogout(): Promise<void>;
  staffSignup(input: {
    email: string;
    fullName: string;
    organizationName: string;
    password: string;
    planTier: PlanTier;
  }): Promise<{
    billingActivationRequired: boolean;
    billingCustomerState: BillingCustomerState;
    principal: StaffPrincipal | null;
  }>;
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
  createMemberPaymentMethodPortal(input: {
    attemptId: string;
  }): Promise<{ url: string }>;
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

export interface AnalyticsService {
  acknowledgeHighRiskAlert(alertId: string): Promise<Record<string, unknown>>;
  exportAnalyticsWidget(
    widget: string,
    input: {
      from?: string;
      range: AnalyticsRange;
      to?: string;
    },
  ): Promise<{ contents: string; filename: string }>;
  getAnalyticsDashboard(input: {
    from?: string;
    range: AnalyticsRange;
    to?: string;
  }): Promise<Record<string, unknown>>;
  getAnalyticsLayout(): Promise<Record<string, unknown>>;
  getBenchmarkComparison(): Promise<Record<string, unknown>>;
  getComplianceCheck(checkId: string): Promise<Record<string, unknown>>;
  getChurnIntelligence(input: {
    limit: number;
    offset: number;
    riskLevel?: "low" | "medium" | "high";
    search?: string;
  }): Promise<Record<string, unknown>>;
  getMemberChurnIntelligence(memberId: string): Promise<Record<string, unknown>>;
  getMlOperations(): Promise<Record<string, unknown>>;
  listComplianceChecks(input: {
    limit: number;
    offset: number;
    releaseId?: string;
    status?: ComplianceStatus;
  }): Promise<Record<string, unknown>>;
  listScheduledAnalyticsReports(): Promise<Array<Record<string, unknown>>>;
  recordAnalyticsEvent(input: {
    eventData?: Record<string, string | number | boolean | null>;
    eventType: string;
    idempotencyKey: string;
    memberId?: string;
  }): Promise<{ accepted: boolean }>;
  runShipmentComplianceCheck(
    shipmentId: string,
  ): Promise<Record<string, unknown>>;
  runReleaseComplianceChecks(
    releaseId: string,
  ): Promise<{
    compliant: number;
    nonCompliant: number;
    results: Array<Record<string, unknown>>;
    unknown: number;
  }>;
  saveAnalyticsLayout(input: {
    widgets: Array<{
      enabled: boolean;
      id: string;
      order: number;
      size: "half" | "full";
    }>;
  }): Promise<Record<string, unknown>>;
  setBenchmarkOptIn(input: {
    optedIn: boolean;
    quarterlyReportEnabled: boolean;
  }): Promise<Record<string, unknown>>;
  upsertScheduledAnalyticsReport(input: {
    enabled: boolean;
    frequency: "weekly" | "monthly";
    id?: string;
    recipientEmail: string;
    widgetIds: string[];
  }): Promise<Record<string, unknown>>;
  updateScheduledAnalyticsReport(
    reportId: string,
    input: Partial<{
      enabled: boolean;
      frequency: "weekly" | "monthly";
      recipientEmail: string;
      widgetIds: string[];
    }>,
  ): Promise<Record<string, unknown>>;
}

export interface IntegrationService {
  activateBrandSender(brandId: string): Promise<Record<string, unknown>>;
  completeMobileMagicLink(input: {
    state: string;
    tokenHash: string;
    type: "email";
  }): Promise<{ redirectUrl: string }>;
  completeQuickBooksOAuth(input: {
    code: string;
    realmId: string;
    state: string;
  }): Promise<{ connected: boolean; redirectPath: string }>;
  connectIntegration(
    type: IntegrationType,
    input: {
      brandId?: string | null;
      consentConfirmed: boolean;
      credentials?: Record<string, unknown>;
      optedIn: boolean;
      syncConfig?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>>;
  createBrand(input: {
    billingMode: "independent" | "shared";
    defaultShippingChargeCents?: number;
    description?: string | null;
    name: string;
    slug: string;
  }): Promise<Record<string, unknown>>;
  deleteBrandDomain(brandId: string): Promise<void>;
  disconnectIntegration(type: IntegrationType): Promise<void>;
  exchangeMobileSession(input: {
    appVersion: string;
    code: string;
    deviceFingerprint: string;
    platform: "android" | "ios";
    redirectUri: string;
  }): Promise<Record<string, unknown>>;
  getAvalaraLiability(): Promise<Record<string, unknown>>;
  getAvalaraFilingStatus(): Promise<Record<string, unknown>>;
  getBrandDomain(brandId: string): Promise<Record<string, unknown>>;
  getBrandOverview(brandId?: string | "all"): Promise<Record<string, unknown>>;
  getMetaAttributionReport(input: {
    from?: string;
    to?: string;
  }): Promise<Record<string, unknown>>;
  getMemberMetaPrivacy(): Promise<Record<string, unknown>>;
  getMobileAppPolicy(input: {
    platform: "android" | "ios";
    version: string;
  }): Promise<Record<string, unknown>>;
  getPortalBranding(hostname: string): Promise<Record<string, unknown>>;
  getMobileBootstrap(): Promise<Record<string, unknown>>;
  getQuickBooksAuthorizationUrl(
    brandId?: string | null,
  ): Promise<{ url: string }>;
  getQuickBooksReconciliation(): Promise<Record<string, unknown>>;
  handleKlaviyoWebhook(
    integrationId: string,
    payload: Uint8Array,
    headers: {
      signature?: string;
      timestamp?: string;
      webhookId?: string;
    },
  ): Promise<{
    accepted: boolean;
    duplicates: number;
    ignored: number;
    processed: number;
    queued: number;
  }>;
  listBrands(): Promise<{
    canViewAllBrands: boolean;
    items: Array<Record<string, unknown>>;
  }>;
  listIntegrationLogs(
    type: IntegrationType,
    limit: number,
  ): Promise<{ items: Array<Record<string, unknown>> }>;
  listIntegrations(): Promise<Record<string, unknown>>;
  logoutMobileSession(input: {
    refreshToken: string;
  }): Promise<void>;
  queueIntegrationSync(
    type: IntegrationType,
  ): Promise<Record<string, unknown>>;
  queueAvalaraFilingVerification(): Promise<Record<string, unknown>>;
  registerMobileDevice(input: {
    appVersion: string;
    brandId?: string | null;
    deviceFingerprint: string;
    permission: "denied" | "granted" | "prompt";
    platform: "android" | "ios";
    token: string;
  }): Promise<Record<string, unknown>>;
  refreshMobileSession(input: {
    refreshToken: string;
  }): Promise<Record<string, unknown>>;
  requestMobileMagicLink(input: {
    clubCode?: string;
    deviceFingerprint: string;
    email: string;
    ipAddress: string;
    redirectUri: string;
  }): Promise<void>;
  unregisterMobileDevice(deviceFingerprint: string): Promise<void>;
  updateMemberMetaPrivacy(input: {
    attribution?: {
      campaignId?: string | null;
      campaignName?: string | null;
      eventSourceUrl: string;
      fbc?: string | null;
      fbp?: string | null;
      medium?: string | null;
      occurredAt: string;
      source?: string | null;
    };
    clientEventId?: string;
    consentSource: string;
    consented: boolean;
    policyVersion: string;
  }): Promise<Record<string, unknown>>;
  updateBrand(
    brandId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  updateBrandDomain(
    brandId: string,
    hostname: string,
  ): Promise<Record<string, unknown>>;
  updateIntegration(
    type: IntegrationType,
    input: {
      consentConfirmed?: boolean;
      credentials?: Record<string, unknown>;
      optedIn?: boolean;
      syncConfig?: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>>;
}

export type ApplicationService = FoundationService &
  CoreClubService &
  RetentionService &
  AnalyticsService &
  IntegrationService;

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
  compliance: ConfigurationCapability;
  communications: ConfigurationCapability;
  customDomains: ConfigurationCapability;
  database: ConfigurationCapability;
  email: ConfigurationCapability;
  googleOAuth: ConfigurationCapability;
  integrationEncryption: ConfigurationCapability;
  mobile: ConfigurationCapability;
  push: ConfigurationCapability;
  quickBooksOAuth: ConfigurationCapability;
  shipping: ConfigurationCapability;
  webhook: ConfigurationCapability;
}
