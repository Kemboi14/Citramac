import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  completePsychiatricReview,
  getPsychiatryQueue,
  openPsychiatryReview,
  PRIORITY_LABEL,
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
    row.signed_by,
    row.signed_at ? formatDateTime(row.signed_at) : "",
    row.owner?.name,
    row.team,
    ...row.alerts,
  ]
    .join(" ")
    .toLowerCase();

/**
 * Psychiatry — priority queue: one row per client with a signed triage,
 * grouped RED → GREEN (longest wait first within a priority, server order).
 * Each row says who, how long they have waited, why, the active alerts, who
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
  // Most urgent first; within a priority the server's order (longest wait first).
  const sorted = PRIORITIES.flatMap((p) => shown.filter((r) => r.priority === p));

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
        subtitle="Clients with a signed triage, most urgent first. Open a client to start or continue the review."
      />
      <ErrorNote>{error ?? openError}</ErrorNote>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">Find in queue</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-500"
          />
          <input
            type="search"
            autoComplete="off"
            className={`${INPUT} !h-11 !rounded-xl !bg-surface-card !pl-11 !text-[14px]`}
            placeholder="Find by name, presenting concern or who signed the triage"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div
          role="group"
          aria-label="Queue filter"
          className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-surface-border bg-surface-card p-1"
        >
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={view === v.key}
              onClick={() => setView(v.key)}
              className={`whitespace-nowrap rounded-[9px] px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                view === v.key
                  ? "bg-brand-green text-on-primary"
                  : "text-ink-900 hover:bg-surface-bg"
              }`}
            >
              {v.label} ({counts[v.key]})
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

      {sorted.length > 0 && (
        <section aria-label="Psychiatry queue">
          <p className="mb-2.5 text-[13.5px] font-semibold text-ink-500">
            {sorted.length} {sorted.length === 1 ? "client" : "clients"}
          </p>
          <div className="rounded-[14px] border border-surface-border bg-surface-card">
            <div
              aria-hidden
              className={`${ROW_GRID} hidden h-[42px] rounded-t-[14px] border-b border-surface-border bg-surface-bg px-5 text-[11.5px] font-semibold uppercase tracking-[.07em] text-ink-500 lg:grid`}
            >
              <span>Client name</span>
              <span>Priority</span>
              <span>Presenting concern</span>
              <span>Triage signed</span>
              <span>Waiting time</span>
              <span className="sr-only">Action</span>
            </div>
            <ul className="divide-y divide-surface-border">
              {sorted.map((row) => (
                <QueueRow
                  key={row.id}
                  row={row}
                  opening={opening}
                  onOpen={() => void openReview(row)}
                  onSaved={() => setTick((t) => t + 1)}
                />
              ))}
            </ul>
          </div>
        </section>
      )}

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

// One row per client: client · priority · concern · triage signed · waiting · action.
const ROW_GRID =
  "lg:grid lg:grid-cols-[minmax(170px,1.3fr)_150px_minmax(200px,1.3fr)_minmax(190px,1.2fr)_120px_170px] lg:items-center lg:gap-4";

function waitText(row: PsychiatryQueueRow) {
  if (row.review_started_at) return "In review";
  if (row.wait_minutes === null) return "—";
  const h = Math.floor(row.wait_minutes / 60);
  const m = row.wait_minutes % 60;
  return `${h ? `${h} h ` : ""}${String(m).padStart(h ? 2 : 1, "0")} min`;
}

function QueueRow({
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
    row.age !== null ? `${row.age} yrs` : "",
    row.sex ? row.sex.charAt(0) + row.sex.slice(1).toLowerCase() : "",
  ].filter(Boolean);
  const longLabel = row.priority === "RED" ? "Emergency / Immediate" : PRIORITY_LABEL[row.priority];
  const responsible = row.owner?.name || row.team;
  return (
    <li
      className={`${ROW_GRID} grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 last:rounded-b-[14px] hover:bg-surface-bg max-lg:border-l-4 max-lg:pl-6 ${PRIORITY_EDGE[row.priority]}`}
    >
      <div className="min-w-0">
        <strong className="block truncate text-[15px] font-semibold text-ink-900">
          {row.name || "Unknown client"}
        </strong>
        {details.length > 0 && (
          <span className="block text-[13px] text-ink-500">{details.join(" · ")}</span>
        )}
      </div>

      <div>
        <PriorityPill priority={row.priority} />
        <span className="mt-0.5 block text-[13px] text-ink-500">{longLabel}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        {row.presenting_concern ? (
          <p
            className="line-clamp-2 text-[14px] font-medium text-ink-900"
            title={row.presenting_concern}
          >
            {row.presenting_concern}
          </p>
        ) : (
          <p className="text-[13px] text-ink-500">Concern not recorded</p>
        )}
        {row.withdrawal_review && (
          <WithdrawalReviewCell review={row.withdrawal_review} onSaved={onSaved} />
        )}
      </div>

      <div className="min-w-0">
        <span className="block font-medium tabular-nums text-ink-900">
          {formatDateTime(row.signed_at)}
        </span>
        <span className="block text-[13px] text-ink-500">{row.signed_by || "—"}</span>
      </div>

      <div>
        <span
          className={`block font-semibold tabular-nums ${
            row.over_target || row.priority === "RED" ? "text-priority-red" : "text-ink-900"
          }`}
        >
          {waitText(row)}
        </span>
        {row.over_target && row.target_minutes !== null && (
          <span className="block text-[12px] text-priority-red">
            over the {row.target_minutes} min target
          </span>
        )}
        {responsible && (
          <span className="block text-[12px] text-ink-500" title="Responsible">
            {responsible}
          </span>
        )}
      </div>

      <div className="col-span-2 flex lg:col-span-1 lg:justify-end">
        <button
          type="button"
          className={`${BTN} !rounded-full !px-4 !py-2 !text-[13.5px] whitespace-nowrap`}
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
