import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { INPUT, TH } from "./styles";
import type { TableControls } from "./useTableControls";

/** A sortable column header: a real button, with the sort state announced. */
export function SortHeader<T>({
  controls,
  sortKey,
  children,
}: {
  controls: TableControls<T>;
  sortKey: string;
  children: ReactNode;
}) {
  const active = controls.sortKey === sortKey;
  const Icon = !active ? ChevronsUpDown : controls.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={TH}
      aria-sort={active ? (controls.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => controls.toggleSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink-900"
      >
        {children}
        <Icon className={`h-3 w-3 ${active ? "text-brand-green" : "text-ink-400"}`} aria-hidden />
      </button>
    </th>
  );
}

/** The filter box that sits above a worklist; shows how many rows match. */
export function TableFilter<T>({
  controls,
  label,
  placeholder = "Filter this list…",
}: {
  controls: TableControls<T>;
  label: string;
  placeholder?: string;
}) {
  const shown = controls.rows.length;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-surface-border px-[18px] py-3">
      <input
        type="search"
        aria-label={label}
        className={`${INPUT} max-w-xs`}
        placeholder={placeholder}
        value={controls.filter}
        onChange={(e) => controls.setFilter(e.target.value)}
      />
      {controls.filter && (
        <span className="text-[12px] text-ink-500" role="status">
          {shown} of {controls.total} shown
        </span>
      )}
    </div>
  );
}
