/** Placeholder shapes shown while data loads, instead of a bare "Loading…". */

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded-md bg-surface-border/70 ${className}`}
    />
  );
}

/** Rows for a table body while its data loads. Announces itself once to assistive tech. */
export function TableSkeletonRows({
  rows = 4,
  columns,
  cellClassName = "border-b border-surface-border px-3.5 py-3",
}: {
  rows?: number;
  columns: number;
  cellClassName?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden={row > 0 ? "true" : undefined}>
          {Array.from({ length: columns }, (_, col) => (
            <td key={col} className={cellClassName}>
              {row === 0 && col === 0 && <span className="sr-only">Loading…</span>}
              <Skeleton className={`h-4 ${col === 0 ? "w-3/4" : "w-1/2"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** A card-shaped block of stacked lines, for panels that are not tables. */
export function PanelSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" className="flex flex-col gap-2.5 p-1">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i === lines - 1 ? "w-1/2" : "w-full"}`} />
      ))}
    </div>
  );
}
