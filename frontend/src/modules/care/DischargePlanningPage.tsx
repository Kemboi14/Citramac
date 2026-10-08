import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { AuthenticatedDownloadButton } from "../../components/AuthenticatedDownloadButton";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ApiError } from "../../lib/apiClient";
import { fieldErrorsFrom, formErrorSummary } from "../../lib/formErrors";
import {
  amendDischarge,
  dischargeFhirPath,
  getAdmissionDischarge,
  getDischargeWorklist,
  saveDischargeDraft,
  signDischarge,
  type CurrentInpatientRow,
  type DischargeInput,
  type DischargePayload,
  type DischargeSummary,
  type DischargeWorklist,
  type RecentDischargeRow,
} from "../../lib/dischargeApi";
import { searchDrugIndex, type DrugIndexEntry } from "../../lib/pharmacyApi";
import { formatDateTime, formatTime } from "./shared/format";
import { clientRecordPath } from "./shared/recordRoutes";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "./shared/styles";
import { newRequestId } from "./shared/format";
import { EmptyState } from "../../components/EmptyState";
import { TableSkeletonRows } from "../../components/Skeleton";
import { SortHeader, TableFilter } from "./shared/TableControls";
import { useAutosaveDraft } from "./shared/useAutosaveDraft";
import { useTableControls } from "./shared/useTableControls";
import { useValueSets } from "./shared/useValueSets";
import {
  Callout,
  Card,
  CheckChoices,
  ErrorNote,
  Field,
  PageHeader,
  RadioChoices,
  SelectChoices,
  Tag,
} from "./shared/ui";
import { Breadcrumbs } from "./shared/Breadcrumbs";
import { SafetyBanner } from "./shared/SafetyBanner";
import { useClientBanner } from "./shared/useClientBanner";

// docs/17-DISCHARGE-AND-FOLLOW-UP.md — a discharge is a signed, versioned record
// (FHIR Composition), never free text on the admission.

export function DischargePlanningPage() {
  const [params, setParams] = useSearchParams();
  const admissionId = params.get("admission");
  if (admissionId) {
    return (
      <DischargeDetail
        key={admissionId}
        admissionId={admissionId}
        onBack={() => setParams({}, { replace: false })}
      />
    );
  }
  return <Worklist onOpen={(id) => setParams({ admission: id })} />;
}

// ── Worklist ──

const CURRENT_SORTS = {
  client: (row: CurrentInpatientRow) => row.patient_name,
  bed: (row: CurrentInpatientRow) => row.bed_label,
  admitted: (row: CurrentInpatientRow) => new Date(row.admitted_at).getTime(),
};
const currentSearch = (row: CurrentInpatientRow) =>
  [row.patient_name, row.citramac_number, row.bed_label, row.admission_type].join(" ");
const RECENT_SORTS = {
  client: (row: RecentDischargeRow) => row.patient_name,
  discharged: (row: RecentDischargeRow) => new Date(row.discharged_at).getTime(),
};
const recentSearch = (row: RecentDischargeRow) =>
  [row.patient_name, row.citramac_number, row.bed_label, row.disposition_label].join(" ");

