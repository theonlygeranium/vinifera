import { useEffect, useState } from "react";
import { Redirect, useRouter, useSearchParams } from "../routes/router";
import { LoadingScreen } from "../shared/LoadingScreen";
import { isNativeShell, exchangeNativeMagicLink } from "../mobile/native-session";
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
  const { navigate } = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isNativeShell()) {
      navigate("/portal/login?error=invalid_link", { replace: true });
      return;
    }
    const code = search.get("code");
    if (!code) {
      navigate("/portal/login?error=invalid_link", { replace: true });
      return;
    }
    let cancelled = false;
    void exchangeNativeMagicLink(code)
      .then(() => {
        if (cancelled) return;
        window.dispatchEvent(new Event("vinifera:member-auth-changed"));
        navigate("/portal", { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, search]);

  if (error) {
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
