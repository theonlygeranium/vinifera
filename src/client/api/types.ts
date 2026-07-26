export type StaffRole = "owner" | "admin" | "manager" | "staff" | "super_admin";
export type PlanTier = "vine" | "cellar" | "estate" | "reserve";

export interface StaffUser {
  id: string;
  email: string;
  fullName?: string | null;
  role: StaffRole;
}

export interface Organization {
  id: string;
  name: string;
  planTier: PlanTier | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  accessState?: "active" | "grace" | "restricted" | "suspended" | null;
}

export interface StaffSession {
  authenticated: boolean;
  user?: StaffUser;
  organization?: Organization | null;
  access?: {
    state?: "active" | "grace" | "restricted" | "suspended";
    graceEndsAt?: string | null;
    suspendedAt?: string | null;
  };
}

export interface MemberUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface MemberSession {
  authenticated: boolean;
  user?: MemberUser;
  organization?: Pick<Organization, "id" | "name">;
}
