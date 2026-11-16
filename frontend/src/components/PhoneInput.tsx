import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";

/**
 * Phone number in international format: a country picker (flag + dialling
 * code) beside the number. The value is E.164 ("+254712345678") or "".
 *
 * Kenya is the default. Typing or pasting a number that starts with "+" or
 * "00" picks the country from its dialling code; a leading trunk "0"
 * ("0712 345 678") is dropped, so every common way of writing a number ends
 * up the same. A stored number in any of those forms is read the same way.
 */
interface Country {
  iso: string;
  name: string;
  dial: string;
  /** Digits after the dialling code, when the country uses one fixed length. */
  length?: number;
}

export const COUNTRIES: Country[] = [
  { iso: "KE", name: "Kenya", dial: "254", length: 9 },
  { iso: "UG", name: "Uganda", dial: "256", length: 9 },
  { iso: "TZ", name: "Tanzania", dial: "255", length: 9 },
  { iso: "RW", name: "Rwanda", dial: "250", length: 9 },
  { iso: "BI", name: "Burundi", dial: "257" },
  { iso: "SS", name: "South Sudan", dial: "211" },
  { iso: "ET", name: "Ethiopia", dial: "251" },
  { iso: "SO", name: "Somalia", dial: "252" },
  { iso: "SD", name: "Sudan", dial: "249" },
  { iso: "CD", name: "DR Congo", dial: "243" },
  { iso: "ER", name: "Eritrea", dial: "291" },
  { iso: "DJ", name: "Djibouti", dial: "253" },
  { iso: "NG", name: "Nigeria", dial: "234" },
  { iso: "GH", name: "Ghana", dial: "233" },
  { iso: "ZA", name: "South Africa", dial: "27" },
  { iso: "ZM", name: "Zambia", dial: "260" },
  { iso: "ZW", name: "Zimbabwe", dial: "263" },
  { iso: "MW", name: "Malawi", dial: "265" },
  { iso: "MZ", name: "Mozambique", dial: "258" },
  { iso: "EG", name: "Egypt", dial: "20" },
  { iso: "GB", name: "United Kingdom", dial: "44" },
  { iso: "US", name: "United States / Canada", dial: "1" },
  { iso: "IN", name: "India", dial: "91" },
  { iso: "PK", name: "Pakistan", dial: "92" },
  { iso: "CN", name: "China", dial: "86" },
  { iso: "AE", name: "United Arab Emirates", dial: "971" },
  { iso: "SA", name: "Saudi Arabia", dial: "966" },
  { iso: "QA", name: "Qatar", dial: "974" },
  { iso: "DE", name: "Germany", dial: "49" },
  { iso: "FR", name: "France", dial: "33" },
  { iso: "NL", name: "Netherlands", dial: "31" },
  { iso: "SE", name: "Sweden", dial: "46" },
  { iso: "AU", name: "Australia", dial: "61" },
];
const DEFAULT = COUNTRIES[0];

/** Regional-indicator emoji for an ISO 3166 alpha-2 code. */
const flag = (iso: string) =>
  String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** Longest dialling code that prefixes these digits. */
function countryFor(digits: string): Country | null {
  let best: Country | null = null;
  for (const c of COUNTRIES) {
    if (digits.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  }
  return best;
}

/** Any written form → country + national digits (no trunk 0). */
function parse(text: string, fallback: Country): { country: Country; national: string } {
  const trimmed = text.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") || trimmed.startsWith("00")) {
    const intl = trimmed.startsWith("00") ? digits.slice(2) : digits;
    const country = countryFor(intl);
    if (country) return { country, national: intl.slice(country.dial.length) };
    return { country: fallback, national: intl };
  }
  // "254712…" typed without the plus, for the selected country.
  if (
    fallback.length &&
    digits.startsWith(fallback.dial) &&
    digits.length === fallback.dial.length + fallback.length
  ) {
    return { country: fallback, national: digits.slice(fallback.dial.length) };
  }
  return { country: fallback, national: digits.replace(/^0+/, "") };
}

const toValue = (country: Country, national: string) =>
  national ? `+${country.dial}${national}` : "";

/** A problem with the number as entered, or null when it looks right. */
export function phoneProblem(value: string): string | null {
  if (!value) return null;
  const { country, national } = parse(value, DEFAULT);
  if (country.length && national.length !== country.length) {
    return `A ${country.name} number has ${country.length} digits after +${country.dial}.`;
  }
  if (national.length < 6 || national.length > 13) return "Check the number — it looks incomplete.";
  return null;
}

/** "+254712345678" → "712 345 678" for display. */
const group = (national: string) => national.replace(/(\d{3})(?=\d)/g, "$1 ");

