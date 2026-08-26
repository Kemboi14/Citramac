import { useState } from "react";
import { tenantDiscovery, type TenantBranding } from "../../lib/authApi";
import { ApiError } from "../../lib/apiClient";
import { AuthButton, AuthField, SecureFooter } from "./AuthCard";
import { AlertTriangleIcon, ArrowRightIcon, MailIcon } from "./icons";

/**
 * Pre-login tenant discovery (docs/14-TENANT-BRANDED-LOGIN-UX.md) — a staff
 * member types their work email, the backend resolves their organization by
 * email domain, and the next step (TenantLoginStep) renders branded to that
 * tenant. One component covers both the normal and "unknown domain" visual
 * states from the mockups (citramac-tenant-discovery.html /
 * citramac-tenant-discovery-error.html) rather than two separate routes,
 * since they're the same form with a different result.
 */
export function TenantDiscoveryStep({
  onSuccess,
  initialEmail = "",
  toast,
}: {
  onSuccess: (email: string, tenant: TenantBranding) => void;
  initialEmail?: string;
  toast?: string | null;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFieldError(null);
    setNotFound(false);
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError("Please enter a valid email address.");
      return;
    }
    setIsSubmitting(true);
    try {
      const { tenant } = await tenantDiscovery(email.trim());
      onSuccess(email.trim(), tenant);
    } catch (err) {
      if (err instanceof ApiError && err.code === "TENANT_NOT_FOUND") {
        setNotFound(true);
      } else {
        setFieldError(err instanceof ApiError ? err.message : "Something went wrong.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-bg px-4 py-8">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-surface-border bg-surface-card px-11 pb-7 pt-11 shadow-md">
        <h1 className="text-center font-display text-[25px] font-semibold leading-tight text-ink-900">
          {notFound ? "We couldn't continue with the information provided." : "Welcome to CITRAMAC"}
        </h1>
        {!notFound && (
          <p className="mx-auto mt-3 max-w-[310px] text-center text-sm leading-relaxed text-ink-500">
            To continue, please enter your work email address.
          </p>
        )}

        {toast && !notFound && (
          <p
            role="status"
            className="mt-4 rounded-sm bg-brand-green-tint px-3 py-2 text-center text-sm text-brand-green-dark"
          >
            {toast}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-1">
          <AuthField
            label="Email Address"
            type="email"
            name="email"
            autoComplete="email"
            required
            icon={<MailIcon className="h-[17px] w-[17px]" />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@yourorganisation.co.ke"
            aria-invalid={fieldError || notFound ? "true" : undefined}
          />
          <p role="alert" className="min-h-[18px] text-[11px] text-status-red">
            {fieldError}
          </p>

          {notFound && (
            <div className="mb-2 flex items-start gap-2.5 rounded-md bg-status-red-tint px-3.5 py-3 text-xs leading-relaxed text-[#742018]">
              <AlertTriangleIcon className="mt-0.5 h-[17px] w-[17px] flex-shrink-0" />
              <span>
                <strong className="mb-0.5 block font-semibold text-[#631b15]">
                  We couldn&rsquo;t continue with the information provided.
                </strong>
                Please contact your organisation administrator.
              </span>
            </div>
          )}

          <AuthButton disabled={isSubmitting} className="mt-1 gap-3">
            {isSubmitting ? "Checking email..." : notFound ? "Try Again" : "Continue"}
            {!isSubmitting && <ArrowRightIcon className="h-[18px] w-[18px]" />}
          </AuthButton>
        </form>

        <div
          aria-hidden="true"
          className="my-5 flex items-center gap-3 text-xs text-ink-400 before:h-px before:flex-1 before:bg-surface-border after:h-px after:flex-1 after:bg-surface-border"
        >
          <span>or</span>
        </div>
        <a
          href="mailto:support@citramac.com"
          className="flex items-center justify-center gap-2 text-center text-xs text-ink-500 hover:text-brand-green-dark"
        >
          Need help? Contact your organisation administrator.
        </a>

        <SecureFooter label="Your data is secure and encrypted" edgeClassName="-mx-11 -mb-7" />
      </div>
    </div>
  );
}
