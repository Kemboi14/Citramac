import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: string;
  /** Omit on the current page. */
  to?: string;
}

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
