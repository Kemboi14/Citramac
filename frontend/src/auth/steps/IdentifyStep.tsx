import { useState } from "react";
import { identify } from "../../lib/authApi";
import { ApiError } from "../../lib/apiClient";
import { AuthButton, AuthCard, AuthField } from "./AuthCard";

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
    setIsSubmitting(true);
    try {
      const { masked_email } = await identify(activationToken, name);
      onSuccess(masked_email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Welcome to CITRAMAC"
      description="Let's confirm it's you. Enter the full name your organization registered you with."
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
