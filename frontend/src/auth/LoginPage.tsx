import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { MfaChannel, MfaDeliveryMethod, TenantBranding } from "../lib/authApi";
import { useAuth } from "./useAuth";
import { LoginMfaStep } from "./steps/LoginMfaStep";
import { TenantDiscoveryStep } from "./steps/TenantDiscoveryStep";
import { TenantLoginStep } from "./steps/TenantLoginStep";

type LoginFlowState =
  | { step: "discovery" }
  | { step: "password"; email: string; tenant: TenantBranding | null }
  | {
      step: "otp";
      email: string;
      tenant: TenantBranding | null;
      otpToken: string;
      channel: MfaChannel;
      deliveryMethods: MfaDeliveryMethod[];
    };

/**
 * Returning-user login (docs/14-TENANT-BRANDED-LOGIN-UX.md, superseding the
 * plain single-form login in docs/05-AUTHENTICATION-FLOW.md §5.3): a work
 * email resolves the tenant and its branding, then the password and 2FA
 * screens render styled to that organization rather than a generic
 * CITRAMAC page. Mirrors AuthFlowController's shape (state machine, each
 * step server-validated) but for the returning-user path specifically.
 *
 * `startAtPlatformLogin` (from the `/login/platform-staff` route) skips the
 * discovery step entirely and starts on the password screen with no tenant
 * and an editable email field — the deliberate, low-visibility entry point
 * for platform staff (Super Admin and other organization=None accounts),
 * separate from the public "organisation not found" failure state. The
 * backend independently enforces that this path only succeeds for a real
 * organization=None account (see LoginView.post's `no_organization` check).
 */
export function LoginPage({
  startAtPlatformLogin = false,
}: { startAtPlatformLogin?: boolean } = {}) {
  const { login, loginVerifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = (location.state as { toast?: string } | null)?.toast;

  const [state, setState] = useState<LoginFlowState>(
    startAtPlatformLogin ? { step: "password", email: "", tenant: null } : { step: "discovery" },
  );

  switch (state.step) {
    case "discovery":
      return (
        <TenantDiscoveryStep
          toast={toast}
          onSuccess={(email, tenant) => setState({ step: "password", email, tenant })}
        />
      );

    case "password":
      return (
        <TenantLoginStep
          tenant={state.tenant}
          email={state.email}
          {...(startAtPlatformLogin
            ? { onEmailChange: (value: string) => setState({ ...state, email: value }) }
            : { onChangeEmail: () => setState({ step: "discovery" }) })}
          login={login}
          onSuccess={() => navigate("/", { replace: true })}
          onRequiresOtp={({ otpToken, channel, deliveryMethods }) =>
            setState({
              step: "otp",
              email: state.email,
              tenant: state.tenant,
              otpToken,
              channel: channel as MfaChannel,
              deliveryMethods: deliveryMethods as MfaDeliveryMethod[],
            })
          }
        />
      );

    case "otp":
      return (
        <LoginMfaStep
          otpToken={state.otpToken}
          channel={state.channel}
          deliveryMethods={state.deliveryMethods}
          verify={loginVerifyOtp}
          onSuccess={() => navigate("/", { replace: true })}
        />
      );
  }
}
