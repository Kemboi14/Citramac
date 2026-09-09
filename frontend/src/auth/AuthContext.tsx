import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as authApi from "../lib/authApi";
import { ApiError } from "../lib/apiClient";
import { decodeAccessToken } from "../lib/jwt";
import { getMyProfile } from "../lib/myProfileApi";
import { AuthContext, type LoginOutcome } from "./authContextObject";

// Re-exported for existing consumers (e.g. steps/TenantLoginStep.tsx) — the
// type itself now lives in authContextObject.ts alongside the context, per
// react-refresh/only-export-components (this file exports only the
// `AuthProvider` component).
export type { LoginOutcome };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

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
    setAvatarUrl(null);
  }, [accessToken]);

  const claims = useMemo(
    () => (accessToken ? decodeAccessToken(accessToken) : null),
    [accessToken],
  );

  const refreshProfile = useCallback(async () => {
    if (!accessToken) return;
    try {
      const profile = await getMyProfile(accessToken);
      setAvatarUrl(profile.avatar);
    } catch {
      // Best-effort — a stale/missing avatar just means the initials
      // fallback shows instead, never worth surfacing as an app-wide error.
    }
  }, [accessToken]);

  useEffect(() => {
    // No "else clear avatarUrl" branch needed — it starts out `null` and
    // `logout()` already resets it explicitly on that transition.
    if (!accessToken) return;
    let ignore = false;
    getMyProfile(accessToken)
      .then((profile) => {
        if (!ignore) setAvatarUrl(profile.avatar);
      })
      .catch(() => {
        // Best-effort — see refreshProfile's own comment.
      });
    return () => {
      ignore = true;
    };
  }, [accessToken]);

  const value = useMemo(
    () => ({
      accessToken,
      claims,
      isLoading,
      login,
      loginVerifyOtp,
      logout,
      avatarUrl,
      refreshProfile,
    }),
    [accessToken, claims, isLoading, login, loginVerifyOtp, logout, avatarUrl, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
