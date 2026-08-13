import { useState } from "react";
import { confirmEmail } from "../../lib/authApi";
import { ApiError } from "../../lib/apiClient";
import { AuthButton, AuthCard, AuthField } from "./AuthCard";

/** Screen B — docs/05-AUTHENTICATION-FLOW.md §5.2. */
export function EmailConfirmStep({
  activationToken,
  maskedEmail,
  onSuccess,
}: {
  activationToken: string;
  maskedEmail: string;
  onSuccess: (otpToken: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { otp_token } = await confirmEmail(activationToken, email);
      onSuccess(otp_token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Confirm your email"
      description={`Is this your email? We have ${maskedEmail} on file — type it in full to confirm.`}
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
      <AuthButton disabled={isSubmitting}>
        {isSubmitting ? "Sending code…" : "Send code"}
      </AuthButton>
    </AuthCard>
  );
}
