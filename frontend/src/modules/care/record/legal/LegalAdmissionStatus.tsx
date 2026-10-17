import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../../auth/useAuth";
import {
  amendLegalDocument,
  completeLegalTask,
  endInvoluntary,
  fetchLegalPrint,
  getLegalWorkspace,
  giveDischargeNotice,
  recordLegalDecision,
  recordNoticeDeparture,
  saveLegalDraft,
  signLegalDocument,
  startLegalApplication,
  startRecommendation,
  unmaskIdentity,
  withdrawDischargeNotice,
  type ConfigText,
  type EvidenceItem,
  type LegalCategory,
  type LegalDocumentRow,
  type LegalWorkspace,
} from "../../../../lib/legalStatusApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { Callout, Card, ErrorNote, Tag } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { errorText } from "../../triage/helpers";
import { useRecordData } from "../useRecordData";
import { countdownText, useNow } from "./countdown";

const VOL = "DOC-LEG-STAT-VOL-KE";
const INV = "DOC-LEG-STAT-INV-APP-KE";
const REC = "DOC-LEG-STAT-INV-REC-KE";
const SOURCE_LABEL: Record<string, string> = {
  CLIENT_REPORT: "Client report",
  THIRD_PARTY_REPORT: "Third-party report",
  CLINICIAN_OBSERVATION: "Clinician observation",
  MEASUREMENT: "Measurement",
  ASSESSMENT_RESULT: "Assessment result",
  PREVIOUS_RECORD: "Previous record",
};

const txt = (entry: ConfigText | string | undefined) =>
  typeof entry === "string" ? entry : (entry?.text ?? "");

function fill(text: string, values: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );
}

/** Statutory wording from config, with a marker when it was supplied as a description. */
function Statutory({ entry, values = {} }: { entry: ConfigText | string; values?: Record<string, string> }) {
  const verbatim = typeof entry === "string" || entry.verbatim !== false;
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-900">
      {fill(txt(entry), values)}
      {!verbatim && (
        <span className="ml-2 align-middle">
          <Tag tone="warn">VERIFY wording against the paper form</Tag>
        </span>
      )}
    </p>
  );
}

