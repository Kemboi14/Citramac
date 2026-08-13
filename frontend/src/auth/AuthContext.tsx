import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as authApi from "../lib/authApi";
import { ApiError } from "../lib/apiClient";
import { decodeAccessToken, type AccessTokenClaims } from "../lib/jwt";

export type LoginOutcome = { requiresOtp: false } | { requiresOtp: true; otpToken: string };

interface AuthContextValue {
  accessToken: string | null;
  claims: AccessTokenClaims | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  loginVerifyOtp: (otpToken: string, otp: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On first load, a valid refresh_token cookie from a previous session
  // silently restores access — docs/05-AUTHENTICATION-FLOW.md §5.3.
  useEffect(() => {
    authApi
      .refresh()
      .then(({ access }) => setAccessToken(access))
      .catch(() => setAccessToken(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginOutcome> => {
    const result = await authApi.login(email, password);
    if ("access" in result) {
      setAccessToken(result.access);
      return { requiresOtp: false };
    }
    return { requiresOtp: true, otpToken: result.otp_token };
  }, []);

  const loginVerifyOtp = useCallback(async (otpToken: string, otp: string) => {
    const { access } = await authApi.loginVerifyOtp(otpToken, otp);
    setAccessToken(access);
  }, []);

  const logout = useCallback(async () => {
    if (accessToken) {
      try {
        await authApi.logout(accessToken);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }
    setAccessToken(null);
  }, [accessToken]);

  const claims = useMemo(
    () => (accessToken ? decodeAccessToken(accessToken) : null),
    [accessToken],
  );

  const value = useMemo(
    () => ({ accessToken, claims, isLoading, login, loginVerifyOtp, logout }),
    [accessToken, claims, isLoading, login, loginVerifyOtp, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
