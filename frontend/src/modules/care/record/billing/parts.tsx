import type { ReactNode } from "react";

// Display pieces shared by the claim workspace and its SHA panels.

export function Kv({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,max-content)_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {rows.map(([label, value], index) => (
        <div key={index} className="contents">
          <dt className="text-ink-500">{label}</dt>
          <dd className="min-w-0 break-words font-medium text-ink-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** SHA's raw JSON, formatted, exactly as received. */
export function RawJson({ value, label }: { value: unknown; label: string }) {
  return (
    <pre
      aria-label={label}
      className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-surface-border bg-surface-bg p-3 font-mono text-[11.5px] text-ink-900"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
