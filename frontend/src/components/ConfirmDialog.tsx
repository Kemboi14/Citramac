import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { useDialogA11y } from "./useDialogA11y";

/**
 * Small centered confirmation dialog for consequential one-click actions
 * (archiving a tenant, marking the retention floor verified). Portal-
 * rendered for the same reason `Drawer`/`WideModal` are — a page wrapped in
 * `animate-fade-in` becomes a containing block for `position: fixed`
 * descendants — and stacked above both (z-[100]/[110]) so it can be opened
 * from inside an open drawer.
 *
 * `onConfirm` owns the actual work; the dialog stays open while `busy` and
 * shows `error` inline so a refused request (e.g. a 400/403 from the API)
 * is visible where the user acted, not behind the dialog.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel = "Working…",
  tone = "primary",
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialogA11y(open, busy ? undefined : onCancel);
  if (!open) return null;
  const confirmClass =
    tone === "danger"
      ? "bg-status-red text-on-status hover:opacity-90"
      : "bg-brand-green text-on-primary hover:bg-brand-green-dark";

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[100] bg-surface-scrim backdrop-blur-[1px]"
        onClick={busy ? undefined : onCancel}
      />
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-5">
        <div
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          className="flex w-full max-w-[480px] animate-scale-in flex-col overflow-hidden rounded-[14px] bg-surface-card shadow-md"
        >
          <div className="flex items-start justify-between gap-4 border-b border-surface-border px-6 py-5">
            <div id="confirm-dialog-title" className="font-display text-lg font-bold text-ink-900">
              {title}
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              aria-label="Close"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] border border-surface-border bg-surface-card disabled:opacity-60"
            >
              <X className="h-[15px] w-[15px]" />
            </button>
          </div>
          <div className="flex flex-col gap-3 px-6 py-5 text-sm text-ink-700">
            {children}
            {error && (
              <p className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
                {error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2.5 border-t border-surface-border px-6 py-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-md border border-surface-border px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-surface-bg disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-all duration-150 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100 ${confirmClass}`}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
