import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { MfaChannel, MfaDeliveryMethod, TenantBranding } from "../lib/authApi";
import { useAuth } from "./AuthContext";
import { LoginMfaStep } from "./steps/LoginMfaStep";
import { TenantDiscoveryStep } from "./steps/TenantDiscoveryStep";
import { TenantLoginStep } from "./steps/TenantLoginStep";

type LoginFlowState =
  | { step: "discovery" }
  | { step: "password"; email: string; tenant: TenantBranding }
  | {
      step: "otp";
      email: string;
      tenant: TenantBranding;
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
 */
export function LoginPage() {
  const { login, loginVerifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = (location.state as { toast?: string } | null)?.toast;

  const [state, setState] = useState<LoginFlowState>({ step: "discovery" });

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
