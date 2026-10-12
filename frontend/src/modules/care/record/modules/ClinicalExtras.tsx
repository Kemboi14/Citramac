import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../../../auth/useAuth";
import {
  acknowledgeLab, agreeConfidentiality, getLabs, getLegalForms, getOat, getTherapy, orderLabs, prepareLegalForm,
  recordNaloxone, recordTherapySession, referOat, signLegalForm, startTherapy, updateOatStatus,
  type LabsState, type LegalFormsState, type OatState, type TherapyEpisodeRow,
} from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { errorText } from "../../triage/helpers";

/** Shared load/act plumbing: reload after every successful write, show the server's message on failure. */
function useModule<T>(patientId: string, fetcher: (token: string, id: string) => Promise<T>) {
  const { accessToken } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!accessToken) return;
    fetcher(accessToken, patientId).then(setData).catch((e) => setError(errorText(e, "Couldn't load.")));
  }, [accessToken, patientId, fetcher]);
  useEffect(load, [load]);
  async function act(work: (token: string) => Promise<unknown>) {
    if (!accessToken) return false;
    setError(null);
    try {
      await work(accessToken);
      load();
      return true;
    } catch (e) {
      setError(errorText(e, "Couldn't save."));
      return false;
    }
  }
  return { data, error, act, token: accessToken };
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 text-[13px]">{children}</div>;
}

export function TherapyModule({ patientId }: { patientId: string }) {
  const vs = useValueSets();
  const { data, error, act } = useModule<{ results: TherapyEpisodeRow[] }>(patientId, getTherapy);
  const [modality, setModality] = useState("");
  const [planned, setPlanned] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [process, setProcess] = useState<Record<string, string>>({});
  const open = (data?.results ?? []).filter((e) => !e.ended);
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {open.map((e) => (
        <div key={e.id} className="rounded-lg border border-surface-border p-3">
          <Row>
            <strong>{vs.label("therapy-modality", e.modality)}</strong>
            {e.planned_sessions && <Tag>{e.planned_sessions} planned</Tag>}
            <Tag tone={e.confidentiality_agreed ? "brand" : "warn"}>{e.confidentiality_agreed ? "Confidentiality limits agreed" : "Confidentiality not yet agreed"}</Tag>
          </Row>
          {!e.confidentiality_agreed ? (
            <div className="mt-2">
              <Callout tone="warning">Explain the limits of confidentiality to the client before writing session notes.</Callout>
              <button type="button" className={`${BTN} ${BTN_SM} mt-2`} onClick={() => void act((t) => agreeConfidentiality(t, e.id))}>Limits explained and agreed</button>
            </div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <textarea className={INPUT} rows={3} placeholder="Session note" value={notes[e.id] ?? ""} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} />
              <textarea className={INPUT} rows={2} placeholder="Process notes (treating clinicians only — never shared)" value={process[e.id] ?? ""} onChange={(ev) => setProcess({ ...process, [e.id]: ev.target.value })} />
              <div>
                <button type="button" className={`${BTN} ${BTN_SM}`} disabled={!notes[e.id]?.trim()} onClick={() => void act((t) => recordTherapySession(t, patientId, { episode: e.id, session_notes: notes[e.id], process_notes: process[e.id] })).then((ok) => ok && setNotes({ ...notes, [e.id]: "" }))}>Record session</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <Row>
        <select className={INPUT} aria-label="Therapy modality" value={modality} onChange={(e) => setModality(e.target.value)}>
          <option value="">Start therapy — modality…</option>
          {vs.options("therapy-modality").map((o) => <option key={o.code} value={o.code}>{o.display}</option>)}
        </select>
        <input className={INPUT} type="number" min={1} placeholder="Planned sessions" value={planned} onChange={(e) => setPlanned(e.target.value)} />
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!modality} onClick={() => void act((t) => startTherapy(t, patientId, { modality, planned_sessions: planned ? Number(planned) : null })).then((ok) => ok && setModality(""))}>Start</button>
      </Row>
      <p className="text-xs text-ink-500">Group and family sessions are recorded one client at a time — each person’s record stands alone.</p>
    </div>
  );
}

export function OatModule({ patientId }: { patientId: string }) {
  const vs = useValueSets();
  const { data, error, act } = useModule<OatState>(patientId, getOat);
  const [medicine, setMedicine] = useState("");
  const [clinic, setClinic] = useState("");
  const [dose, setDose] = useState("");
  const [qty, setQty] = useState("1");
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      <Callout tone="warning">Records the referral and what the OAT prescriber set. It does not suggest a medicine or dose.</Callout>
      {data?.enrolments.map((o) => (
        <Row key={o.id}>
          <Tag tone={o.status === "ENROLLED" ? "brand" : "neutral"}>{o.status}</Tag>
          {vs.label("oat-medicine", o.medicine)} — {o.clinic}{o.prescribed_dose && ` — ${o.prescribed_dose}`}
          {o.status === "REFERRED" && (
            <>
              <input className={INPUT} placeholder="Dose as written by OAT prescriber" value={dose} onChange={(e) => setDose(e.target.value)} />
              <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void act((t) => updateOatStatus(t, o.id, { status: "ENROLLED", dose }))}>Mark enrolled</button>
            </>
          )}
        </Row>
      ))}
      <Row>
        <select className={INPUT} aria-label="Medicine" value={medicine} onChange={(e) => setMedicine(e.target.value)}>
          <option value="">Refer — medicine…</option>
          {vs.options("oat-medicine").map((o) => <option key={o.code} value={o.code}>{o.display}</option>)}
        </select>
        <input className={INPUT} placeholder="OAT clinic / service" value={clinic} onChange={(e) => setClinic(e.target.value)} />
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!medicine || !clinic.trim()} onClick={() => void act((t) => referOat(t, patientId, { medicine, clinic })).then((ok) => ok && setClinic(""))}>Refer</button>
      </Row>
      <h4 className="text-sm font-semibold">Naloxone</h4>
      {data?.naloxone.map((n) => <Row key={n.id}><Tag>{n.outcome === "SUPPLIED" ? `Supplied ×${n.quantity}` : "Declined"}</Tag>{formatDateTime(n.at)}{n.training_given && " · training given"}</Row>)}
      <Row>
        <input className={`${INPUT} w-20`} type="number" min={1} aria-label="Kits" value={qty} onChange={(e) => setQty(e.target.value)} />
        <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void act((t) => recordNaloxone(t, patientId, { outcome: "SUPPLIED", quantity: Number(qty), training_given: true }))}>Supplied with training</button>
        <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void act((t) => recordNaloxone(t, patientId, { outcome: "DECLINED" }))}>Offered and declined</button>
      </Row>
    </div>
  );
}

