import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardPlus, Search } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import {
  getPsychiatryCandidates,
  PRIORITY_LABEL,
  type PsychiatryCandidate,
} from "../../lib/carePathwayApi";
import { EmptyState } from "../../components/EmptyState";
import { formatDate, formatDateTime } from "./shared/format";
import { psychiatryAssessmentPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "./shared/styles";
import { Card, ErrorNote, PageHeader, PriorityPill, Tag } from "./shared/ui";
import { useRecordData } from "./record/useRecordData";

type View = "needs" | "intake" | "reviewed" | "all";

const VIEWS: { key: View; label: string }[] = [
  { key: "needs", label: "Needs assessment" },
  { key: "intake", label: "Intake complete" },
  { key: "reviewed", label: "Assessed" },
  { key: "all", label: "All clients" },
];

const searchText = (row: PsychiatryCandidate) =>
  [
    row.name,
    row.mrn,
    row.citramac_number,
    row.presenting_concern,
    row.suggested_reason,
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
    return true;
  };
  const counts = Object.fromEntries(
    VIEWS.map((item) => [item.key, rows.filter((row) => inView(row, item.key)).length]),
  ) as Record<View, number>;
  const shown = rows.filter(
    (row) => inView(row, view) && (!needle || searchText(row).includes(needle)),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Clinical workflow"
        title="Psychiatry"
        subtitle="Assess, examine mental state, diagnose and prescribe in one place. Clients appear here when triage or withdrawal review suggests a psychiatric review, or when their intake is signed."
      />
      <ErrorNote>{error}</ErrorNote>

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
            ? "Clients appear here after their triage recommends psychiatric review, or once their intake is signed."
            : needle
              ? "No client matches that search."
              : "No client in this view — try “All clients”."}
        </EmptyState>
      )}

      {shown.length > 0 && (
        <Card
          title={`${shown.length} ${shown.length === 1 ? "client" : "clients"}`}
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
                  <th className={TH}>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
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
                        {row.presenting_concern && (
                          <span className="mt-1 block max-w-[320px] text-[12.5px] leading-5 text-ink-700">
                            {row.presenting_concern}
                          </span>
                        )}
                      </td>
                      <td className={TD}>
                        {row.priority ? (
                          <>
                            <PriorityPill priority={row.priority} />
                            <span className="mt-0.5 block text-[12px] text-ink-500">
                              {PRIORITY_LABEL[row.priority]}
                            </span>
                          </>
                        ) : (
                          <Tag>No triage priority</Tag>
                        )}
                      </td>
                      <td className={TD}>
                        <span className="block max-w-[260px] text-[12.5px] leading-5 text-ink-700">
                          {row.suggested_reason}
                        </span>
                        {row.review && (
                          <span className="mt-1 block">
                            <Tag tone={row.review.status === "PENDING" ? "brand" : "warn"}>
                              Psychiatric review {row.review.status.toLowerCase()}
                            </Tag>
                          </span>
                        )}
                        {row.alerts.length > 0 && (
                          <span className="mt-1 block text-[12px] font-medium text-priority-red">
                            {row.alerts.slice(0, 2).join(" · ")}
                            {row.alerts.length > 2 ? ` · +${row.alerts.length - 2}` : ""}
                          </span>
                        )}
                      </td>
                      <td className={TD}>
                        {row.intake_complete ? (
                          <>
                            <Tag tone="brand">Signed</Tag>
                            <span className="mt-0.5 block text-[12px] text-ink-500">
                              {formatDate(row.intake_signed_at)}
                            </span>
                          </>
                        ) : (
                          <Tag>Not signed</Tag>
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
                        {!row.assessment_status && row.intake_signed_at && (
                          <span className="mt-0.5 block text-[12px] text-ink-500">
                            Intake {formatDate(row.intake_signed_at)}
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-right`}>
                        <button
                          type="button"
                          className={`${row.assessment_status === "DRAFT" ? BTN : BTN_GHOST} ${BTN_SM}`}
                          onClick={() => navigate(psychiatryAssessmentPath(row.patient_id))}
                          disabled={!accessToken}
                        >
                          <ClipboardPlus aria-hidden className="h-4 w-4" />
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
