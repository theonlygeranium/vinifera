export type IntegrationType = "klaviyo" | "quickbooks" | "avalara" | "meta";
export type IntegrationStatus =
  | "activation_required"
  | "configured"
  | "active"
  | "degraded"
  | "error"
  | "disconnected";

export interface IntegrationSummary {
  type: IntegrationType;
  status: IntegrationStatus;
  optedIn: boolean;
  consentedAt: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  capabilities: string[];
  syncConfig: Record<string, unknown>;
}

export interface IntegrationsResponse {
  items: IntegrationSummary[];
  health: {
    active: number;
    degraded: number;
    activationRequired: number;
  };
}

export interface IntegrationLog {
  id: string;
  syncType: string;
  status: "queued" | "running" | "succeeded" | "partial" | "failed";
  recordsSynced: number;
  recordsFailed: number;
  errorCode: string | null;
  createdAt: string;
}

export interface IntegrationLogsResponse {
  items: IntegrationLog[];
}

export type BrandDomainStatus =
  | "unconfigured"
  | "pending_validation"
  | "active"
  | "error";

export interface Brand {
  id: string;
  slug?: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor?: string | null;
  fontFamily: string | null;
  portalTitle?: string | null;
  customDomain: string | null;
  domainStatus: BrandDomainStatus;
  sslStatus?: "unconfigured" | "pending" | "active" | "error";
  billingMode: "shared" | "independent";
  isDefault: boolean;
  emailSenderName?: string | null;
  emailSenderAddress?: string | null;
  emailDomainStatus?: "unconfigured" | "pending" | "verified" | "error";
}

export interface OrganizationBrandOverview {
  brandCount: number;
  activeMembers: number;
  monthlyRecurringRevenueCents: number;
  shipmentsThisPeriod: number;
  brands: Array<{
    id: string;
    name: string;
    activeMembers: number;
    monthlyRecurringRevenueCents: number;
    shipmentsThisPeriod: number;
  }>;
}

export interface DomainVerification {
  hostname: string;
  status: "pending_validation" | "active" | "error";
  validation: {
    type: "CNAME" | "TXT";
    name: string;
    value: string;
  } | null;
  sslStatus: "pending" | "active" | "error";
}

export interface MobileAppPolicy {
  minimumVersion: string;
  latestVersion: string;
  update: "none" | "recommended" | "required";
  storeUrl?: string | null;
  message?: string | null;
}

export interface MobileBootstrap {
  brand: {
    id: string;
    name: string;
    logoUrl?: string | null;
    primaryColor?: string | null;
  } | null;
  member: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
  };
  recentShipments: Array<{
    id: string;
    releaseName: string;
    status: string;
    createdAt: string;
    chargeAmountCents: number;
    trackingNumber?: string | null;
  }>;
  loyaltyLedger: Array<{
    id: string;
    description: string;
    points: number;
    createdAt: string;
  }>;
  pendingActions: Array<{
    id: string;
    type: string;
    label: string;
  }>;
  cursor: string | null;
  generatedAt: string;
}

export interface MobileSessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  tokenType: "bearer";
  member: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  };
}