export function LabsModule({ patientId }: { patientId: string }) {
  const { data, error, act } = useModule<LabsState>(patientId, getLabs);
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {Object.entries(data?.order_sets ?? {}).map(([name, codes]) => (
        <button key={name} type="button" className={`${BTN_GHOST} ${BTN_SM} self-start`} onClick={() => void act((t) => orderLabs(t, patientId, codes))}>Order set: {name}</button>
      ))}
      {data?.results.length === 0 && <p className="text-[13px] text-ink-500">No validated results yet.</p>}
      {data?.results.map((r) => (
        <Row key={r.id}>
          <Tag tone={r.abnormal ? "risk" : "neutral"}>{r.abnormal ? "Abnormal" : "Normal"}</Tag>
          {r.name}: <strong>{r.value} {r.unit}</strong> <span className="text-ink-500">ref {r.reference_range || "—"} · {formatDateTime(r.recorded_at)}</span>
          {r.abnormal && !r.acknowledged && <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void act((t) => acknowledgeLab(t, r.id))}>Acknowledge</button>}
        </Row>
      ))}
      {data && data.orders.length > 0 && <p className="text-xs text-ink-500">{data.orders.length} order(s) on this record. Reference ranges come from the laboratory, not this screen.</p>}
    </div>
  );
}

export function LegalFormsModule({ patientId }: { patientId: string }) {
  const { data, error, act } = useModule<LegalFormsState>(patientId, getLegalForms);
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      {data && data.catalogue.length === 0 && <Callout tone="warning">No statutory forms are configured for this facility yet. Form numbers and titles must come from the regulator.</Callout>}
      {data?.catalogue.map((f) => (
        <Row key={f.key}>{f.title}<button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void act((t) => prepareLegalForm(t, patientId, f.key))}>Prepare</button></Row>
      ))}
      {data?.results.map((f) => (
        <Row key={f.id}>
          <Tag tone={f.status === "SIGNED" ? "brand" : "warn"}>{f.status === "SIGNED" ? "Signed" : f.status === "COSIGN_REQUESTED" ? "Awaiting co-signature" : "Draft"}</Tag>
          {data.catalogue.find((c) => c.key === f.form_key)?.title ?? f.form_key}
          {f.status === "DRAFT" && <button type="button" className={`${BTN} ${BTN_SM}`} onClick={() => void act((t) => signLegalForm(t, f.id))}>Sign</button>}
        </Row>
      ))}
    </div>
  );
}
