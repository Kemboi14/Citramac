import type { ReactNode } from "react";

/** A deliberate "nothing here" message, with an optional next step. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-sm font-semibold text-ink-900">{title}</div>
      {children && <p className="max-w-md text-[13px] leading-relaxed text-ink-500">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
