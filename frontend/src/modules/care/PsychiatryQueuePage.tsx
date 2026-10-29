import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import {
  completePsychiatricReview,
  getPsychiatryQueue,
  openPsychiatryReview,
  type PsychiatryQueueRow,
  type WithdrawalReview,
} from "../../lib/carePathwayApi";
import { formatDateTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, INPUT, PRIORITY_EDGE, TABLE, TD, TH } from "./shared/styles";
import { EmptyState } from "../../components/EmptyState";
import { TableSkeletonRows } from "../../components/Skeleton";
import { SortHeader, TableFilter } from "./shared/TableControls";
import { useTableControls } from "./shared/useTableControls";
import { Card, ErrorNote, PageHeader, PriorityPill, SelectChoices, Tag } from "./shared/ui";
import { useValueSets } from "./shared/useValueSets";
import { errorText } from "./triage/helpers";
import { useRecordData } from "./record/useRecordData";
import { LiveQueue } from "./triage/LiveQueue";

const REFRESH_MS = 60_000;

const PRIORITY_RANK: Record<string, number> = { RED: 0, ORANGE: 1, YELLOW: 2, GREEN: 3 };
const SORTS = {
  client: (row: PsychiatryQueueRow) => row.name || "",
  priority: (row: PsychiatryQueueRow) => PRIORITY_RANK[row.priority] ?? 9,
  signed: (row: PsychiatryQueueRow) => new Date(row.signed_at).getTime() || null,
};
const searchText = (row: PsychiatryQueueRow) =>
  [row.name, row.mrn, row.citramac_number, row.presenting_concern, row.priority].join(" ");

/**
 * Psychiatry — priority queue. docs/15-CLINICAL-WORKSPACE-V3.md §1.8 (mapping
 * M4); mockup `psychiatry(true)`. Every client with a signed triage, RED →
 * GREEN, most recently signed first within a priority (ordered server-side).
 */
export function PsychiatryQueuePage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
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
  const rows: PsychiatryQueueRow[] = data?.results ?? [];
  // Starts in the server's order (RED → GREEN, longest wait first); headers re-sort.
  const controls = useTableControls(data ? rows : null, { sorts: SORTS, searchText });

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
    <div>
      <PageHeader
        eyebrow="Clinical workflow"
        title="Psychiatry — priority queue"
        subtitle="Signed triage referrals · highest priority first"
      />
      <ErrorNote>{error ?? openError}</ErrorNote>
      {/* v4 live queue (mockup renderQueue): all four lanes; the table below is the
          sortable list of signed triage referrals. */}
      <Card className="mb-5 mt-3" title="Live queue" bodyClassName="p-4">
        <LiveQueue
          opening={opening}
          onOpenReview={(row) => {
            const match = rows.find((r) => r.id === row.id);
            if (match) void openReview(match);
            else navigate(`/clinical/triage/${row.id}`);
          }}
        />
      </Card>
      <Card
        className="mb-5 mt-3"
        title="Clients queued for psychiatric review · RED → ORANGE → YELLOW → GREEN"
        aside={
          <Tag>
            {rows.length} {rows.length === 1 ? "client" : "clients"}
          </Tag>
        }
        bodyClassName="p-0"
      >
        <TableFilter
          controls={controls}
          label="Filter the psychiatry queue"
          placeholder="Filter by name, number or concern…"
        />
        <div className="overflow-x-auto">
          <table
            className={`${TABLE} min-w-[720px]`}
            aria-label="Clients queued for psychiatric review"
          >
            <thead>
              <tr>
                <SortHeader controls={controls} sortKey="client">
                  Client
                </SortHeader>
                <SortHeader controls={controls} sortKey="priority">
                  Triage priority
                </SortHeader>
                <th className={TH}>Presenting concern</th>
                <SortHeader controls={controls} sortKey="signed">
                  Triage signed
                </SortHeader>
                <th className={TH}>
                  <span className="sr-only">Open psychiatric review</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!data && loading && <TableSkeletonRows columns={5} />}
              {controls.rows.length > 0
                ? controls.rows.map((row) => (
                    <tr key={row.id}>
                      <td className={`${TD} border-l-4 ${PRIORITY_EDGE[row.priority]}`}>
                        <strong>{row.name || "Unknown client"}</strong>
                        <br />
                        <span className="break-all font-mono text-[11px] text-ink-500">
                          {row.citramac_number || "CITRAMAC ID not recorded"} · MRN{" "}
                          {row.mrn || "not recorded"}
                        </span>
                      </td>
                      <td className={TD}>
                        <PriorityPill priority={row.priority} long />
                      </td>
                      <td className={TD}>{row.presenting_concern || "Not recorded"}</td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {formatDateTime(row.signed_at)}
                        {row.wait_minutes !== null && (
                          <Tag tone={row.over_target ? "risk" : "neutral"}>
                            {row.over_target ? `Over target (${row.target_minutes} min) · ` : ""}waiting {row.wait_minutes} min
                          </Tag>
                        )}
                        <br />
                        <span className="text-[11px] text-ink-500">
                          {row.signed_by || "Clinician not recorded"}
                        </span>
                      </td>
                      <td className={TD}>
                        <div className="flex flex-col items-start gap-1.5">
                          <button
                            type="button"
                            className={`${BTN_GHOST} ${BTN_SM}`}
                            disabled={opening !== null}
                            aria-label={`Open review for ${row.name || "unknown client"}`}
                            onClick={() => void openReview(row)}
                          >
                            {opening === row.id ? "Opening…" : "Open review"}
                          </button>
                          {row.review_started_at && <Tag tone="brand">Review started</Tag>}
                          {row.withdrawal_review && (
                            <WithdrawalReviewCell
                              review={row.withdrawal_review}
                              onSaved={() => setTick((t) => t + 1)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                : data && (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState
                          title={
                            rows.length === 0 ? "The queue is empty" : "No one matches that filter"
                          }
                        >
                          {rows.length === 0
                            ? "Signed triage assessments will appear here for psychiatric review."
                            : "Clear the filter to see the whole queue."}
                        </EmptyState>
                      </td>
                    </tr>
                  )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
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
