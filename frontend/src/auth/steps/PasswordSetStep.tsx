import { useState } from "react";
import { setPassword } from "../../lib/authApi";
import { ApiError } from "../../lib/apiClient";
import { AuthButton, AuthCard, AuthField } from "./AuthCard";

const REQUIREMENTS = "At least 12 characters, with upper, lower, a digit, and a symbol.";

/** Screen D — docs/05-AUTHENTICATION-FLOW.md §5.2. Does not auto-login (Screen E redirects to /login instead). */
export function PasswordSetStep({
  passwordSetupToken,
  onSuccess,
}: {
  passwordSetupToken: string;
  onSuccess: () => void;
}) {
  const [password, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    // Not a secret comparison — both values were just typed into this form
    // by the same person; there's nothing to time-leak.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setIsSubmitting(true);
    try {
      await setPassword(passwordSetupToken, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Create your password"
      description={REQUIREMENTS}
      onSubmit={handleSubmit}
      error={error}
    >
      <AuthField
        label="New password"
        type="password"
        name="password"
        autoComplete="new-password"
        required
        minLength={12}
        value={password}
        onChange={(e) => setPasswordValue(e.target.value)}
      />
      <AuthField
        label="Confirm password"
        type="password"
        name="confirmPassword"
        autoComplete="new-password"
        required
        minLength={12}
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      <AuthButton disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Set password"}</AuthButton>
    </AuthCard>
  );
}
