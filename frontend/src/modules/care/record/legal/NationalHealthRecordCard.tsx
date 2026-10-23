import { useId, useState, type ReactNode } from "react";
import { useAuth } from "../../../../auth/useAuth";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { ApiError } from "../../../../lib/apiClient";
import {
  REPRESENTATIVE_RELATIONSHIPS,
  SHR_READABLE_RESOURCES,
  closeShrVisit,
  listShrConsents,
  previewShrSend,
  readShrRecords,
  refreshShrToken,
  refuseShrConsent,
  requestShrConsent,
  resendShrOtp,
  sendShrVisit,
  verifyShrConsent,
  type ShrConsent,
  type ShrConsentStatus,
  type ShrIssue,
  type ShrPreview,
  type ShrSearchset,
  type ShrVisitType,
} from "../../../../lib/shrApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT, TABLE, TD, TH } from "../../shared/styles";
import { Callout, Card, CheckChoices, ErrorNote, Field, RadioChoices, Tag } from "../../shared/ui";
import { useRecordData } from "../useRecordData";

const VISIT_TYPES = [
  { code: "OP", display: "Outpatient" },
  { code: "IP", display: "Inpatient" },
];
const VISIT_TYPE_LABEL: Record<ShrVisitType, string> = { OP: "Outpatient", IP: "Inpatient" };
const RESOURCE_OPTIONS = SHR_READABLE_RESOURCES.map((t) => ({ code: t, display: t }));

const STATUS_TONE: Record<ShrConsentStatus, "neutral" | "risk" | "brand" | "warn"> = {
  PENDING: "warn",
  APPROVED: "brand",
  REJECTED: "risk",
  CLOSING: "warn",
  CLOSED: "neutral",
};

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

/** GET 403s for anyone outside the client's care team — shown as a note, not an error. */
async function loadConsents(token: string, patientId: string) {
  try {
    return { forbidden: false, consents: (await listShrConsents(token, patientId)).consents };
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      return { forbidden: true, consents: [] as ShrConsent[] };
    }
    throw err;
  }
}

/**
 * DHA national Shared Health Record (contract §6), care team only. A visit
 * starts with the client's consent (OTP), and only an approved visit can be
 * previewed, sent, or read. Sending is irreversible — once in the national
 * record it cannot be recalled — so Send is only reachable from the preview
 * and behind an explicit confirmation. Held in memory only (CLAUDE.md §5).
 */
