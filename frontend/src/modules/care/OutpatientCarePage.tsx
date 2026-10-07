import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { listAppointments, type Appointment } from "../../lib/appointmentsApi";
import {
  getCarePlan,
  getOutpatients,
  updateCarePlan,
  type CarePlan,
  type OutpatientRow,
} from "../../lib/carePathwayApi";
import { getMhpTeamRoster, type MhpTeamRosterRow } from "../../lib/mhpExtrasApi";
import {
  isFullSession,
  listPsychotherapySessions,
  type PsychotherapySession,
  type PsychotherapySessionType,
} from "../../lib/psychotherapyApi";
import { formatDate, formatDateTime } from "./shared/format";
import { BTN, BTN_GHOST, GROUP_LABEL, INPUT, TABLE, TD, TH } from "./shared/styles";
import {
  Callout,
  Card,
  CheckChoices,
  ErrorNote,
  Field,
  PageHeader,
  PriorityPill,
  SelectChoices,
  Tag,
} from "./shared/ui";
import { useValueSets, type ValueSetsApi } from "./shared/useValueSets";

// Outpatient Care — docs/15-CLINICAL-WORKSPACE-V3.md §1.11, mockup `outpatient()`.
// All three Psychotherapy nav items open this page; `kind` picks which session
// type feeds "Progress Notes".

type Kind = "individual" | "family" | "group";

const SESSION_TYPE: Record<Kind, PsychotherapySessionType> = {
  individual: "INDIVIDUAL",
  family: "FAMILY",
  group: "GROUP",
};

const SESSION_LABEL: Record<PsychotherapySessionType, string> = {
  INDIVIDUAL: "Individual psychotherapy",
  FAMILY: "Family psychotherapy",
  GROUP: "Group psychotherapy",
};

function rosterName(member: MhpTeamRosterRow) {
  return `${member.first_name} ${member.last_name}`.trim() || member.email;
}

