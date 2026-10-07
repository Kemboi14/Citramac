import { useId, useState, type ReactNode } from "react";
import { useAuth } from "../../../auth/useAuth";
import { ApiError } from "../../../lib/apiClient";
import {
  getClientLegal,
  recordDataSharingConsent,
  type ClientLegal,
} from "../../../lib/carePathwayApi";
import {
  SUBJECT_REQUEST_TYPES,
  decideSubjectRequest,
  exportSubjectRequest,
  listSubjectRequests,
  logSubjectRequest,
  type PatientRecordExport,
  type SubjectRequest,
  type SubjectRequestStatus,
  type SubjectRequestType,
} from "../../../lib/complianceApi";
import { updateAdmission, type ConsentStatus, type NokNotification } from "../../../lib/ipdApi";
import { formatDate, formatDateTime } from "../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../shared/styles";
import { Callout, Card, ErrorNote, Field, SelectChoices, Tag } from "../shared/ui";
import { useValueSets } from "../shared/useValueSets";
import type { RecordViewProps } from "./types";
import { useRecordData } from "./useRecordData";

type AdmissionRow = ClientLegal["admissions"][number];

/** yyyy-mm-dd of a date-only or ISO value, without a timezone shift for date-only. */
function dateOnly(value: string | null) {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : formatDate(value);
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-[13px] text-ink-900">{children}</dd>
    </div>
  );
}

const NOT_RECORDED = <span className="text-ink-400">Not recorded</span>;

