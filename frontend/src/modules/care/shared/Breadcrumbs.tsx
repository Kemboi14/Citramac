import { ArrowLeft, ChevronRight } from "lucide-react";
import { createContext, useContext, useId, useLayoutEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

export interface Crumb {
  label: string;
  /** A page to go back to. Omit on the current page. */
  to?: string;
  /** A view inside the same page to go back to (e.g. a list behind a detail). */
  onClick?: () => void;
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
    onward: [
      ...before.map(({ label, to }) => ({ label, to })),
      { label: current, to: location.pathname + location.search },
    ],
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

/**
 * The shell's breadcrumb bar. Inside it, a page's <Breadcrumbs> renders
 * nothing where it stands and its crumbs show in the bar at the top of the
 * page instead; the most recently mounted one wins. Without it (full-height
 * workspaces), <Breadcrumbs> renders in place.
 */
export interface BreadcrumbBar {
  set: (owner: string, items: Crumb[]) => void;
  clear: (owner: string) => void;
}

export const BreadcrumbBarContext = createContext<BreadcrumbBar | null>(null);

/** Where you are, and a way back: Section › Page › This page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const bar = useContext(BreadcrumbBarContext);
  const owner = useId();
  const latest = useRef(items);
  // Re-sent only when what is shown changes; clicks always reach the latest handler.
  const key = JSON.stringify(items.map((c) => [c.label, c.to ?? null, Boolean(c.onClick)]));

  useLayoutEffect(() => {
    latest.current = items;
  });

  useLayoutEffect(() => {
    if (!bar) return;
    bar.set(
      owner,
      latest.current.map((crumb, index) => ({
        label: crumb.label,
        to: crumb.to,
        onClick: crumb.onClick ? () => latest.current[index]?.onClick?.() : undefined,
      })),
    );
    // `key` stands for the items' content.
  }, [bar, owner, key]);

  useLayoutEffect(() => {
    if (!bar) return;
    return () => bar.clear(owner);
  }, [bar, owner]);

  return bar ? null : <BreadcrumbTrail items={items} className="mb-2" />;
}

/** The trail itself, as drawn in the shell bar or in place. */
export function BreadcrumbTrail({ items, className = "" }: { items: Crumb[]; className?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Back goes where the user was, never only "up" a level:
  // - a view inside this page (list behind a detail) closes back to it;
  // - otherwise, when they arrived from another page of the app, to exactly that
  //   page (router history keeps its place, filters and scroll);
  // - opened directly (bookmark, new tab), to the nearest crumb above.
  const parent = [...items.slice(0, -1)].reverse().find((c) => c.to || c.onClick);
  const inPage = items.length > 1 ? items[items.length - 2] : undefined;
  const cameFromApp = location.key !== "default";
  const back = inPage?.onClick
    ? inPage.onClick
    : cameFromApp
      ? () => navigate(-1)
      : parent?.to
        ? () => navigate(parent.to!)
        : parent?.onClick;
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex flex-wrap items-center gap-2 text-[12px] text-ink-500 ${className}`}
    >
      {back && (
        <button
          type="button"
          onClick={back}
          className="inline-flex items-center gap-1 rounded-md border border-surface-border bg-surface-card px-2 py-0.5 text-[12px] font-medium text-ink-700 hover:border-brand-green hover:text-brand-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-green"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Back
        </button>
      )}
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {item.to && !last ? (
                <Link to={item.to} className="font-medium text-brand-green hover:underline">
                  {item.label}
                </Link>
              ) : item.onClick && !last ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="font-medium text-brand-green hover:underline"
                >
                  {item.label}
                </button>
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
