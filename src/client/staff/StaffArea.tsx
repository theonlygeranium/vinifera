import { type ReactNode } from "react";
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
import {
  StaffSessionProvider,
  useStaffSession,
} from "./StaffSessionContext";

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
  return children;
}

function StaffRoutes() {
  const { location } = useRouter();
  const route = location.pathname.replace(/\/+$/, "") || "/";

  if (route === "/app/login") return <LoginPage />;
  if (route === "/app/signup") return <SignupPage />;
  if (route === "/app/forgot-password") return <ForgotPasswordPage />;
  if (route === "/app/reset-password") return <ResetPasswordPage />;
  if (route === "/app/invite") return <InvitePage />;
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
  return <Redirect to="/app" />;
}

export default function StaffArea() {
  return (
    <StaffSessionProvider>
      <StaffRoutes />
    </StaffSessionProvider>
  );
}
