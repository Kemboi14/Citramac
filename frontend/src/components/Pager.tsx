import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

/**
 * The record pager at the top right of a list, as in Odoo: "1–25 / 230" with
 * previous / next. The list is loaded a page at a time from the server, so a
 * long list never has to be scrolled through.
 */
export function Pager({
  page,
  pageSize,
  total,
  shown,
  disabled = false,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Rows on this page. */
  shown: number;
  disabled?: boolean;
  onPage: (page: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = total === 0 ? 0 : first + shown - 1;
  const hasPrevious = page > 1;
  const hasNext = last < total;
  const button =
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-surface-border bg-surface-card text-ink-700 hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-700" aria-label="Pages">
      <span className="tabular-nums" aria-live="polite">
        {first}–{last} / {total}
      </span>
      <span className="inline-flex gap-1">
        <button
          type="button"
          className={button}
          aria-label="Previous page"
          disabled={disabled || !hasPrevious}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={button}
          aria-label="Next page"
          disabled={disabled || !hasNext}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight aria-hidden className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
}

/**
 * Pages a list already held in memory (one that is not paged by the server), for
 * the same <Pager>. Goes back to page 1 when the list's length changes (a new
 * filter or search), and never points past the last page.
 */
export function usePaged<T>(items: readonly T[], pageSize = 25) {
  const [state, setState] = useState({ page: 1, length: items.length });
  const page =
    state.length === items.length
      ? Math.min(state.page, Math.max(1, Math.ceil(items.length / pageSize)))
      : 1;
  return {
    page,
    rows: items.slice((page - 1) * pageSize, page * pageSize),
    pager: {
      page,
      pageSize,
      total: items.length,
      shown: Math.min(pageSize, Math.max(0, items.length - (page - 1) * pageSize)),
      onPage: (next: number) => setState({ page: next, length: items.length }),
    },
  };
}
