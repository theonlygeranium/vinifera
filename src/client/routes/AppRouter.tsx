import { lazy, Suspense } from "react";
import { LoadingScreen } from "../shared/LoadingScreen";
import { Redirect, RouterProvider, useRouter } from "./router";

const StaffArea = lazy(() => import("../staff/StaffArea"));
const MemberArea = lazy(() => import("../member/MemberArea"));

function ActiveArea() {
  const { location } = useRouter();

  if (location.pathname === "/app" || location.pathname.startsWith("/app/")) {
    return <StaffArea />;
  }
  if (
    location.pathname === "/portal" ||
    location.pathname.startsWith("/portal/")
  ) {
    return <MemberArea />;
  }
  return <Redirect to="/app/login" />;
}

export function AppRouter() {
  return (
    <RouterProvider>
      <Suspense fallback={<LoadingScreen label="Loading Vinifera" />}>
        <ActiveArea />
      </Suspense>
    </RouterProvider>
  );
}
