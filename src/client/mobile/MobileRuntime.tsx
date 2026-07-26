import { App as CapacitorApp, type AppState } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { PushNotifications } from "@capacitor/push-notifications";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiRequest, postJson, setNativeAccessTokenProvider } from "../api/client";
import type { MobileAppPolicy, MobileBootstrap } from "../api/phase5";
import { useRouter } from "../routes/router";
import { LoadingScreen } from "../shared/LoadingScreen";
import {
  cacheMobileBootstrap,
  exchangeNativeMagicLink,
  getNativeDeviceFingerprint,
  getNativeAccessToken,
  initializeNativeSession,
  isNativeShell,
  lockNativeSession,
  readCachedMobileBootstrap,
} from "./native-session";
import {
  blocksPrivateContent,
  safeStoreUrl,
  shouldRelockAfterBackground,
} from "./mobile-policy";
import {
  MOBILE_EXTERNAL_DEEP_LINK_PATHS,
  routeFromMobileUrl,
} from "./mobile-identity";

type BootstrapState =
  | { status: "idle"; data: null }
  | { status: "live" | "cached"; data: MobileBootstrap }
  | { status: "unavailable"; data: null };

interface MobileRuntimeValue {
  native: boolean;
  online: boolean;
  bootstrap: BootstrapState;
  refreshBootstrap: () => Promise<void>;
}

const MobileRuntimeContext = createContext<MobileRuntimeValue>({
  native: false,
  online: true,
  bootstrap: { status: "idle", data: null },
  refreshBootstrap: async () => undefined,
});

const ALLOWED_DEEP_LINKS = new Set(MOBILE_EXTERNAL_DEEP_LINK_PATHS);

