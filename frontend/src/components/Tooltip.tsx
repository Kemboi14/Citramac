import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const GAP = 8; // space between the trigger and the bubble, the pointer sits in it
const EDGE = 8; // keep the bubble this far from the window edge
const DELAY = 120;
const BG = "bg-[#1f2328]";

type Place = { top: number; left: number; arrow: number; side: "below" | "above" };

/** The dark label with its pointer, placed against `anchor` (below, or above
 * when there is no room) and kept inside the window. Drawn in a portal so a
 * scrolling card or table cannot clip it. */
function Bubble({
  id,
  label,
  anchor,
}: {
  id: string;
  label: ReactNode;
  anchor: () => DOMRect | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);

  useLayoutEffect(() => {
    const trigger = anchor();
    const bubble = ref.current?.getBoundingClientRect();
    if (!trigger || !bubble) return;
    const centre = trigger.left + trigger.width / 2;
    const left = Math.min(
      Math.max(EDGE, centre - bubble.width / 2),
      window.innerWidth - bubble.width - EDGE,
    );
    const below = trigger.bottom + GAP + bubble.height <= window.innerHeight - EDGE;
    setPlace({
      top: below ? trigger.bottom + GAP : trigger.top - GAP - bubble.height,
      left,
      arrow: Math.min(Math.max(10, centre - left), bubble.width - 10),
      side: below ? "below" : "above",
    });
  }, [anchor, label]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={{
        top: place?.top ?? -9999,
        left: place?.left ?? -9999,
        visibility: place ? "visible" : "hidden",
      }}
      className={`pointer-events-none fixed z-[90] max-w-[280px] whitespace-pre-line rounded-md ${BG} px-2.5 py-1.5 text-[12.5px] font-medium leading-snug text-white shadow-lg motion-safe:animate-fade-in`}
    >
      {label}
      <span
        aria-hidden
        style={{ left: (place?.arrow ?? 0) - 5 }}
        className={`absolute h-2.5 w-2.5 rotate-45 ${BG} ${
          place?.side === "above" ? "-bottom-[5px]" : "-top-[5px]"
        }`}
      />
    </div>,
    document.body,
  );
}

/** Close on Escape and on any scroll while open. */
function useDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);
}

/**
 * A tooltip around one element: shown on hover and on keyboard focus, with
 * the hand cursor, and read by screen readers as that element's description.
 * Plain `title` attributes get the same tooltip from <GlobalTooltips />.
 */
export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [close] = useState(() => () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  });
  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), DELAY);
  };
  const [anchor] = useState(() => () => triggerRef.current?.getBoundingClientRect() ?? null);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useDismiss(open, close);

  return (
    <span
      ref={triggerRef}
      className="inline-flex cursor-pointer"
      onMouseEnter={show}
      onMouseLeave={close}
      onFocus={show}
      onBlur={close}
    >
      {/* The description goes on the focusable element itself, so screen readers hear it. */}
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
            "aria-describedby": open ? id : undefined,
          })
        : children}
      {open && <Bubble id={id} label={label} anchor={anchor} />}
    </span>
  );
}

const TIP = "data-tip";

/** The element whose tooltip applies, or null. Disabled controls keep the
 * browser's own tooltip: most browsers send them no hover events. */
function tipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>(`[title]:not(iframe), [${TIP}]`);
  if (!el || el.matches(":disabled")) return null;
  return el;
}

/**
 * Mounted once at the root: every element with a `title` shows this
 * tooltip instead of the browser's, with the hand cursor (index.css), on
 * hover and on keyboard focus. The title moves to `data-tip` while in use so
 * the browser's own box does not appear too; an element named only by its
 * title (an icon button) keeps that name as its aria-label.
 */
export function GlobalTooltips() {
  const id = useId();
  const [tip, setTip] = useState<{ el: HTMLElement; label: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [close] = useState(() => () => {
    window.clearTimeout(timer.current);
    setTip(null);
  });

  useEffect(() => {
    const open = (el: HTMLElement) => {
      const title = el.getAttribute("title");
      if (title !== null) {
        if (!el.getAttribute("aria-label") && !el.textContent?.trim() && title) {
          el.setAttribute("aria-label", title);
        }
        el.setAttribute(TIP, title);
        el.removeAttribute("title");
      }
      const label = el.getAttribute(TIP) ?? "";
      window.clearTimeout(timer.current);
      if (!label.trim()) return setTip(null);
      timer.current = window.setTimeout(() => setTip({ el, label }), DELAY);
    };
    const over = (event: Event) => {
      const el = tipTarget(event.target);
      if (el) open(el);
    };
    const out = (event: Event) => {
      const el = tipTarget(event.target);
      const to = (event as MouseEvent | FocusEvent).relatedTarget;
      if (el && !(to instanceof Node && el.contains(to))) close();
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", out);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", out);
      window.clearTimeout(timer.current);
    };
  }, [close]);

  useDismiss(Boolean(tip), close);

  // Screen readers hear the tooltip as the element's description while it shows.
  useEffect(() => {
    if (!tip) return;
    const el = tip.el;
    const before = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", before ? `${before} ${id}` : id);
    return () => {
      if (before === null) el.removeAttribute("aria-describedby");
      else el.setAttribute("aria-describedby", before);
    };
  }, [tip, id]);

  const anchor = useMemo(() => {
    const el = tip?.el;
    return () => (el?.isConnected ? el.getBoundingClientRect() : null);
  }, [tip]);
  return tip ? <Bubble id={id} label={tip.label} anchor={anchor} /> : null;
}
