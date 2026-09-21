import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Check, Loader2 } from "lucide-react";
import { EyeIcon, EyeOffIcon, ShieldIcon } from "./icons";

/** Shared card/form chrome for every auth-flow screen — design tokens per docs/03-DESIGN-SYSTEM.md. */
export function AuthCard({
  title,
  description,
  onSubmit,
  children,
  error,
  footer,
}: {
  title: string;
  description?: string;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
  error?: string | null;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-bg px-4">
      <div className="w-full max-w-sm rounded-lg border border-surface-border bg-surface-card p-8 shadow-sm">
        <h1 className="font-display text-xl font-bold text-ink-900">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-ink-500">{description}</p>}
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          {children}
          {error && (
            <p
              role="alert"
              className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red"
            >
              {error}
            </p>
          )}
        </form>
        {footer && <div className="mt-4 text-sm text-ink-500">{footer}</div>}
      </div>
    </div>
  );
}

export function AuthField({
  label,
  icon,
  trailing,
  ...props
}: {
  label: string;
  icon?: ReactNode;
  trailing?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  if (!icon && !trailing) {
    return (
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
        {label}
        <input
          {...props}
          className="rounded-sm border border-surface-border bg-surface-card px-3 py-2 text-sm text-ink-900 outline-none transition-colors duration-150 focus:border-brand-green"
        />
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
      {label}
      <span className="relative flex items-center">
        {icon && (
          <span className="pointer-events-none absolute left-3 flex text-ink-400">{icon}</span>
        )}
        <input
          {...props}
          className={`h-[50px] w-full rounded-md border border-surface-border text-sm text-ink-900 outline-none focus:border-brand-green focus:ring-4 focus:ring-brand-green/10 ${
            icon ? "pl-10" : "pl-3"
          } ${trailing ? "pr-10" : "pr-3"}`}
        />
        {trailing && <span className="absolute right-2 flex">{trailing}</span>}
      </span>
    </label>
  );
}

/** Password input with a show/hide toggle — every mockup password field has one. */
export function PasswordField({
  label,
  ...props
}: { label: string; icon?: ReactNode } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>) {
  const [visible, setVisible] = useState(false);
  return (
    <AuthField
      {...props}
      label={label}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="grid h-7 w-7 place-items-center rounded text-ink-500 hover:text-ink-700"
        >
          {visible ? (
            <EyeOffIcon className="h-[17px] w-[17px]" />
          ) : (
            <EyeIcon className="h-[17px] w-[17px]" />
          )}
        </button>
      }
    />
  );
}

/**
 * The "Secure login powered by Citramac" / "Your data is secure and
 * encrypted" strip. `edgeClassName` supplies the negative margins that pull
 * it flush to the card's own edges — callers vary in padding, so there's no
 * one default that fits every card; pass it explicitly and put
 * `overflow-hidden` on the card so the strip inherits the card's rounding.
 */
export function SecureFooter({ label, edgeClassName }: { label: string; edgeClassName: string }) {
  return (
    <p
      className={`mt-7 flex items-center justify-center gap-2 bg-brand-green-tint px-4 py-4 text-[11px] font-medium text-ink-500 ${edgeClassName}`}
    >
      <ShieldIcon className="h-[15px] w-[15px] text-brand-green-dark" />
      {label}
    </p>
  );
}

export type AuthButtonStatus = "idle" | "loading" | "success" | "error";

/**
 * `status` is optional and defaults to "idle" (plain label, identical to the
 * old unanimated button) so every other caller in the auth flow keeps
 * rendering exactly as before. Steps that want the animated
 * spinner/checkmark/shake lifecycle (currently the OTP "Verify" screens)
 * pass their own idle/loading/success/error state in — same status-machine
 * shape as components/SaveButton.tsx, reused here rather than duplicated
 * since AuthButton can't own the async call itself (the step's <form
 * onSubmit> does, so Enter-to-submit keeps working).
 */
export function AuthButton({
  children,
  className,
  status = "idle",
  loadingLabel = "Verifying…",
  successLabel = "Verified",
  ...props
}: {
  children: ReactNode;
  className?: string;
  status?: AuthButtonStatus;
  loadingLabel?: ReactNode;
  successLabel?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const shake = status === "error" ? "animate-shake" : "";
  return (
    <button
      {...props}
      type={props.type ?? "submit"}
      disabled={props.disabled || status === "loading" || status === "success"}
      className={`relative flex min-h-[44px] w-full items-center justify-center gap-2.5 overflow-hidden rounded-md bg-brand-green px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-60 ${shake} ${className ?? ""}`}
    >
      <span
        className={`flex items-center gap-2.5 transition-all duration-200 ${
          status === "idle" || status === "error" ? "opacity-100" : "opacity-0"
        } ${status === "loading" || status === "success" ? "absolute" : ""}`}
      >
        {children}
      </span>
      <span
        className={`flex items-center gap-2 transition-all duration-200 ${
          status === "loading" ? "opacity-100" : "pointer-events-none absolute opacity-0"
        }`}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        {loadingLabel}
      </span>
      <span
        className={`flex items-center gap-2 transition-all duration-200 ${
          status === "success"
            ? "scale-100 opacity-100"
            : "pointer-events-none absolute scale-75 opacity-0"
        }`}
      >
        <Check className="h-4 w-4" />
        {successLabel}
      </span>
    </button>
  );
}
