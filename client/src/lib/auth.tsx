import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api, setUnauthorizedHandler } from "./api";
import type { User } from "./types";

/**
 * The session is an httpOnly cookie set by the server: this code never sees
 * the token. It only keeps track of who is signed in.
 */
interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: { name: string; email: string; password: string }) => Promise<User>;
  logout: () => void;
  // After a password change the server sets a fresh cookie; this updates the user.
  replaceSession: (r: { user: User }) => void;
}

const AuthContext = createContext<AuthState | null>(null);

// Sessions used to be stored in localStorage. Remove any leftover token.
try {
  localStorage.removeItem("miniedcrm.token");
} catch {
  /* storage unavailable */
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Forget the signed-in user locally (the server already rejected the session,
  // or logout just cleared it).
  const forget = useCallback(() => {
    setUser(null);
    queryClient.clear(); // never show the previous user's data to the next one
  }, [queryClient]);

  const logout = useCallback(() => {
    api.post("/auth/logout").catch(() => {}); // clears the cookie; nothing to do if it fails
    forget();
  }, [forget]);

  // On load, ask the server who we are. A 401 means signed out. If the server
  // is unreachable or restarting, keep trying every 2 seconds instead of
  // treating that as signed out.
  useEffect(() => {
    setUnauthorizedHandler(forget);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = () =>
      api
        .get<{ user: User }>("/auth/me")
        .then((r) => {
          if (cancelled) return;
          setUser(r.user);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof ApiError && err.status === 401) setLoading(false);
          else timer = setTimeout(check, 2000);
        });
    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [forget]);

  const startSession = useCallback(
    (r: { user: User }) => {
      queryClient.clear();
      setUser(r.user);
      return r.user;
    },
    [queryClient],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      logout,
      replaceSession: (r) => setUser(r.user),
      login: (email, password) => api.post<{ user: User }>("/auth/login", { email, password }).then(startSession),
      signup: (input) => api.post<{ user: User }>("/auth/signup", input).then(startSession),
    }),
    [user, loading, logout, startSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// For pages that only render once signed in.
export function useUser() {
  const { user } = useAuth();
  if (!user) throw new Error("useUser called while signed out");
  return user;
}

export const homePathFor = (role: User["role"]) => (role === "ADMIN" ? "/dashboard" : role === "MENTOR" ? "/batches" : "/home");