function Evidence({ items }: { items: EvidenceItem[] | undefined }) {
  if (!items || items.length === 0)
    return <p className="text-[11.5px] text-ink-400">No linked finding on record.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((e, i) => (
        <li key={i} className="rounded-md border border-surface-border bg-surface-bg px-2 py-1 text-[11.5px] text-ink-700">
          <span className="font-semibold text-ink-900">{e.label}:</span> {e.value}{" "}
          <span className="text-ink-500">
            — {SOURCE_LABEL[e.source] ?? e.source}, {e.record}
            {e.recorded_at ? `, ${formatDateTime(e.recorded_at)}` : ""}
            {e.recorded_by ? `, ${e.recorded_by}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-surface-border p-3.5">
      <h4 className="text-[12px] font-bold uppercase tracking-wide text-ink-700">{title}</h4>
      {children}
    </section>
  );
}

/** Signature capture: witnessed e-signature or a scanned wet signature (LGL-V-05). */
function SignatureFields({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const method = (value.method as string) || "ELECTRONIC";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-4 text-[13px]">
        {(
          [
            ["ELECTRONIC", "Electronic signature, signed in my presence"],
            ["WET_SCAN", "Captured wet signature (scan uploaded to Documents)"],
          ] as const
        ).map(([code, label]) => (
          <label key={code} className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              checked={method === code}
              onChange={() => onChange({ ...value, method: code })}
            />
            {label}
          </label>
        ))}
      </div>
      {method === "ELECTRONIC" ? (
        <label className="inline-flex items-center gap-1.5 text-[13px]">
          <input
            type="checkbox"
            checked={Boolean(value.attested)}
            onChange={(e) => onChange({ ...value, method, attested: e.target.checked })}
          />
          I confirm the signer signed in my presence
        </label>
      ) : (
        <input
          className={INPUT}
          placeholder="Attachment ID of the uploaded scan"
          value={(value.attachment_id as string) ?? ""}
          onChange={(e) => onChange({ ...value, method, attachment_id: e.target.value })}
        />
      )}
    </div>
  );
}

/** Legal admission status (master prompt §7A) — one LegalStatus per episode. */
export function LegalAdmissionStatus({ patientId, onChanged }: { patientId: string; onChanged: () => void }) {
  const { accessToken } = useAuth();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, error: loadError } = useRecordData(
    patientId,
    version,
    (token) => getLegalWorkspace(token, patientId),
    "Couldn't load the legal admission status.",
  );
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  const run = async (fn: (token: string) => Promise<unknown>, fallback: string) => {
    if (!accessToken) return false;
    setBusy(true);
    setError(null);
    try {
      await fn(accessToken);
      refresh();
      return true;
    } catch (err) {
      setError(errorText(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (loadError && !data) return <ErrorNote>{loadError}</ErrorNote>;
  if (!data) return <p className="text-[13px] text-ink-500">Loading legal status…</p>;

  const ls = data.legal_status;
  const docs = data.documents;
  const pending = docs.find((d) => d.id === ls?.pending_application);
  const recs = docs.filter((d) => d.template_id === REC && d.application === pending?.id && !d.superseded);
  const canStart = !ls?.pending_application && data.episode_id;

  return (
    <Card
      title="Legal admission status"
      aside={data.banner ? <Tag tone={data.banner.category === "INVOLUNTARY" ? "risk" : "brand"}>{data.banner.label}</Tag> : null}
    >
      <div className="flex flex-col gap-4">
        <ErrorNote>{error}</ErrorNote>
        <StatusSummary data={data} />
        {data.notice && <NoticePanel data={data} busy={busy} run={run} />}
        {ls?.status === "ACTIVE" && ls.category === "VOLUNTARY" && !data.notice && (
          <GiveNotice data={data} busy={busy} run={run} />
        )}
        {canStart && (
          <div className="flex flex-wrap gap-2">
            {(["VOLUNTARY", "INVOLUNTARY"] as LegalCategory[])
              .filter((c) => !(ls?.status === "ACTIVE" && ls.category === c))
              .map((c) => (
                <button
                  key={c}
                  type="button"
                  className={BTN_GHOST}
                  disabled={busy}
                  onClick={() =>
                    run((t) => startLegalApplication(t, patientId, c), "Couldn't start the application.")
                  }
                >
                  {ls?.status === "ACTIVE"
                    ? `Start ${c.toLowerCase()} application (conversion)`
                    : `Start ${c.toLowerCase()} application`}
                </button>
              ))}
          </div>
        )}
        {!data.episode_id && (
          <Callout tone="warning">This client has no open episode of care; open one before an admission application.</Callout>
        )}
        {pending && pending.template_id === VOL && (
          <VoluntaryForm key={pending.id} doc={pending} data={data} busy={busy} run={run} />
        )}
        {pending && pending.template_id === INV && (
          <InvoluntaryForm key={pending.id} doc={pending} data={data} busy={busy} run={run} />
        )}
        {pending && pending.template_id === INV && pending.status === "SIGNED" && (
          <Section title="Recommendation for involuntary treatment">
            <p className="text-[12.5px] text-ink-700">
              {recs.filter((r) => r.status === "SIGNED").length} of {ls?.required_recommendations} required
              signed recommendation(s).
            </p>
            {data.me.credential.can_sign ? (
              !recs.some((r) => r.status === "DRAFT") && (
                <button
                  type="button"
                  className={`${BTN_GHOST} ${BTN_SM} w-fit`}
                  disabled={busy}
                  onClick={() => run((t) => startRecommendation(t, pending.id), "Couldn't open the recommendation.")}
                >
                  Start my recommendation
                </button>
              )
            ) : (
              <Callout tone="warning">Signing unavailable: {data.me.credential.reason}</Callout>
            )}
            {recs.map((r) => (
              <RecommendationForm key={r.id} doc={r} data={data} busy={busy} run={run} />
            ))}
          </Section>
        )}
        {pending && pending.status === "SIGNED" && <OfficialUse data={data} busy={busy} run={run} />}
        {ls?.status === "ACTIVE" || ls?.status === "EXPIRED" ? (
          ls.category === "INVOLUNTARY" && data.me.is_admitting_officer && <EndStatus data={data} busy={busy} run={run} />
        ) : null}
        <RightsPanel data={data} />
        <TasksPanel data={data} busy={busy} run={run} />
        <DocumentsPanel data={data} busy={busy} run={run} setError={setError} />
        <HistoryPanel data={data} />
        <p className="text-[11px] text-ink-400">
          Form wording: jurisdiction config {data.config.version}. {data.config.provenance}
        </p>
      </div>
    </Card>
  );
}

type Runner = (fn: (token: string) => Promise<unknown>, fallback: string) => Promise<boolean>;
interface PanelProps {
  data: LegalWorkspace;
  busy: boolean;
  run: Runner;
}

function StatusSummary({ data }: { data: LegalWorkspace }) {
  const ls = data.legal_status;
  if (!ls) return <p className="text-[13px] text-ink-500">No admission application is recorded for this episode.</p>;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Item label="Category">{ls.category === "VOLUNTARY" ? "Voluntary" : "Involuntary"}</Item>
      <Item label="Status">{ls.status.replace(/_/g, " ").toLowerCase()} · {ls.workflow_state.replace(/_/g, " ").toLowerCase()}</Item>
      <Item label="Decision">
        {ls.decision}
        {ls.decision_at ? ` — ${ls.decision_by}${ls.decision_role ? ` (${ls.decision_role})` : ""}, ${formatDateTime(ls.decision_at)}` : ""}
        {ls.decision_reason ? ` · Reason: ${ls.decision_reason}` : ""}
      </Item>
      <Item label="Effective / maximum expiry">
        {ls.effective_from ? formatDateTime(ls.effective_from) : "—"}
        {ls.max_expiry_at ? ` → ${formatDateTime(ls.max_expiry_at)}` : ""}
      </Item>
      <div className="sm:col-span-2 lg:col-span-4">
        <Item label="Statutory basis (as printed on the form)">
          {ls.statutory_basis.map((s) => `${s.act}${s.section ? ` s.${s.section}` : ""}`).join("; ") || "—"}
        </Item>
      </div>
    </dl>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="break-words text-[13px] text-ink-900">{children}</dd>
    </div>
  );
}

function DocActions({ doc, onSave, onSign, signBody, busy }: {
  doc: LegalDocumentRow;
  onSave?: () => void;
  onSign: () => void;
  signBody?: ReactNode;
  busy: boolean;
}) {
  if (doc.status !== "DRAFT")
    return (
      <p className="text-[12.5px] text-ink-700">
        Signed by {doc.signer_name} ({doc.signer_kind.toLowerCase().replace("_", " ")}) — {formatDateTime(doc.signed_at)}
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      {signBody}
      <div className="flex flex-wrap gap-2">
        {onSave && (
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={busy} onClick={onSave}>
            Save draft
          </button>
        )}
        <button type="button" className={`${BTN} ${BTN_SM}`} disabled={busy} onClick={onSign}>
          Sign
        </button>
      </div>
    </div>
  );
}

function VoluntaryForm({ doc, data, busy, run }: PanelProps & { doc: LegalDocumentRow }) {
  const form = data.config.forms[VOL];
  const [sig, setSig] = useState<Record<string, unknown>>({ method: "ELECTRONIC", signer_kind: "CLIENT" });
  const acknowledged = Boolean(doc.content.notice_acknowledged_at);
  const minor = data.client.age !== null && data.client.age < (data.config.operational.minorAgeYears ?? 18);
  const guardians = data.related_persons.filter((p) => p.is_guardian);
  const draft = doc.status === "DRAFT";
  return (
    <Section title={`${form.title} — ${form.statuteLine}`}>
      <Statutory entry={form.explanatoryText} />
      <div className="rounded-lg border-2 border-ink-900 p-3">
        <p className="text-[12px] font-bold">{txt(form.noticeHeading)}</p>
        <Statutory entry={form.noticeText} />
        <p className="text-[12px] italic text-ink-700">({txt(form.noticePurpose)})</p>
        <label className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={!draft || busy}
            onChange={(e) =>
              run((t) => saveLegalDraft(t, doc.id, { notice_acknowledged: e.target.checked }), "Couldn't record the acknowledgement.")
            }
          />
          {txt(form.noticeAcknowledgement)}
          {acknowledged && <span className="font-normal text-ink-500"> — {formatDateTime(doc.content.notice_acknowledged_at as string)}</span>}
        </label>
      </div>
      <Statutory
        entry={form.declaration}
        values={{ fullName: data.client.full_name, address: data.client.address || "(address not recorded)", facilityName: data.facility.name }}
      />
      <p className="text-[11.5px] text-ink-500">Name and address come from the client record; correct them there (audited).</p>
      {data.capacity.required && (
        <Callout tone="warning">
          <div>
            <strong>{data.capacity.text}</strong>
            <ul className="list-disc pl-4">
              {data.capacity.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {data.capacity.confirmation
              ? `Recorded: ${data.capacity.confirmation.outcome} — ${data.capacity.confirmation.assessed_by}, ${formatDateTime(data.capacity.confirmation.assessed_at)}`
              : "Record a capacity assessment for “Admission / inpatient treatment” in the Capacity card below."}
          </div>
        </Callout>
      )}
      {minor && (
        <Callout tone="warning">
          The client is under {data.config.operational.minorAgeYears}. Self-application is not available; the parent/guardian signs and
          guardian consent is recorded.
        </Callout>
      )}
      <DocActions
        doc={doc}
        busy={busy}
        onSign={() => run((t) => signLegalDocument(t, doc.id, sig), "Couldn't sign the application.")}
        signBody={
          <>
            <div className="flex flex-wrap gap-4 text-[13px]">
              {!minor && (
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" checked={sig.signer_kind === "CLIENT"} onChange={() => setSig({ ...sig, signer_kind: "CLIENT" })} />
                  Signed by the client
                </label>
              )}
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={sig.signer_kind === "GUARDIAN"} onChange={() => setSig({ ...sig, signer_kind: "GUARDIAN" })} />
                Signed by the parent/guardian
              </label>
            </div>
            {sig.signer_kind === "GUARDIAN" && (
              <select
                className={INPUT}
                value={(sig.related_person_id as string) ?? ""}
                onChange={(e) => setSig({ ...sig, related_person_id: e.target.value })}
              >
                <option value="">Choose the recorded guardian…</option>
                {guardians.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            {data.client.age === null && sig.signer_kind === "CLIENT" && (
              <label className="inline-flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" checked={Boolean(sig.adult_confirmed)} onChange={(e) => setSig({ ...sig, adult_confirmed: e.target.checked })} />
                Age not recorded — I confirm the client is an adult
              </label>
            )}
            <SignatureFields value={sig} onChange={setSig} />
          </>
        }
      />
    </Section>
  );
}

function IdNumber({ data, subject, masked, present, personId }: {
  data: LegalWorkspace;
  subject: "client" | "applicant";
  masked: string;
  present: boolean;
  personId?: string;
}) {
  const { accessToken } = useAuth();
  const [shown, setShown] = useState<string | null>(null);
  if (!present) return <span className="text-ink-400">Not recorded</span>;
  return (
    <span>
      <span className="font-mono">{shown ?? masked}</span>{" "}
      {data.me.can_unmask && data.legal_status && shown === null && (
        <button
          type="button"
          className="text-[11.5px] font-semibold text-brand-green underline"
          onClick={async () => {
            if (!accessToken || !data.legal_status) return;
            const r = await unmaskIdentity(accessToken, data.legal_status.id, subject, personId);
            setShown(r.value);
          }}
        >
          Show (logged)
        </button>
      )}
    </span>
  );
}

function InvoluntaryForm({ doc, data, busy, run }: PanelProps & { doc: LegalDocumentRow }) {
  const form = data.config.forms[INV];
  const vs = useValueSets();
  const draft = doc.status === "DRAFT";
  const c = doc.content as { assertions?: string[]; other_description?: string; applicant_related_person_id?: string };
  const linked = data.related_persons.find((p) => p.id === c.applicant_related_person_id);
  const nok = data.related_persons.find((p) => p.id === data.next_of_kin_id);
  const [assertions, setAssertions] = useState<string[]>(c.assertions ?? []);
  const [other, setOther] = useState(c.other_description ?? "");
  const initial = linked ?? nok;
  const [applicant, setApplicant] = useState({
    applicant_related_person_id: initial?.id ?? "",
    applicant_name: initial?.name ?? "",
    applicant_address: initial?.address ?? "",
    applicant_phone: initial?.phone ?? "",
    applicant_relationship: initial?.relationship ?? "",
    applicant_relationship_detail: initial?.relationship_detail ?? "",
    applicant_id_number: "",
  });
  const [clientId, setClientId] = useState({ client_id_number: "", client_id_kind: "NATIONAL_ID" });
  const [sig, setSig] = useState<Record<string, unknown>>({ method: "ELECTRONIC" });
  const choosePerson = (id: string) => {
    const p = data.related_persons.find((r) => r.id === id);
    setApplicant({
      applicant_related_person_id: id,
      applicant_name: p?.name ?? "",
      applicant_address: p?.address ?? "",
      applicant_phone: p?.phone ?? "",
      applicant_relationship: p?.relationship ?? "",
      applicant_relationship_detail: p?.relationship_detail ?? "",
      applicant_id_number: "",
    });
  };
  const save = () => {
    const body: Record<string, unknown> = { assertions, other_description: other, ...applicant };
    if (!body.applicant_related_person_id) delete body.applicant_related_person_id;
    if (clientId.client_id_number) Object.assign(body, clientId);
    return run((t) => saveLegalDraft(t, doc.id, body), "Couldn't save the application.");
  };
  const rel = vs.options("next-of-kin-relationship");
  const labels = form.labels;
  return (
    <Section title={`${form.title} — ${form.statuteLine}`}>
      <h5 className="text-[12px] font-bold">{form.parts.A}</h5>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Item label={labels.clientFullName}>{data.client.full_name}</Item>
        <Item label={labels.clientIdNumber}>
          <IdNumber data={data} subject="client" masked={data.client.id_number_masked} present={data.client.id_number_present} />
        </Item>
        <Item label={labels.clientGender}>
          {data.client.gender_form
            ? `${{ MALE: labels.genderMale, FEMALE: labels.genderFemale, OTHER: labels.genderOther }[data.client.gender_form] ?? ""} ${data.client.gender_other_detail}`
            : "Not recorded in the client record"}
        </Item>
      </dl>
      {!data.client.id_number_present && draft && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr]">
          <select className={INPUT} value={clientId.client_id_kind} onChange={(e) => setClientId({ ...clientId, client_id_kind: e.target.value })}>
            <option value="NATIONAL_ID">National ID</option>
            <option value="PASSPORT">Passport</option>
          </select>
          <input
            className={INPUT}
            placeholder="Add to the client's central identity record"
            value={clientId.client_id_number}
            onChange={(e) => setClientId({ ...clientId, client_id_number: e.target.value })}
          />
        </div>
      )}
      <p className="text-[12.5px] font-semibold">
        {labels.clientIs} <span className="font-normal text-ink-500">(the applicant’s statement — third-party report; findings shown for context only)</span>
      </p>
      {form.assertions.map((a: { code: string; text: string; evidence: string | null }) => (
        <div key={a.code} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(220px,1fr)_2fr]">
          <label className="inline-flex items-start gap-1.5 text-[13px]">
            <input
              type="checkbox"
              disabled={!draft}
              checked={assertions.includes(a.code)}
              onChange={(e) => setAssertions(e.target.checked ? [...assertions, a.code] : assertions.filter((x) => x !== a.code))}
            />
            {a.text}
          </label>
          {a.evidence ? <Evidence items={data.evidence[a.evidence]} /> : <span />}
        </div>
      ))}
      {assertions.includes("OTHER") && (
        <textarea className={INPUT} disabled={!draft} placeholder={labels.otherDescribe} value={other} onChange={(e) => setOther(e.target.value)} />
      )}
      <h5 className="mt-2 text-[12px] font-bold">{form.parts.B}</h5>
      {draft && (
        <select className={INPUT} value={applicant.applicant_related_person_id} onChange={(e) => choosePerson(e.target.value)}>
          <option value="">New applicant (added to the client’s related persons)</option>
          {data.related_persons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === data.next_of_kin_id ? " — next of kin" : ""}
            </option>
          ))}
        </select>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input className={INPUT} disabled={!draft} placeholder={labels.applicantFullName} value={applicant.applicant_name}
          onChange={(e) => setApplicant({ ...applicant, applicant_name: e.target.value })} />
        <input className={INPUT} disabled={!draft} placeholder={`${labels.applicantPhone} (+254…)`} value={applicant.applicant_phone}
          onChange={(e) => setApplicant({ ...applicant, applicant_phone: e.target.value })} />
        <input className={INPUT} disabled={!draft} placeholder={labels.applicantAddress} value={applicant.applicant_address}
          onChange={(e) => setApplicant({ ...applicant, applicant_address: e.target.value })} />
        <div className="text-[12.5px]">
          {labels.applicantIdNumber}:{" "}
          {linked ? (
            <IdNumber data={data} subject="applicant" masked={linked.id_number_masked} present={linked.id_number_present} personId={linked.id} />
          ) : (
            "—"
          )}
          {draft && (
            <input className={`${INPUT} mt-1`} placeholder="Record / replace ID number" value={applicant.applicant_id_number}
              onChange={(e) => setApplicant({ ...applicant, applicant_id_number: e.target.value })} />
          )}
        </div>
        <select className={INPUT} disabled={!draft} value={applicant.applicant_relationship}
          onChange={(e) => setApplicant({ ...applicant, applicant_relationship: e.target.value })}>
          <option value="">{labels.applicantRelationship}…</option>
          {rel.map((r) => (
            <option key={r.code} value={r.code}>
              {r.display}
            </option>
          ))}
        </select>
        <input className={INPUT} disabled={!draft} placeholder="Relationship detail" value={applicant.applicant_relationship_detail}
          onChange={(e) => setApplicant({ ...applicant, applicant_relationship_detail: e.target.value })} />
      </div>
      <h5 className="mt-2 text-[12px] font-bold">{form.parts.D}</h5>
      <Statutory entry={form.declaration} values={{ clientName: data.client.full_name }} />
      <DocActions
        doc={doc}
        busy={busy}
        onSave={save}
        onSign={async () => {
          if (await save()) await run((t) => signLegalDocument(t, doc.id, sig), "Couldn't sign the application.");
        }}
        signBody={<SignatureFields value={sig} onChange={setSig} />}
      />
    </Section>
  );
}

function RecommendationForm({ doc, data, busy, run }: PanelProps & { doc: LegalDocumentRow }) {
  const form = data.config.forms[REC];
  const c = doc.content as {
    examination_date?: string;
    examination_encounter_id?: string;
    grounds?: Record<string, { affirmed: boolean; narrative: string }>;
  };
  const [exam, setExam] = useState(c.examination_date ?? "");
  const [encounter, setEncounter] = useState(c.examination_encounter_id ?? "");
  const [grounds, setGrounds] = useState<Record<string, { affirmed: boolean; narrative: string }>>(
    c.grounds ?? { a: { affirmed: false, narrative: "" }, b: { affirmed: false, narrative: "" }, c: { affirmed: false, narrative: "" } },
  );
  const draft = doc.status === "DRAFT";
  const today = new Date().toISOString().slice(0, 10);
  const d = exam ? new Date(`${exam}T00:00:00`) : null;
  const values = {
    clientName: data.client.full_name,
    practitionerName: doc.signer_name || data.me.credential.name,
    day: d ? String(d.getDate()) : "……",
    month: d ? d.toLocaleString("en-GB", { month: "long" }) : "……",
    yy: d ? String(d.getFullYear()).slice(2) : "……",
    pronoun: data.client.pronoun,
  };
  const save = () =>
    run((t) => saveLegalDraft(t, doc.id, { examination_date: exam, examination_encounter_id: encounter, grounds }), "Couldn't save the recommendation.");
  const ls = data.legal_status;
  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-surface-border p-3 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-bold">{form.title}</p>
        <Statutory entry={form.intro} values={values} />
        {form.declarations.map((decl: { number: number; lead?: string; text: string; grounds?: { code: string; text: string }[] }) => (
          <div key={decl.number}>
            {decl.text && (
              <p className="text-[13px]">
                {decl.number}. {decl.lead ? `${decl.lead}: ` : ""}
                {fill(decl.text, values)}
              </p>
            )}
            {decl.number === 2 && draft && (
              <div className="ml-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input type="date" max={today} className={INPUT} value={exam} onChange={(e) => setExam(e.target.value)} />
                <select className={INPUT} value={encounter} onChange={(e) => setEncounter(e.target.value)}>
                  <option value="">Link the examination encounter…</option>
                  {data.encounters.map((en) => (
                    <option key={en.id} value={en.id}>
                      {en.type || "Encounter"} — {formatDateTime(en.opened_at)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {decl.grounds && (
              <div className="ml-4 flex flex-col gap-2">
                <p className="text-[13px]">{decl.number}.</p>
                {decl.grounds.map((g) => (
                  <div key={g.code} className="flex flex-col gap-1">
                    <label className="inline-flex items-start gap-1.5 text-[13px]">
                      <input
                        type="checkbox"
                        disabled={!draft}
                        checked={grounds[g.code]?.affirmed ?? false}
                        onChange={(e) => setGrounds({ ...grounds, [g.code]: { ...grounds[g.code], affirmed: e.target.checked } })}
                      />
                      ({g.code}) {fill(g.text, values)}
                    </label>
                    <textarea
                      className={INPUT}
                      disabled={!draft}
                      placeholder={form.labels.groundNarrative}
                      value={grounds[g.code]?.narrative ?? ""}
                      onChange={(e) => setGrounds({ ...grounds, [g.code]: { ...grounds[g.code], narrative: e.target.value } })}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <p className="text-[12.5px] text-ink-700">
          {form.labels.qualifications}: {data.me.credential.qualifications || "—"} · {form.labels.registration}:{" "}
          {data.me.credential.registration_number} ({data.me.credential.registration_verified_at ? formatDateTime(data.me.credential.registration_verified_at) : "unverified"})
        </p>
        <p className="text-[12.5px]">
          {form.labels.admitted} / {form.labels.rejected}: <strong>{ls?.application_document === doc.application ? ls?.decision : "PENDING"}</strong>{" "}
          <span className="text-ink-500">{form.labels.decisionMirror}</span>
        </p>
        <DocActions
          doc={doc}
          busy={busy}
          onSave={save}
          onSign={async () => {
            if (await save()) await run((t) => signLegalDocument(t, doc.id, {}), "Couldn't sign the recommendation.");
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-bold uppercase text-ink-500">Clinical evidence (read-only)</p>
        {(
          [
            ["danger_to_self", "Suicide / self-harm"],
            ["danger_to_others", "Risk to others"],
            ["unable_self_care", "Functional safety"],
            ["incapable_decisions", "MSE insight / judgement"],
            ["working_diagnosis", "Working diagnosis"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <p className="text-[11.5px] font-semibold">{label}</p>
            <Evidence items={data.evidence[key]} />
          </div>
        ))}
      </div>
    </div>
  );
}

function OfficialUse({ data, busy, run }: PanelProps) {
  const [reason, setReason] = useState("");
  const ls = data.legal_status;
  if (!ls) return null;
  return (
    <Section title="For official use only">
      {data.me.is_admitting_officer ? (
        <>
          <textarea className={INPUT} placeholder="Reason (required to reject)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${BTN} ${BTN_SM}`} disabled={busy}
              onClick={() => run((t) => recordLegalDecision(t, ls.id, "ADMITTED", reason), "Couldn't record the decision.")}>
              Admitted
            </button>
            <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={busy || !reason.trim()}
              onClick={() => run((t) => recordLegalDecision(t, ls.id, "REJECTED", reason), "Couldn't record the decision.")}>
              Rejected
            </button>
          </div>
          <p className="text-[11.5px] text-ink-500">Your name, role and the date/time are recorded automatically.</p>
        </>
      ) : (
        <p className="text-[12.5px] text-ink-500">Awaiting an admitting officer’s decision.</p>
      )}
    </Section>
  );
}

