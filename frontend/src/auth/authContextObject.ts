import { createContext } from "react";
import type { AccessTokenClaims } from "../lib/jwt";
import type { MfaChannel, MfaDeliveryMethod } from "../lib/authApi";

export type LoginOutcome =
  | { requiresOtp: false }
  | {
      requiresOtp: true;
      otpToken: string;
      channel: MfaChannel;
      deliveryMethods: MfaDeliveryMethod[];
    };

export interface AuthContextValue {
  accessToken: string | null;
  claims: AccessTokenClaims | null;
  isLoading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<LoginOutcome>;
  loginVerifyOtp: (otpToken: string, otp: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Current user's uploaded profile picture, if any — null until fetched
   * or if never set. Not carried on the JWT (avatars can change without a
   * re-login), see `apps.accounts.views.MyProfileView`. */
  avatarUrl: string | null;
  /** Re-fetches the current user's profile (e.g. right after an avatar
   * upload elsewhere in the app) so every avatar on screen updates. */
  refreshProfile: () => Promise<void>;
}

// Split from AuthContext.tsx (the `AuthProvider` component) and useAuth.ts
// (the hook) into its own module — a file exporting a React context alongside
// a component or hook breaks Fast Refresh (react-refresh/only-export-components).
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