export function MobileRuntime({ children }: { children: ReactNode }) {
  const { navigate } = useRouter();
  const native = isNativeShell();
  const [ready, setReady] = useState(!native);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [bootstrap, setBootstrap] = useState<BootstrapState>({
    status: "idle",
    data: null,
  });
  const [policy, setPolicy] = useState<MobileAppPolicy | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  const refreshBootstrap = useCallback(async () => {
    if (!native) return;
    if (!(await getNativeAccessToken())) {
      setBootstrap({ status: "unavailable", data: null });
      return;
    }
    try {
      const next = await apiRequest<MobileBootstrap>("/api/mobile/bootstrap");
      await cacheMobileBootstrap(next);
      setBootstrap({ status: "live", data: next });
    } catch {
      const cached = await readCachedMobileBootstrap().catch(() => null);
      setBootstrap(
        cached
          ? { status: "cached", data: cached }
          : { status: "unavailable", data: null },
      );
    }
  }, [native]);

  const handleDeepLink = useCallback(
    async (value: string) => {
      const target = routeFromMobileUrl(value);
      if (!target) return;
      if (target.path === "/portal/auth") {
        const code = target.search.get("code");
        if (!code) {
          navigate("/portal/login?error=invalid_link", { replace: true });
          return;
        }
        try {
          await exchangeNativeMagicLink(code);
          window.dispatchEvent(new Event("vinifera:member-auth-changed"));
          await refreshBootstrap();
          navigate("/portal", { replace: true });
        } catch {
          navigate("/portal/login?error=invalid_link", { replace: true });
        }
        return;
      }
      navigate(target.path);
    },
    [navigate, refreshBootstrap],
  );

  const checkUpdatePolicy = useCallback(async () => {
    if (!native) return;
    try {
      const info = await CapacitorApp.getInfo();
      const next = await apiRequest<MobileAppPolicy>(
        `/api/mobile/app-policy?platform=${encodeURIComponent(
          Capacitor.getPlatform(),
        )}&version=${encodeURIComponent(info.version)}`,
      );
      setPolicy(next);
    } catch {
      setPolicy(null);
    }
  }, [native]);

  const registerPush = useCallback(async () => {
    if (!native || !(await getNativeAccessToken())) return;
    const permission = await PushNotifications.checkPermissions();
    const resolvedPermission =
      permission.receive === "prompt"
        ? (await PushNotifications.requestPermissions()).receive
        : permission.receive;
    if (resolvedPermission !== "granted") return;
    await PushNotifications.register();
  }, [native]);

  useEffect(() => {
    if (!native) return;
    setNativeAccessTokenProvider(getNativeAccessToken);
    let disposed = false;
    void initializeNativeSession().then((result) => {
      if (disposed) return;
      setReady(true);
      if (result !== "unlocked") {
        setBootstrap({ status: "unavailable", data: null });
      }
    });
    return () => {
      disposed = true;
      setNativeAccessTokenProvider(null);
    };
  }, [native]);

  useEffect(() => {
    if (!native || !ready) return;
    const listeners = [
      Network.addListener("networkStatusChange", ({ connected }) => {
        setOnline(connected);
        if (connected) void refreshBootstrap();
      }),
      CapacitorApp.addListener("appUrlOpen", ({ url }) => {
        void handleDeepLink(url);
      }),
      CapacitorApp.addListener("appStateChange", (state: AppState) => {
        if (!state.isActive) {
          backgroundedAt.current = Date.now();
          return;
        }
        if (shouldRelockAfterBackground(backgroundedAt.current, Date.now())) {
          lockNativeSession();
          setReady(false);
          setBootstrap({ status: "unavailable", data: null });
          void initializeNativeSession().then((result) => {
            setReady(true);
            window.dispatchEvent(new Event("vinifera:member-auth-changed"));
            if (result === "unlocked") {
              void refreshBootstrap();
            } else {
              navigate("/portal/login", {
                replace: true,
                state: { notice: "Unlock cancelled. Use a new magic link." },
              });
            }
          });
        }
        backgroundedAt.current = null;
        void checkUpdatePolicy();
      }),
      PushNotifications.addListener("registration", async ({ value }) => {
        const info = await CapacitorApp.getInfo();
        const deviceFingerprint = await getNativeDeviceFingerprint();
        await postJson("/api/mobile/devices", {
          deviceFingerprint,
          token: value,
          platform: Capacitor.getPlatform(),
          appVersion: info.version,
          permission: "granted",
        }).catch(() => undefined);
      }),
      PushNotifications.addListener(
        "pushNotificationActionPerformed",
        ({ notification }) => {
          const route = notification.data?.route;
          if (typeof route !== "string") return;
          const normalized = route.replace(/\/+$/, "") || "/portal";
          if (ALLOWED_DEEP_LINKS.has(normalized)) navigate(normalized);
        },
      ),
    ];

    void Network.getStatus().then(({ connected }) => setOnline(connected));
    void CapacitorApp.getLaunchUrl().then((launch) => {
      if (launch?.url) void handleDeepLink(launch.url);
    });
    void refreshBootstrap();
    void checkUpdatePolicy();
    void registerPush();

    return () => {
      for (const listener of listeners) {
        void listener.then((handle) => handle.remove());
      }
    };
  }, [
    checkUpdatePolicy,
    handleDeepLink,
    native,
    navigate,
    ready,
    refreshBootstrap,
    registerPush,
  ]);

  const value = useMemo(
    () => ({ native, online, bootstrap, refreshBootstrap }),
    [bootstrap, native, online, refreshBootstrap],
  );

  if (!ready) {
    return <LoadingScreen label="Securing your mobile session" />;
  }

  const storeUrl = safeStoreUrl(policy?.storeUrl);
  const requiredUpdate = blocksPrivateContent(policy);

  return (
    <MobileRuntimeContext.Provider value={value}>
      {requiredUpdate ? (
        <aside className="mobile-update-banner" role="alert">
          <strong>Vinifera must be updated</strong>
          <span>
            {policy?.message ??
              "Install the current store version before continuing."}
          </span>
          {storeUrl ? (
            <a className="button button--primary" href={storeUrl}>
              Open app store
            </a>
          ) : null}
        </aside>
      ) : (
        <>
          {policy?.update === "recommended" ? (
            <aside className="mobile-update-banner" role="status">
              <strong>Update available</strong>
              <span>
                {policy.message ?? "A newer Vinifera version is available."}
              </span>
              {storeUrl ? (
                <a className="button button--secondary" href={storeUrl}>
                  View update
                </a>
              ) : null}
            </aside>
          ) : null}
          {children}
        </>
      )}
    </MobileRuntimeContext.Provider>
  );
}

export function useMobileRuntime() {
  return useContext(MobileRuntimeContext);
}
