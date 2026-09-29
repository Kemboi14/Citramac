import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import * as authApi from "../lib/authApi";
import { ApiError, setSessionInvalidatedHandler } from "../lib/apiClient";
import { decodeAccessToken } from "../lib/jwt";
import { getMyProfile, type MyProfile } from "../lib/myProfileApi";
import { AuthContext, type LoginOutcome } from "./authContextObject";

// Re-exported for existing consumers (e.g. steps/TenantLoginStep.tsx) — the
// type itself now lives in authContextObject.ts alongside the context, per
// react-refresh/only-export-components (this file exports only the
// `AuthProvider` component).
export type { LoginOutcome };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [sessionEndedMessage, setSessionEndedMessage] = useState<string | null>(null);

  // On first load, a valid refresh_token cookie from a previous session
  // silently restores access — docs/05-AUTHENTICATION-FLOW.md §5.3.
  useEffect(() => {
    authApi
      .refresh()
      .then(({ access }) => setAccessToken(access))
      .catch(() => setAccessToken(null))
      .finally(() => setIsLoading(false));
  }, []);

  // apiClient has no React context of its own — this is how it tells us an
  // already-authenticated call came back with a session-ending error (see
  // SESSION_INVALIDATING_CODES there), from anywhere in the app, so the
  // user gets forced back to login with an explanation instead of silently
  // failing whatever page they were on.
  useEffect(() => {
    setSessionInvalidatedHandler((message) => {
      setAccessToken(null);
      setProfile(null);
      setSessionEndedMessage(message);
    });
    return () => setSessionInvalidatedHandler(null);
  }, []);

  const clearSessionEndedMessage = useCallback(() => setSessionEndedMessage(null), []);

  const login = useCallback(
    async (
      email: string,
      password: string,
      remember = false,
      noOrganization = false,
    ): Promise<LoginOutcome> => {
      const result = await authApi.login(email, password, remember, noOrganization);
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
    setProfile(null);
  }, [accessToken]);

  const claims = useMemo(
    () => (accessToken ? decodeAccessToken(accessToken) : null),
    [accessToken],
  );

  const refreshProfile = useCallback(async () => {
    if (!accessToken) return;
    try {
      setProfile(await getMyProfile(accessToken));
    } catch {
      // Best-effort — a stale/missing profile just means the initials
      // fallback and a loading organisation pill show instead, never worth
      // surfacing as an app-wide error.
    }
  }, [accessToken]);

  useEffect(() => {
    // No "else clear profile" branch needed — it starts out `null` and
    // `logout()` already resets it explicitly on that transition. Re-fetched
    // on every token change (each silent refresh too), so a branch or role
    // change made by an admin shows up without a fresh sign-in.
    if (!accessToken) return;
    let ignore = false;
    getMyProfile(accessToken)
      .then((fetched) => {
        if (!ignore) setProfile(fetched);
      })
      .catch(() => {
        // Best-effort — see refreshProfile's own comment.
      });
    return () => {
      ignore = true;
    };
  }, [accessToken]);

  const avatarUrl = profile?.avatar ?? null;

  const value = useMemo(
    () => ({
      accessToken,
      claims,
      isLoading,
      login,
      loginVerifyOtp,
      logout,
      avatarUrl,
      profile,
      refreshProfile,
      sessionEndedMessage,
      clearSessionEndedMessage,
    }),
    [
      accessToken,
      claims,
      isLoading,
      login,
      loginVerifyOtp,
      logout,
      avatarUrl,
      profile,
      refreshProfile,
      sessionEndedMessage,
      clearSessionEndedMessage,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
