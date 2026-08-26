import { useState } from "react";
import type { LoginOutcome } from "../AuthContext";
import type { TenantBranding } from "../../lib/authApi";
import { ApiError } from "../../lib/apiClient";
import { AuthButton, PasswordField, SecureFooter } from "./AuthCard";
import { ArrowRightIcon, BuildingIcon, LockIcon, MailIcon } from "./icons";

/**
 * Tenant-branded password screen (citramac-tenant-login.html) — the split
 * panel takes its color from the resolved Organization.primary_color
 * (docs/14-TENANT-BRANDED-LOGIN-UX.md), scoped to this card only via the
 * --tenant-primary CSS var so it never leaks into the rest of the app's
 * green brand palette.
 */
export function TenantLoginStep({
  tenant,
  email,
  onChangeEmail,
  login,
  onSuccess,
  onRequiresOtp,
}: {
  tenant: TenantBranding;
  email: string;
  onChangeEmail: () => void;
  login: (email: string, password: string, remember: boolean) => Promise<LoginOutcome>;
  onSuccess: () => void;
  onRequiresOtp: (outcome: {
    otpToken: string;
    channel: string;
    deliveryMethods: { channel: string; masked_contact: string }[];
  }) => void;
}) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const supportEmail = tenant.support_email || "support@citramac.com";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    setIsSubmitting(true);
    try {
      const outcome = await login(email, password, remember);
      if (outcome.requiresOtp) {
        onRequiresOtp({
          otpToken: outcome.otpToken,
          channel: outcome.channel,
          deliveryMethods: outcome.deliveryMethods,
        });
      } else {
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-surface-bg px-4 py-8"
      style={{ "--tenant-primary": tenant.primary_color || "var(--green)" } as React.CSSProperties}
    >
      <div className="grid w-full max-w-[850px] overflow-hidden rounded-lg border border-black/[0.06] bg-surface-card shadow-md md:grid-cols-[minmax(230px,0.82fr)_minmax(320px,1.18fr)]">
        <aside className="flex min-h-[220px] flex-col items-center justify-center gap-4 bg-[var(--tenant-primary)] p-8 text-white md:min-h-[575px]">
          {tenant.logo_url ? (
            <img
              src={tenant.logo_url}
              alt={`${tenant.name} logo`}
              className="h-[160px] w-[160px] rounded-3xl bg-white object-contain p-4 md:h-[190px] md:w-[190px]"
            />
          ) : (
            <>
              <span className="grid h-[120px] w-[120px] place-items-center rounded-3xl bg-white/15">
                <BuildingIcon className="h-14 w-14" />
              </span>
              <p className="font-display text-lg font-semibold">{tenant.name}</p>
              {tenant.tagline && (
                <p className="max-w-[200px] text-center text-xs text-white/80">{tenant.tagline}</p>
              )}
            </>
          )}
        </aside>

        <div className="px-7 pb-7 pt-10 md:px-12 md:pt-12">
          <h1 className="font-display text-2xl font-semibold text-ink-900">
            Sign in to {tenant.name}
          </h1>
          <p className="mt-2.5 text-[13px] leading-relaxed text-ink-500">
            Access your organisation&rsquo;s platform to manage care and operations.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-[18px]">
            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink-700">Email</span>
                <button
                  type="button"
                  onClick={onChangeEmail}
                  className="text-[11px] font-medium text-[color:var(--tenant-primary)] hover:underline"
                >
                  Change
                </button>
              </div>
              <span className="relative flex items-center">
                <MailIcon className="pointer-events-none absolute left-3 h-[17px] w-[17px] text-ink-400" />
                <input
                  value={email}
                  disabled
                  className="h-[50px] w-full rounded-md border border-surface-border bg-surface-bg pl-10 pr-3 text-sm text-ink-700"
                />
              </span>
            </div>

            <PasswordField
              label="Password"
              name="password"
              autoComplete="current-password"
              required
              icon={<LockIcon className="h-[17px] w-[17px]" />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="flex items-center justify-between text-[11px]">
              <label className="flex items-center gap-2 font-normal text-ink-700">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-[15px] w-[15px] accent-[color:var(--tenant-primary)]"
                />
                Remember me
              </label>
              <a
                href="/forgot-password"
                className="font-medium text-[color:var(--tenant-primary)] hover:underline"
              >
                Forgot password?
              </a>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red"
              >
                {error}
              </p>
            )}

            <AuthButton
              disabled={isSubmitting}
              className="bg-[var(--tenant-primary)] hover:opacity-90"
            >
              {isSubmitting ? "Signing in..." : "Sign In"}
              {!isSubmitting && <ArrowRightIcon className="h-[18px] w-[18px]" />}
            </AuthButton>
          </form>

          <p className="mt-3 text-center text-[11px] text-ink-500">
            Need help?{" "}
            <a
              href={`mailto:${supportEmail}`}
              className="font-medium text-[color:var(--tenant-primary)] hover:underline"
            >
              Contact support
            </a>
          </p>

          <SecureFooter
            label="Secure login powered by Citramac"
            edgeClassName="-mx-7 -mb-7 md:-mx-12"
          />
        </div>
      </div>
    </div>
  );
}
