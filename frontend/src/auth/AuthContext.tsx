import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as authApi from "../lib/authApi";
import { ApiError } from "../lib/apiClient";
import { decodeAccessToken } from "../lib/jwt";
import { AuthContext, type LoginOutcome } from "./authContextObject";

// Re-exported for existing consumers (e.g. steps/TenantLoginStep.tsx) — the
// type itself now lives in authContextObject.ts alongside the context, per
// react-refresh/only-export-components (this file exports only the
// `AuthProvider` component).
export type { LoginOutcome };

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

  const login = useCallback(
    async (email: string, password: string, remember = false): Promise<LoginOutcome> => {
      const result = await authApi.login(email, password, remember);
      if ("access" in result) {
        setAccessToken(result.access);
        return { requiresOtp: false };
      }
      return {
        requiresOtp: true,
        otpToken: result.otp_token,
        channel: result.channel,
        deliveryMethods: result.delivery_methods,
      };
    },
    [],
  );

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
