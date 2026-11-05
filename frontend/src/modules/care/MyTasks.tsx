import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { getMyTasks, type MyTask } from "../../lib/carePathwayApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { Card, ErrorNote, StatusPill, Tag } from "./shared/ui";
import { errorText } from "./triage/helpers";

const PAGE_SIZE = 10;
const BUTTON =
  "rounded-md border border-surface-border px-3 py-1.5 text-[12.5px] font-semibold text-ink-700 hover:bg-surface-bg disabled:cursor-not-allowed disabled:opacity-50";

/** The signed-in clinician's own work, overdue first — items for their clients,
 * tasks given to them or their team, and decisions waiting on them, each saying
 * why it is theirs. Collapsed to a count until opened, then shown a page at a time. */
export function MyTasks() {
  const { accessToken } = useAuth();
  const [tasks, setTasks] = useState<MyTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getMyTasks(accessToken)
      .then((r) => {
        if (cancelled) return;
        setTasks(r.results);
        setError(null);
      })
      .catch((e) => !cancelled && setError(errorText(e, "Couldn't load tasks.")));
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const total = tasks?.length ?? 0;
  const overdue = tasks?.filter((t) => t.overdue).length ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A refreshed list can be shorter than the page being viewed.
  const current = Math.min(page, pages - 1);
  const shown = tasks?.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE) ?? [];

  const toggle = (
    <button
      type="button"
      className={`${BUTTON} inline-flex items-center gap-1`}
      aria-expanded={open}
      aria-controls="my-tasks-list"
      onClick={() => setOpen((v) => !v)}
      disabled={!tasks || total === 0}
    >
      {open ? (
        <>
          Hide <ChevronUp size={14} aria-hidden="true" />
        </>
      ) : (
        <>
          Show my tasks <ChevronDown size={14} aria-hidden="true" />
        </>
      )}
    </button>
  );

  return (
    <Card
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          My tasks {tasks && <Tag>{total}</Tag>}
          {overdue > 0 && <StatusPill tone="danger">{overdue} overdue</StatusPill>}
        </span>
      }
      aside={toggle}
    >
      <ErrorNote>{error}</ErrorNote>
      {!tasks ? (
        !error && <p className="text-[13px] text-ink-500">Loading…</p>
      ) : total === 0 ? (
        <p className="text-[13px] text-ink-500">Nothing outstanding.</p>
      ) : !open ? (
        <p className="text-[13px] text-ink-500">
          {total} task{total === 1 ? "" : "s"} outstanding
          {overdue > 0 ? `, ${overdue} overdue` : ""}. Select &ldquo;Show my tasks&rdquo; to see
          them.
        </p>
      ) : (
        <div id="my-tasks-list">
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {shown.map((t) => (
              <li key={`${t.patient_id}:${t.key}`} className="flex flex-wrap items-center gap-2">
                <Tag tone={t.overdue ? "risk" : "neutral"}>{t.category}</Tag>
                {t.why && <span className="text-[11.5px] font-semibold text-ink-500">{t.why}</span>}
                <Link
                  to={clientRecordPath(t.patient_id, "snapshot")}
                  className="font-semibold text-brand-green hover:underline"
                >
                  {t.patient}
                </Link>
                {t.text}
                {t.due_at && (
                  <span className="text-ink-500">
                    {t.overdue ? "overdue since" : "due"} {formatDateTime(t.due_at)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav
              aria-label="My tasks pages"
              className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-3"
            >
              <span className="text-[12.5px] text-ink-500">
                {current * PAGE_SIZE + 1}–{Math.min((current + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => setPage(current - 1)}
                  disabled={current === 0}
                >
                  Previous
                </button>
                <span className="text-[12.5px] text-ink-700">
                  Page {current + 1} of {pages}
                </span>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => setPage(current + 1)}
                  disabled={current >= pages - 1}
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </div>
      )}
    </Card>
  );
}
