import { type ReactNode } from "react";
import { StaffBrandingProvider } from "../member/MemberBranding";
import { LoadingScreen } from "../shared/LoadingScreen";
import { Redirect, useRouter } from "../routes/router";
import { StaffDashboard } from "./StaffDashboard";
import { ClubTiersPage } from "./phase2/ClubTiersPage";
import { ImportMembersPage } from "./phase2/ImportMembersPage";
import { MemberDetailPage, MembersPage } from "./phase2/MembersPage";
import { ReleaseDetailPage, ReleasesPage } from "./phase2/ReleasesPage";
import {
  FulfillmentPage,
  RecoveryPage,
  ShipmentsPage,
} from "./phase2/ShipmentOperationsPages";
import {
  ForgotPasswordPage,
  InvitePage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
} from "./StaffAuthPages";
import { CommunicationsPage } from "./phase3/CommunicationsPage";
import { ChurnWatchPage } from "./phase3/ChurnWatchPage";
import { LoyaltyPage } from "./phase3/LoyaltyPage";
import { RetentionPage } from "./phase3/RetentionPage";
import { AnalyticsPage } from "./phase4/AnalyticsPage";
import { BenchmarksPage } from "./phase4/BenchmarksPage";
import { ChurnIntelligencePage } from "./phase4/ChurnIntelligencePage";
import { CompliancePage } from "./phase4/CompliancePage";
import { BrandScopeProvider } from "./phase5/BrandScopeContext";
import { BrandsPage } from "./phase5/BrandsPage";
import { IntegrationsPage } from "./phase5/IntegrationsPage";
import { WhiteLabelPage } from "./phase5/WhiteLabelPage";
import {
  StaffSessionProvider,
  useStaffSession,
} from "./StaffSessionContext";
import { TeamPage } from "./TeamPage";

function ProtectedPage({ children }: { children: ReactNode }) {
  const { state } = useStaffSession();
  const { location } = useRouter();

  if (state === "loading") {
    return <LoadingScreen label="Checking your staff session" />;
  }
  if (state === "unauthenticated") {
    return (
      <Redirect
        to="/app/login"
        state={{ returnTo: location.pathname }}
      />
    );
  }
  return <BrandScopeProvider>{children}</BrandScopeProvider>;
}

function StaffRoutes() {
  const { location } = useRouter();
  const route = location.pathname.replace(/\/+$/, "") || "/";

  if (route === "/app/login") return <LoginPage />;
  if (route === "/app/signup") return <SignupPage />;
  if (route === "/app/forgot-password") return <ForgotPasswordPage />;
  if (route === "/app/reset-password") return <ResetPasswordPage />;
  if (route === "/app/invite") return <InvitePage />;
  if (route === "/app/team") {
    return (
      <ProtectedPage>
        <TeamPage />
      </ProtectedPage>
    );
  }
  if (route === "/app" || route === "/app/dashboard") {
    return (
      <ProtectedPage>
        <StaffDashboard />
      </ProtectedPage>
    );
  }
  if (route === "/app/members") {
    return (
      <ProtectedPage>
        <MembersPage />
      </ProtectedPage>
    );
  }
  const memberMatch = route.match(/^\/app\/members\/([^/]+)$/);
  if (memberMatch) {
    return (
      <ProtectedPage>
        <MemberDetailPage memberId={decodeURIComponent(memberMatch[1]!)} />
      </ProtectedPage>
    );
  }
  if (route === "/app/tiers") {
    return (
      <ProtectedPage>
        <ClubTiersPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/releases") {
    return (
      <ProtectedPage>
        <ReleasesPage />
      </ProtectedPage>
    );
  }
  const releaseMatch = route.match(/^\/app\/releases\/([^/]+)$/);
  if (releaseMatch) {
    return (
      <ProtectedPage>
        <ReleaseDetailPage releaseId={decodeURIComponent(releaseMatch[1]!)} />
      </ProtectedPage>
    );
  }
  if (route === "/app/recovery") {
    return (
      <ProtectedPage>
        <RecoveryPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/shipments") {
    return (
      <ProtectedPage>
        <ShipmentsPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/fulfillment") {
    return (
      <ProtectedPage>
        <FulfillmentPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/import") {
    return (
      <ProtectedPage>
        <ImportMembersPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/communications") {
    return (
      <ProtectedPage>
        <CommunicationsPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/churn-watch") {
    return (
      <ProtectedPage>
        {new URLSearchParams(location.search).get("view") === "rules" ? (
          <ChurnWatchPage />
        ) : (
          <ChurnIntelligencePage />
        )}
      </ProtectedPage>
    );
  }
  if (route === "/app/retention") {
    return (
      <ProtectedPage>
        <RetentionPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/loyalty") {
    return (
      <ProtectedPage>
        <LoyaltyPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/analytics") {
    return (
      <ProtectedPage>
        <AnalyticsPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/benchmarks") {
    return (
      <ProtectedPage>
        <BenchmarksPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/compliance") {
    return (
      <ProtectedPage>
        <CompliancePage />
      </ProtectedPage>
    );
  }
  if (route === "/app/integrations") {
    return (
      <ProtectedPage>
        <IntegrationsPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/brands") {
    return (
      <ProtectedPage>
        <BrandsPage />
      </ProtectedPage>
    );
  }
  if (route === "/app/white-label") {
    return (
      <ProtectedPage>
        <WhiteLabelPage />
      </ProtectedPage>
    );
  }
  return <Redirect to="/app" />;
}

export default function StaffArea() {
  return (
    <StaffSessionProvider>
      <StaffBrandingProvider>
        <StaffRoutes />
      </StaffBrandingProvider>
    </StaffSessionProvider>
  );
}
