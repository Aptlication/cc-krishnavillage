import { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { setUnauthorizedHandler } from "@workspace/api-client-react";
import type { StaffSession } from "@workspace/api-client-react";
import { useStaffPush } from "./use-staff-push";

const SESSION_KEY = "staffSession";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface StoredSession {
  session: StaffSession;
  loginAt: number;
}

interface AuthContextType {
  session: StaffSession | null;
  sessionExpired: boolean;
  login: (session: StaffSession) => void;
  logout: () => void;
  pushEnabled: boolean;
  setPushEnabled: (val: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function loadSession(): { session: StaffSession | null; expired: boolean } {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { session: null, expired: false };
    const stored = JSON.parse(raw) as StoredSession;
    if (!stored.session || !stored.loginAt) {
      localStorage.removeItem(SESSION_KEY);
      return { session: null, expired: false };
    }
    if (Date.now() - stored.loginAt > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_KEY);
      return { session: null, expired: true };
    }
    return { session: stored.session, expired: false };
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return { session: null, expired: false };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initial = loadSession();
  const [session, setSession] = useState<StaffSession | null>(initial.session);
  const [sessionExpired, setSessionExpired] = useState<boolean>(initial.expired);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { pushEnabled, setPushEnabled } = useStaffPush(session !== null);

  const login = (newSession: StaffSession) => {
    const stored: StoredSession = { session: newSession, loginAt: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    setSession(newSession);
    setSessionExpired(false);
    setLocation("/guests");
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    queryClient.clear();
    setSession(null);
    setSessionExpired(false);
    setLocation("/");
  };

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!session) {
      setLocation("/");
    }
  }, [session, setLocation]);

  useEffect(() => {
    if (!session) return;
    const checkExpiry = () => {
      const result = loadSession();
      if (!result.session) {
        setSession(null);
        if (result.expired) setSessionExpired(true);
        setLocation("/");
      }
    };
    const interval = setInterval(checkExpiry, 60_000);
    return () => clearInterval(interval);
  }, [session, setLocation]);

  return (
    <AuthContext.Provider value={{ session, sessionExpired, login, logout, pushEnabled, setPushEnabled }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
