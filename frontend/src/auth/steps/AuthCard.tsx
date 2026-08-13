import type { FormEvent, ReactNode } from "react";

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
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-700">
      {label}
      <input
        {...props}
        className="rounded-sm border border-surface-border px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-green"
      />
    </label>
  );
}

export function AuthButton({
  children,
  ...props
}: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type={props.type ?? "submit"}
      className="rounded-md bg-brand-green px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
