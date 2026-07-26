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
import type { StaffSession } from "../api/types";

type SessionState = "loading" | "authenticated" | "unauthenticated";

interface StaffSessionValue {
  state: SessionState;
  session: StaffSession | null;
  refresh: () => Promise<StaffSession | null>;
  clear: () => void;
}

const StaffSessionContext = createContext<StaffSessionValue | null>(null);

export function StaffSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>("loading");
  const [session, setSession] = useState<StaffSession | null>(null);

  const refresh = useCallback(async () => {
    try {
      const nextSession = await apiRequest<StaffSession>(
        "/api/auth/staff/session",
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
    <StaffSessionContext.Provider value={value}>
      {children}
    </StaffSessionContext.Provider>
  );
}

export function useStaffSession() {
  const context = useContext(StaffSessionContext);
  if (!context) {
    throw new Error("useStaffSession must be used within StaffSessionProvider");
  }
  return context;
}
