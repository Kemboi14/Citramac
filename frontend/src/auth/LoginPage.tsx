import { useEffect, useState } from "react";
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
 * Platform staff (Super Admin and other organization=None accounts) go
 * through the same discovery step as everyone else — TenantDiscoveryStep's
 * onSuccess fires with `tenant: null` for them (a real match, not a
 * failure; see TenantDiscoveryView's docstring), which the "password" case
 * below renders as generic platform branding. The backend independently
 * enforces that a `no_organization` login attempt only succeeds for a real
 * organization=None account (see LoginView.post).
 */
export function LoginPage() {
  const { login, loginVerifyOtp, sessionEndedMessage, clearSessionEndedMessage } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const routeToast = (location.state as { toast?: string } | null)?.toast;

  const [state, setState] = useState<LoginFlowState>({ step: "discovery" });

  // Captured once on mount so it survives the immediate clear below (which
  // exists so a *later*, unrelated visit to /login — e.g. after a normal
  // logout — doesn't still show a stale "you were signed out" message).
  const [sessionToast] = useState(sessionEndedMessage);
  useEffect(() => {
    if (sessionEndedMessage) clearSessionEndedMessage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toast = sessionToast ?? routeToast;

  switch (state.step) {
    case "discovery":
      return (
        <TenantDiscoveryStep
          toast={toast}
          toastVariant={sessionToast ? "warning" : "success"}
          onSuccess={(email, tenant) => setState({ step: "password", email, tenant })}
        />
      );

    case "password":
      return (
        <TenantLoginStep
          tenant={state.tenant}
          email={state.email}
          onChangeEmail={() => setState({ step: "discovery" })}
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
