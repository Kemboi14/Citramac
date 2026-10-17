import { useState, type ReactNode } from "react";
import {
  getLegalForms, getOat, prepareLegalForm, recordNaloxone, referOat, signLegalForm, updateOatStatus,
  type LegalFormsState, type OatState,
} from "../../../../lib/carePathwayApi";
import { formatDateTime } from "../../shared/format";
import { BTN, BTN_GHOST, BTN_SM, INPUT } from "../../shared/styles";
import { Callout, ErrorNote, Tag } from "../../shared/ui";
import { useValueSets } from "../../shared/useValueSets";
import { useModule } from "./useModule";

export function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 text-[13px]">{children}</div>;
}

export function OatModule({ patientId }: { patientId: string }) {
  const vs = useValueSets();
  const { data, error, act } = useModule<OatState>(patientId, getOat);
  const [medicine, setMedicine] = useState("");
  const [clinic, setClinic] = useState("");
  const [dose, setDose] = useState<Record<string, string>>({});
  const [supervised, setSupervised] = useState<Record<string, boolean>>({});
  const [stopReason, setStopReason] = useState<Record<string, string>>({});
  const [qty, setQty] = useState("1");
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote>{error}</ErrorNote>
      <Callout tone="warning">Records the referral and what the OAT prescriber set. It does not suggest a medicine or dose.</Callout>
      {data?.enrolments.map((o) => (
        <div key={o.id} className="flex flex-col gap-2 rounded-lg border border-surface-border p-2.5">
          <Row>
            <Tag tone={o.status === "ENROLLED" ? "brand" : o.status === "STOPPED" ? "risk" : "neutral"}>{o.status}</Tag>
            {vs.label("oat-medicine", o.medicine)} — {o.clinic}{o.prescribed_dose && ` — ${o.prescribed_dose}`}
            {o.status === "ENROLLED" && <Tag>{o.supervised_dispensing ? "Supervised dispensing" : "Unsupervised (take-home) dosing"}</Tag>}
          </Row>
          {o.status === "STOPPED" && o.status_reason && <p className="text-[12px] text-ink-500">Stopped: {o.status_reason}</p>}
          {o.status === "REFERRED" && (
            <Row>
              <input className={INPUT} aria-label="Dose as written by the OAT prescriber" placeholder="Dose as written by OAT prescriber" value={dose[o.id] ?? ""} onChange={(e) => setDose((x) => ({ ...x, [o.id]: e.target.value }))} />
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={supervised[o.id] ?? true} onChange={(e) => setSupervised((x) => ({ ...x, [o.id]: e.target.checked }))} /> Supervised dispensing</label>
              <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!(dose[o.id] ?? "").trim()} onClick={() => void act((t) => updateOatStatus(t, o.id, { status: "ENROLLED", dose: dose[o.id], supervised_dispensing: supervised[o.id] ?? true }))}>Mark enrolled</button>
            </Row>
          )}
          {o.status === "ENROLLED" && (
            <Row>
              <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} onClick={() => void act((t) => updateOatStatus(t, o.id, { status: "ENROLLED", dose: o.prescribed_dose, supervised_dispensing: !o.supervised_dispensing }))}>
                {o.supervised_dispensing ? "Record move to take-home dosing" : "Record return to supervised dispensing"}
              </button>
            </Row>
          )}
          {o.status !== "STOPPED" && (
            <Row>
              <input className={INPUT} aria-label="Reason OAT stopped" placeholder="Reason OAT stopped" value={stopReason[o.id] ?? ""} onChange={(e) => setStopReason((x) => ({ ...x, [o.id]: e.target.value }))} />
              <button type="button" className={`${BTN_GHOST} ${BTN_SM}`} disabled={!(stopReason[o.id] ?? "").trim()} onClick={() => void act((t) => updateOatStatus(t, o.id, { status: "STOPPED", reason: stopReason[o.id] }))}>Record stopped</button>
            </Row>
          )}
        </div>
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
