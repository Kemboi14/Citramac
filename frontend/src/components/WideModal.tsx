import { X } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Centered, wide modal for multi-section forms with a live summary sidebar
 * (Client Registration, Admission) — distinct from `Drawer.tsx`'s right-
 * docked panel, which is too narrow (max 460px) for this layout. Portal-
 * rendered for the same reason `Drawer` is (see its own doc comment): a
 * page wrapped in `animate-fade-in` becomes a containing block for
 * `position: fixed` descendants, which breaks a non-portaled overlay.
 */
export function WideModal({
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
  if (!open) return null;
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[80] bg-[rgba(14,30,26,0.42)] backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-5">
        <div className="flex max-h-[90vh] w-full max-w-[1120px] animate-scale-in flex-col overflow-hidden rounded-[14px] bg-surface-card shadow-md">
          <div className="flex items-start justify-between gap-4 border-b border-surface-border px-6 py-5">
            <div>
              <div className="font-display text-lg font-bold text-ink-900">{title}</div>
              {subtitle && <p className="mt-1 text-[12.5px] text-ink-500">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] border border-surface-border bg-white"
            >
              <X className="h-[15px] w-[15px]" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2.5 border-t border-surface-border px-6 py-4">
              {footer}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
