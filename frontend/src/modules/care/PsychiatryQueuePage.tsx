import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  completePsychiatricReview,
  getPsychiatryQueue,
  openPsychiatryReview,
  type Priority,
  type PsychiatryQueueRow,
  type WithdrawalReview,
} from "../../lib/carePathwayApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, INPUT, PRIORITY_EDGE } from "./shared/styles";
import { EmptyState } from "../../components/EmptyState";
import { ErrorNote, PageHeader, PriorityPill, SelectChoices, Tag } from "./shared/ui";
import { useValueSets } from "./shared/useValueSets";
import { errorText } from "./triage/helpers";
import { useRecordData } from "./record/useRecordData";
import { LiveQueue } from "./triage/LiveQueue";

const REFRESH_MS = 60_000;
const PRIORITIES: Priority[] = ["RED", "ORANGE", "YELLOW", "GREEN"];

type View = "waiting" | "in_review" | "mine" | "all";
const VIEWS: { key: View; label: string }[] = [
  { key: "waiting", label: "Waiting for review" },
  { key: "in_review", label: "In review" },
  { key: "mine", label: "Mine" },
  { key: "all", label: "All" },
];

const searchText = (row: PsychiatryQueueRow) =>
  [
    row.name,
    row.mrn,
    row.citramac_number,
    row.presenting_concern,
    row.owner?.name,
    row.team,
    ...row.alerts,
  ]
    .join(" ")
    .toLowerCase();

/**
 * Psychiatry — priority queue: one card per client with a signed triage,
 * grouped RED → GREEN (longest wait first within a priority, server order).
 * Each card says who, how long they have waited, why, the active alerts, who
 * is responsible and what to do next. The four-lane live queue is kept behind
 * "Show all lanes".
 */
