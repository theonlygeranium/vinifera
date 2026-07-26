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

type SessionState = "loading" | "authenticated" | "unauthenticated";

interface MemberSessionValue {
  state: SessionState;
  session: MemberSession | null;
  refresh: () => Promise<MemberSession | null>;
  clear: () => void;
}

const MemberSessionContext = createContext<MemberSessionValue | null>(null);

export function MemberSessionProvider({ children }: { children: ReactNode }) {
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
      setSession(null);
      setState("unauthenticated");
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    setSession(null);
    setState("unauthenticated");
  }, []);

  useEffect(() => {
    void refresh();
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
