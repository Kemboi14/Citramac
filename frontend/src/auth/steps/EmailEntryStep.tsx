import { useState } from "react";
import { forgotPassword } from "../../lib/authApi";
import { ApiError } from "../../lib/apiClient";
import { AuthButton, AuthCard, AuthField } from "./AuthCard";

/**
 * Forgot-password entry point — docs/05-AUTHENTICATION-FLOW.md §5.3.
 * Deliberately always succeeds the same way whether or not the email
 * matches an account (see apps/accounts/auth_views.py ForgotPasswordView) —
 * this step never reveals which.
 */
export function EmailEntryStep({ onSuccess }: { onSuccess: (otpToken: string) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { otp_token } = await forgotPassword(email);
      onSuccess(otp_token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account email and we'll send a verification code if it's on file."
      onSubmit={handleSubmit}
      error={error}
    >
      <AuthField
        label="Email address"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@organization.co.ke"
      />
      <AuthButton disabled={isSubmitting}>{isSubmitting ? "Sending…" : "Send code"}</AuthButton>
    </AuthCard>
  );
}
