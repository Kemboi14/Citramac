import type { ReactNode } from "react";
import { useAuth } from "../auth/useAuth";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function DashboardWelcome({
  eyebrow = "Dashboard",
  subtitle,
  children,
}: {
  eyebrow?: string;
  subtitle: ReactNode;
  children?: ReactNode;
}) {
  const { claims } = useAuth();
  const firstName = claims?.first_name.trim();

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-brand-green/15 bg-gradient-to-r from-brand-green/10 via-surface-card to-surface-card px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-6">
      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          {eyebrow}
        </div>
        <h1 className="font-display text-2xl font-bold text-ink-900 sm:text-[28px]">
          {greetingForHour(new Date().getHours())}
          {firstName && `, ${firstName}`}
        </h1>
        <div className="mt-1 text-[13px] text-ink-500">{subtitle}</div>
      </div>
      {children && <div className="flex flex-wrap gap-2 sm:justify-end">{children}</div>}
    </section>
  );
}
