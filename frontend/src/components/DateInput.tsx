import {
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Drop-in replacement for `<input type="date">`.
 *
 * The value is the same ISO "YYYY-MM-DD" string (or "") the native input
 * used, and `onChange` receives an event whose `target.value` is that string,
 * so callers written for the native input work unchanged. The date can be
 * typed as dd/mm/yyyy (or yyyy-mm-dd) or picked from a calendar with month
 * and year drop-downs, Today and Clear. Nothing is stored anywhere.
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayParts = () => {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
};

function validParts(y: number, m: number, d: number) {
  if (y < 1000 || y > 9999 || m < 0 || m > 11 || d < 1) return false;
  return d <= new Date(y, m + 1, 0).getDate();
}

/** ISO "YYYY-MM-DD" → parts, or null. */
function parseIso(value: string | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  return validParts(y, m, d) ? { y, m, d } : null;
}

/** What someone typed (dd/mm/yyyy, d-m-yyyy, dd.mm.yyyy or yyyy-mm-dd) → ISO, or null. */
function parseTyped(text: string): string | null {
  const trimmed = text.trim();
  if (parseIso(trimmed)) return trimmed;
  const match = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(trimmed);
  if (!match) return null;
  const [d, m, y] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  return validParts(y, m, d) ? toIso(y, m, d) : null;
}

const display = (iso: string | undefined) => {
  const p = parseIso(iso);
  return p ? `${pad(p.d)}/${pad(p.m + 1)}/${p.y}` : "";
};

export default function DateInput({
  value = "",
  onChange,
  min,
  max,
  disabled,
  readOnly,
  className,
  id,
  name,
  onBlur,
  onKeyDown,
  placeholder = "dd/mm/yyyy",
  ...rest
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const [draft, setDraft] = useState(display(value));
  const [open, setOpen] = useState(false);
  const selected = parseIso(value);
  const minParts = parseIso(typeof min === "string" ? min : undefined);
  const maxParts = parseIso(typeof max === "string" ? max : undefined);
  const start = selected ?? todayParts();
  const [view, setView] = useState({ y: start.y, m: start.m });
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Follow a value set from outside, without fighting someone mid-typing.
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    if (parseTyped(draft) !== value) setDraft(display(value));
  }

  const emit = (iso: string) => {
    if (iso === value) return;
    const target = { value: iso, name: name ?? "", id: id ?? "" };
    onChange?.({ target, currentTarget: target } as unknown as ChangeEvent<HTMLInputElement>);
  };

  const outOfRange = (iso: string) =>
    (typeof min === "string" && min && iso < min) || (typeof max === "string" && max && iso > max);

  const openCalendar = () => {
    if (disabled || readOnly) return;
    const s = selected ?? todayParts();
    setView({ y: s.y, m: s.m });
    setOpen(true);
  };

  // Position the calendar under the field (above it when there is no room),
  // in a portal so drawers and scrolling panels never clip it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 296;
      const height = popRef.current?.offsetHeight ?? 340;
      const below = rect.bottom + 6;
      const top =
        below + height > window.innerHeight && rect.top - height - 6 > 0
          ? rect.top - height - 6
          : below;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPos({ top, left });
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
      const t = event.target as Node;
      if (!wrapRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (iso: string) => {
    emit(iso);
    setDraft(display(iso));
    setOpen(false);
    inputRef.current?.focus();
  };

  const shiftMonth = (delta: number) =>
    setView(({ y, m }) => {
      const next = new Date(y, m + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });

  const today = todayParts();
  const todayIso = toIso(today.y, today.m, today.d);
  const firstYear = minParts?.y ?? Math.min(1900, view.y);
  const lastYear = maxParts?.y ?? Math.max(today.y + 20, view.y);
  const years: number[] = [];
  for (let y = lastYear; y >= firstYear; y--) years.push(y);

  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = document.activeElement as HTMLElement | null;
    const day = Number(current?.dataset.day);
    if (!day) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key] ?? 0;
    if (!step) return;
    event.preventDefault();
    const next = new Date(view.y, view.m, day + step);
    setView({ y: next.getFullYear(), m: next.getMonth() });
    requestAnimationFrame(() =>
      popRef.current?.querySelector<HTMLButtonElement>(`[data-day="${next.getDate()}"]`)?.focus(),
    );
  };

  const navBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-surface-bg disabled:opacity-40";
  const selectCls =
    "rounded-lg border border-surface-border bg-surface-card px-2 py-1 text-[13px] font-semibold text-ink-900 outline-none focus:border-brand-green";

  return (
    <div ref={wrapRef} className="relative w-full min-w-0">
      <input
        {...rest}
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        className={`${className ?? ""} !pr-10`}
        value={draft}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (!text.trim()) emit("");
          else {
            const iso = parseTyped(text);
            if (iso && !outOfRange(iso)) emit(iso);
          }
        }}
        onBlur={(event) => {
          // An unfinished or impossible date falls back to the last real one.
          if (draft.trim() && parseTyped(draft) !== value) setDraft(display(value));
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && event.altKey) {
            event.preventDefault();
            openCalendar();
          } else if (event.key === "Escape") setOpen(false);
          onKeyDown?.(event);
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Choose date"
        disabled={disabled || readOnly}
        onClick={() => (open ? setOpen(false) : openCalendar())}
        className="absolute inset-y-0 right-1 my-auto flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-surface-bg hover:text-ink-900 disabled:opacity-40"
      >
        <CalendarDays aria-hidden size={17} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={dialogId}
            role="dialog"
            aria-label="Choose date"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                inputRef.current?.focus();
              }
            }}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="fixed z-[1000] w-[296px] rounded-xl border border-surface-border bg-surface-card p-3 shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
          >
            <div className="mb-2 flex items-center justify-between gap-1">
              <button
                type="button"
                aria-label="Previous month"
                className={navBtn}
                disabled={!!minParts && view.y * 12 + view.m <= minParts.y * 12 + minParts.m}
                onClick={() => shiftMonth(-1)}
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
              <div className="flex gap-1">
                <select
                  aria-label="Month"
                  className={selectCls}
                  value={view.m}
                  onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))}
                >
                  {MONTHS.map((label, index) => (
                    <option key={label} value={index}>
                      {label.slice(0, 3)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Year"
                  className={selectCls}
                  value={view.y}
                  onChange={(e) => setView((v) => ({ ...v, y: Number(e.target.value) }))}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                aria-label="Next month"
                className={navBtn}
                disabled={!!maxParts && view.y * 12 + view.m >= maxParts.y * 12 + maxParts.m}
                onClick={() => shiftMonth(1)}
              >
                <ChevronRight size={18} aria-hidden />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center" onKeyDown={onGridKey}>
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1 text-[11px] font-semibold uppercase text-ink-500">
                  {w}
                </div>
              ))}
              {cells.map((day, index) => {
                if (day === null) return <div key={`blank-${index}`} />;
                const iso = toIso(view.y, view.m, day);
                const isSelected = iso === value;
                const isToday = iso === todayIso;
                const blocked = !!outOfRange(iso);
                return (
                  <button
                    key={iso}
                    type="button"
                    data-day={day}
                    disabled={blocked}
                    aria-pressed={isSelected}
                    aria-label={`${day} ${MONTHS[view.m]} ${view.y}`}
                    autoFocus={isSelected || (!selected && isToday)}
                    onClick={() => choose(iso)}
                    className={[
                      "h-9 rounded-lg text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-green",
                      isSelected
                        ? "bg-brand-green font-semibold text-on-primary"
                        : isToday
                          ? "font-semibold text-brand-green-dark ring-1 ring-brand-green hover:bg-brand-green-tint"
                          : "text-ink-900 hover:bg-brand-green-tint",
                      blocked ? "cursor-not-allowed !text-ink-300 hover:!bg-transparent" : "",
                    ].join(" ")}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-surface-border pt-2">
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-[13px] font-semibold text-ink-700 hover:bg-surface-bg"
                onClick={() => choose("")}
              >
                Clear
              </button>
              <button
                type="button"
                disabled={!!outOfRange(todayIso)}
                className="rounded-lg px-2 py-1 text-[13px] font-semibold text-brand-green-dark hover:bg-brand-green-tint disabled:opacity-40"
                onClick={() => choose(todayIso)}
              >
                Today
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
