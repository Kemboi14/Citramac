import { Pager, usePaged } from "../../components/Pager";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Search } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import {
  getPsychiatryCandidates,
  PRIORITY_LABEL,
  type PsychiatryCandidate,
} from "../../lib/carePathwayApi";
import { EmptyState } from "../../components/EmptyState";
import { formatDate, formatDateTime, formatTime } from "./shared/format";
import { psychiatryAssessmentPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "./shared/styles";
import { Callout, Card, ErrorNote, PageHeader, PriorityPill, Tag } from "./shared/ui";
import { useRecordData } from "./record/useRecordData";

type View = "needs" | "intake" | "reviewed" | "sessions" | "all";

const VIEWS: { key: View; label: string }[] = [
  { key: "needs", label: "Need assessment" },
  { key: "intake", label: "Intake complete" },
  { key: "reviewed", label: "Assessed" },
  { key: "sessions", label: "Sessions" },
  { key: "all", label: "All clients" },
];

const searchText = (row: PsychiatryCandidate) =>
  [
    row.name,
    row.mrn,
    row.citramac_number,
    row.presenting_concern,
    row.suggested_reason,
    row.next_scheduled_session?.appointment_type,
    row.next_scheduled_session?.provider_name,
    ...row.alerts,
  ]
    .join(" ")
    .toLowerCase();

function needsAssessment(row: PsychiatryCandidate) {
  if (row.assessment_status === "DRAFT") return true;
  return row.suggested;
}

function assessmentLabel(row: PsychiatryCandidate) {
  if (row.assessment_status === "DRAFT") return "Draft in progress";
  if (row.assessment_status === "SIGNED") return "Assessment signed";
  return "Not started";
}

function actionLabel(row: PsychiatryCandidate) {
  if (row.assessment_status === "DRAFT") return "Continue draft";
  if (row.assessment_status === "SIGNED") return "Start follow-up";
  return "Start assessment";
}

function sessionTag(session: NonNullable<PsychiatryCandidate["next_scheduled_session"]>) {
  if (session.due_state === "OVERDUE") {
    const days = session.days_until ?? 0;
    return `Overdue${days ? ` · ${days} ${days === 1 ? "day" : "days"}` : ""}`;
  }
  if (session.due_state === "TODAY") return `Today · ${formatTime(session.scheduled_for)}`;
  if (session.due_state === "TOMORROW") return `Tomorrow · ${formatTime(session.scheduled_for)}`;
  return formatDateTime(session.scheduled_for);
}

function sessionTone(session: NonNullable<PsychiatryCandidate["next_scheduled_session"]>) {
  if (session.due_state === "OVERDUE") return "risk" as const;
  if (session.due_state === "TODAY" || session.due_state === "TOMORROW") return "warn" as const;
  return "brand" as const;
}

/**
 * Psychiatry — the psychiatrist's module landing page. It lists clients the
 * system suggested for psychiatric review (signed triage / withdrawal review)
 * and every client with a signed intake, with the assessment state on each row.
 */
export function PsychiatryAssessmentsPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("needs");
  const [query, setQuery] = useState("");

  const { data, error, loading } = useRecordData(
    "psychiatry-module-clients",
    0,
    (token) => getPsychiatryCandidates(token),
    "Couldn't load the psychiatry client list.",
  );
  const rows = useMemo(() => data?.results ?? [], [data]);
  const needle = query.trim().toLowerCase();

  const inView = (row: PsychiatryCandidate, key: View) => {
    if (key === "needs") return needsAssessment(row);
    if (key === "intake") return row.intake_complete;
    if (key === "reviewed") return row.assessment_status === "SIGNED";
    if (key === "sessions") return Boolean(row.next_scheduled_session);
    return true;
  };
  const counts = Object.fromEntries(
    VIEWS.map((item) => [item.key, rows.filter((row) => inView(row, item.key)).length]),
  ) as Record<View, number>;
  const shown = rows.filter(
    (row) => inView(row, view) && (!needle || searchText(row).includes(needle)),
  );
  const paged = usePaged(shown);
  const dueToday = rows.filter((row) => row.next_scheduled_session?.due_state === "TODAY").length;
  const overdue = rows.filter((row) => row.next_scheduled_session?.due_state === "OVERDUE").length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Clinical workflow"
        title="Psychiatry"
        subtitle="Assess, examine mental state, diagnose and prescribe in one place. Clients appear here when triage or withdrawal review suggests a psychiatric review, when their intake is signed, or when a session is booked."
      />
      <ErrorNote>{error}</ErrorNote>

      {(dueToday > 0 || overdue > 0) && (
        <Callout tone="warning" label="Sessions due">
          {[
            overdue > 0 ? `${overdue} ${overdue === 1 ? "session" : "sessions"} overdue` : "",
            dueToday > 0 ? `${dueToday} due today` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
          . Open the client to continue the review or record what happened.
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">Find a client</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-500"
          />
          <input
            type="search"
            autoComplete="off"
            className={`${INPUT} !h-11 !rounded-xl !bg-surface-card !pl-11 !text-[14px]`}
            placeholder="Find by name, MRN, CITRAMAC ID, concern or alert"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div
          role="group"
          aria-label="Client list filter"
          className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-surface-border bg-surface-card p-1"
        >
          {VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={view === item.key}
              onClick={() => setView(item.key)}
              className={`whitespace-nowrap rounded-[9px] px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                view === item.key
                  ? "bg-brand-green text-on-primary"
                  : "text-ink-900 hover:bg-surface-bg"
              }`}
            >
              {item.label} ({counts[item.key]})
            </button>
          ))}
        </div>
      </div>

      {!data && loading && <p className="text-[13px] text-ink-500">Loading clients…</p>}
      {data && shown.length === 0 && (
        <EmptyState title={rows.length === 0 ? "No clients to assess yet" : "No one here"}>
          {rows.length === 0
            ? "Clients appear here after their triage recommends psychiatric review, once their intake is signed, or when a session is booked."
            : needle
              ? "No client matches that search."
              : "No client in this view — try “All clients”."}
        </EmptyState>
      )}

      {shown.length > 0 && (
        <Card
          title={`${shown.length} ${shown.length === 1 ? "client" : "clients"}`}
          aside={<Pager {...paged.pager} />}
          bodyClassName=""
        >
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Client</th>
                  <th className={TH}>Priority</th>
                  <th className={TH}>Why here</th>
                  <th className={TH}>Intake</th>
                  <th className={TH}>Assessment</th>
                  <th className={TH}>Next session</th>
                  <th className={TH}>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((row) => {
                  const details = [
                    row.age !== null ? `${row.age} yrs` : "",
                    row.sex ? row.sex.charAt(0) + row.sex.slice(1).toLowerCase() : "",
                  ].filter(Boolean);
                  return (
                    <tr key={row.patient_id} className="hover:bg-surface-bg">
                      <td className={TD}>
                        <strong className="block text-[14px] font-semibold text-ink-900">
                          {row.name || "Unknown client"}
                        </strong>
                        <span className="block text-[12.5px] text-ink-500">
                          {[details.join(" · "), `CITRAMAC ${row.citramac_number || "—"}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </td>
                      <td className={TD}>
                        {row.priority ? (
                          <span title={PRIORITY_LABEL[row.priority]}>
                            <PriorityPill priority={row.priority} />
                          </span>
                        ) : (
                          <span className="text-[12px] text-ink-500">—</span>
                        )}
                      </td>
                      <td className={TD}>
                        <span
                          className="line-clamp-2 block max-w-[300px] text-[13px] leading-5 text-ink-900"
                          title={row.suggested_reason}
                        >
                          {row.suggested_reason}
                        </span>
                        {(row.review || row.alerts.length > 0) && (
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-500">
                            {row.review && <span>Review {row.review.status.toLowerCase()}</span>}
                            {row.review && row.alerts.length > 0 && <span aria-hidden>·</span>}
                            {row.alerts.length > 0 && (
                              <span
                                className="font-medium text-priority-red"
                                title={row.alerts.join("\n")}
                              >
                                {row.alerts.length} active{" "}
                                {row.alerts.length === 1 ? "alert" : "alerts"}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className={TD}>
                        {row.intake_complete ? (
                          <span className="whitespace-nowrap text-[12.5px] text-ink-900">
                            Signed {formatDate(row.intake_signed_at)}
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-[12.5px] text-ink-500">
                            Not signed
                          </span>
                        )}
                      </td>
                      <td className={TD}>
                        <span className="block text-[12.5px] font-semibold text-ink-900">
                          {assessmentLabel(row)}
                        </span>
                        {row.assessment_status === "DRAFT" && (
                          <span className="mt-0.5 block text-[12px] text-ink-500">
                            Updated {formatDateTime(row.assessment_updated_at)}
                          </span>
                        )}
                        {row.assessment_status === "SIGNED" && (
                          <span className="mt-0.5 block text-[12px] text-ink-500">
                            Signed {formatDateTime(row.assessment_signed_at)}
                          </span>
                        )}
                      </td>
                      <td className={TD}>
                        {row.next_scheduled_session ? (
                          <>
                            <Tag tone={sessionTone(row.next_scheduled_session)}>
                              {sessionTag(row.next_scheduled_session)}
                            </Tag>
                            <span className="mt-1 block text-[12px] text-ink-500">
                              {formatDateTime(row.next_scheduled_session.scheduled_for)}
                              {row.next_scheduled_session.provider_name
                                ? ` · ${row.next_scheduled_session.provider_name}`
                                : ""}
                            </span>
                          </>
                        ) : (
                          <span className="whitespace-nowrap text-[12px] text-ink-500">
                            Not scheduled
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-right`}>
                        <button
                          type="button"
                          className={`${row.assessment_status === "DRAFT" ? BTN : BTN_GHOST} ${BTN_SM} whitespace-nowrap`}
                          onClick={() => navigate(psychiatryAssessmentPath(row.patient_id))}
                          disabled={!accessToken}
                        >
                          {actionLabel(row)}
                          <ArrowRight aria-hidden className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
