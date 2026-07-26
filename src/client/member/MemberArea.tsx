import { useEffect } from "react";
import { Redirect, useRouter } from "../routes/router";
import { LoadingScreen } from "../shared/LoadingScreen";
import { isNativeShell } from "../mobile/native-session";
import { MemberLoginPage } from "./MemberLoginPage";
import { MemberPortal } from "./MemberPortal";
import { MemberBrandingProvider } from "./MemberBranding";
import {
  MemberSessionProvider,
  useMemberSession,
} from "./MemberSessionContext";

function ProtectedPortal() {
  const { state } = useMemberSession();
  const { location } = useRouter();
  if (state === "loading") {
    return <LoadingScreen label="Checking your member session" />;
  }
  if (state === "unauthenticated") {
    return (
      <Redirect
        to="/portal/login"
        state={{ returnTo: location.pathname }}
      />
    );
  }
  return <MemberPortal />;
}

function MemberCallback() {
  const { navigate } = useRouter();
  const { refresh } = useMemberSession();

  useEffect(() => {
    void refresh().then((session) => {
      navigate(session ? "/portal" : "/portal/login?error=invalid_link", {
        replace: true,
      });
    });
  }, [navigate, refresh]);

  return <LoadingScreen label="Completing your secure sign-in" />;
}

function NativeMemberCallback() {
  if (!isNativeShell()) {
    return <Redirect to="/portal/login?error=invalid_link" />;
  }
  return <LoadingScreen label="Completing your secure mobile sign-in" />;
}

function MemberRoutes() {
  const { location } = useRouter();
  const route = location.pathname.replace(/\/+$/, "") || "/";

  if (route === "/portal/login") return <MemberLoginPage />;
  if (route === "/portal/auth") return <NativeMemberCallback />;
  if (route === "/portal/auth/callback") return <MemberCallback />;
  if (route === "/portal") return <ProtectedPortal />;
  return <Redirect to="/portal" />;
}

export default function MemberArea() {
  return (
    <MemberBrandingProvider>
      <MemberSessionProvider>
        <MemberRoutes />
      </MemberSessionProvider>
    </MemberBrandingProvider>
  );
}