/** Legal & consent — HIE data-sharing consent and per-admission legal status. */
export function LegalView({ patientId, onRecordChanged }: RecordViewProps) {
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useRecordData(
    patientId,
    version,
    (token) => getClientLegal(token, patientId),
    "Couldn't load legal and consent records.",
  );
  if (error && !data) return <ErrorNote>{error}</ErrorNote>;
  if (loading && !data) return <p className="text-[13px] text-ink-500">Loading…</p>;
  if (!data) return null;
  const refresh = () => {
    setVersion((v) => v + 1);
    onRecordChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      <ErrorNote>{error}</ErrorNote>
      <ConsentCard patientId={patientId} legal={data} onSaved={refresh} />
      <SubjectRequestsCard patientId={patientId} />
      <Card title="Admission legal status">
        {data.admissions.length > 0 ? (
          <div className="flex flex-col gap-4">
            {data.admissions.map((a) => (
              <AdmissionLegal key={a.id} admission={a} onSaved={refresh} />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ink-500">
            No inpatient admissions are recorded for this client.
          </p>
        )}
      </Card>
    </div>
  );
}

function ConsentCard({
  patientId,
  legal,
  onSaved,
}: {
  patientId: string;
  legal: ClientLegal;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const template = legal.active_consent_template;
  const current = legal.current_consent;

  const record = async (granted: boolean) => {
    if (!accessToken || !template) return;
    const question = granted
      ? `Record that the client GRANTED data-sharing consent under wording version ${template.version}?`
      : `Record that the client DECLINED or WITHDREW data-sharing consent (wording version ${template.version})?`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const saved = await recordDataSharingConsent(accessToken, patientId, granted);
      setNote(
        `${saved.granted ? "Consent granted" : "Declined / withdrawn"} recorded · ${formatDateTime(
          saved.captured_at,
        )} · wording v${saved.consent_text_version}`,
      );
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record the consent decision.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Data-sharing consent (HIE)"
      aside={
        !current.captured_at ? (
          <Tag>Not recorded</Tag>
        ) : current.granted ? (
          <Tag tone="brand">Granted</Tag>
        ) : (
          <Tag tone="risk">Declined or withdrawn</Tag>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-900">
          <span className="font-semibold">Current status: </span>
          {!current.captured_at
            ? "Not recorded"
            : `${current.granted ? "Granted" : "Declined or withdrawn"} · ${formatDateTime(
                current.captured_at,
              )}`}
        </p>

        {template ? (
          <div className="rounded-lg border border-surface-border bg-surface-bg p-3.5">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              Facility consent wording · version {template.version}
            </div>
            <blockquote className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-900">
              {template.text}
            </blockquote>
          </div>
        ) : (
          <Callout tone="warning" role="status">
            No consent wording is configured for this facility. An Org Admin must set the
            facility&apos;s data-sharing consent wording first (Org Admin → Consent wording,
            /org-admin/consent-wording) before consent can be recorded.
          </Callout>
        )}

        <div className="flex flex-col gap-2">
          <ErrorNote>{error}</ErrorNote>
          {note && (
            <Callout tone="success" role="status">
              {note}
            </Callout>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BTN}
              disabled={!template || busy}
              onClick={() => void record(true)}
            >
              Record consent granted
            </button>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={!template || busy}
              onClick={() => void record(false)}
            >
              Record declined / withdrawn
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-surface-border">
          <table className={`${TABLE} min-w-[620px]`} aria-label="Consent history">
            <thead>
              <tr>
                <th className={TH}>Captured</th>
                <th className={TH}>Consent</th>
                <th className={TH}>Decision</th>
                <th className={TH}>Consent text version</th>
                <th className={TH}>Captured by</th>
              </tr>
            </thead>
            <tbody>
              {legal.data_sharing_consent.length > 0 ? (
                legal.data_sharing_consent.map((c) => (
                  <tr key={c.id}>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                      {formatDateTime(c.captured_at)}
                    </td>
                    <td className={TD}>{c.consent_type}</td>
                    <td className={TD}>
                      <Tag tone={c.granted ? "brand" : "risk"}>
                        {c.granted ? "Granted" : "Declined / withdrawn"}
                      </Tag>
                    </td>
                    <td className={TD}>{c.consent_text_version || "—"}</td>
                    <td className={TD}>{c.captured_by || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className={`${TD} py-6 text-center text-ink-500`}>
                    No data-sharing consent has been recorded for this client.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

interface LegalForm {
  consent_status: ConsentStatus;
  /** Served `capacity-assessed` code: NOT_ASSESSED / YES / NO. */
  capacity: string;
  consent_notes: string;
  legal_status: string;
  legal_order_reference: string;
  legal_order_date: string;
  legal_review_due_date: string;
  authorizing_professional: string;
  legal_rationale: string;
  oversight_notes: string;
  next_of_kin_notification: NokNotification;
  next_of_kin_notes: string;
}

function toForm(a: AdmissionRow): LegalForm {
  return {
    consent_status: a.consent_status_code,
    capacity: a.capacity_assessed === null ? "NOT_ASSESSED" : a.capacity_assessed ? "YES" : "NO",
    consent_notes: a.consent_notes,
    legal_status: a.legal_status,
    legal_order_reference: a.legal_order_reference,
    legal_order_date: dateOnly(a.legal_order_date),
    legal_review_due_date: dateOnly(a.legal_review_due_date),
    authorizing_professional: a.authorizing_professional,
    legal_rationale: a.legal_rationale,
    oversight_notes: a.oversight_notes,
    next_of_kin_notification: (a.next_of_kin_notification_code ||
      "NOT_NOTIFIED") as NokNotification,
    next_of_kin_notes: a.next_of_kin_notes,
  };
}

function AdmissionLegal({
  admission: a,
  onSaved,
}: {
  admission: AdmissionRow;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const vs = useValueSets();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<LegalForm>(() => toForm(a));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const involuntary = a.admission_type === "INVOLUNTARY";
  const today = formatDate(new Date().toISOString());
  const due = dateOnly(a.legal_review_due_date);
  const overdue = Boolean(due) && due < today && a.status !== "Discharged";
  const set = (changes: Partial<LegalForm>) => setForm((f) => ({ ...f, ...changes }));

  const save = async () => {
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const shared = {
      next_of_kin_notification: form.next_of_kin_notification,
      next_of_kin_notes: form.next_of_kin_notes,
    };
    const payload = involuntary
      ? {
          ...shared,
          legal_status: form.legal_status,
          legal_order_reference: form.legal_order_reference,
          legal_order_date: form.legal_order_date || null,
          legal_review_due_date: form.legal_review_due_date || null,
          authorizing_professional: form.authorizing_professional,
          legal_rationale: form.legal_rationale,
          oversight_notes: form.oversight_notes,
        }
      : {
          ...shared,
          consent_status: form.consent_status,
          capacity_assessed: form.capacity === "YES" ? true : form.capacity === "NO" ? false : null,
          consent_notes: form.consent_notes,
        };
    try {
      await updateAdmission(accessToken, a.id, payload);
      setEditing(false);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fields
          ? Object.entries(err.fields)
              .map(([field, msg]) => `${field.replace(/_/g, " ")}: ${String(msg)}`)
              .join("; ")
          : "";
        setError(fields ? `${err.message} — ${fields}` : err.message);
      } else {
        setError("Couldn't save the admission's legal status.");
      }
    } finally {
      setSaving(false);
    }
  };

  const text = (key: keyof LegalForm, label: string, multiline = false, type = "text") => (
    <Field label={label} htmlFor={`${id}-${key}`}>
      {multiline ? (
        <textarea
          id={`${id}-${key}`}
          rows={2}
          className={INPUT}
          // eslint-disable-next-line security/detect-object-injection -- typed key of LegalForm.
          value={form[key]}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      ) : (
        <input
          id={`${id}-${key}`}
          type={type}
          className={INPUT}
          // eslint-disable-next-line security/detect-object-injection -- typed key of LegalForm.
          value={form[key]}
          onChange={(e) => set({ [key]: e.target.value })}
        />
      )}
    </Field>
  );

  return (
    <section
      aria-label={`Admission ${formatDateTime(a.admitted_at)}`}
      className={`rounded-lg border p-3.5 ${overdue ? "border-priority-red" : "border-surface-border"}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-ink-900">
            Admitted {formatDateTime(a.admitted_at)}
          </span>
          <Tag>{a.status}</Tag>
          <Tag tone={involuntary ? "risk" : "neutral"}>{a.admission_type_label}</Tag>
          {overdue && <Tag tone="risk">Legal review overdue</Tag>}
        </div>
        {!editing && (
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            onClick={() => {
              setForm(toForm(a));
              setError(null);
              setEditing(true);
            }}
          >
            Update
          </button>
        )}
      </div>

      {!editing ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {involuntary ? (
            <>
              <Item label="Legal status">{a.legal_status || NOT_RECORDED}</Item>
              <Item label="Legal order reference">{a.legal_order_reference || NOT_RECORDED}</Item>
              <Item label="Legal order date">{dateOnly(a.legal_order_date) || NOT_RECORDED}</Item>
              <Item label="Review due">
                {due ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span className={overdue ? "font-semibold text-priority-red" : ""}>{due}</span>
                    {overdue && <Tag tone="risk">Overdue</Tag>}
                  </span>
                ) : (
                  NOT_RECORDED
                )}
              </Item>
              <Item label="Authorising professional">
                {a.authorizing_professional || NOT_RECORDED}
              </Item>
              <Item label="Legal rationale">{a.legal_rationale || NOT_RECORDED}</Item>
              <Item label="Oversight notes">{a.oversight_notes || NOT_RECORDED}</Item>
            </>
          ) : (
            <>
              <Item label="Consent status">{a.consent_status || NOT_RECORDED}</Item>
              <Item label="Capacity assessed">
                {a.capacity_assessed === null ? "Not assessed" : a.capacity_assessed ? "Yes" : "No"}
              </Item>
              <Item label="Consent recorded">
                {a.consent_at ? formatDateTime(a.consent_at) : NOT_RECORDED}
              </Item>
              <Item label="Consent notes">{a.consent_notes || NOT_RECORDED}</Item>
            </>
          )}
          <Item label="Next of kin notification">{a.next_of_kin_notification || NOT_RECORDED}</Item>
          <Item label="Next of kin notes">{a.next_of_kin_notes || NOT_RECORDED}</Item>
        </dl>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {involuntary ? (
              <>
                {text("legal_status", "Legal status")}
                {text("legal_order_reference", "Legal order reference")}
                {text("legal_order_date", "Legal order date", false, "date")}
                {text("legal_review_due_date", "Review due date", false, "date")}
                {text("authorizing_professional", "Authorising professional")}
                {text("legal_rationale", "Legal rationale", true)}
                {text("oversight_notes", "Oversight notes", true)}
              </>
            ) : (
              <>
                <Field label="Consent status" htmlFor={`${id}-consent`}>
                  <SelectChoices
                    id={`${id}-consent`}
                    options={vs.options("admission-consent-status")}
                    value={form.consent_status}
                    placeholder="Select consent status"
                    onChange={(code) => set({ consent_status: code as ConsentStatus })}
                  />
                </Field>
                <Field label="Capacity assessed" htmlFor={`${id}-capacity`}>
                  <SelectChoices
                    id={`${id}-capacity`}
                    options={vs.options("capacity-assessed")}
                    value={form.capacity}
                    onChange={(capacity) => set({ capacity })}
                  />
                </Field>
                <div className="sm:col-span-2">{text("consent_notes", "Consent notes", true)}</div>
              </>
            )}
            <Field label="Next of kin notification" htmlFor={`${id}-nok`}>
              <SelectChoices
                id={`${id}-nok`}
                options={vs.options("nok-notification")}
                value={form.next_of_kin_notification}
                onChange={(code) => set({ next_of_kin_notification: code as NokNotification })}
              />
            </Field>
            {text("next_of_kin_notes", "Next of kin notes", true)}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <ErrorNote>{error ?? vs.error}</ErrorNote>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={BTN} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className={BTN_GHOST}
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

// ── Patient data requests (data subject rights — legal opinion of 2 Oct 2026 §11) ──
// Any staff member can log a request; only the Org Admin verifies identity,
// decides and fulfils it. Access/portability are fulfilled by the server's
// record export, which marks the request fulfilled and writes an EXPORT audit
// entry. The export is held in memory only and handed to the browser as a
// download — never written to browser storage (CLAUDE.md §5).

const REQUEST_STATUS_TONE: Record<SubjectRequestStatus, "neutral" | "risk" | "brand" | "warn"> = {
  RECEIVED: "warn",
  APPROVED: "brand",
  FULFILLED: "neutral",
  DECLINED: "risk",
};

const pad2 = (n: number) => String(n).padStart(2, "0");

function nowLocalInput() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function apiErrorText(err: unknown, fallback: string) {
  if (!(err instanceof ApiError)) return fallback;
  const fields = err.fields
    ? Object.entries(err.fields)
        .map(([field, msg]) => {
          const text = Array.isArray(msg) ? msg.map(String).join(" ") : String(msg);
          return field === "detail" ? text : `${field.replace(/_/g, " ")}: ${text}`;
        })
        .join("; ")
    : "";
  return fields && fields !== err.message ? `${err.message} — ${fields}` : err.message;
}

function SubjectRequestsCard({ patientId }: { patientId: string }) {
  const { claims } = useAuth();
  const isOrgAdmin = claims?.role === "Org Admin";
  const [version, setVersion] = useState(0);
  const [logging, setLogging] = useState(false);
  const { data, error } = useRecordData(
    patientId,
    version,
    (token) => listSubjectRequests(token, patientId),
    "Couldn't load this client's data requests.",
  );
  const refresh = () => setVersion((v) => v + 1);
  const requests = data?.results ?? null;

  return (
    <Card
      title="Patient data requests"
      aside={
        !logging && (
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            onClick={() => setLogging(true)}
          >
            Log a request
          </button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-ink-500">
          Requests from the client, or someone authorised to act for them, to see, receive, correct,
          object to or restrict the use of their record.{" "}
          {isOrgAdmin
            ? "You verify the requester's identity and decide each request."
            : "The facility's Org Admin verifies the requester's identity and decides each request."}
        </p>
        {logging && (
          <LogRequestForm
            patientId={patientId}
            onCancel={() => setLogging(false)}
            onLogged={() => {
              setLogging(false);
              refresh();
            }}
          />
        )}
        <ErrorNote>{error}</ErrorNote>
        {requests === null ? (
          !error && <p className="text-[13px] text-ink-500">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-[13px] text-ink-500">
            No data requests have been logged for this client.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {requests.map((r) => (
              <SubjectRequestItem
                key={r.id}
                request={r}
                isOrgAdmin={isOrgAdmin}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function LogRequestForm({
  patientId,
  onLogged,
  onCancel,
}: {
  patientId: string;
  onLogged: () => void;
  onCancel: () => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const [type, setType] = useState<SubjectRequestType | "">("");
  const [receivedAt, setReceivedAt] = useState(nowLocalInput);
  const [inWriting, setInWriting] = useState(true);
  const [requester, setRequester] = useState<"SELF" | "REPRESENTATIVE">("SELF");
  const [requesterName, setRequesterName] = useState("");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!accessToken) return;
    if (!type) {
      setError("Choose the type of request.");
      return;
    }
    if (requester === "REPRESENTATIVE" && !requesterName.trim()) {
      setError("Name the authorised representative.");
      return;
    }
    const received = receivedAt ? new Date(receivedAt) : null;
    if (received && Number.isNaN(received.getTime())) {
      setError("Enter when the request was received.");
      return;
    }
    if (received && received.getTime() > Date.now() + 60_000) {
      setError("When the request was received cannot be in the future.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await logSubjectRequest(accessToken, {
        patient: patientId,
        request_type: type,
        ...(received ? { received_at: received.toISOString() } : {}),
        received_in_writing: inWriting,
        requester,
        requester_name: requester === "REPRESENTATIVE" ? requesterName.trim() : "",
        details: details.trim(),
      });
      onLogged();
    } catch (err) {
      setError(apiErrorText(err, "Couldn't log the request."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-bg p-3.5"
      aria-label="Log a data request"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="Type of request" htmlFor={`${id}-type`}>
          <select
            id={`${id}-type`}
            className={INPUT}
            required
            value={type}
            onChange={(e) => setType(e.target.value as SubjectRequestType | "")}
          >
            <option value="">Select the type of request</option>
            {SUBJECT_REQUEST_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Received at" htmlFor={`${id}-received`}>
          <input
            id={`${id}-received`}
            type="datetime-local"
            className={INPUT}
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
          />
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Requested by
          </legend>
          {(
            [
              ["SELF", "Client"],
              ["REPRESENTATIVE", "Authorised representative"],
            ] as const
          ).map(([code, label]) => (
            <label
              key={code}
              className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-900"
            >
              <input
                type="radio"
                name={`${id}-requester`}
                className="h-[17px] w-[17px] accent-[var(--green)]"
                checked={requester === code}
                onChange={() => setRequester(code)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {requester === "REPRESENTATIVE" ? (
          <Field label="Representative's name" htmlFor={`${id}-rep`}>
            <input
              id={`${id}-rep`}
              className={INPUT}
              required
              value={requesterName}
              onChange={(e) => setRequesterName(e.target.value)}
            />
          </Field>
        ) : (
          <div />
        )}
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-900 sm:col-span-2">
          <input
            type="checkbox"
            className="h-[17px] w-[17px] accent-[var(--green)]"
            checked={inWriting}
            onChange={(e) => setInWriting(e.target.checked)}
          />
          Received in writing
        </label>
        <Field label="Details" htmlFor={`${id}-details`} className="sm:col-span-2">
          <textarea
            id={`${id}-details`}
            rows={2}
            className={INPUT}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </Field>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${BTN} ${BTN_SM}`} disabled={saving}>
          {saving ? "Logging…" : "Log request"}
        </button>
        <button
          type="button"
          className={`${BTN_GHOST} ${BTN_SM}`}
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

type DecisionMode = "APPROVE" | "DECLINE" | "FULFIL";

const DECISION_COPY: Record<DecisionMode, { label: string; field: string; button: string }> = {
  APPROVE: {
    label: "How was identity verified?",
    field: "identity_verification",
    button: "Approve request",
  },
  DECLINE: { label: "Reason for declining", field: "notes", button: "Decline request" },
  FULFIL: { label: "What was done", field: "notes", button: "Mark fulfilled" },
};

function SubjectRequestItem({
  request: r,
  isOrgAdmin,
  onChanged,
}: {
  request: SubjectRequest;
  isOrgAdmin: boolean;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const id = useId();
  const [mode, setMode] = useState<DecisionMode | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = r.status === "RECEIVED" || r.status === "APPROVED";
  const canExport =
    isOrgAdmin && r.exportable && (r.status === "APPROVED" || r.status === "FULFILLED");
  const canFulfil = isOrgAdmin && !r.exportable && r.status === "APPROVED";

  const startMode = (next: DecisionMode) => {
    setMode(next);
    setText("");
    setError(null);
  };

  const decide = async () => {
    if (!accessToken || !mode) return;
    if (!text.trim()) {
      // eslint-disable-next-line security/detect-object-injection -- `mode` is a typed union.
      setError(`${DECISION_COPY[mode].label} is required.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await decideSubjectRequest(accessToken, r.id, {
        decision: mode,
        ...(mode === "APPROVE" ? { identity_verification: text.trim() } : { notes: text.trim() }),
      });
      setMode(null);
      onChanged();
    } catch (err) {
      setError(apiErrorText(err, "Couldn't record the decision."));
    } finally {
      setBusy(false);
    }
  };

  const fetchExport = async (purpose: "download" | "print") => {
    if (!accessToken) return null;
    const question =
      purpose === "download"
        ? "Download this client's full record as FHIR JSON? The download is logged and the request is marked fulfilled."
        : "Print a copy of this client's full record? Producing the copy is logged and the request is marked fulfilled.";
    if (!window.confirm(question)) return null;
    setBusy(true);
    setError(null);
    try {
      return await exportSubjectRequest(accessToken, r.id);
    } catch (err) {
      setError(apiErrorText(err, "Couldn't export the record."));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    const exported = await fetchExport("download");
    if (!exported) return;
    const blob = new Blob([JSON.stringify(exported.fhir, null, 2)], {
      type: "application/fhir+json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${r.citramac_number || "record"}-fhir-${formatDate(exported.generated_at)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onChanged();
  };

  const print = async () => {
    const exported = await fetchExport("print");
    if (!exported) return;
    printRecord(exported, r);
    onChanged();
  };

  return (
    <section
      aria-label={`${r.request_type_label} request`}
      className="rounded-lg border border-surface-border p-3.5"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-ink-900">{r.request_type_label}</span>
          <Tag tone={REQUEST_STATUS_TONE[r.status]}>{r.status_label}</Tag>
        </div>
        <span className="font-mono text-xs text-ink-500">
          Received {formatDateTime(r.received_at)}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Requested by">
          {r.requester === "SELF" ? "Client" : `Authorised representative — ${r.requester_name}`}
        </Item>
        <Item label="Received in writing">{r.received_in_writing ? "Yes" : "No"}</Item>
        <Item label="Logged by">{r.logged_by || NOT_RECORDED}</Item>
        {r.details && <Item label="Details">{r.details}</Item>}
        {r.decided_at && (
          <Item label="Decided">
            {r.decided_by || "—"} · {formatDateTime(r.decided_at)}
          </Item>
        )}
        {r.identity_verification && (
          <Item label="Identity verification">{r.identity_verification}</Item>
        )}
        {r.decision_notes && <Item label="Decision notes">{r.decision_notes}</Item>}
        {r.fulfilled_at && (
          <Item label="Fulfilled">
            {r.fulfilled_by || "—"} · {formatDateTime(r.fulfilled_at)}
          </Item>
        )}
      </dl>

      {isOrgAdmin && (open || canExport) && (
        <div className="mt-3 flex flex-col gap-2">
          {mode ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void decide();
              }}
            >
              {/* eslint-disable-next-line security/detect-object-injection -- `mode` is a typed union. */}
              <Field label={DECISION_COPY[mode].label} htmlFor={`${id}-${mode}`}>
                <textarea
                  id={`${id}-${mode}`}
                  rows={2}
                  className={INPUT}
                  required
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={`${BTN} ${BTN_SM}`} disabled={busy}>
                  {/* eslint-disable-next-line security/detect-object-injection -- `mode` is a typed union. */}
                  {busy ? "Saving…" : DECISION_COPY[mode].button}
                </button>
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  disabled={busy}
                  onClick={() => setMode(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              {r.status === "RECEIVED" && (
                <button
                  type="button"
                  className={`${BTN} ${BTN_SM}`}
                  onClick={() => startMode("APPROVE")}
                >
                  Approve
                </button>
              )}
              {canFulfil && (
                <button
                  type="button"
                  className={`${BTN} ${BTN_SM}`}
                  onClick={() => startMode("FULFIL")}
                >
                  Mark fulfilled
                </button>
              )}
              {canExport && (
                <>
                  <button
                    type="button"
                    className={`${BTN} ${BTN_SM}`}
                    disabled={busy}
                    onClick={() => void download()}
                  >
                    Download record (FHIR JSON)
                  </button>
                  <button
                    type="button"
                    className={`${BTN_GHOST} ${BTN_SM}`}
                    disabled={busy}
                    onClick={() => void print()}
                  >
                    Print copy
                  </button>
                </>
              )}
              {open && (
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM}`}
                  onClick={() => startMode("DECLINE")}
                >
                  Decline
                </button>
              )}
            </div>
          )}
          {canExport && !mode && (
            <p className="text-xs text-ink-500">
              Downloading or printing the record marks the request fulfilled, and every export is
              logged in the audit trail.
            </p>
          )}
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </section>
  );
}

// ── Print-friendly copy of the exported record ──

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function humanize(key: string) {
  const text = key.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function printableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    if (ISO_DATE.test(value)) return value;
    if (ISO_DATETIME.test(value)) return formatDateTime(value);
    return value;
  }
  if (Array.isArray(value) && value.every((v) => typeof v !== "object" || v === null)) {
    return value.length ? value.map(printableValue).join(", ") : "—";
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Builds DOM nodes with textContent only — record values are never parsed as HTML. */
function appendValue(doc: Document, parent: HTMLElement, value: unknown, depth: number) {
  if (isPlainObject(value)) {
    const dl = doc.createElement("dl");
    for (const [key, inner] of Object.entries(value)) {
      const dt = doc.createElement("dt");
      dt.textContent = humanize(key);
      const dd = doc.createElement("dd");
      appendValue(doc, dd, inner, depth + 1);
      dl.append(dt, dd);
    }
    parent.append(dl);
    return;
  }
  if (Array.isArray(value) && value.some((v) => typeof v === "object" && v !== null)) {
    if (value.length === 0) {
      parent.append(doc.createTextNode("None recorded"));
      return;
    }
    value.forEach((item) => {
      const block = doc.createElement("div");
      block.className = depth > 1 ? "item nested" : "item";
      appendValue(doc, block, item, depth + 1);
      parent.append(block);
    });
    return;
  }
  if (Array.isArray(value) && value.length === 0 && depth <= 1) {
    parent.append(doc.createTextNode("None recorded"));
    return;
  }
  parent.append(doc.createTextNode(printableValue(value)));
}

const PRINT_CSS = `
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #444; margin-bottom: 16px; }
  h2 { font-size: 14px; border-bottom: 1px solid #999; padding-bottom: 3px; margin: 20px 0 8px; break-after: avoid; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 12px; margin: 0; }
  dt { font-weight: 600; color: #333; }
  dd { margin: 0; white-space: pre-wrap; word-break: break-word; }
  .item { border: 1px solid #ccc; border-radius: 4px; padding: 6px 8px; margin-bottom: 6px; break-inside: avoid; }
  .item.nested { border-style: dashed; margin-top: 4px; }
`;

function printRecord(exported: PatientRecordExport, request: SubjectRequest) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    iframe.remove();
    return;
  }
  doc.title = `Health record — ${request.patient_name}`;
  const style = doc.createElement("style");
  style.textContent = PRINT_CSS;
  doc.head.append(style);

  const h1 = doc.createElement("h1");
  h1.textContent = `Health record — ${request.patient_name}`;
  const meta = doc.createElement("div");
  meta.className = "meta";
  meta.textContent = [
    exported.facility,
    request.citramac_number && `CITRAMAC no. ${request.citramac_number}`,
    `Request: ${exported.request.type}, received ${formatDateTime(exported.request.received_at)}`,
    `Generated ${formatDateTime(exported.generated_at)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  doc.body.append(h1, meta);

  for (const [section, value] of Object.entries(exported.record)) {
    const h2 = doc.createElement("h2");
    h2.textContent = humanize(section);
    const body = doc.createElement("div");
    appendValue(doc, body, value, 1);
    doc.body.append(h2, body);
  }

  const cleanup = () => window.setTimeout(() => iframe.remove(), 500);
  win.addEventListener("afterprint", cleanup, { once: true });
  win.focus();
  win.print();
  // Browsers that block until the dialog closes have already printed by here.
  window.setTimeout(() => {
    if (document.body.contains(iframe)) cleanup();
  }, 60_000);
}
