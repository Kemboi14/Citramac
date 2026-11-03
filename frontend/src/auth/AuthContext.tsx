import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as authApi from "../lib/authApi";
import {
  ApiError,
  setSessionInvalidatedHandler,
  setTokenRefresher,
  type TokenRefreshResult,
} from "../lib/apiClient";
import { decodeAccessToken, type AccessTokenClaims } from "../lib/jwt";
import { getMyProfile, type MyProfile } from "../lib/myProfileApi";
import { ALL_BRANCHES, getWorkingBranch, setWorkingBranch } from "../lib/workingBranch";
import { AuthContext, type LoginOutcome, type ResumeAfterSignIn } from "./authContextObject";

// Re-exported for existing consumers (e.g. steps/TenantLoginStep.tsx) — the
// type itself now lives in authContextObject.ts alongside the context, per
// react-refresh/only-export-components (this file exports only the
// `AuthProvider` component).
export type { LoginOutcome };

// While someone is using the app, the session is renewed at most this often
// (each renewal mints a fresh access token and restarts the server-side
// session timeout, SecurityPolicy.session_timeout_minutes). With no
// activity nothing is renewed, so that timeout becomes what its name says:
// signed out after N minutes of inactivity, never in the middle of work.
const KEEPALIVE_EVERY_MS = 4 * 60 * 1000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

function inactivityMessage(firstName: string | undefined): string {
  const who = firstName?.trim() ? `${firstName.trim()}, you were` : "You were";
  return (
    `${who} signed out because there was no activity for a while. This keeps client ` +
    "records safe on an unattended screen. Sign in again to carry on where you left off."
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [sessionEndedMessage, setSessionEndedMessage] = useState<string | null>(null);
  const [sessionEndedEmail, setSessionEndedEmail] = useState<string | null>(null);
  const [resumeAfterSignIn, setResumeAfterSignIn] = useState<ResumeAfterSignIn | null>(null);

  const claimsRef = useRef<AccessTokenClaims | null>(null);
  // Stamped when a session starts (page load, sign-in) and on each renewal.
  const lastRefreshAtRef = useRef(0);
  const lastActivityAtRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<TokenRefreshResult> | null>(null);
  const loggingOutRef = useRef(false);

  // On first load, a valid refresh_token cookie from a previous session
  // silently restores access — docs/05-AUTHENTICATION-FLOW.md §5.3.
  useEffect(() => {
    authApi
      .refresh()
      .then(({ access }) => {
        // Opening or reloading the page is activity.
        lastRefreshAtRef.current = Date.now();
        lastActivityAtRef.current = Date.now();
        setAccessToken(access);
      })
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
      setWorkingBranch("");
      setSessionEndedMessage(message);
    });
    return () => setSessionInvalidatedHandler(null);
  }, []);

  const clearSessionEndedMessage = useCallback(() => {
    setSessionEndedMessage(null);
    setSessionEndedEmail(null);
  }, []);
  const clearResumeAfterSignIn = useCallback(() => setResumeAfterSignIn(null), []);

  // The session timed out (or its refresh cookie is gone): back to sign-in,
  // addressed by name, with their email filled in, and — if the same person
  // signs back in — returned to the page they were on. Unsaved typing on
  // that page is lost, which is why activity keeps the session alive below.
  const endSessionForInactivity = useCallback(() => {
    if (loggingOutRef.current) return;
    const current = claimsRef.current;
    setSessionEndedMessage(inactivityMessage(current?.first_name));
    setSessionEndedEmail(current?.email ?? null);
    setResumeAfterSignIn(
      current
        ? {
            userId: current.user_id,
            path: `${window.location.pathname}${window.location.search}${window.location.hash}`,
          }
        : null,
    );
    setAccessToken(null);
    setProfile(null);
    setWorkingBranch("");
  }, []);

  // One refresh at a time, shared by every caller. A 401 from /auth/refresh/
  // is retried once after a pause: another open tab may have just rotated
  // the shared refresh cookie, and the retry sends the one it wrote.
  // Network/server trouble is "unavailable", never a sign-out.
  const refreshAccessToken = useCallback((): Promise<TokenRefreshResult> => {
    if (!refreshInFlightRef.current) {
      refreshInFlightRef.current = (async (): Promise<TokenRefreshResult> => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const { access } = await authApi.refresh();
            lastRefreshAtRef.current = Date.now();
            setAccessToken(access);
            return { access };
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 401) return "unavailable";
            if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 400));
          }
        }
        return "expired";
      })().finally(() => {
        refreshInFlightRef.current = null;
      });
    }
    return refreshInFlightRef.current;
  }, []);

  // apiClient asks for a new token when a call is refused with 401. Renewed
  // only if someone has used the page since the last renewal, so background
  // polling on an unattended screen can't keep a session open forever.
  useEffect(() => {
    setTokenRefresher(async () => {
      if (lastActivityAtRef.current <= lastRefreshAtRef.current) return "expired";
      return refreshAccessToken();
    }, endSessionForInactivity);
    return () => setTokenRefresher(null, null);
  }, [refreshAccessToken, endSessionForInactivity]);

  // Activity keeps the session alive (see KEEPALIVE_EVERY_MS). If the renewal
  // reports the session already over, sign out now rather than on the next
  // save — that would lose whatever was just typed.
  useEffect(() => {
    if (!accessToken) return;
    const onActivity = () => {
      lastActivityAtRef.current = Date.now();
      if (Date.now() - lastRefreshAtRef.current < KEEPALIVE_EVERY_MS) return;
      void refreshAccessToken().then((result) => {
        if (result === "expired") endSessionForInactivity();
      });
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true, capture: true });
    }
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity, { capture: true });
      }
    };
  }, [accessToken, refreshAccessToken, endSessionForInactivity]);

  const login = useCallback(
    async (
      email: string,
      password: string,
      remember = false,
      noOrganization = false,
    ): Promise<LoginOutcome> => {
      const result = await authApi.login(email, password, remember, noOrganization);
      if ("access" in result) {
        lastRefreshAtRef.current = Date.now();
        lastActivityAtRef.current = Date.now();
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
    lastRefreshAtRef.current = Date.now();
    lastActivityAtRef.current = Date.now();
    setAccessToken(access);
  }, []);

  const logout = useCallback(async () => {
    // A deliberate sign-out is not a timeout: no "you were signed out"
    // message even if the logout call itself finds the session expired.
    loggingOutRef.current = true;
    try {
      if (accessToken) {
        try {
          await authApi.logout(accessToken);
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
        }
      }
    } finally {
      loggingOutRef.current = false;
    }
    setResumeAfterSignIn(null);
    setAccessToken(null);
    setProfile(null);
    setWorkingBranch("");
  }, [accessToken]);

  const claims = useMemo(
    () => (accessToken ? decodeAccessToken(accessToken) : null),
    [accessToken],
  );
  useEffect(() => {
    claimsRef.current = claims;
  }, [claims]);

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
        if (ignore) return;
        // A branch remembered from earlier that this user can't (or can no
        // longer) work in would make every request fail — fall back to the
        // server's default instead.
        const working = getWorkingBranch();
        const allowed =
          working === ALL_BRANCHES
            ? fetched.all_branches
            : fetched.branches.some((branch) => branch.id === working);
        if (working && !allowed) setWorkingBranch("");
        setProfile(fetched);
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
      sessionEndedEmail,
      clearSessionEndedMessage,
      resumeAfterSignIn,
      clearResumeAfterSignIn,
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
      sessionEndedEmail,
      clearSessionEndedMessage,
      resumeAfterSignIn,
      clearResumeAfterSignIn,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
