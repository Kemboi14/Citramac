import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { PRIORITY_LABEL, type Priority, type PriorityOrBlank } from "../../../lib/carePathwayApi";
import type { ValueSetConcept } from "../../../lib/carePathwayApi";
import { FIELD_LABEL, INPUT } from "./styles";

// Shared building blocks for the v3 clinical workspace — the mockup's .card,
// .field, .tag, .pill, .btn, .callout, .data-table, .checkbox-item classes
// (mockups/citramac_clinical_workspace.html), on the app's theme tokens.

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-xl font-semibold text-ink-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[12.5px] text-ink-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  aside,
  children,
  bodyClassName = "p-[18px]",
  className = "",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-surface-border bg-surface-card shadow-sm ${className}`}
    >
      {title && (
        <div className="flex items-center justify-between gap-2.5 border-b border-surface-border px-[18px] py-3.5 text-[13px] font-bold text-ink-900">
          <span>{title}</span>
          {aside}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  htmlFor,
  children,
  className = "",
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "risk" | "brand" | "warn";
}) {
  const tones = {
    neutral: "border-surface-border bg-surface-bg text-ink-900",
    risk: "border-transparent bg-priority-red-tint text-priority-red",
    brand: "border-transparent bg-brand-green-tint text-brand-green",
    warn: "border-transparent bg-priority-orange-tint text-priority-orange",
  };
  return (
    <span
      // eslint-disable-next-line security/detect-object-injection -- `tone` is a fixed prop union.
      className={`inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

const PILL: Record<Priority, string> = {
  RED: "bg-priority-red-tint text-priority-red",
  ORANGE: "bg-priority-orange-tint text-priority-orange",
  YELLOW: "bg-priority-yellow-tint text-priority-yellow",
  GREEN: "bg-priority-green-tint text-priority-green",
};

/** `.pill.pri-X` — dot + label. `long` adds " · Emergency / Immediate" etc. */
export function PriorityPill({
  priority,
  long = false,
  pendingLabel = "Pending triage",
}: {
  priority: PriorityOrBlank;
  long?: boolean;
  pendingLabel?: string;
}) {
  if (!priority) return <Tag>{pendingLabel}</Tag>;
  const longLabel = priority === "RED" ? "Emergency / Immediate" : PRIORITY_LABEL[priority];
  return (
    <span
      // eslint-disable-next-line security/detect-object-injection -- `priority` is a typed union.
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-semibold tracking-[.2px] ${PILL[priority]}`}
    >
      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-current" />
      {priority}
      {long && ` · ${longLabel}`}
    </span>
  );
}

export function Callout({
  children,
  tone = "info",
  role,
  className = "",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "danger" | "warning";
  role?: "status" | "alert";
  className?: string;
}) {
  const tones = {
    info: "border-surface-border border-l-brand-green bg-surface-bg text-ink-900",
    success: "border-brand-green border-l-brand-green bg-brand-green-tint text-brand-green-dark",
    danger: "border-priority-red border-l-priority-red bg-priority-red-tint text-priority-red",
    warning:
      "border-priority-orange border-l-priority-orange bg-priority-orange-tint text-priority-orange",
  };
  return (
    <div
      role={role}
      // eslint-disable-next-line security/detect-object-injection -- `tone` is a fixed prop union.
      className={`flex gap-2.5 rounded-lg border border-l-[3px] px-3.5 py-3 text-[12.5px] ${tones[tone]} ${className}`}
    >
      {tone === "info" && <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-sm bg-status-red-tint px-3 py-2 text-sm text-status-red">
      {children}
    </p>
  );
}

const CHECK =
  "h-[17px] w-[17px] flex-shrink-0 cursor-pointer accent-[var(--green)] disabled:cursor-not-allowed";

/** `.checkbox-item` radios bound to a served value set. */
export function RadioChoices({
  name,
  options,
  value,
  onChange,
  disabled,
}: {
  name: string;
  options: ValueSetConcept[];
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1" role="radiogroup">
      {options.map((option) => (
        <label
          key={option.code}
          className="flex cursor-pointer items-center gap-2 py-1 text-[13px] text-ink-900"
        >
          <input
            type="radio"
            name={name}
            className={CHECK}
            checked={value === option.code}
            disabled={disabled}
            onChange={() => onChange(option.code)}
          />
          {option.display}
        </label>
      ))}
    </div>
  );
}

/** `.checkbox-item` checkboxes bound to a served value set. */
export function CheckChoices({
  options,
  value,
  onChange,
  disabled,
  columns,
}: {
  options: ValueSetConcept[];
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
  columns?: 2;
}) {
  return (
    <div
      className={
        columns === 2 ? "grid grid-cols-1 gap-1 sm:grid-cols-2" : "flex flex-wrap gap-x-4 gap-y-1"
      }
    >
      {options.map((option) => (
        <label
          key={option.code}
          className="flex cursor-pointer items-center gap-2 py-1 text-[13px] text-ink-900"
        >
          <input
            type="checkbox"
            className={CHECK}
            checked={value.includes(option.code)}
            disabled={disabled}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, option.code]
                  : value.filter((code) => code !== option.code),
              )
            }
          />
          {option.display}
        </label>
      ))}
    </div>
  );
}

/** <select> bound to a served value set, with an optional blank first option. */
export function SelectChoices({
  id,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  required,
}: {
  id?: string;
  options: ValueSetConcept[];
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <select
      id={id}
      className={INPUT}
      value={value}
      disabled={disabled}
      required={required}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.display}
        </option>
      ))}
    </select>
  );
}

/** `.timeline` — vertical rail with dots. */
export function Timeline({
  items,
}: {
  items: { key: string; time: string; title: ReactNode; detail?: ReactNode }[];
}) {
  return (
    <div className="relative pl-6 before:absolute before:bottom-0 before:left-2 before:top-0 before:w-0.5 before:bg-surface-border">
      {items.map((item) => (
        <div key={item.key} className="relative pb-[18px] last:pb-0">
          <span className="absolute -left-5 top-1 h-2.5 w-2.5 rounded-full border-2 border-surface-card bg-brand-green shadow-[0_0_0_2px_var(--green)]" />
          <div className="font-mono text-[11px] font-semibold text-ink-400">{item.time}</div>
          <div className="text-[13px] font-semibold text-ink-900">{item.title}</div>
          {item.detail && <div className="text-xs text-ink-500">{item.detail}</div>}
        </div>
      ))}
    </div>
  );
}
