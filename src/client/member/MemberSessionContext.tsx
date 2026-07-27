import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiRequest } from "../api/client";
import type { MemberSession } from "../api/types";
import { useMobileRuntime } from "../mobile/MobileRuntime";
import { readCachedNativeMember } from "../mobile/native-session";

type SessionState =
  | "loading"
  | "authenticated"
  | "cached"
  | "unauthenticated";

interface MemberSessionValue {
  state: SessionState;
  session: MemberSession | null;
  refresh: () => Promise<MemberSession | null>;
  clear: () => void;
}

const MemberSessionContext = createContext<MemberSessionValue | null>(null);

export function MemberSessionProvider({ children }: { children: ReactNode }) {
  const mobile = useMobileRuntime();
  const [state, setState] = useState<SessionState>("loading");
  const [session, setSession] = useState<MemberSession | null>(null);

  const refresh = useCallback(async () => {
    try {
      const nextSession = await apiRequest<MemberSession>(
        "/api/auth/member/session",
      );
      if (nextSession.authenticated && nextSession.user) {
        setSession(nextSession);
        setState("authenticated");
        return nextSession;
      }
      setSession(null);
      setState("unauthenticated");
      return null;
    } catch {
      if (
        mobile.native &&
        mobile.sessionUnlocked &&
        mobile.bootstrap.status === "cached"
      ) {
        const cachedMember = await readCachedNativeMember();
        if (cachedMember) {
          const cachedSession: MemberSession = {
            authenticated: true,
            user: cachedMember,
          };
          setSession(cachedSession);
          setState("cached");
          return cachedSession;
        }
      }
      setSession(null);
      setState("unauthenticated");
      return null;
    }
  }, [
    mobile.bootstrap.status,
    mobile.native,
    mobile.sessionUnlocked,
  ]);

  const clear = useCallback(() => {
    setSession(null);
    setState("unauthenticated");
  }, []);

  useEffect(() => {
    if (
      mobile.native &&
      mobile.sessionUnlocked &&
      mobile.bootstrap.status === "idle"
    ) {
      return;
    }
    void refresh();
  }, [
    mobile.bootstrap.status,
    mobile.native,
    mobile.sessionUnlocked,
    refresh,
  ]);

  useEffect(() => {
    const handleNativeAuth = () => void refresh();
    window.addEventListener(
      "vinifera:member-auth-changed",
      handleNativeAuth,
    );
    return () =>
      window.removeEventListener(
        "vinifera:member-auth-changed",
        handleNativeAuth,
      );
  }, [refresh]);

  const value = useMemo(
    () => ({ state, session, refresh, clear }),
    [clear, refresh, session, state],
  );

  return (
    <MemberSessionContext.Provider value={value}>
      {children}
    </MemberSessionContext.Provider>
  );
}

export function useMemberSession() {
  const context = useContext(MemberSessionContext);
  if (!context) {
    throw new Error(
      "useMemberSession must be used within MemberSessionProvider",
    );
  }
  return context;
}
