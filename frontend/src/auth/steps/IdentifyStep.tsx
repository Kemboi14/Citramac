import { useState } from "react";
import { identify } from "../../lib/authApi";
import { ApiError } from "../../lib/apiClient";
import { AuthButton, AuthCard, AuthField } from "./AuthCard";

/** The backend returns the same IDENTITY_NOT_CONFIRMED for a wrong name and
 *  for an expired or used invitation (no enumeration), so this names both
 *  without saying which. */
const NOT_CONFIRMED_HELP =
  "We couldn't confirm those details. Enter your first and last name exactly as your organization registered you, or your staff ID. If it still doesn't work, the invitation may have expired or already been used. Ask your administrator to check your name and resend it.";

const EMAIL_IN_NAME_HELP =
  "That looks like an email address. Enter your full name here (e.g. Judy Mwikali). You'll confirm your email on the next step.";

/** Screen A — docs/05-AUTHENTICATION-FLOW.md §5.2. */
export function IdentifyStep({
  activationToken,
  onSuccess,
}: {
  activationToken: string;
  onSuccess: (maskedEmail: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (name.includes("@")) {
      setError(EMAIL_IN_NAME_HELP);
      return;
    }
    setIsSubmitting(true);
    try {
      const { masked_email } = await identify(activationToken, name);
      onSuccess(masked_email);
    } catch (err) {
      if (err instanceof ApiError && err.code === "IDENTITY_NOT_CONFIRMED") {
        setError(NOT_CONFIRMED_HELP);
      } else {
        setError(err instanceof ApiError ? err.message : "Something went wrong.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Welcome to CITRAMAC"
      description="Let's confirm it's you. Enter your full name as your organization registered you (not your email — that comes next)."
      onSubmit={handleSubmit}
      error={error}
    >
      <AuthField
        label="Full name"
        name="name"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Judy Mwikali"
      />
      <AuthButton disabled={isSubmitting}>{isSubmitting ? "Checking…" : "Continue"}</AuthButton>
    </AuthCard>
  );
}
