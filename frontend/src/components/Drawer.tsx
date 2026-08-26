import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Slide-in side panel — citramac_SUPER-ADMIN.html `.drawer` / `.overlay`. */
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <div
        className={`fixed inset-0 z-[80] bg-[rgba(14,30,26,0.4)] backdrop-blur-[1px] transition-opacity duration-200 ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed right-0 top-0 z-[90] flex h-screen w-full max-w-[92vw] flex-col bg-surface-card shadow-md transition-transform duration-[250ms] ease-[cubic-bezier(0.4,0,0.2,1)] sm:max-w-[460px] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-5">
          <div>
            <div className="font-display text-[17px] font-bold text-ink-900">{title}</div>
            {subtitle && <div className="mt-0.5 text-xs text-ink-500">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] border border-surface-border bg-surface-card"
          >
            <X className="h-[15px] w-[15px]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-[22px]">{children}</div>
        {footer && (
          <div className="flex gap-2.5 border-t border-surface-border px-6 py-4">{footer}</div>
        )}
      </aside>
    </>
  );
}