export function NationalHealthRecordCard({
  patientId,
  episodeId,
}: {
  patientId: string;
  /** The client's current EpisodeOfCare — every SHR visit hangs off one. */
  episodeId: string | null;
}) {
  const [version, setVersion] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const { data, error, loading } = useRecordData(
    patientId,
    version,
    (token) => loadConsents(token, patientId),
    "Couldn't load the client's national health record visits.",
  );
  const reload = () => setVersion((v) => v + 1);

  if (data?.forbidden) {
    return (
      <Card title="National health record (SHR)">
        <p className="text-[13px] text-ink-500">
          Only the client&apos;s care team can request, send or read their national health record.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="National health record (SHR)"
      aside={
        data && !requesting ? (
          <button
            type="button"
            className={`${BTN_GHOST} ${BTN_SM}`}
            onClick={() => setRequesting(true)}
          >
            Request consent
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-ink-700">
          DHA&apos;s Shared Health Record holds this client&apos;s care across facilities. Each
          visit needs the client&apos;s consent first; only an approved visit can be sent or read.
          Anything sent becomes part of the national record permanently.
        </p>
        <ErrorNote>{error}</ErrorNote>
        {loading && !data && <p className="text-[13px] text-ink-500">Loading…</p>}
        {requesting && (
          <RequestConsentForm
            patientId={patientId}
            episodeId={episodeId}
            onCancel={() => setRequesting(false)}
            onRequested={() => {
              setRequesting(false);
              reload();
            }}
          />
        )}
        {data && data.consents.length === 0 && !requesting && (
          <p className="text-[13px] text-ink-500">No SHR visits for this client yet.</p>
        )}
        {data?.consents.map((consent) => (
          <ConsentPanel key={consent.id} consent={consent} onChanged={reload} />
        ))}
      </div>
    </Card>
  );
}

function RequestConsentForm({
  patientId,
  episodeId,
  onCancel,
  onRequested,
}: {
  patientId: string;
  episodeId: string | null;
  onCancel: () => void;
  onRequested: () => void;
}) {
  const { accessToken, profile } = useAuth();
  const ids = useId();
  const branches = profile?.branches ?? [];
  const [branch, setBranch] = useState(
    () => branches.find((b) => b.is_primary)?.id ?? branches[0]?.id ?? "",
  );
  const [visitType, setVisitType] = useState<ShrVisitType | "">("");
  const [emergency, setEmergency] = useState(false);
  const [incapable, setIncapable] = useState(false);
  const [incapacityReason, setIncapacityReason] = useState("");
  const [repCrId, setRepCrId] = useState("");
  const [repRelationship, setRepRelationship] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsReason = emergency || incapable;

  async function submit() {
    if (!accessToken || !episodeId) return;
    if (!branch) return setError("Choose the facility (branch).");
    if (!visitType) return setError("Choose outpatient or inpatient.");
    if (needsReason && !incapacityReason.trim()) {
      return setError("Record why the client cannot consent for themselves.");
    }
    if (incapable && repCrId.trim() && !repRelationship) {
      return setError("Choose how the representative relates to the client.");
    }
    setBusy(true);
    setError(null);
    try {
      await requestShrConsent(accessToken, patientId, {
        branch,
        episode: episodeId,
        visit_type: visitType,
        emergency,
        patient_capable: !incapable,
        ...(needsReason ? { incapacity_reason: incapacityReason.trim() } : {}),
        ...(incapable && repCrId.trim()
          ? {
              representative_cr_id: repCrId.trim(),
              representative_relationship: repRelationship,
            }
          : {}),
      });
      onRequested();
    } catch (err) {
      setError(errorText(err, "Couldn't request SHR consent."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-bg p-3.5">
      <div className="text-[12px] font-bold uppercase tracking-wide text-ink-500">
        Request consent for an SHR visit
      </div>
      {!episodeId && (
        <Callout tone="warning" role="status">
          This client has no current episode of care. Every SHR visit belongs to an episode — open
          one before requesting consent.
        </Callout>
      )}
      {branches.length === 0 && (
        <Callout tone="warning" role="status">
          You are not assigned to any active branch, so there is no facility to request from.
        </Callout>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Facility (branch)" htmlFor={`${ids}-branch`}>
          <select
            id={`${ids}-branch`}
            className={INPUT}
            value={branch}
            disabled={busy}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">Choose a branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Visit type">
          <RadioChoices
            name={`${ids}-visit-type`}
            options={VISIT_TYPES}
            value={visitType}
            onChange={(code) => setVisitType(code as ShrVisitType)}
            disabled={busy}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-[13px] text-ink-900">
          <input
            type="checkbox"
            checked={emergency}
            disabled={busy}
            onChange={(e) => setEmergency(e.target.checked)}
          />
          Emergency — the client cannot give consent by OTP now
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink-900">
          <input
            type="checkbox"
            checked={incapable}
            disabled={busy}
            onChange={(e) => setIncapable(e.target.checked)}
          />
          The client cannot consent for themselves
        </label>
      </div>
      {needsReason && (
        <Field label="Why the client cannot consent" htmlFor={`${ids}-reason`}>
          <textarea
            id={`${ids}-reason`}
            className={INPUT}
            rows={2}
            maxLength={255}
            value={incapacityReason}
            disabled={busy}
            onChange={(e) => setIncapacityReason(e.target.value)}
          />
        </Field>
      )}
      {incapable && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Representative's Client Registry ID"
            htmlFor={`${ids}-rep`}
            hint="Optional — the person consenting on the client's behalf."
          >
            <input
              id={`${ids}-rep`}
              className={INPUT}
              value={repCrId}
              disabled={busy}
              onChange={(e) => setRepCrId(e.target.value)}
            />
          </Field>
          <Field label="Representative's relationship" htmlFor={`${ids}-rel`}>
            <select
              id={`${ids}-rel`}
              className={INPUT}
              value={repRelationship}
              disabled={busy || !repCrId.trim()}
              onChange={(e) => setRepRelationship(e.target.value)}
            >
              <option value="">Choose</option>
              {REPRESENTATIVE_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN}
          disabled={busy || !episodeId || branches.length === 0}
          onClick={() => void submit()}
        >
          {busy ? "Requesting…" : "Request consent"}
        </button>
        <button type="button" className={BTN_GHOST} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="break-words text-[13px] text-ink-900">{children}</dd>
    </div>
  );
}

function issueText(issue: ShrIssue) {
  const where = Array.isArray(issue.expression) ? issue.expression.join(", ") : issue.expression;
  return [issue.severity, issue.code, where, issue.diagnostics].filter(Boolean).join(" · ");
}

type Panel = "none" | "preview" | "records" | "close" | "refuse";

function ConsentPanel({ consent, onChanged }: { consent: ShrConsent; onChanged: () => void }) {
  const { accessToken } = useAuth();
  const ids = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("none");
  const [otp, setOtp] = useState("");
  const [refusalReason, setRefusalReason] = useState("");
  const [closeIncapable, setCloseIncapable] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [preview, setPreview] = useState<ShrPreview | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [resources, setResources] = useState<string[]>(["Condition", "Encounter"]);
  const [records, setRecords] = useState<ShrSearchset | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function run(action: (token: string) => Promise<unknown>, fallback: string) {
    if (!accessToken) return false;
    setBusy(true);
    setError(null);
    try {
      await action(accessToken);
      return true;
    } catch (err) {
      setError(errorText(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function act(action: (token: string) => Promise<unknown>, fallback: string) {
    if (await run(action, fallback)) {
      setOtp("");
      setPanel("none");
      onChanged();
    }
  }

  function open(next: Panel) {
    setError(null);
    setPanel(panel === next ? "none" : next);
  }

  async function loadPreview() {
    open("preview");
    if (panel === "preview") return;
    setPreview(null);
    await run(
      async (token) => setPreview(await previewShrSend(token, consent.id)),
      "Couldn't prepare the preview.",
    );
  }

  async function send() {
    if (!accessToken) return;
    setBusy(true);
    setSendError(null);
    try {
      await sendShrVisit(accessToken, consent.id);
      setConfirmSend(false);
      setPreview(null);
      setPanel("none");
      onChanged();
    } catch (err) {
      setSendError(errorText(err, "Couldn't send to the national record."));
    } finally {
      setBusy(false);
    }
  }

  const awaitingOtp = consent.status === "PENDING" || consent.status === "CLOSING";
  const problems = preview?.problems ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={STATUS_TONE[consent.status]}>{consent.status_label}</Tag>
        <span className="text-[13px] font-semibold text-ink-900">
          {VISIT_TYPE_LABEL[consent.visit_type]} · {consent.branch.name}
        </span>
        {consent.emergency && <Tag tone="risk">Emergency</Tag>}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Meta label="Requested">{formatDateTime(consent.requested_at)}</Meta>
        <Meta label="Decided">{consent.decided_at ? formatDateTime(consent.decided_at) : "—"}</Meta>
        <Meta label="Closed">{consent.closed_at ? formatDateTime(consent.closed_at) : "—"}</Meta>
        <Meta label="SHR visit ID">{consent.visit_id || "—"}</Meta>
        {consent.representative_cr_id && (
          <Meta label="Representative CR ID">{consent.representative_cr_id}</Meta>
        )}
      </dl>
      {consent.detail && <p className="text-[12.5px] text-ink-700">{consent.detail}</p>}
      {consent.status === "REJECTED" && (
        <Callout tone="danger">
          Refused{consent.rejection_reason ? `: ${consent.rejection_reason}` : "."}
        </Callout>
      )}

      {consent.sends.length > 0 && (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Sent</th>
                <th className={TH}>Status</th>
                <th className={TH}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {consent.sends.map((s) => (
                <tr key={s.id}>
                  <td className={TD}>{formatDateTime(s.at)}</td>
                  <td className={TD}>{s.status_label}</td>
                  <td className={TD}>
                    {s.detail || "—"}
                    {s.issues.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-[12px] text-priority-red">
                        {s.issues.map((issue, i) => (
                          <li key={i}>{issueText(issue)}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {awaitingOtp && (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-ink-700">
            {consent.status === "PENDING"
              ? "DHA has sent the client a one-time code. Enter it to record their consent."
              : "Closing this visit sent the client a one-time code. Enter it to confirm the close."}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="One-time code" htmlFor={`${ids}-otp`}>
              <input
                id={`${ids}-otp`}
                className={INPUT}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                disabled={busy}
                onChange={(e) => setOtp(e.target.value)}
              />
            </Field>
            <button
              type="button"
              className={BTN}
              disabled={busy || !otp.trim()}
              onClick={() =>
                void act(
                  (t) => verifyShrConsent(t, consent.id, otp.trim()),
                  "Couldn't verify the code.",
                )
              }
            >
              {consent.status === "PENDING" ? "Verify" : "Verify closure"}
            </button>
            <button
              type="button"
              className={BTN_GHOST}
              disabled={busy}
              onClick={() =>
                void act((t) => resendShrOtp(t, consent.id), "Couldn't resend the code.")
              }
            >
              Resend OTP
            </button>
            {consent.status === "PENDING" && (
              <button
                type="button"
                className={BTN_GHOST}
                disabled={busy}
                onClick={() => open("refuse")}
              >
                Refuse
              </button>
            )}
          </div>
        </div>
      )}

      {consent.status === "PENDING" && panel === "refuse" && (
        <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-bg p-3">
          <p className="text-[12.5px] text-ink-700">
            The client&apos;s refusal is recorded against this visit — it is kept, not dropped, and
            nothing will be sent or read under it.
          </p>
          <Field label="Why the client refused" htmlFor={`${ids}-refuse`}>
            <textarea
              id={`${ids}-refuse`}
              className={INPUT}
              rows={2}
              value={refusalReason}
              disabled={busy}
              onChange={(e) => setRefusalReason(e.target.value)}
            />
          </Field>
          <div>
            <button
              type="button"
              className={BTN}
              disabled={busy || !refusalReason.trim()}
              onClick={() =>
                void act(
                  (t) =>
                    refuseShrConsent(t, consent.id, refusalReason.trim(), otp.trim() || undefined),
                  "Couldn't record the refusal.",
                )
              }
            >
              Record refusal
            </button>
          </div>
        </div>
      )}

      {consent.status === "APPROVED" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} disabled={busy} onClick={() => void loadPreview()}>
            Preview what would be sent
          </button>
          <button
            type="button"
            className={BTN_GHOST}
            disabled={busy}
            onClick={() => open("records")}
          >
            Read national record
          </button>
          <button
            type="button"
            className={BTN_GHOST}
            disabled={busy}
            onClick={() =>
              void act((t) => refreshShrToken(t, consent.id), "Couldn't refresh the visit token.")
            }
          >
            Refresh token
          </button>
          <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => open("close")}>
            Close visit
          </button>
        </div>
      )}

      <ErrorNote>{error}</ErrorNote>

      {consent.status === "APPROVED" && panel === "preview" && preview && (
        <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-bg p-3">
          <div className="text-[12px] font-bold uppercase tracking-wide text-ink-500">
            What would be sent
          </div>
          {preview.resources.length > 0 ? (
            <ul className="list-disc pl-5 text-[13px] text-ink-900">
              {preview.resources.map((r) => (
                <li key={`${r.type}/${r.id}`}>
                  {r.type}/{r.id}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-500">No resources would be sent.</p>
          )}
          {preview.substance_use && (
            <p className="text-[12.5px] text-ink-700">
              This visit involves substance-use care and is labelled as such.
            </p>
          )}
          {preview.omissions.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                Never sent
              </div>
              <ul className="list-disc pl-5 text-[13px] text-ink-900">
                {preview.omissions.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          )}
          {problems.length > 0 && (
            <Callout tone="danger" role="alert">
              <div className="font-semibold">Cannot send until these are resolved:</div>
              <ul className="list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Callout>
          )}
          <div>
            <button
              type="button"
              className={BTN}
              disabled={busy || problems.length > 0 || preview.resources.length === 0}
              onClick={() => {
                setSendError(null);
                setConfirmSend(true);
              }}
            >
              Send to national record
            </button>
          </div>
        </div>
      )}

      {consent.status === "APPROVED" && panel === "records" && (
        <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-bg p-3">
          <Field label="Resource types to read">
            <CheckChoices
              options={RESOURCE_OPTIONS}
              value={resources}
              onChange={setResources}
              disabled={busy}
              columns={2}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BTN}
              disabled={busy || resources.length === 0}
              onClick={() =>
                void run(async (t) => {
                  setRecords(null);
                  setRecords((await readShrRecords(t, consent.id, resources)).records);
                }, "Couldn't read the national record.")
              }
            >
              {busy ? "Reading…" : "Read"}
            </button>
            {records && (
              <button type="button" className={BTN_GHOST} onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "Show table" : "Show raw JSON"}
              </button>
            )}
          </div>
          {records && (showRaw ? <RawJson value={records} /> : <RecordsTable bundle={records} />)}
        </div>
      )}

      {consent.status === "APPROVED" && panel === "close" && (
        <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-bg p-3">
          <p className="text-[12.5px] text-ink-700">
            Close the visit at the end of the encounter. DHA usually sends the client a one-time
            code to confirm the close.
          </p>
          <label className="flex items-center gap-2 text-[13px] text-ink-900">
            <input
              type="checkbox"
              checked={closeIncapable}
              disabled={busy}
              onChange={(e) => setCloseIncapable(e.target.checked)}
            />
            The client cannot consent to closing
          </label>
          {closeIncapable && (
            <Field label="Why the client cannot consent" htmlFor={`${ids}-close`}>
              <textarea
                id={`${ids}-close`}
                className={INPUT}
                rows={2}
                value={closeReason}
                disabled={busy}
                onChange={(e) => setCloseReason(e.target.value)}
              />
            </Field>
          )}
          <div>
            <button
              type="button"
              className={BTN}
              disabled={busy || (closeIncapable && !closeReason.trim())}
              onClick={() =>
                void act(
                  (t) =>
                    closeShrVisit(
                      t,
                      consent.id,
                      closeIncapable
                        ? { patient_incapable: true, incapacity_reason: closeReason.trim() }
                        : {},
                    ),
                  "Couldn't close the visit.",
                )
              }
            >
              Close visit
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmSend}
        title="Send to the national record?"
        confirmLabel="Send permanently"
        busyLabel="Sending…"
        tone="danger"
        busy={busy}
        error={sendError}
        onConfirm={() => void send()}
        onCancel={() => setConfirmSend(false)}
      >
        <p>
          The {preview?.resources.length ?? 0} resource
          {preview?.resources.length === 1 ? "" : "s"} shown in the preview will be added to this
          client&apos;s national Shared Health Record.
        </p>
        <p className="font-semibold text-ink-900">
          This is permanent. Once in the national record it cannot be recalled or deleted.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function RawJson({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-lg border border-surface-border bg-surface-card p-3 text-[11.5px] text-ink-900">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

interface Coding {
  code?: string;
  display?: string;
}
interface CodeableConcept {
  text?: string;
  coding?: Coding[];
}
/** The few fields of a returned FHIR resource the table shows. */
interface ResourceLike {
  resourceType?: string;
  status?: string;
  clinicalStatus?: CodeableConcept;
  code?: CodeableConcept;
  medicationCodeableConcept?: CodeableConcept;
  vaccineCode?: CodeableConcept;
  type?: CodeableConcept[];
  effectiveDateTime?: string;
  effectivePeriod?: { start?: string };
  onsetDateTime?: string;
  recordedDate?: string;
  authoredOn?: string;
  occurrenceDateTime?: string;
  whenHandedOver?: string;
  issued?: string;
  period?: { start?: string };
  meta?: { lastUpdated?: string };
}

function conceptText(concept: CodeableConcept | undefined) {
  if (!concept) return "";
  const coding = concept.coding?.[0];
  const label = concept.text || coding?.display || "";
  if (coding?.code && label) return `${coding.code} · ${label}`;
  return coding?.code || label;
}

function resourceCode(r: ResourceLike) {
  return (
    conceptText(r.code) ||
    conceptText(r.medicationCodeableConcept) ||
    conceptText(r.vaccineCode) ||
    conceptText(r.type?.[0])
  );
}

function resourceDate(r: ResourceLike) {
  return (
    r.effectiveDateTime ||
    r.effectivePeriod?.start ||
    r.onsetDateTime ||
    r.recordedDate ||
    r.authoredOn ||
    r.occurrenceDateTime ||
    r.whenHandedOver ||
    r.issued ||
    r.period?.start ||
    r.meta?.lastUpdated ||
    ""
  );
}

/** Date-only and unparseable values are shown as received — no timezone shift. */
function shownDate(value: string) {
  if (
    /^(\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(value) ||
    Number.isNaN(new Date(value).getTime())
  ) {
    return value;
  }
  return formatDateTime(value);
}

function resourceStatus(r: ResourceLike) {
  return r.status || conceptText(r.clinicalStatus);
}

/** The searchset as a plain table — shown as DHA returned it, nothing interpreted. */
function RecordsTable({ bundle }: { bundle: ShrSearchset }) {
  const entries = (bundle.entry ?? []).filter((e) => e.resource);
  if (entries.length === 0) {
    return <p className="text-[13px] text-ink-500">The national record returned no entries.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className={TABLE}>
        <thead>
          <tr>
            <th className={TH}>Resource</th>
            <th className={TH}>Code / display</th>
            <th className={TH}>Date</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => {
            const r = e.resource as ResourceLike;
            const date = resourceDate(r);
            return (
              <tr key={e.fullUrl ?? i}>
                <td className={TD}>{r.resourceType || "—"}</td>
                <td className={TD}>{resourceCode(r) || "—"}</td>
                <td className={TD}>{date ? shownDate(date) : "—"}</td>
                <td className={TD}>{resourceStatus(r) || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
