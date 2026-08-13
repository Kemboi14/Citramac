import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import { useAuth } from "./AuthContext";
import { AuthButton, AuthCard, AuthField } from "./steps/AuthCard";
import { OtpStep } from "./steps/OtpStep";

/** Standard returning-user login, with optional 2FA — docs/05-AUTHENTICATION-FLOW.md §5.3. */
export function LoginPage() {
  const { login, loginVerifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = (location.state as { toast?: string } | null)?.toast;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otpToken, setOtpToken] = useState<string | null>(null);

  if (otpToken) {
    return (
      <OtpStep
        otpToken={otpToken}
        verify={loginVerifyOtp}
        onSuccess={() => navigate("/", { replace: true })}
      />
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const outcome = await login(email, password);
      if (outcome.requiresOtp) {
        setOtpToken(outcome.otpToken);
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Sign in to CITRAMAC"
      onSubmit={handleSubmit}
      error={error ?? (toast ? null : undefined)}
      footer={
        <Link to="/forgot-password" className="font-medium text-brand-green hover:underline">
          Forgot password?
        </Link>
      }
    >
      {toast && !error && (
        <p
          role="status"
          className="rounded-sm bg-brand-green-tint px-3 py-2 text-sm text-brand-green-dark"
        >
          {toast}
        </p>
      )}
      <AuthField
        label="Email or Staff ID"
        name="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <AuthField
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <AuthButton disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</AuthButton>
    </AuthCard>
  );
}
