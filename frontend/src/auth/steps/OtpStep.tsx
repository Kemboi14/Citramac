import { useEffect, useState } from "react";
import { resendOtp } from "../../lib/authApi";
import { ApiError } from "../../lib/apiClient";
import { AuthButton, AuthCard, AuthField } from "./AuthCard";

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Screen C — docs/05-AUTHENTICATION-FLOW.md §5.2. Shared across activation,
 * password reset, and login 2FA (§5.3: "reusing the Screen C component") —
 * the caller supplies which backend call actually verifies the code.
 */
export function OtpStep<T>({
  otpToken: initialOtpToken,
  verify,
  onSuccess,
}: {
  otpToken: string;
  verify: (otpToken: string, otp: string) => Promise<T>;
  onSuccess: (result: T) => void;
}) {
  const [otpToken, setOtpToken] = useState(initialOtpToken);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await verify(otpToken, otp);
      onSuccess(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    try {
      const { otp_token } = await resendOtp(otpToken);
      setOtpToken(otp_token);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resend the code.");
    }
  };

  return (
    <AuthCard
      title="Enter your code"
      description="We sent a 6-digit code to your email. It expires in 10 minutes."
      onSubmit={handleSubmit}
      error={error}
      footer={
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0}
          className="font-medium text-brand-green hover:underline disabled:cursor-not-allowed disabled:text-ink-400 disabled:no-underline"
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
      }
    >
      <AuthField
        label="6-digit code"
        name="otp"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="123456"
      />
      <AuthButton disabled={isSubmitting || otp.length !== 6}>
        {isSubmitting ? "Verifying…" : "Verify"}
      </AuthButton>
    </AuthCard>
  );
}
