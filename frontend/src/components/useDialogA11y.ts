import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Dialogs can stack (a confirm opened over a drawer). Only the top-most one
// answers Esc and Tab, so a keypress never closes or traps the wrong layer.
const openDialogs: symbol[] = [];

/**
 * Keyboard behaviour every modal surface needs: focus moves into the dialog
 * when it opens, Tab stays inside it, Esc closes it, and focus returns to
 * whatever opened it. Attach the returned ref to the dialog's root element.
 */
export function useDialogA11y<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose?: () => void,
) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const id = Symbol("dialog");
    openDialogs.push(id);
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;

    const focusables = () =>
      node
        ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => el.getClientRects().length > 0,
          )
        : [];
    // Prefer the first form control or action over the header's close button.
    const items = focusables();
    const initial =
      items.find((el) => !el.hasAttribute("aria-label") || el.tagName !== "BUTTON") ?? items[0];
    (initial ?? node)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== id) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const tabbable = focusables();
      if (!tabbable.length) {
        event.preventDefault();
        return;
      }
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const index = openDialogs.indexOf(id);
      if (index >= 0) openDialogs.splice(index, 1);
      previous?.focus?.();
    };
  }, [open]);

  return ref;
}
