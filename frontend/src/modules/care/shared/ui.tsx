import { useId, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
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
  error,
  hint,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  /** Inline validation message for this field. */
  error?: string;
  /** Short helper text shown under the control. */
  hint?: ReactNode;
}) {
  const messageId = htmlFor ? `${htmlFor}-message` : undefined;
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={messageId} role="alert" className="text-[12px] font-medium text-priority-red">
          {error}
        </p>
      ) : (
        hint && (
          <p id={messageId} className="text-[12px] text-ink-500">
            {hint}
          </p>
        )
      )}
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

/** The dark hover bubble — hidden until its `group/tip` is hovered or reached by
 * keyboard. Exported for fields that show it from their own label. */
export const TIP_BUBBLE =
  "pointer-events-none invisible absolute left-0 z-30 w-max max-w-[280px] rounded-[10px] bg-[#16221d] px-3 py-[9px] text-left text-[13px] font-normal normal-case leading-[1.45] tracking-normal text-white opacity-0 shadow-[0_8px_24px_rgba(0,0,0,.18)] transition-[opacity,transform] duration-150 motion-reduce:transition-none";
export const TIP_SHOW =
  "group-hover/tip:visible group-hover/tip:opacity-100 group-hover/tip:delay-300 group-focus-visible/tip:visible group-focus-visible/tip:opacity-100 group-has-[:focus-visible]/tip:visible group-has-[:focus-visible]/tip:opacity-100";
/** Marks text that has an explanation on hover — the cursor only, no underline
 * (QA 2026-10-30). */
export const TIP_CUE =
  "cursor-help";

/**
 * An explanation shown on hover (after a short delay) or keyboard focus, so a
 * screen stays clean without losing its guidance. `focusable` makes plain text
 * reachable by Tab; leave it off when the child is already a control.
 */
export function Tip({
  tip,
  children,
  placement = "below",
  focusable = true,
  className = "",
}: {
  tip: ReactNode;
  children: ReactNode;
  placement?: "below" | "above";
  focusable?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <span
      className={`group/tip relative inline-flex max-w-full items-center outline-none ${className}`}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={id}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className={`${TIP_BUBBLE} ${TIP_SHOW} ${placement === "below" ? "top-full mt-2" : "bottom-full mb-2"}`}
      >
        {tip}
      </span>
    </span>
  );
}

export type StatusTone = "info" | "success" | "warning" | "danger" | "neutral";

const STATUS_PILL: Record<StatusTone, string> = {
  info: "bg-accent-info-tint text-accent-info",
  success: "bg-brand-green-tint text-brand-green-dark",
  warning: "bg-status-amber-tint text-status-amber",
  danger: "bg-status-red-tint text-status-red",
  neutral: "bg-surface-bg text-ink-500",
};

/** A small dot + label that carries a card's state, so the card itself stays
 * neutral — no coloured edge, no tinted fill (design note 2026-10-30). */
export function StatusPill({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      // eslint-disable-next-line security/detect-object-injection -- `tone` is a fixed prop union.
      className={`inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold ${STATUS_PILL[tone]} ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
      {children}
    </span>
  );
}

const CALLOUT_TONE = {
  info: { Icon: Info, icon: "text-accent-info", label: "Info" },
  success: { Icon: CheckCircle2, icon: "text-brand-green", label: "Done" },
  warning: { Icon: AlertTriangle, icon: "text-status-amber", label: "Attention" },
  danger: { Icon: AlertCircle, icon: "text-status-red", label: "Important" },
} as const;

/**
 * A message card: neutral surface, a tone icon and a status pill — the pill's
 * word, not a coloured edge or tint, says what kind of message it is.
 * `label` replaces the pill's default word; `label={null}` hides the pill.
 */
export function Callout({
  children,
  tone = "info",
  role,
  label,
  className = "",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "danger" | "warning";
  role?: "status" | "alert";
  label?: ReactNode | null;
  className?: string;
}) {
  // eslint-disable-next-line security/detect-object-injection -- `tone` is a fixed prop union.
  const t = CALLOUT_TONE[tone];
  return (
    <div
      role={role}
      className={`flex gap-2.5 rounded-xl border border-surface-border bg-surface-card px-3.5 py-3 text-[12.5px] text-ink-900 shadow-sm ${className}`}
    >
      <t.Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 flex-shrink-0 ${t.icon}`} />
      <div className="min-w-0 flex-1">{children}</div>
      {label !== null && (
        <StatusPill tone={tone} className="self-start">
          {label ?? t.label}
        </StatusPill>
      )}
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
  className = "",
}: {
  id?: string;
  options: ValueSetConcept[];
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}) {
  return (
    <select
      id={id}
      className={`${INPUT} ${className}`}
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