function EndStatus({ data, busy, run }: PanelProps) {
  const [reason, setReason] = useState("");
  const ls = data.legal_status;
  if (!ls) return null;
  return (
    <Section title="Review outcome">
      <textarea className={INPUT} placeholder="Reason for ending the involuntary status" value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className={`${BTN_GHOST} ${BTN_SM} w-fit`} disabled={busy || !reason.trim()}
        onClick={() => run((t) => endInvoluntary(t, ls.id, reason), "Couldn't record the outcome.")}>
        End involuntary status (discharged)
      </button>
      <p className="text-[11.5px] text-ink-500">
        Conversion to voluntary needs a new signed voluntary application. Renewal is not available until the statutory process is
        supplied (VERIFY).
      </p>
    </Section>
  );
}

function GiveNotice({ data, busy, run }: PanelProps) {
  const [sig, setSig] = useState<Record<string, unknown>>({ method: "ELECTRONIC" });
  const [statement, setStatement] = useState("");
  const [givenAt, setGivenAt] = useState("");
  const ls = data.legal_status;
  if (!ls) return null;
  return (
    <Section title="Written notice of intention to leave">
      <textarea className={INPUT} placeholder="The client's written notice, in their words" value={statement} onChange={(e) => setStatement(e.target.value)} />
      <label className="text-[12.5px]">
        Notice given at (leave blank for now){" "}
        <input type="datetime-local" className={INPUT} value={givenAt} onChange={(e) => setGivenAt(e.target.value)} />
      </label>
      <SignatureFields value={sig} onChange={setSig} />
      <button type="button" className={`${BTN} ${BTN_SM} w-fit`} disabled={busy}
        onClick={() => run((t) => giveDischargeNotice(t, ls.id, { ...sig, statement, given_at: givenAt || undefined }), "Couldn't record the notice.")}>
        Record written notice (received by me)
      </button>
    </Section>
  );
}