export function PsychiatryQueuePage() {
  const { accessToken, claims } = useAuth();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<View>("waiting");
  const [query, setQuery] = useState("");
  const [lanes, setLanes] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const { data, error, loading } = useRecordData(
    "psychiatry-queue",
    tick,
    (token) => getPsychiatryQueue(token),
    "Couldn't load the psychiatry queue.",
  );
  const rows = useMemo(() => data?.results ?? [], [data]);
  const me = claims?.user_id;

  const inView = (row: PsychiatryQueueRow, v: View) =>
    v === "waiting"
      ? !row.review_started_at
      : v === "in_review"
        ? Boolean(row.review_started_at)
        : v === "mine"
          ? row.owner?.id === me
          : true;
  const counts = Object.fromEntries(
    VIEWS.map((v) => [v.key, rows.filter((r) => inView(r, v.key)).length]),
  ) as Record<View, number>;
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((r) => inView(r, view) && (!needle || searchText(r).includes(needle)));

  const openReview = async (row: PsychiatryQueueRow) => {
    if (!accessToken) return;
    setOpening(row.id);
    setOpenError(null);
    try {
      const result = await openPsychiatryReview(accessToken, row.id);
      navigate(clientRecordPath(result.patient_id || row.patient_id, "intake"));
    } catch (err) {
      setOpenError(err instanceof ApiError ? err.message : "Couldn't open the psychiatric review.");
      setOpening(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Clinical workflow"
        title="Psychiatry queue"
        subtitle="Clients with a signed triage, most urgent first. Open a card to start or continue the review."
      />
      <ErrorNote>{error ?? openError}</ErrorNote>

      <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-card p-3 shadow-sm sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Find a client</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500"
          />
          <input
            type="search"
            autoComplete="off"
            className={`${INPUT} pl-8`}
            placeholder="Find by name, number, concern, alert or who is responsible"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={`rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                view === v.key
                  ? "border-brand-green bg-brand-green text-on-primary"
                  : "border-surface-border bg-surface-card text-ink-900 hover:bg-surface-bg"
              }`}
            >
              {v.label} <span className="opacity-80">({counts[v.key]})</span>
            </button>
          ))}
        </div>
      </div>

      {!data && loading && <p className="text-[13px] text-ink-500">Loading the queue…</p>}
      {data && shown.length === 0 && (
        <EmptyState title={rows.length === 0 ? "The queue is empty" : "No one here"}>
          {rows.length === 0
            ? "Clients appear here once their triage is signed."
            : needle
              ? "No client matches that search."
              : "No client in this view — try “All”."}
        </EmptyState>
      )}

      {PRIORITIES.map((priority) => {
        const group = shown.filter((r) => r.priority === priority);
        if (!group.length) return null;
        return (
          <section key={priority} aria-label={`${priority} priority`}>
            <h2 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-ink-900">
              <PriorityPill priority={priority} long />
              <span className="text-ink-500">
                {group.length} {group.length === 1 ? "client" : "clients"}
              </span>
            </h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {group.map((row) => (
                <QueueCard
                  key={row.id}
                  row={row}
                  opening={opening}
                  onOpen={() => void openReview(row)}
                  onSaved={() => setTick((t) => t + 1)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <div>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          aria-expanded={lanes}
          onClick={() => setLanes((v) => !v)}
        >
          {lanes ? "Hide all lanes" : "Show all lanes (awaiting triage, in care, discharged)"}
        </button>
        {lanes && (
          <div className="mt-3 rounded-lg border border-surface-border bg-surface-card p-4 shadow-sm">
            <LiveQueue
              opening={opening}
              onOpenReview={(lane) => {
                const match = rows.find((r) => r.id === lane.id);
                if (match) void openReview(match);
                else navigate(`/clinical/triage/${lane.id}`);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function waitText(row: PsychiatryQueueRow) {
  if (row.review_started_at) return `Review started ${formatDateTime(row.review_started_at)}`;
  if (row.wait_minutes === null) return `Triage signed ${formatDateTime(row.signed_at)}`;
  const h = Math.floor(row.wait_minutes / 60);
  const m = row.wait_minutes % 60;
  return `Waiting ${h ? `${h} h ` : ""}${m} min`;
}

function QueueCard({
  row,
  opening,
  onOpen,
  onSaved,
}: {
  row: PsychiatryQueueRow;
  opening: string | null;
  onOpen: () => void;
  onSaved: () => void;
}) {
  const details = [
    row.citramac_number,
    row.age !== null ? `${row.age} y` : "",
    row.sex ? row.sex.charAt(0) + row.sex.slice(1).toLowerCase() : "",
  ].filter(Boolean);
  const responsible = row.owner?.name || row.team;
  return (
    <li
      className={`flex flex-col gap-2.5 rounded-lg border border-l-4 border-surface-border bg-surface-card p-3.5 shadow-sm ${PRIORITY_EDGE[row.priority]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block truncate text-[14px] text-ink-900">
            {row.name || "Unknown client"}
          </strong>
          <span className="text-[11.5px] text-ink-500">{details.join(" · ")}</span>
        </div>
        <span
          className={`shrink-0 whitespace-nowrap text-[12px] font-semibold ${
            row.over_target ? "text-priority-red" : "text-ink-700"
          }`}
        >
          {waitText(row)}
          {row.over_target && row.target_minutes !== null
            ? ` · over ${row.target_minutes} min`
            : ""}
        </span>
      </div>

      <p className="line-clamp-2 text-[13px] text-ink-900">
        {row.presenting_concern || <span className="text-ink-500">Concern not recorded</span>}
      </p>

      {row.alerts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.alerts.slice(0, 3).map((alert) => (
            <Tag key={alert} tone="risk">
              {alert}
            </Tag>
          ))}
          {row.alerts.length > 3 && <Tag>+{row.alerts.length - 3} more</Tag>}
        </div>
      )}

      {row.withdrawal_review && (
        <WithdrawalReviewCell review={row.withdrawal_review} onSaved={onSaved} />
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-2.5">
        <span className="text-[12px] text-ink-700">
          Responsible:{" "}
          {responsible ? (
            <strong>{responsible}</strong>
          ) : (
            <span className="text-ink-500">not yet assigned</span>
          )}
        </span>
        <button
          type="button"
          className={`${row.review_started_at ? BTN_GHOST : BTN} ${BTN_SM}`}
          disabled={opening !== null}
          aria-label={`${row.review_started_at ? "Continue" : "Open"} review for ${row.name || "unknown client"}`}
          onClick={onOpen}
        >
          {opening === row.id
            ? "Opening…"
            : row.review_started_at
              ? "Continue review"
              : "Open review"}
        </button>
      </div>
    </li>
  );
}

const REVIEW_STATUS: Record<WithdrawalReview["status"], string> = {
  INITIATED: "requested",
  PENDING: "in progress",
  COMPLETED: "completed",
};

/** Triage spec item 10: the psychiatric review withdrawal raised — its status,
 * and, to complete it, the coded outcome (served `psychiatric-review-outcome`). */
function WithdrawalReviewCell({
  review,
  onSaved,
}: {
  review: WithdrawalReview;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async () => {
    if (!accessToken || !outcome) return;
    setBusy(true);
    setSaveError(null);
    try {
      await completePsychiatricReview(accessToken, review.id, outcome, note.trim());
      setOpen(false);
      onSaved();
    } catch (err) {
      setSaveError(errorText(err, "Couldn't record the outcome."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-[260px] flex-col items-start gap-1.5" title={review.label}>
      <Tag tone={review.status === "COMPLETED" ? "neutral" : "risk"}>
        Withdrawal — psychiatric review {REVIEW_STATUS[review.status]}
        {review.priority === "urgent" && review.status !== "COMPLETED" ? " · urgent" : ""}
      </Tag>
      {review.status === "COMPLETED" ? (
        <span className="text-[11px] text-ink-500">
          {review.outcome_label}
          {review.outcome_note ? ` — ${review.outcome_note}` : ""}
        </span>
      ) : !open ? (
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setOpen(true)}>
          Record outcome…
        </button>
      ) : (
        <div className="flex w-full flex-col gap-1.5">
          <ErrorNote>{saveError}</ErrorNote>
          <SelectChoices
            id={`review-outcome-${review.id}`}
            options={vs.options("psychiatric-review-outcome")}
            placeholder="— outcome —"
            value={outcome}
            onChange={setOutcome}
          />
          <input
            className={INPUT}
            aria-label="Outcome note (optional)"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              className={`${BTN} ${BTN_SM}`}
              disabled={!outcome || busy}
              onClick={() => void save()}
            >
              Save outcome
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} ${BTN_SM}`}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