export function OutpatientCarePage({ kind }: { kind: Kind }) {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const valueSets = useValueSets();
  const [rows, setRows] = useState<OutpatientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<MhpTeamRosterRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const planRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getOutpatients(accessToken)
      .then((res) => !cancelled && setRows(res.results))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load active outpatients."),
      );
    getMhpTeamRoster(accessToken)
      .then((res) => !cancelled && setRoster(res))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const list = rows ?? [];
  const selected = list.find((r) => r.patient_id === selectedId) ?? list[0];

  return (
    <div className="flex animate-fade-in flex-col gap-5">
      <PageHeader
        title="Outpatient Care"
        subtitle="Treatment plans, therapy, and follow-up"
        actions={
          <>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={!selected}
              onClick={() =>
                planRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              Treatment Plan
            </button>
            <button
              type="button"
              className={BTN}
              onClick={() => navigate("/clinical/appointments")}
            >
              Schedule Follow-up
            </button>
          </>
        }
      />

      <ErrorNote>{error}</ErrorNote>
      <ErrorNote>{valueSets.error}</ErrorNote>

      <Card title={`Active Outpatients (${list.length})`} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[720px]`}>
            <thead>
              <tr>
                <th className={TH}>Client</th>
                <th className={TH}>Diagnosis</th>
                <th className={TH}>Priority</th>
                <th className={TH}>Last Visit</th>
                <th className={TH}>Next Appointment</th>
                <th className={TH}>Status</th>
              </tr>
            </thead>
            <tbody>
              {!rows && !error && (
                <tr>
                  <td colSpan={6} className={`${TD} text-center text-ink-500`}>
                    Loading…
                  </td>
                </tr>
              )}
              {rows && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className={`${TD} py-6 text-center text-ink-500`}>
                    No active outpatients. Clients appear here once they have an open episode of
                    care and are not admitted.
                  </td>
                </tr>
              )}
              {list.map((row) => {
                const isSelected = row.patient_id === selected?.patient_id;
                return (
                  <tr
                    key={row.patient_id}
                    tabIndex={0}
                    aria-selected={isSelected}
                    onClick={() => setSelectedId(row.patient_id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(row.patient_id);
                      }
                    }}
                    className={`cursor-pointer outline-none focus-visible:bg-surface-bg ${
                      isSelected
                        ? "bg-brand-green-tint [&>td:first-child]:shadow-[inset_3px_0_0_var(--green)]"
                        : "hover:bg-surface-bg"
                    }`}
                  >
                    <td className={TD}>
                      <strong>{row.name}</strong>
                      <br />
                      <span className="font-mono text-[11px] text-ink-500">
                        {row.citramac_number || "—"}
                      </span>
                    </td>
                    <td className={TD}>{row.diagnosis || "Not assessed"}</td>
                    <td className={TD}>
                      <PriorityPill priority={row.priority} />
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{formatDate(row.last_visit)}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {formatDate(row.next_appointment)}
                    </td>
                    <td className={TD}>
                      <Tag tone="brand">{row.status}</Tag>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <div ref={planRef} className="scroll-mt-4">
            <TreatmentPlanCard
              key={selected.patient_id}
              client={selected}
              roster={roster}
              valueSets={valueSets}
            />
          </div>
          <div className="flex flex-col gap-4">
            <UpcomingAppointmentsCard key={`appt-${selected.patient_id}`} client={selected} />
            <ProgressNotesCard
              key={`notes-${selected.patient_id}-${kind}`}
              client={selected}
              // eslint-disable-next-line security/detect-object-injection -- `kind` is a typed union.
              sessionType={SESSION_TYPE[kind]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface PlanDraft {
  plan_type: string;
  interventions: string[];
  goals: string;
  review_date: string;
  care_coordinator: string;
}

function draftFrom(plan: CarePlan): PlanDraft {
  return {
    plan_type: plan.plan_type,
    interventions: plan.interventions,
    goals: plan.goals,
    review_date: plan.review_date ?? "",
    care_coordinator: plan.care_coordinator ?? "",
  };
}

function TreatmentPlanCard({
  client,
  roster,
  valueSets,
}: {
  client: OutpatientRow;
  roster: MhpTeamRosterRow[];
  valueSets: ValueSetsApi;
}) {
  const { accessToken } = useAuth();
  const [plan, setPlan] = useState<CarePlan | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getCarePlan(accessToken, client.patient_id)
      .then((res) => {
        if (cancelled) return;
        setPlan(res);
        setDraft(draftFrom(res));
      })
      .catch(
        (err) =>
          !cancelled &&
          setLoadError(
            err instanceof ApiError ? err.message : "Couldn't load this client's treatment plan.",
          ),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, client.patient_id]);

  const edit = (patch: Partial<PlanDraft>) => {
    setSavedAt(null);
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const save = async () => {
    if (!accessToken || !draft) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await updateCarePlan(accessToken, client.patient_id, {
        plan_type: draft.plan_type,
        interventions: draft.interventions,
        goals: draft.goals,
        review_date: draft.review_date || null,
        care_coordinator: draft.care_coordinator || null,
      });
      setPlan(updated);
      setDraft(draftFrom(updated));
      setSavedAt(updated.updated_at);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Couldn't save the treatment plan. Try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  // A coordinator outside the care-team roster still shows by name.
  const coordinatorMissing =
    plan?.care_coordinator && !roster.some((m) => m.user_id === plan.care_coordinator);

  return (
    <Card title={`Treatment Plan — ${client.name}`}>
      <ErrorNote>{loadError}</ErrorNote>
      {!draft && !loadError && <p className="text-[13px] text-ink-500">Loading…</p>}
      {draft && (
        <div className="flex flex-col">
          <Field label="Plan Type" htmlFor="plan-type">
            <SelectChoices
              id="plan-type"
              options={valueSets.options("care-plan-type")}
              value={draft.plan_type}
              placeholder="Select plan type"
              onChange={(code) => edit({ plan_type: code })}
            />
          </Field>
          <div className={GROUP_LABEL} id="plan-interventions">
            Interventions
          </div>
          <div role="group" aria-labelledby="plan-interventions">
            <CheckChoices
              options={valueSets.options("care-plan-intervention")}
              value={draft.interventions}
              columns={2}
              onChange={(codes) => edit({ interventions: codes })}
            />
          </div>
          <label htmlFor="plan-goals" className={GROUP_LABEL}>
            Goals
          </label>
          <textarea
            id="plan-goals"
            rows={3}
            className={INPUT}
            value={draft.goals}
            onChange={(e) => edit({ goals: e.target.value })}
          />
          <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <Field label="Review Date" htmlFor="plan-review">
              <input
                id="plan-review"
                type="date"
                className={INPUT}
                value={draft.review_date}
                onChange={(e) => edit({ review_date: e.target.value })}
              />
            </Field>
            <Field label="Care Coordinator" htmlFor="plan-coordinator">
              <select
                id="plan-coordinator"
                className={INPUT}
                value={draft.care_coordinator}
                onChange={(e) => edit({ care_coordinator: e.target.value })}
              >
                <option value="">Not assigned</option>
                {coordinatorMissing && plan?.care_coordinator && (
                  <option value={plan.care_coordinator}>{plan.care_coordinator_name}</option>
                )}
                {roster.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {rosterName(member)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <ErrorNote>{saveError}</ErrorNote>
            {savedAt && (
              <Callout tone="success" role="status">
                Treatment plan saved {formatDateTime(savedAt)}.
              </Callout>
            )}
            <div className="flex justify-end">
              <button type="button" className={BTN} disabled={isSaving} onClick={save}>
                {isSaving ? "Saving…" : "Save Treatment Plan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function UpcomingAppointmentsCard({ client }: { client: OutpatientRow }) {
  const { accessToken } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    const today = formatDate(new Date().toISOString());
    listAppointments(accessToken, { patient: client.patient_id, from: today })
      .then((res) => {
        if (cancelled) return;
        const now = Date.now();
        setAppointments(
          res.results
            .filter(
              (a) =>
                (a.status === "SCHEDULED" || a.status === "CHECKED_IN") &&
                new Date(a.scheduled_for).getTime() >= now,
            )
            .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)),
        );
      })
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load appointments."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, client.patient_id]);

  return (
    <Card title="Upcoming Appointments" bodyClassName="p-0">
      {error && (
        <div className="p-[18px]">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Type</th>
              <th className={TH}>Provider</th>
            </tr>
          </thead>
          <tbody>
            {!appointments && !error && (
              <tr>
                <td colSpan={3} className={`${TD} text-center text-ink-500`}>
                  Loading…
                </td>
              </tr>
            )}
            {appointments && appointments.length === 0 && (
              <tr>
                <td colSpan={3} className={`${TD} py-6 text-center text-ink-500`}>
                  No upcoming appointments.
                </td>
              </tr>
            )}
            {appointments?.map((a) => (
              <tr key={a.id} className="hover:bg-surface-bg">
                <td className={`${TD} whitespace-nowrap`}>{formatDate(a.scheduled_for)}</td>
                <td className={TD}>{a.appointment_type || "—"}</td>
                <td className={TD}>{a.provider_name || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ProgressNotesCard({
  client,
  sessionType,
}: {
  client: OutpatientRow;
  sessionType: PsychotherapySessionType;
}) {
  const { accessToken } = useAuth();
  const [sessions, setSessions] = useState<PsychotherapySession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listPsychotherapySessions(accessToken, { patient: client.patient_id, sessionType })
      .then((res) => !cancelled && setSessions(res.results))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load progress notes."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken, client.patient_id, sessionType]);

  return (
    <Card title="Progress Notes">
      <ErrorNote>{error}</ErrorNote>
      {!sessions && !error && <p className="text-[13px] text-ink-500">Loading…</p>}
      {sessions && sessions.length === 0 && (
        <p className="text-[13px] text-ink-500">
          {/* eslint-disable-next-line security/detect-object-injection -- typed union. */}
          No {SESSION_LABEL[sessionType].toLowerCase()} sessions recorded for {client.name}.
        </p>
      )}
      {sessions && sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          {sessions.map((session) => {
            const full = isFullSession(session);
            return (
              <article
                key={session.id}
                className="rounded-lg border border-surface-border bg-surface-bg px-3.5 py-3"
              >
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-900">
                    {full
                      ? session.therapist_name || "Therapist not recorded"
                      : SESSION_LABEL[session.session_type]}
                  </span>
                  <span className="font-mono text-[11px] text-ink-400">
                    {formatDateTime(session.session_date)}
                  </span>
                </div>
                <p className="whitespace-pre-line text-[12.5px] text-ink-500">
                  {full
                    ? session.session_notes || "No session notes recorded."
                    : "Session recorded — notes are visible to the care team only."}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}
