/** A signed record's answers as a clean two-column list: the question in
 * sentence case on the left, the answer on the right, a thin line between
 * rows. Used by the triage and intake summaries so both read the same way. */
export function AnswerList({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="divide-y divide-surface-border">
      {rows.map((row, index) => (
        <div
          key={`${row.label}-${index}`}
          className="grid gap-x-6 gap-y-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <dt className="text-[13px] text-ink-500">{row.label}</dt>
          <dd className="whitespace-pre-wrap break-words text-[13.5px] font-medium text-ink-900">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
