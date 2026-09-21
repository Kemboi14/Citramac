import type { ReactNode } from "react";

/**
 * Ports the mobile card-list fallback already proven in
 * mockups/citramac_SUPER-ADMIN.html (`.table-panel`/`.mobile-cards`, swapped
 * by a max-width media query) into a single reusable component, instead of
 * every page hand-rolling its own `overflow-x-auto`+`min-w-[...]` table
 * (which merely scrolls sideways on phone rather than reflowing).
 *
 * Below `md`, each row renders as a card: `cardTitle`/`cardSubtitle` in the
 * header (optionally next to a `cardBadge`, e.g. a status pill), the
 * remaining columns as a 2-column label/value grid, and `renderCardActions`
 * as a full-width action-button footer — mirroring the mockup's
 * `.m-org-card`/`.m-org-top`/`.m-org-grid`/`.m-org-foot` structure. At `md`
 * and above, columns render as an ordinary `<table>` with the exact classes
 * pages already used, so desktop styling is unchanged.
 */
export interface ResponsiveTableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** `<td>` className, desktop table only. */
  className?: string;
  /** Rendered as the card's bold title instead of in the label/value grid. Usually the first/name column. */
  cardTitle?: boolean;
  /** Rendered under the title, small and muted. */
  cardSubtitle?: boolean;
  /** Rendered top-right of the card header, e.g. a status badge. */
  cardBadge?: boolean;
  /** Omit from the mobile card body entirely (e.g. an Actions column already covered by `renderCardActions`). */
  hideInCard?: boolean;
}

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  renderCardActions,
  emptyMessage = "No records found.",
}: {
  columns: ResponsiveTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  renderCardActions?: (row: T) => ReactNode;
  emptyMessage?: string;
}) {
  const titleCol = columns.find((c) => c.cardTitle);
  const subtitleCol = columns.find((c) => c.cardSubtitle);
  const badgeCol = columns.find((c) => c.cardBadge);
  const bodyCols = columns.filter(
    (c) => !c.hideInCard && c !== titleCol && c !== subtitleCol && c !== badgeCol,
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-surface-border bg-surface-card shadow-sm md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-surface-border bg-ink-50 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-surface-border last:border-0 ${onRowClick ? "cursor-pointer transition-colors duration-150 hover:bg-brand-green-tint-2" : ""}`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={col.className ?? "px-4 py-3 text-ink-700"}>
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-ink-500">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-2.5 md:hidden">
        {rows.map((row) => (
          <div
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`rounded-md border border-surface-border bg-surface-card p-3.5 shadow-sm ${onRowClick ? "cursor-pointer" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {titleCol && (
                  <div className="truncate font-semibold text-ink-900">{titleCol.cell(row)}</div>
                )}
                {subtitleCol && (
                  <div className="mt-0.5 truncate text-[11px] text-ink-400">
                    {subtitleCol.cell(row)}
                  </div>
                )}
              </div>
              {badgeCol && <div className="flex-shrink-0">{badgeCol.cell(row)}</div>}
            </div>
            {bodyCols.length > 0 && (
              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                {bodyCols.map((col) => (
                  <div key={col.key}>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                      {col.header}
                    </div>
                    <div className="mt-0.5 text-ink-700">{col.cell(row)}</div>
                  </div>
                ))}
              </div>
            )}
            {renderCardActions && (
              <div className="mt-3 flex gap-2 border-t border-surface-border pt-3">
                {renderCardActions(row)}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-center text-sm text-ink-500">{emptyMessage}</p>}
      </div>
    </>
  );
}
