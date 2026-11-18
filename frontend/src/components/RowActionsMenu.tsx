import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

export interface RowAction {
  label: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  /** Shown greyed out with this explanation instead of being chosen. */
  disabledReason?: string;
  onSelect: () => void;
}

/**
 * A ⋮ button that opens a small menu of row actions. Portal-rendered so it is
 * never clipped by a scrolling or rounded container; closes on outside click,
 * Escape or choosing an item; arrow keys move between items.
 */
export function RowActionsMenu({
  label,
  title,
  actions,
}: {
  label: string;
  /** Heading shown at the top of the open menu (e.g. the row's name). */
  title?: string;
  actions: RowAction[];
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const height = menuRef.current?.offsetHeight ?? 100;
      const below = rect.bottom + 4;
      setPos({
        top: below + height > window.innerHeight ? rect.top - height - 4 : below,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-surface-bg hover:text-ink-900"
      >
        <MoreVertical aria-hidden className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              const items = [
                ...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []),
              ];
              const at = items.indexOf(document.activeElement as HTMLButtonElement);
              const next =
                (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }}
            style={{ top: pos?.top ?? -9999, right: pos?.right ?? -9999 }}
            className="fixed z-[70] min-w-[220px] rounded-xl border border-surface-border bg-surface-card p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
          >
            {title && (
              <div className="mb-1 border-b border-surface-border px-3 pb-2 pt-1.5">
                <div className="text-[10.5px] font-bold uppercase tracking-[.5px] text-ink-500">
                  Actions
                </div>
                <div className="mt-0.5 max-w-[240px] truncate text-[13px] font-semibold text-ink-900">
                  {title}
                </div>
              </div>
            )}
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                aria-disabled={action.disabledReason ? true : undefined}
                title={action.disabledReason}
                onClick={() => {
                  if (action.disabledReason) return;
                  setOpen(false);
                  action.onSelect();
                }}
                className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] outline-none ${action.disabledReason ? "cursor-not-allowed text-ink-500" : action.tone === "danger" ? "text-priority-red hover:bg-priority-red-tint focus-visible:bg-priority-red-tint" : "text-ink-900 hover:bg-brand-green-tint focus-visible:bg-brand-green-tint"}`}
              >
                <span className="mt-0.5 shrink-0">{action.icon}</span>
                <span>
                  {action.label}
                  {action.disabledReason && (
                    <span className="block text-[11.5px] text-ink-500">
                      {action.disabledReason}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
