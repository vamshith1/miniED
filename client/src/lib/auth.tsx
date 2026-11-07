import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api, setUnauthorizedHandler, tokenStore } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: { name: string; email: string; password: string }) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    queryClient.clear(); // never show the previous user's data to the next one
  }, [queryClient]);

  // A saved token is checked on load. Only a 401 (expired or revoked) signs
  // the user out. If the server is unreachable or restarting, keep the token
  // and try again every 2 seconds instead.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
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
          if (err instanceof ApiError && err.status === 401) {
            logout();
            setLoading(false);
          } else {
            timer = setTimeout(check, 2000);
          }
        });
    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [logout]);

  const startSession = useCallback(
    (r: { token: string; user: User }) => {
      queryClient.clear();
      tokenStore.set(r.token);
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
      login: (email, password) => api.post<{ token: string; user: User }>("/auth/login", { email, password }).then(startSession),
      signup: (input) => api.post<{ token: string; user: User }>("/auth/signup", input).then(startSession),
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
