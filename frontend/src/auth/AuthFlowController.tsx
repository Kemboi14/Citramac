import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { verifyOtp } from "../lib/authApi";
import { EmailConfirmStep } from "./steps/EmailConfirmStep";
import { EmailEntryStep } from "./steps/EmailEntryStep";
import { IdentifyStep } from "./steps/IdentifyStep";
import { OtpStep } from "./steps/OtpStep";
import { PasswordSetStep } from "./steps/PasswordSetStep";
import { AuthCard } from "./steps/AuthCard";

type FlowType = "ACTIVATION" | "RESET";

type FlowState =
  | { step: "identify" }
  | { step: "email_confirm"; maskedEmail: string }
  | { step: "email_entry" }
  | { step: "otp"; otpToken: string }
  | { step: "password_set"; passwordSetupToken: string }
  | { step: "done" };

/**
 * Orchestrates the finite state machine from docs/05-AUTHENTICATION-FLOW.md
 * §5.4: IDENTIFY -> EMAIL_CONFIRM -> OTP_PENDING -> OTP_VERIFIED ->
 * PASSWORD_SET -> DONE (redirect /login). `flowType` selects which entry
 * steps run — ACTIVATION uses identify+email-confirm (needs the invite's
 * activation_token); RESET collapses to a single email-entry step, since
 * apps.accounts.auth_views.ForgotPasswordView dispatches the OTP directly
 * (see EmailEntryStep) rather than a separate identify round-trip. Both
 * converge on the same OtpStep/PasswordSetStep, per the doc's intent that
 * those two are the shared, reused pieces.
 */
export function AuthFlowController({
  flowType,
  activationToken,
}: {
  flowType: FlowType;
  activationToken?: string;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<FlowState>(
    flowType === "ACTIVATION" ? { step: "identify" } : { step: "email_entry" },
  );

  if (flowType === "ACTIVATION" && !activationToken) {
    return (
      <AuthCard title="Invalid activation link" onSubmit={(e) => e.preventDefault()} error={null}>
        <p className="text-sm text-ink-500">
          This activation link is missing its token. Ask your Org Admin to resend the invite.
        </p>
      </AuthCard>
    );
  }

  switch (state.step) {
    case "identify":
      return (
        <IdentifyStep
          activationToken={activationToken!}
          onSuccess={(maskedEmail) => setState({ step: "email_confirm", maskedEmail })}
        />
      );

    case "email_confirm":
      return (
        <EmailConfirmStep
          activationToken={activationToken!}
          maskedEmail={state.maskedEmail}
          onSuccess={(otpToken) => setState({ step: "otp", otpToken })}
        />
      );

    case "email_entry":
      return <EmailEntryStep onSuccess={(otpToken) => setState({ step: "otp", otpToken })} />;

    case "otp":
      return (
        <OtpStep
          otpToken={state.otpToken}
          verify={verifyOtp}
          onSuccess={({ password_setup_token }) =>
            setState({ step: "password_set", passwordSetupToken: password_setup_token })
          }
        />
      );

    case "password_set":
      return (
        <PasswordSetStep
          passwordSetupToken={state.passwordSetupToken}
          onSuccess={() => setState({ step: "done" })}
        />
      );

    case "done":
      // Screen E — deliberately does not auto-login; redirect to standard login.
      navigate("/login", {
        replace: true,
        state: {
          toast:
            flowType === "ACTIVATION"
              ? "Account activated. Please sign in."
              : "Password reset. Please sign in.",
        },
      });
      return null;
  }
}