function NoticePanel({ data, busy, run }: PanelProps) {
  const navigate = useNavigate();
  const now = useNow();
  const notice = data.notice;
  if (!notice) return null;
  const early = new Date(notice.earliest_departure_at).getTime() > now;
  return (
    <Callout tone="warning">
      <div className="flex flex-col gap-1.5">
        <strong>
          {notice.notice_period_hours}-hour written notice: {countdownText(notice.earliest_departure_at, now)} (earliest departure{" "}
          {formatDateTime(notice.earliest_departure_at)})
        </strong>
        <span>
          Given {formatDateTime(notice.given_at)} to {notice.given_to}.
        </span>
        {notice.risk_review_prompt && <strong>{notice.risk_review_prompt}</strong>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={busy}
            onClick={() => run((t) => withdrawDischargeNotice(t, notice.id), "Couldn't withdraw the notice.")}>
            Notice withdrawn
          </button>
          <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={busy}
            onClick={async () => {
              let admission: string | null = null;
              const ok = await run(async (t) => {
                admission = (await recordNoticeDeparture(t, notice.id)).admission_id;
              }, "Couldn't record the departure.");
              if (ok && admission) navigate(`/clinical/discharge?admission=${admission}`);
            }}>
            {early ? "Client leaving now — against medical advice" : "Client leaving — open discharge"}
          </button>
        </div>
      </div>
    </Callout>
  );
}

function RightsPanel({ data }: { data: LegalWorkspace }) {
  const rights = data.config.rights;
  return (
    <Section title="Rights information">
      <p className="text-[12.5px] text-ink-700">The form states that the Act “{txt(rights.formStatement)}”.</p>
      {rights.text ? (
        <p className="whitespace-pre-wrap text-[13px]">{rights.text}</p>
      ) : (
        <Callout tone="warning">{rights.notConfiguredLabel}</Callout>
      )}
    </Section>
  );
}

function TasksPanel({ data, busy, run }: PanelProps) {
  if (data.tasks.length === 0) return null;
  return (
    <Section title="Legal status tasks">
      <ul className="flex flex-col gap-1.5">
        {data.tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 text-[13px]">
            {t.priority === "urgent" && <Tag tone="risk">Urgent</Tag>}
            <span className={t.completed_at ? "text-ink-400 line-through" : ""}>{t.label}</span>
            <span className="text-[11.5px] text-ink-500">
              {t.assignee || t.owner}
              {t.due_at ? ` · due ${formatDateTime(t.due_at)}` : ""}
              {t.completed_at ? ` · done ${formatDateTime(t.completed_at)} by ${t.completed_by}` : ""}
            </span>
            {!t.completed_at && (
              <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={busy}
                onClick={() => run((tok) => completeLegalTask(tok, t.id), "Couldn't complete the task.")}>
                Mark done
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function DocumentsPanel({ data, busy, run, setError }: PanelProps & { setError: (e: string | null) => void }) {
  const { accessToken } = useAuth();
  const [amending, setAmending] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (data.documents.length === 0) return null;
  const print = async (id: string) => {
    if (!accessToken) return;
    try {
      const blob = await fetchLegalPrint(accessToken, id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(errorText(err, "Couldn't open the printable form."));
    }
  };
  return (
    <Section title="Statutory documents">
      <ul className="flex flex-col gap-2">
        {data.documents.map((d) => (
          <li key={d.id} className="flex flex-col gap-1 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{d.title}</span>
              <span className="font-mono text-[11.5px] text-ink-500">
                {d.document_number} v{d.version}
              </span>
              <Tag tone={d.status === "SIGNED" ? "brand" : "warn"}>{d.status === "SIGNED" ? "Signed" : "Draft"}</Tag>
              {d.superseded && <Tag>Superseded</Tag>}
              {d.amendment_reason && <span className="text-[11.5px] text-ink-500">Amendment: {d.amendment_reason}</span>}
              <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => print(d.id)}>
                Print
              </button>
              {d.status === "SIGNED" && !d.superseded && d.template_id !== "LGL-NOTICE-KE" && (
                <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => setAmending(amending === d.id ? null : d.id)}>
                  Amend
                </button>
              )}
            </div>
            {amending === d.id && (
              <div className="flex flex-wrap gap-2">
                <input className={INPUT} placeholder="Reason for the amendment" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className={`${BTN} ${BTN_SM}`} disabled={busy || !reason.trim()}
                  onClick={async () => {
                    if (await run((t) => amendLegalDocument(t, d.id, reason), "Couldn't start the amendment.")) {
                      setAmending(null);
                      setReason("");
                    }
                  }}>
                  Start amendment
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function HistoryPanel({ data }: { data: LegalWorkspace }) {
  if (data.history.length === 0) return null;
  return (
    <details className="rounded-lg border border-surface-border p-3.5">
      <summary className="cursor-pointer text-[12px] font-bold uppercase tracking-wide text-ink-700">Audit history</summary>
      <ul className="mt-2 flex flex-col gap-1 text-[12px] text-ink-700">
        {data.history.map((h, i) => (
          <li key={i}>
            {formatDateTime(h.at)} — {h.event.replace(/_/g, " ").toLowerCase()}
            {h.to_state && h.to_state !== h.from_state ? ` (${h.from_state || "—"} → ${h.to_state})` : ""} · {h.actor}
            {h.actor_role ? ` (${h.actor_role})` : ""}
            {typeof h.detail.reason === "string" ? ` · ${h.detail.reason}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
