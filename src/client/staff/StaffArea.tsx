import { LoadingScreen } from "../shared/LoadingScreen";
import { Redirect, useRouter } from "../routes/router";
import { StaffDashboard } from "./StaffDashboard";
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

function ProtectedDashboard() {
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
  return <StaffDashboard />;
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
    return <ProtectedDashboard />;
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
