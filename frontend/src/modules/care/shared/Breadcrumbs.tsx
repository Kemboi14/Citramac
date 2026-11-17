import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

export interface Crumb {
  label: string;
  /** Omit on the current page. */
  to?: string;
}

/**
 * Breadcrumbs that follow the way the user came. A page that links onward
 * passes `onward` as the link's router state (`{ trail: onward }`); the next
 * page shows that trail, then itself. Opened directly (a bookmark, a reload in
 * a new tab), a page shows its `fallback` instead. Only labels and paths are
 * carried, in router state, never client data in storage.
 */
export function useTrail(fallback: Crumb[], current: string) {
  const location = useLocation();
  const before = carriedTrail(location.state) ?? fallback;
  return {
    items: [...before, { label: current }],
    onward: [...before, { label: current, to: location.pathname + location.search }],
  };
}

/** The trail a link passed in its router state, if any. */
export function carriedTrail(state: unknown): Crumb[] | null {
  const trail = (state as { trail?: unknown } | null)?.trail;
  return isTrail(trail) ? trail : null;
}

const isTrail = (value: unknown): value is Crumb[] =>
  Array.isArray(value) &&
  value.every(
    (c) =>
      typeof c === "object" &&
      c !== null &&
      typeof (c as Crumb).label === "string" &&
      (typeof (c as Crumb).to === "string" || (c as Crumb).to === undefined),
  );

/** Where you are, and a way back up: Home › Section › This page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-[12px] text-ink-500">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.to && !last ? (
                <Link to={item.to} className="font-medium text-brand-green hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className="text-ink-700">
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight aria-hidden="true" className="h-3 w-3 text-ink-400" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