export default function PhoneInput({
  id,
  value,
  onChange,
  className = "",
  autoComplete = "tel",
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  const [country, setCountry] = useState<Country>(() => parse(value, DEFAULT).country);
  const [touched, setTouched] = useState(false);
  // "+2" or "00": an international prefix still being typed, shown as typed.
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = parse(value, country);
  // Follow a country implied by a value set from outside (a loaded record).
  if (value && parsed.country.iso !== country.iso && /^\s*(\+|00)/.test(value)) {
    setCountry(parsed.country);
  }
  const problem = touched ? phoneProblem(value) : null;
  const hintId = id ? `${id}-hint` : undefined;

  return (
    <div className="w-full min-w-0">
      <div className="flex w-full min-w-0 gap-1.5">
        <CountryPicker
          country={country}
          disabled={disabled}
          className={className}
          onPick={(next) => {
            setCountry(next);
            onChange(toValue(next, parsed.national));
          }}
        />
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete={autoComplete}
          disabled={disabled}
          placeholder={country.iso === "KE" ? "712 345 678" : "Phone number"}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? hintId : undefined}
          className={`${className} min-w-0 flex-1`}
          value={draft ?? group(parsed.national)}
          onChange={(e) => {
            const text = e.target.value;
            const intl = /^\s*(\+|00)/.test(text);
            const next = parse(text, country);
            const resolved =
              !intl || countryFor(text.replace(/\D/g, "").replace(/^00/, "")) !== null;
            setDraft(resolved ? null : text);
            if (!resolved) return;
            if (next.country.iso !== country.iso) setCountry(next.country);
            onChange(toValue(next.country, next.national));
          }}
          onBlur={() => {
            setDraft(null);
            setTouched(true);
          }}
        />
      </div>
      {problem && (
        <p id={hintId} className="mt-1 text-xs text-status-red">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Matches a country by name, ISO code or dialling code ("ken", "KE", "254", "+254"). */
function matches(c: Country, query: string) {
  const q = query.trim().toLowerCase().replace(/^\+/, "");
  if (!q) return true;
  return (
    c.name
      .toLowerCase()
      .split(/[\s/]+/)
      .some((word) => word.startsWith(q)) ||
    c.name.toLowerCase().startsWith(q) ||
    c.iso.toLowerCase() === q ||
    c.dial.startsWith(q.replace(/\D/g, "") || "x")
  );
}

function CountryPicker({
  country,
  onPick,
  disabled,
  className,
}: {
  country: Country;
  onPick: (country: Country) => void;
  disabled?: boolean;
  className: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const shown = COUNTRIES.filter((c) => matches(c, query));

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) buttonRef.current?.focus();
  };
  const pick = (c: Country) => {
    onPick(c);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 288;
      const height = popRef.current?.offsetHeight ?? 320;
      const below = rect.bottom + 6;
      const top =
        below + height > window.innerHeight && rect.top - height - 6 > 0
          ? rect.top - height - 6
          : below;
      setPos({ top, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
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
      if (!buttonRef.current?.contains(t) && !popRef.current?.contains(t)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    popRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Country dialling code: ${country.name} +${country.dial}`}
        onClick={() => {
          setActive(Math.max(0, COUNTRIES.indexOf(country)));
          setOpen((o) => !o);
        }}
        className={`${className} flex !w-auto shrink-0 items-center gap-1.5 !pr-2 whitespace-nowrap disabled:opacity-60`}
      >
        <span className="text-[17px] leading-none">{flag(country.iso)}</span>
        <span className="text-ink-900">+{country.dial}</span>
        <ChevronDown size={14} className="text-ink-500" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="fixed z-[1000] w-[288px] rounded-xl border border-surface-border bg-surface-card p-2 shadow-[0_12px_32px_rgba(0,0,0,0.18)]"
          >
            <div className="relative mb-1.5">
              <Search
                size={15}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500"
              />
              <input
                autoFocus
                type="search"
                role="combobox"
                aria-label="Search country or code"
                aria-expanded
                aria-controls="phone-country-list"
                aria-activedescendant={
                  shown[active] ? `phone-country-${shown[active].iso}` : undefined
                }
                placeholder="Search country or code"
                className="w-full rounded-lg border border-surface-border bg-surface-bg py-2 pl-8 pr-2 text-[13px] text-ink-900 outline-none focus:border-brand-green"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, shown.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (shown[active]) pick(shown[active]);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                  }
                }}
              />
            </div>
            <ul id="phone-country-list" role="listbox" className="max-h-64 overflow-y-auto">
              {shown.length === 0 && (
                <li className="px-2.5 py-2 text-[13px] text-ink-500">No country found.</li>
              )}
              {shown.map((c, index) => (
                <li
                  key={c.iso}
                  id={`phone-country-${c.iso}`}
                  data-index={index}
                  role="option"
                  aria-selected={c.iso === country.iso}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] ${
                    index === active ? "bg-brand-green-tint" : ""
                  } ${c.iso === country.iso ? "font-semibold text-ink-900" : "text-ink-900"}`}
                >
                  <span className="text-[17px] leading-none">{flag(c.iso)}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-ink-500">+{c.dial}</span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
