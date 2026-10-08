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
    <div className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
      <div className="text-[13px] font-semibold text-ink-900">{title}</div>
      {children && <p className="max-w-md text-[12.5px] text-ink-500">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