function Worklist({ onOpen }: { onOpen: (admissionId: string) => void }) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<DischargeWorklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useTableControls(data ? data.current : null, {
    sorts: CURRENT_SORTS,
    searchText: currentSearch,
  });
  const recent = useTableControls(data ? data.recent : null, {
    sorts: RECENT_SORTS,
    searchText: recentSearch,
  });

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    getDischargeWorklist(accessToken)
      .then((result) => !cancelled && setData(result))
      .catch(
        (err) =>
          !cancelled &&
          setError(err instanceof ApiError ? err.message : "Couldn't load the discharge list."),
      );
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Inpatient & residential"
        title="Discharge planning"
        subtitle="Plan, sign and, if needed, amend each client's discharge"
      />
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <Card
        title="Current inpatients"
        aside={<Tag>{`${data?.current.length ?? 0} in hospital`}</Tag>}
        bodyClassName="p-0"
        className="mb-5"
      >
        <TableFilter controls={current} label="Filter current inpatients" />
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[760px]`} aria-label="Current inpatients">
            <thead>
              <tr>
                <SortHeader controls={current} sortKey="client">
                  Client
                </SortHeader>
                <SortHeader controls={current} sortKey="bed">
                  Bed
                </SortHeader>
                <th className={TH}>Type</th>
                <SortHeader controls={current} sortKey="admitted">
                  Admitted
                </SortHeader>
                <th className={TH}>Discharge plan</th>
                <th className={TH}>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!data && <TableSkeletonRows columns={6} />}
              {current.rows.length
                ? current.rows.map((row) => (
                    <tr key={row.admission_id}>
                      <td className={TD}>
                        <strong>{row.patient_name}</strong>
                        <div className="text-[11px] text-ink-500">{row.citramac_number}</div>
                      </td>
                      <td className={TD}>{row.bed_label}</td>
                      <td className={TD}>
                        <Tag tone={row.admission_type === "INVOLUNTARY" ? "warn" : "neutral"}>
                          {row.admission_type === "INVOLUNTARY" ? "Involuntary" : "Voluntary"}
                        </Tag>
                      </td>
                      <td className={TD}>
                        {formatDateTime(row.admitted_at)}
                        <div className="text-[11px] text-ink-500">{row.days_in} days</div>
                      </td>
                      <td className={TD}>
                        {row.state === "DRAFT" ? (
                          <Tag tone="brand">{`Draft saved ${formatDateTime(row.draft_saved_at)}`}</Tag>
                        ) : (
                          <Tag>Not started</Tag>
                        )}
                      </td>
                      <td className={TD}>
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          onClick={() => onOpen(row.admission_id)}
                        >
                          {row.state === "DRAFT" ? "Continue" : "Plan discharge"}
                        </button>
                      </td>
                    </tr>
                  ))
                : data && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          title={
                            data.current.length === 0
                              ? "No one is currently admitted"
                              : "No one matches that filter"
                          }
                        />
                      </td>
                    </tr>
                  )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Discharged in the last 30 days"
        aside={<Tag>{`${data?.recent.length ?? 0} discharged`}</Tag>}
        bodyClassName="p-0"
      >
        <TableFilter controls={recent} label="Filter recent discharges" />
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[760px]`} aria-label="Recent discharges">
            <thead>
              <tr>
                <SortHeader controls={recent} sortKey="client">
                  Client
                </SortHeader>
                <th className={TH}>Bed</th>
                <SortHeader controls={recent} sortKey="discharged">
                  Discharged
                </SortHeader>
                <th className={TH}>Disposition</th>
                <th className={TH}>Record</th>
                <th className={TH}>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!data && <TableSkeletonRows columns={6} />}
              {recent.rows.length
                ? recent.rows.map((row) => (
                    <tr key={row.admission_id}>
                      <td className={TD}>
                        <strong>{row.patient_name}</strong>
                        <div className="text-[11px] text-ink-500">{row.citramac_number}</div>
                      </td>
                      <td className={TD}>{row.bed_label}</td>
                      <td className={TD}>{formatDateTime(row.discharged_at)}</td>
                      <td className={TD}>{row.disposition_label || "—"}</td>
                      <td className={TD}>
                        {row.status === "LEGACY" ? (
                          <Tag tone="warn">Unsigned (legacy)</Tag>
                        ) : (
                          <Tag tone="brand">{`Signed · v${row.version}`}</Tag>
                        )}
                      </td>
                      <td className={TD}>
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          onClick={() => onOpen(row.admission_id)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))
                : data && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          title={
                            data.recent.length === 0
                              ? "No discharges in the last 30 days"
                              : "No one matches that filter"
                          }
                        />
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

// ── Detail: form, or the signed record ──

interface MedicationState {
  prescription_item: string | null;
  drug: string;
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  action: string;
  note: string;
}

interface FormState {
  disposition: string;
  destination: string;
  dischargedAt: string;
  clinicalStatus: string;
  treatmentSummary: string;
  legalStatus: string;
  education: string[];
  diagnoses: string[];
  medications: MedicationState[];
  followUpOn: boolean;
  followUpAt: string;
  followUpReason: string;
}

/** An ISO timestamp as the value of a datetime-local input (local time). */
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function initialForm(payload: DischargePayload): FormState {
  const summary = payload.summary;
  const context = payload.context;
  if (summary && summary.status === "IN_PROGRESS") {
    return {
      disposition: summary.disposition,
      destination: summary.destination ?? "",
      dischargedAt: toLocalInput(summary.discharged_at),
      clinicalStatus: summary.clinical_status ?? "",
      treatmentSummary: summary.treatment_summary ?? "",
      legalStatus: summary.legal_status_at_discharge ?? "",
      education: summary.education ?? [],
      diagnoses: (summary.diagnoses ?? []).map((d) => d.id),
      medications: (summary.medications ?? []).map((m) => ({
        prescription_item: m.prescription_item,
        drug: m.drug,
        drug_name: m.drug_name,
        dose: m.dose,
        route: m.route,
        frequency: m.frequency,
        duration: m.duration,
        action: m.action,
        note: m.note,
      })),
      followUpOn: false,
      followUpAt: "",
      followUpReason: "POST_DISCHARGE",
    };
  }
  return {
    disposition: "",
    destination: "",
    dischargedAt: "",
    clinicalStatus: "",
    treatmentSummary: "",
    legalStatus: "",
    education: [],
    diagnoses: (context?.diagnoses ?? []).map((d) => d.id),
    medications: (context?.medications ?? []).map((m) => ({
      prescription_item: m.prescription_item,
      drug: m.drug,
      drug_name: m.drug_name,
      dose: m.dose,
      route: m.route,
      frequency: m.frequency,
      duration: m.duration,
      action: "CONTINUE",
      note: "",
    })),
    followUpOn: false,
    followUpAt: "",
    followUpReason: "POST_DISCHARGE",
  };
}

function DischargeDetail({ admissionId, onBack }: { admissionId: string; onBack: () => void }) {
  const { accessToken } = useAuth();
  const [payload, setPayload] = useState<DischargePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setPayload(await getAdmissionDischarge(accessToken, admissionId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this discharge.");
    }
  }, [accessToken, admissionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount / id change.
    void load();
  }, [load]);

  const admission = payload?.admission;
  const summary = payload?.summary ?? null;
  const { banner, error: bannerError } = useClientBanner(admission?.patient_id);

  return (
    <div className="animate-fade-in">
      <Breadcrumbs
        items={[
          { label: "Discharge planning", to: "/clinical/discharge" },
          { label: admission ? admission.patient_name : "Discharge" },
        ]}
      />
      {admission && <SafetyBanner banner={banner} error={bannerError} />}
      <PageHeader
        eyebrow="Discharge planning"
        title={admission ? admission.patient_name : "Discharge"}
        subtitle={
          admission && (
            <>
              {admission.citramac_number} · {admission.bed_label} · admitted{" "}
              {formatDateTime(admission.admitted_at)}
              {admission.admission_type === "INVOLUNTARY" && " · involuntary admission"}
            </>
          )
        }
        actions={
          <>
            {admission && (
              <Link className={BTN_GHOST} to={clientRecordPath(admission.patient_id, "snapshot")}>
                Open client record
              </Link>
            )}
            <button type="button" className={BTN_GHOST} onClick={onBack}>
              Back to list
            </button>
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!payload && !error && <p className="text-sm text-ink-500">Loading…</p>}

      {payload?.restricted && (
        <Callout tone="warning" role="status">
          Discharge content is confidential to this client&apos;s care team. You can see that a
          discharge exists, but not its clinical content. Ask the care team or an Org Admin.
        </Callout>
      )}

      {payload && !payload.restricted && admission && (
        <>
          {summary && summary.status === "COMPLETED" ? (
            <SignedView
              payload={payload}
              summary={summary}
              onAmended={(next) => setPayload(next)}
            />
          ) : admission.status === "DISCHARGED" && !summary ? (
            <Callout tone="warning" role="status">
              This discharge was recorded before signed discharge summaries existed, so it has no
              signed record and cannot be amended here.
              {admission.legacy_summary && (
                <p className="mt-2 whitespace-pre-wrap text-ink-900">{admission.legacy_summary}</p>
              )}
            </Callout>
          ) : (
            <DischargeForm
              payload={payload}
              onChange={(next) => setPayload(next)}
              onSigned={(next) => setPayload(next)}
            />
          )}
        </>
      )}
    </div>
  );
}

function SignedView({
  payload,
  summary,
  onAmended,
}: {
  payload: DischargePayload;
  summary: DischargeSummary;
  onAmended: (next: DischargePayload) => void;
}) {
  const { accessToken } = useAuth();
  const valueSets = useValueSets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amend = async () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      onAmended(await amendDischarge(accessToken, summary.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start an amendment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Callout tone="success" role="status">
        <strong>Signed discharge summary, version {summary.version}.</strong> Signed{" "}
        {formatDateTime(summary.signed_at)} by {summary.signed_by_name || "—"}
        {summary.signed_role && ` (${summary.signed_role})`}. A signed summary cannot be edited; a
        correction is saved as a new version and the original is kept.
      </Callout>
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card
        title="Discharge"
        aside={
          <div className="flex flex-wrap items-center gap-3">
            <AuthenticatedDownloadButton
              path={dischargeFhirPath(summary.id)}
              filename={`discharge-summary-v${summary.version}.json`}
            >
              Download FHIR document
            </AuthenticatedDownloadButton>
            <button type="button" className={`${BTN} ${BTN_SM}`} disabled={busy} onClick={amend}>
              Amend (new version)
            </button>
          </div>
        }
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          <Item label="Disposition" value={summary.disposition_label} />
          <Item label="Discharged" value={formatDateTime(summary.discharged_at)} />
          <Item label="Destination" value={summary.destination} />
          <Item
            label="Follow-up"
            value={
              summary.follow_up
                ? `${summary.follow_up.reason_label} · ${formatDateTime(summary.follow_up.scheduled_for)}`
                : "None booked"
            }
          />
          <Item label="Clinical status at discharge" value={summary.clinical_status} wide />
          <Item label="Treatment summary" value={summary.treatment_summary} wide />
          {summary.legal_status_at_discharge && (
            <Item
              label="Legal status at discharge"
              value={summary.legal_status_at_discharge}
              wide
            />
          )}
        </dl>

        <h3 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-ink-500">
          Diagnoses
        </h3>
        {summary.diagnoses?.length ? (
          <ul className="text-[13px] text-ink-900">
            {summary.diagnoses.map((d) => (
              <li key={d.id}>
                <span className="font-mono text-xs text-ink-500">{d.code}</span> {d.description}
                {d.is_primary && <Tag tone="brand">primary</Tag>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-500">No coded diagnosis recorded.</p>
        )}

        <h3 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-ink-500">
          Discharge medication
        </h3>
        {summary.medications?.length ? (
          <div className="overflow-x-auto">
            <table className={`${TABLE} min-w-[620px]`} aria-label="Discharge medication">
              <thead>
                <tr>
                  <th className={TH}>Medicine</th>
                  <th className={TH}>Dose</th>
                  <th className={TH}>Action</th>
                  <th className={TH}>Note</th>
                </tr>
              </thead>
              <tbody>
                {summary.medications.map((m, index) => (
                  <tr key={`${m.drug}-${index}`}>
                    <td className={TD}>{m.drug_name}</td>
                    <td className={TD}>
                      {[m.dose, m.route, m.frequency, m.duration].filter(Boolean).join(" · ") ||
                        "—"}
                    </td>
                    <td className={TD}>
                      <Tag tone={m.action === "STOP" ? "warn" : "brand"}>
                        {m.action_label ?? valueSets.label("discharge-medication-action", m.action)}
                      </Tag>
                    </td>
                    <td className={TD}>{m.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-ink-500">No medication lines recorded.</p>
        )}

        <h3 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-wide text-ink-500">
          Education provided
        </h3>
        <p className="text-[13px] text-ink-900">
          {summary.education?.length
            ? summary.education.map((c) => valueSets.label("discharge-education", c)).join("; ")
            : "None recorded."}
        </p>
      </Card>

      <Card title="Versions">
        <ul className="text-[13px] text-ink-900">
          {payload.versions.map((v) => (
            <li key={v.id}>
              Version {v.version} ·{" "}
              {v.status === "COMPLETED"
                ? `signed ${formatDateTime(v.signed_at)} by ${v.signed_by_name || "—"}`
                : "draft"}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Item({ label, value, wide }: { label: string; value?: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-ink-900">{value || "—"}</dd>
    </div>
  );
}

/** The part of the form that is saved as the server-side draft (no follow-up booking). */
function draftInput(form: FormState): DischargeInput {
  const input: DischargeInput = {
    disposition: form.disposition,
    destination: form.destination,
    clinical_status: form.clinicalStatus,
    treatment_summary: form.treatmentSummary,
    legal_status_at_discharge: form.legalStatus,
    education: form.education,
    diagnoses: form.diagnoses,
    medications: form.medications.map((m) => ({
      prescription_item: m.prescription_item,
      drug: m.drug,
      dose: m.dose,
      route: m.route,
      frequency: m.frequency,
      duration: m.duration,
      action: m.action,
      note: m.note,
    })),
  };
  if (form.dischargedAt) input.discharged_at = new Date(form.dischargedAt).toISOString();
  return input;
}

/** Server fields the form shows next to their own input. */
const INLINE_FIELDS = [
  "disposition",
  "clinical_status",
  "treatment_summary",
  "legal_status_at_discharge",
  "discharged_at",
];

function DischargeForm({
  payload,
  onChange,
  onSigned,
}: {
  payload: DischargePayload;
  onChange: (next: DischargePayload) => void;
  onSigned: (next: DischargePayload) => void;
}) {
  const { accessToken } = useAuth();
  const valueSets = useValueSets();
  const [form, setForm] = useState<FormState>(() => initialForm(payload));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  // One stable id for this form session: a retried sign never double-books.
  const followUpRequestId = useRef(newRequestId());

  const summary = payload.summary;
  const amending = Boolean(summary?.supersedes);
  const context = payload.context;
  const involuntary = Boolean(context?.involuntary);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toInput = (): DischargeInput => {
    const input = draftInput(form);
    if (form.followUpOn && form.followUpAt && !amending) {
      input.follow_up = {
        scheduled_for: new Date(form.followUpAt).toISOString(),
        reason: form.followUpReason,
        client_request_id: followUpRequestId.current,
      };
    }
    return input;
  };

  // Every change is saved to the server a moment after the last keystroke, and
  // the browser warns before the tab closes while something is still unsaved.
  const draft = draftInput(form);
  const autosave = useAutosaveDraft({
    value: draft,
    enabled: !busy && !confirming,
    save: async (value) => {
      if (!accessToken) throw new Error("Not signed in");
      await saveDischargeDraft(accessToken, payload.admission.id, value);
    },
  });

  const run = async (
    work: (token: string) => Promise<DischargePayload>,
    done: (p: DischargePayload) => void,
  ) => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      done(await work(accessToken));
    } catch (err) {
      setFieldErrors(fieldErrorsFrom(err));
      setError(formErrorSummary(err, "That didn't work. Nothing was changed.", INLINE_FIELDS));
      setConfirming(false);
      // Bring the first problem into view.
      window.requestAnimationFrame(() =>
        document.querySelector('[role="alert"]')?.scrollIntoView?.({ block: "center" }),
      );
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () =>
    run(
      (token) => saveDischargeDraft(token, payload.admission.id, draftInput(form)),
      (next) => {
        autosave.markSaved(draft);
        onChange(next);
      },
    );

  const sign = () =>
    run(
      (token) => signDischarge(token, payload.admission.id, toInput()),
      (next) => {
        setConfirming(false);
        onSigned(next);
      },
    );

  const setMedication = (index: number, patch: Partial<MedicationState>) =>
    setForm((prev) => ({
      ...prev,
      medications: prev.medications.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));

  return (
    <div className="flex flex-col gap-4">
      {amending ? (
        <Callout tone="warning" role="status">
          You are amending version {(summary?.version ?? 2) - 1}. Signing saves version{" "}
          {summary?.version} and keeps the original unchanged.
        </Callout>
      ) : (
        <Callout>
          Signing this discharges the client: the admission is closed, the bed is freed and the
          admission encounter is closed. The client&apos;s episode of care stays open. A signed
          summary cannot be edited; corrections are saved as a new version.
        </Callout>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {valueSets.error && <ErrorNote>{valueSets.error}</ErrorNote>}

      <Card title="Disposition">
        <Field
          label="Discharge disposition"
          htmlFor="dc-disposition"
          error={fieldErrors.disposition}
        >
          <RadioChoices
            name="dc-disposition"
            options={valueSets.options("discharge-disposition")}
            value={form.disposition}
            onChange={(code) => set("disposition", code)}
          />
        </Field>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Destination (where the client is going)" htmlFor="dc-destination">
            <input
              id="dc-destination"
              className={INPUT}
              value={form.destination}
              onChange={(e) => set("destination", e.target.value)}
            />
          </Field>
          <Field
            label="Discharge date and time (blank = when signed)"
            htmlFor="dc-when"
            error={fieldErrors.discharged_at}
          >
            <input
              id="dc-when"
              type="datetime-local"
              className={INPUT}
              value={form.dischargedAt}
              onChange={(e) => set("dischargedAt", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card title="Clinical summary">
        <div className="grid grid-cols-1 gap-4">
          <Field
            label="Clinical status at discharge"
            htmlFor="dc-status"
            error={fieldErrors.clinical_status}
          >
            <textarea
              id="dc-status"
              rows={3}
              className={INPUT}
              value={form.clinicalStatus}
              onChange={(e) => set("clinicalStatus", e.target.value)}
            />
          </Field>
          <Field
            label="Treatment summary"
            htmlFor="dc-treatment"
            error={fieldErrors.treatment_summary}
          >
            <textarea
              id="dc-treatment"
              rows={4}
              className={INPUT}
              value={form.treatmentSummary}
              onChange={(e) => set("treatmentSummary", e.target.value)}
            />
          </Field>
          {involuntary && (
            <Field
              label={
                <>
                  Legal status at discharge <span className="text-priority-red">REQUIRED</span>
                </>
              }
              htmlFor="dc-legal"
              error={fieldErrors.legal_status_at_discharge}
            >
              <textarea
                id="dc-legal"
                rows={2}
                className={INPUT}
                value={form.legalStatus}
                placeholder={
                  context?.legal_order_reference
                    ? `What became of order ${context.legal_order_reference}?`
                    : "What became of the legal order?"
                }
                onChange={(e) => set("legalStatus", e.target.value)}
              />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Diagnoses at discharge">
        {context?.diagnoses.length ? (
          <div className="flex flex-col gap-1">
            {context.diagnoses.map((d) => (
              <label key={d.id} className="flex items-center gap-2 py-1 text-[13px] text-ink-900">
                <input
                  type="checkbox"
                  className="h-[17px] w-[17px] accent-[var(--green)]"
                  checked={form.diagnoses.includes(d.id)}
                  onChange={(e) =>
                    set(
                      "diagnoses",
                      e.target.checked
                        ? [...form.diagnoses, d.id]
                        : form.diagnoses.filter((id) => id !== d.id),
                    )
                  }
                />
                <span className="font-mono text-xs text-ink-500">{d.code}</span> {d.description}
                {d.is_primary && <Tag tone="brand">primary</Tag>}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ink-500">
            No coded diagnosis is recorded on this admission. Record it on the client&apos;s record
            first; discharge diagnoses are always coded, never typed.
          </p>
        )}
      </Card>

      <Card title="Discharge medication" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className={`${TABLE} min-w-[860px]`} aria-label="Discharge medication">
            <thead>
              <tr>
                <th className={TH}>Medicine</th>
                <th className={TH}>Dose</th>
                <th className={TH}>Route</th>
                <th className={TH}>Frequency</th>
                <th className={TH}>Action</th>
                <th className={TH}>Note</th>
                <th className={TH}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {form.medications.length ? (
                form.medications.map((m, index) => (
                  <tr key={`${m.drug}-${index}`}>
                    <td className={TD}>{m.drug_name}</td>
                    <td className={TD}>
                      <input
                        aria-label={`${m.drug_name} dose`}
                        className={INPUT}
                        value={m.dose}
                        onChange={(e) => setMedication(index, { dose: e.target.value })}
                      />
                    </td>
                    <td className={TD}>
                      <input
                        aria-label={`${m.drug_name} route`}
                        className={INPUT}
                        value={m.route}
                        onChange={(e) => setMedication(index, { route: e.target.value })}
                      />
                    </td>
                    <td className={TD}>
                      <input
                        aria-label={`${m.drug_name} frequency`}
                        className={INPUT}
                        value={m.frequency}
                        onChange={(e) => setMedication(index, { frequency: e.target.value })}
                      />
                    </td>
                    <td className={TD}>
                      <SelectChoices
                        id={`dc-action-${index}`}
                        options={valueSets.options("discharge-medication-action")}
                        value={m.action}
                        onChange={(code) => setMedication(index, { action: code })}
                      />
                    </td>
                    <td className={TD}>
                      <input
                        aria-label={`${m.drug_name} note`}
                        className={INPUT}
                        value={m.note}
                        onChange={(e) => setMedication(index, { note: e.target.value })}
                      />
                    </td>
                    <td className={TD}>
                      {!m.prescription_item && (
                        <button
                          type="button"
                          className={`${BTN_GHOST} ${BTN_SM}`}
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              medications: prev.medications.filter((_, i) => i !== index),
                            }))
                          }
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className={`${TD} text-center text-ink-500`}>
                    No medicines were prescribed on this admission. Add any new discharge medicine
                    below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-surface-border p-4">
          <NewMedicine
            onAdd={(drug) =>
              setForm((prev) => ({
                ...prev,
                medications: [
                  ...prev.medications,
                  {
                    prescription_item: null,
                    drug: drug.code,
                    drug_name: `${drug.generic_name}${drug.strength ? ` ${drug.strength}` : ""}`,
                    dose: "",
                    route: "",
                    frequency: "",
                    duration: "",
                    action: "NEW",
                    note: "",
                  },
                ],
              }))
            }
          />
        </div>
      </Card>

      <Card title="Education provided">
        <CheckChoices
          options={valueSets.options("discharge-education")}
          value={form.education}
          onChange={(codes) => set("education", codes)}
          columns={2}
        />
      </Card>

      {!amending && (
        <Card title="Follow-up">
          <label className="flex items-center gap-2 text-[13px] text-ink-900">
            <input
              type="checkbox"
              className="h-[17px] w-[17px] accent-[var(--green)]"
              checked={form.followUpOn}
              onChange={(e) => set("followUpOn", e.target.checked)}
            />
            Book a follow-up appointment when I sign
          </label>
          {form.followUpOn && (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Date and time" htmlFor="dc-fu-at">
                <input
                  id="dc-fu-at"
                  type="datetime-local"
                  className={INPUT}
                  value={form.followUpAt}
                  onChange={(e) => set("followUpAt", e.target.value)}
                />
              </Field>
              <Field label="Reason" htmlFor="dc-fu-reason">
                <SelectChoices
                  id="dc-fu-reason"
                  options={valueSets.options("follow-up-reason")}
                  value={form.followUpReason}
                  onChange={(code) => set("followUpReason", code)}
                />
              </Field>
            </div>
          )}
          <p className="mt-1 text-[12px] text-ink-500">
            The booking is made when you sign; it is not part of the saved draft.
          </p>
          {!form.followUpOn && (
            <p className="mt-2 text-[12px] text-ink-500">
              If none is booked, the client appears under &ldquo;Discharged, no follow-up
              booked&rdquo; on the Follow-up screen until one is.
            </p>
          )}
        </Card>
      )}

      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-surface-border bg-surface-card/95 px-1 py-3 backdrop-blur">
        <span className="text-[12px] text-ink-500" role="status">
          {autosave.failed
            ? "Draft not saved — check your connection"
            : autosave.dirty
              ? "Saving draft…"
              : autosave.savedAt
                ? `Draft saved ${formatTime(autosave.savedAt.toISOString())}`
                : summary?.draft_saved_at
                  ? `Draft saved ${formatDateTime(summary.draft_saved_at)}`
                  : "Nothing saved yet"}
        </span>
        <div className="flex gap-2">
          <button type="button" className={BTN_GHOST} disabled={busy} onClick={saveDraft}>
            Save draft
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={() => setConfirming(true)}>
            {amending ? "Sign amendment" : "Sign & discharge"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title={
          amending
            ? "Sign this amendment?"
            : `Sign and discharge ${payload.admission.patient_name}?`
        }
        confirmLabel={amending ? "Sign amendment" : "Sign & discharge"}
        busyLabel="Signing…"
        busy={busy}
        error={error}
        onConfirm={sign}
        onCancel={() => setConfirming(false)}
      >
        {amending
          ? "The earlier version stays on record unchanged. This version becomes the current one."
          : "This closes the admission, frees the bed and closes the admission encounter. A signed summary can't be edited — corrections are made as a new version."}
      </ConfirmDialog>
    </div>
  );
}

function NewMedicine({ onAdd }: { onAdd: (drug: DrugIndexEntry) => void }) {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DrugIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!accessToken || query.trim().length < 2) return;
    setError(null);
    try {
      setResults(await searchDrugIndex(accessToken, query.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't search the drug index.");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Add a new discharge medicine" htmlFor="dc-drug-search" className="flex-1">
          <input
            id="dc-drug-search"
            className={INPUT}
            value={query}
            placeholder="Search the national drug index…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void search();
              }
            }}
          />
        </Field>
        <button type="button" className={BTN_GHOST} onClick={search}>
          Search
        </button>
      </div>
      {error && (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {results && (
        <ul className="mt-2 divide-y divide-surface-border rounded-lg border border-surface-border text-[13px]">
          {results.length ? (
            results.slice(0, 8).map((drug) => (
              <li key={drug.code} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>
                  {drug.generic_name} {drug.strength} {drug.form && `· ${drug.form}`}
                </span>
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={() => {
                    onAdd(drug);
                    setResults(null);
                    setQuery("");
                  }}
                >
                  Add
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-ink-500">No matching medicine found.</li>
          )}
        </ul>
      )}
    </div>
  );
}
