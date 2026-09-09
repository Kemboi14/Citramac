/** Rounded-pill single-select radio group — used by registration/admission forms. */
export function PillRadio<T extends string>({
  value,
  options,
  onChange,
  warnValue,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  warnValue?: T;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors duration-150 ${
            value === opt.value
              ? opt.value === warnValue
                ? "border-status-red bg-status-red text-white"
                : "border-brand-green bg-brand-green text-white"
              : "border-surface-border bg-white text-ink-700 hover:border-brand-green"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
